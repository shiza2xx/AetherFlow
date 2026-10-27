import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isPathWithin} from './path-containment';
import {workspaceLayout,safeStorageName} from './workspace-layout';

// Real copies, never hard links: tools may edit their working files without
// touching the content-addressed originals. Bounded images are shared by hash
// across requests for one character.
export function snapshotGenerationInputs(root:string,logicalRoot:string,characterId:string,inputs:any[]){
  if(!/^[a-f0-9-]{36}$/i.test(characterId))throw new Error('Character input scope is invalid.');
  const layout=workspaceLayout(root),directory=layout.category({kind:'character',id:characterId,name:'Character'},'references');
  let parent=directory;while(!fs.existsSync(parent))parent=path.dirname(parent);
  if(fs.realpathSync.native(parent)!==parent)throw new Error('Character input directory is unsafe.');
  fs.mkdirSync(directory,{recursive:true});
  if(fs.realpathSync.native(directory)!==directory)throw new Error('Character input directory is unsafe.');
  return inputs.map(input=>{
    const hash=String(input.hash||''),extension=path.extname(String(input.logicalPath||input.name)).toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(hash)||!['.png','.jpg','.jpeg','.webp','.gif'].includes(extension))return input;
    const readable=safeStorageName(path.basename(String(input.name||input.logicalPath||'reference'),extension),'reference'),destination=path.join(directory,`${readable}-${hash.slice(0,10)}${extension}`),source=path.join(root,'objects',hash);
    if(!isPathWithin(path.join(root,'objects'),source)||fs.realpathSync.native(source)!==source||!fs.statSync(source).isFile())throw new Error('Reference source is unavailable.');
    if(fs.statSync(source).size>128*1024*1024)throw new Error('Reference source exceeds 128 MB.');
    if(fs.existsSync(destination)){
      if(fs.realpathSync.native(destination)!==destination||!fs.lstatSync(destination).isFile())throw new Error('Reference working copy is unsafe.');
      if(crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')!==hash)fs.copyFileSync(source,destination);
    }else fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
    if(crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')!==hash)throw new Error('Reference working copy failed integrity verification.');
    return {...input,path:path.join(logicalRoot,'work','characters',characterId,'references',path.basename(destination))};
  });
}
