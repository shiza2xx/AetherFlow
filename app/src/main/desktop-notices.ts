import {BrowserWindow,screen} from 'electron';
import type {ProductionNotice} from '../shared/production-notices';

const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const duration=6000;
const exitDuration=260;

export function desktopNoticeBounds(area:Electron.Rectangle,contentHeight=96){
 const margin=16;
 const width=Math.max(1,Math.min(316,area.width-2*margin));
 const height=Math.max(1,Math.min(contentHeight,area.height-2*margin));
 return {width,height,x:area.x+Math.max(0,area.width-width-margin),y:area.y+Math.max(0,area.height-height-margin)};
}

function documentFor(notice:ProductionNotice,locale:'en'|'ru',motion:'full'|'reduced'){
 return `<!doctype html><html lang="${locale}" data-motion="${motion}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>AetherFlow</title>
 <style>
 html{color-scheme:dark;font:14px "Segoe UI",sans-serif}
 body{margin:0;padding:5px 6px 14px;overflow:hidden;background:transparent;color:#f3f7ff}
 .notice{box-sizing:border-box;display:grid;grid-template-columns:23px minmax(0,1fr);gap:8px;padding:9px 11px;border:1px solid rgba(197,213,244,.24);border-radius:13px;background:rgba(20,24,34,.89);box-shadow:0 2px 6px rgba(0,0,0,.28);overflow-wrap:anywhere}
 .mark{display:grid;place-items:center;width:23px;height:23px;margin-top:1px;border-radius:8px;background:rgba(133,229,192,.16);color:#9beccc}
 .mark::after{content:"";width:8px;height:4px;margin-top:-2px;border:solid currentColor;border-width:0 0 2px 2px;transform:rotate(-45deg)}
 .heading{display:flex;align-items:baseline;justify-content:space-between;gap:6px}
 small{flex:none;color:#c8d2e4;font-size:10px;line-height:12px}
 h1{margin:0;font-size:13px;line-height:17px;font-weight:650}
 p{margin:2px 0 0;font-size:12px;line-height:15px}
 .detail{color:#c8d2e4;font-size:11px;line-height:14px}
 html[data-motion="full"] .notice{opacity:0}
 html[data-motion="full"][data-phase="enter"] .notice{animation:arrive 340ms cubic-bezier(.2,.7,.3,1) both}
 html[data-motion="full"][data-phase="exit"] .notice{animation:depart ${exitDuration}ms ease-in both}
 @keyframes arrive{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
 @keyframes depart{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(9px)}}
 </style>
 <article class="notice"><span class="mark" aria-hidden="true"></span><div><header class="heading"><h1>${escapeHtml(notice.title)}</h1><small>AetherFlow</small></header>${notice.subject?`<p class="subject">${escapeHtml(notice.subject)}</p>`:''}${notice.detail?`<p class="detail">${escapeHtml(notice.detail)}</p>`:''}</div></article></html>`;
}

export class DesktopNotices {
 private window?:BrowserWindow;
 private timer?:ReturnType<typeof setTimeout>;
 private readonly queue:Array<{notice:ProductionNotice;locale:'en'|'ru';motion:'full'|'reduced'}>=[];

 constructor(private readonly mainWindow:()=>BrowserWindow|undefined){}

 enqueue(notice:ProductionNotice,locale:'en'|'ru',motion:'full'|'reduced'){
  if(process.platform!=='win32')return;
  this.queue.push({notice,locale,motion});
  if(this.queue.length>3)this.queue.shift();
  if(!this.window)void this.showNext();
 }

 clear(){
  this.queue.length=0;
  this.closeCard();
 }

 private closeCard(){
  clearTimeout(this.timer);
  const card=this.window;
  this.window=undefined;
  if(card&&!card.isDestroyed())card.destroy();
 }

 private finishCard(card:BrowserWindow){
  if(this.window!==card)return;
  this.closeCard();
  void this.showNext();
 }

 private animateExit(card:BrowserWindow){
  if(this.window!==card)return;
  if(card.isDestroyed()){this.finishCard(card);return;}
  this.timer=setTimeout(()=>this.finishCard(card),exitDuration+300);
  void card.webContents.executeJavaScript(`(() => {
   document.documentElement.dataset.phase = 'exit';
   return document.querySelector('.notice').getAnimations()[0]?.finished.then(() => {});
  })()`).then(()=>this.finishCard(card),()=>this.finishCard(card));
 }

 private async showNext(){
  const main=this.mainWindow(),next=this.queue.shift();
  if(!next||!main||main.isDestroyed()||(main.isFocused()&&!main.isMinimized())){this.clear();return;}
  let card:BrowserWindow|undefined;
  try{
   const display=screen.getDisplayMatching(main.isMinimized()?main.getNormalBounds():main.getBounds());
   card=new BrowserWindow({
    ...desktopNoticeBounds(display.workArea),show:false,alwaysOnTop:true,frame:false,focusable:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,
    skipTaskbar:true,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,
    webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,devTools:false,backgroundThrottling:false},
   });
   this.window=card;
   card.setIgnoreMouseEvents(true);
   card.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   card.webContents.on('will-navigate',event=>event.preventDefault());
   await card.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentFor(next.notice,next.locale,next.motion))}`);
   const contentHeight=await card.webContents.executeJavaScript(`Math.ceil(document.querySelector('.notice').getBoundingClientRect().bottom + parseFloat(getComputedStyle(document.body).paddingBottom))`);
   if(this.window!==card||card.isDestroyed())return;
   if(main.isDestroyed()||(main.isFocused()&&!main.isMinimized())){this.clear();return;}
   const visibleCard=card;
   visibleCard.setBounds(desktopNoticeBounds(display.workArea,contentHeight));
   visibleCard.showInactive();
   if(next.motion==='full'){
    // Leave a painted frame after the native window becomes visible before starting the CSS animation.
    void visibleCard.webContents.executeJavaScript(`setTimeout(() => {
     requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.dataset.phase = 'enter';
     }));
    }, 65)`).catch(()=>{});
    this.timer=setTimeout(()=>this.animateExit(visibleCard),duration-exitDuration);
   }else{
    this.timer=setTimeout(()=>this.finishCard(visibleCard),duration);
   }
  }catch{
   if(!card||this.window===card){this.closeCard();void this.showNext();}
  }
 }
}
