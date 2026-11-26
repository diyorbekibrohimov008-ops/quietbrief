import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const isVercel = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VERCEL,
);

export default defineConfig({
  plugins: isVercel ? [] : [viteSingleFile()],
  build: {
    target: 'es2022',
    minify: true,
    cssCodeSplit: isVercel,
    assetsInlineLimit: isVercel ? 4096 : 100000000,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
