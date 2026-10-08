# Plan: web-minima

**Objetivo:** `workspace-web` (Vue 3 SPA) donde una persona inicia sesión, elige su organización, ve sus proyectos y entra al
canal del proyecto: lee el historial, escribe mensajes, recibe en tiempo real los avisos de log y los resuelve o ignora. (Paso 4 del MVP.)
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Repos: `workspace-api` (fases 1 y 2) y `workspace-web` (nuevo, se crea en la fase 3). Commits con `git -C <repo>`.
- API (todo con `Accept: application/json` y `Authorization: Bearer <token>`; idioma por `Accept-Language`):
  - `POST /api/auth/login` → `{token, user:{id,name,email,locale}}`; 422 en `errors.email`. `POST /api/auth/logout` (204). `GET /api/me` → `{data}`.
  - `GET /api/organizations` → `{data:[{id,name,slug,settings,roles:[...]}]}`. No hay "organización activa" en el servidor:
    el cliente manda `X-Organization-Id` en cada petición de organización (falta o no numérico: 400; no miembro: 403).
  - Con `X-Organization-Id`: `GET /api/projects` (paginado, `data/links/meta`), `GET /api/channels` (sin paginar;
    `{id, project_id, name, archived_at, created_at, project:{id,name,key}}`), `GET /api/channels/{c}/messages?cursor=&per_page=`
    (más nuevos primero, siguiente página en `meta.next_cursor`), `POST /api/channels/{c}/messages` `{body}` (1..4000; 422; 429),
    `PATCH /api/projects/{p}/log-groups/{g}` `{status: open|resolved|ignored}`.
  - `MessageResource`: `{id, channel_id, kind: user|system, body, payload, log_group_id, user:{id,name}|null, created_at}`.
    Sistema: `payload.type` = `log.group_opened` | `log.group_reopened` (`log_group_id, level, title, events_count`) o
    `log.group_status_changed` (`log_group_id, status, previous_status`; el actor es `user`). El cliente arma el texto en su idioma.
  - Tiempo real: Reverb en `ws://localhost:8086`; canal privado `private-organizations.{orgId}.channels.{channelId}`, evento
    `.message.created` con `{message}`; auth en `POST http://localhost:8003/broadcasting/auth` con Bearer (no necesita `X-Organization-Id`).
- Node 24 y npm 11 instalados en la máquina: la web corre en local (no en Docker). Dev server en el puerto 5174 (5173 lo usa sicm).
- Restricción: los agentes no pueden leer ni escribir `.env*`. La key pública de Reverb va en `workspace-web/.env.local`, que crea el usuario.

## Fases

### [x] Fase 1 — CORS para la SPA
- **Alcance:** publicar `config/cors.php` con `paths` `api/*` y `broadcasting/auth` (orígenes `*`, sin credenciales: la auth es Bearer).
- **Archivos:** `workspace-api/config/cors.php`, test.
- **Terminado cuando:** test: un preflight `OPTIONS /broadcasting/auth` y uno a `/api/me` con `Origin: http://localhost:5174` devuelven
  `Access-Control-Allow-Origin`.

### [x] Fase 2 — Datos de desarrollo
- **Alcance:** `DatabaseSeeder` deja, además del usuario `test@example.com`, una organización con ese usuario como owner, un
  proyecto con su canal (el canal hoy lo crea `ProjectController::store`: replicarlo o extraerlo sin cambiar el controlador) y
  unos mensajes de persona y de sistema. Idempotente.
- **Archivos:** `database/seeders/DatabaseSeeder.php` (o un `DevelopmentSeeder`), test.
- **Terminado cuando:** test que corre el seeder dos veces y cuenta organización, proyecto, canal y mensajes.

### [x] Fase 3 — Esqueleto de workspace-web [riesgo]
- **Alcance:** `npm create vite` (Vue + TypeScript) en `workspace-web/`, `git init`, Vite en 5174 con `strictPort`, Vitest con jsdom
  y `@vue/test-utils`, scripts `dev`, `build`, `typecheck` (vue-tsc) y `test`. `src/config.ts` lee `VITE_API_URL`,
  `VITE_REVERB_*` con valores por defecto de desarrollo (salvo la key). Un test trivial. Comandos y puerto en `CLAUDE.md`.
