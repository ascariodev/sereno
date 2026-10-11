# Plan: adjuntos-url

**Objetivo:** que una URL firmada de un adjunto deje de servir poco después de que la persona pierde el acceso: la web
pide una URL nueva al API (que valida el acceso) cuando la guardada vence, y el TTL baja de 60 a pocos minutos.
**Estado:** terminado

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (los commits van con `git` en la raíz del monorepo). Origen: acceso-proyectos M-2.
- Hoy: `MessageAttachment::downloadUrl()` firma `attachments.download` con TTL `config('chat.attachments.url_ttl_minutes')`
  (60; 5 tras la fase 4) redondeado hacia arriba a `URL_EXPIRY_STEP_SECONDS` (600; 60 tras la fase 4) para que el navegador reuse la caché. La URL sale en
  `MessageAttachmentResource` (listados, hilos, menciones y payloads de `MessageCreated`, `MessageUpdated` y
  `MentionCreated`). La ruta `GET attachments/{attachment}` (`api/routes/api.php` ~L84) es pública con
  `signed:relative`; `AttachmentController::download` solo valida la firma y responde con
  `Cache-Control: private, max-age` hasta el vencimiento.
- Acceso: no hay policy de adjuntos. Se reutiliza `ChannelPolicy::view` (organización activa, rol y
  `ProjectAccess::canViewId`, con `denyAsNotFound`), como ya hace `MessagePolicy`.
- Web: `web/src/components/MessageAttachments.vue` es el único que pinta adjuntos. La miniatura es un `<img :src="a.url" loading="lazy">`
  dentro de `<a :href="a.url" target="_blank">`, más un enlace de descarga. El Set `failed` está indexado por url y no
  reintenta. Las URLs viven en `stores/messages.ts` y `stores/thread.ts` mientras el canal está abierto.
- Tests clave: `api/tests/Feature/AttachmentDownloadApiTest.php` (validez, redondeo y paso de la URL ~L130-173;
  Cache-Control; firma; throttle) y `web/src/components/MessageAttachments.spec.ts`.
- La PWA (`web/pwa/sw.js`) ignora otros orígenes: no cachea adjuntos.

## Fases

### [x] Fase 1 — Endpoint que firma una URL nueva
- **Alcance:**
  - `GET /api/attachments/{attachment}/url` dentro del grupo `auth:sanctum` + `organization`, con throttle propio
    (`attachment-urls`, junto a los de `AppServiceProvider`).
  - Busca el adjunto con el scope de organización. Exige `message_id` no nulo, mensaje sin `deleted_at` y
    `Gate::authorize('view', $attachment->channel)`. Si falla, responde 404.
  - Responde `{ data: { url, expires_at } }` con `downloadUrl()`.
  - No cambia la ruta pública de descarga.
- **Archivos:** `api/routes/api.php`, `api/app/Http/Controllers/Api/AttachmentController.php`,
  `api/app/Providers/AppServiceProvider.php` (y, si hace falta, `lang/en.json` y `lang/es.json`).
- **Terminado cuando:** un test nuevo (`AttachmentUrlApiTest`) cubre:
  - 200 para un miembro con acceso;
  - 404 para un member sin el proyecto, un adjunto de otra organización, un adjunto huérfano y un mensaje borrado;
  - 403 con `X-Organization-Id` ajeno;
  - 401 sin token;
  - el throttle.

  Pasan `AttachmentDownloadApiTest` y pint.

### [x] Fase 2 — Miniaturas que renuevan la URL vencida
- **Alcance:**
  - `getAttachmentUrl(id)` en el cliente web.
  - En `MessageAttachments.vue`, el `@error` de la miniatura pide una URL nueva y reintenta una sola vez. El estado de
    fallo pasa a indexarse por id de adjunto.
  - Si el reintento falla o el API da 404, muestra el estado de error actual.
  - La URL renovada se guarda solo en el componente: no muta el store.
- **Archivos:** `web/src/api/messages.ts` (o el módulo de API de adjuntos que exista), `web/src/components/MessageAttachments.vue`,
  `web/src/api/types.ts` (comentario de `url`).
