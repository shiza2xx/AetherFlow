import path from 'node:path';

export type WorkspaceLockProcessProbe={
 isAlive:(pid:number)=>boolean;
 executableForPid:(pid:number)=>string|undefined;
};

function normalizedExecutable(value:string,platform:NodeJS.Platform){
 return platform==='win32'?path.win32.resolve(value).toLocaleLowerCase('en-US'):path.resolve(value);
}

/**
 * A PID can be reused after the process that wrote a workspace lock exits.
 * On Windows, confirm the live PID still points at this executable before
 * treating an old lock as owned. If inspection is unavailable, fail closed.
 */
export function workspaceLockOwnerIsActive(pid:number,ownExecutable:string,probe:WorkspaceLockProcessProbe,platform:NodeJS.Platform=process.platform){
 if(!Number.isInteger(pid)||pid<1)return false;
 try{if(!probe.isAlive(pid))return false;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;return true;}
 if(platform!=='win32')return true;
 let executable:string|undefined;
 try{executable=probe.executableForPid(pid);}catch{return true;}
 if(!executable?.trim())return true;
 try{return normalizedExecutable(executable,platform)===normalizedExecutable(ownExecutable,platform);}catch{return true;}
}
