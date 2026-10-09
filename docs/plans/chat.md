# Plan: chat

**Objetivo:** paso 6 del MVP sobre los canales de proyecto: responder en hilos (también a los avisos de log),
mencionar a miembros con bandeja de menciones sin leer, y adjuntar archivos a los mensajes.
**Estado:** en curso · Fase actual: 3
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

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
  `systemRootIn`.
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

### [ ] Fase 3 — Listar las respuestas de un hilo (api)
- Ruta `GET channels/{channel}/messages/{message}/replies` con cursor (mismas reglas que `ListMessagesRequest`),
  404 si el mensaje no es raíz del canal. Test de aislamiento entre organizaciones.

### [ ] Fase 4 — Hilos en el store y tipos del canal (web)
- Tipos (`parent_id`, `replies_count`, `last_reply_at`) y `api` de respuestas; en `stores/messages.ts` una respuesta en
  vivo no entra a la lista: actualiza contador y `last_reply_at` de su raíz si está cargada; `catchUp` refresca los
  contadores (el merge debe preferir la versión entrante). L-27.

### [ ] Fase 5 — Store del hilo abierto (web) [riesgo]
- `stores/thread.ts`: abrir raíz con sus respuestas, cargar más antiguas, recibir en vivo, enviar respuesta y
  `catchUp` al reconectar, con contadores de generación (L-10, L-14, L-35). Spec propio.

### [ ] Fase 6 — Panel del hilo (web)
- `ThreadAside.vue`: raíz arriba, respuestas con `MessageList`, composer de respuesta, cerrar. Todas las claves i18n
  del hilo (también las de la fase 8). Spec del componente.

### [ ] Fase 7 — Abrir el hilo desde el canal (web)
- `ChannelView`: `?thread=<id>` abre `ThreadAside` (excluyente con `?group`), en móvil como hoja; suscripción en vivo
  compartida entre canal e hilo.

### [ ] Fase 8 — Resumen y acción de responder en los mensajes (web) [límite: 5 archivos]
- `ThreadSummary.vue` ("N respuestas", hace cuánto) en `MessageItem` y en la tarjeta de `SystemNotice`; acción
  "Responder en hilo"; `MessageList` y `ChannelView` propagan `openThread`.

### Menciones

### [ ] Fase 9 — Esquema de menciones (api)
- Tabla `message_mentions` (organization_id, message_id, user_id, read_at, created_at; único `(message_id, user_id)`;
  índice `(user_id, organization_id, read_at)`), modelo `MessageMention`, `database.md`.

### [ ] Fase 10 — Guardar menciones al crear un mensaje (api)
- El body lleva menciones como `<@id>`; al crear se guardan las de miembros de la organización (sin el autor ni
  repetidos). `MessageResource` agrega `mentions: [{id, name}]` con eager load en lista y respuestas.

### [ ] Fase 11 — Aviso en vivo de una mención (api)
- Evento `MentionCreated` en `users.{id}` tras el commit, con organización, canal, mensaje y raíz si es respuesta.

### [ ] Fase 12 — Bandeja de menciones (api)
- `GET mentions` (propias, de la organización activa, cursor, con mensaje, canal y autor, más `unread_count`) y
  `POST mentions/read` (ids o todas). Aislamiento por usuario y organización.

### [ ] Fase 13 — Mostrar menciones en el cuerpo (web)
- `MessageBody.vue`: convierte `<@id>` en chip con el nombre de `mentions` (desconocido: texto genérico traducido),
  sin `v-html`; resalta la propia. Usado por `MessageItem`.

### [ ] Fase 14 — Lógica de autocompletar menciones (web) [riesgo]
- Composable `useMentionInput`: detecta `@` en el caret, filtra miembros, inserta `@Nombre` y al enviar serializa a
  `<@id>`; el límite de 4000 se cuenta sobre lo serializado (L-11). Solo lógica y spec.

### [ ] Fase 15 — Autocompletar en el composer (web) [límite: 5 archivos]
- Lista de sugerencias (Reka) bajo el composer, botón "Mencionar", caché de miembros por organización, i18n.

### [ ] Fase 16 — Store de menciones en vivo (web)
- `api/mentions.ts`, `stores/mentions.ts` (lista, no leídas, marcar leídas) y `MentionCreated` por `subscribeToUser`,
  ignorando otras organizaciones.

### [ ] Fase 17 — Vista de menciones y contador en la barra (web) [límite: 5 archivos]
- Ruta `/mentions`, `MentionsView`, entrada "Menciones" con contador; abrir una mención va al canal (con `?thread` si
  es respuesta) y la marca leída.

### Adjuntos

### [ ] Fase 18 — Esquema y configuración de adjuntos (api)
- `config/chat.php` (disco, tamaño máximo, adjuntos por mensaje, vigencia de la URL). Tabla `message_attachments`
  (organization_id, channel_id, message_id nullable, uploaded_by, disk, path, original_name, mime, size,
  created_at), modelo, `database.md`.

### [ ] Fase 19 — Subir un archivo (api) [riesgo]
- `POST channels/{channel}/attachments` multipart: valida tamaño, rechaza canal archivado, guarda en disco privado
  con nombre aleatorio y devuelve el adjunto sin mensaje. Throttle propio.

### [ ] Fase 20 — Adjuntar archivos al mensaje (api) [riesgo] [límite: 5 archivos]
- `attachment_ids` en `StoreMessageRequest` (propios, del canal, libres); body opcional si hay adjuntos (migración que
  relaja el CHECK); vínculo con `UPDATE ... WHERE message_id IS NULL` que falla si otro mensaje lo tomó;
  `MessageResource` con `attachments`.

### [ ] Fase 21 — Descargar un adjunto con URL firmada (api) [riesgo]
- Ruta firmada temporal (sin Bearer, para `<img>`); `inline` solo para png, jpeg, gif y webp, el resto como
  descarga; `nosniff` y CSP `sandbox`. La URL va en el resource.

### [ ] Fase 22 — Limpieza de adjuntos huérfanos (api)
- Comando diario en el scheduler: borra archivo y fila de adjuntos sin mensaje con más de 24 h.

### [ ] Fase 23 — Cliente de subida (web)
- `api/client.ts` acepta `FormData` (sin `Content-Type` JSON), `api/attachments.ts`, tipos de adjunto.

### [ ] Fase 24 — Estado de las subidas en curso (web)
- Composable `useAttachmentUploads` (subir, cancelar con `AbortController`, quitar, errores, ids listos) e i18n de
  adjuntos.

### [ ] Fase 25 — Adjuntar desde el composer (web)
- Botón "Adjuntar", lista de pendientes en el composer, `send` del canal y del hilo con `attachment_ids`.

### [ ] Fase 26 — Mostrar los adjuntos de un mensaje (web)
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

## Notas para la próxima sesión
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
- [ ] M-7 (baja, sonnet): fijar `last_reply_at` con `GREATEST(last_reply_at, ...)` para que respuestas concurrentes
  confirmadas en otro orden no lo hagan retroceder.
- [ ] M-8 (baja, sonnet): en el test de aislamiento de `parent_id`, afirmar que la raíz de la otra organización sigue
  con `replies_count` 0.
