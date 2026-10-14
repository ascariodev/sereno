# Plan: escritorio-tauri

**Objetivo:** app de escritorio de Sereno para Windows con Tauri v2, con la misma SPA de `web/` empaquetada: queda en la
bandeja del sistema, muestra avisos nativos de las notificaciones en vivo, abre los enlaces en el navegador y se actualiza
sola desde un `latest.json` firmado. Linux y Mac quedan para después.
**Estado:** en curso · Fase actual: 15
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

### [x] Fase 2 — Esqueleto Tauri que abre la SPA [riesgo]
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

### [x] Fase 3 — Detección de escritorio sin service worker
- **Alcance:** `web/src/platform/desktop.ts` con `isDesktop()` (verificar `isTauri` de `@tauri-apps/api/core`). En
  escritorio `main.ts` no registra el service worker ni `listenForNavigation`, y `getPushState` devuelve `unsupported`.
- **Archivos:** `web/package.json` (`@tauri-apps/api`), `web/src/platform/desktop.ts`, `web/src/main.ts`, `web/src/pwa/push.ts`.
- **Terminado cuando:** specs de `desktop.ts` y de `push.ts` con escritorio simulado; en la app, sin `sw.js` registrado.

### [x] Fase 4 — Rutas profundas al recargar [riesgo]
- **Alcance:** comprobar si el protocolo de Tauri devuelve `index.html` para una ruta como `/projects/1/plan` al recargar
  (F5). Si no, usar `createWebHashHistory` solo en escritorio.
- **Archivos:** `web/src/router/index.ts` (solo si hace falta) y su spec.
- **Terminado cuando:** recargar en una ruta profunda de la app de escritorio vuelve a la misma pantalla.

### [x] Fase 5 — Enlaces externos al navegador del sistema
- **Alcance:** plugin `opener` (crate, registro en `lib.rs`, permiso en capabilities, paquete npm). En escritorio, un
  listener de clic en el documento manda al navegador del sistema los `<a target="_blank">` con `http(s)` o `mailto`.
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/capabilities/default.json`,
  `web/src/platform/desktop.ts`, `web/src/main.ts`.
- **Terminado cuando:** spec del listener (http, mailto, mismo origen sin tocar); en la app, un enlace de un mensaje se
  abre en el navegador.

### [x] Fase 6 — Adjuntos con el navegador del sistema
- **Alcance:** en escritorio, previsualizar y descargar un adjunto (mensajes y comentarios de tareas) abre la URL firmada
  recién pedida con `opener` en vez de `window.open` y `location.assign`.
- **Archivos:** `web/src/components/MessageAttachments.vue` y el equivalente de comentarios si no lo reutiliza,
  `web/src/platform/desktop.ts`.
- **Terminado cuando:** specs del componente con escritorio simulado; en la app, descargar un adjunto funciona.

### [x] Fase 7 — Bandeja del sistema e instancia única [riesgo]
- **Alcance:** cerrar la ventana la oculta (la sesión y Reverb siguen vivos); icono en la bandeja con menú Abrir y Salir;
  clic en el icono muestra la ventana. Plugin `single-instance`: abrir Sereno otra vez enfoca la ventana existente.
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/tauri.conf.json`,
  `web/src-tauri/capabilities/default.json`.
- **Terminado cuando:** revisión manual: cerrar, recibir un mensaje en vivo con la ventana oculta (visible al reabrir),
  Salir cierra del todo, segundo arranque enfoca la ventana.

