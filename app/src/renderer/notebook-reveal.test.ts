import {describe,expect,it} from 'vitest';
import {NotebookRevealGeneration} from './notebook-reveal';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
describe('Notebook reveal cancellation',()=>{
 it('ignores delayed list and get responses after hide, navigation, or MCP route changes',async()=>{const generation=new NotebookRevealGeneration();let mounted=false;
  const list=deferred<string>(),listTicket=generation.begin();const pendingList=list.promise.then(()=>{if(generation.accepts(listTicket,true))mounted=true;});generation.invalidate();list.resolve('old-scope');await pendingList;expect(mounted).toBe(false);
  const delayedGet=deferred<string>(),getTicket=generation.begin();const pendingGet=delayedGet.promise.then(()=>{if(generation.accepts(getTicket,true))mounted=true;});await Promise.resolve();generation.invalidate();delayedGet.resolve('late-note');await pendingGet;expect(mounted).toBe(false);
  const routeGet=deferred<string>(),routeTicket=generation.begin();const pendingRoute=routeGet.promise.then(()=>{if(generation.accepts(routeTicket,false))mounted=true;});routeGet.resolve('mcp-route-note');await pendingRoute;expect(mounted).toBe(false);
 });
});
