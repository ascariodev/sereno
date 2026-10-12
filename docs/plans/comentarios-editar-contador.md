# Plan: comentarios-editar-contador

**Objetivo:** las tarjetas del tablero muestran cuántos comentarios tiene cada tarea, al día en vivo, y en el panel de la
tarea se pueden editar y borrar comentarios propios (owner/admin borran cualquiera), con menciones resincronizadas.
Origen: M-1 y M-2 de `docs/plans/terminados/comentarios-tareas.md`.
**Estado:** en curso · Fase actual: 12


## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz del monorepo).
- API tareas: `TaskController` (`RELATIONS`; index, show, store, update, move y vecinas renumeradas), `TaskResource`,
  `TaskSnapshotEvent` (`TaskCreated`/`TaskUpdated`, carga `TaskController::RELATIONS`), `Task::unassignUser`
  (corre sin organización activa, `withoutGlobalScopes`).
- API comentarios: `TaskCommentController` (`RELATIONS`, `store` en transacción, `saveMentions` solo inserta),
  `TaskCommentPolicy` (viewAny, view, create), `StoreTaskCommentRequest`, `TaskCommentResource`, `TaskCommentCreated`
  (canal `organizations.{org}.projects.{project}`, `task.comment.created`, sin `toOthers`), `MentionTargets::resolve`,
  `AttachmentStorage`, `App\Actions\DeleteTask` (archivos borrados en `DB::afterCommit`).
- Patrón a imitar: edición y borrado de mensajes de chat (`MessagePolicy` update/delete, `UpdateMessageRequest`,
  `MessageController::update`, `App\Chat\MessageMentions::diff/sync`, `MessageDeletion`, `MessageEditor.vue`,
  `messageActions.ts`, confirmación en `ChannelView.vue`, etiqueta "editado" en `MessageItem.vue`).
- Web: `api/types.ts` (`Task`, `TaskComment`), `TaskCard.vue`, `stores/tasks.ts` (`upsert` con `isStale` por
  `updated_at`), `stores/taskComments.ts`, `api/taskComments.ts`, `realtime/echo.ts` (`subscribeToProject`,
  `validComment`), `views/PlanView.vue`, `components/TaskComments.vue`, `MarkdownEditor.vue` + `parseMentionDraft`.
- Tests de comentarios en `api/tests/Feature/TaskComments/` (L-64: comprobar el número listado por Pest).
- Las menciones de comentarios no tienen notificaciones ni `read_at`: resincronizar no emite eventos de mención.

## Fases

### [x] Fase 1 — `comments_count` en el recurso de tarea [riesgo]
- **Alcance:** `TaskResource` expone `comments_count` (`whenCounted`). Un único punto declara el conteo sin el scope
  global de `TaskComment` (seguro: la FK compuesta ata el comentario a su tarea) y lo usan index, show, store, update,
  move, las vecinas renumeradas, `Task::unassignUser` y, como respaldo, `TaskSnapshotEvent` (`loadCount` si falta).
- **Archivos:** `api/app/Http/Resources/TaskResource.php`, `api/app/Http/Controllers/Api/TaskController.php`,
  `api/app/Models/Task.php`, `api/app/Events/TaskSnapshotEvent.php`.
- **Terminado cuando:** tests en `TaskListApiTest`, `TaskBroadcastTest` y `TaskUnassignOnRemovalTest` comprueban el
  conteo correcto (también con comentarios de otra tarea y sin organización activa).

### [x] Fase 2 — Conteo en el evento de comentario creado
- **Alcance:** `TaskCommentCreated` lleva `comments_count` de la tarea, contado tras el commit (absoluto, no delta).
- **Archivos:** `api/app/Events/TaskCommentCreated.php`, `api/app/Http/Controllers/Api/TaskCommentController.php`.
- **Terminado cuando:** `TaskCommentBroadcastTest` comprueba el conteo en el payload.

### [x] Fase 3 — Contador en `TaskCard`
- **Alcance:** tipo `Task.comments_count`; `TaskCard` muestra icono y número solo si es mayor que 0, con etiqueta
  accesible traducida (en/es, plural).
- **Archivos:** `web/src/api/types.ts`, `web/src/components/TaskCard.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`.
- **Terminado cuando:** `TaskCard.spec.ts` cubre 0 (oculto), 1 y N.

### [x] Fase 4 — Contador en vivo desde los eventos de comentario
- **Alcance:** `echo.ts` valida y entrega `comments_count` del evento; el store de tareas aplica el valor absoluto a la
  tarea (`setCommentsCount`, sin tocar `updated_at`); `PlanView` lo conecta.