### [x] Fase 8 — Avisos nativos de las notificaciones [riesgo]
- **Alcance:** plugin `notification`. En escritorio, cada notificación nueva que llega por Reverb muestra un aviso
  nativo si la ventana no está enfocada (oculta, minimizada o sin foco) y si la preferencia `push` de su tipo está
  activa. Título y cuerpo con los mismos textos de la bandeja in-app. Pide el permiso del sistema la primera vez.
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/capabilities/default.json`,
  `web/src/platform/desktopNotifications.ts`, `web/src/stores/notifications.ts` (o `main.ts`, donde enganche mejor).
- **Terminado cuando:** spec de `desktopNotifications` (enfocada no muestra, oculta sí, preferencia apagada no, otra
  organización no); en la app, asignarse una tarea con la ventana oculta muestra el aviso de Windows.

### [x] Fase 9 — Clic en el aviso abre el destino [riesgo]
- **Alcance:** clic en el aviso nativo muestra y enfoca la ventana y navega a la URL de la notificación. Verificar en la
  doc si el plugin `notification` expone el clic en Windows; si no, el clic solo enfoca la app y se anota la limitación.
- **Archivos:** `web/src/platform/desktopNotifications.ts`, `web/src-tauri/src/lib.rs` (si hace falta un comando).
- **Terminado cuando:** spec del manejo del clic; en la app, el clic abre la tarea (o queda documentado por qué no).

### [x] Fase 10 — Sección de escritorio en las preferencias
- **Alcance:** en escritorio, la sección "Este dispositivo" de `NotificationPreferencesDialog` deja de hablar de push
  web y muestra el estado del permiso de avisos del sistema (con botón para pedirlo).
- **Archivos:** `web/src/components/NotificationPreferencesDialog.vue`, `web/src/i18n/locales/en.ts` y `es.ts` (o donde
  vivan los textos), `web/src/platform/desktopNotifications.ts`.
- **Terminado cuando:** spec del diálogo en escritorio y en navegador (el navegador no cambia).

### [x] Fase 11 — Iniciar con Windows
- **Alcance:** plugin `autostart`, arrancando oculto en la bandeja; interruptor "Iniciar con Windows" en la sección de
  escritorio del diálogo (apagado por defecto).
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/capabilities/default.json`,
  `web/src/components/NotificationPreferencesDialog.vue`, textos i18n.
- **Terminado cuando:** spec del interruptor; en la app, tras reiniciar Windows con el interruptor activo, Sereno queda en la bandeja.

### [x] Fase 12 — Actualizador firmado [riesgo]
- **Alcance:** plugin `updater` con la clave pública en `tauri.conf.json` (el usuario genera el par con `tauri signer
  generate`; la privada queda fuera del repo) y endpoint `https://sereno.ascario.dev/desktop/latest.json`. Al arrancar y
  cada pocas horas busca versión nueva; si hay, la descarga y un toast ofrece reiniciar.
- **Archivos:** `web/src-tauri/Cargo.toml`, `web/src-tauri/src/lib.rs`, `web/src-tauri/tauri.conf.json`,
  `web/src-tauri/capabilities/default.json`, `web/src/platform/desktopUpdater.ts`.
- **Terminado cuando:** spec de `desktopUpdater` (sin versión nueva, con versión nueva, error de red sin ruido); la prueba
  real queda para la fase 14.

### [x] Fase 13 — Carpeta de descargas en el servidor web
- **Alcance:** nginx sirve `/desktop/` desde una carpeta propia montada aparte de `dist/` (el rsync del deploy con
  `--delete-after` la borraría si estuviera dentro), sin caché para `latest.json`.
- **Archivos:** `web/docker/nginx/default.conf`, `web/docker-compose.prod.yml`, `web/docker/deploy/deploy.sh` (crear la carpeta si falta).
- **Terminado cuando:** tras el deploy, `https://sereno.ascario.dev/desktop/latest.json` responde 404 limpio (carpeta vacía)
  y el resto de la web sigue igual.

### [x] Fase 14 — Script de publicación [riesgo]
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
- 2026-10-13 — Fase 2: CSP fija en `tauri.conf.json` con los hosts de producción a mano (`https://sereno-api.ascario.dev`,
  `wss://sereno-ws.ascario.dev`, tomados de `terminados/web-docker.md`); si cambian los hostnames hay que tocarla. `devCsp`
  aparte para `tauri:dev` (API 8003, Reverb 8086, HMR 5174). `style-src 'unsafe-inline'` con
  `dangerousDisableAssetCspModification: ["style-src"]` (si no, el nonce de Tauri anula los `style=` de Vue).
