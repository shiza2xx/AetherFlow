/** Cancels async list/get work whenever a human or app transition conceals the view. */
export class NotebookRevealGeneration {
  private generation=0;
  begin(){return ++this.generation;}
  invalidate(){this.generation++;}
  accepts(ticket:number,eligible:boolean){return eligible&&ticket===this.generation;}
}
