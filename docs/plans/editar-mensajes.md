# Plan: editar-mensajes

**Objetivo:** que el autor de un mensaje pueda editar su texto (con menciones) y borrarlo, con el cambio en vivo
para todos, los contadores de hilo y la bandeja de menciones coherentes. Sale de M-1 de `terminados/chat.md`.
**Estado:** en curso · Fase actual: 9
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps: `api/` (fases 1 a 8) y `web/` (fases 9 a 19). Commits con `git` en la raíz.
- Esquema: `messages` sin `updated_at` (`UPDATED_AT = null`); hilos con `parent_id`, `replies_count` y `last_reply_at`
  que mantiene `MessageController@store` (no hay trigger); FK `messages_parent_fk` borra respuestas en cascada.
  Constraint triggers diferidos `messages_body_or_attachments` (en `messages`) y
  `message_attachments_keep_message_content` (en adjuntos), ambos con la función
  `messages_require_body_or_attachments()` (migraciones `2026_10_09_130000` y `150000`): un mensaje `user` sin body
  necesita adjuntos. Modelo de datos en `.claude/rules/database.md`.
- API: `MessageController` (`store` en transacción: menciones por `<@id>` con tope `chat.mentions.max_per_message`,
  `saveMentions` + `MentionCreated`, `linkAttachments`, contador del padre con `GREATEST`; `index` solo raíces;
  `replies` con `meta.root`; `loadParticipants` calculado al leer), `StoreMessageRequest`, `MessageResource`,
  `MentionController` (`meta.unread_count`), eventos `MessageCreated` (`message.created`, canal
  `organizations.{org}.channels.{channel}`) y `MentionCreated` (`mention.created`, `users.{id}`), ambos
  `ShouldDispatchAfterCommit`. Sin MessagePolicy: todo pasa por `Gate::allows('view', $channel)`. Throttle
  `channel-messages` (30/min) en `AppServiceProvider`. `chat:prune-attachments` borra archivos sin fila.
- Web: `stores/messages.ts` (`mergeById` prefiere la versión entrante; `insert` ignora ids ya conocidos;
  `applyReply`, `countedReplies`, `snapshots` y `reconcile` de M-11 asumen contadores que solo suben),
  `stores/thread.ts` (`withReplies` conserva la versión actual; `withRoot` con `Math.max` y `laterDate`),
  `ThreadAside.vue` (`repliesCount` con `max`), `realtime/echo.ts` (`subscribeToChannel` solo `message.created`;
  `subscribeToUser(userId, handlers)`), `ChannelView.vue` (`onLiveMessage`, `catchUp` al reconectar),
  `MessageItem.vue` (sin acciones), `MessageComposer.vue` (`useMentionInput` con `restore(MentionDraft)`),
  `mentionToken.ts`, `stores/mentions.ts` (`mergeMentions` nunca quita), `components/ui/AppMenu.vue` y `AppDialog.vue`.
- Helpers globales de Pest ya ocupados (L-29): la lista completa se saca con
  `grep -rhoE '^function [a-zA-Z]+' api/tests | sort -u`; la de `terminados/chat.md` está incompleta.
- El diseño (`docs/diseno/calma`) no muestra editar ni borrar: seguir el estilo de `MessageItem` y `AppMenu`.

## Fases

### API

### [x] Fase 1 — Columnas de edición y borrado en `messages` (api) [riesgo]
- **Alcance:** migración que agrega `edited_at` y `deleted_at` (timestamp nullable) a `messages` y reemplaza
  `messages_require_body_or_attachments()` para que no exija contenido a un mensaje con `deleted_at` (con
  `SET search_path`; `down()` restaura la versión anterior y quita las columnas). Revisar si el `WHEN` del trigger de
  `messages` debe incluir `NEW.deleted_at IS NULL` para no disparar al borrar. `Message`: casts de las dos columnas,
  fuera de Fillable. Actualizar `database.md`.
