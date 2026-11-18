import {afterEach,describe,expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {AtelierStore} from './store';
import {AssetProductionService} from './asset-production';
import {AtelierDomain} from './domain-service';
import {GuidedWorkflow} from './guided-workflow';
import {ReferencePlanService} from './reference-plan-service';
import {referencePlanTemplate,validateReferencePlanMarkdown} from '../shared/reference-plan';
import {assetProductionPrompt} from '../shared/asset-prompt';
import {buildManualImagePreparationRequest} from '../shared/manual-image-prompt-content';
import {buildStageRequestMarkdown} from './stage-request';
import {createMcpServer} from './mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const roots:string[]=[],stores:AtelierStore[]=[];
afterEach(()=>{for(const store of stores.splice(0))try{store.db.close();}catch{}for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const png=()=>PNG.sync.write(new PNG({width:4,height:4}));
const replacePlanContent=(kind:'assetJob'|'character')=>{
 const kindName=kind==='assetJob'?'Asset':'Character';
 let value=referencePlanTemplate(kind==='assetJob'?'assetJob':'character');
 value=value.replace('# Asset reference plan',`# ${kindName} reference plan`).replace('# Character reference plan',`# ${kindName} reference plan`);
 const details=['The requested design keeps the source identity and dimensions.','The source clearly shows the main silhouette and two visible material changes.','Assumption: The hidden rear uses the same construction and finish as the visible side.','Separate the body, top, and supports at the visible assembly seams.','Keep the measured width to height ratio and use painted wood with a matte metal latch.','Count two full storeys; the small upper opening is a dormer, not an attic floor.','Continue the wall, roof edge, and trim across every unseen exterior face.','Reuse only existing accepted components when policy permits and the source matches.','Keep only the small handle and base trim as separate props.','Check silhouette, overall dimensions, symmetry, and each part placement against the source.'];
 if(kind==='character')details.splice(3,7,'Preserve the face and body proportions shown in the source.','Use the same soft painted edges and restrained surface texture as the artwork.','Describe the hair shape at rest, without wind or motion.','Track the scarf and pouch from this character’s own left and right.','Assumption: Keep the far shoulder attachment aligned with its visible front placement.','Use shared front, side, and back proportions; leave unseen decoration unspecified.');
 const headings=kind==='assetJob'?['User goals','Visible evidence','Assumptions for hidden parts','Modular parts and placements','Proportions and materials','Storey count, attic, dormers and gables','Complete hidden exterior','Reuse under current policy','Props','Validation landmarks']:['User goals','Visible evidence','Assumptions for hidden parts','Identity and proportions','Painterly style','Hair at rest',"Clothing, attachments and asymmetry from the character's own left and right",'Shared front, side and back assumptions','Validation landmarks'];
 const body=headings.map((heading,index)=>`## ${heading}\n- ${details[index]}`).join('\n\n');
 return `# ${kindName} reference plan\n\n${body}\n`;
};
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'aetherflow-reference-plan-')),workspace=path.join(root,'workspace');roots.push(root);const store=new AtelierStore(workspace,path.join(root,'backup.key'));stores.push(store);return {root,workspace,store};}
async function createAssetSource(store:AtelierStore,root:string){
 const service=new AssetProductionService(store),created=service.create({name:'Reference plan test asset',mode:'composite',target:'A compact timber workshop'}),file=path.join(root,'source.png');fs.writeFileSync(file,png());const [source]=await store.importPath(file,created.job.id,root);const updated=service.update({id:created.job.id,expectedRevision:created.job.revision,sourceArtifactId:source.id,sourceCrop:{x:1,y:1,width:2,height:2},target:'A compact timber workshop'});return {service,job:updated,source};
}
function fakeAppServerFactory(cwd:string,markdown:string,seen:any[],settings={model:'gpt-6.2-sol',approvalPolicy:'on-request',activePermissionProfile:{id:'workspace-write'},sandbox:{type:'workspaceWrite'}}){
 const threadId=crypto.randomUUID(),requestId=crypto.randomUUID(),metadata={available:true,threads:[{id:threadId,cwd,source:'vscode',archived:false,createdAtMs:Date.now()}]};
 const client:any={initialize:async()=>({}),verifyAstra:async()=>({id:'gpt-6.2-astra',inputModalities:['text','image']}),startThread:async(work:string)=>({thread:{id:threadId,cwd:work,status:{type:'idle'},environments:null},requestId,...settings}),resumeThread:async()=>({thread:{id:threadId,cwd,status:{type:'idle'},environments:null},...settings}),request:async()=>({}),runAnalysis:async(input:any)=>{seen.push({...input,receivedImages:input.imagePaths.map((file:string)=>({file,ext:path.extname(file),bytes:fs.readFileSync(file)}))});await input.onTurnStarted?.();return {markdown,turnId:crypto.randomUUID(),model:input.model,restoredModel:settings.model};},close:()=>{}};
 return {client,threadId,metadata,factory:()=>client};
}
function serviceContext(store:AtelierStore,workspaceInstanceId:string,options:{serverFactory:(runtime:any,cwd:string)=>any;readThreadById:(id:string)=>Promise<any>;advance?:(store:AtelierStore,owner:{kind:'character'|'assetJob';id:string})=>unknown;bindCharacterSession?:(store:AtelierStore,id:string,revision:number,currentSession:string|null,origin:any)=>Promise<unknown>;cropSourceImage?:(file:string,crop:any)=>Buffer}){
 return {currentStore:()=>store,workspaceInstance:()=>workspaceInstanceId,runtime:()=>({command:'codex',prefixArgs:[],node:'node',terminal:'powershell',terminalKind:'powershell',imagegen:'unknown',authenticated:null,diagnostics:[],available:true} as any),appServerFactory:options.serverFactory,readThreadById:options.readThreadById,advance:options.advance,bindCharacterSession:options.bindCharacterSession,cropSourceImage:options.cropSourceImage};
}

