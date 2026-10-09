# Plan: chat

**Objetivo:** paso 6 del MVP sobre los canales de proyecto: responder en hilos (también a los avisos de log),
mencionar a miembros con bandeja de menciones sin leer, y adjuntar archivos a los mensajes.
**Estado:** terminado

## Contexto mínimo
- Apps: `api/` y `web/` (commits con `git` en la raíz). Tres bloques en orden: hilos (1 a 8), menciones (9 a 17),
  adjuntos (18 a 26). Cada bloque deja algo usable.
- API: `messages` (migración `2026_10_07_120000`, CHECK `messages_body_payload_check`, índice `(channel_id, id DESC)`,
  sin `updated_at`), `Message` (evento `MessageCreated` en `organizations.{org}.channels.{channel}`, `broadcastAs`
  `message.created`, payload `{message}` ya resuelto con `MessageResource`), `MessageController` (index con
  `cursorPaginate`, store con `throttle:channel-messages`), `StoreMessageRequest` (`MAX_BODY_LENGTH` 4000, rechaza
  canal archivado en `after()`), `ListMessagesRequest` (`cursor`, `per_page`). Sin MessagePolicy: todo pasa por
  `Gate::allows('view', $channel)`. Miembros: `GET /api/members` (sin búsqueda ni paginación).
- Web: `ChannelView.vue` (panel derecho por query `?group=<id>`, en móvil `AppDialog variant="sheet-bottom"`),
  `MessageList.vue`, `MessageItem.vue` (body en texto plano), `SystemNotice.vue`, `MessageComposer.vue`,
  `stores/messages.ts` (`open`, `loadOlder`, `catchUp`, `insert` con `mergeById`, que ante el mismo id conserva el
  objeto actual), `api/client.ts` (siempre JSON), `realtime/echo.ts` (`subscribe` genérico, `subscribeToUser` en
  `users.{id}`), `components/ui/AppCommand.vue` (Listbox de Reka). Sin dependencias de markdown ni sanitizador.
- Diseño: `docs/diseno/calma/Main.dc.html` (líneas 187 enlace "2 respuestas" con avatares en la tarjeta de aviso,
  246 chip de mención, 256 a 259 botones Adjuntar y Mencionar del composer); entrada "Menciones" con contador en la
  barra lateral (Main:43) y fila "Camila te mencionó" (Projects:103).
- Helpers globales de Pest ya ocupados (L-29): `asChannelReader`, `postingAs`, `insertSystemMessage`,
  `authorizeChannel`, `channelName`, `authorizePresence`, `noticeMessages`, `ingestNotice`, `listMembers`,
  `changeRole`, `memberWithRole`, `roleIn`, `removeMemberRequest`, `asUser`, `asGroupReader`, `invite`, `replyTo`,
  `systemRootIn`, `mentionIn`, `mentionPost`, `mentionedIds`,
  `attachmentIn`, `downloadableAttachment`, `fetchAttachment`.
- Subidas: `api/docker/php/uploads.ini` y `api/docker/nginx/default.conf` limitan a 6 MB.

## Fases

### Hilos

### [x] Fase 1 — Esquema de hilos en `messages` (api)
- **Alcance:** migración que agrega `parent_id` nullable, `replies_count` int default 0 y `last_reply_at` nullable.
  FK compuesta `(channel_id, parent_id)` a `messages(channel_id, id)` con `cascadeOnDelete` (requiere
  `unique(channel_id, id)`), para que una respuesta no pueda colgar de otro canal. Índice `(parent_id, id DESC)` e
  índice parcial `(channel_id, id DESC) WHERE parent_id IS NULL` para la lista principal. `Message`: relaciones
  `parent` y `replies`, columnas nuevas fuera de Fillable, cast de `last_reply_at`. Actualizar `database.md`.
- **Archivos:** migración nueva, `api/app/Models/Message.php`, `.claude/rules/database.md`.
- **Terminado cuando:** test en `MessageTest`: una respuesta con `parent_id` de otro canal la rechaza la BD; borrar
  el canal borra raíz y respuestas; `migrate:fresh` corre.

### [x] Fase 2 — Responder en un hilo (api)
- **Alcance:** `StoreMessageRequest` acepta `parent_id` (mensaje raíz del mismo canal, de cualquier `kind`; una
  respuesta no admite respuestas). `MessageController@store` crea la respuesta y en la misma transacción incrementa
  `replies_count` y fija `last_reply_at` de la raíz con un `UPDATE` atómico. `index` excluye respuestas.
  `MessageResource` agrega `parent_id`, `replies_count`, `last_reply_at`. Textos de error en `lang`.
- **Archivos:** `StoreMessageRequest.php`, `MessageController.php`, `MessageResource.php`, `api/lang/en.json`,
  `api/lang/es.json`.
- **Terminado cuando:** `MessagePostApiTest`: responde a un mensaje y a un aviso de sistema; rechaza raíz de otro
  canal, de otra organización y respuesta a respuesta (por clave de traducción); el contador sube; la lista principal
  no trae respuestas; `message.created` de la respuesta lleva `parent_id`.

### [x] Fase 3 — Listar las respuestas de un hilo (api)
- Ruta `GET channels/{channel}/messages/{message}/replies` con cursor (mismas reglas que `ListMessagesRequest`),
  404 si el mensaje no es raíz del canal. Test de aislamiento entre organizaciones.

### [x] Fase 4 — Hilos en el store y tipos del canal (web)
- Tipos (`parent_id`, `replies_count`, `last_reply_at`) y `api` de respuestas; en `stores/messages.ts` una respuesta en
  vivo no entra a la lista: actualiza contador y `last_reply_at` de su raíz si está cargada; `catchUp` refresca los
  contadores (el merge debe preferir la versión entrante). L-27.

