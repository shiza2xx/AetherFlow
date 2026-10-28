import {useLayoutEffect,useRef,useSyncExternalStore,type HTMLAttributes} from 'react';
import {createPortal} from 'react-dom';
const layers:HTMLDivElement[]=[],listeners=new Set<()=>void>();let originalInert=false;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export function useWindowModalOpen(){return useSyncExternalStore(subscribe,()=>layers.length>0);}
function synchronize(){const root=document.getElementById('root');if(root)root.inert=layers.length>0||originalInert;layers.forEach((layer,index)=>{layer.inert=index<layers.length-1;layer.style.zIndex=String(1000+index)});listeners.forEach(listener=>listener());}
/** Mandatory dialogs share the window layer, independently of page stacking contexts. */
export function WindowLayer(props:HTMLAttributes<HTMLDivElement>){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const element=ref.current;if(!element)return;if(!layers.length)originalInert=document.getElementById('root')?.inert===true;layers.push(element);synchronize();return()=>{const index=layers.indexOf(element);if(index>=0)layers.splice(index,1);synchronize()}},[]);
 return createPortal(<div className="studio-shell window-modal-context" style={{display:'contents'}}><div {...props} ref={ref}/></div>,document.body);
}
