# Plan: escritorio-tauri

**Objetivo:** app de escritorio de Sereno para Windows con Tauri v2, con la misma SPA de `web/` empaquetada: queda en la
bandeja del sistema, muestra avisos nativos de las notificaciones en vivo, abre los enlaces en el navegador y se actualiza
sola desde un `latest.json` firmado. Linux y Mac quedan para después.
**Estado:** en curso · Fase actual: 2
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `web/` (proyecto Tauri en `web/src-tauri/`) y la conf de nginx del stack web. El API no cambia:
  CORS (`api/config/cors.php`) y Reverb (`api/config/reverb.php`) ya aceptan cualquier origen (`*`), incluido el de Tauri.
- Tauri se compila **en el host Windows**, no en Docker (el servicio `web` es Linux): `npm` y `npx tauri` desde `web/`
  con el Node del host. El `node_modules` del host no choca con el del contenedor (volumen `web-node-modules`). El build
  de la SPA para Tauri usa las `VITE_*` de producción (`web/.env.production`, que no se lee: lo mantiene el usuario).
- Puntos de la SPA que tocan Tauri:
  - `web/src/main.ts:28-40` registra el service worker solo en PROD.
  - `web/src/pwa/push.ts` y `NotificationPreferencesDialog.vue` (sección `data-test="device"`, l.157) manejan el push web.
  - Router en modo history (`web/src/router/index.ts:49`).
  - Enlaces: Markdown con `target="_blank"` (`web/src/markdown/renderMarkdown.ts:130`).
  - Adjuntos: `web/src/components/MessageAttachments.vue` (`window.open` en l.62-82, `location.assign` en l.84-92).
  - Notificaciones en vivo: `web/src/stores/notifications.ts:243` `onNotificationCreated`, por `web/src/realtime/echo.ts` (`.notification.created`).
  - Token en `localStorage` (`workspace.token`, `web/src/stores/auth.ts:10`).
- Icono fuente para `tauri icon`: `web/brand/icon-1024.png`.
- Versiones de crates y paquetes `@tauri-apps/*`: las que resuelvan `cargo`/`npm` o la doc oficial de Tauri v2; no inventarlas.
  Toda API de Tauri (plugins, permisos de capabilities, `isTauri`, eventos de ventana) se verifica en la doc antes de usarla.
- Lecciones: leer `docs/lecciones.md` antes de cada fase.

## Fases

### [x] Fase 1 — Toolchain de Rust en el host [manual]
- **Alcance:** el usuario instala Rust (rustup, toolchain estable MSVC) y las Build Tools de Visual Studio con
  "Desarrollo de escritorio con C++". WebView2 ya viene en Windows 11. Claude solo verifica.
- **Archivos:** ninguno.
- **Terminado cuando:** `rustc -V` y `cargo -V` responden en el host y `npx @tauri-apps/cli info` (desde `web/`) no marca
  faltantes para Windows.

### [ ] Fase 2 — Esqueleto Tauri que abre la SPA [riesgo]
- **Alcance:** `@tauri-apps/cli` como devDependency de `web/`; `web/src-tauri/` creado con `tauri init` (nombre Sereno,
  identificador `dev.ascario.sereno`, `frontendDist: ../dist`, `devUrl: http://localhost:5174`, `beforeBuildCommand:
  npm run build`), iconos con `tauri icon web/brand/icon-1024.png`, CSP restringida a la API y a Reverb de producción.
  Scripts `tauri:dev` y `tauri:build`. `src-tauri/target` en `.gitignore` y fuera del watcher de Vite (el contenedor
  `web` hace polling sobre todo `web/`).
- **Archivos:** `web/package.json`, `web/src-tauri/tauri.conf.json`, `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`
  (más `main.rs`, `build.rs`, `capabilities/default.json` e iconos generados), `web/.gitignore`, `web/vite.config.ts`.
  **En el límite:** son los archivos que genera `tauri init`, casi sin tocar.
- **Terminado cuando:** `npm run tauri:build -- --debug` genera el instalador y la app abre el login, inicia sesión contra
  producción y recibe un mensaje en vivo por Reverb (revisión manual). Typecheck y tests de la web siguen pasando.

### [ ] Fase 3 — Detección de escritorio sin service worker
- **Alcance:** `web/src/platform/desktop.ts` con `isDesktop()` (verificar `isTauri` de `@tauri-apps/api/core`). En
  escritorio `main.ts` no registra el service worker ni `listenForNavigation`, y `getPushState` devuelve `unsupported`.
- **Archivos:** `web/package.json` (`@tauri-apps/api`), `web/src/platform/desktop.ts`, `web/src/main.ts`, `web/src/pwa/push.ts`.
- **Terminado cuando:** specs de `desktop.ts` y de `push.ts` con escritorio simulado; en la app, sin `sw.js` registrado.

