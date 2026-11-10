import {describe,expect,it} from 'vitest';
import {assetPreviewForSource} from './asset-preview-selection';

describe('asset preview selection',()=>{
 it('does not pair an old item derivative with the newly selected source while its replacement loads',()=>{
  const prior={id:'preview-old',kind:'artifact',name:'preview.glb',revision:1,data:{versionOf:'source-old',sourceInputHash:'hash-old'}} as any;
  expect(assetPreviewForSource('source-current','hash-current',prior)).toBeNull();
 });
 it('shows a derivative only when both its source artifact and source hash match',()=>{
  const current={id:'preview-current',kind:'artifact',name:'preview.glb',revision:1,data:{versionOf:'source-current',sourceInputHash:'hash-current'}} as any;
  expect(assetPreviewForSource('source-current','hash-current',current)).toBe(current);
  expect(assetPreviewForSource('source-current','hash-changed',current)).toBeNull();
  expect(assetPreviewForSource(undefined,'hash-current',current)).toBeNull();
 });
 it('shows an assembly GLB only with the exact completed status proof for this scene and preview',()=>{
  const scene={id:'scene-current',kind:'artifact',name:'scene.blend',revision:1,data:{hash:'scene-hash'}} as any;
  const glb={id:'glb-current',kind:'artifact',name:'scene.glb',revision:1,data:{hash:'glb-hash'}} as any;
  const proof={status:'complete' as const,artifactId:'scene-current',sourceHash:'scene-hash',operationId:'assemble-current',assemblyReportHash:'a'.repeat(64),fullPreviewArtifactId:'glb-full',fullPreviewHash:'full-hash',proxyOperationId:'proxy-current',proxySourceArtifactId:'glb-full',proxySourceHash:'full-hash',previewArtifactId:'glb-current',previewHash:'glb-hash'};
  expect(assetPreviewForSource(scene.id,scene.data.hash,glb,proof)).toBe(glb);
  expect(assetPreviewForSource(scene.id,scene.data.hash,glb)).toBeNull();
  expect(assetPreviewForSource(scene.id,'changed-scene-hash',glb,proof)).toBeNull();
  expect(assetPreviewForSource(scene.id,scene.data.hash,glb,{...proof,artifactId:'scene-old'})).toBeNull();
  expect(assetPreviewForSource(scene.id,scene.data.hash,glb,{...proof,previewArtifactId:'glb-old'})).toBeNull();
  expect(assetPreviewForSource(scene.id,scene.data.hash,glb,{...proof,previewHash:'changed-glb-hash'})).toBeNull();
  expect(assetPreviewForSource(scene.id,scene.data.hash,glb,{...proof,proxyOperationId:''})).toBeNull();
  expect(assetPreviewForSource(scene.id,scene.data.hash,glb,{...proof,proxySourceArtifactId:'foreign-full'})).toBeNull();
  expect(assetPreviewForSource(scene.id,scene.data.hash,glb,{...proof,operationId:''})).toBeNull();
 });
});
