import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { i18n, installI18nOnApi } from './i18n'

installI18nOnApi()

createApp(App).use(i18n).mount('#app')
