import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
