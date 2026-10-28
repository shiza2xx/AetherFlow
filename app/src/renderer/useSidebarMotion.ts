import {useEffect,useRef,type PointerEvent as ReactPointerEvent} from 'react';

export function sidebarDragProgress(start:number,delta:number,width:number){return Math.max(0,Math.min(1,start+delta/Math.max(1,width)));}
export function useSidebarMotion(collapsed:boolean,onChange:(collapsed:boolean)=>void,disabled:boolean){
 const sidebar=useRef<HTMLElement>(null),handle=useRef<HTMLButtonElement>(null),latest=useRef({collapsed,onChange,disabled});latest.current={collapsed,onChange,disabled};
 const gesture=useRef<{id:number;target:HTMLElement;startX:number;start:number;width:number;compactWidth:number;moved:boolean}|null>(null),suppressClick=useRef(false),frame=useRef(0);
 const reset=()=>{for(const el of [sidebar.current,handle.current]){if(!el)continue;el.style.removeProperty('transition');el.style.removeProperty('transform');el.style.removeProperty('visibility');el.style.removeProperty('width');el.removeAttribute('data-dragging');}};
 const settle=()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(reset)};
 useEffect(()=>()=>{cancelAnimationFrame(frame.current)},[]);
 const start=(event:ReactPointerEvent<HTMLElement>)=>{
  const panel=sidebar.current;if(!panel||latest.current.disabled||event.button!==0||event.isPrimary===false)return;
  const target=event.target instanceof Element?event.target:null;
  if(event.currentTarget===panel&&event.pointerType==='touch')return;
  if(event.currentTarget===panel&&target?.closest('button,a,input,textarea,select,[contenteditable],summary,[role=button]'))return;
  suppressClick.current=false;cancelAnimationFrame(frame.current);const rect=panel.getBoundingClientRect(),style=getComputedStyle(panel),compactWidth=parseFloat(style.getPropertyValue('--studio-compact-width'))||72,expandedWidth=parseFloat(style.getPropertyValue('--studio-navigation-width'))||232,width=Math.max(1,expandedWidth-compactWidth),progress=Math.max(0,Math.min(1,(rect.width-compactWidth)/width));
  gesture.current={id:event.pointerId,target:event.currentTarget,startX:event.clientX,start:progress,width,compactWidth,moved:false};
  for(const el of [panel,handle.current])if(el){el.style.transition='none';el.dataset.dragging='true';}
  panel.style.setProperty('width',`${compactWidth+progress*width}px`,'important');
  if(handle.current)handle.current.style.transform=`translateX(${Math.max(0,compactWidth+progress*width-12)}px)`;
  event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();handle.current?.focus({preventScroll:true});
 };
 const move=(event:ReactPointerEvent<HTMLElement>)=>{const g=gesture.current;if(!g||g.id!==event.pointerId)return;const delta=event.clientX-g.startX;if(Math.abs(delta)>4)g.moved=true;const progress=sidebarDragProgress(g.start,delta,g.width);if(sidebar.current)sidebar.current.style.setProperty('width',`${g.compactWidth+progress*g.width}px`,'important');if(handle.current)handle.current.style.transform=`translateX(${Math.max(0,g.compactWidth+progress*g.width-12)}px)`;event.preventDefault();};
 const finish=(event:ReactPointerEvent<HTMLElement>,cancel=false)=>{const g=gesture.current;if(!g||g.id!==event.pointerId)return;gesture.current=null;if(g.moved){suppressClick.current=true;if(!cancel){const progress=sidebarDragProgress(g.start,event.clientX-g.startX,g.width);latest.current.onChange(latest.current.collapsed?progress<.35:progress<.65);}}if(g.target.hasPointerCapture(g.id))g.target.releasePointerCapture(g.id);settle();};
 const choose=(value:boolean,animate=true)=>{if(latest.current.disabled)return;cancelAnimationFrame(frame.current);gesture.current=null;if(!animate)for(const el of [sidebar.current,handle.current])if(el)el.style.transition='none';latest.current.onChange(value);frame.current=animate?requestAnimationFrame(reset):requestAnimationFrame(()=>{frame.current=requestAnimationFrame(reset)});};
 return {sidebar,handle,start,move,finish,cancel:(event:ReactPointerEvent<HTMLElement>)=>finish(event,true),click:(event:React.MouseEvent)=>{if(event.detail>0&&suppressClick.current){suppressClick.current=false;return;}choose(!latest.current.collapsed,event.detail>0);},key:(event:React.KeyboardEvent)=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();choose(event.key==='ArrowLeft',false);}else if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopPropagation();const g=gesture.current;gesture.current=null;suppressClick.current=true;if(g?.target.hasPointerCapture(g.id))g.target.releasePointerCapture(g.id);settle();}}};
}
