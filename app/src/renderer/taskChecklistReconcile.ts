export type ChecklistItem={id:string;text:string;completed:boolean};

export function reconcileChecklist(base:ChecklistItem[],requested:ChecklistItem[]):(current:ChecklistItem[])=>ChecklistItem[]{
  const before=new Map(base.map(item=>[item.id,item])),after=new Map(requested.map(item=>[item.id,item]));
  const removed=new Set(base.filter(item=>!after.has(item.id)).map(item=>item.id));
  const changed=requested.flatMap(item=>{const old=before.get(item.id);if(!old)return [[item.id,{text:item.text,completed:item.completed}] as const];const patch:Partial<ChecklistItem>={};if(old.text!==item.text)patch.text=item.text;if(old.completed!==item.completed)patch.completed=item.completed;return Object.keys(patch).length?[[item.id,patch] as const]:[];});
  const requestedOrder=requested.map(item=>item.id);
  const reordered=base.some((item,index)=>requestedOrder[index]!==item.id);
  return current=>{
    let next=current.filter(item=>!removed.has(item.id)).map(item=>{const patch=changed.find(([id])=>id===item.id)?.[1];return patch?{...item,...patch}:item;});
    for(const [id,patch] of changed)if(!before.has(id)&&!next.some(existing=>existing.id===id))next.push({id,...patch} as ChecklistItem);
    if(reordered){const positions=new Map(requestedOrder.map((id,index)=>[id,index]));const selected=next.filter(item=>positions.has(item.id)).sort((a,b)=>positions.get(a.id)!-positions.get(b.id)!);const tail=next.filter(item=>!positions.has(item.id));next=[...selected,...tail];}
    return next;
  };
}