### [x] Fase 5 — Store del hilo abierto (web) [riesgo]
- `stores/thread.ts`: abrir raíz con sus respuestas, cargar más antiguas, recibir en vivo, enviar respuesta y
  `catchUp` al reconectar, con contadores de generación (L-10, L-14, L-35). Spec propio.

### [x] Fase 6 — Panel del hilo (web)
- `ThreadAside.vue`: raíz arriba, respuestas con `MessageList`, composer de respuesta, cerrar. Todas las claves i18n
  del hilo (también las de la fase 8). Spec del componente.

### [x] Fase 7 — Abrir el hilo desde el canal (web)
- `ChannelView`: `?thread=<id>` abre `ThreadAside` (excluyente con `?group`), en móvil como hoja; suscripción en vivo
  compartida entre canal e hilo.

### [x] Fase 8 — Resumen y acción de responder en los mensajes (web) [límite: 5 archivos]
- `ThreadSummary.vue` ("N respuestas", hace cuánto) en `MessageItem` y en la tarjeta de `SystemNotice`; acción
  "Responder en hilo"; `MessageList` y `ChannelView` propagan `openThread`.

### Menciones

### [x] Fase 9 — Esquema de menciones (api)
- Tabla `message_mentions` (organization_id, message_id, user_id, read_at, created_at; único `(message_id, user_id)`;
  índice `(user_id, organization_id, read_at)`), modelo `MessageMention`, `database.md`.

### [x] Fase 10 — Guardar menciones al crear un mensaje (api)
- El body lleva menciones como `<@id>`; al crear se guardan las de miembros de la organización (sin el autor ni
  repetidos). `MessageResource` agrega `mentions: [{id, name}]` con eager load en lista y respuestas.

### [x] Fase 11 — Aviso en vivo de una mención (api)
- Evento `MentionCreated` en `users.{id}` tras el commit, con organización, canal, mensaje y raíz si es respuesta.

### [x] Fase 12 — Bandeja de menciones (api)
- `GET mentions` (propias, de la organización activa, cursor, con mensaje, canal y autor, más `unread_count`) y
  `POST mentions/read` (ids o todas). Aislamiento por usuario y organización.

### [x] Fase 13 — Mostrar menciones en el cuerpo (web)
- `MessageBody.vue`: convierte `<@id>` en chip con el nombre de `mentions` (desconocido: texto genérico traducido),
  sin `v-html`; resalta la propia. Usado por `MessageItem`.

### [x] Fase 14 — Lógica de autocompletar menciones (web) [riesgo]
- Composable `useMentionInput`: detecta `@` en el caret, filtra miembros, inserta `@Nombre` y al enviar serializa a
  `<@id>`; el límite de 4000 se cuenta sobre lo serializado (L-11). Solo lógica y spec.

### [x] Fase 15 — Autocompletar en el composer (web) [límite: 5 archivos]
- Lista de sugerencias (Reka) bajo el composer, botón "Mencionar", caché de miembros por organización, i18n.

### [x] Fase 16 — Store de menciones en vivo (web)
- `api/mentions.ts`, `stores/mentions.ts` (lista, no leídas, marcar leídas) y `MentionCreated` por `subscribeToUser`,
  ignorando otras organizaciones.

### [x] Fase 17 — Vista de menciones y contador en la barra (web) [límite: 5 archivos]
- Ruta `/mentions`, `MentionsView`, entrada "Menciones" con contador; abrir una mención va al canal (con `?thread` si
  es respuesta) y la marca leída.

### Adjuntos

### [x] Fase 18 — Esquema y configuración de adjuntos (api)
- `config/chat.php` (disco, tamaño máximo, adjuntos por mensaje, vigencia de la URL). Tabla `message_attachments`
  (organization_id, channel_id, message_id nullable, uploaded_by, disk, path, original_name, mime, size,
  created_at), modelo, `database.md`.

### [x] Fase 19 — Subir un archivo (api) [riesgo]
- `POST channels/{channel}/attachments` multipart: valida tamaño, rechaza canal archivado, guarda en disco privado
  con nombre aleatorio y devuelve el adjunto sin mensaje. Throttle propio.

### [x] Fase 20 — Adjuntar archivos al mensaje (api) [riesgo] [límite: 5 archivos]
- `attachment_ids` en `StoreMessageRequest` (propios, del canal, libres); body opcional si hay adjuntos (migración que
  relaja el CHECK); vínculo con `UPDATE ... WHERE message_id IS NULL` que falla si otro mensaje lo tomó;
  `MessageResource` con `attachments`.

### [x] Fase 21 — Descargar un adjunto con URL firmada (api) [riesgo]
- Ruta firmada temporal (sin Bearer, para `<img>`); `inline` solo para png, jpeg, gif y webp, el resto como
  descarga; `nosniff` y CSP `sandbox`. La URL va en el resource.

### [x] Fase 22 — Limpieza de adjuntos huérfanos (api)
- Comando diario en el scheduler: borra archivo y fila de adjuntos sin mensaje con más de 24 h.

### [x] Fase 23 — Cliente de subida (web)
- `api/client.ts` acepta `FormData` (sin `Content-Type` JSON), `api/attachments.ts`, tipos de adjunto.

### [x] Fase 24 — Estado de las subidas en curso (web)
- Composable `useAttachmentUploads` (subir, cancelar con `AbortController`, quitar, errores, ids listos) e i18n de
  adjuntos.

### [x] Fase 25 — Adjuntar desde el composer (web)
- Botón "Adjuntar", lista de pendientes en el composer, `send` del canal y del hilo con `attachment_ids`.

### [x] Fase 26 — Mostrar los adjuntos de un mensaje (web)
- `MessageAttachments.vue`: miniatura de imagen o fila de archivo (nombre, tamaño, descargar), con fallback si la URL
  venció. Al terminar, marcar el paso 6 como hecho en `CLAUDE.md`.

