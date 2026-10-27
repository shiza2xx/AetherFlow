import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {encodeIco,ICON_SIZES} from '../src/shared/icon-codec.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),{PNG}=createRequire(import.meta.url)('pngjs');
fs.mkdirSync(path.join(root,'build','icons'),{recursive:true});
for(const theme of ['light','dark']){
 const source=path.join(root,'src','renderer','assets',`app-icon-${theme}.png`),image=PNG.sync.read(fs.readFileSync(source));
 if(image.width!==image.height||image.width<256)throw new Error('The approved application icon must be a square PNG of at least 256 pixels.');
 const ico=encodeIco(image);fs.writeFileSync(path.join(root,'build','icons',`app-icon-${theme}.ico`),ico);
 if(theme==='light')fs.writeFileSync(path.join(root,'build','icon.ico'),ico);
}
console.log(`Prepared light/dark Windows icons with ${ICON_SIZES.join('/')} px frames.`);
