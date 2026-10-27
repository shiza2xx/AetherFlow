import fs from 'node:fs';
import path from 'node:path';

type SourceIo=Pick<typeof fs,'statSync'|'accessSync'>&{realpath:(value:string)=>string};
const sourceIo:SourceIo={statSync:fs.statSync,accessSync:fs.accessSync,realpath:value=>fs.realpathSync.native(value)};
function sourceError(code:string,message:string):never{throw Object.assign(new Error(message),{code});}

// A path explicitly supplied for import is a read request, not a request to
// write into that folder. There is no hidden home/workspace/granted-roots list.
// Windows decides read access. Resolve ordinary directory junctions so selecting
// an existing file through a normal filesystem alias works as expected.
export function resolveImportSource(value:string,kind:'file'|'directory'='file',io:SourceIo=sourceIo){
  if(!path.isAbsolute(value)||process.platform==='win32'&&!/^(?:[a-z]:[\\/]|\\\\\?\\[a-z]:\\)/i.test(value))sourceError('IMPORT_LOCAL_PATH_REQUIRED','Choose an absolute file or folder path on a local drive.');
  try{
    const resolved=io.realpath(value),stat=io.statSync(resolved);
    if(kind==='file'&&!stat.isFile())sourceError('IMPORT_FILE_REQUIRED','Choose a file to import, rather than a folder.');
    if(kind==='directory'&&!stat.isDirectory())sourceError('IMPORT_FOLDER_REQUIRED','Choose an existing folder to browse.');
    io.accessSync(resolved,fs.constants.R_OK);
    return {path:resolved,root:kind==='file'?path.dirname(resolved):resolved,stat};
  }catch(error){
    const code=(error as NodeJS.ErrnoException).code;
    if(code==='EACCES'||code==='EPERM')sourceError('IMPORT_READ_DENIED',`Windows did not allow Atelier to read this ${kind==='file'?'file':'folder'}: ${value}`);
    if(code==='ENOENT'||code==='ENOTDIR')sourceError('IMPORT_SOURCE_MISSING',`The selected ${kind==='file'?'file':'folder'} was not found. It may have been moved or deleted: ${value}`);
    throw error;
  }
}

export function browseImportFolder(value:string,includeFiles:boolean,offset:number,limit:number){
  const {path:base}=resolveImportSource(value,'directory');
  const all=fs.readdirSync(base,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(base,entry.name);
    let directory=entry.isDirectory();
    if(entry.isSymbolicLink()){try{directory=fs.statSync(file).isDirectory();}catch{return [];}}
    return !directory&&!includeFiles?[]:[{name:entry.name,path:file,directory}];
  }).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));
  const entries=all.slice(offset,offset+limit),drive=path.parse(base).root;
  return {path:base,parent:base.toLowerCase()===drive.toLowerCase()?null:path.dirname(base),scope:'system' as const,roots:[drive],entries,offset,limit,total:all.length,hasMore:offset+entries.length<all.length};
}
