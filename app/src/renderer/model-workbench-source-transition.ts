export async function runTextureSourceTransition(input:{value:string;intent:'automatic'|'explicit';currentId:string;hasDirtyMarks:boolean;flush:()=>Promise<unknown>;onDeferred:(value:string)=>void;onSaveFailure:()=>void;commit:(value:string,intent:'automatic'|'explicit')=>void}){
 if(input.value===input.currentId)return true;
 if(input.intent==='automatic'&&input.hasDirtyMarks){input.onDeferred(input.value);return false;}
 if(input.intent==='explicit'&&input.hasDirtyMarks){const saved=await input.flush();if(!saved){input.onSaveFailure();return false;}}
 input.commit(input.value,input.intent);return true;
}

export type ExternalArtifactRequestCursor={value:string|undefined};
/** Consume only a changed parent request; local History selections must not replay it. */
export function consumeExternalArtifactRequest(cursor:ExternalArtifactRequestCursor,requested:string|undefined){
 if(cursor.value===requested)return null;
 cursor.value=requested;
 return requested||null;
}

export type TextureSourceOperation={epoch:number;sourceId:string;workspace:string;workspaceInstanceId:string};
export function isTextureSourceOperationCurrent(operation:TextureSourceOperation,current:{epoch:number;sourceId:string;workspace:string;workspaceInstanceId:string}){
 return operation.epoch===current.epoch&&operation.sourceId===current.sourceId&&operation.workspace===current.workspace&&operation.workspaceInstanceId===current.workspaceInstanceId;
}
