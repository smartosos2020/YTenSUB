import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { loadClientConfig } from './scripts/client-config.mjs'

export default defineConfig(({ mode }) => {
  const { apiUrl, updateUrl } = loadClientConfig(mode, __dirname)
  const define = {
    'process.env.EXPO_PUBLIC_YTENSUB_API_URL': JSON.stringify(apiUrl),
    'process.env.YTENSUB_UPDATE_URL': JSON.stringify(updateUrl)
  }
  return {
    main: {
      define,
      plugins: [externalizeDepsPlugin()]
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/preload/index.ts'),
            'webview-preload': resolve(__dirname, 'src/preload/webview-preload.ts')
          }
        }
      }
    },
    renderer: {
      define,
      plugins: [react(), {
        name: 'client-api-csp',
        transformIndexHtml(html) {
          return html.replace('__YTENSUB_API_ORIGIN__', new URL(apiUrl).origin)
        }
      }]
    }
  }
})