- **Archivos:** `web/src/realtime/echo.ts`, `web/src/stores/tasks.ts`, `web/src/views/PlanView.vue`.
- **Terminado cuando:** specs de echo, store de tareas y `PlanView` cubren que un comentario nuevo actualiza la tarjeta.

### [x] Fase 5 — `edited_at` en comentarios
- **Alcance:** migración con `task_comments.edited_at` (nullable, UTC), cast en el modelo, `edited_at` en
  `TaskCommentResource`; `database.md` actualizado (y corregida la referencia a `TaskComment::mentions()`, que no existe).
- **Archivos:** migración nueva, `api/app/Models/TaskComment.php`, `api/app/Http/Resources/TaskCommentResource.php`,
  `.claude/rules/database.md`.
- **Terminado cuando:** test del recurso devuelve `edited_at` null en un comentario nuevo; `migrate:fresh` limpio.

### [x] Fase 6 — Policy de editar y borrar
- **Alcance:** `TaskCommentPolicy::update` (solo el autor) y `delete` (autor, owner o admin); ambos exigen ver la tarea
  y la organización activa igual a la del comentario.
- **Archivos:** `api/app/Policies/TaskCommentPolicy.php`.
- **Terminado cuando:** `TaskCommentPolicyTest` cubre autor, otro miembro, admin, owner y otra organización.

### [x] Fase 7 — Editar el cuerpo con resincronización de menciones [riesgo]
- **Alcance:** `PATCH projects/{project}/tasks/{task}/comments/{comment}` (404 si no es de la tarea), cuerpo validado
  como en `store`; transacción con `lockForUpdate`; menciones sincronizadas (insertar nuevas, borrar quitadas) con
  `MentionTargets`; `edited_at` solo si el cuerpo cambió; evento `TaskCommentUpdated` (`task.comment.updated`).
- **Archivos:** `api/routes/api.php`, `api/app/Http/Requests/TaskComment/UpdateTaskCommentRequest.php`,
  `api/app/Http/Controllers/Api/TaskCommentController.php`, `api/app/Events/TaskCommentUpdated.php`.
- **Terminado cuando:** tests de editar (autor, ajeno 403, otra tarea 404, menciones agregadas y quitadas, sin cambios
  no marca `edited_at`) y del broadcast.

### [x] Fase 8 — Quitar adjuntos al editar [riesgo]
- **Alcance:** `remove_attachment_ids` (solo del mismo comentario) en el `PATCH`; borra las filas en la transacción,
  los archivos tras el commit; quitar un adjunto marca `edited_at`.
- **Archivos:** `UpdateTaskCommentRequest.php`, `TaskCommentController.php`.
- **Terminado cuando:** tests de quitar adjunto (archivo borrado tras commit, id ajeno rechazado, rollback no borra).

### [x] Fase 9 — Borrar comentarios [riesgo]
- **Alcance:** `DELETE .../comments/{comment}`: borrado físico (los comentarios no tienen respuestas), filas de
  menciones y adjuntos por cascada, archivos tras el commit; evento `TaskCommentDeleted`
  (`task.comment.deleted`, `{id, task_id, comments_count}`). Borrado concurrente: el segundo responde 404.
- **Archivos:** `api/routes/api.php`, `api/app/Http/Requests/TaskComment/DeleteTaskCommentRequest.php`,
  `TaskCommentController.php`, `api/app/Events/TaskCommentDeleted.php`.
- **Terminado cuando:** tests de borrar (autor, admin, ajeno 403, archivos borrados, conteo en el evento).

### [x] Fase 10 — Cliente y store de comentarios: editar y borrar
- **Alcance:** `TaskComment.edited_at`; `updateTaskComment` y `deleteTaskComment` en el cliente; `update(comment)`
  (descarta ediciones más viejas por `edited_at`) y `remove(id)` en el store, respetando `generation`.
- **Archivos:** `web/src/api/types.ts`, `web/src/api/taskComments.ts`, `web/src/stores/taskComments.ts`.
- **Terminado cuando:** specs del cliente y del store.

### [x] Fase 11 — Eventos en vivo de edición y borrado
- **Alcance:** `echo.ts` escucha `task.comment.updated` y `task.comment.deleted` (con validadores); `PlanView` los
  conecta al store de comentarios y el borrado también al contador de la tarea.
- **Archivos:** `web/src/realtime/echo.ts`, `web/src/views/PlanView.vue`.
- **Terminado cuando:** specs de echo y `PlanView`.