- **Archivos:** migración nueva, `api/app/Models/Message.php`, `.claude/rules/database.md`.
- **Terminado cuando:** test en `MessageAttachmentTest` (o `MessageTest`): un mensaje `user` con `deleted_at`, sin body
  y sin adjuntos se confirma; sin `deleted_at` lo sigue rechazando la BD; quitar el último adjunto de un mensaje
  borrado pasa. `migrate:fresh` y `migrate:rollback` de la migración corren.

### [x] Fase 2 — Policy de mensajes (api)
- **Alcance:** `MessagePolicy` con `update` y `delete`: solo el autor, solo `kind = user`, no borrado, mensaje de la
  organización activa y canal visible (`ChannelPolicy::view`). El canal archivado lo rechazan los FormRequest de las
  fases 4 y 6, igual que `StoreMessageRequest`.
- **Archivos:** `api/app/Policies/MessagePolicy.php`.
- **Terminado cuando:** test con `Gate::forUser(...)`: el autor puede; otro miembro, un admin, un owner y alguien de
  otra organización no; un aviso de sistema y un mensaje borrado no.

### [x] Fase 3 — Sincronizar menciones en una clase propia (api)
- Extraer de `MessageController@store` el cálculo de menciones y `saveMentions` a una clase (p. ej.
  `app/Chat/MessageMentions.php`) que reciba el mensaje y el body y devuelva altas y bajas; `store` la usa sin cambio
  de comportamiento. Pasan los tests de menciones existentes.

### [x] Fase 4 — Editar el texto de un mensaje (api) [límite: 5 archivos]
- `PATCH channels/{channel}/messages/{message}` con `UpdateMessageRequest` (mismas reglas de body; vacío solo si
  tiene adjuntos; canal archivado; policy `update`) y `throttle:channel-messages`. Fija `edited_at` solo si el body
  cambió; sincroniza menciones (alta con `MentionCreated` solo para las nuevas, baja de filas quitadas).
  `MessageResource` agrega `edited_at`.

### [x] Fase 5 — Evento en vivo de la edición (api)
- `MessageUpdated` (`message.updated`, mismo canal, payload `{message}` resuelto, tras el commit) desde el `PATCH`.

### [x] Fase 6 — Borrar un mensaje (api) [riesgo]
- `DELETE channels/{channel}/messages/{message}` (policy `delete`, canal archivado, throttle): en transacción fija
  `deleted_at`, vacía body, borra menciones y filas de adjuntos (archivos tras el commit; `chat:prune-attachments`
  de respaldo). Si es respuesta, bloquea la raíz (`FOR UPDATE`), resta `replies_count` y recalcula `last_reply_at`
  con las respuestas vivas. `MessageResource` agrega `deleted_at` y no expone body, menciones ni adjuntos de un
  borrado. Test de concurrencia de contador con una respuesta nueva.

### [x] Fase 7 — Listas sin mensajes borrados (api)
- `index` omite raíces borradas sin respuestas (las que tienen quedan como marcador); `replies` omite respuestas
  borradas y sigue sirviendo una raíz borrada; `loadParticipants` ignora respuestas borradas.

### [x] Fase 8 — Eventos en vivo del borrado (api)
- `MessageDeleted` (`message.deleted`: `id`, `channel_id`, `parent_id` y `root` con `replies_count` y `last_reply_at`
  ya recalculados) en el canal, y `MentionRemoved` (`mention.removed`, `users.{id}`, con organización, canal, `parent_id` e id del mensaje, sin contenido) para
  cada mención quitada por edición o borrado.

### Web

### [ ] Fase 9 — Tipos, API y suscripción a los eventos nuevos (web)
- `edited_at` y `deleted_at` en `Message`; `updateMessage` y `deleteMessage` en `api/messages.ts`;
  `subscribeToChannel` con objeto de handlers (`onCreated`, `onUpdated`, `onDeleted`) y `ChannelView` adaptado sin
  cambio de comportamiento. Spec en `echo.spec`.

