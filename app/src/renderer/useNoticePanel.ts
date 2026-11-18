import {useEffect,useRef,useState} from 'react';

const hasBlockingDialog=()=>[...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some(element=>element.getClientRects().length>0);

export function useNoticePanel(open:boolean,onClose:()=>void){
 const anchor=useRef<HTMLDivElement>(null),panel=useRef<HTMLElement>(null);
 const closeRef=useRef(onClose);
 closeRef.current=onClose;
 const [position,setPosition]=useState<{top:number;right:number}>();
 const close=(restoreFocus=false)=>{
  closeRef.current();
  const trigger=anchor.current?.querySelector('button');
  if(restoreFocus&&!trigger?.closest('[inert]'))trigger?.focus();
 };
 useEffect(()=>{
  if(!open){setPosition(undefined);return;}
  if(hasBlockingDialog()){closeRef.current();return;}
  const place=()=>{
   const rect=anchor.current?.getBoundingClientRect();
   if(rect)setPosition({top:rect.bottom+10,right:Math.max(8,innerWidth-rect.right-10)});
  };
  place();
  const outside=(event:PointerEvent|FocusEvent)=>{
   const target=event.target as Node;
   if(!anchor.current?.contains(target)&&!panel.current?.contains(target))closeRef.current();
  };
  const escape=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||event.defaultPrevented||hasBlockingDialog())return;
   event.preventDefault();
   close(true);
  };
  const observer=new MutationObserver(()=>{if(hasBlockingDialog())closeRef.current();});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-modal','hidden','open']});
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('focusin',outside);
  document.addEventListener('keydown',escape);
  window.addEventListener('resize',place);
  return ()=>{
   observer.disconnect();
   document.removeEventListener('pointerdown',outside,true);
   document.removeEventListener('focusin',outside);
   document.removeEventListener('keydown',escape);
   window.removeEventListener('resize',place);
  };
 },[open]);
 useEffect(()=>{if(open&&position)panel.current?.focus({preventScroll:true});},[open,!!position]);
 return {anchor,panel,close,style:position?{position:'fixed' as const,...position}:{position:'fixed' as const,top:0,right:8,visibility:'hidden' as const}};
}
