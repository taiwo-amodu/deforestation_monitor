import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/analyze': { target: 'http://127.0.0.1:8766', changeOrigin: true },
      '/healthz': { target: 'http://127.0.0.1:8766', changeOrigin: true },
    },
  },
  resolve: {
    // Fix ESM default import mismatch for `react-leaflet-draw` without breaking
    // `leaflet-draw/dist/leaflet.draw.css` subpath imports.
    alias: [
      {
        find: /^leaflet-draw$/,
        replacement: path.resolve(__dirname, 'src/shims/leaflet-draw.ts'),
      },
    ],
  },
})
