# Plan: comentarios-tareas

**Objetivo:** las tareas tienen comentarios en Markdown con menciones `@` y adjuntos, en vivo por Reverb.
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/`. Requiere terminado el plan `texto-enriquecido` (`MarkdownContent`, `MarkdownEditor`).
- API: tareas en `api/app/Http/Controllers/Api/TaskController.php` (`RELATIONS`), `api/app/Policies/TaskPolicy.php`,
  rutas `projects/{project}/tasks...` en `api/routes/api.php` L57-61, eventos `Task*` al canal
  `organizations.{org}.projects.{project}` con `ShouldDispatchAfterCommit`.
- Menciones del chat: token `<@id>`, `api/app/Chat/MessageMentions.php` (`target`, `diff`, `sync`), tabla `message_mentions`.
- Adjuntos del chat: `api/app/Http/Controllers/Api/AttachmentController.php` (subida, descarga firmada, nombre y mime),
  `message_attachments`, `api/config/chat.php`, comando `chat:prune-attachments`.
- Web: `web/src/realtime/echo.ts` (`subscribeToProject`), `useMentionInput.ts`, `useMentionKeyboard.ts`,
  `useAttachmentUploads.ts`, `MessageAttachments.vue`, `MessageBody.vue` (chip de mención).
- Lecciones: L-04, L-09, L-10, L-14, L-28, L-37 (resource igual en index y en eventos), L-41/L-49 (suite completa al tocar accesos), L-50.

## Fases

### [x] Fase 1 — Tabla task_comments
- **Alcance:** migración `task_comments` (organization_id, task_id con FK compuesta `(task_id, organization_id)` y
  cascade, user_id nullable con `nullOnDelete`, body text, timestamps; índice `(task_id, id)`), modelo con
  `BelongsToOrganization`, relación `Task::comments()`, factory; sección "Modelo de datos" de `.claude/rules/database.md`.
- **Archivos:** migración, `api/app/Models/TaskComment.php`, `api/app/Models/Task.php`, factory, `.claude/rules/database.md`
- **Terminado cuando:** test de modelo (cascade al borrar la tarea, FK que rechaza cruce de tenant).

### [x] Fase 2 — API listar y crear comentarios
- **Alcance:** GET (paginado por cursor, del más nuevo hacia atrás) y POST en `projects/{project}/tasks/{task}/comments`,
  FormRequest que autoriza antes de validar (body requerido, máx. 10000, sin `\x00`), `TaskCommentResource`, policy (ver = ver la tarea).
- **Archivos:** controlador, request, resource, policy, `api/routes/api.php`
- **Terminado cuando:** tests de acceso (otro proyecto, otra organización, proyecto privado), validación y paginación.

### [x] Fase 3 — Evento TaskCommentCreated
- Broadcast `.task.comment.created` al canal del proyecto con el resource cargado igual que en index (L-37). 2 archivos.

### [x] Fase 4 — Extraer la resolución de menciones [riesgo]
- Sacar de `MessageMentions::target` la parte que resuelve `<@id>` a miembros con acceso al proyecto, para reusarla sin
  canal. Refactor del chat: la suite completa del API pasa sin cambios. 2 archivos.

### [x] Fase 5 — Menciones en comentarios
- Tabla `task_comment_mentions`, se guardan al crear, el resource devuelve `mentions [{id, name}]`. Unos 4 archivos.

### [x] Fase 6 — Extraer el almacenamiento de adjuntos [riesgo]
- Pasar a una clase de soporte el guardado, nombre original, mime y la descarga en stream de `AttachmentController`.
  Tests del chat sin cambios. 2 archivos.

### [x] Fase 7 — Subida y descarga de adjuntos de comentarios [riesgo]
- Tabla `task_comment_attachments` (comment_id nulo hasta enlazarlo), subida en `.../tasks/{task}/attachments`,
  descarga firmada, límites de `config/chat.php`. Unos 5 archivos.

### [x] Fase 8 — Enlazar adjuntos al comentario
- `attachment_ids` al crear (solo del mismo autor y tarea, sin enlazar), resource con URLs firmadas, la poda de huérfanos
  cubre la tabla nueva. Unos 4 archivos.

### [x] Fase 9 — Borrar archivos al borrar la tarea [riesgo]
- Los archivos de los adjuntos de comentarios se borran del disco al borrar la tarea (después del commit). 2-3 archivos.

### [x] Fase 10 — Cliente y store de comentarios (web)
- `api/taskComments.ts`, store con contador de generación (L-10, L-14) y evento en vivo en `echo.ts`; tipos leídos de los resources (L-09). 3 archivos.

### [x] Fase 11 — Menciones en MarkdownContent (web)
- Regla de markdown-it que pinta `<@id>` como chip con el nombre de `mentions` (igual que `MessageBody`). 2 archivos.

### [x] Fase 12 — Autocompletado de menciones en MarkdownEditor (web) [riesgo]
- Conectar `useMentionInput`/`useMentionKeyboard` al editor como opción; hoy están pensados para el compositor del chat. 2-3 archivos.

### [x] Fase 13 — Comentarios en el panel de la tarea (web)
- `TaskComments.vue` (lista, cargar anteriores, compositor con `MarkdownEditor`) dentro de `TaskAside`. 2 archivos.

### [x] Fase 14 — Adjuntos en el compositor de comentarios (web) [riesgo]
- `useAttachmentUploads` con URL de subida configurable y `MessageAttachments` para mostrarlos. 3 archivos.

## Decisiones
- 2026-10-11 — Alcance: menciones, Markdown y adjuntos; sin editar ni borrar comentarios — elegido por el usuario.
- 2026-10-11 — Adjuntos en tabla propia `task_comment_attachments` (no polimórfica), para conservar las FK compuestas por tenant.

- 2026-10-12: el plan se ejecuta en el worktree `.claude/worktrees/comentarios-tareas` (rama `feat/comentarios-tareas`).
  Verificación desde un worktree (los contenedores montan el checkout principal), tomada de `integracion-simple`:
  web con `MSYS_NO_PATHCONV=1 docker run --rm -v "<worktree>/web:/app" -v workspace_web-node-modules:/app/node_modules -w /app node:24 npx vitest --run <spec>`;
  API, desde la raíz del checkout principal (solo lectura), con
  `WT="$(cd .claude/worktrees/comentarios-tareas/api && pwd -W)" && MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T -e APP_KEY="base64:$(head -c 32 /dev/urandom | base64)" -e DB_DATABASE=workspace_test -v "$WT:/var/www/api" api php artisan test --compact <archivos>`
  (igual con `./vendor/bin/pint --test -q`). Nunca leer ni montar `.env` (L-52).
- 2026-10-12 (fase 1): la migración añade `tasks_id_organization_id_unique (id, organization_id)`, destino de la FK
  compuesta; fases futuras con FK compuesta hacia `tasks` se apoyan en él. `task_id` no tiene FK simple. No hay
  `TaskFactory`: `TaskComment::factory()->forTask($task)` fija `task_id` y `organization_id`. `TaskComment` lleva solo
  `body` en Fillable y `BODY_MAX_LENGTH = 10000` para el FormRequest de la fase 2.
- 2026-10-12 (fase 2): `GET` ordena por `id` desc con `cursorPaginate` (30 por defecto, máx. 100; cursor inválido da 422).
  `TaskCommentResource`: `id`, `task_id`, `body`, `user {id, name}`, `created_at`. `TaskCommentController::RELATIONS =
  ['user:id,name']`, que el evento de la fase 3 debe cargar igual (L-37). Los FormRequest comprueban que la tarea sea
  del proyecto (404) y luego autorizan, antes de validar. `TaskCommentPolicy` (`viewAny`, `view`, `create`) delega en
  `TaskPolicy::view`. Se puede comentar en proyectos archivados (el revisor no lo ve un riesgo).
- 2026-10-12 (fase 3): `TaskCommentCreated(TaskComment $comment, int $projectId)` es `ShouldBroadcast` +
  `ShouldDispatchAfterCommit`, independiente de `TaskSnapshotEvent`; payload `{comment: {...}}` serializado en el
  constructor con `TaskCommentResource`. Las fases 5 y 8 deben cargar sus relaciones (menciones, adjuntos) en
  `TaskCommentController::RELATIONS` (L-37). La web (fase 10) escucha `.task.comment.created`.
- 2026-10-12 (fase 4): `App\Support\MentionTargets::resolve(?string $body, int $authorId, int $organizationId,
  ?int $projectId, int $max): Collection<User>` (estática); `MessageMentions::target` delega en ella con
  `chat.mentions.max_per_message`. La fase 5 la llama con el `project_id` de la tarea y decide el `$max` de los
  comentarios (reusar esa clave o crear otra). Suite completa del API sin fallos.
- 2026-10-12 (fase 5): `task_comment_mentions` con FK compuesta `(task_comment_id, organization_id)` hacia el nuevo único
  `task_comments_id_organization_id_unique` (la fase 8 puede apoyarse en él); `user_id` FK simple con cascade, único
  `(task_comment_id, user_id)`, sin `read_at`. `RELATIONS = ['user:id,name', 'mentionedUsers']`; el resource devuelve
  `mentions [{id, name}]` por id. `store` guarda comentario y menciones en `DB::transaction` (corrección de la revisión).
  `$max` reusa `chat.mentions.max_per_message`. No hay notificación de mención (llega con el plan `notificaciones`).
- 2026-10-12 (fase 6): `App\Support\AttachmentStorage` (estática): `store(UploadedFile, disk, directory)` devuelve
  `{path, original_name, mime, size}` y lanza `RuntimeException` si falla; `download(Request, disk, path, mime, name,
  label)` da 404 si falta el archivo, las mismas cabeceras y lee `expires` de la query (ruta firmada). El controlador
  sigue creando la fila, borrando el archivo si falla el `save()` y buscando el adjunto: la fase 7 repite esos pasos.
  Suite completa del API sin fallos.
- 2026-10-12 (fase 7): `task_comment_attachments` con `task_id` y `task_comment_id` (nulo) en FK compuestas con cascade,
  `user_id` con `nullOnDelete` e índice parcial de huérfanos. Archivos en `tasks/{org}/{task}/` (la poda del chat solo
  recorre `chat/`; la fase 9 puede borrar el directorio entero). Rutas: subida `POST projects/{project}/tasks/{task}/attachments`
  (`throttle:chat-attachments`), descarga firmada pública `GET task-attachments/{id}` (`task-attachments.download`, solo
  enlazados) y URL nueva `GET task-attachments/{id}/url` (404 si no enlazado o sin acceso). La subida responde `{id,
  original_name, mime, size, created_at, url}`. Fase 8: comprobar que el comentario sea de la misma tarea que el adjunto
  (la FK no lo garantiza) y que la poda cubra la tabla nueva y la raíz `tasks` en `pathChunks` sin borrar archivos con fila.
- 2026-10-12 (fase 7): los tests de comentarios viven en `api/tests/Feature/TaskComments/`. El montaje de Docker Desktop
  truncaba en silencio el listado de `tests/Feature` (Pest descubría 8 tests y salía con 0) al pasar de cierto tamaño de
  nombres. Tras agregar tests se comprueba `php vendor/bin/pest --list-tests | wc -l` (hoy 1124).
- 2026-10-12 (fase 8): `attachment_ids` al crear con el patrón del chat: validación en el request (misma tarea, mismo
  autor, sin enlazar; mensaje único que no revela la causa) y enlazado con `lockForUpdate` + `UPDATE ... whereNull` en la
  misma transacción (422 y rollback si no coinciden). Tope `chat.attachments.max_per_message`. `body` sigue requerido
  aunque haya adjuntos. `RELATIONS` incluye `attachments`; el resource devuelve siempre `attachments [{id,
  original_name, mime, size, created_at, url}]`. `chat:prune-attachments` poda también `task_comment_attachments`
  (`STORAGE_ROOTS = ['chat','tasks']`), con la misma ventana `orphan_hours`: un adjunto de comentario subido y no
  enviado en esa ventana se pierde, igual que en el chat.
- 2026-10-12 (fase 9): `App\Actions\DeleteTask` (invocable) es el punto único para borrar tareas: en `DB::transaction`
  bloquea la tarea, lee sus adjuntos (enlazados y huérfanos) y la borra; en `DB::afterCommit` borra los archivos y el
  directorio `tasks/{org}/{task}`. `TaskController::destroy` la usa. Hoy no hay borrado de proyectos ni organizaciones;
  si se agrega, debe pasar por `DeleteTask` (lo que escape lo barre `chat:prune-attachments`, que ya cubre `tasks/`).
- 2026-10-12 (fase 10): tipo `TaskComment` en `web/src/api/types.ts` (`user` nullable, `mentions`, `attachments` con la
  forma de `MessageAttachment`); cliente `web/src/api/taskComments.ts` (`CursorPage`). `useTaskCommentsStore`: `open`,
  `loadOlder`, `refresh`, `insert`, `send`, `clear`; lista de más antigua a más nueva, fusionada por id; contadores
  `generation` (L-10) y `listVersion` (L-14). `insert` descarta lo que no es de la tarea abierta o ya está. `subscribeToProject`
  acepta `onTaskCommentCreated` (con type guard). La fase 13 llama a `store.refresh()` en `onReconnect` y `clear()` al
  cerrar el panel. El `error` lo comparten la carga inicial y `loadOlder`, como en `thread.ts`.
- 2026-10-12 (fase 11): `renderMarkdown` acepta `options.mentions` (`{mentions, unknownLabel, ownUserId}`); una regla core
  convierte `<@id>` solo en tokens `text` (no en código). DOMPurify permite `span`, `class` y `data-mention`, y un hook los
  quita salvo en el chip exacto (`html: false` impide escribirlo a mano). `MarkdownContent` tiene props opcionales
  `mentions` y `ownUserId`; sin `mentions` el render no cambia. Usa `i18n.global.t` (reactivo al idioma) para
  `channel.unknownMention`. La fase 13 pasa `:mentions` y `:own-user-id`.
- 2026-10-12 (fase 12): `MarkdownEditor` tiene la prop opcional `mentions?: MarkdownMentionOptions` (`{members,
  excludeUserId?, ensureLoaded?}`); sin ella no cambia nada. Con ella `modelValue` lleva `<@id>`, el campo muestra
  `@Nombre` y el contador cuenta el serializado (L-11); la vista previa pasa `:mentions`. Escape con la lista abierta no
  llega al padre; Ctrl+Enter con la lista abierta elige la mención. La fase 13 pasa `:mentions="{ members:
  directory.membersOf(projectId), excludeUserId: auth.user?.id, ensureLoaded: () => directory.ensureLoaded(projectId) }"`
  y carga los miembros al abrir el panel (el `watch` del editor no reacciona a `members`). La lista de sugerencias va en
  el flujo bajo el textarea: revisar el layout en el navegador en la fase 13.
