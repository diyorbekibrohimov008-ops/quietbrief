import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [...(process.env.VERCEL ? [] : [viteSingleFile()])],
  build: {
    target: 'es2022',
    minify: true,
    cssCodeSplit: Boolean(process.env.VERCEL),
    assetsInlineLimit: process.env.VERCEL ? 4096 : 100000000,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
