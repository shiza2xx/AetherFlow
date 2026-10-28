import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
const GROUPS='.viewer-model-actions,.viewer-camera-actions,.notebook-toolbar,.codex-dock-title,.sidebar-collapsed .sidebar,.codex-launcher.is-compact';
type Tip={target:HTMLElement;group:Element;label:string;keyboard:boolean};
export function SharedTooltips(){
 const [tip,setTip]=useState<Tip|null>(null),bubble=useRef<HTMLDivElement>(null),previous=useRef<DOMRect|null>(null),active=useRef<Tip|null>(null);
 useEffect(()=>{let delay:ReturnType<typeof setTimeout>,leave:ReturnType<typeof setTimeout>,warmUntil=0,warmGroup:Element|null=null;
  const clear=()=>{clearTimeout(delay);clearTimeout(leave)};
  const enter=(event:Event)=>{if(event.type==='pointerover'&&((event as PointerEvent).pointerType==='touch'||!matchMedia('(hover:hover) and (pointer:fine)').matches))return;const target=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null,group=target?.closest(GROUPS);if(!target||!group||target.closest('[inert]'))return;
   const label=target.dataset.tooltip||target.getAttribute('aria-label')||target.getAttribute('title');if(!label)return;
   const originalTitle=target.getAttribute('title');if(originalTitle){target.dataset.tooltipOriginalTitle=originalTitle;target.removeAttribute('title')}
   clear();const next={target,group,label,keyboard:event.type==='focusin'},same=active.current?.group===group;
   const show=()=>{active.current=next;setTip(next);warmUntil=Date.now()+650;warmGroup=group};
   if(next.keyboard||same||Date.now()<warmUntil&&warmGroup===group)show();else delay=setTimeout(show,350);
  };
  const exit=(event:Event)=>{const e=event as PointerEvent;const from=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null;if(from?.dataset.tooltipOriginalTitle){from.title=from.dataset.tooltipOriginalTitle;delete from.dataset.tooltipOriginalTitle}
   if(e.relatedTarget instanceof Element&&e.relatedTarget.closest(GROUPS)===active.current?.group)return;
   clearTimeout(delay);leave=setTimeout(()=>{active.current=null;setTip(null);warmUntil=Date.now()+500},100);
  };
  const move=()=>{if(active.current)setTip({...active.current})};
  document.addEventListener('pointerover',enter);document.addEventListener('pointerout',exit);document.addEventListener('focusin',enter);document.addEventListener('focusout',exit);window.addEventListener('resize',move);document.addEventListener('scroll',move,true);
  return()=>{clear();document.removeEventListener('pointerover',enter);document.removeEventListener('pointerout',exit);document.removeEventListener('focusin',enter);document.removeEventListener('focusout',exit);window.removeEventListener('resize',move);document.removeEventListener('scroll',move,true)};
 },[]);
 useLayoutEffect(()=>{const element=bubble.current;if(!tip||!element)return;const anchor=tip.target.getBoundingClientRect(),rect=element.getBoundingClientRect(),x=Math.max(10,Math.min(anchor.left+anchor.width/2-rect.width/2,window.innerWidth-rect.width-10)),y=anchor.top-rect.height-9>=50?anchor.top-rect.height-9:Math.min(window.innerHeight-rect.height-10,anchor.bottom+9);
  const rail=tip.group.matches('.sidebar,.codex-launcher.is-compact');element.style.left=(rail?Math.min(window.innerWidth-rect.width-10,anchor.right+10):x)+'px';element.style.top=(rail?Math.max(50,Math.min(window.innerHeight-rect.height-10,anchor.top+(anchor.height-rect.height)/2)):y)+'px';const old=previous.current?rect:null,box=element.getBoundingClientRect();previous.current=box;
  const reduced=document.documentElement.dataset.motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!tip.keyboard&&!reduced){element.getAnimations().forEach(animation=>animation.cancel());element.animate([{opacity:old?1:0,transform:old?`translate(${old.left-box.left}px,${old.top-box.top}px) scaleX(${old.width/box.width})`:'translateY(3px) scale(.97)'},{opacity:1,transform:'none'}],{duration:125,easing:'cubic-bezier(.23,1,.32,1)'})}
  const described=tip.target.getAttribute('aria-describedby');tip.target.setAttribute('aria-describedby',[described,'aetherflow-shared-tooltip'].filter(Boolean).join(' '));
  return()=>{if(described)tip.target.setAttribute('aria-describedby',described);else tip.target.removeAttribute('aria-describedby')};
 },[tip]);
 if(!tip){previous.current=null;return null}return createPortal(<div id="aetherflow-shared-tooltip" className="shared-tool-tip" ref={bubble} role="tooltip">{tip.label}</div>,document.body);
}
