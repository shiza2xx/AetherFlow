export type WorkspaceOpenIdentity={transitionId:string;catalogId:string;workspace:string;workspaceInstanceId:string};
export type WorkspaceOpenAcknowledgement=WorkspaceOpenIdentity&{loaded:true};

export function matchesWorkspaceOpenAcknowledgement(expected:WorkspaceOpenIdentity,ack:WorkspaceOpenAcknowledgement,current:{workspace:string;workspaceInstanceId:string}):boolean{
  return ack.loaded===true&&ack.transitionId===expected.transitionId&&ack.catalogId===expected.catalogId&&ack.workspace===expected.workspace&&ack.workspaceInstanceId===expected.workspaceInstanceId&&current.workspace===expected.workspace&&current.workspaceInstanceId===expected.workspaceInstanceId;
}

export function workspaceFlushReady(input:{openDocumentDrafts:number;notebookSaved:boolean;workbenchSaved:boolean;checklistSaved:boolean}):boolean{
  return Number.isInteger(input.openDocumentDrafts)&&input.openDocumentDrafts===0&&input.notebookSaved&&input.workbenchSaved&&input.checklistSaved;
}
