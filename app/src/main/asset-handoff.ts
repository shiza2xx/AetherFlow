import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import {z} from 'zod';
import type {AtelierStore} from './store';import {AssetProductionService} from './asset-production';import {safeStorageName,workspaceLayout} from './workspace-layout';
import {assetViewsForRoute} from '../shared/asset-production';
import {currentAcceptedSharedPartition} from './asset-shared-partition';
import {AssetOperationsService} from './asset-operations';
import {runExclusiveBlenderJob} from './blender-adapter';
import {coordinateModelProcessingRequest,createModelProcessingIdentity,findCompletedModelProcessing,modelProcessingRequestKey} from './model-processing-cache';
import {ownerForArtifact} from './workspace-layout';
const Id=z.string().uuid();
export const AssetHandoffInput=z.object({id:Id,expectedRevision:z.number().int().nonnegative(),kind:z.enum(['geometry','texture'])}).strict();
function hash(file:string){const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024);try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');}
function acceptedHumanCandidate(workflow:any,itemId:string,roles:string[],candidate:any){if(!candidate||candidate.status!=='accepted'||candidate.reviewedBy!=='human'||!/^[a-f0-9]{64}$/.test(String(candidate.hash||''))||!Id.safeParse(candidate.artifactId).success)return false;return roles.some(role=>{const slot=workflow.data.slots.find((value:any)=>value.itemId===itemId&&value.role===role);return slot?.acceptedCandidateId===candidate.id&&slot.candidates.some((value:any)=>value.id===candidate.id&&value.status==='accepted'&&value.reviewedBy==='human'&&value.artifactId===candidate.artifactId&&value.hash===candidate.hash);});}
export class AssetHandoffService{
 private production:AssetProductionService;
 constructor(private store:AtelierStore,private options:{resourceRoot?:string;blender?:string}={}){this.production=new AssetProductionService(store);}
 private async prepareSingleMeshTextureModel(ctx:any,item:any,sourceCandidate:any,partitionLineage:any){
  const source=this.store.get('artifact',sourceCandidate.artifactId),sourceHash=String(sourceCandidate.hash||'');
  if(!source||source.data.hash!==sourceHash)throw new Error('Accepted shared-prop geometry changed before texture export.');
  const ops=new AssetOperationsService(this.store,{resourceRoot:this.options.resourceRoot||path.resolve('.'),blender:this.options.blender});
  await ops.objectAsync(source.id,sourceHash);
  if(partitionLineage.meshObjectCount===1)return {artifact:source,metadata:{sourceArtifactId:source.id,sourceHash,outputArtifactId:source.id,outputHash:sourceHash,sourceMeshObjectCount:1,meshObjectCount:1,operationId:null,reportArtifactId:null,reportHash:null}};
  if(!this.options.blender||!fs.existsSync(this.options.blender))throw new Error('The accepted partition has no verified single-mesh export proof; configure Blender to prepare its safe texture-export derivative.');
  const resourceRoot=path.resolve(this.options.resourceRoot||'.'),scriptDir=path.resolve(resourceRoot,'docs/skills/aetherflow-asset-pipeline/scripts'),surface=path.join(scriptDir,'asset_surface.py'),importer=path.join(scriptDir,'asset_safe_import.py'),mesh=path.join(scriptDir,'asset_mesh_helpers.py'),scripts=[surface,importer,mesh];
  for(const script of scripts)if(!fs.existsSync(script)||fs.realpathSync.native(script)!==script)throw new Error('Bundled asset texture-export scripts are unavailable or unsafe.');
  const owner={kind:'assetJob' as const,id:ctx.job.id,name:ctx.job.name},request=modelProcessingRequestKey(this.store,owner,{itemId:item.id,sourceArtifactId:source.id,sourceHash,dependencies:this.store.dependencies(source.id).map(row=>[row.logicalPath,row.hash]),recipe:'asset-shared-prop-single-mesh',version:1,blender:path.resolve(this.options.blender),scripts});
  return coordinateModelProcessingRequest(this.store,owner,request,async()=>{
   const layout=workspaceLayout(this.store.root),probeId=crypto.randomUUID(),probe=layout.run(owner,probeId);fs.mkdirSync(path.dirname(probe),{recursive:true});fs.mkdirSync(probe,{recursive:false});
   try{
    const stagedProbe=await ops.stageVerified(source,path.join(probe,'input'));
    const identity=await createModelProcessingIdentity(this.store,{owner,scope:item.id,profile:{mode:'texture-export',preserveDisconnectedSurfaces:true},artifactId:source.id,blenderPath:this.options.blender!,scripts,recipeId:'asset-shared-prop-single-mesh',recipeVersion:'1',verifiedFiles:stagedProbe.verifiedFiles});
    const cached=findCompletedModelProcessing(this.store,identity,'texture-export');
    if(cached){
     try{
      const proof=cached.data.report as any,output=proof?.outputArtifactId?this.store.get('artifact',String(proof.outputArtifactId)):null,reportArtifact=proof?.reportArtifactId?this.store.get('artifact',String(proof.reportArtifactId)):null;
      if(cached.data.assetJobId===ctx.job.id&&cached.data.assetId===source.id&&cached.data.inputs?.includes(sourceHash)&&output&&reportArtifact&&output.data.hash===proof.outputHash&&output.data.parentId===item.id&&output.data.versionOf===source.id&&output.data.sourceInputHash===sourceHash&&output.data.operationId===cached.id&&ownerForArtifact(this.store,output)?.id===ctx.job.id&&reportArtifact.data.hash===proof.reportHash&&reportArtifact.data.parentId===item.id){
       const [{file:outputFile},{file:reportFile}]=await Promise.all([ops.objectAsync(output.id,String(output.data.hash)),ops.objectAsync(reportArtifact.id,String(reportArtifact.data.hash))]);
       const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
       if(report.mode==='texture-export'&&report.ok===true&&report.sourceHash===sourceHash&&report.outputs?.length===1&&report.outputs[0].format==='fbx'&&report.outputs[0].meshObjectCount===1&&report.outputs[0].hash===output.data.hash&&hash(outputFile)===output.data.hash&&hash(reportFile)===reportArtifact.data.hash){
        return {artifact:output,metadata:{sourceArtifactId:source.id,sourceHash,outputArtifactId:output.id,outputHash:output.data.hash,sourceMeshObjectCount:Number(report.sourceObjectCount||report.outputs[0].sourceObjectCount),meshObjectCount:1,operationId:cached.id,reportArtifactId:reportArtifact.id,reportHash:reportArtifact.data.hash}};
       }
      }
     }catch{/* A stale or corrupt cache entry is rebuilt below. */}
    }
    const operation=ops.begin(ctx.job.id,source.id,'texture-export',[sourceHash],{itemId:item.id,recipe:'asset-shared-prop-single-mesh-v1'}),work=layout.run(owner,operation.id),current=this.store.get('operation',operation.id)!;
    this.store.put({id:operation.id,kind:'operation',name:operation.name,data:{...current.data,modelProcessingIdentity:identity},expectedRevision:current.revision});fs.renameSync(probe,work);
    try{
     const inputRoot=path.join(work,'input'),staged=path.join(work,path.relative(probe,stagedProbe.sourcePath)),outputDirectory=path.join(work,'outputs'),reportPath=path.join(work,'report.json'),configPath=path.join(work,'request.json'),manifest=ops.importManifest(source,inputRoot);fs.mkdirSync(outputDirectory,{recursive:false});
     fs.writeFileSync(configPath,JSON.stringify({mode:'texture-export',source:staged,sourceHash,sourceManifest:manifest,outputDirectory,report:reportPath,group:item.id}),{flag:'wx'});
     let run:{stdout:string;stderr:string};
     try{run=await runExclusiveBlenderJob(this.store,this.options.blender!,['--background','--factory-startup','--disable-autoexec','--threads','1','--python',surface,'--',configPath],{cwd:work,timeoutMs:300000,maxWorkingSetBytes:1536*1024*1024});}
     catch(error){if(fs.existsSync(reportPath)){try{const failed=JSON.parse(fs.readFileSync(reportPath,'utf8'));throw new Error(`${error instanceof Error?error.message:String(error)} · ${String(failed.error||failed.trace||'').slice(0,3000)}`);}catch(reportError){if(reportError instanceof Error&&reportError.message.includes(' · '))throw reportError;}}throw error;}
     if(!fs.existsSync(reportPath)||fs.realpathSync.native(reportPath)!==path.resolve(reportPath)||fs.statSync(reportPath).size>4*1024*1024)throw new Error(`Blender texture-export report is missing or unsafe: ${(run.stderr+' '+run.stdout).slice(-2000)}`);
     const report=JSON.parse(fs.readFileSync(reportPath,'utf8')),fbx=report.outputs?.find((row:any)=>row.format==='fbx'),outputPath=fbx?.path?path.resolve(String(fbx.path)):'';
     if(report.schemaVersion!==1||report.mode!=='texture-export'||report.ok!==true||report.autoexec!=='disabled'||report.sourceHash!==sourceHash||!fbx||fbx.group!==item.id||fbx.meshObjectCount!==1||path.dirname(outputPath)!==path.resolve(outputDirectory)||!fs.existsSync(outputPath)||fs.lstatSync(outputPath).isSymbolicLink()||fs.realpathSync.native(outputPath)!==outputPath||hash(outputPath)!==fbx.hash)throw new Error('Blender texture-export failed source, one-mesh or output-hash verification.');
     await ops.objectAsync(source.id,sourceHash);
     const ingested=await this.store.ingest(outputPath,item.id,'artifact'),derived=this.store.assetProductionPut({kind:'artifact',id:ingested.id,name:ingested.name,data:{...ingested.data,operationId:operation.id,versionOf:source.id,sourceInputHash:sourceHash,settings:{recipe:'asset-shared-prop-single-mesh-v1',preserveDisconnectedSurfaces:true},validationChecks:{outputHashVerified:true,sourceUnmodified:true,meshObjectCount:1,joinSurfaceVerified:true}},expectedRevision:ingested.revision});
     const reportArtifact=await this.store.ingest(reportPath,item.id,'artifact');
     this.store.addDependency(derived.id,sourceHash,'source-model.fbx','provenance');this.store.addDependency(derived.id,reportArtifact.data.hash,'texture-export-report.json','provenance');this.store.link(operation.id,source.id,'texture-export source');this.store.link(operation.id,derived.id,'texture-export derivative');
     const savedReport={...report,outputArtifactId:derived.id,outputHash:derived.data.hash,reportArtifactId:reportArtifact.id,reportHash:reportArtifact.data.hash};ops.end(operation,'complete',savedReport);
     return {artifact:derived,metadata:{sourceArtifactId:source.id,sourceHash,outputArtifactId:derived.id,outputHash:derived.data.hash,sourceMeshObjectCount:Number(report.sourceObjectCount||fbx.sourceObjectCount),meshObjectCount:1,operationId:operation.id,reportArtifactId:reportArtifact.id,reportHash:reportArtifact.data.hash}};
    }catch(error){ops.end(operation,'failed',{message:error instanceof Error?error.message:String(error)});throw error;}
   }finally{if(fs.existsSync(probe))fs.rmSync(probe,{recursive:true,force:true});}
  });
 }
 async prepare(raw:unknown){
  const input=AssetHandoffInput.parse(raw),ctx=this.production.get(input.id);
  if(ctx.workflow.revision!==input.expectedRevision)throw new Error('Workflow changed; refresh before preparing the handoff.');
  if(ctx.job.data.catalogRequiresRevalidation||ctx.job.data.catalogStatus!=='accepted'&&!(ctx.job.data.catalogStatus==='pending'&&ctx.job.data.catalogPreviouslyAccepted))throw new Error('An accepted catalog is required.');
    const selections:Array<{item:any;files:Array<{role:string;candidate:any;sourceCandidate?:any;textureExport?:any}>;sourceLineage?:any;partitionLineage?:any}>=[],waiting:Array<{itemId:string;name:string;reason:string}>=[];
  for(const item of ctx.items){
   const current=ctx.current.find(value=>value.itemId===item.id)!;
    if(input.kind==='texture'&&item.data.route!=='shared-prop')continue;
   if(item.data.route==='foliage'){waiting.push({itemId:item.id,name:item.name,reason:'Foliage uses cards, not Tripo geometry.'});continue;}
   if(input.kind==='texture'){
     const partitionLineage=currentAcceptedSharedPartition(this.store,ctx.workflow,item,current);
    const geometry=current.geometry,acceptedGeometry=!current.geometryNeedsReview&&acceptedHumanCandidate(ctx.workflow,item.id,['geometry'],geometry);
    const colors=current.images.filter((image:any)=>image.candidate&&ctx.current.find((value:any)=>value.itemId===item.id)?.imageInputFingerprints?.includes(image.candidate.inputFingerprint)&&acceptedHumanCandidate(ctx.workflow,item.id,image.role==='image:front'?['image:front','image']: [image.role],image.candidate));
    const frontColor=colors.some((image:any)=>image.role==='image:front');
     if(!partitionLineage||!acceptedGeometry||current.imagesNeedReview||!frontColor){
      waiting.push({itemId:item.id,name:item.name,reason:!partitionLineage?'A current human-accepted partitioned model from the accepted shared sheet is required.':'A current human-accepted front color reference is required.'});continue;
    }
     const delivery=await this.prepareSingleMeshTextureModel(ctx,item,geometry,partitionLineage);
     selections.push({item,files:[{role:'geometry',candidate:{artifactId:delivery.artifact.id,hash:delivery.artifact.data.hash},sourceCandidate:geometry,textureExport:delivery.metadata},...colors.map((image:any)=>({role:image.role,candidate:image.candidate}))],partitionLineage});continue;
   }
   let files:Array<{role:string;candidate:any}>;
   if(item.data.route==='shared-prop'){
     const sheet=current.sheets?.find((value:any)=>value.fresh===true&&value.accepted===true&&value.candidate?.status==='accepted'&&value.candidate),source=current.sharedSheetSource;
     files=sheet&&source?.state==='ready'?[{role:'sheet',candidate:sheet.candidate}]:[];
     if(sheet&&source?.state==='ready')selections.push({item,files,sourceLineage:{sheetArtifactId:sheet.artifactId,sheetHash:sheet.hash,sheetInputFingerprint:current.sharedSheetInputFingerprint,source:{itemId:source.itemId,role:source.role,...source.sourceSlotRole?{sourceSlotRole:source.sourceSlotRole}:{},sourceType:source.sourceType,sourceArtifactId:source.sourceArtifactId,sourceHash:source.sourceHash,sourceInputFingerprint:source.sourceInputFingerprint,...source.pairedColorHash?{pairedColorHash:source.pairedColorHash}:{}}}});
     if(sheet&&source?.state==='ready')continue;
   }else{
    const views=assetViewsForRoute(item.data.route,item.data.views,item.data.viewType).filter((view:string)=>view==='front'||view==='side'),rows=item.data.depthEnabled?current.depths.filter((entry:any)=>entry.role!=='depth:sheet'):current.images;
    const roleFor=(view:string)=>item.data.depthEnabled?`depth:${view}`:`image:${view}`;
    files=views.map((view:string)=>{const entry=rows.find((value:any)=>value.role===roleFor(view)||(view==='front'&&views.length===1&&value.role===(item.data.depthEnabled?'depth':'image')));return {role:roleFor(view),candidate:entry?.candidate};}).filter((entry:any)=>entry.candidate?.status==='accepted'&&entry.candidate.reviewedBy==='human');
   }
   const requiredViews=assetViewsForRoute(item.data.route,item.data.views,item.data.viewType).filter((view:string)=>view==='front'||view==='side'),missingViews=item.data.route!=='shared-prop'&&requiredViews.some((view:string)=>!files.some(file=>file.role===`${item.data.depthEnabled?'depth':'image'}:${view}`));
   if(!files.length||missingViews||current.imagesNeedReview||current.sheetsNeedReview||item.data.depthEnabled&&current.depthsNeedReview){
    waiting.push({itemId:item.id,name:item.name,reason:item.data.depthEnabled?'Current accepted depth inputs are required.':'Current accepted geometry references are required.'});continue;
   }
   selections.push({item,files});
  }
  if(!selections.length)throw new Error('No items are currently eligible for this handoff.');
  if(this.production.get(input.id).workflow.revision!==input.expectedRevision)throw new Error('Workflow changed while preparing the texture handoff; refresh before opening it.');
  const first=selections[0].files[0],op=this.store.put({kind:'operation',name:`Asset ${input.kind} handoff`,data:{schemaVersion:1,assetId:first.sourceCandidate?.artifactId||first.candidate.artifactId,assetJobId:input.id,status:'running',inputs:[...new Set(selections.flatMap(x=>x.files.flatMap(f=>[f.candidate.hash,...(f.sourceCandidate?[f.sourceCandidate.hash]:[])])))],parameters:{mode:'handoff',kind:input.kind,...input.kind==='texture'?{scope:'separated-shared-props-v1',partitionLineages:selections.filter((selection:any)=>selection.partitionLineage).map((selection:any)=>({itemId:selection.item.id,...selection.partitionLineage})),textureExports:selections.flatMap(selection=>selection.files.filter(file=>file.role==='geometry'&&file.textureExport).map(file=>({itemId:selection.item.id,...file.textureExport})))}:{},sourceLineages:selections.filter((selection:any)=>selection.sourceLineage).map((selection:any)=>({itemId:selection.item.id,...selection.sourceLineage}))},toolVersions:{application:'AetherFlow'}}});
  try{
   const layout=workspaceLayout(this.store.root),relative=`work/assets/${input.id}/handoffs/${input.kind}/${op.id}`,directory=layout.resolve(relative);fs.mkdirSync(directory,{recursive:true});
   const entries=[],shared=new Map<string,{path:string;dependencies:Array<{path:string;hash:string}>}>();
   for(const selection of selections){
    const folder=path.join(directory,`${safeStorageName(selection.item.name,'item')}-${selection.item.id.slice(0,8)}`);
    for(const entry of selection.files){
     const sharedKey=entry.role==='sheet'?`sheet:${entry.candidate.artifactId}`:'',existing=sharedKey?shared.get(sharedKey):undefined;
      if(existing){entries.push({itemId:selection.item.id,itemName:selection.item.name,role:entry.role,artifactId:entry.candidate.artifactId,hash:entry.candidate.hash,path:existing.path,dependencies:existing.dependencies,...entry.role==='sheet'&&selection.sourceLineage?{sourceLineage:selection.sourceLineage}:{}});continue;}
     const artifact=this.store.get('artifact',entry.candidate.artifactId),file=this.store.object(entry.candidate.hash);
     if(!artifact||artifact.data.hash!==entry.candidate.hash||!file||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||fs.realpathSync.native(file)!==path.resolve(file)||hash(file)!==entry.candidate.hash)throw new Error(`Missing or corrupt input for ${selection.item.name}: ${entry.role}.`);
     const roleFolder=path.join(folder,`${safeStorageName(entry.role,'source')}-${artifact.id.slice(0,8)}`);fs.mkdirSync(roleFolder,{recursive:true});
     const main=String(artifact.data.logicalPath||artifact.data.sourceName||artifact.name).replace(/\\/g,'/');
     if(!main||main.startsWith('/')||main.includes(':')||main.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Source logical path is unsafe.');
     const target=path.join(roleFolder,...main.split('/'));layout.resolve(path.relative(this.store.root,target).replace(/\\/g,'/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target,fs.constants.COPYFILE_EXCL);
     const dependencies=[];
      for(const dep of this.store.dependencies(artifact.id).filter((value:any)=>!['provenance','partition-source','foliage-source'].includes(value.role)&&(entry.role==='sheet'||!['mapping','source-image','source-depth'].includes(value.role)))){
      const logical=String(dep.logicalPath).replace(/\\/g,'/');if(!logical||logical.startsWith('/')||logical.includes(':')||logical.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Dependency path is unsafe.');
      const source=this.store.object(dep.hash),dest=path.join(roleFolder,...logical.split('/'));layout.resolve(path.relative(this.store.root,dest).replace(/\\/g,'/'));
      if(!source||!fs.existsSync(source)||fs.realpathSync.native(source)!==path.resolve(source)||hash(source)!==dep.hash)throw new Error(`Missing dependency for ${selection.item.name}: ${logical}`);
      fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.copyFileSync(source,dest,fs.constants.COPYFILE_EXCL);else if(hash(dest)!==dep.hash)throw new Error('Dependency name collision.');dependencies.push({path:path.relative(directory,dest).replace(/\\/g,'/'),hash:dep.hash});
     }
      const logicalPath=path.relative(directory,target).replace(/\\/g,'/');entries.push({itemId:selection.item.id,itemName:selection.item.name,role:entry.role,artifactId:artifact.id,hash:entry.candidate.hash,path:logicalPath,dependencies,...entry.role==='sheet'&&selection.sourceLineage?{sourceLineage:selection.sourceLineage}:{},...entry.role==='geometry'&&selection.partitionLineage?{partitionLineage:selection.partitionLineage,sourceArtifactId:entry.sourceCandidate?.artifactId||artifact.id,sourceHash:entry.sourceCandidate?.hash||entry.candidate.hash,textureExport:entry.textureExport}:{}});if(sharedKey)shared.set(sharedKey,{path:logicalPath,dependencies});
    }
   }
   const receipt={schemaVersion:1,jobId:input.id,operationId:op.id,kind:input.kind,...input.kind==='texture'?{scope:'separated-shared-props-v1'}:{},workflowRevision:input.expectedRevision,entries,waiting},receiptFile=path.join(directory,'handoff.json');fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{flag:'wx'});
   const current=this.store.get('operation',op.id)!;this.store.put({kind:'operation',id:op.id,name:op.name,data:{...current.data,status:'complete',report:{relativePath:relative,receiptHash:hash(receiptFile),entries:entries.length}},expectedRevision:current.revision});
   const job=this.production.get(input.id).job;this.production.update({id:input.id,expectedRevision:job.revision,externalWait:true});return {operationId:op.id,directory,entries,waiting};
  }catch(error){const current=this.store.get('operation',op.id)!;this.store.put({kind:'operation',id:op.id,name:op.name,data:{...current.data,status:'failed',report:{message:error instanceof Error?error.message:String(error)}},expectedRevision:current.revision});throw error;}
  }
  private validateTextureReceipt(operation:any,data:any,ctx:any){
   if(operation.data.parameters?.kind!=='texture')return;
   const scope='separated-shared-props-v1';
   if(operation.data.parameters?.scope!==scope||data.scope!==scope||data.kind!=='texture')throw new Error('This older texture handoff is not a current separated shared-prop handoff.');
   const entries=Array.isArray(data.entries)?data.entries:[],geometryEntries=entries.filter((entry:any)=>entry.role==='geometry'),lineages=geometryEntries.map((entry:any)=>({itemId:entry.itemId,...entry.partitionLineage}));
   if(JSON.stringify(lineages)!==JSON.stringify(operation.data.parameters.partitionLineages||[]))throw new Error('Texture handoff partition lineage does not match its operation.');
   const textureExports=geometryEntries.map((entry:any)=>({itemId:entry.itemId,...entry.textureExport}));
   if(JSON.stringify(textureExports)!==JSON.stringify(operation.data.parameters.textureExports||[]))throw new Error('Texture handoff single-mesh export proof does not match its operation.');
   const groups=new Map<string,{geometry:boolean;frontColor:boolean}>();
   for(const entry of entries){
    const item=ctx.items.find((value:any)=>value.id===entry.itemId),current=ctx.current.find((value:any)=>value.itemId===entry.itemId);
    if(!item||item.data.route!=='shared-prop'||!current)throw new Error('Texture handoff contains an item outside the shared-prop catalog.');
    let group=groups.get(item.id);if(!group){group={geometry:false,frontColor:false};groups.set(item.id,group);}
    if(entry.role==='geometry'){
     const partition=currentAcceptedSharedPartition(this.store,ctx.workflow,item,current),candidate=current.geometry;
     if(!partition||!candidate||entry.sourceArtifactId!==candidate.artifactId||entry.sourceHash!==candidate.hash||JSON.stringify(entry.partitionLineage)!==JSON.stringify(partition))throw new Error('Texture handoff model is not a current accepted partition of the accepted shared sheet.');
     const proof=entry.textureExport;
     if(!proof||proof.sourceArtifactId!==candidate.artifactId||proof.sourceHash!==candidate.hash||proof.outputArtifactId!==entry.artifactId||proof.outputHash!==entry.hash||proof.meshObjectCount!==1)throw new Error('Texture handoff geometry lacks a verified single-mesh export.');
     if(proof.operationId===null){
      if(partition.meshObjectCount!==1||proof.sourceMeshObjectCount!==1||entry.artifactId!==candidate.artifactId||entry.hash!==candidate.hash||proof.reportArtifactId!==null||proof.reportHash!==null)throw new Error('Texture handoff source is not proven to be a single-mesh partition.');
     }else{
      if(!Number.isInteger(proof.sourceMeshObjectCount)||proof.sourceMeshObjectCount<1||partition.meshObjectCount!==null&&partition.meshObjectCount!==proof.sourceMeshObjectCount)throw new Error('Texture export derivative source does not match its accepted partition report.');
      const derivative=this.store.get('artifact',String(proof.outputArtifactId)),reportArtifact=this.store.get('artifact',String(proof.reportArtifactId)),exportOperation=this.store.get('operation',String(proof.operationId));
      if(!derivative||!reportArtifact||!exportOperation||derivative.data.hash!==proof.outputHash||derivative.data.parentId!==item.id||derivative.data.versionOf!==candidate.artifactId||derivative.data.sourceInputHash!==candidate.hash||derivative.data.operationId!==proof.operationId||ownerForArtifact(this.store,derivative)?.id!==ctx.job.id||reportArtifact.data.hash!==proof.reportHash||reportArtifact.data.parentId!==item.id||exportOperation.data.assetJobId!==ctx.job.id||exportOperation.data.assetId!==candidate.artifactId||exportOperation.data.parameters?.mode!=='texture-export'||exportOperation.data.parameters?.itemId!==item.id||exportOperation.data.modelProcessingIdentity?.recipe?.id!=='asset-shared-prop-single-mesh'||exportOperation.data.modelProcessingIdentity?.owner?.id!==ctx.job.id||exportOperation.data.modelProcessingIdentity?.scope!==item.id||exportOperation.data.report?.outputArtifactId!==derivative.id||exportOperation.data.report?.reportArtifactId!==reportArtifact.id)throw new Error('Texture export derivative provenance is incomplete or stale.');
      const derivativeDependencies=this.store.dependencies(derivative.id);
      if(!derivativeDependencies.some((value:any)=>value.hash===candidate.hash&&value.logicalPath==='source-model.fbx'&&value.role==='provenance')||!derivativeDependencies.some((value:any)=>value.hash===reportArtifact.data.hash&&value.logicalPath==='texture-export-report.json'&&value.role==='provenance'))throw new Error('Texture export derivative is missing its source/report provenance.');
      const reportFile=this.store.object(reportArtifact.data.hash);
      if(!reportFile||!fs.existsSync(reportFile)||fs.lstatSync(reportFile).isSymbolicLink()||fs.realpathSync.native(reportFile)!==path.resolve(reportFile)||hash(reportFile)!==reportArtifact.data.hash||fs.statSync(reportFile).size>4*1024*1024)throw new Error('Texture export derivative report is missing or corrupt.');
      const exportReport=JSON.parse(fs.readFileSync(reportFile,'utf8')),output=exportReport.outputs?.find((row:any)=>row.format==='fbx'&&row.hash===proof.outputHash);
      if(exportReport.mode!=='texture-export'||exportReport.ok!==true||exportReport.sourceHash!==candidate.hash||!output||output.group!==item.id||output.meshObjectCount!==1)throw new Error('Texture export derivative report does not prove one mesh from the current accepted source.');
     }
     group.geometry=true;
     continue;
    }
    if(!/^image:(front|side|back|top)$/.test(String(entry.role)))throw new Error('Texture handoff contains a non-color input.');
    const candidate=current.images.find((value:any)=>value.role===entry.role)?.candidate,roles=entry.role==='image:front'?['image:front','image']:[entry.role];
    if(current.imagesNeedReview||!candidate||!current.imageInputFingerprints.includes(candidate.inputFingerprint)||!acceptedHumanCandidate(ctx.workflow,item.id,roles,candidate)||entry.artifactId!==candidate.artifactId||entry.hash!==candidate.hash)throw new Error('Texture handoff color reference is not current and human-accepted.');
    if(entry.role==='image:front')group.frontColor=true;
   }
   if(!groups.size||[...groups.values()].some(group=>!group.geometry||!group.frontColor))throw new Error('Every texture handoff item needs its current partitioned model and original front color reference.');
   for(const row of data.waiting||[]){const item=ctx.items.find((value:any)=>value.id===row.itemId);if(!item||item.data.route!=='shared-prop'||groups.has(item.id))throw new Error('Texture handoff waiting list is outside the current shared-prop scope.');}
  }
  read(jobId:string,operationId:string){const op=this.store.get('operation',operationId);if(!op||op.data.assetJobId!==jobId||op.data.status!=='complete'||op.data.parameters?.mode!=='handoff')throw new Error('Handoff receipt does not belong to this job.');const relative=String(op.data.report?.relativePath||'');if(relative!==`work/assets/${jobId}/handoffs/${op.data.parameters.kind}/${operationId}`)throw new Error('Handoff location is invalid.');const layout=workspaceLayout(this.store.root),dir=layout.resolve(relative),receipt=path.join(dir,'handoff.json');layout.resolve(`${relative}/handoff.json`);if(!fs.existsSync(receipt)||hash(receipt)!==op.data.report.receiptHash)throw new Error('Handoff receipt is missing or changed.');const data=JSON.parse(fs.readFileSync(receipt,'utf8')),ctx=this.production.get(jobId),checkedMaps=new Set<string>();
this.validateTextureReceipt(op,data,ctx);if(Array.isArray(op.data.parameters?.sourceLineages)){const receiptLineages=(data.entries||[]).filter((entry:any)=>entry.role==='sheet'&&entry.sourceLineage).map((entry:any)=>({itemId:entry.itemId,...entry.sourceLineage}));if(JSON.stringify(receiptLineages)!==JSON.stringify(op.data.parameters.sourceLineages))throw new Error('Handoff operation lineage does not match its receipt.');}for(const entry of data.entries||[]){for(const part of [{path:entry.path,hash:entry.hash},...(entry.dependencies||[])]){const name=String(part.path||'');if(name.includes('\\')||name.startsWith('/')||name.split('/').some((x:string)=>!x||x==='.'||x==='..'))throw new Error('Handoff contains an unsafe file path.');const target=layout.resolve(`${relative}/${name}`);if(!fs.existsSync(target)||hash(target)!==part.hash)throw new Error('Handoff contents are missing or changed.');}if(entry.role!=='sheet'||!entry.sourceLineage)continue;const lineage=entry.sourceLineage,state=ctx.current.find((value:any)=>value.itemId===entry.itemId),source=state?.sharedSheetSource,acceptedSheet=state?.sheets?.find((value:any)=>value.artifactId===lineage.sheetArtifactId&&value.hash===lineage.sheetHash&&value.fresh===true&&value.accepted===true&&value.candidate?.status==='accepted');if(!state)throw new Error('Handoff shared sheet owner is missing.');const expectedSource=source?.state==='ready'?{itemId:source.itemId,role:source.role,...source.sourceSlotRole?{sourceSlotRole:source.sourceSlotRole}:{},sourceType:source.sourceType,sourceArtifactId:source.sourceArtifactId,sourceHash:source.sourceHash,sourceInputFingerprint:source.sourceInputFingerprint,...source.pairedColorHash?{pairedColorHash:source.pairedColorHash}:{}}:null;if(!acceptedSheet||lineage.sheetInputFingerprint!==state.sharedSheetInputFingerprint||JSON.stringify(lineage.source)!==JSON.stringify(expectedSource)||entry.artifactId!==lineage.sheetArtifactId||entry.hash!==lineage.sheetHash)throw new Error('Handoff shared sheet lineage is stale or incomplete.');const mapPart=(entry.dependencies||[]).find((value:any)=>String(value.path).endsWith('/sheet-map.json'));if(!mapPart)throw new Error('Handoff is missing its shared sheet map.');const mapKey=`${entry.artifactId}:${entry.hash}`;if(checkedMaps.has(mapKey))continue;const mapPath=layout.resolve(`${relative}/${mapPart.path}`),manifest=JSON.parse(fs.readFileSync(mapPath,'utf8')),sharedItems=ctx.items.filter((item:any)=>item.data.route==='shared-prop'),tiles=manifest.tiles;if(manifest.schemaVersion!==2||manifest.outputHash!==entry.hash||manifest.sourceFingerprint!==state.sharedSheetInputFingerprint||!Array.isArray(tiles)||tiles.length!==sharedItems.length)throw new Error('Handoff shared sheet map does not match current sources.');for(const item of sharedItems){const current=ctx.current.find((value:any)=>value.itemId===item.id),selected=current?.sharedSheetSource,tile=tiles.find((value:any)=>value.itemId===item.id);if(!selected||selected.state!=='ready'||!tile||tile.sourceRole!==selected.role||tile.sourceType!==selected.sourceType||tile.sourceArtifactId!==selected.sourceArtifactId||tile.sourceHash!==selected.sourceHash||tile.sourceInputFingerprint!==selected.sourceInputFingerprint||(tile.sourceSlotRole||undefined)!==selected.sourceSlotRole||(selected.sourceType==='depth'?tile.pairedColorHash!==selected.pairedColorHash:tile.pairedColorHash!==null))throw new Error('Handoff tile source lineage does not match the current accepted input.');}checkedMaps.add(mapKey);}return {directory:dir,receipt:data};}
}
