import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({main:{build:{rollupOptions:{input:{index:resolve('src/main/index.ts')}}}},preload:{build:{rollupOptions:{input:{index:resolve('src/preload/index.ts')},output:{format:'cjs',entryFileNames:'index.cjs'}}}},renderer:{plugins:[react()],resolve:{alias:{'@':resolve('src/renderer')}},root:resolve('src/renderer')}});