### [ ] Fase 10 — Ediciones y borrados en vivo en el store del canal (web) [riesgo]
- `stores/messages.ts`: `replace(message)` (lista y `pending`), `remove(event)` (quita, o deja marcador si la raíz
  tiene respuestas) y contadores de la raíz tomados del evento aunque bajen, actualizando `snapshots` y
  `countedReplies` para que `reconcile` no los vuelva a subir.

### [ ] Fase 11 — `catchUp` del canal detecta borrados (web)
- En la rama `joined`, los ids del rango que cubren las páginas recibidas y que no vinieron se quitan (L-27).

### [ ] Fase 12 — Ediciones y borrados en el hilo abierto (web) [riesgo]
- `stores/thread.ts`: `withReplies` prefiere la versión entrante, quita respuestas borradas (en vivo y en
  `catchUp`), la raíz acepta contadores que bajan desde el evento; `ThreadAside` sin `max` que impida bajar.

### [ ] Fase 13 — Conectar los eventos en `ChannelView` (web)
- `onUpdated` y `onDeleted` van a los dos stores; una raíz borrada con el hilo abierto muestra el marcador.

### [ ] Fase 14 — Mostrar "editado" y el marcador de borrado (web)
- `MessageItem`: "(editado)" con tooltip de la fecha; mensaje borrado como "Mensaje eliminado" sin cuerpo, adjuntos
  ni acciones, conservando `ThreadSummary`. i18n.

### [ ] Fase 15 — Menú de acciones del mensaje (web) [límite: 5 archivos]
- `AppMenu` en `MessageItem` (solo mensajes propios, `user`, no borrados; visible al pasar o con foco, siempre en
  táctil) con Editar y Eliminar; las acciones llegan por `provide`/`inject` desde `ChannelView` (clave en un archivo
  propio) para no pasar props por `MessageList` y `ThreadAside`. Spec de visibilidad y teclado.

### [ ] Fase 16 — Confirmar y borrar (web)
- Diálogo de confirmación (`AppDialog`), llamada a `deleteMessage`, aplica la respuesta en los stores sin esperar el
  evento, errores 403, 404, 422 y 429 con toast.

### [ ] Fase 17 — Body serializado a borrador de menciones (web)
- `parseMentionDraft(body, mentions)` en `mentionToken.ts` (o junto a `useMentionInput`): `<@id>` a `@Nombre` con
  rangos; ida y vuelta con `serialized` en el spec, con emojis (L-11) y menciones desconocidas.

### [ ] Fase 18 — Editor en línea (web) [límite: 5 archivos]
- `MessageEditor.vue` con `useMentionInput` restaurado desde la fase 17 y sugerencias; Enter guarda, Escape cancela,
  Shift+Enter salto; errores como el composer; un solo mensaje en edición a la vez (estado en `ChannelView`).

### [ ] Fase 19 — Menciones quitadas en la bandeja (web)
- `subscribeToUser` con `onMentionRemoved`; `stores/mentions.ts` quita la fila y baja `unreadCount` si no estaba
  leída (ignora otras organizaciones). Al terminar, actualizar `CLAUDE.md` si hace falta.

## Decisiones
- 2026-10-09 — Solo el autor edita y borra sus mensajes `user`; los avisos de sistema no se editan ni se borran.
  Moderación de owner/admin queda como mejora. Motivo: alcance de M-1 ("mensajes propios").
- 2026-10-09 — Borrado blando siempre (`deleted_at`, body vacío, menciones y adjuntos fuera): una raíz con respuestas
  queda como marcador "Mensaje eliminado" y conserva su hilo; una raíz sin respuestas y las respuestas borradas
  desaparecen de las listas. Motivo: la FK borra las respuestas en cascada y borrar una raíz no debe llevarse el hilo
  de otros.
- 2026-10-09 — Editar cambia solo el texto (y sus menciones); los adjuntos no se tocan. Sin historial de versiones ni
  ventana de tiempo: solo `edited_at`. Motivo: mínimo útil; lo demás, mejoras.
- 2026-10-09 — Eventos nuevos `message.updated`, `message.deleted` (con contadores de la raíz ya recalculados, que el
  cliente aplica aunque bajen) y `mention.removed`. Mismo throttle `channel-messages` para editar y borrar.

