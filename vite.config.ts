import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { serverPlugin } from './server/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), serverPlugin()],
  /* Vite's static-analysis pass in dev mode walks the import graph
     once at startup. Dynamic imports whose string argument is a
     bare specifier (e.g. `await import('force-graph')`) are NOT
     picked up automatically — the optimizer only sees them when
     the browser actually requests the chunk, but at that point
     it has no time to pre-bundle a 200KB+ module from scratch.
     Listing the package here forces Vite to pre-bundle it
     eagerly on dev server start, so the first dynamic import
     resolves instantly. The same fix applies to any other
     heavy dynamic-imported library (markmap, mermaid). */
  optimizeDeps: {
    include: ['force-graph'],
  },
})
