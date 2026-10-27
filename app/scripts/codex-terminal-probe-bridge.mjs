const escape='\u001b';
function colorReply(value){
 const hex=String(value||'').match(/^#([0-9a-f]{6})$/i)?.[1];
 if(!hex)return null;
 return `rgb:${hex.slice(0,2).repeat(2)}/${hex.slice(2,4).repeat(2)}/${hex.slice(4,6).repeat(2)}`;
}

/** Answers only startup-compatible terminal queries in the native PTY path. */
export function createCodexTerminalProbeBridge({foreground,background}={}){
 let foregroundReply=colorReply(foreground),backgroundReply=colorReply(background);
 const setColors=(nextForeground,nextBackground)=>{
  if(nextForeground!==undefined)foregroundReply=colorReply(nextForeground);
  if(nextBackground!==undefined)backgroundReply=colorReply(nextBackground);
 };
 let pending='';
 function consume(chunk,writeReply){
  pending+=String(chunk||'');let output='',cursor=0,responses=0;
  while(cursor<pending.length){
   if(pending.charCodeAt(cursor)!==0x1b){output+=pending[cursor++];continue;}
   if(cursor+1>=pending.length)break;
   const next=pending[cursor+1];
   if(next==='['){
    let end=cursor+2;while(end<pending.length){const code=pending.charCodeAt(end);if(code>=0x40&&code<=0x7e)break;end++;}
    if(end>=pending.length){if(pending.length-cursor<=128)break;output+=pending[cursor++];continue;}
    const sequence=pending.slice(cursor,end+1);
    if(/^\u001b\[(?:0)?c$/.test(sequence)){writeReply(`${escape}[?1;2c`);responses++;}
    else if(/^\u001b\[>(?:0)?c$/.test(sequence)){writeReply(`${escape}[>0;276;0c`);responses++;}
    output+=sequence;cursor=end+1;continue;
   }
   if(next===']'){
    const bel=pending.indexOf('\u0007',cursor+2),st=pending.indexOf(`${escape}\\`,cursor+2),end=bel<0?st:st<0?bel:Math.min(bel,st);
    if(end<0){if(pending.length-cursor<=256)break;output+=pending[cursor++];continue;}
    const terminatorLength=pending[end]==='\u0007'?1:2,sequence=pending.slice(cursor,end+terminatorLength),payload=pending.slice(cursor+2,end);
    const match=/^(10|11);\?$/.exec(payload);
    if(match){const slot=match[1],rgb=slot==='10'?foregroundReply:backgroundReply;if(rgb){writeReply(`${escape}]${slot};${rgb}\u0007`);responses++;}}
    output+=sequence;cursor=end+terminatorLength;continue;
   }
   output+=pending.slice(cursor,cursor+2);cursor+=2;
  }
  pending=pending.slice(cursor);
  return{output,responses};
 }
 function flush(){const result=pending;pending='';return result;}
 return{consume,flush,setColors};
}
