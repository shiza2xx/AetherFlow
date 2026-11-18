import {describe,expect,it} from 'vitest';
import {CodexAppServer} from './codex-app-server';

function protocolFixture(){
 const requests:any[]=[],server:any=Object.create(CodexAppServer.prototype),targetThread='thread-exact-01',targetTurn='turn-exact-01',markdown='# Asset reference plan\n\n## User goals\n- A verified source plan.\n';
 server.pending=new Map();server.nextId=1;server.listeners=new Set();server.stderr='';server.closed=false;
 const emit=(method:string,params:any)=>{for(const listener of [...server.listeners])listener(method,params);};
 server.onLine=(line:string)=>CodexAppServer.prototype['onLine'].call(server,line);
 server.child={killed:false,stdin:{write:(line:string,callback:(error?:Error|null)=>void)=>{
  const request=JSON.parse(line);requests.push(request);
  if(request.method==='turn/start'){
   emit('item/completed',{threadId:'other-thread',turnId:targetTurn,item:{type:'agentMessage',text:'{"markdown":"wrong thread"}'}});
   emit('item/completed',{threadId:targetThread,turnId:'turn-other',item:{type:'agentMessage',text:'{"markdown":"wrong turn"}'}});
   emit('turn/completed',{threadId:'other-thread',turn:{id:targetTurn,status:'completed'}});
   emit('turn/completed',{threadId:targetThread,turn:{id:'turn-other',status:'completed'}});
   emit('item/completed',{threadId:targetThread,turnId:targetTurn,item:{type:'agentMessage',text:JSON.stringify({markdown})}});
   emit('turn/completed',{threadId:targetThread,turn:{id:targetTurn,status:'completed'}});
  }
  server.onLine(JSON.stringify({id:request.id,result:request.method==='turn/start'?{turn:{id:targetTurn,status:'inProgress'}}:{}}));callback(null);
 }}};
 return {server,requests,targetThread,targetTurn,markdown};
}

describe('Codex app-server reference turn protocol',()=>{
 it('uses the generated v2 input and sandbox shapes, restores thread settings, and correlates early notifications by exact thread and turn',async()=>{
  const {server,requests,targetThread,targetTurn,markdown}=protocolFixture(),cwd='D:/synthetic/reference-owner',image='D:/synthetic/reference-owner/reference-inputs/source-01.png',environments=[{environmentId:'saved-env',cwd}],restoreSettings={model:'gpt-6.2-sol',approvalPolicy:'on-request',approvalsReviewer:null,activePermissionProfile:{id:'workspace-write'},sandbox:{type:'workspaceWrite'},environments};let bound=false;
  const result=await server.runAnalysis({threadId:targetThread,cwd,imagePaths:[image],prompt:'Prepare a plan.',model:'gpt-6.2-astra',restoreSettings,onTurnStarted:()=>{bound=true;}});
  expect(result).toMatchObject({markdown,turnId:targetTurn,model:'gpt-6.2-astra',restoredModel:'gpt-6.2-sol'});expect(bound).toBe(true);
  const turn=requests.find((request:any)=>request.method==='turn/start')!,params=turn.params;
  expect(params).toMatchObject({threadId:targetThread,cwd,model:'gpt-6.2-astra',approvalPolicy:'never',sandboxPolicy:{type:'readOnly',networkAccess:false},environments:[]});
  expect(params.input[0]).toEqual({type:'text',text:'Prepare a plan.',text_elements:[]});expect(params.input[1]).toEqual({type:'localImage',path:image});
  expect(params.outputSchema).toMatchObject({type:'object',required:['markdown'],properties:{markdown:{type:'string',minLength:160,maxLength:60000}}});
  const restore=requests.find((request:any)=>request.method==='thread/settings/update')!;
  expect(restore.params).toMatchObject({threadId:targetThread,model:'gpt-6.2-sol',approvalPolicy:'on-request',approvalsReviewer:null,permissions:'workspace-write',environments});expect(restore.params).not.toHaveProperty('sandboxPolicy');
 });

 it('fails closed when the exact Astra image-capable model is unavailable',async()=>{
  const {server}=protocolFixture();server.request=async(method:string)=>method==='model/list'?{data:[{id:'gpt-6.2-sol',inputModalities:['text','image']},{id:'gpt-6.2-astra',inputModalities:['text']}]}:{};
  await expect(server.verifyAstra()).rejects.toThrow('does not confirm image input');
 });
});