## Notas para la próxima sesión
- Fases 1 a 8 hechas (API completa). `edited_at`/`deleted_at` existen (cast `datetime`, fuera de Fillable: asignar por propiedad o `DB::table`); la función de contenido ignora mensajes con `deleted_at`. `MessagePolicy` (`update`, `delete`) se autodescubre; no cubre canal archivado. En tests, `Channel::factory()->for(Project::factory()->for($org))`.
- `App\Chat\MessageMentions` (`target`, `diff`, `sync`). PATCH `channels/{channel}/messages/{message}` (`UpdateMessageRequest`, `throttle:channel-messages`): 404 si el mensaje no es del canal (en `authorize()`), `edited_at` solo si cambia el body (precisión de segundos), body vacío solo con adjuntos, no acepta `attachment_ids`; la respuesta carga `RELATIONS` y `loadParticipants`. `MessageUpdated` (`message.updated`, payload `{message}` con RELATIONS + `loadParticipants`) solo se emite si cambió el body. DELETE `channels/{channel}/messages/{message}` (`DeleteMessageRequest`, lógica en `App\Chat\MessageDeletion`): 200 con el resource del borrado (body null, sin menciones ni adjuntos) y, si es respuesta, `meta.root` con `id`, `replies_count` y `last_reply_at`; ya borrado da 403 (policy), borrado en carrera 404. Lock raíz y luego respuesta, resta 1 y recalcula `last_reply_at`; archivos tras el commit. `MessageDeletion::delete()` devuelve `removed_mentions` para `MentionRemoved` (fase 8). `index` lista raíces con `deleted_at IS NULL OR replies_count > 0`; `replies` omite respuestas borradas y sirve la raíz borrada (`meta.root.deleted_at`); `loadParticipants` ignora borradas. Eventos: `message.deleted` `{id, channel_id, parent_id, deleted_at, root:{id, replies_count, last_reply_at}}` (en una raíz, `root` es ella misma); `mention.removed` `{organization_id, channel_id, parent_id, message_id}` sin contenido (puede ir a un ex miembro), emitido desde PATCH y DELETE tras la transacción. La web (fase 19) quita la fila de la bandeja por `message_id`. Siguiente: fase 9 (web: tipos, API y suscripción).

## Mejoras propuestas
- [ ] M-1 (media, sonnet): owner y admin pueden borrar mensajes de otros (moderación), con el actor en el evento.
- [ ] M-2 (media, sonnet): quitar adjuntos al editar un mensaje.
- [ ] M-3 (baja, sonnet): flecha arriba en el composer vacío edita el último mensaje propio del canal.
- [ ] M-4 (alta, plan nuevo): historial de ediciones (auditoría, plan Business de `docs/monetizacion.md`).
- [ ] M-5 (baja, sonnet): bloquear la fila (`lockForUpdate`) en el PATCH para serializar ediciones concurrentes del mismo mensaje (bajo riesgo: solo edita el autor).
- [ ] M-6 (baja, sonnet): en `MessageUpdated`, dejar explícito (o forzar con `load`) que el payload depende de que el controlador cargue antes `recentParticipants`, porque `loadMissing` no recarga.
- [ ] M-7 (media, sonnet): test de concurrencia real con dos conexiones (borrar una respuesta mientras otra se inserta) en vez del hook `created` en la misma conexión; documentar el deadlock teórico (reusar ids de adjuntos de la respuesta que se borra), que Postgres aborta.
- [ ] M-8 (baja, sonnet): tests de listas con borrados: `DELETE` de la última respuesta de una raíz ya borrada la saca de `index`, y recorrido por cursor de dos páginas con borrados intercalados.
- [ ] M-9 (media, sonnet): `mention.created` manda el mensaje completo a `users.{id}`; si la membresía cae antes de que la cola lo procese, llega a un ex miembro. Verificar la membresía al emitir (`broadcastWhen`) o reducir el payload.
