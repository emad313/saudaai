import { defineConfig } from 'vite'

// The embeddable chat widget: one self-contained file served as /widget.js on any site.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/widget/main.ts',
      name: 'SaudaAIWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
})