## Decisiones
- 2026-10-09 — Un solo nivel de hilo; se puede responder a cualquier mensaje raíz, también a los avisos de sistema
  (diseño Main:187). Las respuestas no aparecen en la lista principal. Motivo: patrón de Slack y del diseño.
- 2026-10-09 — Menciones como token `<@id>` en el body y tabla `message_mentions` con `read_at` (sirve de bandeja de
  no leídas). Motivo: el nombre puede cambiar y el token no es ambiguo con nombres repetidos o con espacios.
- 2026-10-09 — Adjuntos en dos pasos (subir y luego enviar el mensaje con ids) sobre el disco local privado de
  Laravel, sin S3 ni dependencias nuevas; descarga por URL firmada temporal. Tamaño máximo inicial 5 MB por
  archivo (cabe en los 6 MB de `uploads.ini` y nginx), configurable en `config/chat.php`.
- 2026-10-09 — `parent_id` se valida en `StoreMessageRequest::after()` con `Message::find` (scope de organización):
  raíz inexistente, de otro canal o de otra organización dan el mismo error en `parent_id`; respuesta a respuesta da
  otro. `MessageResource` siempre devuelve `parent_id`, `replies_count` y `last_reply_at`. Motivo: no filtrar
  existencia entre organizaciones (L-04).
- 2026-10-09 — Contrato de respuestas: `GET /api/channels/{channel}/messages/{message}/replies` (`{message}` con
  `whereNumber`), query y forma iguales a la lista principal (`ListMessagesRequest`: `cursor`, `per_page` 1 a 100,
  50 por defecto; `data`, `links`, `meta.next_cursor`), orden `id DESC` (el store del hilo invierte para mostrar).
  404 si el mensaje no existe, es respuesta, o es de otro canal u organización (mismo 404). Motivo: lo usa la web.
- 2026-10-09 — `mergeById` prefiere la versión entrante ante el mismo id (antes conservaba la actual). Una
  respuesta en vivo no entra a la lista del canal: `insert` suma 1 a `replies_count` de la raíz cargada o en cola y
  adelanta `last_reply_at`, una sola vez por id (`countedReplies`, se vacía en `clear`); con la raíz sin cargar se
  ignora. Motivo: contadores frescos en todos los caminos (L-27).
- 2026-10-09 — `stores/thread.ts` guarda solo `channelId` y `rootId`, no la raíz: el panel la toma de
  `useMessagesStore().messages` por id (contadores frescos). `send` también llama a `useMessagesStore().insert` para
  subir el contador del canal al instante. Tras un `open` fallido, `catchUp` no reintenta: la vista ofrece reintentar
  llamando de nuevo a `open`. Motivo: una sola fuente para la raíz y su contador.
- 2026-10-09 — `MessageComposer` se reutiliza en el hilo con props opcionales `send` y `placeholder`, y
  `MessageList` con `emptyLabel`; sin ellas el canal se comporta igual. Motivo: no duplicar el composer.
- 2026-10-09 — Con `?thread` y `?group` a la vez gana el hilo (un watcher quita `group` con `replace`); abrir un
  panel siempre quita el parámetro del otro, con `push` como `selectGroup`. Sin raíz cargada (URL con raíz fuera de
  la página del canal) el panel muestra solo las respuestas; el API no cambia (M-15). Motivo: no ampliar la fase.
- 2026-10-09 — `MessageItem`, `SystemNotice` y `MessageList` tienen la prop opcional `threadable` (apagada por
  defecto); solo `ChannelView` la activa, así que en el panel del hilo no hay resumen ni acción. Las líneas de cambio
  de estado del sistema tampoco lo llevan, solo la tarjeta de aviso abierto. Motivo: un solo nivel de hilo.
- 2026-10-09 — Token de mención `<@id>` con regex `<@([1-9][0-9]{0,17})>`. El body guarda todos los tokens tal
  cual; `mentions: [{id, name}]` (orden por id, sin repetidos, `[]` si no hay) solo trae miembros de la organización
  del canal distintos del autor, así que la web muestra texto genérico para un token sin entrada. Va en `store`,
  `index`, `replies` y `message.created`. Motivo: no filtrar existencia de usuarios ajenos.
- 2026-10-09 — Contrato de `MentionCreated`: canal privado `users.{id}`, `broadcastAs` `mention.created`, payload
  `{organization_id, channel_id, parent_id (raíz o null), message (MessageResource resuelto, igual que en
  message.created)}`, tras el commit. La web ignora el evento si `organization_id` no es la organización activa.
- 2026-10-09 — Contrato de la bandeja (con `X-Organization-Id` y `throttle:mentions`, 60/min por usuario):
  `GET /api/mentions?cursor=&per_page=` (orden por id de mención desc) devuelve `data` de
  `{id (de la mención), read_at, created_at, message (MessageResource), channel {id, name, project_id}, parent_id}`,
  `links` y `meta {next_cursor, unread_count}` (`unread_count` de toda la organización activa). `POST
  /api/mentions/read` con `{ids: int[] (máx. 100)}` o `{all: true}` responde `{unread_count}`; ids ajenos se ignoran
  sin error, idempotente. Motivo: lo usan las fases 16 y 17.
- 2026-10-09 — `MessageBody` (props `body`, `mentions?`, `ownUserId?`) usa la misma regex que el API; un token sin
  entrada muestra `@` + `channel.unknownMention`; la mención propia se resalta aunque no esté en `mentions` (el API
  excluye al autor). `MessageItem` recibe `ownUserId` por prop (sin store de auth). Colores solo con tokens del tema.