- **Archivos:** generados por el scaffold, `vite.config.ts`, `src/config.ts`, `CLAUDE.md` (mapa, puertos, comandos de web).
- **Terminado cuando:** `npm run typecheck`, `npm run test -- --run` y `npm run build` pasan; `npm run dev` sirve en 5174.

### [x] Fase 4 — Cliente HTTP
- **Alcance:** `src/api/client.ts` sobre `fetch` (sin axios): base URL, `Accept`, Bearer, `X-Organization-Id` y `Accept-Language`
  cuando haya; errores normalizados (`ApiError` con `status`, `message`, `errors` de 422); un 401 avisa a la sesión. Tipos de los
  recursos en `src/api/types.ts`.
- **Archivos:** `src/api/client.ts`, `src/api/types.ts`, test.
- **Terminado cuando:** tests con `fetch` simulado: headers, 422 con errores por campo, 401 dispara el aviso, 204 sin cuerpo.

### [x] Fase 5 — Idiomas
- **Alcance:** vue-i18n con `en` y `es`; idioma: `user.locale`, luego el del navegador (`en`/`es`), luego `en`. El cliente HTTP manda
  ese idioma en `Accept-Language`.
- **Archivos:** `src/i18n/index.ts`, `src/i18n/en.json`, `src/i18n/es.json`, `src/main.ts`.
- **Terminado cuando:** tests de la elección de idioma y de que en/es tienen las mismas claves (no vacías, L-01).

### [x] Fase 6 — Sesión
- **Alcance:** Pinia; store `auth` (token en `localStorage`, `login`, `logout`, `fetchMe`, limpiar al 401); vue-router con guard:
  sin token → `/login`.
- **Archivos:** `src/stores/auth.ts`, `src/router/index.ts`, `src/main.ts`, `src/App.vue`.
- **Terminado cuando:** tests del store (login guarda token y usuario, logout limpia, 401 cierra la sesión) y del guard.

### [x] Fase 7 — Pantalla de login
- **Alcance:** `LoginView`: email y contraseña, errores 422 por campo y 429, textos por i18n, redirige a proyectos.
- **Archivos:** `src/views/LoginView.vue`, `src/i18n/en.json`, `src/i18n/es.json`, `src/router/index.ts`.
- **Terminado cuando:** test de componente: envía, muestra el error de `email`, redirige al éxito.

### [x] Fase 8 — Organización activa
- **Alcance:** store `organization`: carga `GET organizations`, elige la guardada o la primera, persiste el id; el cliente manda
  `X-Organization-Id`. Selector en un layout con el nombre del usuario y "cerrar sesión". Sin organizaciones: mensaje.
- **Archivos:** `src/stores/organization.ts`, `src/layouts/AppLayout.vue`, `src/router/index.ts`, `src/i18n/*.json`.
- **Terminado cuando:** tests del store (elige, persiste, cambia y limpia datos dependientes) y del layout.

### [x] Fase 9 — Lista de proyectos
- **Alcance:** `ProjectsView`: proyectos no archivados de la organización activa, cada uno enlaza a su canal (por `GET channels`).
- **Archivos:** `src/views/ProjectsView.vue`, `src/router/index.ts`, `src/i18n/*.json`.
- **Terminado cuando:** test de componente con la API simulada; cambiar de organización recarga la lista.

### [x] Fase 10 — Historial del canal
- **Alcance:** `ChannelView` (`/channels/:id`): mensajes de persona del más viejo al más nuevo en pantalla, "cargar anteriores"
  con `next_cursor`; los de sistema se muestran como un aviso genérico (fase 11 los detalla).
- **Archivos:** `src/views/ChannelView.vue`, `src/components/MessageList.vue`, `src/stores/messages.ts`, `src/router/index.ts`.
- **Terminado cuando:** tests: orden, paginación con cursor sin duplicados y canal de otra organización (404) con mensaje.

### [x] Fase 11 — Avisos de log en el canal
- **Alcance:** `SystemNotice` arma el texto por `payload.type` con i18n (grupo abierto/reabierto con nivel, título y eventos;
  cambio de estado con actor y estado).
