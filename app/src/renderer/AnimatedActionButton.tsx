import {forwardRef,useSyncExternalStore} from 'react';
import type {ButtonHTMLAttributes,MouseEvent,PointerEvent,FocusEvent,ReactNode} from 'react';
import UseAnimations from 'react-useanimations';
import type {Animation} from 'react-useanimations';
import './animated-action-icon.css';

const subscribeMotion=(notify:()=>void)=>{
 const observer=new MutationObserver(notify);
 observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
 return ()=>observer.disconnect();
};
const reducedMotion=()=>typeof document!=='undefined'&&document.documentElement.dataset.motion==='reduced';

type Props=ButtonHTMLAttributes<HTMLButtonElement>&{animation:Animation;iconSize?:number;interaction?:'hover'|'hover-replay';children?:ReactNode};

/** Keep the existing semantic button as the animation's hover and focus target. */
const AnimatedActionButton=forwardRef<HTMLButtonElement,Props>(function AnimatedActionButton({animation,iconSize=16,interaction='hover-replay',children,className,onMouseEnter,onMouseLeave,onPointerEnter,onFocus,onBlur,...button},ref){
 const reduced=useSyncExternalStore(subscribeMotion,reducedMotion,()=>false);
 return <UseAnimations key={reduced?'reduced':'full'} animation={animation} size={iconSize} interaction={interaction} render={(events,icon)=><button {...button} ref={ref} className={`animated-action-button${className?' '+className:''}`}
  onMouseEnter={(event:MouseEvent<HTMLButtonElement>)=>{onMouseEnter?.(event);if(!reduced&&!event.defaultPrevented)events.onMouseEnter(event)}}
  onMouseLeave={(event:MouseEvent<HTMLButtonElement>)=>{onMouseLeave?.(event);if(!reduced&&!event.defaultPrevented)events.onMouseLeave(event)}}
  onPointerEnter={(event:PointerEvent<HTMLButtonElement>)=>{onPointerEnter?.(event);if(!reduced&&!event.defaultPrevented)events.onPointerEnter(event)}}
  onFocus={(event:FocusEvent<HTMLButtonElement>)=>{onFocus?.(event);if(!reduced&&!event.defaultPrevented)events.onFocus(event)}}
  onBlur={(event:FocusEvent<HTMLButtonElement>)=>{onBlur?.(event);if(!reduced&&!event.defaultPrevented)events.onBlur(event)}}>
  <span {...icon}/>{children}
 </button>}/>;
});

export default AnimatedActionButton;
