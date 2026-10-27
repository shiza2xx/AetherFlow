import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

function walk(directory,relative=''){
  const entries=fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
  const files=[],dirs=[];
  for(const entry of entries){
    const rel=relative?`${relative}/${entry.name}`:entry.name,target=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw new Error(`Packaged tree contains a symbolic link: ${rel}`);
    if(entry.isDirectory()){dirs.push(rel);const nested=walk(target,rel);files.push(...nested.files);dirs.push(...nested.dirs);}
    else if(entry.isFile())files.push(rel);
    else throw new Error(`Packaged tree contains an unsupported entry: ${rel}`);
  }
  return {files,dirs};
}

export default async function afterPack(context){
  if(context.electronPlatformName!=='win32'||context.arch!==1)throw new Error('AetherFlow installer only accepts the pinned Windows x64 package.');
  const project=path.resolve(context.packager.projectDir),resourcesDir=path.join(context.appOutDir,'resources','scripts');
  fs.mkdirSync(resourcesDir,{recursive:true});
  const build=createRequire(import.meta.url)('esbuild').build;
  await build({entryPoints:[path.join(project,'scripts','mcp-stdio.mjs')],outfile:path.join(resourcesDir,'mcp-stdio.mjs'),bundle:true,platform:'node',format:'esm',target:'node18',packages:'bundle',external:['node:*'],sourcemap:false,legalComments:'none',logLevel:'silent'});
  const uninstallerStub=process.env.AETHERFLOW_UNINSTALLER_STUB;if(!uninstallerStub||!path.isAbsolute(uninstallerStub)){throw new Error('AetherFlow installer packaging requires the compiled local uninstaller bootstrap.');}const stubStat=fs.lstatSync(uninstallerStub);if(!stubStat.isFile()||stubStat.isSymbolicLink())throw new Error('The local uninstaller bootstrap path is not a regular file.');fs.copyFileSync(uninstallerStub,path.join(context.appOutDir,'Uninstall AetherFlow.exe'));

  const entries=walk(context.appOutDir),files=entries.files.filter(file=>!['Uninstall AetherFlow.exe','AetherFlow-Uninstall-Payload.exe'].includes(file)),directories=entries.dirs;
  const all=[...files,...directories];
  if(all.some(value=>path.isAbsolute(value)||value.split('/').some(part=>!part||part==='.'||part==='..')||/["$\r\n]/.test(value)||/^data(?:\/|$)/i.test(value)))throw new Error('The packaged ownership manifest contains an unsafe or data path.');

  const ownedPathFunctionBody=[
    '  Exch $R0',
    '  Push $R1',
    '  Push $R2',
    '  Push $R3',
    '  Push $R4',
    '  Push $R5',
    '  Push $R6',
    '  Push $R7',
    '  StrCpy $R9 1',
    '  System::Call \'kernel32::GetFullPathNameW(w "$INSTDIR\\$R0", i ${NSIS_MAX_STRLEN}, w .R1, p 0) i.R2\'',
    '  IntCmp $R2 0 ownedPathExit',
    '  IntCmp $R2 ${NSIS_MAX_STRLEN} ownedPathExit ownedPathFullPath ownedPathExit',
    'ownedPathFullPath:',
    '  System::Call \'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .R6, p 0) i.R2\'',
    '  IntCmp $R2 0 ownedPathExit',
    '  IntCmp $R2 ${NSIS_MAX_STRLEN} ownedPathExit ownedPathRoot ownedPathExit',
    'ownedPathRoot:',
    '  StrLen $R4 $R6',
    '  StrCpy $R5 $R1 $R4',
    '  StrCmp $R5 $R6 0 ownedPathExit',
    '  StrCpy $R5 $R1 1 $R4',
    '  StrCmp $R5 "\\" 0 ownedPathExit',
    '  System::Call \'kernel32::GetFileAttributesW(w "$R6") i.R5\'',
    '  IntCmp $R5 -1 ownedPathExit',
    '  IntOp $R2 $R5 & 0x410',
    '  StrCmp $R2 16 0 ownedPathExit',
    '  System::Call \'kernel32::GetFileAttributesW(w "$R1") i.R5\'',
    '  IntCmp $R5 -1 ownedPathMissing',
    '  IntOp $R2 $R5 & 0x400',
    '  StrCmp $R2 0 ownedPathTypeCheck',
    '  Goto ownedPathExit',
    'ownedPathTypeCheck:',
    '  IntOp $R2 $R5 & 0x10',
    '  StrCmp $R8 1 ownedPathDirectory',
    '  StrCmp $R2 0 ownedPathCheckDelete',
    '  Goto ownedPathExit',
    'ownedPathCheckDelete:',
    '  System::Call \'kernel32::CreateFileW(w "$R1", i 0x10000, i 7, p 0, i 3, i 0x80, p 0) p.R5\'',
    '  IntCmp $R5 -1 ownedPathExit',
    '  System::Call \'kernel32::CloseHandle(p $R5) v\'',
    '  StrCpy $R9 0',
    '  Goto ownedPathExit',
    'ownedPathDirectory:',
    '  StrCmp $R2 16 0 ownedPathExit',
    '  StrCpy $R9 0',
    '  Goto ownedPathExit',
    'ownedPathMissing:',
    '  StrCpy $R9 0',
    'ownedPathExit:',
    '  Pop $R7',
    '  Pop $R6',
    '  Pop $R5',
    '  Pop $R4',
    '  Pop $R3',
    '  Pop $R2',
    '  Pop $R1',
    '  Pop $R0',
    'FunctionEnd',
  ];
  const lines=[
    '!ifdef BUILD_UNINSTALLER',
    'Function un.AetherFlowCheckOwnedPath',
    ...ownedPathFunctionBody,
    '!else',
    '!ifdef AETHERFLOW_UNINSTALL_DIAGNOSTIC',
    'Function AetherFlowCheckOwnedPath',
    ...ownedPathFunctionBody,
    '!endif',
    '!endif',
    '',
    '!macro AetherFlowValidateOwnedPlan',
    ...files.flatMap(file=>[
      `Push "${file.replaceAll('/','\\')}"`,
      'StrCpy $R8 0',
      '!ifdef BUILD_UNINSTALLER',
      'Call un.AetherFlowCheckOwnedPath',
      '!else',
      '!ifdef AETHERFLOW_UNINSTALL_DIAGNOSTIC',
      'Call AetherFlowCheckOwnedPath',
      '!endif',
      '!endif',
      'StrCmp $R9 0 +2',
      'Abort',
    ]),
    ...directories.flatMap(directory=>[
      `Push "${directory.replaceAll('/','\\')}"`,
      'StrCpy $R8 1',
      '!ifdef BUILD_UNINSTALLER',
      'Call un.AetherFlowCheckOwnedPath',
      '!else',
      '!ifdef AETHERFLOW_UNINSTALL_DIAGNOSTIC',
      'Call AetherFlowCheckOwnedPath',
      '!endif',
      '!endif',
      'StrCmp $R9 0 +2',
      'Abort',
    ]),
    '!macroend',
    '',
    '!macro AetherFlowRemoveInstalledFiles',
    '!insertmacro AetherFlowValidateOwnedPlan',
    ...files.flatMap((file,index)=>[
      `; AETHERFLOW_OWNED_FILE ${file.replaceAll('\\','/')}`,
      `IfFileExists "$INSTDIR\\${file.replaceAll('/','\\')}" 0 ownedFileSkip${index}`,
      'ClearErrors',
      `Delete "$INSTDIR\\${file.replaceAll('/','\\')}"`,
      'IfErrors ownedFileRemoveFailed',
      `ownedFileSkip${index}:`,
    ]),
    'Goto ownedFilesRemoveDirectories',
    'ownedFileRemoveFailed:',
    'MessageBox MB_ICONSTOP|MB_OK "AetherFlow could not safely remove an owned program file. Close the application and retry."',
    'Abort',
    'ownedFilesRemoveDirectories:',
    ...directories.sort((a,b)=>b.split('/').length-a.split('/').length||b.localeCompare(a)).flatMap(directory=>[
      `; AETHERFLOW_OWNED_DIR ${directory.replaceAll('\\','/')}`,
      `RMDir "$INSTDIR\\${directory.replaceAll('/','\\')}"`,
    ]),
    '!macroend',
    '',
  ];
  const buildResources=path.resolve(project,'build'),target=path.join(buildResources,'owned-files.nsh');
  if(!target.startsWith(buildResources+path.sep))throw new Error('Uninstall manifest escaped the owned build folder.');
  fs.writeFileSync(target,lines.join('\r\n'),{flag:'w'});
}
