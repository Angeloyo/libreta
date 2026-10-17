import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The web app lives in src/web. In dev, /api and /ws go to the libreta server.
const server = `localhost:${process.env.LIBRETA_PORT ?? 4747}`

export default defineConfig({
  root: 'src/web',
  publicDir: '../../assets',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    port: Number(process.env.LIBRETA_WEB_PORT ?? 5173),
    proxy: {
      '/api': `http://${server}`,
      '/ws': { target: `ws://${server}`, ws: true },
    },
  },
})