- 2026-10-09 — Autocompletar: la mención guarda su id en un rango del texto (índices UTF-16) y deja de serlo si
  se edita su interior; escribir pegado antes o después la conserva. `@` abre la lista solo al inicio o tras un
  espacio; escribir `@Ana` a mano no menciona. El filtro ignora mayúsculas y acentos. Motivo: nombres repetidos.
- 2026-10-09 — La lista de sugerencias del composer es `ul`/`li` con ARIA de combobox a mano (no el Listbox de
  Reka, que mueve el foco); Escape con la lista abierta hace `stopPropagation` (Reka escucha en `window` en burbuja).
  Miembros en `useMemberDirectoryStore`, caché por organización que se vacía al cambiar `organization.activeId`.
- 2026-10-09 — El evento `mention.created` no trae el id de la mención: el store sube `unreadCount`, deduplica por
  `message.id` y lanza `refresh()` para traer la fila real (sin filas provisionales). `markRead`/`markAllRead` son
  optimistas, restauran si fallan y luego hacen `refresh()`. `subscribeToUser` exige `organization_id` numérico.
- 2026-10-09 — `useMentionsStore().start/stop` vive en `AppLayout` (watch inmediato de `auth.user?.id` y
  `onBeforeUnmount`), no en la barra (se monta dos veces) ni en la vista. El límite `[límite: 5 archivos]` cuenta solo
  código, sin specs y con `en.json`/`es.json` como uno. Motivo: el contador vive siempre.
- 2026-10-09 — `message_attachments` lleva `channel_id` y FK compuesta `message_attachments_message_fk`
  `(channel_id, message_id)` a `messages(channel_id, id)` con cascade (un adjunto no cuelga de un mensaje de otro
  canal); `uploaded_by` nullable con `nullOnDelete`. Config en `config/chat.php`, `chat.attachments.*`: `disk`
  (`local`), `max_size_kb` (5120), `max_per_message` (10), `url_ttl_minutes` (60), `orphan_hours` (24). Las cascadas
  borran filas, no archivos (ver M-4 y M-28).
- 2026-10-09 — Contrato de subida: `POST /api/channels/{channel}/attachments`, multipart con `file`, Bearer y
  `X-Organization-Id`, throttle `chat-attachments` (20/min por usuario). 201 con `{data: {id, original_name, mime,
  size, created_at}}` (sin `path`, `disk` ni mensaje). 422 en `file` (falta, no es archivo, vacío, mayor que
  `max_size_kb`) o en `channel` (archivado); 401, 403, 404 y 429 con `Retry-After`. Ruta en disco
  `chat/{organization_id}/{channel_id}/{Str::random(40)}` sin extensión; MIME detectado con `finfo`; cualquier tipo se
  acepta y la seguridad al servir es de la fase 21. Si falla la fila se borra el archivo.
- 2026-10-09 — Mensaje de persona con solo adjuntos: el CHECK deja pasar cualquier `user` y la regla "body o
  adjuntos" vive en dos constraint triggers diferidos (`messages_body_or_attachments`,
  `message_attachments_keep_message_content`) con la función `messages_require_body_or_attachments()`. Motivo: un
  CHECK no mira otra tabla. En tests se usa `SET CONSTRAINTS ... IMMEDIATE`. La fase 20 tocó 6 archivos de código (una
  línea en `MentionController` para no tener N+1), aceptado.
- 2026-10-09 — Contrato de envío con adjuntos: `POST /api/channels/{channel}/messages` con `{body?, parent_id?,
  attachment_ids?: int[]}`; `body` obligatorio solo sin adjuntos (vacío o de espacios queda `null`). Ids ajenos, de
  otro canal u organización, inexistentes, usados o perdidos en una carrera dan el mismo 422 en `attachment_ids`
  ("The attachments do not exist or are already in use."). `MessageResource.attachments` es siempre una lista
  `{id, original_name, mime, size, created_at}` por id (`[]` si no se carga la relación), en `store`, `index`,
  `replies`, `mentions`, `message.created` y `mention.created`.
- 2026-10-09 — Descarga: el adjunto es `{id, original_name, mime, size, created_at, url}` en todos los caminos
  (también en la respuesta de la subida, pero esa URL da 404 hasta que el adjunto va en un mensaje). `GET
  /api/attachments/{id}?expires=&signature=` (`attachments.download`, `signed:relative`, throttle 300/min por IP), sin
  Bearer ni organización; vence a los `url_ttl_minutes` y cambia en cada respuesta. 403 traducido con firma
  inválida o vencida; 404 si es huérfano, se borró o falta en disco. `inline` solo png, jpeg, gif y webp; lo que el
  navegador podría ejecutar va como `application/octet-stream`. El host sale de `APP_URL` (en producción, la URL
  pública del API). Motivo: `<img>` sin cabeceras y firma válida detrás del proxy.
- 2026-10-09 — `chat:prune-attachments` (diario 00:30 UTC, `withoutOverlapping`, como `log:maintain`) borra filas
  huérfanas con más de `orphan_hours` (el `DELETE` repite `message_id IS NULL`; el archivo solo si se borró la fila)
  y archivos bajo `chat/` del disco configurado sin fila y más viejos que el corte. Un adjunto en otro disco solo se
  limpia por su fila.
- 2026-10-09 — Límites de adjuntos en la web como constantes de `config.ts` (`ATTACHMENT_MAX_SIZE_BYTES` 5120 KB,
  `ATTACHMENT_MAX_PER_MESSAGE` 10), espejo de `config/chat.php` porque el API no los expone: si cambian allí, cambiar
  aquí. Un archivo rechazado en el cliente entra como item en error no reintentable y no ocupa cupo.
- 2026-10-09 — La prop `send` de `MessageComposer` pasa a `(body, attachmentIds)` y suma `channelId?` (por defecto
  el del store del canal). Tras un envío con éxito se quitan solo los adjuntos enviados (no `reset()` completo), para
  no perder uno añadido durante el envío. Con body vacío se envía `body: ''` (el API lo vuelve null).
