import {z} from 'zod';

const Id=z.string().uuid();
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const AssetStageValues=['source','composition','images','geometry','assembly'] as const;
export const AssetStageSchema=z.enum(AssetStageValues);
export const assetStages=[...AssetStageValues];
/** The retired stage remains an input alias only for saved data and older MCP callers. */
export function normalizeAssetStage(value:unknown):unknown{return value==='materials'?'geometry':value;}
export const ImageGenerationModeSchema=z.enum(['codex','manual']);
export type ImageGenerationMode=z.infer<typeof ImageGenerationModeSchema>;
export const AssetRouteSchema=z.enum(['module','shared-prop','foliage']);
export const AssetViewTypeSchema=z.enum(['wall','window','roof','other']);
export const AssetStandardViews=['front','side'] as const;
export const AssetFoliageViews=['front','back','side','top'] as const;
export function assetViewsForRoute(route:string,views:unknown,viewType?:string):string[]{const selected=Array.isArray(views)?views.filter((view):view is string=>typeof view==='string'):[];if(route==='foliage')return [...AssetFoliageViews];if(route==='module'&&(viewType==='wall'||viewType==='window'))return ['front','side'];return selected.length?selected:['front'];}
export function unsupportedAssetViews(route:string,views:unknown):string[]{const allowed=route==='foliage'?AssetFoliageViews:AssetStandardViews,selected=Array.isArray(views)?views.filter((view):view is string=>typeof view==='string'):[];return [...new Set(selected.filter(view=>!(allowed as readonly string[]).includes(view)))];}
export function assetViewRoleError(route:string,views:unknown,depthEnabled:boolean,role:string,viewType?:string):string|undefined{
 const required=assetViewsForRoute(route,views,viewType),invalid=unsupportedAssetViews(route,views);
 if(invalid.length)return `This legacy catalog requires unsupported view${invalid.length===1?'':'s'} ${invalid.join(', ')}. Update the catalog to front and optional side views; existing candidates remain in history.`;
 if(role==='sheet')return route==='shared-prop'?undefined:'Only a shared-prop item can submit a multi-object sheet.';
 if(role==='depth:sheet')return 'Legacy depth sheets are kept for history. Put the selected current front inputs on the main shared geometry sheet.';
 if(route==='foliage'){
  if(/^foliage:(front|back|side|top)$/.test(role)||role==='foliage:atlas')return undefined;
  if(role==='image'||role.startsWith('image:')||role==='depth'||role.startsWith('depth:'))return 'Foliage images use four separate foliage:front, foliage:back, foliage:side and foliage:top views; do not submit a combined image.';
  return undefined;
 }
 const match=role.match(/^(image|depth)(?::([a-z0-9][a-z0-9-]{0,63}))?$/);if(!match)return undefined;
 const [,kind,requested]=match;
 if(kind==='depth'&&(route==='foliage'||!depthEnabled))return 'Depth views apply only to non-foliage items with AI depth enabled.';
 // The pre-view-list `image`/`depth` roles remain front aliases after a catalog
 // gains a side view. Explicit roles remain available for every view.
 const view=requested||(required.includes('front')?'front':required[0]);
 if(!(AssetStandardViews as readonly string[]).includes(view))return `Unsupported standard asset view ${view}. Use strict front or optional side only; three-quarter, back and multi-view images are not supported.`;
 if(!required.includes(view))return `View ${view} is not required by this catalog item.`;
 return undefined;
}
export const AssetTransformSchema=z.object({position:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),rotation:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),scale:z.tuple([z.number().finite().positive(),z.number().finite().positive(),z.number().finite().positive()])}).strict();
export const AssetPlacementConfidenceSchema=z.enum(['source-supported','inferred','uncertain']);
export const AssetInstanceSchema=z.object({id:Id,masterItemId:Id,transform:AssetTransformSchema,placementConfidence:AssetPlacementConfidenceSchema.optional(),placementEvidence:z.string().trim().min(1).max(1000).optional()}).strict().superRefine((instance,ctx)=>{if(instance.placementConfidence&&!instance.placementEvidence)ctx.addIssue({code:z.ZodIssueCode.custom,path:['placementEvidence'],message:'A placement confidence requires supporting evidence.'});});
/** Composite image generation requires a current, accepted, non-empty placement list. Prop sets remain placement-free. */
export function assetHasActivePlacementPlan(jobValue:any,workflowValue:any):boolean{
 const job=jobValue?.data||jobValue||{},workflow=workflowValue?.data||workflowValue||{};
 if(job.mode!=='composite')return true;
 const catalogActive=!job.catalogRequiresRevalidation&&(job.catalogStatus==='accepted'||job.catalogStatus==='pending'&&job.catalogPreviouslyAccepted===true);
 return catalogActive&&Array.isArray(workflow.instances)&&workflow.instances.length>0;
}
/** True for an accepted empty composite or an empty pending composite proposal. */
export function assetCompositePlacementPlanNeedsWork(jobValue:any,workflowValue:any):boolean{
 const job=jobValue?.data||jobValue||{},workflow=workflowValue?.data||workflowValue||{};
 if(job.mode!=='composite')return false;
 if(job.catalogStatus==='pending'&&workflow.catalogProposal)return !Array.isArray(workflow.catalogProposal.instances)||workflow.catalogProposal.instances.length===0;
 return job.catalogStatus==='accepted'&&!job.catalogRequiresRevalidation&&(!Array.isArray(workflow.instances)||workflow.instances.length===0);
}
export function assetImageGenerationPlacementError(jobValue:any,workflowValue:any):string|undefined{
 const job=jobValue?.data||jobValue||{},workflow=workflowValue?.data||workflowValue||{};
 return job.mode==='composite'&&!assetHasActivePlacementPlan(job,workflow)
  ?'Composite placements are missing. Prepare and accept a non-empty placement proposal before generating or submitting image candidates. Existing accepted outputs remain available for review and Stage 5 repair.'
  :undefined;
}
export function assertAssetImageOutputsHavePlacementPlan(jobValue:any,workflowValue:any,outputs:any[]):void{
 const includesImageOutput=outputs.some(output=>typeof output?.role==='string'&&(output.role==='image'||output.role.startsWith('image:')||output.role==='depth'||output.role.startsWith('depth:')||output.role.startsWith('foliage:')||output.role==='sheet'));
 const error=includesImageOutput&&assetImageGenerationPlacementError(jobValue,workflowValue);
 if(error)throw new Error(error);
}
/** Placement notes describe confidence only; assembly dependencies use identity and transform. */
export function assetInstanceGeometrySnapshot(instances:readonly {id:string;masterItemId:string;transform:unknown}[]){return instances.map(({id,masterItemId,transform})=>({id,masterItemId,transform}));}
const SessionScopeSchema=z.object({host:z.string().min(1).max(1024),profile:z.string().min(1).max(4096),cwd:z.string().min(1).max(4096)}).strict();
const SessionBindingSchema=z.object({sessionId:Id,scope:SessionScopeSchema,verifiedAt:z.string().min(1).max(100)}).strict();
const SessionPendingSchema=z.object({startedAtMs:z.number().finite(),deadlineMs:z.number().finite(),baselineIds:z.array(Id).max(10000),scope:SessionScopeSchema}).strict();
const AssetSessionSchema=z.object({history:z.array(SessionBindingSchema).max(10000),current:SessionBindingSchema.optional(),pendingLaunch:SessionPendingSchema.optional(),launchHistory:z.array(z.object({pending:SessionPendingSchema,finishedAt:z.string().min(1).max(100),reason:z.string().min(1).max(200)}).strict()).max(10000).optional()}).strict();
const AssetJobDataBaseSchema=z.object({schemaVersion:z.literal(1),workflowId:Id,codexSession:AssetSessionSchema.optional(),workbenchSelections:z.record(Id,z.object({role:z.enum(['geometry','material']),artifactId:Id}).strict()).optional(),mode:z.enum(['composite','prop-set']),imageGenerationMode:ImageGenerationModeSchema.default('codex'),target:z.string().trim().min(1).max(4000),projectId:Id.optional(),sourceArtifactId:Id.optional(),sourceCrop:z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()}).strict().optional(),dimensions:z.string().max(500).optional(),inclusions:z.array(z.string().max(500)).max(256).default([]),exclusions:z.array(z.string().max(500)).max(256).default([]),stage:AssetStageSchema.default('source'),selectedItemId:Id.optional(),selectedRole:z.string().trim().min(1).max(100).optional(),selectedCandidateId:Id.optional(),selectedCandidateExplicit:z.boolean().optional(),selectedInstanceId:Id.optional(),selectedSceneCandidateId:Id.optional(),externalWait:z.boolean().default(false),catalogStatus:z.enum(['idle','pending','accepted']).default('idle'),catalogRequiresRevalidation:z.boolean().default(false),catalogPreviouslyAccepted:z.boolean().default(false),deletedAt:z.string().datetime().optional(),deletedWorkspace:z.string().min(1).optional()}).strict().superRefine((job,ctx)=>{if(job.catalogRequiresRevalidation&&(job.catalogStatus==='accepted'||job.catalogPreviouslyAccepted))ctx.addIssue({code:z.ZodIssueCode.custom,message:'A catalog requiring revalidation cannot be active.'});if(job.catalogPreviouslyAccepted&&job.catalogStatus!=='pending')ctx.addIssue({code:z.ZodIssueCode.custom,message:'Prior catalog acceptance applies only during a pending proposal.'});if(job.selectedCandidateExplicit===true&&!job.selectedCandidateId)ctx.addIssue({code:z.ZodIssueCode.custom,message:'An explicit candidate selection requires a candidate id.'});if(Boolean(job.deletedAt)!==Boolean(job.deletedWorkspace))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Deleted asset projects require both their timestamp and workspace.'});});
export const AssetJobDataSchema=z.preprocess(value=>value&&typeof value==='object'&&!Array.isArray(value)?{...(value as Record<string,unknown>),stage:normalizeAssetStage((value as Record<string,unknown>).stage)}:value,AssetJobDataBaseSchema);
export const AssetItemDataSchema=z.object({schemaVersion:z.literal(1),jobId:Id,route:AssetRouteSchema,dimensions:z.tuple([z.number().finite().positive(),z.number().finite().positive(),z.number().finite().positive()]).optional(),views:z.array(z.string().trim().min(1).max(80)).max(32).default([]),viewType:AssetViewTypeSchema.optional(),depthEnabled:z.boolean().default(false),sourceArtifactIds:z.array(Id).max(64).default([])}).strict().superRefine((item,ctx)=>{if(item.route==='foliage'&&item.depthEnabled)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Foliage card textures do not use depth maps.'});if(item.viewType&&item.route!=='module')ctx.addIssue({code:z.ZodIssueCode.custom,message:'Building view types apply only to module items.'});});
export const AssetCandidateSchema=z.object({id:Id,artifactId:Id,hash:Hash,submittedAt:z.string().min(1),submittedBy:z.enum(['ui','mcp']),status:z.enum(['pending','accepted','rejected']),reviewedAt:z.string().optional(),reviewedBy:z.literal('human').optional(),warnings:z.array(z.string().max(2000)).max(100).default([]),dependsOnGeometryHash:Hash.optional(),dependsOnSheetHash:Hash.optional(),dependsOnColorHash:Hash.optional(),dependencyFingerprint:Hash.optional(),inputFingerprint:Hash.optional(),manualPromptLineageHash:Hash.optional(),manualPromptSavedAt:z.string().min(1).optional(),manualImageContextLineageHash:Hash.optional()}).strict().superRefine((candidate,ctx)=>{if(candidate.status==='pending'&&(candidate.reviewedAt||candidate.reviewedBy))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Pending candidates cannot have a review.'});if(candidate.status!=='pending'&&(!candidate.reviewedAt||candidate.reviewedBy!=='human'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'A reviewed candidate requires human review metadata.'});if(candidate.manualPromptLineageHash&&!candidate.manualPromptSavedAt)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Manual prompt provenance requires a save timestamp.'});});
export const AssetSlotSchema=z.object({itemId:Id,role:z.string().trim().min(1).max(100),candidates:z.array(AssetCandidateSchema).max(1000),acceptedCandidateId:Id.optional()}).strict().superRefine((slot,ctx)=>{const ids=new Set(slot.candidates.map(candidate=>candidate.id));if(ids.size!==slot.candidates.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Candidate IDs must be unique.'});if(slot.acceptedCandidateId&&!slot.candidates.some(candidate=>candidate.id===slot.acceptedCandidateId&&candidate.status==='accepted'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Current candidate must be accepted.'});});
export type AssetSlot=z.infer<typeof AssetSlotSchema>;
export type AssetCandidate=z.infer<typeof AssetCandidateSchema>;
/** Submission can only create a pending candidate; review is a distinct human action. */
export function submitAssetCandidate(slot:AssetSlot,input:{id:string;artifactId:string;hash:string;submittedAt:string;submittedBy:'ui'|'mcp';warnings?:string[];inputFingerprint?:string;dependsOnGeometryHash?:string;dependsOnSheetHash?:string;dependsOnColorHash?:string;dependencyFingerprint?:string;manualPromptLineageHash?:string;manualPromptSavedAt?:string;manualImageContextLineageHash?:string}):AssetSlot{
 const current=AssetSlotSchema.parse(slot);
 if(current.candidates.some(candidate=>candidate.id===input.id))throw new Error('Candidate ID already exists.');
 const candidate=AssetCandidateSchema.parse({...input,status:'pending'});
 return AssetSlotSchema.parse({...current,candidates:[...current.candidates,candidate]});
}
/** Only the caller's dedicated human review endpoint should invoke this function. */
export function reviewAssetCandidate(slot:AssetSlot,candidateId:string,decision:'accept'|'reject',reviewedAt:string):AssetSlot{
 const current=AssetSlotSchema.parse(slot),candidate=current.candidates.find(value=>value.id===candidateId);
 if(!candidate||candidate.status!=='pending')throw new Error('Candidate is missing or no longer pending.');
 const candidates=current.candidates.map(value=>value.id===candidateId?{...value,status:decision==='accept'?'accepted':'rejected',reviewedBy:'human',reviewedAt}:value);
 return AssetSlotSchema.parse({...current,candidates,acceptedCandidateId:decision==='accept'?candidateId:current.acceptedCandidateId});
}

export const AssetFaceIdSchema=z.object({componentId:z.string().regex(/^[a-f0-9]{24}$/),faceIndex:z.number().int().nonnegative()}).strict();
export type AssetFaceId=z.infer<typeof AssetFaceIdSchema>;
/** Check the partition against the complete source inventory before creating output meshes. */
export function validateAssetFacePartition(source:AssetFaceId[],groups:Array<{itemId:string;faces:AssetFaceId[]}>){
 const sourceKeys=new Set<string>();
 const key=(face:AssetFaceId)=>`${face.componentId}:${face.faceIndex}`;
 for(const face of source){const parsed=AssetFaceIdSchema.parse(face),id=key(parsed);if(sourceKeys.has(id))throw new Error(`Duplicate source face ${id}.`);sourceKeys.add(id);}
 if(!sourceKeys.size)throw new Error('Source inventory is empty.');
 const seen=new Set<string>(),items=new Set<string>();
 for(const group of groups){Id.parse(group.itemId);if(items.has(group.itemId))throw new Error('Duplicate item group.');items.add(group.itemId);if(!group.faces.length)throw new Error('Item group is empty.');
  for(const face of group.faces){const id=key(AssetFaceIdSchema.parse(face));if(!sourceKeys.has(id))throw new Error(`Unknown source face ${id}.`);if(seen.has(id))throw new Error(`Face assigned more than once: ${id}.`);seen.add(id);}
 }
 if(seen.size!==sourceKeys.size)throw new Error(`Partition omits ${sourceKeys.size-seen.size} source faces.`);
 return {sourceFaces:sourceKeys.size,assignedFaces:seen.size,groups:groups.length};
}

export const AssetSharedSourceMemberSchema=z.object({itemId:Id,sourceHash:Hash,sourceRole:z.string().min(1).max(100),sourceSlotRole:z.string().min(1).max(100).optional(),sourceType:z.enum(['color','depth']).optional(),sourceArtifactId:Id.optional(),sourceInputFingerprint:Hash.optional(),pairedColorHash:Hash.optional()}).strict();
export const AssetSharedSourceSchema=z.object({id:Id,artifactId:Id,hash:Hash,sheetArtifactId:Id,sheetHash:Hash,sheetInputFingerprint:Hash.optional(),members:z.array(AssetSharedSourceMemberSchema).min(1).max(64),status:z.enum(['pending','accepted','rejected']),submittedAt:z.string().min(1),reviewedAt:z.string().optional(),reviewedBy:z.literal('human').optional()}).strict().superRefine((value,ctx)=>{if(new Set(value.members.map(member=>member.itemId)).size!==value.members.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Shared source members must be unique.'});if(value.status==='pending'&&(value.reviewedAt||value.reviewedBy)||value.status!=='pending'&&(!value.reviewedAt||value.reviewedBy!=='human'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Shared source review metadata is invalid.'});});
const ManualImagePromptHistorySchema=z.object({prompt:z.string().trim().min(40).max(8000),savedAt:z.string().min(1).max(100),lineageHash:Hash}).strict();
const ManualImagePromptSchema=z.object({prompt:z.string().trim().min(40).max(8000),lineageHash:Hash,savedAt:z.string().min(1).max(100),locale:z.enum(['en','ru']).optional(),history:z.array(ManualImagePromptHistorySchema).max(1000).optional()}).strict();
const AssetWorkflowDataBaseSchema=z.object({schemaVersion:z.literal(1),definitionVersion:z.literal('asset-1'),assetJobId:Id,stages:z.array(z.union([AssetStageSchema,z.literal('materials')])).min(5).max(6),slots:z.array(AssetSlotSchema).max(10000),sceneCandidates:z.array(AssetCandidateSchema).max(1000).default([]),sceneAcceptedCandidateId:Id.optional(),sharedSources:z.array(AssetSharedSourceSchema).max(1000).default([]),instances:z.array(AssetInstanceSchema).max(10000),catalogItemOrder:z.array(Id).max(10000).optional(),depthEnabled:z.boolean().optional(),manualImagePrompts:z.record(z.string().min(1).max(200),ManualImagePromptSchema).optional(),catalogAssumptions:z.array(z.string().trim().min(1).max(1000)).max(128).optional(),catalogProposal:z.object({items:z.array(z.object({id:Id,name:z.string().trim().min(1).max(240),route:AssetRouteSchema,dimensions:z.tuple([z.number().finite().positive(),z.number().finite().positive(),z.number().finite().positive()]).optional(),views:z.array(z.string().trim().min(1).max(80)).max(32),viewType:AssetViewTypeSchema.optional(),depthEnabled:z.boolean()}).strict()).max(1000),instances:z.array(AssetInstanceSchema).max(10000),assumptions:z.array(z.string().trim().min(1).max(1000)).max(128).optional()}).strict().optional(),updatedAt:z.string().min(1)}).strict().superRefine((workflow,ctx)=>{
 const current='source,composition,images,geometry,assembly',legacy='source,composition,images,geometry,materials,assembly';
 if(workflow.stages.join(',')!==current&&workflow.stages.join(',')!==legacy)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Asset stages must use the five-stage order; only the exact legacy six-stage order is readable.'});
 const slots=workflow.slots.map(slot=>`${slot.itemId}:${slot.role}`);if(new Set(slots).size!==slots.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Item role slots must be unique.'});
 if(new Set(workflow.sharedSources.map(source=>source.id)).size!==workflow.sharedSources.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Shared source IDs must be unique.'});
 if(new Set(workflow.sceneCandidates.map(candidate=>candidate.id)).size!==workflow.sceneCandidates.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Scene candidate IDs must be unique.'});if(workflow.sceneAcceptedCandidateId&&!workflow.sceneCandidates.some(candidate=>candidate.id===workflow.sceneAcceptedCandidateId&&candidate.status==='accepted'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Current scene must be accepted.'});
 if(new Set(workflow.instances.map(instance=>instance.id)).size!==workflow.instances.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Instance IDs must be unique.'});
 if(workflow.catalogItemOrder&&new Set(workflow.catalogItemOrder).size!==workflow.catalogItemOrder.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Catalog item order must contain unique IDs.'});
});
/** Reading asset-1 records preserves their evidence and identity while dropping only the retired navigation entry. */
export const AssetWorkflowDataSchema=AssetWorkflowDataBaseSchema.transform(workflow=>({...workflow,stages:[...assetStages]}));
