type DomainEvent={workspace?:unknown;entities?:Array<{id?:unknown;kind?:unknown}>};

/** Refresh only when the open character or its workflow changed. */
export function guidedDomainEventAffectsCharacter(event:DomainEvent,characterId:string,workflowId?:string){
  if(!Array.isArray(event?.entities))return false;
  // The open workflow ID is a precise signal, independent of path formatting
  // in the event's workspace field. Avoid refreshing for unrelated records.
  return event.entities.some(entity=>typeof entity?.id==='string'&&(entity.id===characterId||!!workflowId&&entity.id===workflowId));
}