- 2026-10-09 — `MessageAttachments` previsualiza solo png, jpeg, gif y webp (caja de 240 px, `aspect-ratio: 3/2`); un
  fallo de carga se recuerda por `url`, así que una URL firmada nueva se reintenta. "Descargar" sin `download` (la URL
  es de otro origen) y con `aria-label` por archivo. `MentionsView` no muestra adjuntos: la fila es un enlace entero
  (L-21) y no admite enlaces dentro (M-36).

## Notas para la próxima sesión
- Plan terminado (26 fases). Suites completas: API 672 tests, web 853. Paso 6 marcado como hecho en `CLAUDE.md`.
  Pendiente general: revisar en el navegador los layouts marcados en las notas (panel del hilo, chip de mención, lista
  de sugerencias, menciones en la barra, adjuntos en el composer y en los mensajes).
- Fase 25 hecha: botón Adjuntar, lista de pendientes, arrastrar y soltar y pegar archivos en el composer;
  `messages.send(body, attachmentIds = [])` y `thread.send(body, attachmentIds = [])`. Sin mirar en el navegador:
  la lista en `composer-box`, en el hilo y en la hoja móvil, y el estado del drop. Fase 26: mostrar
  `message.attachments` (con `url` firmada, `formatFileSize`, `attachments.download`, `attachments.previewUnavailable`)
  y al terminar marcar el paso 6 en `CLAUDE.md`.
- Fase 24 hecha: `useAttachmentUploads(channelId: () => number, {maxFiles?, maxBytes?})` con `items`
  (`key`, `name`, `size`, `status` 'uploading'|'ready'|'error', `attachment`, `error`, `retryable`), `attachments`,
  `attachmentIds`, `busy`, `full`, `add(files)`, `retry(key)`, `remove(key)`/`cancel(key)`, `reset()`; se reinicia
  al cambiar de canal o desmontar. `formatFileSize(bytes)`. Claves `attachments.*`: `attach`, `remove`, `removeFile`,
  `cancel`, `cancelFile`, `retry`, `uploading`, `ready`, `list`, `tooLarge`, `tooMany`, `failed`, `rateLimited`,
  `download`, `previewUnavailable`. Fase 25: `reset()` solo si el envío tiene éxito, bloquear el envío con `busy` y
  pasar `attachmentIds` a `messages.send` y `thread.send`.
- Fase 23 hecha: `client.post/patch/put` aceptan `FormData` (sin `Content-Type`); `uploadAttachment(channelId, file,
  {signal?})` devuelve `MessageAttachment` y lanza `ApiError` (422 con `errors.file` o `errors.channel`) o el
  `AbortError` tal cual; `Message.attachments` obligatorio; `sendReply(channelId, parentId, body, attachmentIds = [])`.
  El cliente usa `fetch`: la fase 24 muestra estado "subiendo" sin porcentaje. Fase 25: el envío del canal está en
  `stores/messages.ts` (`send`, `api.post(..., { body })`) y el del hilo en `stores/thread.ts` (`send`): ambos deben
  aceptar los ids. La `url` de la subida da 404 hasta enviar: no sirve de miniatura en el composer. Validar tamaño en
  el cliente antes de subir (fase 24) con el máximo del API (5 MB por defecto).
- Bloque API de adjuntos terminado (fases 18 a 22). Fase 22: `PruneOrphanAttachments`, tests en
  `PruneOrphanAttachmentsTest`. Sigue la web (fase 23): leer los contratos de subida, envío y descarga en
  "Decisiones" (L-09).
- Fase 21 hecha: `AttachmentController@download`, `MessageAttachment::downloadUrl()`, render de
  `InvalidSignatureException` en `bootstrap/app.php` (única ruta firmada del proyecto). Tests en
  `AttachmentDownloadApiTest`. 7 archivos de código, aceptado (una línea en varios).
- Fase 20 hecha: `MessageController::RELATIONS` agrupa las relaciones de las listas; el vínculo es un `UPDATE ...
  WHERE message_id IS NULL` que cuenta filas y revierte todo con 422 si faltan. Fase 21: añadir la URL firmada al
  `MessageAttachmentResource` (que ya sale en todos esos caminos). El `down()` de la migración falla si ya hay
  mensajes de persona sin body.
- Fase 19 hecha: `AttachmentController@store`, `StoreAttachmentRequest`, `MessageAttachmentResource`; tests en
  `AttachmentUploadApiTest`. Fase 21: usar una ruta firmada propia (no `temporaryUrl` del disco `local`, que tiene
  `serve => true`) y servir como descarga todo lo que no sea png, jpeg, gif o webp. Fase 22: además de las filas
  huérfanas, considerar archivos sin fila bajo `chat/` (proceso muerto entre escribir y guardar).
- Fase 18 hecha: modelo `MessageAttachment` (`$guarded = ['*']`, solo `created_at`, `size` int), relación
  `Message::attachments()`, índices `(message_id)` y parcial `message_attachments_orphans_index` (`created_at` WHERE
  `message_id IS NULL`). Fase 19: tomar el disco de `config('chat.attachments.disk')`, validar en el controlador que
  la organización del adjunto es la del canal, y crear `MessageAttachmentFactory` si ayuda a los tests. Si
  `max_size_kb` sube por encima de ~6000, PHP (`uploads.ini`) rechaza antes que la validación.
- Bloque de menciones terminado (fases 9 a 17). Fase 17: ruta `/mentions` (`MentionsView`), entrada con contador en
  `AppSidebar` (99+, texto `sr-only`, `aria-label` con la barra colapsada). Sin mirar en el navegador: fila en móvil y
  badge con la barra colapsada (L-22). Sigue el bloque de adjuntos (fase 18, API).
