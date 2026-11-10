import {AssetSharedReturnService} from './asset-shared-return';
import type {AtelierStore} from './store';
import {AssetProductionService} from './asset-production';
import {ownerForArtifact} from './workspace-layout';
import {AssetStageSchema} from '../shared/asset-production';
import {AssetSceneService} from './asset-scene';
import type {Entity} from '../shared/contracts';

type AssetUiContext={state:ReturnType<AssetProductionService['get']>;validation:ReturnType<AssetSceneService['validateMetadata']>};
function liveScene(store:AtelierStore,state:ReturnType<AssetProductionService['get']>,artifactId:string,validation?:ReturnType<AssetSceneService['validateMetadata']>){const candidate=(state.workflow.data.sceneCandidates||[]).find((row:any)=>row.artifactId===artifactId);if(!candidate)return null;const current=validation||new AssetSceneService(store,{resourceRoot:''}).validateMetadata({id:state.job.id});return (candidate.status==='pending'||candidate.status==='accepted'&&state.workflow.data.sceneAcceptedCandidateId===candidate.id)&&candidate.dependencyFingerprint===current.dependencyFingerprint&&current.readyForAssembly?candidate:null;}

/** Verify renderer navigation against the current managed job, catalog and artifact lineage. */
export function validateAssetUiSelection(store:AtelierStore,selection:{assetJobId?:string|null;assetItemId?:string|null;instanceId?:string|null;stage?:string|null;role?:string|null;artifactId?:string|null},known?:AssetUiContext){
 const {assetJobId,assetItemId,instanceId,stage,role,artifactId}=selection;
 if(!assetJobId){if(assetItemId||instanceId||stage||role)throw new Error('Asset selection requires a job.');return;}
 const context=known?.state||new AssetProductionService(store).get(assetJobId);
 if(assetItemId&&!context.items.some(item=>item.id===assetItemId))throw new Error('Selected item belongs to another asset job.');
 if(instanceId&&!context.activeInstances.some((instance:any)=>instance.id===instanceId&&(!assetItemId||instance.masterItemId===assetItemId)))throw new Error('Selected instance is not active for this asset job and item.');
 if(stage)AssetStageSchema.parse(stage);
 if(role&&(!assetItemId||!context.workflow.data.slots.some((slot:any)=>slot.itemId===assetItemId&&slot.role===role)))throw new Error('Selected asset role is not registered for this item.');
 if(artifactId){const artifact=store.get('artifact',artifactId),owner=artifact&&ownerForArtifact(store,artifact);if(!artifact||owner?.kind!=='assetJob'||owner.id!==assetJobId)throw new Error('Selected artifact belongs to another owner.');
  if(assetItemId){const slots=context.workflow.data.slots.filter((slot:any)=>slot.itemId===assetItemId&&(!role||slot.role===role));if(!slots.some((slot:any)=>slot.candidates.some((candidate:any)=>candidate.artifactId===artifactId))&&!liveScene(store,context,artifactId,known?.validation))throw new Error('Selected artifact is not registered to this item or a current scene.');}
 }
}

/**
 * Return the metadata link for a current assembly preview. The caller must also
 * verify the on-disk report and both managed/output hashes asynchronously before
 * showing the GLB. This check deliberately does not create derived-preview proof.
 */
