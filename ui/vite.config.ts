import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
// Use relative base so the same build works at site root (CloudFront) and under a
// path prefix (e.g. nginx proxy at /consulting-detective/). Asset URLs become
// relative (e.g. ./assets/...) and resolve correctly in both cases.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../lib/types'),
    },
  },
})
