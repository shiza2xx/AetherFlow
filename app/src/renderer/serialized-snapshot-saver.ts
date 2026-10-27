export class SerializedSnapshotSaver<Snapshot, Result> {
 private versionValue=0;
 private savedVersionValue=0;
 private latest:Snapshot|undefined;
 private latestResult:Result|undefined;
 private errorValue:unknown;
 private pending:Promise<boolean>=Promise.resolve(true);

 constructor(private readonly clone:(value:Snapshot)=>Snapshot,private readonly persist:(value:Snapshot,version:number)=>Promise<Result>){ }
 get version(){return this.versionValue;}
 get savedVersion(){return this.savedVersionValue;}
 get dirty(){return this.savedVersionValue<this.versionValue;}
 get result(){return this.latestResult;}
 get error(){return this.errorValue;}

 enqueue(value:Snapshot){
  this.latest=this.clone(value);
  this.versionValue++;
  this.pending=this.pending.catch(()=>false).then(async()=>{
   while(this.savedVersionValue<this.versionValue){
    const savingVersion=this.versionValue,snapshot=this.latest;
    if(snapshot===undefined)throw new Error('No current snapshot is available to save.');
    const immutableSnapshot=this.clone(snapshot),result=await this.persist(immutableSnapshot,savingVersion);
    this.latestResult=result;
    this.errorValue=undefined;
    this.savedVersionValue=savingVersion;
   }
   return true;
  }).catch(error=>{this.errorValue=error;return false;});
  return this.pending;
 }

 async flush(){
  while(this.dirty){const expected=this.versionValue;if(!await this.pending)return null;if(this.savedVersionValue<expected&&this.versionValue===expected)return null;}
  return this.latestResult??null;
 }
}

export function cloneMarkupSnapshot<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T;}
