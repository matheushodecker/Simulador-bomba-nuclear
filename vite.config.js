import { defineConfig } from 'vite';

// base './' permite publicar a pasta dist/ em qualquer servidor estático
// (GitHub Pages, Netlify, um pendrive...) sem reconfigurar caminhos.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
