import {describe,expect,it} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('./public/theme-init.js',import.meta.url),'utf8');
function initialTheme(search:string){const document={documentElement:{dataset:{} as Record<string,string>}};vm.runInNewContext(source,{window:{location:{search}},document,URLSearchParams});return document.documentElement.dataset.theme;}

describe('initial renderer theme',()=>{
 it('applies the saved theme before the renderer stylesheet loads',()=>{expect(initialTheme('?theme=light')).toBe('light');expect(initialTheme('?theme=dark')).toBe('dark');});
 it('defaults missing or unsupported theme parameters to dark',()=>{expect(initialTheme('')).toBe('dark');expect(initialTheme('?theme=system')).toBe('dark');});
});
