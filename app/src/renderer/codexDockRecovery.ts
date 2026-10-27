export type CodexLocale='en'|'ru';
export type OwnerToken={key:string;generation:number};

export class OwnerResponseGate{
 private generation=0;
 constructor(private key:string){}
 update(key:string){if(this.key!==key){this.key=key;this.generation++;}}
 capture():OwnerToken{return {key:this.key,generation:this.generation};}
 isCurrent(token:OwnerToken){return token.key===this.key&&token.generation===this.generation;}
 apply(token:OwnerToken,action:()=>void){if(!this.isCurrent(token))return false;action();return true;}
}

export function recoveryErrorText(code:string,message:string,locale:CodexLocale){
 if(code==='SESSION_RECOVERY_REQUIRED')return locale==='ru'
  ?'Не удалось безопасно определить сессию Codex. Повторите проверку или явно создайте отдельный чат.'
  :'AetherFlow could not safely identify this Codex session. Retry verification or explicitly start a separate chat.';
 if(code==='SESSION_METADATA_CONFLICT')return locale==='ru'
  ?'Локальные метаданные сессии Codex противоречат друг другу. Повторите проверку; отдельный чат можно создать явно.'
  :'Local Codex session metadata conflicts. Retry verification, or explicitly start a separate chat.';
 return message;
}
