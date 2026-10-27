import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'docs','skills','aetherflow-unity-reporting');
const target=path.join(root,'build','codex-integration');
fs.mkdirSync(path.join(target,'scripts'),{recursive:true});
for(const relative of ['SKILL.md','references/report-manifest.md','references/windows-video.md','references/windows-gif.md','scripts/run-helper.ps1']){
  fs.mkdirSync(path.dirname(path.join(target,relative)),{recursive:true});
  fs.copyFileSync(path.join(source,relative),path.join(target,relative));
}
const {build}=createRequire(import.meta.url)('esbuild');
await build({entryPoints:[path.join(root,'scripts','atelier-unity-report.mjs')],outfile:path.join(target,'scripts','report.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',external:['node:*'],sourcemap:false,legalComments:'inline',logLevel:'silent'});
for(const [from,to] of [['atelier-video.mjs','video.mjs'],['atelier-gif.mjs','gif.mjs']])fs.copyFileSync(path.join(root,'scripts',from),path.join(target,'scripts',to));
// Explicit file list: never ship development files or data found near the template.
const files=['SKILL.md','references/report-manifest.md','references/windows-video.md','references/windows-gif.md','scripts/run-helper.ps1','scripts/report.mjs','scripts/video.mjs','scripts/gif.mjs'];
fs.writeFileSync(path.join(target,'bundle.json'),JSON.stringify({schemaVersion:1,files},null,2)+'\n');
console.log('Prepared portable Codex Unity reporting package.');