- **Terminado cuando:** specs de `MessageAttachments` cubren:
  - el error, que pide una URL nueva y pinta con ella;
  - un segundo error, que deja el estado de fallo;
  - el 404 del API, que deja el estado de fallo;
  - que no hay bucle de reintentos.

  `vue-tsc -b` limpio.

### [x] Fase 3 — Enlaces que piden una URL nueva al hacer clic
- **Alcance:**
  - El clic en la miniatura y en el enlace de descarga pide antes una URL fresca y abre esa.
  - La ventana se abre en el mismo gesto, antes del `await`, para no chocar con el bloqueador de popups.
  - Con 404 muestra un toast traducido.
  - El `href` estático queda como respaldo para "abrir en pestaña nueva" o "copiar enlace".
- **Archivos:** `web/src/components/MessageAttachments.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`.
- **Terminado cuando:** specs cubren:
  - el clic, que pide la URL y abre la nueva;
  - el 404, con toast y sin abrir nada útil;
  - el clic con modificadores (ctrl o botón medio), que deja el comportamiento nativo.

  `vue-tsc -b` limpio.

### [x] Fase 4 — TTL corto [riesgo]
- **Alcance:**
  - Bajar el default de `CHAT_ATTACHMENT_URL_TTL` a 5 min y `URL_EXPIRY_STEP_SECONDS` a 60 s, para que el redondeo
    no domine la validez.
  - Ajustar los tests de validez y paso.
  - Actualizar `.claude/rules/database.md` (config de adjuntos) y el texto de `.env.example`. Esto último lo hace el
    usuario: está bloqueado para Claude.
  - Riesgo: los payloads de Reverb llevan la URL firmada al despachar y pueden llegar casi vencidos. Con las fases 2 y
    3 la web lo absorbe, pero hay que verificarlo en el navegador.
- **Archivos:** `api/config/chat.php`, `api/app/Models/MessageAttachment.php`, `.claude/rules/database.md`.
- **Terminado cuando:**
  - `AttachmentDownloadApiTest` y `MessageAttachmentTest` pasan con los valores nuevos.
  - Verificación manual en el navegador: con TTL de 1 min forzado en local, una imagen vencida se vuelve a pintar y un
    clic abre el archivo.

## Decisiones
- 2026-10-11: diseño elegido por el usuario (acceso-proyectos M-2): endpoint `GET /api/attachments/{id}/url` que
  valida el acceso y firma una URL nueva, reintento de la imagen en la web, y luego TTL corto con un paso de
  redondeo menor.
- 2026-10-11 (aprobado por el usuario): TTL de 5 min y paso de 60 s. El endpoint responde 404 (no 403) cuando
  no hay acceso, como `ChannelPolicy`. La ruta pública de descarga sigue validando solo la firma: el corte de acceso
  depende del TTL corto.
- 2026-10-11: el plan se ejecuta en el worktree `.claude/worktrees/adjuntos-url` (rama `feat/adjuntos-url`). Los
  tests corren con `docker run` sobre `workspace-php` (o `node:24`) montando el worktree, los volúmenes
  `workspace_workspace_vendor` o `workspace_web-node-modules` y `api/.env` del checkout principal, red `workspace_default`.
- 2026-10-11 (Fase 1) `GET /api/attachments/{attachment}/url` responde `{data:{url, expires_at}}`; `expires_at` es ISO8601
  UTC tomado del parámetro `expires` de la URL firmada. Throttle `attachment-urls` de 120/min por usuario. `Message` no
  usa SoftDeletes: el mensaje borrado se detecta con `deleted_at` y responde 404 con `abort`, antes del `Gate`.
- 2026-10-11 (Fase 2) `getAttachmentUrl(id)` en `web/src/api/messages.ts`. `MessageAttachments.vue` guarda tres mapas
  por id (`retried`, `renewed`, `failed`) con la URL del store a la que se refieren: una URL nueva del store para el mismo
  id (p. ej. `MessageUpdated`) rearma el reintento y descarta la renovada (L-39). Una renovación que llega tras cambiar la
  URL del store se ignora (`from !== a.url`). Una sola renovación por URL del store.
