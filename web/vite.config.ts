import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const devHost = process.env.DEV_HOST
const devPolling = process.env.DEV_POLLING === 'true'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    strictPort: true,
    ...(devHost ? { host: devHost } : {}),
    ...(devPolling ? { watch: { usePolling: true } } : {}),
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
