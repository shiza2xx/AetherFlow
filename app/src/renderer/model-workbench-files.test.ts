import {describe,expect,it} from 'vitest';
import {modelWorkbenchViewerFiles} from './model-workbench-files';

const master={id:'blend',name:'fit.blend',data:{hash:'source-hash',sourceName:'fit.blend'}};
const legacy={id:'legacy',name:'legacy.glb',data:{hash:'same-preview-bytes',sourceName:'legacy.glb',versionOf:'blend',sourceParentId:'blend',sourceInputHash:'source-hash'}};
const proof={id:'proof',name:'proof.glb',data:{hash:'same-preview-bytes',sourceName:'proof.glb',versionOf:'blend',sourceParentId:'blend',sourceInputHash:'source-hash',settings:{textureBindingProofs:{materials:[{}],uv:[{}]}}}};
const otherGeometry={id:'other-geometry',name:'older.glb',data:{hash:'different-bytes',sourceName:'older.glb',versionOf:'blend',sourceParentId:'blend',sourceInputHash:'source-hash'}};
const foreign={id:'foreign',name:'foreign.glb',data:{hash:'same-preview-bytes',sourceName:'foreign.glb',versionOf:'other-blend',sourceParentId:'other-blend',sourceInputHash:'source-hash'}};

describe('workbench viewer source family',()=>{
 it('keeps a selected editable assembly with its exact-source derivatives',()=>{
  expect(modelWorkbenchViewerFiles([master,legacy,proof,otherGeometry,foreign],'blend').map(row=>row.id)).toEqual(['legacy','proof','other-geometry','blend']);
 });
 it('adds the managed source and only a byte-identical same-source alias for an explicit legacy GLB',()=>{
  expect(modelWorkbenchViewerFiles([master,legacy,proof,otherGeometry,foreign],'legacy').map(row=>row.id)).toEqual(['blend','proof','legacy']);
 });
 it('keeps an explicitly selected historical GLB pinned when its geometry differs',()=>{
  expect(modelWorkbenchViewerFiles([master,legacy,proof,otherGeometry,foreign],'other-geometry').map(row=>row.id)).toEqual(['blend','other-geometry']);
 });
});
