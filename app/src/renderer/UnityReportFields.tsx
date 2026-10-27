import React, {useEffect, useRef, useState} from 'react';
import {ChevronDown, ClipboardList, FileImage, Pause, Play} from 'lucide-react';
import type {Entity} from '../shared/contracts';
import type {Locale} from '../shared/i18n';
import {call} from './api';
import './unityReport.css';

type Props = {
  entity: Entity;
  files: Entity[];
  onRefresh: () => unknown;
  onNotify: (notice: any) => void;
  locale?: Locale;
  Select: React.ComponentType<any>;
  translate: (locale: Locale, value: string) => string;
};

export default function UnityReportFields({entity, files, onRefresh, onNotify, locale='en', Select, translate}: Props) {
  const ru = locale === 'ru';
  const [saving, setSaving] = useState(false);
  const update = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const result = await call({op:'put', entity:{id:entity.id, kind:'unityReport', name:entity.name, data:{...entity.data, ...patch}, expectedRevision:entity.revision}});
      if (!result.ok) onNotify({id:'action.failed', severity:'error', detail:result.error.message, code:result.error.code});
      else await onRefresh();
    } finally { setSaving(false); }
  };
  const none = ru ? 'Не выбрано' : 'None';
  const label = (file: Entity) => `${file.name} · ${file.id.slice(0,6)}`;
  const selected = (id: unknown) => { const file = files.find(item => item.id === id); return file ? label(file) : none; };
  const resolve = (value: string) => files.find(file => label(file) === value)?.id || null;
  const images = files.filter(file => String(file.data.mime || '').startsWith('image/'));
  const gifs = images.filter(file => file.data.mime === 'image/gif');
  const videos = files.filter(file => file.data.mime === 'video/mp4');
  const missing = entity.data.missingEvidence || {};
  const checks = Array.isArray(entity.data.checks) ? entity.data.checks.filter((item: unknown) => typeof item === 'string') : [];
  const projectPath = String(entity.data.unityProjectPath || '');
  return <section className="unity-report-fields" aria-label={ru ? 'Материалы отчёта Unity' : 'Unity report evidence'}>
    {projectPath && <p className="unity-report-project" title={projectPath}>{projectPath}</p>}
    <div className="section-title small-title"><h3>{ru ? 'Результат работы' : 'Work result'}</h3><span>{files.length} {ru ? 'файлов' : 'files'}</span></div>
    {entity.data.description && <p className="unity-report-summary">{entity.data.description}</p>}
    <div className="report-compare">
      <Evidence file={files.find(file => file.id === entity.data.beforeArtifactId)} label={ru ? 'До' : 'Before'} missing={missing.before} locale={locale}/>
      <Evidence file={files.find(file => file.id === entity.data.afterArtifactId)} label={ru ? 'После' : 'After'} missing={missing.after} locale={locale}/>
    </div>
    {(entity.data.videoArtifactId||entity.data.beforeVideoArtifactId||entity.data.afterVideoArtifactId)?<p className="unity-report-summary">{ru?'Видео до и после открываются в основной вкладке отчёта.':'Watch before and after videos in the report document.'}</p>:entity.data.gifArtifactId?<Evidence file={files.find(file => file.id === entity.data.gifArtifactId)} label={ru ? 'GIF · архив' : 'Legacy GIF'} missing={missing.gif} locale={locale} motion/>:null}
    {checks.length > 0 && <div className="unity-report-checks"><h4><ClipboardList size={15}/>{ru ? 'Проверки' : 'Verification'}</h4><ul>{checks.map((check: string, index: number) => <li key={index}>{check}</li>)}</ul></div>}
    <details className="unity-report-settings"><summary><ChevronDown size={14}/>{ru ? 'Сведения и файлы' : 'Details and files'}</summary>
      <fieldset disabled={saving}>
        <div className="form-row">
          <label className="field-label">{ru ? 'Категория' : 'Category'}<Select locale={locale} label={ru ? 'Категория отчёта' : 'Report category'} value={entity.data.category || 'General'} options={['General','Shader','Mechanic','Scene','Bug fix','Performance','Other']} onChange={(category: string) => void update({category})}/></label>
          <label className="field-label">{ru ? 'Состояние' : 'Status'}<Select locale={locale} label={ru ? 'Состояние отчёта' : 'Report status'} value={entity.data.status || 'Recorded'} options={['Recorded','In progress','Fixed','Verified','Deferred']} onChange={(status: string) => void update({status})}/></label>
        </div>
        <div className="form-row">
          <label className="field-label">{ru ? 'До' : 'Before'}<Select locale={locale} label={ru ? 'Материал до изменений' : 'Before evidence'} value={selected(entity.data.beforeArtifactId)} options={[none, ...images.map(label)]} onChange={(value: string) => void update({beforeArtifactId:resolve(value)})}/></label>
          <label className="field-label">{ru ? 'После' : 'After'}<Select locale={locale} label={ru ? 'Материал после изменений' : 'After evidence'} value={selected(entity.data.afterArtifactId)} options={[none, ...images.map(label)]} onChange={(value: string) => void update({afterArtifactId:resolve(value)})}/></label>
        </div>
        <label className="field-label">{ru?'Видео до':'Before video'}<Select locale={locale} label={ru ? 'Видео до изменений' : 'Before video'} value={selected(entity.data.beforeVideoArtifactId)} options={[none, ...videos.map(label)]} onChange={(value: string) => void update({beforeVideoArtifactId:resolve(value)})}/></label>
        <label className="field-label">{ru?'Видео после':'After video'}<Select locale={locale} label={ru ? 'Видео после изменений' : 'After video'} value={selected(Object.prototype.hasOwnProperty.call(entity.data,'afterVideoArtifactId')?entity.data.afterVideoArtifactId:entity.data.videoArtifactId)} options={[none, ...videos.map(label)]} onChange={(value: string) => void update({afterVideoArtifactId:resolve(value)})}/></label>
        {entity.data.gifArtifactId&&<label className="field-label">{ru?'GIF · архив':'Legacy GIF'}<Select locale={locale} label={ru ? 'Архивный GIF' : 'Legacy GIF'} value={selected(entity.data.gifArtifactId)} options={[none, ...gifs.map(label)]} onChange={(value: string) => void update({gifArtifactId:resolve(value)})}/></label>}
      </fieldset>
      <div className="report-evidence-list">{files.map(file => <div className="file-chip" key={file.id}><FileImage size={14}/><span title={file.name}>{file.name}</span><small>{file.data.mime || translate(locale,'Managed file')}</small></div>)}</div>
      {files.length === 0 && <p className="inspector-empty">{ru ? 'Прикрепите изображения и видео MP4 или отправьте отчёт из Codex.' : 'Attach images and an MP4 video, or publish a report from Codex.'}</p>}
    </details>
  </section>;
}

