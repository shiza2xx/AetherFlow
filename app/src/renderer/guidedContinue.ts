export function revisitedStepDestination(steps:{key:string;state:string;canOpen:boolean}[],activeKey:string,currentKey:string){
 const index=steps.findIndex(step=>step.key===activeKey);
 if(index<0||activeKey===currentKey||steps[index].state!=='complete')return null;
 const next=steps[index+1];
 return next?.canOpen?next.key:null;
}