- 2026-10-13 — Fase 4: se mantiene `createWebHistory` en escritorio. Tauri 2.12.3 (`src/manager/mod.rs` `get_asset`) cae a
  `index.html` para cualquier ruta inexistente; comprobado en el exe debug (`/projects/1/plan` recargada da la SPA). Requiere
  `base` absoluto (`/`, el de hoy) en Vite: con `./` los assets fallan en rutas profundas.
- 2026-10-13 — Fase 5: permiso `opener:allow-open-url` con scope `https://*`, `http://*`, `mailto:*` (no `opener:default`,
  que suma `tel:` y `reveal-item-in-dir`). `installExternalLinks()` en `desktop.ts` escucha `click` en `document` y solo
  actúa con botón principal, evento no cancelado, `target="_blank"` y origen distinto (o `mailto:`).
- 2026-10-13 — Fase 6: `openExternal(url)` en `desktop.ts` es el único punto que llama a `openUrl`. En escritorio,
  `MessageAttachments` (también lo usa `TaskComments`) pide la URL nueva y la abre con `openExternal`, sin el
  `window.open` previo al await; un fallo muestra el toast de error existente.
- 2026-10-13 — Fase 7: bandeja e instancia única solo en Rust (`lib.rs`, feature `tray-icon`,
  `tauri-plugin-single-instance` registrado primero), sin permisos de capabilities. Menú de la bandeja en inglés ("Open
  Sereno", "Quit"): seguir el idioma exige otra dependencia (`sys-locale`). Clic izquierdo muestra la ventana; el menú sale
  con clic derecho. `backgroundThrottling` no tiene efecto en Windows (wry 0.57 solo lo aplica en macOS) y `window.hide()`
  no marca el WebView2 como invisible.
- 2026-10-13 — Fase 8: `tauri-plugin-notification` 2.6.0 con solo `allow-is-permission-granted`, `allow-request-permission`
  y `allow-notify`; el estado de la ventana entra en `core:default`. `notifyDesktop(notification, organizationId,
  activeOrganizationId: () => number | null)` se llama al final de `onNotificationCreated`; la función se reevalúa tras cada
  `await` y el store la anula al cambiar de generación (logout, cambio de organización). Sin aviso para `unknown` ni ya
  leídas. Preferencias por `GET /api/me/notification-preferences` en cada aviso con la ventana sin foco (sin caché). Permiso
  pedido una vez por sesión. Títulos y cuerpos de la bandeja in-app movidos a `web/src/notificationText.ts`.
- 2026-10-13 — Fase 9: el clic se detecta con `onAction` del plugin (permiso `notification:allow-register-listener`): con un
  listener registrado el plugin muestra con `show_tracked` y reporta `actionId: 'tap'`. **Limitación de Windows:** solo
  mientras el toast está en pantalla; un clic desde el Centro de actividades no navega. El aviso lleva
  `extra: { organizationId, path }` (path con `router.resolve(notificationTarget(n)).fullPath`, el mismo destino que la
  bandeja in-app, ahora en `web/src/notificationTarget.ts`). Al clic, el comando Rust `focus_main_window` enfoca siempre y
  solo se navega si `safeRedirect` acepta y la organización sigue activa. `installDesktopNotificationClicks` va en `main.ts`.
- 2026-10-13 — Fase 10: en escritorio la sección `data-test="device"` del diálogo es propia: estado del permiso
  (`device-status`) y botón `request-desktop-permission` si no está concedido. `desktopPermissionGranted()` solo lee;
  `requestDesktopPermission()` pide siempre y actualiza el caché de la fase 8. Claves
  `notificationPreferences.device.desktop.{granted,denied,request}` en `web/src/i18n/{en,es}.json`.
- 2026-10-13 — Fase 11: `tauri-plugin-autostart` 2.7.0 con `init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"]))` y
  permisos `allow-enable`, `allow-disable`, `allow-is-enabled`. La ventana `main` nace con `"visible": false` y el `setup`
  la muestra salvo `--hidden` (`HIDDEN_ARG` en `lib.rs`); single-instance tampoco la muestra si el argv trae `--hidden`.
  Interruptor en la sección de escritorio del diálogo (`web/src/platform/desktopAutostart.ts`). **Riesgo:** auto-launch 0.6.0
  escribe el valor de `HKCU\...\CurrentVersion\Run` sin comillas (`<exe> --hidden`) y la ruta de instalación tiene espacios
  (`C:\Users\Windows 11\...`); Windows suele resolverlo, pero hay que comprobarlo. El plugin no permite comillas.
- 2026-10-14 — Fase 14: `npm run release:desktop [-- <versión|patch|minor|major>] [--notes ..] [--skip-build] [--dry-run]`
  (`web/scripts/release-desktop.mjs`). La versión que manda es la de `tauri.conf.json`; `package.json` la sigue y
  `Cargo.toml` queda en 0.1.0. Sin versión publica la actual (primera publicación 0.1.0). Compila solo NSIS con
  `createUpdaterArtifacts` por `--config`; clave por `TAURI_SIGNING_PRIVATE_KEY_PATH` (reenviada como
  `TAURI_SIGNING_PRIVATE_KEY`) o `TAURI_SIGNING_PRIVATE_KEY`, contraseña `""` por defecto. `latest.json` con
  `windows-x86_64-nsis` y `windows-x86_64` apuntando a `Sereno-<v>-x64-setup.exe`; sube por `scp` primero el instalador y
  luego `latest.json` a `SERENO_DESKTOP_SCP_TARGET` (obligatoria salvo `--dry-run`); `SERENO_DESKTOP_BASE_URL` opcional.
  Salida en `src-tauri/target/release/desktop-release/`. `plugins.updater.requireSignedVersion: true` activado.
- 2026-10-14 — Fase 12: par de firma en `C:\Users\Windows 11\.tauri\` (`sereno.key`, sin contraseña, y `sereno.key.pub`;
  fuera del repo). `tauri-plugin-updater` 2.13.3 y `tauri-plugin-process` 2.4.0; pubkey y endpoint
  `https://sereno.ascario.dev/desktop/latest.json` en `plugins.updater`, `windows.installMode: "passive"`. Permisos
  `updater:allow-check`, `allow-download`, `allow-install`, `process:allow-restart`. `desktopUpdater.ts` comprueba al arrancar
  y cada 6 h; con versión nueva solo `download()`, y el toast Reiniciar llama a `install()` (en Windows lanza el instalador
  y sale; NSIS passive reabre la app) y `relaunch()`. `bundle.createUpdaterArtifacts` queda apagado: la fase 14 lo activa
  con `tauri build --config '{"bundle":{"createUpdaterArtifacts":true}}'` y `TAURI_SIGNING_PRIVATE_KEY_PATH` (o
  `TAURI_SIGNING_PRIVATE_KEY`) en el entorno. **Para la fase 14:** activar `plugins.updater.requireSignedVersion` (protege
  contra volver a una versión vieja firmada) en `tauri.conf.json` antes de la primera publicación.
- 2026-10-14 — Usuario: hacer la fase 13 antes que la 12 mientras genera el par de firma del actualizador.
- 2026-10-14 — Fase 13: carpeta `$SERVER_DIR/desktop` (prod: `/var/www/html/workspace/prod/web/desktop`), hermana de
  `dist/` (el rsync no la toca), montada en nginx como `/usr/share/nginx/desktop:ro`. `location = /desktop/latest.json`
  con `no-cache, no-store, must-revalidate`; `/desktop/` con `no-cache` (revalida por ETag), `try_files $uri =404`,
  `autoindex off`. `deploy.sh` la crea con `mkdir -m 755 -p` solo si falta y no toca dueño ni permisos si ya existe:
  **para la fase 14**, la crea root en el primer deploy, así que hay que darle dueño o grupo al usuario que sube por `scp`.
- 2026-10-13 — Fase 2: `src-tauri/target` y `gen/` los ignora el `.gitignore` que genera Tauri en `web/src-tauri/`; no se
  tocó `web/.gitignore`. `beforeDevCommand` vacío (Vite corre en Docker). Sin iconos android/ios (el móvil va con Expo).
  Crate `sereno`, lib `sereno_lib`, ventana 1280x800 (mínimo 360x480).

## Notas para la próxima sesión
- Fase 14: prueba real pendiente (la corre el usuario). Antes, en el servidor:
  `sudo chown <usuario_scp>: /var/www/html/workspace/prod/web/desktop` (la crea root en el deploy). En PowerShell desde
  `web/`: `$env:TAURI_SIGNING_PRIVATE_KEY_PATH="C:\Users\Windows 11\.tauri\sereno.key"`,
  `$env:SERENO_DESKTOP_SCP_TARGET="<usuario>@<host>:/var/www/html/workspace/prod/web/desktop/"`; `npm run release:desktop`
  (0.1.0), instalar `https://sereno.ascario.dev/desktop/Sereno-0.1.0-x64-setup.exe`, commitear el bump;
  `npm run release:desktop -- 0.1.1`, commitear; abrir la 0.1.0: toast Reiniciar y queda en 0.1.1. Comprobar en el primer
  `.sig` (base64 decodificado) que el comentario de confianza trae `version:0.1.0`: si no, `requireSignedVersion` rompe
  todas las actualizaciones. Si el build falla la versión queda subida: reintentar sin versión.
- Fase 12: en PowerShell `~` no se expande: `tauri signer generate -w ~/.tauri/...` dejó el par en `web/~/.tauri/` (se movió
  sin llegar a git). Rutas absolutas en la fase 14. El build del host sobrescribe `web/dist`.
- Fase 13: verificación pendiente tras el próximo deploy de la web: `https://sereno.ascario.dev/desktop/latest.json` da 404
  y el resto de la web sigue igual.
- Fase 11: revisión manual pendiente con la app **instalada** (el autostart registra la ruta del exe actual): activar el
  interruptor, mirar el valor en `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` y reiniciar la sesión: Sereno
  debe quedar en la bandeja sin ventana.
- Fase 9: revisión manual pendiente con la app **instalada** (en `target/debug` no hay AppUserModelID): con la ventana
  oculta, clic en el aviso de una tarea asignada abre `/projects/<id>/plan?task=<n>`. Windows puede no dar el foco.
- Fase 8: revisión manual pendiente: asignarse una tarea con la ventana oculta muestra el aviso de Windows. Una ronda de
  corrección: faltaba el spec del cableado en el store y el guard de generación tras los `await` (L-50, L-10, L-32).
- Fase 7: revisión manual pendiente: icono en la bandeja, Quit cierra del todo, y con la ventana oculta más de 1-2 minutos
  un mensaje enviado desde otro cliente aparece al reabrir sin recargar. Si no llega (Chromium estrangula por oclusión),
  plan B: `additional_browser_args` con `--disable-features=CalculateNativeWinOcclusion` en la ventana (decisión nueva).
- Fase 6: revisión manual pendiente: descargar y previsualizar un adjunto en la app abre el navegador del sistema.
- Fase 5: la miniatura de `MessageAttachments.vue` tiene `target="_blank"` y `@click="openFresh"`; si `openFresh` hace
  `preventDefault`, el listener de enlaces la ignora (comprobarlo en la fase 6). `openUrl` ya cubre URLs firmadas http(s).
  Revisión manual pendiente: un enlace de un mensaje abre el navegador. `prettier --check` no es chequeo del proyecto.
- Fase 4: el perfil de WebView2 de esta máquina tiene un `sw.js` registrado en `http://tauri.localhost` por el exe de la
  fase 2 (anterior a la fase 3). Antes de una revisión manual, recompilar y borrar ese registro (o el perfil). Para
  inspeccionar la app: lanzar el exe con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`.
  Revisión manual pendiente: con sesión iniciada, F5 en `/projects/<id>/plan` vuelve a esa pantalla.
- Fase 3: `isDesktop()` (en `web/src/platform/desktop.ts`) envuelve `isTauri()` de `@tauri-apps/api/core`, que lee
  `globalThis.isTauri`: en specs se simula con `vi.stubGlobal('isTauri', true)`. Va dentro de `browserSupportsPush()`, así
  que todo `push.ts` queda inactivo en escritorio. Revisión manual pendiente: sin `sw.js` registrado en la app.
  `@tauri-apps/api` se instala en el contenedor y también en el host (`npm install` desde `web/`) para `tauri:build`.
- Fase 2: `npm run tauri:build -- --debug` deja `web/src-tauri/target/debug/bundle/nsis/Sereno_0.1.0_x64-setup.exe` (y el
  `.msi`). **Revisión manual pendiente**: instalar, login contra producción y mensaje en vivo por Reverb. Si falla, mirar
  primero la CSP y que `web/.env.production` tenga las `VITE_*` de producción. El build del host sobrescribe `web/dist`.
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
- [ ] M-6: `bundle.targets` solo NSIS (hoy "all": MSI y NSIS), para un único instalador que use el actualizador (evita que
      una instalación MSI se actualice con el NSIS de `latest.json`; conviene antes de la fase 14).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-7: `desktop.spec.ts` simula `isTauri` con `vi.stubGlobal`/`unstubAllGlobals` en vez de borrar el global con un cast.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-8: En escritorio, desregistrar al arrancar cualquier service worker que haya quedado en el perfil de WebView2
      (hoy solo pasa con builds de prueba anteriores a la fase 3).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-9: Manejar también `auxclick` (botón medio) en el listener de enlaces externos: hoy abre una ventana nueva del WebView.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-10: Un `target="_blank"` del mismo origen (ruta interna en markdown) abre otra ventana WebView: navegar con el router.
      Complejidad: media · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-11: Quitar la condición redundante `url.protocol !== 'mailto:'` en `desktop.ts` (el origen de `mailto:` es `"null"`).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-12: Spec de `MessageAttachments` que instala `installExternalLinks()` en escritorio y afirma que `openUrl` se llama
      una sola vez con la URL nueva; y otro de clic con `ctrlKey` (sin `preventDefault` ni `renew`), que fija que hoy se
      abre el `href` guardado, que puede estar vencido.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-13: Separar el toast de fallo de `openUrl` del de la URL firmada: un fallo del navegador del sistema no debería decir "reintenta".
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [ ] M-14: Menú de la bandeja en el idioma del sistema (crate `sys-locale`), con los textos de `en` y `es`.
      Complejidad: media · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-15: Clic izquierdo en la bandeja alterna ocultar y mostrar si la ventana ya está visible y enfocada.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-16: `log::warn!` en vez de `let _` para los errores de `show`, `unminimize` y `set_focus` en `lib.rs`.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-17: Cachear unos segundos las preferencias de notificación en `desktopNotifications.ts` (invalidando al guardarlas),
      para no hacer un GET por aviso en ráfagas.
      Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [ ] M-18: Spec propio del guard de sesión justo antes de `sendNotification` (tras `ensurePermission`).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-19: Clic en el aviso nativo marca la notificación como leída, como la bandeja in-app.
      Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [ ] M-20: Flag de módulo en `installDesktopNotificationClicks` para no registrar dos `onAction` (HMR o segunda llamada).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → haiku
- [ ] M-21: Si Windows ya bloqueó los avisos, `requestPermission` no muestra nada: indicar cómo activarlos en los ajustes del sistema.
      Complejidad: media · Archivos: 4 · Riesgo: ninguno → sonnet
- [ ] M-22: Specs pendientes de la fase 10: `aria-busy` del botón con la petición pendiente; tras `requestDesktopPermission()`
      concedido, un aviso no vuelve a pedir permiso; `isDesktop` mockeado a `false` explícito en el `beforeEach` del diálogo.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-23: Quitar los JSDoc de `web/src/platform/desktopAutostart.ts` que repiten el nombre de la función.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-24: Si se cierra el toast de actualización sin reiniciar, volver a ofrecerlo en el siguiente ciclo de 6 h.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-25: Revertir el reformateo sin relación de `dangerousDisableAssetCspModification` en `tauri.conf.json`.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-26: `--dry-run` del script de publicación no escribe la versión en `tauri.conf.json` ni `package.json` (hoy la deja
      subida y la siguiente corrida sin argumento publicaría esa), y `--help` aclara que el dry-run compila y exige la clave.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