function Evidence({file, label, missing, locale, motion=false}: {file?: Entity; label: string; missing?: string; locale: Locale; motion?: boolean}) {
  const ru = locale === 'ru';
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let active = true;
    setUrl(''); setError(false); setPlaying(false); setTime(0); setDuration(0);
    if (file) void call({op:'asset:url', id:file.id}).then(result => {
      if (!active) return;
      if (result.ok) setUrl(result.data.url); else setError(true);
    });
    return () => { active = false; };
  }, [file?.id]);
  const isVideo = String(file?.data.mime || '').startsWith('video/');
  const isGif = file?.data.mime === 'image/gif';
  const isImage = String(file?.data.mime || '').startsWith('image/');
  const gated = motion || isGif;
  const unavailable = error ? (ru ? 'Не удалось открыть файл' : 'Could not open this file') : missing || (file ? (ru ? 'Загрузка материала…' : 'Loading evidence…') : (ru ? 'Материал пока не добавлен' : 'No evidence attached yet'));
  return <figure className={`media-evidence unity-evidence${motion ? ' unity-evidence-motion' : ''}`} data-evidence-role={motion ? 'gif' : label}>
    <figcaption><span>{label}</span>{isGif && <small>GIF</small>}</figcaption>
    {file && url && !error ? isVideo ? <>
      <video ref={video} src={url} preload="metadata" aria-label={label} onError={() => setError(true)} onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)}/>
      <div className="media-controls"><button type="button" aria-label={ru ? (playing ? 'Приостановить видео' : 'Воспроизвести видео') : (playing ? 'Pause video' : 'Play video')} onClick={async () => {
        const element = video.current;
        if (!element) return;
        if (element.paused) { try { await element.play(); setPlaying(true); } catch { setError(true); } }
        else { element.pause(); setPlaying(false); }
      }}>{playing ? <Pause size={13}/> : <Play size={13}/>}</button><input type="range" aria-label={ru ? 'Позиция видео' : 'Video position'} min={0} max={duration || 0} step="0.1" value={Math.min(time,duration)} onChange={event => { if (video.current) video.current.currentTime = Number(event.target.value); }}/><small>{Math.floor(time)} / {Math.floor(duration)} {ru ? 'с' : 'sec'}</small></div>
    </> : isImage ? <>
      {(!gated || playing) ? <img src={url} alt={`${label}: ${file.name}`} onError={() => setError(true)}/> : <div className="unity-motion-idle"><Play size={22}/><p>{ru ? 'Посмотрите результат в движении' : 'See the result in motion'}</p></div>}
      {gated && <button type="button" className="subtle-button unity-motion-toggle" aria-pressed={playing} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={13}/> : <Play size={13}/>} {ru ? (playing ? 'Остановить GIF' : 'Смотреть GIF') : (playing ? 'Stop GIF' : 'Play GIF')}</button>}
    </> : <div className="media-empty">{file.name}</div> : <div className="media-empty">{unavailable}</div>}
  </figure>;
}
