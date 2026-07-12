import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { serverPlugin } from './server/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), serverPlugin()],
})
