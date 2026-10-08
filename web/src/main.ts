import { createPinia } from 'pinia'
import { createApp } from 'vue'
import '@fontsource-variable/figtree'
import '@fontsource-variable/jetbrains-mono'
import './style.css'
import { initTheme } from './theme/theme'
import App from './App.vue'
import { i18n, installI18nOnApi } from './i18n'
import { createAppRouter } from './router'
import { redirectToLogin } from './router/redirectToLogin'
import { installAuthOnApi } from './stores/auth'
import { installOrganizationOnApi } from './stores/organization'

initTheme()

const app = createApp(App)
app.use(createPinia())

const router = createAppRouter()
installI18nOnApi()
installOrganizationOnApi()
installAuthOnApi(() => redirectToLogin(router))

app.use(i18n).use(router).mount('#app')
