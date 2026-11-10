import fs from 'node:fs';
import path from 'node:path';

type IconWindow={isDestroyed:()=>boolean;setIcon:(icon:string)=>void;setAppDetails?:(options:{appId:string;appIconPath:string;appIconIndex:number})=>void};
export class WindowIconController{
 private applied=new WeakMap<IconWindow,string>();
 constructor(private root:string,private packaged:boolean,private platform:string=process.platform){}
 get appUserModelId(){return this.packaged?'com.aetherflow.studio':'com.aetherflow.studio.source';}
 pathForTheme(_theme:string){
  const icon=path.join(this.root,this.packaged?'branding':'build/icons','app-icon-dark.ico');
  if(fs.existsSync(icon))return icon;
  const fallback=path.join(this.root,this.packaged?'branding':'src/renderer/assets','aetherflow-dark.png');return fs.existsSync(fallback)?fallback:undefined;
 }
 apply(window:IconWindow,theme:string){
  if(window.isDestroyed())return false;const icon=this.pathForTheme(theme);if(!icon||this.applied.get(window)===icon)return false;
  window.setIcon(icon);
  if(this.platform==='win32')window.setAppDetails?.({appId:this.appUserModelId,appIconPath:icon,appIconIndex:0});
  this.applied.set(window,icon);return true;
 }
}
