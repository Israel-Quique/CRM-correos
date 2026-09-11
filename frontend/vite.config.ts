import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    fs: {
      // Allow Vite to serve hoisted dependencies from the CRM root node_modules.
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
