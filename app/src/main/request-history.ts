import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {AtelierStore} from './store';
import {isPathWithin} from './path-containment';
import {isLocale,type Locale} from '../shared/i18n';

export function readImmutableStageRequest(store:AtelierStore,id:string):{id:string;locale:Locale;hash:string;markdown:string}{
  const request=store.get('stageRequest',id);if(!request)throw new Error('Saved stage request was not found.');
  const root=path.resolve(store.root,'requests'),relative=String(request.data.requestFile||'').replace(/\\/g,'/');
  if(!relative||relative.startsWith('/')||relative.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':')))throw new Error('Saved stage request path is invalid.');
  const file=path.resolve(store.root,...relative.split('/'));if(!isPathWithin(root,file)||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.realpathSync.native(file)!==file)throw new Error('Saved stage request is outside the immutable request folder.');
  const markdown=fs.readFileSync(file,'utf8'),hash=crypto.createHash('sha256').update(markdown).digest('hex');if(hash!==request.data.requestHash)throw new Error('Saved stage request bytes no longer match their recorded hash.');
  return {id,locale:isLocale(request.data.locale)?request.data.locale:'en',hash,markdown};
}
