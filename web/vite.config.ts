import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/me': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
      '/workspaces': 'http://localhost:8080',
      '/workspace-order': 'http://localhost:8080',
      '/links': 'http://localhost:8080',
      '/resolve': 'http://localhost:8080',
    },
  },
})
