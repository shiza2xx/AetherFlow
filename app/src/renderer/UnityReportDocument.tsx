import React, {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, ChevronDown, ClipboardList, Film, ImagePlus, Images, Info, Maximize2, Play, RefreshCw, Square} from 'lucide-react';
import type {Entity} from '../shared/contracts';
import type {Locale} from '../shared/i18n';
import {call} from './api';
import './unityReportDocument.css';
import UnityReportVideo from './UnityReportVideo';
import UnityReportVideoPair from './UnityReportVideoPair';

type Role = 'before'|'after'|'video'|'gif'|'beforeVideo'|'afterVideo';
type Mode = Role|'compare';
type Props = {entity:Entity; locale:Locale; workspace?:string; onBack:()=>void; onDetails:()=>void; onAttach:(role?:'before'|'after'|'beforeVideo'|'afterVideo')=>void; onNotify:(notice:any)=>void};
type Evidence = {files:Partial<Record<Role,Entity>>; urls:Partial<Record<Role,string>>; errors:Partial<Record<Role,string>>};
type VideoView = {id:string;label:string;before?:Entity;after?:Entity;beforeUrl?:string;afterUrl?:string;missingEvidence?:Record<string,string>};
const roles:Role[] = ['before','after','video','gif','beforeVideo','afterVideo'];
const isGif = (file:Entity) => String(file.data.mime || '').toLowerCase()==='image/gif' || /\.gif$/i.test(file.name);
const owns=(value:any,key:string)=>Object.prototype.hasOwnProperty.call(value||{},key);
const initialMode=(entity:Entity):Mode=>entity.data.videoArtifactId||owns(entity.data,'beforeVideoArtifactId')||owns(entity.data,'afterVideoArtifactId')||owns(entity.data.missingEvidence,'beforeVideo')||owns(entity.data.missingEvidence,'afterVideo')?'video':entity.data.gifArtifactId?'gif':'video';