- 2026-10-12 (fase 13): `TaskComments.vue` al final de `TaskAside`; `PlanView` pasa `onTaskCommentCreated` a su
  `subscribeToProject` (sin canal nuevo) y llama `comments.refresh()` en `onReconnect`. `TaskComments` abre el store con
  un `watch` sobre `"projectId:taskId"` (L-43), limpia borrador y error al cambiar y `clear()` al desmontar. El
  compositor no se bloquea en proyectos archivados. Fecha relativa con `Intl.RelativeTimeFormat`, como `ThreadSummary`.
  Visto en el navegador (endpoints simulados): la lista de sugerencias cabe bajo el textarea del panel.
- 2026-10-12 (fase 14): `useAttachmentUploads(target: () => number | string, ...)`: un número sube al canal como antes;
  un texto es la ruta de subida (`uploadAttachmentTo` en `api/attachments.ts`); al cambiar el target se vacía la lista y
  se descartan las subidas en vuelo (L-10). `MessageAttachments` tiene la prop opcional `renewUrl`; sin ella usa
  `getAttachmentUrl`. `api/taskComments.ts` suma `taskAttachmentsPath` y `getTaskAttachmentUrl`. `TaskComments` repite
  el patrón de `MessageComposer` (botón, pegar, arrastrar, estado por archivo, `role="status"`) y envía `attachment_ids`.
