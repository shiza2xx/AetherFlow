import {useEffect,useRef} from 'react';

type Props={locale:string;motion?:'full'|'reduced'};
export default function StudioEyeTracker({locale,motion='full'}:Props){
 const root=useRef<HTMLSpanElement>(null),frame=useRef(0),bounds=useRef<DOMRect|null>(null),point=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{
  const node=root.current;if(!node||motion==='reduced')return;
  const measure=()=>{if(root.current)bounds.current=root.current.getBoundingClientRect()};
  measure();const observer=new ResizeObserver(measure);observer.observe(node);window.addEventListener('resize',measure,{passive:true});
  const move=(event:PointerEvent)=>{point.current={x:event.clientX,y:event.clientY};if(frame.current)return;frame.current=requestAnimationFrame(()=>{frame.current=0;const rect=bounds.current,p=point.current,el=root.current;if(!rect||!p||!el)return;const dx=p.x-(rect.left+rect.width/2),dy=p.y-(rect.top+rect.height/2),distance=Math.max(80,Math.hypot(dx,dy)),nx=dx/distance,ny=dy/distance;el.style.setProperty('--tracker-x',`${nx*3.5}px`);el.style.setProperty('--tracker-y',`${ny*2.5}px`);el.style.setProperty('--cube-turn',`${nx*3}deg`);});};
  window.addEventListener('pointermove',move,{capture:true,passive:true});
  return()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('resize',measure);observer.disconnect();if(frame.current)cancelAnimationFrame(frame.current);frame.current=0;};
 },[motion]);
 return <span ref={root} className={`eye-tracker${motion==='reduced'?' is-reduced':''}`} aria-label={locale==='ru'?'Глаза следят за указателем':'AetherFlow Studio eyes follow the pointer'} aria-hidden="true"><span className="eye-tracker-cube"><i/><i/></span></span>;
}
