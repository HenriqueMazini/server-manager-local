import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// Fonte única da versão: o arquivo VERSION na raiz do repositório.
const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim()

const backend = process.env.SM_BACKEND ?? 'http://localhost:9090'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { proxy: { '/api': backend, '/healthz': backend } },
  build: { outDir: 'dist', emptyOutDir: true },
})