- 2026-10-12: plan terminado. Suite API 1137 tests sin fallos (list-tests 1140), Pint limpio; suite web 1649 tests con
  solo los 6 fallos previos de AppLayout.spec, vue-tsc limpio.

## Notas para la próxima sesión
- Plan terminado. Pendientes solo las mejoras propuestas. El plan `notificaciones` escucha `TaskCommentCreated`.

## Mejoras propuestas
- [ ] M-1: Editar y borrar comentarios propios (admin/owner borran cualquiera), con resincronización de menciones.
      Complejidad: media · Archivos: 5 · Riesgo: contrato público → opus
- [ ] M-2: Contador de comentarios en `TaskCard`.
      Complejidad: baja · Archivos: 3 · Riesgo: contrato público → sonnet
- [x] M-3: `database.md`: referencia cruzada al nuevo único de `tasks` en su entrada y revisar la línea "Futuro: policy,
      API y eventos de tareas", desfasada. Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [x] M-4: Test directo de `TaskCommentPolicy::view` (hoy sin ruta que lo use) cuando exista editar o borrar.
      Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [x] M-5: Docblock de `AttachmentStorage::download` que diga que depende de `expires` de una ruta firmada para el
      `max-age`. Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [ ] M-6: Repartir `api/tests/Feature` en subcarpetas por módulo (Chat, Log, Plan, Core) para alejarse del umbral que
      trunca el descubrimiento de Pest en el montaje de Docker. Decisión del usuario. Complejidad: alta (más de 5
      archivos, mueve toda la suite) → convertir en plan
