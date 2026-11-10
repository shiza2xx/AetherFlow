import type {Entity} from '../shared/contracts';

export type VerifiedAssetAssemblyPreview={status:'complete';artifactId:string;sourceHash:string;operationId:string;assemblyReportHash:string;fullPreviewArtifactId:string;fullPreviewHash:string;proxyOperationId:string;proxySourceArtifactId:string;proxySourceHash:string;previewArtifactId:string;previewHash:string};

/** Prevent a previous item's converted preview from being paired with the next selection. */
export function assetPreviewForSource(sourceArtifactId:string|undefined,sourceHash:string|undefined,preview:Entity|null,assembly?:VerifiedAssetAssemblyPreview|null):Entity|null{
 if(!sourceArtifactId||!sourceHash||!preview)return null;
 if(preview.data.versionOf===sourceArtifactId&&preview.data.sourceInputHash===sourceHash)return preview;
 return assembly?.status==='complete'&&assembly.artifactId===sourceArtifactId&&assembly.sourceHash===sourceHash&&typeof assembly.operationId==='string'&&assembly.operationId.length>0&&/^[a-f0-9]{64}$/.test(assembly.assemblyReportHash)&&assembly.proxyOperationId.length>0&&assembly.proxySourceArtifactId===assembly.fullPreviewArtifactId&&assembly.proxySourceHash===assembly.fullPreviewHash&&assembly.previewArtifactId===preview.id&&assembly.previewHash===preview.data.hash?preview:null;
}
