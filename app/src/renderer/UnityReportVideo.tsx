import React, {useEffect, useRef, useState} from 'react';
import {Maximize2, Minimize2, Pause, Play, RefreshCw, Repeat2, Volume2, VolumeX} from 'lucide-react';
import type {Locale} from '../shared/i18n';

type Props={url:string;poster?:string;active:boolean;locale:Locale;fit:'fit'|'native';onDimensions:(value:string)=>void};
const clock=(value:number)=>{const seconds=Math.max(0,Math.floor(Number.isFinite(value)?value:0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};

export default function UnityReportVideo({url,poster,active,locale,fit,onDimensions}:Props){
  const ru=locale==='ru',video=useRef<HTMLVideoElement>(null),root=useRef<HTMLDivElement>(null),started=useRef(false);
  const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(0);
  const [muted,setMuted]=useState(true),[volume,setVolume]=useState(.8),[rate,setRate]=useState(1),[loop,setLoop]=useState(true);
  const [waiting,setWaiting]=useState(true),[failed,setFailed]=useState(false),[fullscreen,setFullscreen]=useState(false),[fullscreenError,setFullscreenError]=useState(false);
  useEffect(()=>{started.current=false;setPlaying(false);setTime(0);setDuration(0);setWaiting(true);setFailed(false);setFullscreenError(false);},[url]);
  useEffect(()=>{const element=video.current;if(!element)return;if(!active)element.pause();return()=>element.pause();},[active,url]);
  useEffect(()=>{if(video.current){video.current.volume=volume;video.current.playbackRate=rate;}},[volume,rate,url]);
  useEffect(()=>{const element=root.current;const changed=()=>setFullscreen(document.fullscreenElement===element),escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&document.fullscreenElement===element){event.preventDefault();void document.exitFullscreen().catch(()=>{});}};document.addEventListener('fullscreenchange',changed);document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('fullscreenchange',changed);document.removeEventListener('keydown',escape,true);if(document.fullscreenElement===element)void document.exitFullscreen().catch(()=>{});};},[]);
  const play=async()=>{if(!active||!video.current)return;try{if(video.current.ended)video.current.currentTime=0;await video.current.play();}catch{setPlaying(false);setWaiting(false);}};
  const toggle=()=>{const element=video.current;if(!element)return;if(element.paused)void play();else element.pause();};
  const seek=(next:number)=>{if(!video.current||!duration)return;const bounded=Math.max(0,Math.min(next,duration));video.current.currentTime=bounded;setTime(bounded);};
  const toggleFullscreen=async()=>{try{if(document.fullscreenElement===root.current)await document.exitFullscreen();else await root.current?.requestFullscreen();setFullscreenError(false);}catch{setFullscreenError(true);}};
  const retry=()=>{started.current=false;setFailed(false);setWaiting(true);video.current?.load();};
  const caption=ru?{play:'Смотреть',pause:'Пауза',seek:'Позиция видео',mute:'Выключить звук',unmute:'Включить звук',volume:'Громкость',speed:'Скорость',loop:'Повтор',full:'На весь экран',exit:'Выйти из полного экрана'}:{play:'Play',pause:'Pause',seek:'Video position',mute:'Mute',unmute:'Unmute',volume:'Volume',speed:'Playback speed',loop:'Loop',full:'Fullscreen',exit:'Exit fullscreen'};
  return <div ref={root} className="urd-video-player" data-testid="report-video-player" tabIndex={0} aria-label={ru?'Видеоплеер результата':'Result video player'} onKeyDown={event=>{
    if(event.target!==event.currentTarget&&event.target!==video.current)return;
    if(event.key===' '){event.preventDefault();toggle();}else if(event.key==='ArrowRight'){event.preventDefault();seek(time+5);}else if(event.key==='ArrowLeft'){event.preventDefault();seek(time-5);}else if(event.key.toLowerCase()==='f'){event.preventDefault();void toggleFullscreen();}else if(event.key.toLowerCase()==='m'){event.preventDefault();setMuted(value=>!value);}
  }}>
    <div className={`urd-video-stage${fit==='native'?' is-native':''}`}>
      <video ref={video} src={url} poster={poster} crossOrigin="anonymous" muted={muted} loop={loop} playsInline preload="metadata" controls={false} data-testid="report-video" aria-label={ru?'Видео результата':'Result video'}
        onLoadedMetadata={event=>{const element=event.currentTarget;setDuration(Number.isFinite(element.duration)?element.duration:0);element.volume=volume;element.playbackRate=rate;onDimensions(`${element.videoWidth} × ${element.videoHeight} · MP4`);}}
        onCanPlay={()=>{setWaiting(false);if(active&&!started.current){started.current=true;void play();}}}
        onPlay={()=>setPlaying(true)} onPlaying={()=>{setPlaying(true);setWaiting(false);}} onPause={()=>setPlaying(false)} onWaiting={()=>setWaiting(true)} onSeeked={()=>setWaiting(false)}
        onTimeUpdate={event=>setTime(event.currentTarget.currentTime)} onEnded={()=>setPlaying(false)} onError={()=>{setFailed(true);setWaiting(false);setPlaying(false);}}/>
      {failed?<div className="urd-video-overlay urd-empty" role="alert"><Play size={25}/><h2>{ru?'Не удалось воспроизвести MP4':'Could not play this MP4'}</h2><p>{ru?'Повторите загрузку. Если ошибка повторится, замените видео в сведениях отчёта.':'Retry loading. If this continues, replace the video in report details.'}</p><button type="button" className="subtle-button" onClick={retry}><RefreshCw size={14}/>{ru?'Повторить':'Retry'}</button></div>:waiting?<div className="urd-video-loading" role="status"><RefreshCw size={16}/>{ru?'Загрузка видео…':'Loading video…'}</div>:!playing&&<button type="button" className="urd-video-start" aria-label={ru?'Воспроизвести видео':'Play video'} data-testid="video-start" onClick={()=>void play()}><Play size={25}/></button>}
    </div>
    <div className="urd-video-controls" data-testid="video-controls">
      <div className="urd-video-timeline"><input type="range" aria-label={caption.seek} data-testid="video-seek" min={0} max={duration||0} step="0.01" value={Math.min(time,duration)} disabled={!duration||failed} style={{'--progress':`${duration?Math.min(100,time/duration*100):0}%`} as React.CSSProperties} onChange={event=>seek(Number(event.target.value))}/><span>{clock(time)} <span>/ {clock(duration)}</span></span></div>
      <div className="urd-video-actions">
        <div className="urd-video-left"><button type="button" className="urd-video-action urd-video-play" data-testid="video-play" aria-label={ru?(playing?'Приостановить видео':'Воспроизвести видео'):(playing?'Pause video':'Play video')} disabled={failed} onClick={toggle}>{playing?<Pause size={15}/>:<Play size={15}/>}<span>{playing?caption.pause:caption.play}</span></button>
          <button type="button" className="urd-video-action" data-testid="video-mute" aria-label={muted?caption.unmute:caption.mute} aria-pressed={muted||volume===0} data-tooltip={muted?caption.unmute:caption.mute} onClick={()=>setMuted(value=>!value)}>{muted||volume===0?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>
          <input className="urd-video-volume" type="range" aria-label={caption.volume} min="0" max="1" step="0.05" value={muted?0:volume} style={{'--volume-progress':`${Math.round((muted?0:volume)*100)}%`} as React.CSSProperties} onChange={event=>{const value=Number(event.target.value);setVolume(value);setMuted(value===0);}}/><span className="urd-volume-value" data-testid="video-volume-value" aria-live="polite">{Math.round((muted?0:volume)*100)}%</span>
        </div>
        <div className="urd-video-right"><button type="button" className="urd-video-action" data-testid="video-speed" aria-label={`${caption.speed}: ${rate}×`} data-tooltip={caption.speed} onClick={()=>setRate(value=>{const speeds=[.5,1,1.5,2];return speeds[(speeds.indexOf(value)+1)%speeds.length];})}>{rate}×</button>
          <button type="button" className="urd-video-action" data-testid="video-loop" aria-label={caption.loop} aria-pressed={loop} data-tooltip={caption.loop} onClick={()=>setLoop(value=>!value)}><Repeat2 size={16}/></button>
          <button type="button" className="urd-video-action" data-testid="video-fullscreen" aria-label={fullscreen?caption.exit:caption.full} data-tooltip={fullscreen?caption.exit:caption.full} onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
        </div>
      </div>
      {fullscreenError&&<p className="urd-video-note" role="status">{ru?'Полный экран недоступен. Видео можно смотреть в этом окне.':'Fullscreen is unavailable. You can keep watching in this window.'}</p>}
    </div>
  </div>;
}