export function currentAssemblyPreviewLinks(store:AtelierStore,selection:{assetJobId:string;assetItemId?:string|null;instanceId?:string|null;artifactId:string},known?:AssetUiContext){
 const state=known?.state||new AssetProductionService(store).get(selection.assetJobId),source=store.get('artifact',selection.artifactId);
 if(!source||state.job.data.mode!=='composite')return [];
 const validation=known?.validation||new AssetSceneService(store,{resourceRoot:''}).validateMetadata({id:selection.assetJobId},state),candidate=liveScene(store,state,source.id,validation);
 if(!candidate||candidate.hash!==source.data.hash)return [];
 const sourceOwner=ownerForArtifact(store,source);
 if(sourceOwner?.kind!=='assetJob'||sourceOwner.id!==selection.assetJobId)return [];
 if(!validation.readyForAssembly||candidate.dependencyFingerprint!==validation.dependencyFingerprint)return [];
 const firstMaster=validation.masters.find((master:any)=>master.artifactId),expectedAssetId=firstMaster?.artifactId;
 const expectedInputs=[...new Set(validation.masters.map((master:any)=>master.hash).filter((hash:any):hash is string=>typeof hash==='string'))].sort();
 const operations=store.list({kind:'operation',limit:10000}).filter((row:Entity)=>row.data.assetJobId===selection.assetJobId&&row.data.status==='complete'&&row.data.parameters?.mode==='assemble'&&row.data.report?.sceneArtifactId===source.id&&typeof row.data.report?.previewArtifactId==='string').sort((a:Entity,b:Entity)=>b.createdAt.localeCompare(a.createdAt));
 const links:Array<{source:Entity;viewer:Entity;operation:Entity;candidate:any;validation:any}>=[];
 for(const operation of operations){
  const report=operation.data.report,inputs=Array.isArray(operation.data.inputs)?[...new Set(operation.data.inputs.filter((value:any):value is string=>typeof value==='string'))].sort():[];
  const viewer=store.get('artifact',String(report.previewArtifactId||''));if(!viewer)continue;const viewerOwner=ownerForArtifact(store,viewer);
  if(viewerOwner?.kind!=='assetJob'||viewerOwner.id!==selection.assetJobId||viewer.data.parentId!==selection.assetJobId)continue;
  if(operation.data.assetId!==expectedAssetId||inputs.length!==expectedInputs.length||inputs.some((hash:string,index:number)=>hash!==expectedInputs[index])||report.dependencyFingerprint!==candidate.dependencyFingerprint||report.instanceCount!==validation.instances.length||report.sharedGeometry!==true)continue;
  if(report.sceneHash!==undefined&&report.sceneHash!==source.data.hash||report.previewHash!==undefined&&report.previewHash!==viewer.data.hash)continue;
  if(viewer.data.operationId!==undefined&&viewer.data.operationId!==operation.id||viewer.data.versionOf!==undefined&&viewer.data.versionOf!==source.id||viewer.data.sourceInputHash!==undefined&&viewer.data.sourceInputHash!==source.data.hash)continue;
  links.push({source,viewer,operation,candidate,validation});
 }
 return links;
}

/** Return full quality GLBs that are still bound to a live composite scene. */
export function currentAssemblyPreviewSources(store:AtelierStore,jobId:string,previewArtifactId:string,known?:AssetUiContext):ReturnType<typeof currentAssemblyPreviewLinks>{
 const state=known?.state||new AssetProductionService(store).get(jobId),context=known||{state,validation:new AssetSceneService(store,{resourceRoot:''}).validateMetadata({id:jobId},state)};if(state.job.data.mode!=='composite')return [];
 const links:ReturnType<typeof currentAssemblyPreviewLinks>=[];for(const candidate of (state.workflow.data.sceneCandidates||[]).filter((row:any)=>row.status==='pending'||row.status==='accepted'&&state.workflow.data.sceneAcceptedCandidateId===row.id))links.push(...currentAssemblyPreviewLinks(store,{assetJobId:jobId,artifactId:candidate.artifactId},context));return links.filter((link:ReturnType<typeof currentAssemblyPreviewLinks>[number])=>link.viewer.id===previewArtifactId);
}

