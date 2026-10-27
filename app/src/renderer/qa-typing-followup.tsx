import React,{Profiler,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Entity} from '../shared/contracts';
import type {StudioUiContext} from '../shared/studio-contracts';
import ModelWorkbench from './ModelWorkbench';

declare global {
  interface Window {
    qaTyping: {
      config:()=>Promise<{character:Entity;sourceA:string;sourceB:string;workspace:string;workspaceInstanceId:string}>;
      call:(rpc:any)=>Promise<any>;
      recordUi:(value:Partial<StudioUiContext>)=>Promise<void>;
      summary:()=>Promise<any>;
    };
    __qaModelWorkbenchProfiler?:number;
    __qaGLStats:{collecting:boolean;drawCalls:number;clearCalls:number;wrapped:string[]};
    __qaTypingMetrics:{latencies:number[];inputCount:number;lastInputTime:number};
    __qaViewerBeforeTyping:{renders:number;raycastBuilds:number;textureTargetPrepares:number};
    __atelierQaViewerMetrics:{renders:number;raycastBuilds:number;textureTargetPrepares:number};
  }
}

function QaRoot({config}:{config:{character:Entity;sourceA:string;sourceB:string;workspace:string;workspaceInstanceId:string}}){
  const [artifactId,setArtifactId]=useState(config.sourceA);
  const profilerCommits=useRef(0);
  const onProfile=()=>{window.__qaModelWorkbenchProfiler=++profilerCommits.current;};
  return <>
    <button className="qa-switch" data-testid="qa-switch-source" onClick={()=>setArtifactId(config.sourceB)}>Switch synthetic source</button>
    <Profiler id="model-workbench" onRender={onProfile}>
      <ModelWorkbench character={config.character} locale="ru" workspace={config.workspace} workspaceInstanceId={config.workspaceInstanceId} initialArtifactId={artifactId} onClose={()=>{}} onRefresh={()=>{}} onNotify={()=>{}} onUiContext={value=>{void window.qaTyping.recordUi(value);}}/>
    </Profiler>
  </>;
}

void window.qaTyping.config().then(config=>createRoot(document.getElementById('root')!).render(<QaRoot config={config}/>));