- `LogView.spec` "refreshes the project counts once, after 300 ms..." falla de forma intermitente (1 de cada 3 a 6
  corridas) también en HEAD sin cambios de este plan: no es de este plan (M-27).
- Fase 16 hecha: `api/mentions.ts` (`listMentions`, `markMentionsRead`), tipos `Mention`/`MentionPage`,
  `useMentionsStore` con `mentions`, `unreadCount`, `nextCursor`, `loaded`, `loading`, `loadingMore`, `error`,
  `loadMoreFailed` y acciones `refresh()`, `loadMore()`, `markRead(m | m[])`, `markAllRead()`, `start(userId)`,
  `stop()`, `clear()`. `subscribeToUser` recibe un 4.º parámetro `onMention`. Fase 17: llamar a
  `start(auth.user.id)` en el layout autenticado (o junto al watch de `useMembershipWatch`) y `stop()` al hacer logout
  o desmontar; `start` ya hace el primer `refresh()` para el contador de la barra. `markRead` solo marca filas
  cargadas: abrir una mención desde la vista ya la tiene en la lista.
- Fase 15 hecha: `MessageComposer` con autocompletar y botón "Mencionar", envía `serialized` en canal e hilo.
  Sin mirar en el navegador: la lista dentro de `composer-box` y en la hoja móvil.
- Fase 14 hecha: `web/src/mentionToken.ts` (`MENTION_TOKEN` con `g`, solo para `matchAll`/`replace`;
  `mentionToken(id)`) y `useMentionInput({members, excludeUserId?, limit? = 8})` con estado `text`, `caret`,
  `mentions`, `query`, `suggestions`, `serialized`, `length` y acciones `update(value, selectionStart)` (input y
  pegar), `moveCaret(start, end)`, `select(member)` y `insertTrigger()` (devuelven el caret para fijar
  `selectionStart`), `dismiss()`, `reset()`. Fase 15: habilitar envío con `serialized.trim()`, comparar `length` con
  4000 y mostrar el email en la lista para distinguir nombres repetidos.
- Fase 13 hecha: `Message.mentions` es obligatorio en el tipo (las fixtures lo llevan) y `MessageBody` tolera
  `undefined`. La regex del token está duplicada entre el API y `MessageBody`: la fase 14 debe exportarla desde un
  solo módulo de la web y reutilizarla. Chip sin revisar en el navegador.
- Fase 12 hecha: `MentionController` (`index`, `read`), `MentionResource`, `ListMentionsRequest` (extiende
  `ListMessagesRequest`, autoriza con `viewAny` de Channel) y `MarkMentionsReadRequest`; tests en
  `MentionInboxApiTest`. La bandeja no filtra canales archivados (hoy todo miembro ve todos los canales).
- Fase 11 hecha: `MentionCreated::dispatch($userId, $message)` en `MessageController@store`, uno por mencionado,
  dentro de la transacción (`ShouldDispatchAfterCommit`); guarda el mensaje ya resuelto. Tests en
  `MentionBroadcastTest`.
- Fase 10 hecha: relación `Message::mentionedUsers()` (belongsToMany por `message_mentions`). `MessageCreated` se
  construye en el `created` del modelo, antes de las filas de menciones: el controlador resuelve los usuarios antes del
  `save()` y los fija con `setRelation('mentionedUsers', ...)`. La fase 11 debe disparar `MentionCreated` tras el
  commit con esos mismos usuarios. Archivos creados como root en el contenedor: `chown 1000:1000` si pint no escribe.
- Fase 9 hecha: tabla `message_mentions` (solo `created_at`, `read_at` nullable; único
  `message_mentions_message_id_user_id_unique`), modelo `MessageMention` con `$guarded = ['*']` y
  `BelongsToOrganization`, relación `Message::mentions()`. Fase 10: asignar por propiedad o por `$message->mentions()`,
  tomar `organization_id` del mensaje y validar que el usuario es miembro (la BD no lo comprueba).
- Bloque de hilos terminado (fases 1 a 8). Fase 8: `ThreadSummary` es un botón (`name="open-thread"`), "N respuestas
  · Última respuesta hace X" o "Responder en hilo"; la etiqueta relativa no se refresca sola. Pendiente de mirar en
  el navegador: `message-item__main` ahora es columna flex, y el scroll del panel (L-22). Sigue el bloque de menciones
  (fase 9, API).
- Fase 7 hecha: `ChannelView` abre `ThreadAside` por `?thread` (clase `channel__panel`; en móvil `AppDialog
  sheet-bottom` con su propio `matchMedia`). `openThread(id)` está en `ChannelView` (y en `defineExpose`): la fase 8
  solo hace que `MessageList` emita `open-thread` con el id y lo conecta con `@open-thread="openThread"`. El callback
  en vivo alimenta `messages.insert` y `thread.insert`; al reconectar, los dos `catchUp`. Pendiente de mirar en el
  navegador: scroll de las respuestas dentro del panel y de la hoja (L-22).
- Fase 6 hecha: `ThreadAside` (props `channelId`, `rootId`, `root?`, `archived?`, `ownUserId?`; evento `close`)
  llama a `thread.open` al montar y al cambiar `channelId`/`rootId`, pero no a `thread.clear()` (es del padre). Sin
  raíz funciona solo con las respuestas; un 404 muestra `thread.notFound` y oculta el composer; otros fallos,
  `thread.loadFailed` con `retry-thread`. Sin `AppDialog`: la hoja móvil y la clase `channel__panel` las pone la fase 7.
  Revisar en el navegador que el scroll de las respuestas quede dentro del panel (L-22). Claves para la fase 8:
  `thread.replies` (plural, `t('thread.replies', { n }, n)`), `thread.lastReply` (`{when}`), `thread.replyAction`.