export default function UnityReportDocument({entity,locale,workspace,onBack,onDetails,onAttach,onNotify}:Props) {
  const ru=locale==='ru';
  const [evidence,setEvidence]=useState<Evidence>({files:{},urls:{},errors:{}});
  const [videoViews,setVideoViews]=useState<VideoView[]>([]),[selectedViewId,setSelectedViewId]=useState(''),[viewUrls,setViewUrls]=useState<{key:string;before?:string;after?:string;errors?:{before?:string;after?:string}}>({key:''}),[viewRetry,setViewRetry]=useState(0),[viewProgress,setViewProgress]=useState<{time:number;duration:number}>({time:0,duration:0});
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0);
  const [mode,setMode]=useState<Mode>(initialMode(entity));
  const [fit,setFit]=useState<'fit'|'native'>('fit'),[playing,setPlaying]=useState(true);
  const [documentVisible,setDocumentVisible]=useState(!document.hidden),[windowVisible,setWindowVisible]=useState(true);
  const initialized=useRef('');

  useEffect(()=>{
    initialized.current='';setEvidence({files:{},urls:{},errors:{}});setVideoViews([]);setSelectedViewId('');setViewUrls({key:''});setPlaying(true);setFit('fit');setMode(initialMode(entity));
  },[entity.id,workspace]);
  useEffect(()=>{
    const changed=()=>setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange',changed);
    const off=window.atelier.onWindowVisibility(event=>setWindowVisible(event.visible));
    return()=>{document.removeEventListener('visibilitychange',changed);off();};
  },[]);
  useEffect(()=>{
    let current=true;
    const relevant=(event:any)=>{
      if(workspace && event.workspace!==workspace)return;
      if((event.entities||[]).some((item:any)=>item.id===entity.id||item.kind==='artifact'))setReload(value=>value+1);
    };
    const off=window.atelier.onDomainChanged(relevant);
    const workspaceOff=window.atelier.onWorkspaceChanged(()=>{current=false;setEvidence({files:{},urls:{},errors:{}});setPlaying(false);});
    void(async()=>{
      setLoading(true);setLoadError('');
      try {
        const linked=await call({op:'links:get',id:entity.id});
        if(!current)return;
        if(!linked.ok)throw new Error(linked.error?.message||'Evidence could not be loaded.');
        const links=linked.data as any[];
        const related=new Map<string,Entity>();
        for(const link of links)for(const item of [link.from,link.to])if(item?.kind==='artifact'&&!item.data.deletedAt)related.set(item.id,item);
        const files:Evidence['files']={},urls:Evidence['urls']={},errors:Evidence['errors']={};
        const configuredViews=Array.isArray(entity.data.videoViews)?entity.data.videoViews as any[]:[];
        const hydratedViews:VideoView[]=[];
        for(const view of configuredViews){
          const clip:VideoView={id:String(view.id),label:String(view.label),missingEvidence:view.missingEvidence||{}};
          for(const side of ['before','after'] as const){
            const role=side==='before'?'beforeVideo':'afterVideo',artifactId=view[`${role}ArtifactId`];if(!artifactId)continue;
            let file=related.get(String(artifactId));
            if(!file){const result=await call({op:'get',kind:'artifact',id:String(artifactId)});if(result.ok&&!result.data.data.deletedAt)file=result.data;}
            if(file)clip[side]=file;
          }
          hydratedViews.push(clip);
        }
        for(const role of roles){
          if(!current)return;
          const canonical=entity.data[`${role}ArtifactId`];
          if(canonical){
            const found=related.get(String(canonical));
            if(found)files[role]=found;
            else {
              const result=await call({op:'get',kind:'artifact',id:String(canonical)});
              if(result.ok&&!result.data.data.deletedAt)files[role]=result.data;
              else errors[role]=ru?'Связанный файл недоступен. Откройте сведения отчёта, чтобы заменить его.':'The linked file is unavailable. Open report details to replace it.';
            }
          }else if(!owns(entity.data,`${role}ArtifactId`)&&!owns(entity.data.missingEvidence,role)){
            const tagged=links.filter(link=>link.role===role).flatMap(link=>[link.from,link.to]).filter(item=>item?.kind==='artifact'&&!item.data.deletedAt);
            const unique=[...new Map(tagged.map(item=>[item.id,item])).values()] as Entity[];
            if(unique.length===1)files[role]=unique[0];
            else if(role==='gif'||role==='video'&&!['beforeVideoArtifactId','afterVideoArtifactId'].some(key=>owns(entity.data,key))&&!['beforeVideo','afterVideo'].some(key=>owns(entity.data.missingEvidence,key))){
              const candidates=[...related.values()].filter(role==='gif'?isGif:file=>String(file.data.mime||'')==='video/mp4');
              if(candidates.length===1)files[role]=candidates[0];
            }
          }
          if(files[role]){
            const source=await call({op:'asset:url',id:files[role]!.id});
            if(source.ok)urls[role]=source.data.url;
            else errors[role]=ru?'Не удалось открыть материал. Повторите загрузку.':'Could not open this evidence. Retry loading.';
          }
        }
        if(!current)return;
        setEvidence({files,urls,errors});
        setVideoViews(hydratedViews);
        if(initialized.current!==entity.id){setMode(hydratedViews.length||files.beforeVideo||files.afterVideo||files.video||initialMode(entity)==='video'?'video':files.gif?'gif':'video');if(hydratedViews.length)setSelectedViewId(hydratedViews[0].id);initialized.current=entity.id;}
      }catch(error){if(current)setLoadError(error instanceof Error?error.message:String(error));}
      finally{if(current)setLoading(false);}
    })();
    return()=>{current=false;off();workspaceOff();};
  },[entity.id,entity.revision,workspace,reload,ru]);

  const selectedView=videoViews.find(view=>view.id===selectedViewId)||videoViews[0];const videoMode=mode==='video'||mode==='beforeVideo'||mode==='afterVideo';const selectedViewKey=selectedView?`${entity.id}:${selectedView.id}:${selectedView.before?.id||''}:${selectedView.after?.id||''}`:'';const useSelectedView=videoMode&&!!selectedView,viewUrlsMatch=viewUrls.key===selectedViewKey;
  useEffect(()=>{
    let current=true;setViewUrls({key:''});setViewProgress({time:0,duration:0});
    if(!selectedView)return;
    void(async()=>{const [before,after]=await Promise.all([selectedView.before?call({op:'asset:url',id:selectedView.before.id}):Promise.resolve(null),selectedView.after?call({op:'asset:url',id:selectedView.after.id}):Promise.resolve(null)]);if(!current)return;const message=ru?'Не удалось открыть видео ракурса. Повторите попытку.':'Could not resolve the video angle. Retry loading.';setViewUrls({key:selectedViewKey,before:before?.ok?before.data.url:undefined,after:after?.ok?after.data.url:undefined,errors:{before:selectedView.before&&!before?.ok?message:undefined,after:selectedView.after&&!after?.ok?message:undefined}});})();
    return()=>{current=false;};
  },[selectedViewKey,viewRetry,ru]);

  const labels:Record<Mode,string>=ru?{video:'Видео до/после',beforeVideo:'Видео до',afterVideo:'Видео после',gif:'GIF · архив',compare:'Снимки',before:'До',after:'После'}:{video:'Video comparison',beforeVideo:'Before video',afterVideo:'After video',gif:'Legacy GIF',compare:'Images',before:'Before',after:'After'};
  const afterRole:Role=owns(entity.data,'afterVideoArtifactId')||owns(entity.data.missingEvidence,'afterVideo')?'afterVideo':'video';
  const modes:Mode[]=['video','compare','before','after',...(evidence.files.gif?['gif'] as Mode[]:[])];
  const checks=Array.isArray(entity.data.checks)?entity.data.checks.filter((item:unknown)=>typeof item==='string'):[];
  const categories:Record<string,string>={'General':'Общее','Shader':'Шейдер','Mechanic':'Механика','Scene':'Сцена','Bug fix':'Исправление','Performance':'Производительность','Other':'Другое'};
  const status:Record<string,string>={'Recorded':'Записано','In progress':'В работе','Fixed':'Исправлено','Verified':'Проверено','Deferred':'Отложено'};
  const activeGif=mode==='gif'&&playing&&documentVisible&&windowVisible&&!loading;
  const date=new Date(entity.updatedAt);
  const formattedDate=Number.isFinite(date.getTime())?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(date):'';
  const fileName=videoMode&&selectedView?selectedView.label:(mode==='compare'?undefined:mode==='video'?[evidence.files.beforeVideo?.name,evidence.files[afterRole]?.name].filter(Boolean).join(' / '):mode==='afterVideo'?evidence.files[afterRole]?.name:evidence.files[mode]?.name);
  const retry=()=>{if(videoMode&&selectedView)setViewRetry(value=>value+1);else setReload(value=>value+1);};
  const chooseMode=(next:Mode)=>{initialized.current=entity.id;setMode(next);setFit('fit');if(next==='gif')setPlaying(true);};
  return <section className="unity-report-document" data-report-id={entity.id} data-mode={mode} aria-label={ru?'Отчёт Unity':'Unity report'}>
    <header className="urd-heading">
      <div className="urd-title"><button type="button" className="urd-back" onClick={onBack}><ArrowLeft size={15}/>{ru?'К отчётам Unity':'Back to Unity Activity'}</button><h1>{entity.name}</h1><p><span>{ru?(categories[entity.data.category]||entity.data.category||'Общее'):(entity.data.category||'General')}</span><span>{formattedDate}</span></p></div>
      <div className="urd-heading-actions"><button type="button" className="subtle-button" onClick={onDetails}><Info size={15}/>{ru?'Сведения':'Details'}</button><button type="button" className="subtle-button" onClick={()=>onAttach()}><ImagePlus size={15}/>{ru?'Добавить материалы':'Attach evidence'}</button></div>
    </header>
    <div className="urd-layout">
      <div className="urd-viewer">
        <div className="urd-toolbar">
          <label className="urd-mode-select-wrap"><Film size={15} aria-hidden="true"/><select className="urd-mode-select" data-testid="report-mode-select" aria-label={ru?'Режим просмотра':'Preview mode'} value={videoMode?'video':mode} onChange={event=>chooseMode(event.currentTarget.value as Mode)}>{modes.map(item=><option key={item} value={item}>{labels[item]}</option>)}</select></label>
          {videoMode&&<label className="urd-video-view-select-wrap"><span className="urd-video-view-select-label">{ru?'Видео':'Video'}</span><select className="urd-video-view-select" data-testid="report-video-view-select" aria-label={ru?'Показать видео':'Show video'} value={mode==='beforeVideo'?'before':mode==='afterVideo'?'after':'compare'} onChange={event=>chooseMode(event.currentTarget.value==='before'?'beforeVideo':event.currentTarget.value==='after'?'afterVideo':'video')}><option value="compare">{ru?'До и после':'Before and after'}</option><option value="before">{ru?'До':'Before'}</option><option value="after">{ru?'После':'After'}</option></select></label>}
          <div className="urd-scale" role="group" aria-label={ru?'Масштаб':'Image scale'}><button type="button" data-testid="report-fit" aria-pressed={fit==='fit'} onClick={()=>setFit('fit')}><Maximize2 size={14}/>{ru?'Вписать':'Fit'}</button><button type="button" data-testid="report-native" aria-pressed={fit==='native'} onClick={()=>setFit('native')}>100%</button></div>
        </div>
        {videoMode&&videoViews.length>0&&<nav className="urd-view-steps" aria-label={ru?'Ракурсы видео':'Camera-angle videos'}><button type="button" className="urd-step-arrow" aria-label={ru?'Предыдущий ракурс':'Previous view'} disabled={videoViews.findIndex(view=>view.id===selectedView?.id)<=0} onClick={()=>{setPlaying(false);setSelectedViewId(videoViews[Math.max(0,videoViews.findIndex(view=>view.id===selectedView?.id)-1)].id)}}><ArrowLeft size={15}/></button><div className="urd-step-track" role="tablist" aria-label={ru?'Записанные ракурсы':'Recorded views'}>{videoViews.map((view,index)=><button key={view.id} type="button" role="tab" aria-selected={selectedView?.id===view.id} className="urd-view-step" style={{'--step-progress':selectedView?.id===view.id&&viewProgress.duration?`${Math.min(100,viewProgress.time/viewProgress.duration*100)}%`:'0%'} as React.CSSProperties} onClick={()=>{setPlaying(false);setViewProgress({time:0,duration:0});setSelectedViewId(view.id);}} aria-label={`${ru?'Ракурс':'View'} ${index+1}: ${view.label}`}><span className="urd-step-dot"/><span className="urd-step-label">{view.label}</span></button>)}</div><button type="button" className="urd-step-arrow" aria-label={ru?'Следующий ракурс':'Next view'} disabled={videoViews.findIndex(view=>view.id===selectedView?.id)>=videoViews.length-1} onClick={()=>{setPlaying(false);setSelectedViewId(videoViews[Math.min(videoViews.length-1,videoViews.findIndex(view=>view.id===selectedView?.id)+1)].id)}}><ArrowRight size={15}/></button></nav>}
        <div className={`urd-canvas${mode==='compare'?' is-comparison':''}`} data-testid="unity-report-canvas" aria-busy={loading}>
          {loading?<div className="urd-empty"><RefreshCw size={24}/><h2>{ru?'Загрузка материалов':'Loading evidence'}</h2></div>:loadError?<div className="urd-empty" role="alert"><Images size={26}/><h2>{ru?'Не удалось загрузить материалы':'Evidence could not be loaded'}</h2><p>{loadError}</p><button className="subtle-button" onClick={retry}><RefreshCw size={14}/>{ru?'Повторить':'Retry'}</button></div>:videoMode?<UnityReportVideoPair key={entity.id} before={{url:useSelectedView?(viewUrlsMatch?viewUrls.before:undefined):evidence.urls.beforeVideo,name:useSelectedView?selectedView?.before?.name:evidence.files.beforeVideo?.name,error:useSelectedView?(viewUrlsMatch?viewUrls.errors?.before:undefined):evidence.errors.beforeVideo,missing:useSelectedView?selectedView?.missingEvidence?.beforeVideo:entity.data.missingEvidence?.beforeVideo,loading:useSelectedView&&!viewUrlsMatch}} after={{url:useSelectedView?(viewUrlsMatch?viewUrls.after:undefined):evidence.urls[afterRole],name:useSelectedView?selectedView?.after?.name:evidence.files[afterRole]?.name,error:useSelectedView?(viewUrlsMatch?viewUrls.errors?.after:undefined):evidence.errors[afterRole],missing:useSelectedView?selectedView?.missingEvidence?.afterVideo:entity.data.missingEvidence?.[afterRole],loading:useSelectedView&&!viewUrlsMatch}} view={mode==='beforeVideo'?'before':mode==='afterVideo'?'after':'compare'} active={documentVisible&&windowVisible&&!loading} fit={fit} locale={locale} onAttach={side=>onAttach(side==='before'?'beforeVideo':'afterVideo')} onRetry={retry} onProgress={(time,duration)=>setViewProgress({time,duration})}/>: (mode==='compare'?(['before','after'] as Role[]):[mode]).map(role=><MediaPane key={role} role={role} label={labels[role]} file={evidence.files[role]} url={evidence.urls[role]} posterUrl={evidence.urls.after||evidence.urls.before} fit={fit} active={documentVisible&&windowVisible&&!loading} animated={role==='gif'&&activeGif} error={evidence.errors[role]} missing={entity.data.missingEvidence?.[role]} locale={locale} onRetry={retry} onAttach={()=>onAttach(role==='before'?'before':role==='after'?'after':undefined)} onNotify={onNotify}/>) }
        </div>
        <footer className="urd-viewer-footer"><span className="urd-file-name">{fileName||(mode==='compare'?(ru?'Два ракурса рядом':'Side-by-side evidence'):labels[mode])}</span>{mode==='gif'&&evidence.files.gif&&<button type="button" className="urd-play" data-testid="report-gif-toggle" aria-pressed={playing} onClick={()=>setPlaying(value=>!value)}>{playing?<Square size={12}/>:<Play size={14}/>} {ru?(playing?'Остановить GIF':'Смотреть GIF'):(playing?'Stop GIF':'Play GIF')}</button>}</footer>
      </div>
      <aside className="urd-summary" aria-label={ru?'Сводка отчёта':'Report summary'}>
        <div className="urd-summary-heading"><h2>{ru?'О работе':'About this work'}</h2><span className="urd-status">{ru?(status[entity.data.status]||entity.data.status||'Записано'):(entity.data.status||'Recorded')}</span></div>
        <p className="urd-description">{entity.data.description||(ru?'Описание пока не добавлено.':'No description has been added yet.')}</p>
        {checks.length>0&&<section className="urd-checks"><h2><ClipboardList size={16}/>{ru?'Проверки':'Verification'}</h2><ul>{checks.map((check:string,index:number)=><li key={index}>{check}</li>)}</ul></section>}
        {entity.data.unityProjectPath&&<details className="urd-project"><summary><ChevronDown size={14}/>{ru?'Проект Unity':'Unity project'}</summary><p>{String(entity.data.unityProjectPath)}</p></details>}
      </aside>
    </div>
  </section>;
}