- **Archivos:** `src/components/SystemNotice.vue`, `src/components/MessageList.vue`, `src/i18n/*.json`.
- **Terminado cuando:** test por cada `payload.type` en `en` y `es`, y uno con un `type` desconocido que no rompe.

### [x] Fase 12 — Escribir mensajes
- **Alcance:** `MessageComposer`: envía con Enter (Shift+Enter salto de línea), límite 4000, errores 422/429, deshabilitado en
  canal archivado; el mensaje propio se agrega con la respuesta del POST. API: `GET /api/channels` acepta `include_archived`
  (como projects), con test; `ChannelView` lo usa para saber si el canal está archivado.
- **Archivos:** `src/components/MessageComposer.vue`, `src/stores/messages.ts`, `src/views/ChannelView.vue`, `src/i18n/*.json`;
  `workspace-api`: `ChannelController` (y su request si hace falta), test de canales.
- **Terminado cuando:** tests: envía y limpia, 422 muestra el error, canal archivado sin composer.

### [x] Fase 13 — Tiempo real [riesgo]
- **Alcance:** `laravel-echo` + `pusher-js` con `authorizer` propio (Bearer a `/broadcasting/auth`); al entrar al canal se suscribe
  y al salir se desuscribe; `.message.created` agrega el mensaje si no está (dedupe por id con el del POST propio).
  Requiere que el usuario haya creado `workspace-web/.env.local` con `VITE_REVERB_APP_KEY`.
- **Archivos:** `src/realtime/echo.ts`, `src/stores/messages.ts`, `src/views/ChannelView.vue`.
- **Terminado cuando:** tests con Echo simulado (suscribe, dedupe, desuscribe al salir) y prueba manual en el navegador: dos sesiones
  ven en vivo los mensajes de la otra, y un evento ingerido por `POST /api/ingest/events` aparece como aviso.

### [x] Fase 14 — Acciones del aviso
- **Alcance:** en `SystemNotice` de grupo abierto/reabierto: botones resolver e ignorar (`PATCH` del log-group con el `project_id`
  del canal); el aviso de cambio de estado que emite la API llega por tiempo real. Error 403/422 visible.
- **Archivos:** `src/components/SystemNotice.vue`, `src/api/` (función del PATCH), `src/i18n/*.json`.
- **Terminado cuando:** tests: el botón llama al PATCH correcto y deshabilita mientras espera; error visible. Prueba manual del flujo.

## Decisiones
- 2026-10-07 — Fase 14: botones resolver/ignorar solo en `log.group_opened`/`reopened` con `projectId` y `log_group_id`; se muestran
  también en avisos viejos (el aviso no conoce el estado actual y el PATCH al mismo estado no hace nada). El resultado se ve por
  el aviso de cambio de estado en tiempo real. El API lo publica en el primer canal no archivado del proyecto.
- 2026-10-07 — Fase 13: `stores/auth.ts` (fuera de la lista del plan) desconecta Echo en `clearSession` y le da el token
  (`setRealtimeTokenProvider`). Sin `VITE_REVERB_APP_KEY` la web funciona sin tiempo real.
- 2026-10-07 — Usuario: para saber si un canal está archivado se amplía el API (opción "Ampliar el API"): `GET /api/channels`
  acepta `include_archived`, como projects. Se hace en la fase 12 (commit en `workspace-api` y en `workspace-web`).
- 2026-10-07 — Fase 8: el id de la organización activa persiste en `localStorage['workspace.organization']` tras logout/401
  (solo se limpia la memoria); `load()` lo valida contra la lista del usuario y, si no está, usa la primera.
- 2026-10-07 — Fase 7: los errores 422 se muestran con el texto que manda la API (ya traducido); 429, red y otros fallos usan
  claves i18n propias. `ApiError` no guarda `Retry-After`, así que el 429 no dice cuántos segundos faltan.
- 2026-10-07 — Fase 4: `Channel.project` y `Message.user` requeridos en los tipos porque todos los endpoints actuales cargan esas
  relaciones (`user` es `null` en mensajes de sistema). Si un endpoint nuevo no las carga, volverlos opcionales.
- 2026-10-07 — `workspace-web` usa la misma identidad git local que `workspace-api` (no hay global) y `.gitattributes`
  `* text=auto eol=lf`, igual que el API.