- Fase 5 hecha: `useThreadStore` con estado `channelId`, `rootId`, `replies` (de la más antigua a la más nueva),
  `nextCursor`, `loading`, `loadingMore`, `error` (un 404 de `open` queda en `error.status`) y acciones
  `open(channelId, rootId)`, `loadOlder()`, `insert(message): boolean` (solo respuestas de esa raíz y canal),
  `catchUp()`, `send(body)` (lanza el `ApiError`), `clear()`. Fase 7: el callback en vivo del canal llama a
  `messages.insert` y a `thread.insert`; al reconectar, los dos `catchUp`; al cerrar el hilo o cambiar de canal,
  `thread.clear()`.
- Fase 4 hecha: tipos de hilo en `api/types.ts`; `api/messages.ts` con `listReplies(channelId, messageId,
  {cursor?, perPage?}, signal?)` (devuelve `CursorPage<Message>`, orden `id DESC`) y `sendReply(channelId, parentId,
  body)` (devuelve `Message`). Para `stores/thread.ts`: invertir la página, filtrar el evento en vivo por
  `parent_id === raíz`; `messages.send` sigue enviando solo raíces.
- Entorno web en la nube: `node_modules` se instaló en el host y se copió al volumen `web-node-modules` (los
  contenedores no tienen red); no correr `npm install` dentro.
- Fase 3 hecha: `MessageController@replies` con `abort_unless` sobre `channel_id` y `parent_id` nulo; tests en
  `MessageRepliesApiTest`. Sigue la web (fase 4): leer L-09 y los Resources antes de escribir tipos.
- Fase 2 hecha: `store` crea la respuesta y en la misma transacción hace `replies_count = replies_count + 1` y fija
  `last_reply_at`; `index` filtra `whereNull('parent_id')`. No hay evento que avise del contador de la raíz: la web
  lo deriva de la respuesta en vivo (fase 4). Fase 3: consultar `parent_id = {message}`, 404 si no es raíz del canal.
- Fase 1 hecha: migración `2026_10_09_100000_add_thread_columns_to_messages_table` (FK compuesta
  `messages_parent_fk`, `unique(channel_id, id)`), relaciones `parent`/`replies` en `Message`. `parent_id` está fuera
  de Fillable: en tests se asigna por propiedad; el store de la fase 2 debe fijarlo igual (o por la relación).
- Entorno en la nube: Docker Hub responde 429; la imagen `workspace-php` se construyó desde el mirror
  `mirror.gcr.io` con `--network host` y el CA del proxy (fuera del repo), y `vendor` se copió al volumen.

## Mejoras propuestas
- [ ] M-1 (alta, plan nuevo): editar y borrar mensajes propios (no está en el paso 6 y toca `updated_at`, el evento en
  vivo y los contadores de hilo).
- [ ] M-2 (media, sonnet): saltar a un mensaje concreto (carga alrededor de un id) al abrir una mención de un mensaje
  raíz antiguo; en este plan solo se abre el canal o el hilo.
- [ ] M-3 (media, sonnet): avatares de los últimos participantes en `ThreadSummary`, como en el diseño.
- [ ] M-4 (media, sonnet): borrar los archivos de adjuntos cuando se borra la organización (la cascada borra filas,
  no archivos).
- [ ] M-5 (media, sonnet): límites de adjuntos y almacenamiento por plan de la organización (`docs/monetizacion.md`).
- [ ] M-6 (baja, sonnet): hacer parcial el índice `(parent_id, id DESC)` con `WHERE parent_id IS NOT NULL`, para no
  indexar los mensajes raíz.
- [x] M-7 (baja, sonnet): fijar `last_reply_at` con `GREATEST(last_reply_at, ...)` para que respuestas concurrentes
  confirmadas en otro orden no lo hagan retroceder.
- [x] M-8 (baja, sonnet): en el test de aislamiento de `parent_id`, afirmar que la raíz de la otra organización sigue
  con `replies_count` 0.
- [x] M-9 (baja, sonnet): tests del 403 de `replies` para un miembro sin acceso al canal (privado o archivado), como
  los de `index`.
  Hecho como test de 200 en canal archivado: no hay canales privados y `ChannelPolicy::view` deja ver todos a
  cualquier miembro; el 403 de no miembro ya estaba cubierto.
- [x] M-10 (baja, sonnet): en el test de paginación de respuestas, afirmar que una respuesta de otra raíz no aparece.
- [ ] M-11 (media, sonnet): carreras del contador de respuestas entre `catchUp` (rama `joined`) y respuestas en vivo
  (pierde el +1 o suma 2 hasta el siguiente refresco); conciliar con `countedReplies` o un evento de contador en la API.
- [x] M-12 (baja, sonnet): `applyReply` recibe el `rootId` desde `insert` en vez de `reply.parent_id as number`, y
  spec de `insert` de una respuesta con `channelId` null.
- [x] M-13 (baja, sonnet): test de `thread.ts` para "open fallido, open nuevo, catchUp sí consulta"; y ordenar
  siempre las respuestas al cargar en vez de confiar en el orden del API.
- [x] M-14 (baja, sonnet): `ThreadAside`: ocultar la raíz si `open` da 404, re-enfocar el panel al cambiar de hilo
  sin desmontar, y usar `thread.rootUnavailable` cuando falte la raíz (o quitar la clave).
- [ ] M-15 (media, sonnet): mostrar la raíz de un hilo abierto por URL aunque no esté en la página cargada del canal
  (incluirla en la respuesta de `replies` o un endpoint de un mensaje); sirve también para abrir menciones (fase 17).
- [x] M-16 (baja, sonnet): tests de `ChannelView` para `thread.clear()` en `onUnmounted`, la baja del listener de
  `matchMedia` y el paso de estrecho a ancho con un hilo abierto (hoy se remonta y pierde el borrador).