/** A preview must be a live item candidate or scene and a verified derivative of those exact bytes. */
export function verifyAssetViewer(store:AtelierStore,selection:{assetJobId:string;assetItemId?:string|null;instanceId?:string|null;artifactId:string;viewerArtifactId:string},knownContext?:AssetUiContext){
 const state=knownContext?.state||new AssetProductionService(store).get(selection.assetJobId),validation=knownContext?.validation||new AssetSceneService(store,{resourceRoot:''}).validateMetadata({id:selection.assetJobId},state),known={state,validation};validateAssetUiSelection(store,selection,known);const source=store.get('artifact',selection.artifactId),viewer=store.get('artifact',selection.viewerArtifactId);if(!source||!viewer||!source.data.hash||!viewer.data.hash)throw new Error('Asset viewer source or derivative is missing.');
 const scene=liveScene(store,state,source.id,validation),assemblySources=currentAssemblyPreviewSources(store,selection.assetJobId,source.id,known),sharedRow=!selection.assetItemId?(state.workflow.data.sharedSources||[]).find((row:any)=>row.artifactId===source.id&&row.hash===source.data.hash):null,shared=sharedRow?new AssetSharedReturnService(store,{resourceRoot:''}).fresh(selection.assetJobId,sharedRow.id,true):null;
 if(selection.assetItemId&&!scene){const current=state.current.find(row=>row.itemId===selection.assetItemId),slot=state.workflow.data.slots.find((row:any)=>row.itemId===selection.assetItemId&&['geometry','material'].includes(row.role)&&row.candidates.some((candidate:any)=>candidate.artifactId===source.id)),candidate=slot?.candidates.find((row:any)=>row.artifactId===source.id&&row.hash===source.data.hash),fingerprint=slot?.role==='geometry'?current?.geometryInputFingerprint:current?.materialInputFingerprint,active=candidate&&(candidate.status==='pending'||candidate.status==='accepted'&&slot.acceptedCandidateId===candidate.id);if(!active||candidate.inputFingerprint!==fingerprint||slot.role==='material'&&candidate.dependsOnGeometryHash!==current?.geometry?.hash)throw new Error('Asset viewer source is stale, rejected, or not current for this item.');}
 else if((!scene||scene.hash!==source.data.hash)&&!shared&&!assemblySources.length)throw new Error('Asset scene or shared preview is stale or not a current candidate.');
 const owner=ownerForArtifact(store,viewer);if(owner?.kind!=='assetJob'||owner.id!==selection.assetJobId)throw new Error('Asset viewer derivative belongs to another job.');if(viewer.id===source.id)return {source,viewer};if(currentAssemblyPreviewLinks(store,selection,known).some(link=>link.viewer.id===viewer.id))return {source,viewer};
 if(scene&&scene.hash===source.data.hash){for(const link of currentAssemblyPreviewLinks(store,selection,known)){try{verifyAssetViewer(store,{assetJobId:selection.assetJobId,artifactId:link.viewer.id,viewerArtifactId:viewer.id},known);return {source,viewer};}catch{/* A proxy must be bound to the exact current full quality scene GLB. */}}}
 const operation=store.get('operation',String(viewer.data.operationId||'')),report=operation?.data.report;const foliageMask=!!selection.assetItemId&&state.items.some(item=>item.id===selection.assetItemId&&item.data.route==='foliage');if(foliageMask&&report?.foliageMask!==true)throw new Error('Foliage preview must retain its alpha mask.');if(viewer.data.sourceInputHash!==source.data.hash||viewer.data.versionOf!==source.id||operation?.data.status!=='complete'||operation.data.assetId!==source.id||operation.data.parameters?.mode!=='derived-preview'||report?.previewArtifactId!==viewer.id||report.inputSHA256!==source.data.hash||report.outputSHA256!==viewer.data.hash||report.autoexec!=='disabled'||report.derivedPreviewOnly!==true||report.assetGuardedImport!==true||JSON.stringify(viewer.data.settings?.textureBindingProofs)!==JSON.stringify(report.sourceAudit)||viewer.data.validationChecks?.assetGuardedImport!==true||viewer.data.validationChecks?.sourceUnmodified!==true||viewer.data.validationChecks?.outputHashVerified!==true)throw new Error('Asset viewer derivative lacks an exact verified conversion report.');
 if(assemblySources.length){const link=assemblySources[0],proof=report.assemblyPreviewProxy,stored=viewer.data.settings?.assemblyPreviewProxy;if(proof?.schemaVersion!==1||proof.sceneArtifactId!==link.source.id||proof.sceneHash!==link.source.data.hash||proof.sceneCandidateId!==link.candidate.id||proof.dependencyFingerprint!==link.candidate.dependencyFingerprint||proof.assembleOperationId!==link.operation.id||! /^[a-f0-9]{64}$/.test(String(proof.assembleReportSHA256||''))||link.operation.data.report?.reportSHA256!==undefined&&proof.assembleReportSHA256!==link.operation.data.report.reportSHA256||proof.fullPreviewArtifactId!==source.id||proof.fullPreviewHash!==source.data.hash||stored?.sceneArtifactId!==link.source.id||stored?.sceneCandidateId!==link.candidate.id||stored?.dependencyFingerprint!==link.candidate.dependencyFingerprint||stored?.assembleOperationId!==link.operation.id||stored?.assembleReportSHA256!==proof.assembleReportSHA256||stored?.fullPreviewArtifactId!==source.id||stored?.fullPreviewHash!==source.data.hash||viewer.data.validationChecks?.assemblyPreviewProxyVerified!==true)throw new Error('Assembly viewer proxy does not match its current scene and full quality preview.');}
 return {source,viewer};
}
