import type {ReactNode} from 'react';

/** Kept as a compatibility export for existing call sites. Decorative surface
 * layers have been removed; card, button and Stepper DOM keeps its own layout
 * and motion without drawing a second material over the content. */
export function GlassSurfaceLayer(_props:{className?:string;as?:'div'|'span'}){
 return null;
}

/** Compatibility wrapper for callers that still use the old component name.
 * The surface is an ordinary opaque app panel in both themes. */
export default function GlassPanel({children,className=''}:{children:ReactNode;className?:string}){
 return <div className={`aetherflow-glass ${className}`}><div className="aetherflow-glass-content">{children}</div></div>;
}
