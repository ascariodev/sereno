import { createPinia } from 'pinia'
import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { i18n, installI18nOnApi } from './i18n'
import { createAppRouter } from './router'
import { installAuthOnApi } from './stores/auth'

const app = createApp(App)
app.use(createPinia())

const router = createAppRouter()
installI18nOnApi()
installAuthOnApi(() => {
  if (router.currentRoute.value.name !== 'login') void router.push({ name: 'login' })
})

app.use(i18n).use(router).mount('#app')