- [x] M-7: Compartir `signedDownload()` y `URL_EXPIRY_STEP_SECONDS` entre `MessageAttachment` y `TaskCommentAttachment`
      (trait). Complejidad: baja · Archivos: 2-3 · sin riesgo → sonnet
- [x] M-8: Test de descarga y URL nueva de un adjunto de comentario cuyo archivo falta en disco (404).
      Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [x] M-9: Acortar los docblocks y comentarios de `App\Actions\DeleteTask` a lo no obvio (convención de comentarios
      mínimos). Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [x] M-10: `validComment` (echo.ts) valida también la forma de `user` y de los elementos de `mentions` y `attachments`.
      Complejidad: baja · Archivos: 2 · sin riesgo → sonnet
- [x] M-11: Specs de `MarkdownContent` para un `<span class="mention-chip">` escrito por el usuario (sale como texto) y
      para `\<@1>` (sin chip). Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [x] M-12: Unificar la resolución de menciones de `MessageBody.vue` y la regla de `renderMarkdown`.
      Complejidad: media · Archivos: 3-4 · sin riesgo → sonnet
- [x] M-13: `MarkdownEditor`: el `watch` que pinta `@Nombre` depende también de `mentions.members`, para que un valor
      con `<@id>` montado antes de cargar los miembros se repinte. Complejidad: baja · Archivos: 2 · sin riesgo → sonnet