### [ ] Fase 4 — Rutas profundas al recargar [riesgo]
- **Alcance:** comprobar si el protocolo de Tauri devuelve `index.html` para una ruta como `/projects/1/plan` al recargar
  (F5). Si no, usar `createWebHashHistory` solo en escritorio.
- **Archivos:** `web/src/router/index.ts` (solo si hace falta) y su spec.
- **Terminado cuando:** recargar en una ruta profunda de la app de escritorio vuelve a la misma pantalla.

### [ ] Fase 5 — Enlaces externos al navegador del sistema
- **Alcance:** plugin `opener` (crate, registro en `lib.rs`, permiso en capabilities, paquete npm). En escritorio, un
  listener de clic en el documento manda al navegador del sistema los `<a target="_blank">` con `http(s)` o `mailto`.
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/capabilities/default.json`,
  `web/src/platform/desktop.ts`, `web/src/main.ts`.
- **Terminado cuando:** spec del listener (http, mailto, mismo origen sin tocar); en la app, un enlace de un mensaje se
  abre en el navegador.

### [ ] Fase 6 — Adjuntos con el navegador del sistema
- **Alcance:** en escritorio, previsualizar y descargar un adjunto (mensajes y comentarios de tareas) abre la URL firmada
  recién pedida con `opener` en vez de `window.open` y `location.assign`.
- **Archivos:** `web/src/components/MessageAttachments.vue` y el equivalente de comentarios si no lo reutiliza,
  `web/src/platform/desktop.ts`.
- **Terminado cuando:** specs del componente con escritorio simulado; en la app, descargar un adjunto funciona.

### [ ] Fase 7 — Bandeja del sistema e instancia única [riesgo]
- **Alcance:** cerrar la ventana la oculta (la sesión y Reverb siguen vivos); icono en la bandeja con menú Abrir y Salir;
  clic en el icono muestra la ventana. Plugin `single-instance`: abrir Sereno otra vez enfoca la ventana existente.
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/tauri.conf.json`,
  `web/src-tauri/capabilities/default.json`.
- **Terminado cuando:** revisión manual: cerrar, recibir un mensaje en vivo con la ventana oculta (visible al reabrir),
  Salir cierra del todo, segundo arranque enfoca la ventana.

### [ ] Fase 8 — Avisos nativos de las notificaciones [riesgo]
- **Alcance:** plugin `notification`. En escritorio, cada notificación nueva que llega por Reverb muestra un aviso
  nativo si la ventana no está enfocada (oculta, minimizada o sin foco) y si la preferencia `push` de su tipo está
  activa. Título y cuerpo con los mismos textos de la bandeja in-app. Pide el permiso del sistema la primera vez.
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/capabilities/default.json`,
  `web/src/platform/desktopNotifications.ts`, `web/src/stores/notifications.ts` (o `main.ts`, donde enganche mejor).
- **Terminado cuando:** spec de `desktopNotifications` (enfocada no muestra, oculta sí, preferencia apagada no, otra
  organización no); en la app, asignarse una tarea con la ventana oculta muestra el aviso de Windows.

### [ ] Fase 9 — Clic en el aviso abre el destino [riesgo]
- **Alcance:** clic en el aviso nativo muestra y enfoca la ventana y navega a la URL de la notificación. Verificar en la
  doc si el plugin `notification` expone el clic en Windows; si no, el clic solo enfoca la app y se anota la limitación.
- **Archivos:** `web/src/platform/desktopNotifications.ts`, `web/src-tauri/src/lib.rs` (si hace falta un comando).
- **Terminado cuando:** spec del manejo del clic; en la app, el clic abre la tarea (o queda documentado por qué no).

### [ ] Fase 10 — Sección de escritorio en las preferencias
- **Alcance:** en escritorio, la sección "Este dispositivo" de `NotificationPreferencesDialog` deja de hablar de push
  web y muestra el estado del permiso de avisos del sistema (con botón para pedirlo).
- **Archivos:** `web/src/components/NotificationPreferencesDialog.vue`, `web/src/i18n/locales/en.ts` y `es.ts` (o donde
  vivan los textos), `web/src/platform/desktopNotifications.ts`.
- **Terminado cuando:** spec del diálogo en escritorio y en navegador (el navegador no cambia).

### [ ] Fase 11 — Iniciar con Windows
- **Alcance:** plugin `autostart`, arrancando oculto en la bandeja; interruptor "Iniciar con Windows" en la sección de
  escritorio del diálogo (apagado por defecto).
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/capabilities/default.json`,
  `web/src/components/NotificationPreferencesDialog.vue`, textos i18n.
- **Terminado cuando:** spec del interruptor; en la app, tras reiniciar Windows con el interruptor activo, Sereno queda en la bandeja.