- 2026-10-07 — Fase 3: `src/config.ts` exporta `readConfig(env)` y `config = readConfig(import.meta.env)`; defaults
  `http://localhost:8003`, Reverb `localhost:8086` `http`, key vacía. Tests `*.spec.ts` junto al código.
- 2026-10-07 — Fase 2: datos de desarrollo en `DatabaseSeeder` (no un seeder aparte). Con `WithoutModelEvents` el trait no rellena
  `organization_id`: se pasa explícito con `forceFill`, y al sembrar no se emite broadcast.
- 2026-10-07 — Web en local con Node 24 (no Docker), Vite en 5174.
- 2026-10-07 — Stack: Vue 3 + TypeScript + Vite, Pinia, vue-router, vue-i18n, Vitest + @vue/test-utils + jsdom, laravel-echo +
  pusher-js. Sin framework de UI ni de CSS (CSS propio mínimo); sin axios (`fetch`). Dependencias aprobadas al aprobar el plan.
- 2026-10-07 — Token Bearer en `localStorage` (la API no usa cookies). Revisar al llegar a Tauri (paso 8).
- 2026-10-07 — Sin registro ni invitaciones en la web mínima: la cuenta y la organización salen del seeder (fase 2).

## Notas para la próxima sesión
- Plan terminado el 2026-10-07. Prueba manual hecha en el navegador: dos pestañas ven en vivo el mensaje de la otra (sin duplicar
  en la que envía), un evento de `POST /api/ingest/events` aparece como aviso crítico, y "Resolver" hace el PATCH (200) y el aviso
  de cambio de estado llega en vivo a la otra pestaña. Sin errores de consola. Suite del API: 352 tests en verde.
- La key de Reverb quedó en `workspace-web/.env` (no `.env.local`), que el `.gitignore` actual no ignora: no versionarlo (M-4).
- En la base local quedó una fuente de log `manual-test` en el proyecto DEMO, creada para la prueba.
- `.claude/launch.json` (raíz) arranca la web en 5174 para el panel del navegador.

## Mejoras propuestas
- [x] M-1 — `CorsTest`: afirmar que `Access-Control-Allow-Origin` es `'*'` (no solo no nulo) y mover `SPA_ORIGIN` de constante
  global de Pest a variable local del archivo. Baja (1 archivo de test, evidente) · sonnet.
- [x] M-2 — `DatabaseSeeder`: verificar al usuario de desarrollo (`email_verified_at`), que `firstOrCreate` descarta por no ser
  fillable. Baja (1 archivo) · sonnet.
- [x] M-3 — `DatabaseSeeder`: el grupo de log queda `open` pero el aviso sembrado dice `resolved` (`previous_status: open`); alinear
  el estado del grupo con el último aviso. Baja (1–2 archivos) · sonnet.
- [x] M-4 — `workspace-web/.gitignore`: ignorar también `.env` y `.env.*` (hoy solo `*.local`). Baja (1 archivo) · sonnet.
- [x] M-5 — `workspace-web/package.json`: declarar `engines.node` `>=24`. Baja (1 archivo) · sonnet.
- [x] M-6 — `client.ts`: normalizar en `ApiError` un 2xx con cuerpo no JSON (hoy `SyntaxError`). Baja (1–2 archivos) · sonnet.
- [x] M-7 — `types.ts`: tipar `Paginated.meta` (`current_page`, `last_page`, `per_page`, `total`). Baja (1 archivo) · sonnet.
- [x] M-8 — `client.spec.ts`: tests de aborto (`AbortError` se relanza) y de `query`. Baja (1 archivo de test) · sonnet.
- [x] M-9 — `src/i18n/index.spec.ts`: `afterEach` que restaure el locale para no contaminar otros tests. Baja (1 archivo) · sonnet.
- [x] M-10 — Guard (`router/index.ts`): si `fetchMe` falla con 5xx o sin red, mostrar error o reintentar en vez de entrar con
  `auth.user` null. Media (2–3 archivos, decidir la UX) · sonnet.
