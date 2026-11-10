import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {resolveImportSource} from './import-source';
import {AssetProductionService} from './asset-production';
import {workspaceLayout} from './workspace-layout';
import type {AtelierStore} from './store';

const BufferedZip=z.object({name:z.string().min(1).max(255),bytes:z.instanceof(Uint8Array)}).strict();
const Input=z.object({assetJobId:z.string().uuid(),assetItemId:z.string().uuid().optional(),paths:z.array(z.string().min(1)).max(100).default([]),files:z.array(BufferedZip).max(1).default([])}).strict().refine(value=>value.paths.length+value.files.length>0&&(!value.files.length||value.paths.length===0),{message:'Provide local import paths or one buffered ZIP file.'});
type ImportSource={path:string;root:string;temporaryDirectory?:string};

function stageBufferedZip(store:AtelierStore,jobId:string,name:string,bytes:Uint8Array):ImportSource{
 if(path.basename(name)!==name||/[\\/:\u0000-\u001f]/.test(name)||path.extname(name).toLowerCase()!=='.zip')throw new Error('Choose a ZIP file when its local path is unavailable.');
 if(bytes.byteLength>128*1024*1024)throw new Error('ZIP files over 128 MB cannot be imported.');
 const layout=workspaceLayout(store.root),relative=`work/assets/${jobId}/.aetherflow/imports/${crypto.randomUUID()}`,directory=layout.resolve(relative);
 fs.mkdirSync(directory,{recursive:true});layout.resolve(relative);
 const file=path.join(directory,'import.zip');fs.writeFileSync(file,Buffer.from(bytes),{flag:'wx',mode:0o600});
 if(fs.lstatSync(file).isSymbolicLink()||fs.realpathSync.native(file)!==path.resolve(file))throw new Error('Temporary ZIP source is not a private regular file.');
 return {path:file,root:directory,temporaryDirectory:directory};
}

function cleanupStagedZip(store:AtelierStore,source:ImportSource){
 if(!source.temporaryDirectory)return;
 try{const layout=workspaceLayout(store.root),directory=path.resolve(source.temporaryDirectory);if(!fs.existsSync(directory))return;const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync.native(directory)!==directory)return;layout.resolve(path.relative(layout.workspace,directory).replace(/\\/g,'/'));fs.rmSync(directory,{recursive:true,force:true});}catch{}
}

/** Register returned sources before any native decode. A failed sidecar scan retains the source for recovery. */
export async function importAssetModels(store:AtelierStore,raw:unknown){
 const input=Input.parse(raw),ctx=new AssetProductionService(store).get(input.assetJobId);
 if(input.assetItemId&&!ctx.items.some(item=>item.id===input.assetItemId))throw new Error('Asset item belongs to another job.');
 const owner=input.assetItemId||input.assetJobId,sources:ImportSource[]=input.paths.map(value=>{const source=resolveImportSource(value),ext=path.extname(source.path).toLowerCase();if(!['.fbx','.glb','.obj','.zip'].includes(ext))throw new Error(ext==='.gltf'?'Convert glTF to GLB before importing.':'Choose FBX, GLB, OBJ or ZIP files.');return source;}),staged:ImportSource[]=[];
 try{
  for(const file of input.files){const source=stageBufferedZip(store,input.assetJobId,file.name,file.bytes);sources.push(source);staged.push(source);}
  const results=[];
  for(const source of sources){
   try{
    const artifacts=await store.importPath(source.path,owner,source.root);
    if(path.extname(source.path).toLowerCase()==='.zip'){
     const models=artifacts.filter(artifact=>['.fbx','.glb','.obj'].includes(path.extname(String(artifact.data.sourceName||artifact.name)).toLowerCase()));
     if(models.length!==1){results.push({source:artifacts[0],dependencies:artifacts.slice(1),error:`ZIP must contain exactly one FBX, GLB or OBJ model; found ${models.length}.`});continue;}
     const model=models[0],archive=artifacts[0];
     // Preview and Blender manifests read dependencies from the selected model,
     // so copy the validated bundle closure while preserving relative paths.
     if(archive?.id!==model.id){
      const own=new Map(store.dependencies(model.id).map(dep=>[dep.logicalPath,dep.hash]));
      for(const dep of store.dependencies(archive.id)){
       if(dep.hash===model.data.hash)continue;
       const prior=own.get(dep.logicalPath);
       if(prior&&prior!==dep.hash)throw new Error(`ZIP dependency path is ambiguous: ${dep.logicalPath}`);
       if(!prior){store.addDependency(model.id,dep.hash,dep.logicalPath,'bundle-member');own.set(dep.logicalPath,dep.hash);}
      }
     }
     // Return a direct job/item-owned view for existing geometry and shared
     // return validators; retain the archive/model relationship as provenance.
     const selected=store.assetProductionPut({kind:'artifact',name:model.name,data:{...model.data,parentId:owner,sourceParentId:model.id,sourceArchiveId:archive?.id||null}});
     store.link(owner,selected.id,'artifact');
     for(const dep of store.dependencies(model.id))store.addDependency(selected.id,dep.hash,dep.logicalPath,dep.role);
     results.push({source:selected,dependencies:artifacts.filter(artifact=>artifact.id!==model.id),error:null});
    }else results.push({source:artifacts[0],dependencies:artifacts.slice(1),error:null});
   }catch(error){const artifact=await store.ingest(source.path,owner,'artifact');results.push({source:artifact,dependencies:[],error:error instanceof Error?error.message:String(error)});}
  }
  return results;
 }finally{for(const source of staged)cleanupStagedZip(store,source);}
}
