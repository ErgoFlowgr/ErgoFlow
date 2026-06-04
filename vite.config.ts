import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Vite config for the React renderer process only.
// The Electron main process is compiled separately via tsconfig.electron.json.
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      buffer: 'buffer/',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes('node_modules') ? 'vendor' : undefined
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
  },
  // Prevent Vite from trying to bundle Node.js-only modules
  optimizeDeps: {
    exclude: ['better-sqlite3', 'keytar', 'pdf-parse', 'electron'],
  },
})