### [ ] Fase 12 — Editor en línea de comentarios [riesgo]
- **Alcance:** componente `TaskCommentEditor` (como `MessageEditor`: `MarkdownEditor` con
  `parseMentionDraft(comment.body, comment.mentions)`, marcar adjuntos para quitar, guardar, cancelar con Esc);
  `TaskComments` muestra "Editar" en los propios y la etiqueta "editado" con fecha.
- **Archivos:** `web/src/components/TaskCommentEditor.vue` (nuevo), `web/src/components/TaskComments.vue`,
  `web/src/i18n/en.json`, `web/src/i18n/es.json`.
- **Terminado cuando:** specs del editor (guardar, cancelar, menciones conservadas, quitar adjunto, error) y de
  `TaskComments` (botón solo en propios, etiqueta editado).

### [ ] Fase 13 — Borrar desde el panel
- **Alcance:** acción "Borrar" en propios y, para owner/admin, en todos; diálogo de confirmación (`AppDialog`); error
  visible con `AppFormError`.
- **Archivos:** `web/src/components/TaskComments.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`.
- **Terminado cuando:** specs de `TaskComments` (visibilidad por rol, confirmar, cancelar, error).

## Decisiones
- 2026-10-12 — Un solo plan para M-1 y M-2: el borrado cambia el contador y ambos tocan el recurso y los eventos.
- 2026-10-12 — Los eventos de comentario llevan `comments_count` absoluto contado tras el commit, y la web lo aplica
  tal cual (no suma ni resta: `TaskCommentCreated` llega también a quien envía). Una carrera entre eventos se corrige
  en la siguiente carga o al reconectar (`tasks.refresh()`).
- 2026-10-12 — El conteo no toca `tasks.updated_at`, para no alterar el orden ni el `isStale` del store de tareas.
- 2026-10-12 — Borrado físico de comentarios (sin respuestas que conservar), a diferencia del borrado blando del chat.
- 2026-10-12 — Editar: solo el autor. Borrar: autor, owner o admin. Las menciones de comentarios no notifican, así que
  resincronizar no emite eventos de mención.

## Notas para la próxima sesión
- Fase 1 hecha: el conteo se declara en `TaskController::counts()` (closure sin scopes globales); reutilizarlo en las fases 2 y 9.
- Fase 2 hecha: payload de `task.comment.created` = `{comment, comments_count}` (hermanos)...
- Fase 3 hecha: `Task.comments_count?` opcional en el tipo; TaskCard lo muestra si > 0.
- Fase 4 hecha: `onTaskCommentCreated(comment, commentsCount?)`; `tasks.setCommentsCount`. Contador en vivo completo (fases 1-4).
- Fase 5 hecha: `task_comments.edited_at` + recurso. Tras la migración, correr `php artisan migrate` en la base de desarrollo.
- Fase 6 hecha: `TaskCommentPolicy::update` (autor) y `delete` (autor, owner, admin); devuelven la respuesta de `inspect view` de la tarea (404 sin acceso).
- Fase 7 hecha: PATCH comentarios; `syncMentions($comment,$task,$authorId,?$currentIds)` sin eventos; `TaskCommentUpdated` `{comment}`. `UpdateTaskCommentRequest` exige `body`: en la fase 8 revisar el caso de comentario sin texto al quitar adjuntos.
- Fase 8 hecha: `remove_attachment_ids` en el PATCH; body sigue obligatorio (igual que store); archivos borrados en afterCommit con try/report (patrón reutilizable en fase 9).
- Fase 9 hecha (API completo): DELETE comentarios, evento `task.comment.deleted` `{id, task_id, comments_count}` (la web valida los tres como number).
- Fase 10 hecha: `updateTaskComment`/`deleteTaskComment`; store `update(comment)` (descarta si el conocido tiene edición más nueva o el entrante no trae `edited_at`) y `remove(id)`. `validComment` no exige `edited_at`: la fase 11 debe exigirlo (string|null).
- Fase 11 hecha: echo escucha `task.comment.updated` y `task.comment.deleted`; `validComment` exige `edited_at`. Faltan solo las fases de UI (12 editor, 13 borrar).

## Mejoras propuestas
- [ ] M-1: `docs/lecciones.md` tiene L-37 a L-40 repetidas (líneas ~50-57); quitar el duplicado. Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [ ] M-2: Test de `max_per_message` y exclusión del autor en la edición de comentarios; acortar los PHPDoc de `syncMentions` y `update`. Complejidad: baja · Archivos: 2 · sin riesgo → sonnet
- [ ] M-3: `TaskCommentController`: quitar el `isEmpty()` redundante de `deleteFilesAfterCommit` y aclarar el comentario de `destroy`; comentario de una línea en el test de rollback (DDL transaccional). Complejidad: baja · Archivos: 2 · sin riesgo → sonnet
