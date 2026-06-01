import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { mdPlugin } from './src/vite-plugin-md'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), mdPlugin()],
})
