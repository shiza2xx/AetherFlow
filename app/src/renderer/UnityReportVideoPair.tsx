import React,{useEffect,useRef,useState} from 'react';
import {Film,ImagePlus,Maximize2,Minimize2,Pause,Play,RefreshCw,Repeat2,Volume2,VolumeX} from 'lucide-react';
import type {Locale} from '../shared/i18n';
import {seekVideosToLoopStart} from './videoLoopLifecycle';

type Side='before'|'after';
type Clip={url?:string;name?:string;missing?:string;error?:string;loading?:boolean};
type Props={before:Clip;after:Clip;view:'compare'|Side;active:boolean;locale:Locale;fit:'fit'|'native';onAttach:(side:Side)=>void;onRetry?:()=>void;onProgress?:(time:number,duration:number)=>void};
type Meta={duration:number;width:number;height:number};
const clock=(value:number)=>{const s=Math.max(0,Math.floor(Number.isFinite(value)?value:0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};

export default function UnityReportVideoPair({before,after,view,active,locale,fit,onAttach,onRetry,onProgress}:Props){
  const ru=locale==='ru',clips={before,after},sides:Side[]=view==='compare'?['before','after']:[view];
  const nodes=useRef<Partial<Record<Side,HTMLVideoElement>>>({}),container=useRef<HTMLDivElement>(null);
  const token=useRef(0),intent=useRef(false),looping=useRef(false),loopGeneration=useRef(0),loopAbort=useRef<AbortController|null>(null),loopExpected=useRef(new Set<HTMLVideoElement>()),activeRef=useRef(active),progressRef=useRef(onProgress);
  const sourceRef=useRef({before:before.url,after:after.url,view});sourceRef.current={before:before.url,after:after.url,view};progressRef.current=onProgress;
  activeRef.current=active;
  const [metadata,setMetadata]=useState<Partial<Record<Side,Meta>>>({}),[ready,setReady]=useState<Partial<Record<Side,boolean>>>({}),[failed,setFailed]=useState<Partial<Record<Side,boolean>>>({});
  const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[rate,setRate]=useState(1),[loop,setLoop]=useState(true),[muted,setMuted]=useState(true),[volume,setVolume]=useState(.8),[fullscreen,setFullscreen]=useState(false),[playError,setPlayError]=useState('');
  const available=sides.filter(side=>clips[side].url&&!clips[side].error&&!failed[side]);
  const durations=available.map(side=>metadata[side]?.duration||0).filter(value=>value>0);
  const duration=durations.length?Math.min(...durations):0;
  const allReady=available.length>0&&available.every(side=>ready[side]);
  const elements=()=>available.flatMap(side=>nodes.current[side]?[nodes.current[side]!]:[]);
  const cancelLoop=()=>{loopGeneration.current++;loopAbort.current?.abort();loopAbort.current=null;loopExpected.current.clear();looping.current=false;};
  const pause=()=>{cancelLoop();token.current++;intent.current=false;elements().forEach(v=>v.pause());setPlaying(false);};
  const seek=(next:number)=>{const value=Math.max(0,Math.min(next,duration));elements().forEach(v=>{v.currentTime=Math.min(value,Number.isFinite(v.duration)?v.duration:value);});setTime(value);};
  const start=async(reset=false)=>{
    if(!activeRef.current||!allReady||!duration)return;
    const videos=elements();if(!videos.length)return;
    const startTime=reset||videos[0].currentTime>=duration-.04?0:Math.min(videos[0].currentTime,duration);
    for(const v of videos)if(Math.abs(v.currentTime-startTime)>.025)v.currentTime=startTime;
    const own=++token.current;intent.current=true;setPlayError('');
    try{await Promise.all(videos.map(v=>v.play()));if(own!==token.current)return;if(!activeRef.current){videos.forEach(v=>v.pause());return;}setPlaying(true);}
    catch{if(own!==token.current)return;intent.current=false;videos.forEach(v=>v.pause());setPlaying(false);setPlayError(ru?'Не удалось запустить видео. Повторите воспроизведение.':'Could not start the videos. Try playing again.');}
  };
  const finish=()=>{
    if(!intent.current||looping.current)return;
    if(!loop){pause();setTime(duration);return;}
    const videos=elements();if(!videos.length)return;
    looping.current=true;
    const generation=++loopGeneration.current,ownToken=token.current,identity={...sourceRef.current},controller=new AbortController();
    loopAbort.current=controller;loopExpected.current=new Set(videos);setTime(0);progressRef.current?.(0,duration);
    void seekVideosToLoopStart(videos,controller.signal,()=>generation===loopGeneration.current&&ownToken===token.current&&intent.current&&activeRef.current&&sourceRef.current.before===identity.before&&sourceRef.current.after===identity.after&&sourceRef.current.view===identity.view&&videos.every(video=>Object.values(nodes.current).includes(video)),()=>{void start();}).finally(()=>{
      if(generation!==loopGeneration.current)return;
      loopExpected.current.clear();loopAbort.current=null;looping.current=false;
    });
  };
  useEffect(()=>{
    const captured=Object.values(nodes.current);cancelLoop();token.current++;intent.current=false;setPlaying(false);setTime(0);setPlayError('');setFailed({});
    const nextMeta:Partial<Record<Side,Meta>>={},nextReady:Partial<Record<Side,boolean>>={};
    for(const side of sides){const v=nodes.current[side];if(v&&v.readyState>=1)nextMeta[side]={duration:v.duration,width:v.videoWidth,height:v.videoHeight};if(v&&v.readyState>=3)nextReady[side]=true;}
    setMetadata(nextMeta);setReady(nextReady);
    return()=>{cancelLoop();token.current++;intent.current=false;captured.forEach(v=>v?.pause());};
  },[before.url,after.url,view]);
  useEffect(()=>{if(!active)pause();},[active]);
  useEffect(()=>{elements().forEach(v=>{v.playbackRate=rate;v.volume=volume;});},[rate,volume,metadata,view]);
  useEffect(()=>{if(!playing)return;const timer=window.setInterval(()=>{
    const videos=elements(),master=videos[0];if(!master)return;
    if(master.currentTime>=duration-.025){finish();return;}
    for(const v of videos.slice(1))if(!v.seeking&&Math.abs(v.currentTime-master.currentTime)>.08)v.currentTime=master.currentTime;
    const nextTime=Math.min(master.currentTime,duration);setTime(nextTime);progressRef.current?.(nextTime,duration);
  },150);return()=>window.clearInterval(timer);},[playing,duration,rate,loop,before.url,after.url,view]);
  useEffect(()=>{const root=container.current;const changed=()=>setFullscreen(document.fullscreenElement===root),escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&document.fullscreenElement===root){event.preventDefault();void document.exitFullscreen().catch(()=>{});}};document.addEventListener('fullscreenchange',changed);document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('fullscreenchange',changed);document.removeEventListener('keydown',escape,true);if(document.fullscreenElement===root)void document.exitFullscreen().catch(()=>{});};},[]);
  const full=async()=>{try{if(document.fullscreenElement===container.current)await document.exitFullscreen();else await container.current?.requestFullscreen();}catch{setPlayError(ru?'Полный экран недоступен; просмотр доступен в этом окне.':'Fullscreen is unavailable; keep watching in this window.');}};
  const toggle=()=>{if(playing||intent.current)pause();else void start();};
  const audioSide=available.includes('after')?'after':'before';
  const text=ru?{play:'Смотреть',pause:'Пауза',before:'До',after:'После',seek:'Общая позиция видео',volume:'Громкость',mute:'Выключить звук',unmute:'Включить звук',speed:'Скорость',loop:'Повтор',full:'На весь экран',exit:'Выйти из полного экрана'}:{play:'Play',pause:'Pause',before:'Before',after:'After',seek:'Shared video position',volume:'Volume',mute:'Mute',unmute:'Unmute',speed:'Playback speed',loop:'Loop',full:'Fullscreen',exit:'Exit fullscreen'};
  return <div ref={container} className="urd-video-player urd-video-pair" data-testid="paired-video-player" data-pair-view={view} tabIndex={0} aria-label={ru?'Видео до и после':'Before and after videos'} onKeyDown={event=>{
    if(event.target!==event.currentTarget)return;if(event.key===' '){event.preventDefault();toggle();}else if(event.key==='ArrowRight'){event.preventDefault();seek(time+1);}else if(event.key==='ArrowLeft'){event.preventDefault();seek(time-1);}else if(event.key.toLowerCase()==='f'){event.preventDefault();void full();}
  }}>
    <div className={`urd-video-pair-sources${view==='compare'?' is-paired':''}`}>
      {sides.map(side=><figure className="urd-video-pair-pane" key={side} data-video-side={side}>
          <figcaption><strong>{text[side]}</strong><span className="urd-video-file-name" title={clips[side].name||''} aria-label={clips[side].name||''}>{clips[side].name||''}</span><span>{metadata[side]?`${metadata[side]!.width} × ${metadata[side]!.height} · ${clock(metadata[side]!.duration)}`:'MP4'}</span></figcaption>
        <div className={`urd-video-stage${fit==='native'?' is-native':''}`}>
          {clips[side].loading?<div className="urd-empty" role="status"><RefreshCw size={24}/><h2>{ru?'Загрузка видео ракурса':'Loading camera angle'}</h2></div>:!clips[side].url||clips[side].error||failed[side]?<div className="urd-empty"><Film size={24}/><h2>{clips[side].error||failed[side]?(ru?'Видео недоступно':'Video unavailable'):side==='before'?(ru?'Видео «до» не записано':'Before video was not recorded'):(ru?'Видео «после» не добавлено':'No after video attached')}</h2><p>{clips[side].error||clips[side].missing||(failed[side]?(ru?'Не удалось декодировать MP4. Замените файл в сведениях отчёта.':'Could not decode this MP4. Replace it in report details.'):side==='before'?(ru?'Для сравнения запишите исходное состояние до начала изменений.':'Record the baseline before starting changes to compare it here.'):(ru?'Добавьте запись результата.':'Attach a recording of the result.'))}</p><button type="button" className="subtle-button" onClick={clips[side].error||failed[side]?onRetry:()=>onAttach(side)}>{clips[side].error||failed[side]?<Repeat2 size={14}/>:<ImagePlus size={14}/>}{clips[side].error||failed[side]?(ru?'Повторить':'Retry'):ru?'Добавить материалы':'Attach evidence'}</button></div>:<video ref={v=>{if(v)nodes.current[side]=v;else delete nodes.current[side];}} src={clips[side].url} crossOrigin="anonymous" playsInline muted={muted||side!==audioSide} preload="metadata" controls={false} data-testid={`${side}-video`} aria-label={ru?`Видео ${side==='before'?'до':'после'}`:`${text[side]} video`}
            onLoadedMetadata={event=>{const v=event.currentTarget;v.volume=volume;v.playbackRate=rate;setMetadata(current=>({...current,[side]:{duration:v.duration,width:v.videoWidth,height:v.videoHeight}}));}}
            onCanPlay={()=>setReady(current=>({...current,[side]:true}))}
            onWaiting={event=>{const video=event.currentTarget;if(looping.current&&loopExpected.current.has(video)&&video.seeking)return;if(intent.current){cancelLoop();token.current++;intent.current=false;elements().forEach(v=>v.pause());setPlaying(false);setPlayError(ru?'Воспроизведение приостановлено при загрузке. Нажмите «Смотреть», чтобы продолжить.':'Playback paused while media loads. Press Play to retry.');}setReady(current=>({...current,[side]:false}));}}
            onEnded={finish} onError={()=>{pause();setFailed(current=>({...current,[side]:true}));}}/>}
        </div>
      </figure>)}
    </div>
    <div className="urd-video-controls">
      <div className="urd-video-timeline"><input type="range" data-testid="pair-seek" aria-label={text.seek} min={0} max={duration||0} step="0.01" value={Math.min(time,duration)} disabled={!duration} style={{'--progress':`${duration?time/duration*100:0}%`} as React.CSSProperties} onChange={event=>seek(Number(event.target.value))}/><span>{clock(time)} <span>/ {clock(duration)}</span></span></div>
      <div className="urd-video-actions"><div className="urd-video-left">
        <button type="button" className="urd-video-action urd-video-play" data-testid="pair-play" disabled={!duration||(!allReady&&!intent.current)} onClick={toggle} aria-label={playing||intent.current?text.pause:text.play}>{playing||intent.current?<Pause size={15}/>:<Play size={15}/>}<span>{playing||intent.current?text.pause:text.play}</span></button>
        <button type="button" className="urd-video-action" data-testid="pair-mute" data-tooltip={muted?text.unmute:text.mute} aria-label={muted?text.unmute:text.mute} aria-pressed={muted||volume===0} onClick={()=>setMuted(v=>!v)}>{muted||volume===0?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>
        <input type="range" className="urd-video-volume" aria-label={text.volume} min={0} max={1} step="0.05" value={muted?0:volume} style={{'--volume-progress':`${Math.round((muted?0:volume)*100)}%`} as React.CSSProperties} onChange={event=>{const v=Number(event.target.value);setVolume(v);setMuted(v===0);}}/><span className="urd-volume-value" data-testid="pair-volume-value" aria-live="polite">{Math.round((muted?0:volume)*100)}%</span>
      </div><div className="urd-video-right">
        <button type="button" className="urd-video-action" data-testid="pair-speed" aria-label={`${text.speed}: ${rate}×`} data-tooltip={text.speed} onClick={()=>setRate(v=>{const rates=[.5,1,1.5,2];return rates[(rates.indexOf(v)+1)%rates.length];})}>{rate}×</button>
        <button type="button" className="urd-video-action" data-testid="pair-loop" aria-label={text.loop} data-tooltip={text.loop} aria-pressed={loop} onClick={()=>setLoop(v=>!v)}><Repeat2 size={16}/></button>
        <button type="button" className="urd-video-action" data-testid="pair-fullscreen" aria-label={fullscreen?text.exit:text.full} data-tooltip={fullscreen?text.exit:text.full} onClick={()=>void full()}>{fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
      </div></div>
      {playError&&<p className="urd-video-note" role="status">{playError}</p>}
      {view==='compare'&&available.length===2&&metadata.before&&metadata.after&&Math.abs(metadata.before.duration-metadata.after.duration)>.05&&<p className="urd-video-note">{ru?'Общее воспроизведение ограничено длиной более короткого ролика.':'Shared playback uses the duration of the shorter clip.'}</p>}
    </div>
  </div>;
}