### [ ] Fase 12 — Actualizador firmado [riesgo]
- **Alcance:** plugin `updater` con la clave pública en `tauri.conf.json` (el usuario genera el par con `tauri signer
  generate`; la privada queda fuera del repo) y endpoint `https://sereno.ascario.dev/desktop/latest.json`. Al arrancar y
  cada pocas horas busca versión nueva; si hay, la descarga y un toast ofrece reiniciar.
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/tauri.conf.json`,
  `web/src-tauri/capabilities/default.json`, `web/src/platform/desktopUpdater.ts`.
- **Terminado cuando:** spec de `desktopUpdater` (sin versión nueva, con versión nueva, error de red sin ruido); la prueba
  real queda para la fase 14.

### [ ] Fase 13 — Carpeta de descargas en el servidor web
- **Alcance:** nginx sirve `/desktop/` desde una carpeta propia montada aparte de `dist/` (el rsync del deploy con
  `--delete-after` la borraría si estuviera dentro), sin caché para `latest.json`.
- **Archivos:** `web/docker/nginx/default.conf`, `web/docker-compose.prod.yml`, `web/docker/deploy/deploy.sh` (crear la carpeta si falta).
- **Terminado cuando:** tras el deploy, `https://sereno.ascario.dev/desktop/latest.json` responde 404 limpio (carpeta vacía)
  y el resto de la web sigue igual.

### [ ] Fase 14 — Script de publicación [riesgo]
- **Alcance:** `web/scripts/release-desktop.mjs`: sube la versión (`package.json` y `tauri.conf.json` a la par),
  compila con la clave de firma tomada del entorno, arma `latest.json` con la firma y la URL del instalador, y lo sube
  a la carpeta del servidor por `scp` (el usuario lo corre; no hay credenciales en el repo).
- **Archivos:** `web/scripts/release-desktop.mjs`, `web/package.json`.
- **Terminado cuando:** publicar 0.1.0 y luego 0.1.1: una app con 0.1.0 instalada se actualiza sola a 0.1.1.

### [ ] Fase 15 — Documentación
- **Alcance:** `CLAUDE.md` (paso 8 hecho, comandos de Tauri, publicación) y lección si hubo retrabajo.
- **Archivos:** `CLAUDE.md`, `docs/lecciones.md`.
- **Terminado cuando:** una sesión nueva puede compilar y publicar siguiendo `CLAUDE.md`.

## Decisiones
- 2026-10-13 — Usuario: SPA empaquetada en el instalador (no cargar la URL remota); habla con `sereno-api.ascario.dev`.
- 2026-10-13 — Usuario: primera versión solo Windows; Linux y Mac anotados como mejoras.
- 2026-10-13 — Usuario: el Web Push no funciona dentro de Tauri; bandeja del sistema con Reverb vivo y avisos nativos.
- 2026-10-13 — Usuario: compilar en el host y publicar con el actualizador firmado de Tauri; sin certificado de firma
  de código por ahora (SmartScreen avisará al instalar).
- 2026-10-13 — Proyecto Tauri dentro de `web/` (`web/src-tauri/`): la SPA necesita los paquetes `@tauri-apps/*` en su
  propio `package.json`.
- 2026-10-13 — Los avisos nativos respetan las preferencias `push` por tipo: en escritorio ese canal significa "avisos de
  este dispositivo".
- 2026-10-13 — Token sigue en `localStorage` del WebView (decisión de `web-minima` revisada): el perfil de WebView2 es
  local del usuario de Windows; moverlo al llavero del sistema queda como mejora.

## Notas para la próxima sesión
- Fase 1 verificada el 2026-10-13: rustc y cargo 1.99.0 (stable MSVC), VS Community 2022 con C++, WebView2 155; `tauri info` sin faltantes (CLI 2.12.2 por npx). En Git Bash, `~/.cargo/bin` no está en el PATH: anteponer `export PATH="/c/Users/Windows 11/.cargo/bin:$PATH"`.

## Mejoras propuestas
- [ ] M-1: Versión para Linux (AppImage o .deb), compilada en el runner Linux de Gitea.
      Complejidad: alta · Archivos: 4 · Riesgo: integración externa → plan nuevo
- [ ] M-2: Versión para Mac (exige compilar en un Mac y firma y notarización de Apple).
      Complejidad: alta · Archivos: 4 · Riesgo: integración externa → plan nuevo
- [ ] M-3: Certificado de firma de código para Windows, para que SmartScreen no avise al instalar.
      Complejidad: media · Archivos: 2 · Riesgo: integración externa → sonnet
- [ ] M-4: Token en el llavero del sistema (plugin de Tauri) en vez de `localStorage`.
      Complejidad: alta · Archivos: 4 · Riesgo: seguridad → opus
- [ ] M-5: Enlaces profundos `sereno://` para que los enlaces de los correos abran la app de escritorio.
      Complejidad: alta · Archivos: 5 · Riesgo: integración externa → opus
