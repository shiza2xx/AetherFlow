export function assertRendererWorkspaceTransitionCanStart(activeRendererRpcRequests:number){
 if(activeRendererRpcRequests>1)throw Object.assign(new Error('A renderer operation is still finishing. Wait for pending saves or imports before changing workspaces.'),{code:'WORKSPACE_BUSY'});
}
