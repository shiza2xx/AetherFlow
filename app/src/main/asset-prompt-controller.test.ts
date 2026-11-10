import {describe,expect,it} from 'vitest';
import {prepareAssetPromptResponse,prepareAssetPromptSend} from './asset-prompt-controller';
import {RpcSchema} from '../shared/contracts';

const state=()=>({
 job:{id:'job-current',revision:11,name:'Workshop chair',data:{mode:'composite',target:'Oak chair',sourceArtifactId:'source-1',catalogStatus:'accepted'}} as any,
 items:[{id:'seat-current',name:'Seat',data:{route:'module',views:['front','side'],depthEnabled:false,dimensions:[1,1,1]}},{id:'leg-other',name:'Leg',data:{route:'module',views:['front'],depthEnabled:false,dimensions:[1,2,1]}}] as any,
 workflow:{id:'workflow-current',revision:23,data:{slots:[{itemId:'seat-current',role:'image:front',acceptedCandidateId:'front-candidate',candidates:[{id:'front-candidate',artifactId:'front-artifact',hash:'front-hash',status:'accepted'}]}],instances:[{id:'instance-current',masterItemId:'seat-current',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}],sceneCandidates:[]}} as any,
});

describe('asset prompt controller',()=>{
 it('accepts and preserves an unscoped whole-assembly correction through both RPC contracts',()=>{
  const issue='Move the rear beam away from the roof.\nKeep `accepted` candidates exactly as they are.';
  const selection={stage:'assembly' as const,intent:'correct-assembly' as const,userIssue:issue};
  const preview=RpcSchema.parse({op:'asset-production:prompt',id:'00000000-0000-4000-8000-000000000001',selection});
  const send=RpcSchema.parse({op:'asset-production:send-prompt',workspace:'D:/qa/workspace',workspaceInstanceId:'00000000-0000-4000-8000-000000000002',id:'00000000-0000-4000-8000-000000000001',selection,expectedJobRevision:7,expectedWorkflowRevision:9,terminalId:'00000000-0000-4000-8000-000000000003',confirmedIdle:true});
  expect((preview as any).selection).toEqual(selection);
  expect((send as any).selection).toEqual(selection);
  expect(()=>RpcSchema.parse({op:'asset-production:prompt',id:'00000000-0000-4000-8000-000000000001',selection:{...selection,userIssue:'x'.repeat(4001)}})).toThrow();
 });

 it('prepares the exact current job, item, role and locale selection',()=>{
  const context=state(),selection={stage:'images' as const,itemId:'seat-current',role:'image:front'},prepared=prepareAssetPromptResponse(context,selection,'ru');
  expect(prepared).toMatchObject({jobId:'job-current',jobRevision:11,workflowRevision:23,selection:{stage:'images',itemId:'seat-current',role:'image:front',locale:'ru'}});
  expect(prepared.markdown).toMatch(/Только выбранная деталь/i);
  expect(prepared.markdown).toContain('Seat');
  expect(prepared.markdown).toContain('image:front');
  expect(prepared.markdown).not.toContain('Leg');
  const terminal={id:'terminal-current',status:'running',assetJobId:'job-current'};
  expect(prepareAssetPromptSend(context,terminal,{id:'job-current',terminalId:'terminal-current',expectedJobRevision:11,expectedWorkflowRevision:23,confirmedIdle:true,selection},'ru')).toBe(prepared.markdown);
 });

 it('rejects stale job and workflow revisions before producing terminal text',()=>{
  const context=state(),terminal={id:'terminal-current',status:'running',assetJobId:'job-current'},base={id:'job-current',terminalId:'terminal-current',expectedJobRevision:11,expectedWorkflowRevision:23,confirmedIdle:true,selection:{stage:'images' as const,itemId:'seat-current',role:'image:front'}};
  expect(()=>prepareAssetPromptSend(context,terminal,{...base,expectedJobRevision:10},'en')).toThrow(/state changed|refresh/i);
  expect(()=>prepareAssetPromptSend(context,terminal,{...base,expectedWorkflowRevision:22},'en')).toThrow(/state changed|refresh/i);
 });

 it('uses the same current full-list prompt for preview and terminal send with revision and owner guards',()=>{
  const current=state(),terminal={id:'terminal-current',status:'running',assetJobId:'job-current'},selection={stage:'images' as const,intent:'generate-entire-list' as const};
  current.job.data.catalogStatus='pending';current.job.data.catalogPreviouslyAccepted=true;
  const preview=prepareAssetPromptResponse(current,selection,'en');
  const sent=prepareAssetPromptSend(current,terminal,{id:'job-current',terminalId:'terminal-current',expectedJobRevision:11,expectedWorkflowRevision:23,confirmedIdle:true,selection},'en');
  expect(sent).toBe(preview.markdown);
  expect(sent).toContain('seat-current');expect(sent).toContain('leg-other');expect(sent).toContain('catalogProposalPending');
  expect(()=>prepareAssetPromptSend(current,terminal,{id:'job-current',terminalId:'terminal-current',expectedJobRevision:10,expectedWorkflowRevision:23,confirmedIdle:true,selection},'en')).toThrow(/state changed|refresh/i);
  expect(()=>prepareAssetPromptSend(current,{...terminal,assetJobId:'foreign-job'},{id:'job-current',terminalId:'terminal-current',expectedJobRevision:11,expectedWorkflowRevision:23,confirmedIdle:true,selection},'en')).toThrow(/another owner/i);
 });

 it('keeps a whole-scene correction issue verbatim in preview and the existing job-scoped send path',()=>{
  const current=state(),terminal={id:'terminal-current',status:'running',assetJobId:'job-current'};
  const issue='The upper beam clips into the roof.\nDo not change any accepted master.';
  current.job.data.selectedSceneCandidateId='scene-current';
  current.workflow.data.sceneAcceptedCandidateId='scene-current';
  current.workflow.data.sceneCandidates=[{id:'scene-current',status:'accepted',artifactId:'scene-artifact',hash:'scene-hash',dependencyFingerprint:'current'}] as any;
  const selection={stage:'assembly' as const,intent:'correct-assembly' as const,userIssue:issue};
  const preview=prepareAssetPromptResponse(current,selection,'en');
  const sent=prepareAssetPromptSend(current,terminal,{id:'job-current',terminalId:'terminal-current',expectedJobRevision:11,expectedWorkflowRevision:23,confirmedIdle:true,selection},'en');
  expect(preview.selection).toMatchObject({stage:'assembly',intent:'correct-assembly',userIssue:issue,locale:'en'});
  expect(preview.markdown).toContain(issue);
  expect(sent).toBe(preview.markdown);
  expect(sent).toContain('scene-artifact');
  expect(()=>prepareAssetPromptSend(current,terminal,{id:'job-current',terminalId:'terminal-current',expectedJobRevision:10,expectedWorkflowRevision:23,confirmedIdle:true,selection},'en')).toThrow(/state changed/i);
 });

 it('uses the same job-owned executable depth batch for preview and terminal send',()=>{
  const current=state(),terminal={id:'terminal-current',status:'running',assetJobId:'job-current'},inputFingerprint='current-image-fingerprint';
  current.items=[{id:'seat-current',name:'Seat',data:{jobId:'job-current',route:'module',views:['front','side'],depthEnabled:true}}] as any;
  current.workflow.data={...current.workflow.data,assetJobId:'job-current',depthEnabled:true,slots:[
   {itemId:'seat-current',role:'image:front',acceptedCandidateId:'front-current',candidates:[{id:'front-current',artifactId:'front-artifact',hash:'front-color-hash',inputFingerprint,status:'accepted'}]},
   {itemId:'seat-current',role:'image:side',candidates:[{id:'side-pending',artifactId:'side-pending-artifact',hash:'side-pending-hash',inputFingerprint,status:'pending'}]},
  ]};
  (current as any).current=[{itemId:'seat-current',imageInputFingerprints:[inputFingerprint],sheets:[]}];
  const selection={stage:'images' as const,intent:'generate-depth-list' as const},preview=prepareAssetPromptResponse(current,selection,'en'),sent=prepareAssetPromptSend(current,terminal,{id:'job-current',terminalId:'terminal-current',expectedJobRevision:11,expectedWorkflowRevision:23,confirmedIdle:true,selection},'en');
  expect(sent).toBe(preview.markdown);expect(sent).toContain('front-artifact');expect(sent).toContain('depth:front');expect(sent).toContain('depth:side');expect(sent).toContain('color-pending');
  expect(()=>prepareAssetPromptSend(current,{...terminal,assetJobId:'another-job'},{id:'job-current',terminalId:'terminal-current',expectedJobRevision:11,expectedWorkflowRevision:23,confirmedIdle:true,selection},'en')).toThrow(/another owner/i);
  expect(()=>prepareAssetPromptSend(current,terminal,{id:'job-current',terminalId:'terminal-current',expectedJobRevision:10,expectedWorkflowRevision:23,confirmedIdle:true,selection},'en')).toThrow(/state changed/i);
 });

 it('keeps large full-catalog preview and send identical with compact complete MCP paging in both locales',()=>{
   const current=state(),terminal={id:'terminal-current',status:'running',assetJobId:'job-current'};current.job.revision=44;current.job.id='large-job-owner';current.workflow.id='large-workflow-owner';current.workflow.revision=82;current.workflow.data.depthEnabled=true;terminal.assetJobId='large-job-owner';current.items=Array.from({length:1000},(_,index)=>{const route=index%5===0?'shared-prop':index%7===0?'foliage':'module';return {id:`large-item-${String(index).padStart(4,'0')}`,name:`Catalog master ${index}`.padEnd(90,'x'),data:{route,views:route==='foliage'?['front','back','side','top']:index%3===0?['front','side']:['front'],depthEnabled:route!=='foliage'&&route!=='shared-prop',sourceArtifactIds:['source-asset-1']}} as any});current.workflow.data.slots=current.items.map((item:any,index:number)=>({itemId:item.id,role:'image:front',candidates:Array.from({length:24},(_,history)=>({id:`history-${index}-${history}`,artifactId:`old-${index}-${history}`,hash:'old-hash',status:'rejected'}))}));
  const selection={stage:'images' as const,intent:'generate-entire-list' as const};for(const locale of ['en','ru'] as const){const preview=prepareAssetPromptResponse(current,selection,locale),sent=prepareAssetPromptSend(current,terminal,{id:'large-job-owner',terminalId:'terminal-current',expectedJobRevision:44,expectedWorkflowRevision:82,confirmedIdle:true,selection},locale);expect(sent).toBe(preview.markdown);expect(Buffer.byteLength(sent,'utf8')).toBeLessThan(500*1024);expect(sent).toContain('large-job-owner');expect(sent).toContain('large-workflow-owner');expect(sent).toContain('asset_job_get');expect(sent).toContain('offset:0,limit:3');expect(sent).toContain('limit:10');expect(sent).toContain('nextSharedSourceOffset');expect(sent).not.toContain('history-0-0');expect(sent).toMatch(/every page|все страницы/i);}
 });

 it('rejects a selected item from another job and terminal ownership mismatch',()=>{
  const context=state(),terminal={id:'terminal-current',status:'running',assetJobId:'job-current'};
  expect(()=>prepareAssetPromptResponse(context,{stage:'images',itemId:'foreign-item',role:'image:front'},'en')).toThrow(/not part of this asset job/i);
  expect(()=>prepareAssetPromptSend(context,{...terminal,assetJobId:'another-job'},{id:'job-current',terminalId:'terminal-current',expectedJobRevision:11,expectedWorkflowRevision:23,confirmedIdle:true,selection:{stage:'images',itemId:'seat-current',role:'image:front'}},'en')).toThrow(/another owner/i);
 });

 it('blocks MCP image requests for empty composites while preserving prop-set and Stage 5 repair',()=>{
  const empty=state();empty.workflow.data.instances=[];
  for(const locale of ['en','ru'] as const)expect(()=>prepareAssetPromptResponse(empty,{stage:'images',itemId:'seat-current',role:'image:front'},locale)).toThrow(/composite placements are missing/i);
  const prop=state();prop.job.data.mode='prop-set';prop.workflow.data.instances=[];
  expect(prepareAssetPromptResponse(prop,{stage:'images',itemId:'seat-current',role:'image:front'},'en').markdown).toContain('image:front');
  const recovery=prepareAssetPromptResponse(empty,{stage:'assembly',intent:'repair-instances'},'en').markdown;
  expect(recovery).toMatch(/without regenerating accepted assets/i);expect(recovery).toContain('asset_job_catalog_submit');
 });
});
