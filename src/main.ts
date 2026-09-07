import { createApp } from 'vue'
import './ui/tokens.css'
import './style.css'
import './shiki.css'
import 'katex/dist/katex.min.css'
import DocusUiRoot from './ui/DocusUiRoot.vue'
import router from './router'

createApp(DocusUiRoot).use(router).mount('#app')