- [x] M-17 (baja, sonnet): spec de `ThreadSummary` que afirme el nombre accesible con el conteo, y ordenar
  `threadable` junto a las demás props en `ChannelView.vue`.
- [x] M-18 (baja, sonnet): refrescar la etiqueta "hace cuánto" de `ThreadSummary` con el paso del tiempo.
- [x] M-19 (baja, sonnet): renombrar en `MessageMentionTest` el test "keeps the mention when only the user is not
  deleted..." a algo como "deletes mentions with the mentioned user".
- [ ] M-20 (media, sonnet): tope de menciones por mensaje (p. ej. 50) e insert en lote de `message_mentions`; hoy un
  mensaje puede mencionar a toda la organización y las fases 11 y 12 lo multiplican en eventos.
- [x] M-21 (baja, sonnet): test de `MentionCreated` que lo serialice y deserialice como la cola, para blindar que no
  depende de la organización activa.
- [x] M-22 (baja, sonnet): abrir la lista de menciones también tras puntuación de apertura (`(@Ana`), y specs de
  nombres con emoji y de pegar `@Anabel` sobre la mención `@Ana` (hoy la conserva).
- [x] M-23 (baja, sonnet): test del límite con el token expandido (`<@id>` más largo que `@Nombre`) y `role=status`
  del conteo de sugerencias siempre montado.
- [ ] M-24 (media, sonnet): refrescar la caché de miembros cuando cambian dentro de la misma organización (altas o
  bajas en `MembersView`, o al volver a abrir la lista tras un tiempo).
- [x] M-25 (baja, sonnet): `markRead`/`markAllRead` invalidan o relanzan un `refresh`/`loadMore` en vuelo, para que
  una respuesta previa al commit no deje filas como no leídas (L-35); `start()` con objeto de opciones en vez de
  callbacks posicionales vacíos.
  Aplicado solo lo de `markRead`/`markAllRead` (merge que no des-lee y relanzar el `refresh` en vuelo); `start()`
  sigue con callbacks porque cambiar `subscribeToUser` afecta a `useMembershipWatch`.
- [x] M-26 (baja, sonnet): `MentionsView` muestra el error de `refresh` aunque la lista ya esté cargada, refresca la
  hora relativa con el tiempo y marca leída también al abrir con clic central o en pestaña nueva (`auxclick`).
- [ ] M-27 (media, sonnet): test intermitente de `LogView.spec` ("refreshes the project counts once, after 300 ms"):
  falla 1 de cada 3 a 6 corridas en HEAD; buscar el temporizador real que queda armado antes de `useFakeTimers` (L-30).
- [ ] M-28 (media, sonnet): borrar los archivos del disco cuando la cascada borra filas de `message_attachments` por
  borrado de canal o de mensaje (la fase 22 solo limpia huérfanos sin mensaje); se suma a M-4.
- [ ] M-29 (baja, sonnet): documentar las variables `CHAT_ATTACHMENT*` en `api/.env.example`.
  Pendiente: en la sesión en la nube los permisos no dejan leer `api/.env.example`; aplicarla en local.
- [ ] M-30 (baja, sonnet): `serve => false` en el disco `local` de `api/config/filesystems.php` (nadie usa
  `/storage/{path}`); al truncar `original_name` quitar espacios o puntos antes de la extensión; test que compare el
  404 de un canal ajeno con el de un id inexistente.
- [ ] M-31 (baja, sonnet): cláusulas `WHEN` en los constraint triggers (`NEW.kind = 'user' AND NEW.body IS NULL`,
  `OLD.message_id IS NOT NULL`) para que los avisos de log no encolen un chequeo diferido; test de la carrera con
  `Event::fake` que afirme que no salen `MessageCreated` ni `MentionCreated`; ordenar los ids del `UPDATE` para evitar
  un deadlock entre dos envíos con los mismos ids.
- [ ] M-32 (baja, sonnet): servir `application/pdf` como `application/octet-stream` (Firefox lo abre en su visor),
  abrir el stream dentro del callback para que un HEAD no lo deje abierto, y redondear `expires` a tramos para que el
  navegador reaproveche la caché de imágenes.
- [x] M-33 (baja, sonnet): `chat:prune-attachments` recorre `chat/` por directorio de organización o canal en vez de
  `allFiles('chat')` entero, y su mensaje de error pasa por `__()`.
- [x] M-34 (baja, sonnet): `useAttachmentUploads`: solo red, 429 y 5xx reintentables (403, 404 y 413 no); `watch` del
  canal con `flush: 'sync'`; test explícito del 429; `formatFileSize` sin "1,024 KB" por redondeo.
- [x] M-35 (baja, sonnet): composer de adjuntos: una sola región viva para los estados de subida (hoy un
  `role=status`/`alert` por item, ruidoso con varios archivos y sin el nombre en "Subiendo..."), y quitar los items en
  error tras un envío con éxito.
- [ ] M-36 (media, sonnet): indicar adjuntos en `MentionsView` (p. ej. "N adjuntos" sin enlaces, o rediseñar la fila
  para que no sea un enlace entero).
- [x] M-37 (baja, sonnet): un solo `role=status` para los avisos de vista previa no disponible en `MessageAttachments`.
- [ ] M-38 (media, sonnet): conservar el borrador del composer del hilo al cruzar el umbral de 767 px (hoy la hoja y
  el aside son dos `ThreadAside` distintos; subir el borrador a un store o teleportar uno solo).
- [ ] M-39 (baja, sonnet): tras `markAllRead`, invalidar o relanzar un `loadMore` en vuelo (sus filas nuevas llegan como
  no leídas con `unreadCount` en 0), test de `markAllRead` con `refresh` en vuelo, y comentar en `mergeMentions` que
  depende de que no exista "marcar no leída".