- [x] M-11 — `main.ts`: al expirar la sesión (401) llevar `redirect` con la ruta actual a `login`. Baja (1 archivo) · sonnet.
- [x] M-12 — `index.html`/`public/`: quitar el favicon `vite.svg` del scaffold si sigue. Baja · sonnet.
- [x] M-13 — `LoginView`: rechazar `\` en `?redirect` (y test con `/\evil`); si un 422 no trae `email`/`password`, caer en
  `login.failed`. Baja (2 archivos) · sonnet.
- [x] M-14 — `LoginView`: `aria-invalid` y `aria-describedby` en inputs con error. Baja (1 archivo) · sonnet.
- [x] M-15 — `AppLayout.vue`: un `load()` descartado apaga `loading` mientras otro sigue en vuelo (parpadeo). Baja (1 archivo) · sonnet.
- [x] M-16 — `ProjectsView.spec.ts`: test con `last_page: 2` que pida y concatene las dos páginas. Baja (1 archivo) · sonnet.
- [x] M-17 — `ProjectsView`: clave i18n propia `projects.loading` en vez de reutilizar `organization.loading`. Baja · sonnet.
- [x] M-18 — `ChannelView`/`MessageList`: pista cuando falla cargar el nombre del canal y texto de respaldo si `user` es null en un
  mensaje de persona. Baja (2 archivos) · sonnet.
- [x] M-19 — `types.ts`/`SystemNotice.vue`: separar las variantes de `MessagePayload` para que el `switch` estreche sin
  `as GroupPayload`/`as StatusPayload`. Baja (2 archivos) · sonnet.
- [x] M-20 — `MessageComposer`: no borrar lo tecleado durante el envío (deshabilitar el textarea mientras `sending`, o limpiar solo
  si no cambió). Baja (1–2 archivos) · sonnet.
- [x] M-21 — Tiempo real: al reconectar el WebSocket, recargar el canal (`open()`) para recuperar mensajes perdidos durante la
  caída. Media (2–3 archivos, decidir UX) · sonnet.
- [x] M-22 — Vitest `setupFiles` que fije `setRealtimeClientFactory(() => null)` para que ningún spec abra un WebSocket real con
  `.env.local`, y extraer el `fakeClient` duplicado a un helper. Baja (3–4 archivos de test) · sonnet.
- [x] M-23 — `SystemNotice`: confirmación local tras un PATCH exitoso (ocultar botones o "hecho"), clase de estilo para el error y
  test del 404. Baja (2 archivos) · sonnet.
- [x] M-24 — `client.ts`: los mensajes literales de `ApiError` (`Network error`, `Invalid JSON response`) pasan por i18n si la UI los muestra. Baja (2–3 archivos) · sonnet. No aplica: la UI nunca muestra esos literales (solo `message` del 422, que traduce el API).
- [x] M-25 — Extraer `redirectTarget` (duplicado en `LoginView` y `SessionErrorView`, y `isLocalPath` en `router/redirectToLogin.ts`) a un único util que además rechace `\` y `/session-error`, y tests del guard con `fullPath` `/` y del reintento con 401 que termina en login. Coordinar con M-13. Baja (3–4 archivos) · sonnet.
- [x] M-26 — `<html lang>` sigue el idioma activo (`setLocale` actualiza `document.documentElement.lang`). Baja (1–2 archivos) · sonnet.
- [x] M-27 — `ChannelView`/`MessageList`: claves i18n propias (o una común `common.loading`/`common.retry`) en vez de `organization.loading`/`organization.retry`. Baja (3–4 archivos) · sonnet.
- [x] M-28 — `catchUp`: si la caída dejó más de una página de mensajes nuevos, paginar hasta empalmar con lo cargado (hoy queda un hueco); tests directos de `catchUp` en `messages.spec`. Media (2–3 archivos) · sonnet.
- [x] M-29 — `echo.spec.ts`: el `afterEach` restaura con `setRealtimeClientFactory(() => null)` en vez de `null` (no dejar la factory real activa) y ordenar imports. Baja (1 archivo) · sonnet.
- [x] M-30 — `SystemNotice`: `statusFrom` valida `data.status` contra `open|resolved|ignored` (si no, usa el solicitado) y el test de confirmación nombra claro que gana el estado de la respuesta. Baja (2 archivos) · sonnet.