function MediaPane({role,label,file,url,posterUrl,fit,active,animated,error,missing,locale,onRetry,onAttach}:{role:Role;label:string;file?:Entity;url?:string;posterUrl?:string;fit:'fit'|'native';active:boolean;animated:boolean;error?:string;missing?:string;locale:Locale;onRetry:()=>void;onAttach:(role?:'before'|'after'|'beforeVideo'|'afterVideo')=>void;onNotify:(notice:any)=>void}) {
  const ru=locale==='ru';
  const [failed,setFailed]=useState(false),[dimensions,setDimensions]=useState('');
  useEffect(()=>{setFailed(false);setDimensions('');},[file?.id,url]);
  const mime=String(file?.data.mime||'');
  const isVideo=mime.startsWith('video/');
  const stopped=role==='gif'&&!animated;
  const source=stopped?posterUrl:url;
  const broken=failed||!!error;
  return <figure className="urd-media-pane" data-evidence-role={role}>
    <figcaption><strong>{label}</strong><span>{stopped&&file?(ru?'Остановлено':'Stopped'):dimensions}</span></figcaption>
    <div className={`urd-media-surface${isVideo?' has-video':fit==='native'?' is-native':''}`}>
      {broken?<div className="urd-empty" role="alert"><Images size={26}/><h2>{ru?'Материал недоступен':'Evidence unavailable'}</h2><p>{error||(ru?'Файл не удалось отобразить. Повторите загрузку или замените его в сведениях отчёта.':'This file could not be displayed. Retry or replace it in report details.')}</p><button type="button" className="subtle-button" onClick={onRetry}><RefreshCw size={14}/>{ru?'Повторить':'Retry'}</button></div>:!file||!url?<div className="urd-empty"><Images size={26}/><h2>{role==='video'?(ru?'Видео пока не добавлено':'No video attached yet'):role==='gif'?(ru?'GIF пока не добавлен':'No GIF attached yet'):(ru?'Изображение пока не добавлено':'No image attached yet')}</h2><p>{missing||(ru?'Добавьте материал в этот отчёт.':'Attach evidence to this report.')}</p><button type="button" className="subtle-button" onClick={()=>onAttach()}><ImagePlus size={14}/>{ru?'Добавить материалы':'Attach evidence'}</button></div>:isVideo?<UnityReportVideo key={url} url={url} poster={posterUrl} active={active} locale={locale} fit={fit} onDimensions={setDimensions}/>:source?<img key={source} src={source} alt={`${label}: ${file.name}`} data-animated-gif={role==='gif'&&animated?'true':undefined} draggable={false} onLoad={event=>setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)} onError={()=>setFailed(true)}/>:<div className="urd-empty"><Film size={30}/><h2>{ru?'GIF остановлен':'GIF stopped'}</h2><p>{ru?'Нажмите «Смотреть GIF», чтобы запустить запись.':'Choose Play GIF to start the recording.'}</p></div>}
    </div>
  </figure>;
}