describe('reference-plan artifacts and lifecycle',()=>{
 it('validates substantive sections and labels a concrete hidden-part assumption',()=>{
  const asset=replacePlanContent('assetJob'),character=replacePlanContent('character');
  expect(validateReferencePlanMarkdown('assetJob',asset)).toBe(asset.trim());expect(validateReferencePlanMarkdown('character',character)).toBe(character.trim());
  expect(()=>validateReferencePlanMarkdown('assetJob',referencePlanTemplate('assetJob'))).toThrow(/concrete content/i);
  expect(()=>validateReferencePlanMarkdown('character',character.replace('Assumption:','Detail:'))).toThrow(/Assumption/i);
 });

 it('copies the exact original to a typed owner-scoped attachment and attaches the actual selected crop',async()=>{
  const {root,workspace,store}=setup(),{service,job,source}=await createAssetSource(store,root),instance=crypto.randomUUID(),seen:any[]=[],cropCalls:any[]=[];
  const context=serviceContext(store,instance,{serverFactory:(runtime,cwd)=>fakeAppServerFactory(cwd,replacePlanContent('assetJob'),seen).client,readThreadById:async()=>({available:true,threads:[]}),cropSourceImage:(file,crop)=>{cropCalls.push({file,crop});return png();}}),plans=new ReferencePlanService(store,context),initial=plans.get('assetJob',job.id),server=fakeAppServerFactory(path.join(workspace,'work','assets',job.id),replacePlanContent('assetJob'),seen);
  let indexReads=0;
  context.appServerFactory=server.factory;context.readThreadById=async()=>{
   expect(seen).toHaveLength(1);
   return ++indexReads===1?{available:true,threads:[]}:server.metadata;
  };
  const result=await plans.prepare({kind:'assetJob',ownerId:job.id,expectedRevision:initial.ownerRevision,lineageHash:initial.lineageHash,workspace,workspaceInstanceId:instance});
  expect(result).toMatchObject({started:true,advanced:true});expect(cropCalls).toEqual([{file:store.object(source.data.hash),crop:{x:1,y:1,width:2,height:2}}]);
  const request=seen[0],images=request.receivedImages;
  expect(images).toHaveLength(2);expect(images[0].ext).toBe('.png');expect(images[0].bytes.equals(fs.readFileSync(store.object(source.data.hash)!))).toBe(true);expect(images[1].ext).toBe('.png');expect(request.prompt).toContain('exact selected crop');expect(request.prompt).toContain('"x": 1');
  const current=store.get('assetJob',job.id)!,state=current.data.referencePlan as any,artifact=store.get('artifact',state.currentArtifactId)!,logical=String(artifact.data.logicalPath),visibleFile=path.resolve(workspace,...logical.split('/'));
  expect(current.data.stage).toBe('composition');expect(state.run.status).toBe('ready');expect(fs.readFileSync(visibleFile,'utf8')).toBe(replacePlanContent('assetJob').trim());expect(store.object(String(artifact.data.hash))).toBeTruthy();expect(artifact.data.sourceInputHash).toBe(initial.lineageHash);expect(new AssetProductionService(store).get(job.id).items).toHaveLength(0);expect((new AssetProductionService(store).get(job.id).job.data as any).selectedItemId).toBeFalsy();
  expect(fs.existsSync(path.dirname(images[0].file))).toBe(false);
  expect(indexReads).toBe(2);
  expect(current.data.codexSession.current.sessionId).toBe(server.threadId);
 });

 it('reopens the exact Codex draft and imports its Markdown without needing the routing index',async()=>{
  const {root,workspace,store}=setup(),{job}=await createAssetSource(store,root),instance=crypto.randomUUID();
  const plans=new ReferencePlanService(store,{currentStore:()=>store,workspaceInstance:()=>instance,runtime:()=>{throw new Error('Manual requests use the normal Codex terminal.');},cropSourceImage:()=>png()});
  const initial=plans.get('assetJob',job.id);
  plans.toggle({kind:'assetJob',ownerId:job.id,enabled:true,expectedRevision:initial.ownerRevision,lineageHash:initial.lineageHash});
  const input={kind:'assetJob' as const,ownerId:job.id,workspace,workspaceInstanceId:instance,lineageHash:initial.lineageHash};
  const draft=plans.codexRequest(input),folder=path.join(workspace,'work','assets',job.id,'reference-plan-inputs',draft.draftId);
  await expect(plans.prepare({...input,expectedRevision:draft.ownerRevision,reuseOnly:true})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  const planFile=path.join(folder,'plan.md');
  expect(draft.markdown).toContain(planFile);
  expect(draft.markdown).toContain(path.join(folder,'source-01-crop.png'));
  expect(plans.codexRequest(input)).toEqual(draft);
  expect(()=>plans.importCodexDraft({...input,draftId:draft.draftId})).toThrow(/not saved/i);
  expect(()=>plans.importCodexDraft({...input,draftId:crypto.randomUUID()})).toThrow(/changed/i);
  fs.writeFileSync(planFile,replacePlanContent('assetJob'));
  const result=plans.importCodexDraft({...input,draftId:draft.draftId});
  expect(result.advanced).toBe(true);
  const after=plans.get('assetJob',job.id);
  expect(after.markdown).toBe(replacePlanContent('assetJob').trim());
  expect(after.active).toBe(true);
  expect(store.get('assetJob',job.id)?.data.stage).toBe('composition');
 });

 it('imports a character Codex draft into the guided views step',async()=>{
  const {root,workspace,store}=setup(),guided=new GuidedWorkflow(store,new AtelierDomain(store));
  store.setSettings({locale:'ru'});
  const sourceFile=path.join(root,'character-draft.png');
  fs.writeFileSync(sourceFile,png());
  const {concept,artifacts}=await store.importGallery([sourceFile],{name:'Codex draft character'});
  const first=guided.createCharacter(concept.name,'',concept.id);
  const deleted=store.deleteCharacter(first.character.id,first.character.revision,workspace);
  const second=guided.createCharacter(concept.name,'',concept.id,'codex',true);
  const character=second.character;
  expect(character.id).not.toBe(first.character.id);
  expect(second.workflow.data.guided.sourceArtifactIds).toEqual([artifacts[0].id]);
  expect(store.get('workflow',first.workflow.id)).toEqual(first.workflow);
  expect(store.get('character',deleted.id)?.data.deletedAt).toBeTruthy();
  expect(guided.createCharacter(concept.name,'',concept.id,'codex',true).character.id).toBe(character.id);
  store.restoreCharacter(deleted.id,deleted.revision,workspace);
  expect(guided.createCharacter(concept.name,'',concept.id,'codex',true).character.id).toBe(character.id);
  expect(store.get('concept',concept.id)?.data.characterId).toBe(character.id);
  const instance=crypto.randomUUID(),plans=new ReferencePlanService(store,{
   currentStore:()=>store,workspaceInstance:()=>instance,runtime:()=>{throw new Error('Unexpected app-server launch.');},
   advance:(active,owner)=>guided.continue(owner.id,'source',active.workflowForCharacter(owner.id)!.revision),
  });
  const initial=plans.get('character',character.id);
  const input={kind:'character' as const,ownerId:character.id,lineageHash:initial.lineageHash,workspace,workspaceInstanceId:instance};
  plans.toggle({...input,enabled:true,expectedRevision:initial.ownerRevision});
  const draft=plans.codexRequest(input);
  const file=path.join(workspace,'work','characters',character.id,'reference-plan-inputs',draft.draftId,'plan.md');
  expect(draft.markdown).toContain('every message to the user in Russian');
  expect(draft.markdown).toContain('advance automatically');
  expect(draft.markdown).not.toContain('Import plan and continue');
  expect(plans.get('character',character.id).codexDraftId).toBe(draft.draftId);
  expect(plans.importCodexDraft({...input,draftId:draft.draftId,poll:true})).toEqual({advanced:false});
  fs.writeFileSync(file,replacePlanContent('character'));
  expect(plans.importCodexDraft({...input,draftId:draft.draftId,poll:true}).advanced).toBe(true);
  expect(guided.getStatus(character.id).currentStepKey).toBe('views');
  expect(guided.prepareGeneration(character.id,'views',{part:'head'}).referencePlan?.markdown).toBe(replacePlanContent('character').trim());
  const batch=guided.prepareGeneration(character.id,'views',{});
  expect(batch.targetSlots.filter(slot=>slot.part==='head')).toHaveLength(4);
  expect(batch.targetSlots.filter(slot=>slot.part==='body')).toHaveLength(4);
 });

 it('creates and binds a character plan, advances only its workflow, and feeds current guidance into regular and manual prompts',async()=>{
  const {root,workspace,store}=setup(),domain=new AtelierDomain(store),guided=new GuidedWorkflow(store,domain),character=guided.createCharacter('Reference plan character').character!,sourceFile=path.join(root,'character.png');fs.writeFileSync(sourceFile,png());const [source]=await store.importPath(sourceFile,character.id,root);guided.addSources(character.id,[source.id]);
  const instance=crypto.randomUUID(),seen:any[]=[],work=path.join(workspace,'work','characters',character.id),server=fakeAppServerFactory(work,replacePlanContent('character'),seen),originBinding=async(active:AtelierStore,id:string,revision:number,currentSession:string|null,origin:any)=>{const value=active.get('character',id)!;if(value.revision!==revision||currentSession)throw new Error('Character owner changed.');return active.put({id,kind:'character',name:value.name,data:{...value.data,guidedSession:{...(value.data.guidedSession||{}),current:{sessionId:origin.sessionId,scope:{host:origin.host,profile:origin.profile,cwd:origin.cwd},origin,verifiedAt:new Date().toISOString(),lastAcknowledged:null}}},expectedRevision:value.revision});};
  const context=serviceContext(store,instance,{serverFactory:server.factory,readThreadById:async()=>server.metadata,bindCharacterSession:originBinding,advance:(active,owner)=>{const workflow=active.workflowForCharacter(owner.id);if(!workflow)throw new Error('Character workflow missing.');return new GuidedWorkflow(active,new AtelierDomain(active)).continue(owner.id,'source',workflow.revision);}}),plans=new ReferencePlanService(store,context),initial=plans.get('character',character.id);
  const result=await plans.prepare({kind:'character',ownerId:character.id,expectedRevision:initial.ownerRevision,lineageHash:initial.lineageHash,workspace,workspaceInstanceId:instance});
  expect(result).toMatchObject({started:true,advanced:true});const after=guided.getStatus(character.id);expect(after.currentStepKey).toBe('views');expect(after.character.data.guidedSession.current.sessionId).toBe(server.threadId);expect(after.workflow.data.guided.slots.some((slot:any)=>slot.reviewStatus==='accepted')).toBe(false);
  const continuation=guided.prepareContinuation(character.id),generation=guided.prepareGeneration(character.id,'views',{part:'head'}),plan=continuation.referencePlan;if(!plan||!generation.referencePlan)throw new Error('The current character plan was not attached to downstream contexts.');
  expect(plan.markdown).toBe(replacePlanContent('character').trim());expect(generation.referencePlan.hash).toBe(plan.hash);
  const external=buildManualImagePreparationRequest({locale:'en',target:'front view',purpose:'color',canonicalRequest:JSON.stringify(generation),references:[]});expect(external).toContain(replacePlanContent('character').trim().replace(/\n/g,'\\n'));expect(external).toContain('include the constraints relevant to this target directly');expect(external).not.toContain('reference-plans');
 });

 it.each(['guided_output_submit','guided_output_batch_submit'])('keeps the first usable rear view for review after a hidden-detail assumption differs (%s)',async tool=>{
  const {root,workspace,store}=setup(),guided=new GuidedWorkflow(store,new AtelierDomain(store));
  const character=guided.createCharacter('Costume with one front reference').character;
  const sourcePath=path.join(root,'front.png'),backPath=path.join(root,'back.png');
  const costume=(back:boolean)=>{
   const image=new PNG({width:96,height:128});
   image.data.fill(255);
   const paint=(left:number,top:number,width:number,height:number,red:number,green:number,blue:number)=>{
    for(let y=top;y<top+height;y++)for(let x=left;x<left+width;x++){
     const pixel=(y*image.width+x)*4;
     image.data[pixel]=red;image.data[pixel+1]=green;image.data[pixel+2]=blue;
    }
   };
   paint(38,17,20,9,39,30,44); // Collar.
   paint(15,29,66,15,54,40,65); // Sleeves in T-pose.
   paint(34,26,28,45,54,40,65); // Bodice.
   paint(34,59,28,7,164,127,79); // Belt.
   paint(36,70,10,44,39,30,44);
   paint(50,70,10,44,39,30,44);
   if(back)paint(41,42,14,8,195,135,175); // Additional rear ornament.
   return PNG.sync.write(image);
  };
  fs.writeFileSync(sourcePath,costume(false));
  const [source]=await store.importPath(sourcePath,character.id,root);
  guided.addSources(character.id,[source.id]);
  const plans=new ReferencePlanService(store,{currentStore:()=>store,workspaceInstance:()=>instance,runtime:()=>{throw new Error('Unexpected plan generation');}});
  const instance=crypto.randomUUID(),plan=plans.get('character',character.id);
  const scope={kind:'character' as const,ownerId:character.id,lineageHash:plan.lineageHash};
  const enabled=plans.toggle({...scope,enabled:true,expectedRevision:plan.ownerRevision});
  plans.save({...scope,expectedRevision:enabled.revision,markdown:replacePlanContent('character')
   .replace('The source clearly shows the main silhouette and two visible material changes.','The only reference is a front view. Its collar, sleeves and belt establish the costume landmarks.')
   .replace('The hidden rear uses the same construction and finish as the visible side.','The hidden rear of the bodice is plain and has no ornament.')});
  guided.continue(character.id,'source',store.workflowForCharacter(character.id)!.revision);
  const rear=guided.getStatus(character.id).slots.find((slot:any)=>slot.key==='reference-body-back')!;
  const context=guided.prepareGeneration(character.id,'views',{slotId:rear.id});
  expect(context.inputs).toHaveLength(1);
  expect(context.referencePlan?.markdown).toContain('Assumption: The hidden rear of the bodice is plain');
  const request={definitionVersion:2,entityKind:'character',stage:'views',guidedContext:context};
  expect(buildStageRequestMarkdown(request,'en',workspace).markdown).toContain('Do not regenerate solely because a hidden detail differs from an assumption. Honor explicit user requirements for hidden areas.');
  expect(buildStageRequestMarkdown(request,'ru',workspace).markdown).toContain('Явное требование пользователя к скрытой стороне обязательно.');

  const generate=vi.fn(()=>costume(true));
  const firstPng=generate();
  fs.writeFileSync(backPath,firstPng);
  const client=new Client({name:'views-reconstruction-fixture',version:'1.0.0'});
  const server=createMcpServer(store,file=>file,()=>({ok:true}));
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  const invoke=async(name:string,args:Record<string,unknown>)=>{
   const response=await client.callTool({name,arguments:args});
   const message=(response.content as Array<{text:string}>)[0];
   return JSON.parse(message.text);
  };
  try{
   await server.connect(serverTransport);
   await client.connect(clientTransport);
   const registered=await invoke('asset_register',{path:backPath,parentId:character.id});
   expect(registered.ok).toBe(true);
   const artifactId=registered.data[0].id,reconstructionNote='The hidden back has a small ornament between the sleeves.';
   const output={slotId:rear.id,artifactId,reconstructionNote};
   const submitted=await invoke(tool,tool==='guided_output_submit'
    ?{id:character.id,...output}
    :{id:character.id,outputs:[output],expectedRevision:store.workflowForCharacter(character.id)!.revision,idempotencyKey:crypto.randomUUID()});
   expect(submitted.ok).toBe(true);
   const submission=submitted.data.submission||submitted.data.batch.items[0];
   expect(submission).toMatchObject({artifactId,selected:true,reviewStatus:'pending',previewAvailable:true,reconstructionNote});
   const stored=guided.getStatus(character.id).slots.find((slot:any)=>slot.id===rear.id);
   expect(stored).toMatchObject({artifactId,candidateId:submission.candidateId,reviewStatus:'pending',candidates:[{reconstructionNote,reviewStatus:'pending'}]});
   expect(fs.readFileSync(store.object(submission.hash)!)).toEqual(firstPng);
   expect(generate).toHaveBeenCalledTimes(1);

   guided.review(character.id,rear.id,'accept');
   expect(guided.listCandidates(character.id).candidates).toContainEqual(expect.objectContaining({artifactId,reconstructionNote,reviewStatus:'accepted'}));
  }finally{
   await client.close();
   await server.close();
  }
 });

 it('preserves historical plans, rejects duplicate launch/retry ambiguity, and keeps stale late completion from advancing',async()=>{
  const {root,workspace,store}=setup(),{service,job}=await createAssetSource(store,root),instance=crypto.randomUUID(),seen:any[]=[],first=fakeAppServerFactory(path.join(workspace,'work','assets',job.id),replacePlanContent('assetJob'),seen);let finish:(value:any)=>void=()=>{};const pending=new Promise<any>(resolve=>finish=resolve);let runCount=0;
  const context=serviceContext(store,instance,{serverFactory:()=>{runCount++;return {...first.client,runAnalysis:async(input:any)=>{seen.push(input);await input.onTurnStarted?.();return pending;}};},readThreadById:async()=>first.metadata,cropSourceImage:()=>png()}),plans=new ReferencePlanService(store,context),initial=plans.get('assetJob',job.id),running=plans.prepare({kind:'assetJob',ownerId:job.id,expectedRevision:initial.ownerRevision,lineageHash:initial.lineageHash,workspace,workspaceInstanceId:instance});
  while(!seen.length)await new Promise(resolve=>setTimeout(resolve,5));
  await expect(plans.prepare({kind:'assetJob',ownerId:job.id,expectedRevision:initial.ownerRevision,lineageHash:initial.lineageHash,workspace,workspaceInstanceId:instance})).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect(runCount).toBe(1);
  const serviceForUpdate=new AssetProductionService(store),latest=store.get('assetJob',job.id)!;serviceForUpdate.update({id:job.id,expectedRevision:latest.revision,target:'A wider timber workshop'});
  finish({markdown:replacePlanContent('assetJob'),turnId:crypto.randomUUID(),model:'gpt-6.2-astra',restoredModel:'gpt-6.2-sol'});const result:any=await running;
  expect(result).toMatchObject({started:true,advanced:false,stale:true});const owner=store.get('assetJob',job.id)!,state=owner.data.referencePlan as any,historical=store.get('artifact',state.run.artifactId)!;
  expect(state.run.status).toBe('stale');expect(state.currentArtifactId).toBeUndefined();expect(historical.data.sourceInputHash).toBe(initial.lineageHash);expect(owner.data.stage).toBe('source');expect(fs.readFileSync(path.resolve(workspace,...String(historical.data.logicalPath).split('/')),'utf8')).toBe(replacePlanContent('assetJob').trim());
 });

 it('requires an explicit retry and resumes the exact verified bound Astra thread with the original settings restored',async()=>{
  const {root,workspace,store}=setup(),{service,job}=await createAssetSource(store,root),instance=crypto.randomUUID(),seen:any[]=[],first=fakeAppServerFactory(path.join(workspace,'work','assets',job.id),replacePlanContent('assetJob'),seen);let factoryCalls=0,resumeArgs:any=null;
  first.client.runAnalysis=async(input:any)=>{seen.push(input);await input.onTurnStarted?.();throw new Error('Synthetic Astra turn failure.');};
  const context=serviceContext(store,instance,{serverFactory:()=>{factoryCalls++;if(factoryCalls===1)return first.client;return {...first.client,startThread:async()=>{throw new Error('A bound thread must resume, not start again.');},resumeThread:async(sessionId:string,cwd:string)=>{resumeArgs={sessionId,cwd};return {thread:{id:sessionId,cwd,status:{type:'idle'},environments:null},model:'gpt-6.2-sol',approvalPolicy:'on-request',activePermissionProfile:{id:'workspace-write'},sandbox:{type:'workspaceWrite'}};},runAnalysis:async(input:any)=>{seen.push(input);await input.onTurnStarted?.();return {markdown:replacePlanContent('assetJob'),turnId:crypto.randomUUID(),model:input.model,restoredModel:input.restoreSettings.model};}};},readThreadById:async()=>first.metadata,cropSourceImage:()=>png()}),plans=new ReferencePlanService(store,context),initial=plans.get('assetJob',job.id),request={kind:'assetJob' as const,ownerId:job.id,expectedRevision:initial.ownerRevision,lineageHash:initial.lineageHash,workspace,workspaceInstanceId:instance};
  await expect(plans.prepare(request)).rejects.toThrow('Synthetic Astra turn failure.');const failed=plans.get('assetJob',job.id);expect(failed.run?.status).toBe('error');expect(store.get('assetJob',job.id)?.data.codexSession?.current?.sessionId).toBe(first.threadId);
  await expect(plans.prepare({...request,expectedRevision:failed.ownerRevision})).rejects.toMatchObject({code:'REFERENCE_PLAN_RETRY_REQUIRED'});expect(factoryCalls).toBe(1);
  const result=await plans.prepare({...request,expectedRevision:failed.ownerRevision,retry:true});expect(result).toMatchObject({started:true,advanced:true});expect(factoryCalls).toBe(2);expect(resumeArgs).toMatchObject({sessionId:first.threadId,cwd:path.join(workspace,'work','assets',job.id)});expect(seen[1].threadId).toBe(first.threadId);expect(seen[1].model).toBe('gpt-6.2-astra');expect(seen[1].restoreSettings).toMatchObject({model:'gpt-6.2-sol',approvalPolicy:'on-request',activePermissionProfile:{id:'workspace-write'}});expect(store.get('assetJob',job.id)?.data.referencePlan.run.status).toBe('ready');
 });

 it('marks a persisted running request interrupted on reopen and preserves accepted catalog decisions when source guidance goes stale',async()=>{
  const {root,workspace,store}=setup(),{service,job}=await createAssetSource(store,root),instance=crypto.randomUUID(),initial=new ReferencePlanService(store,{currentStore:()=>store,workspaceInstance:()=>instance,runtime:()=>({} as any)}).get('assetJob',job.id),now=new Date().toISOString(),runId=crypto.randomUUID(),current=store.get('assetJob',job.id)!;
  store.assetProductionPut({id:job.id,kind:'assetJob',name:job.name,data:{...current.data,referencePlan:{enabled:true,run:{id:runId,status:'running',requestedAt:now,updatedAt:now,lineageHash:initial.lineageHash,sourceHash:initial.sourceHash},history:[]}},expectedRevision:current.revision});
  const plans=new ReferencePlanService(store,{currentStore:()=>store,workspaceInstance:()=>instance,runtime:()=>({} as any)}),interrupted=plans.get('assetJob',job.id);expect(interrupted.run?.status).toBe('interrupted');
  const serviceAssets=new AssetProductionService(store),latest=store.get('assetJob',job.id)!;serviceAssets.update({id:job.id,expectedRevision:latest.revision,target:'A renovated workshop'});const after=plans.get('assetJob',job.id);expect(after.isCurrent).toBe(false);expect(after.active).toBe(false);expect(after.run?.status).toBe('interrupted');
  void workspace;
 });

 it('adds the exact active asset plan to normal prompts without changing acceptance state',()=>{
  const plan=replacePlanContent('assetJob'),job:any={id:crypto.randomUUID(),name:'Asset',revision:1,data:{stage:'composition',target:'A workshop',catalogStatus:'draft',mode:'composite'}},workflow:any={id:crypto.randomUUID(),revision:1,data:{slots:[],instances:[]}},result=assetProductionPrompt('en',{job,items:[],workflow,referencePlan:{artifactId:crypto.randomUUID(),hash:'a'.repeat(64),lineageHash:'b'.repeat(64),markdown:plan}});
  expect(result).toContain('Current reference plan');expect(result).toContain(plan.replace(/\n/g,'\\n'));expect(result).toContain('does not approve a catalog, model, or image');
 });
});
