import {useEffect,useRef,useState} from 'react';
export function LanguageChoice({onChoose}:{onChoose:(locale:'ru'|'en')=>Promise<void>}){
 const first=useRef<HTMLButtonElement>(null),last=useRef<HTMLButtonElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{first.current?.focus()},[]);
 const choose=async(locale:'ru'|'en')=>{if(busy)return;setBusy(true);setError('');try{await onChoose(locale)}catch{setError('Не удалось сохранить. Попробуйте ещё раз. / Could not save. Please retry.');setBusy(false);first.current?.focus()}};
 return <div className="language-choice-backdrop"><section className="language-choice" role="dialog" aria-modal="true" aria-label="Выбор языка / Choose language" aria-busy={busy} onKeyDown={event=>{if(event.key==='Tab'){event.preventDefault();(document.activeElement===first.current?last:first).current?.focus()}}}>
  <button ref={first} type="button" disabled={busy} onClick={()=>void choose('ru')} lang="ru">Русский</button>
  <button ref={last} type="button" disabled={busy} onClick={()=>void choose('en')} lang="en">English</button>
  <span className="sr-only" role="alert">{error}</span>
 </section></div>;
}
