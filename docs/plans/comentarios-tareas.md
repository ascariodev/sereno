# Plan: comentarios-tareas

**Objetivo:** las tareas tienen comentarios en Markdown con menciones `@` y adjuntos, en vivo por Reverb.
**Estado:** en curso · Fase actual: 2
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

### [ ] Fase 2 — API listar y crear comentarios
- **Alcance:** GET (paginado por cursor, del más nuevo hacia atrás) y POST en `projects/{project}/tasks/{task}/comments`,
  FormRequest que autoriza antes de validar (body requerido, máx. 10000, sin `\x00`), `TaskCommentResource`, policy (ver = ver la tarea).
- **Archivos:** controlador, request, resource, policy, `api/routes/api.php`
- **Terminado cuando:** tests de acceso (otro proyecto, otra organización, proyecto privado), validación y paginación.

### [ ] Fase 3 — Evento TaskCommentCreated
- Broadcast `.task.comment.created` al canal del proyecto con el resource cargado igual que en index (L-37). 2 archivos.

### [ ] Fase 4 — Extraer la resolución de menciones [riesgo]
- Sacar de `MessageMentions::target` la parte que resuelve `<@id>` a miembros con acceso al proyecto, para reusarla sin
  canal. Refactor del chat: la suite completa del API pasa sin cambios. 2 archivos.

### [ ] Fase 5 — Menciones en comentarios
- Tabla `task_comment_mentions`, se guardan al crear, el resource devuelve `mentions [{id, name}]`. Unos 4 archivos.

### [ ] Fase 6 — Extraer el almacenamiento de adjuntos [riesgo]
- Pasar a una clase de soporte el guardado, nombre original, mime y la descarga en stream de `AttachmentController`.
  Tests del chat sin cambios. 2 archivos.

### [ ] Fase 7 — Subida y descarga de adjuntos de comentarios [riesgo]
- Tabla `task_comment_attachments` (comment_id nulo hasta enlazarlo), subida en `.../tasks/{task}/attachments`,
  descarga firmada, límites de `config/chat.php`. Unos 5 archivos.

### [ ] Fase 8 — Enlazar adjuntos al comentario
- `attachment_ids` al crear (solo del mismo autor y tarea, sin enlazar), resource con URLs firmadas, la poda de huérfanos
  cubre la tabla nueva. Unos 4 archivos.

### [ ] Fase 9 — Borrar archivos al borrar la tarea [riesgo]
- Los archivos de los adjuntos de comentarios se borran del disco al borrar la tarea (después del commit). 2-3 archivos.

### [ ] Fase 10 — Cliente y store de comentarios (web)
- `api/taskComments.ts`, store con contador de generación (L-10, L-14) y evento en vivo en `echo.ts`; tipos leídos de los resources (L-09). 3 archivos.

### [ ] Fase 11 — Menciones en MarkdownContent (web)
- Regla de markdown-it que pinta `<@id>` como chip con el nombre de `mentions` (igual que `MessageBody`). 2 archivos.

### [ ] Fase 12 — Autocompletado de menciones en MarkdownEditor (web) [riesgo]
- Conectar `useMentionInput`/`useMentionKeyboard` al editor como opción; hoy están pensados para el compositor del chat. 2-3 archivos.

### [ ] Fase 13 — Comentarios en el panel de la tarea (web)
- `TaskComments.vue` (lista, cargar anteriores, compositor con `MarkdownEditor`) dentro de `TaskAside`. 2 archivos.

### [ ] Fase 14 — Adjuntos en el compositor de comentarios (web) [riesgo]
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

## Notas para la próxima sesión
- Fase 1 hecha (tabla y modelo). Sigue la fase 2. El plan `notificaciones` escucha `TaskCommentCreated`.

## Mejoras propuestas
- [ ] M-1: Editar y borrar comentarios propios (admin/owner borran cualquiera), con resincronización de menciones.
      Complejidad: media · Archivos: 5 · Riesgo: contrato público → opus
- [ ] M-2: Contador de comentarios en `TaskCard`.
      Complejidad: baja · Archivos: 3 · Riesgo: contrato público → sonnet
- [ ] M-3: `database.md`: referencia cruzada al nuevo único de `tasks` en su entrada y revisar la línea "Futuro: policy,
      API y eventos de tareas", desfasada. Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
