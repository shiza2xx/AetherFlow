export type StudioSound='boop'|'pluck'|'daylight'|'nightfall'|'shake'|'drawer'|'summit'|'orbit'|'wink';

const deleteWords=/\b(delete|remove|archive|удалить|убрать|архивировать)\b/i;

/** One semantic sound per activation; specific intent wins over ordinary button feedback. */
export function soundForActivation(target:Element|null,theme:'dark'|'light'='dark'):StudioSound|null {
 if(!target)return null;
 const explicit=target.closest<HTMLElement>('[data-sound-event]')?.dataset.soundEvent;
 if(explicit==='silent')return null;
 if(explicit==='theme')return theme==='dark'?'daylight':'nightfall';
 if(explicit&&['boop','pluck','daylight','nightfall','shake','drawer','summit','orbit','wink'].includes(explicit))return explicit as StudioSound;
 if(target.closest('.nav-item,[role="tab"]'))return 'pluck';
 const control=target.closest<HTMLElement>('button,[role="button"],a');
 if(!control)return null;
 const words=[control.getAttribute('aria-label'),control.getAttribute('title'),control.textContent].filter(Boolean).join(' ');
 if(deleteWords.test(words))return 'drawer';
 return 'boop';
}

export function activationAttemptIsUnavailable(target:Element|null):boolean {
 return Boolean(target?.closest<HTMLElement>('button:disabled,[role="button"][aria-disabled="true"],[data-sound-unavailable="true"]'));
}