- 2026-10-11 (Fase 3) Clic en la miniatura: `window.open('', '_blank')` en el gesto, `opener = null`, y luego
  `location.href` con la URL nueva; si `window.open` devolvió null, respaldo `window.open(url, '_blank', 'noopener')`.
  El enlace de descarga hace `location.assign(url)` en la misma pestaña, como antes. Cualquier error cierra la ventana y
  muestra el toast `attachments.openFailed`. Clic con ctrl, meta, shift, alt o botón distinto de 0 queda nativo (el medio
  dispara `auxclick`). El `href` de respaldo de ambos enlaces usa `previewUrl(a)` (renovada si existe).
- 2026-10-11 (Fase 4) Default TTL 5 y paso 60 s. Con paso de 60 s todo TTL en minutos es múltiplo del paso: el caso
  "ttl no múltiplo" pasa a "ttl distinto del default" (7). `Cache-Control: max-age` ya sale de `expires`: sin cambios.
  `MessageAttachmentTest` solo exige TTL > 0, para no atarlo al `.env`.
- 2026-10-11 (Fase 4) Verificado en el navegador con un API (8013, `CHAT_ATTACHMENT_URL_TTL=1`) y una Vite (5175)
  temporales del worktree: una miniatura vencida (fuera de la carga diferida) falló, pidió `/url` y se repintó con la URL
  nueva; un clic tras vencer abrió el archivo con una URL fresca (200). El panel del navegador devuelve null en
  `window.open`, así que se probó el respaldo `window.open(url, '_blank', 'noopener')`, no la ventana abierta en el gesto.
  Quedaron en la base de desarrollo, canal 1, un mensaje con `test.png` y 45 mensajes "relleno N".
- 2026-10-11 (M-2, decisión del usuario) `AttachmentController::url` lanza `ModelNotFoundException` en todos sus 404
  (huérfano, mensaje borrado, `Gate::denies` del canal): responden igual que un id inexistente ("Resource not found.",
  render de `bootstrap/app.php`) y no filtran si el adjunto existe. `download` sigue con `abort(404, __('Not Found'))`.

## Notas para la próxima sesión
- Plan terminado: 4 fases. Suite API 1036 ok sobre el worktree. Falta el merge de `feat/adjuntos-url` a `main` (pedirlo).
- El usuario cambia `api/.env.example:77` de `CHAT_ATTACHMENT_URL_TTL=60` a `5` (comentario sugerido: minutos; el
  vencimiento se redondea hacia arriba al minuto y la web pide una URL nueva al vencer). Si producción define 60, bajarlo.

## Mejoras propuestas
</content>
</invoke>
- [x] M-1 (baja, sonnet): exponer el vencimiento desde `MessageAttachment` (p. ej. `downloadUrl()` que devuelva url y
  vencimiento) en vez de parsear `expires` del query de la URL en `AttachmentController::url`.
- [x] M-2 (baja, sonnet): en `AttachmentUrlApiTest`, afirmar que los 404 (otra organización, huérfano, sin proyecto,
  borrado) tienen el mismo cuerpo. El `false` (403) de `ChannelPolicy::view` no se alcanza aquí: el adjunto se busca con
  el scope de organización y el middleware exige rol.
- [ ] M-3 (baja, sonnet): en `MessageAttachments.vue`, el aviso "ya no disponible" usa `failed.size > 0` y no descarta
  entradas cuya URL del store ya cambió: tras un fallo y una URL nueva que carga bien sigue visible. Filtrar `failed`
  contra las URLs actuales (ya pasaba con el `Set`).
- [ ] M-4 (baja, sonnet): extraer el tipo `{ url; expires_at }` de `getAttachmentUrl` a una interfaz en `web/src/api/types.ts`.
- [ ] M-5 (baja, sonnet): en `MessageAttachments.vue`, si `window.open` devolvió null y el respaldo tras el `await`
  también (Safari lo bloquea), mostrar un toast en vez de no hacer nada.
- [ ] M-6 (baja, sonnet): distinguir el 404 de un error de red o 500 en el toast de apertura (hoy siempre "puede que ya
  no esté disponible"); requiere una clave i18n nueva.
- [ ] M-7 (baja, sonnet): en `AttachmentUrlApiTest`, afirmar el 404 también en `es` (`Accept-Language`, "Recurso no
  encontrado.").
