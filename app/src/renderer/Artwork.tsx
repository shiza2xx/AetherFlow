import {useEffect,useRef,useState} from 'react';
import {FileImage,RotateCcw} from 'lucide-react';
import {call} from './api';
import type {Locale} from '../shared/i18n';
import {artworkPreviewAfterLoad,artworkPreviewForIdentity,artworkPreviewIdentity,type ArtworkPreview} from './artworkPreview';

export function referenceIds(data:Record<string,any>){
  return [...new Set([...(Array.isArray(data.referenceArtifactIds)?data.referenceArtifactIds:[]),data.referenceArtifactId].filter((id):id is string=>typeof id==='string'&&Boolean(id)))];
}
export function Artwork({id,path,alt,locale='en',lazy=true,full=false,workspace}:{id?:string;path?:string;alt:string;locale?:Locale;lazy?:boolean;full?:boolean;workspace?:string}){
  const host=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(!lazy),[attempt,setAttempt]=useState(0);
  const identity=artworkPreviewIdentity(workspace,id,path,full),[preview,setPreview]=useState<ArtworkPreview>(()=>({identity}));
  const state=artworkPreviewForIdentity(preview,identity);
  useEffect(()=>{
    if(!lazy){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(item=>item.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'160px'});
    if(host.current)observer.observe(host.current);return ()=>observer.disconnect();
  },[lazy,id,path]);
  useEffect(()=>{
    let active=true;
    setPreview(current=>artworkPreviewForIdentity(current,identity));
    if(visible&&(id||path))void call(id?{op:full?'asset:url':'asset:thumbnail',id}:{op:'file:gallery-preview',path:path!}).then(result=>{
      if(active)setPreview(current=>artworkPreviewAfterLoad(current,identity,result.ok?{url:result.data.url}:{error:result.error.message}));
    });
    return ()=>{active=false;};
  },[visible,identity,id,path,attempt,full]);
  const ru=locale==='ru';
  return <div className="artwork-preview" ref={host} data-preview-state={state.error?'error':state.url?'ready':id||path?'loading':'empty'}>
    {state.url?<img src={state.url} alt={alt} onError={()=>setPreview({identity,error:'Image preview could not be displayed.'})}/>:<div className="artwork-placeholder"><FileImage size={25}/><span>{state.error?(ru?'Не удалось показать превью':'Preview unavailable'):(id||path)?(ru?'Загрузка изображения…':'Loading artwork…'):(ru?'Исходное изображение не добавлено':'No source art attached')}</span>{state.error&&<button type="button" className="text-button" title={state.error} onClick={()=>setAttempt(value=>value+1)}><RotateCcw size={13}/>{ru?'Повторить':'Retry'}</button>}</div>}
  </div>;
}
