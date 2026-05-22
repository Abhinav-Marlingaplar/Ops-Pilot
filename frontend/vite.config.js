import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls and WebSocket to the backend during development
    // so you don't need to configure CORS for local dev at all.
    proxy: {
      '/builds':   { target: 'http://localhost:3000', changeOrigin: true },
      '/webhook':  { target: 'http://localhost:3000', changeOrigin: true },
      '/health':   { target: 'http://localhost:3000', changeOrigin: true },
      '/auth':     { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir:   'dist',
    sourcemap: true,
  },
})