- [x] M-14: `MarkdownEditor`: deshacer (Ctrl+Z) un formato que envolvía una mención la deja como `@Nombre` sin token;
      conservar las menciones al reconciliar tras deshacer. Complejidad: media · Archivos: 2 · sin riesgo → sonnet
- [x] M-15: `MarkdownEditor`: `position: relative` en la raíz para el texto solo para lectores.
      Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [ ] M-16: Accesibilidad de `TaskComments`: región `role="status"` que anuncie el comentario enviado, `role="status"`
      en "Cargando" y vacío, `aria-labelledby` al `<h2>` en vez de `aria-label` repetido y nombre en la `<ul>`.
      Complejidad: baja · Archivos: 2 · sin riesgo → sonnet
- [ ] M-17: Llevar a la vista el comentario recién enviado (scroll) en `TaskComments`.
      Complejidad: baja · Archivos: 2 · sin riesgo → sonnet
- [ ] M-18: Texto propio para el exceso de adjuntos en comentarios (`attachments.tooMany` dice "por mensaje").
      Complejidad: baja · Archivos: 3 · sin riesgo → sonnet
- [ ] M-19: Actualizar en `useAttachmentUploads.ts` los comentarios "channel changes" y la rama `error.errors.channel`,
      que ahora sirven a dos destinos. Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [x] M-20: `\<@1>` escrito por el usuario genera chip (la regla core `mentions` de `renderMarkdown.ts` ve el texto tras el escape); respetar el escape y fijarlo con spec. Complejidad: baja · Archivos: 2 · sin riesgo → sonnet
