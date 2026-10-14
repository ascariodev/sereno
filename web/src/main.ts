import { createPinia } from 'pinia'
import { createApp } from 'vue'
import '@fontsource-variable/figtree'
import '@fontsource-variable/jetbrains-mono'
import './style.css'
import { initTheme } from './theme/theme'
import App from './App.vue'
import { i18n, installI18nOnApi } from './i18n'
import { toast } from './components/ui/toast'
import { installExternalLinks, isDesktop } from './platform/desktop'
import { installDesktopNotificationClicks } from './platform/desktopNotifications'
import { installDesktopUpdater } from './platform/desktopUpdater'
import { listenForNavigation, registerServiceWorker } from './pwa/serviceWorker'
import { createAppRouter } from './router'
import { redirectToLogin } from './router/redirectToLogin'
import { installAuthOnApi } from './stores/auth'
import { installOrganizationOnApi, useOrganizationStore } from './stores/organization'

initTheme()

const app = createApp(App)
app.use(createPinia())

const router = createAppRouter()
installI18nOnApi()
installOrganizationOnApi()
installAuthOnApi(() => redirectToLogin(router))

app.use(i18n).use(router).mount('#app')

installExternalLinks()
const organization = useOrganizationStore()
void installDesktopNotificationClicks(router, () => organization.activeId)
installDesktopUpdater()

if (import.meta.env.PROD && !isDesktop() && 'serviceWorker' in navigator) {
  listenForNavigation({ navigate: (path) => void router.push(path) })
  window.addEventListener('load', () => {
    registerServiceWorker({
      onUpdateReady: (applyUpdate) => {
        toast.info(i18n.global.t('pwa.updateReady'), {
          duration: Number.POSITIVE_INFINITY,
          action: { label: i18n.global.t('pwa.reload'), onSelect: applyUpdate },
        })
      },
    }).catch(() => {})
  })
}
