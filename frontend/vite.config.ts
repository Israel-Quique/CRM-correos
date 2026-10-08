import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    fs: {
      // Allow Vite to serve hoisted dependencies from the CRM root node_modules.
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 15 * 60 * 1000,
        proxyTimeout: 15 * 60 * 1000,
      },
    },
  },
})
