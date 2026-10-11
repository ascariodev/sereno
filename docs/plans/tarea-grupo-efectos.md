# Plan: tarea-grupo-efectos

**Objetivo:** en los proyectos que lo activen, mover a Hecho una tarea creada desde un aviso resuelve su grupo de log, y
si ese grupo se reabre con la tarea en Hecho se avisa en el canal del proyecto. Origen: plan-tareas M-5 (y canales M-19).
**Estado:** en curso · Fase actual: 3
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (los commits van con `git` en la raíz del monorepo).
- Relación: `tasks.log_group_id` es nullable, con FK `nullOnDelete` y único parcial, así que un grupo tiene 0 o 1 tarea.
  `LogGroup::task()` es hasOne y `Task::logGroup()` belongsTo. `TaskStatus`: todo|in_progress|in_review|done.
  `LogGroupStatus`: open|resolved|ignored.
- Estado de la tarea: lo cambia `TaskController::move` (`MoveTaskRequest`). Bloquea el proyecto (`lockActiveProject`), la
  tarea y la columna `FOR UPDATE`, y emite `TaskUpdated` (`TaskSnapshotEvent`) por `organizations.{org}.projects.{project}`.
- Estado del grupo:
  - Manual: `LogGroupController::update` (PATCH `status`). En transacción, `save()` y luego el privado
    `postStatusNotice` (`:121`), que publica un mensaje de sistema `log.group_status_changed` {log_group_id, title,
    status, previous_status}, solo si el proyecto tiene canal activo. No emite evento de dominio.
  - Automático: `App\Support\LogEventRecorder::upsertGroup` (ingesta). `ON CONFLICT` pasa `resolved` a `open` (no
    `ignored`) y `dispatchStatusEvent` lanza `LogGroupReopened` (`ShouldDispatchAfterCommit`). El listener en cola
    `App\Listeners\PostLogGroupNotice` (tries=1, sin organización activa, `withoutGlobalScopes`) publica
    `log.group_reopened`.
- Permisos: `TaskPolicy` move y `LogGroupPolicy` update son ambos `view` (acceso al proyecto). Un proyecto archivado da 422.
- Ajustes: `projects` no tiene ninguno. Hay `PATCH /api/projects/{project}` con `ProjectRequest` (revisar quién puede).
  La web no tiene hoy ningún lugar donde editar un proyecto.
- Web: `useLogGroupStatuses` reconoce solo `log.group_status_changed` y `task.created_from_group`
  (desde `stores/messages.ts`). `SystemNotice.vue` pinta los avisos, con guards en `api/types.ts` (L-13).
- Tests: `TaskMoveApiTest`, `TaskMoveConcurrencyTest`, `LogGroupApiTest`, `LogGroupTaskApiTest`,
  `PostLogGroupNoticeTest`, `LogEventRecorderTest`; web `SystemNotice.spec`, `messages.spec`, `PlanView.spec`.

## Fases

### [x] Fase 1 — Ajuste por proyecto
- **Alcance:**
  - Migración con columna `projects.tasks_resolve_log_groups` boolean not null default false.
  - Cast en `Project`, campo en `ProjectResource` y validación `boolean` en `ProjectRequest`, solo en update.
  - Quién puede cambiarlo: lo mismo que hoy edita el proyecto (verificar la policy; si un member puede editar, decidir y
    anotar en Decisiones).
  - Documentar en `.claude/rules/database.md`.
- **Archivos:** migración nueva, `api/app/Models/Project.php`, `api/app/Http/Resources/ProjectResource.php`,
  `api/app/Http/Requests/Project/ProjectRequest.php`, `.claude/rules/database.md`.
- **Terminado cuando:**
  - Un test cubre el default false en el resource, el PATCH que lo activa y lo desactiva, el 422 con un no booleano y la
    autorización según la policy.
  - Pasan `ProjectApiTest` (o el que cubra proyectos) y pint.

### [x] Fase 2 — Aviso de estado del grupo compartido (canales M-19)
- **Alcance:**
  - Sacar `postStatusNotice` de `LogGroupController` a una acción (p. ej. `App\Actions\PostLogGroupStatusNotice`) que
    reciba el grupo, el estado previo y el actor.
  - `LogGroupController::update` la usa. Sin cambio de comportamiento.
- **Archivos:** `api/app/Http/Controllers/Api/LogGroupController.php`, la acción nueva.
- **Terminado cuando:** `LogGroupApiTest` y `LogGroupTaskApiTest` pasan sin cambios, y pint.

### [ ] Fase 3 — Hecho resuelve el grupo [riesgo]
- **Alcance:**
  - En `TaskController::move`, dentro de la transacción: si el proyecto tiene el ajuste, la tarea pasa de otro estado a
    `done` y su grupo está `open`, el grupo pasa a `resolved` y se publica `log.group_status_changed` con la acción de
    la fase 2 (actor = quien mueve).
  - Un grupo `ignored` o `resolved` no se toca. Mover dentro de Hecho, o sacar la tarea de Hecho, no toca el grupo
    (decisión del usuario: sin efecto inverso).
  - Riesgo: carrera con la ingesta, que reabre el grupo en paralelo. El grupo se bloquea `FOR UPDATE` en un orden fijo
    respecto de los bloqueos actuales, y se revisa `TaskMoveConcurrencyTest` (L-41).
- **Archivos:** `api/app/Http/Controllers/Api/TaskController.php` (o una acción si `move` crece), `MoveTaskRequest` si
  hace falta.
- **Terminado cuando:**
  - Un test nuevo cubre: con el ajuste, Hecho resuelve y publica el aviso; sin el ajuste, no; un grupo ignorado o
    resuelto no cambia; tarea sin grupo; mover dentro de Hecho no publica; sacar de Hecho no reabre.
  - Pasan `TaskMoveApiTest`, `TaskMoveConcurrencyTest` y `LogGroupApiTest`.
  - La suite completa del API pasa (L-49).

### [ ] Fase 4 — Aviso en el canal al reabrir un grupo con tarea en Hecho
- **Alcance:**
  - Acción que, si el proyecto tiene el ajuste y el grupo tiene tarea en `done`, publica un mensaje de sistema
    `task.group_reopened` {log_group_id, task_id, task_key} en el canal activo del proyecto. Solo ids y valores planos.
  - La llaman un listener nuevo en cola de `LogGroupReopened` (reapertura por ingesta; la condición se evalúa en el
    worker, L-42) y `LogGroupController::update` cuando pasa de `resolved` a `open` (reapertura manual).
  - Sin bucle: el aviso no cambia ni la tarea ni el grupo.
- **Archivos:** la acción nueva, el listener nuevo, `api/app/Http/Controllers/Api/LogGroupController.php`.
- **Terminado cuando:**
  - Tests cubren: reapertura por ingesta con tarea en Hecho y el ajuste (aviso); sin el ajuste o con la tarea en otro
    estado (nada); reapertura manual (aviso); proyecto sin canal activo (nada, sin error); y el payload exacto.
  - Pasan `PostLogGroupNoticeTest`, `LogEventRecorderTest` y `LogGroupApiTest`.

### [ ] Fase 5 — Pintar el aviso de reapertura en la web
- **Alcance:**
  - Guard `isTaskGroupReopenedPayload`, que valida la forma de los campos (L-13).
  - `SystemNotice` pinta "Se reabrió el grupo de la tarea PRJ-12", con chip a la tarea (como `task.created_from_group`).
  - Textos en en y es.
- **Archivos:** `web/src/api/types.ts`, `web/src/components/SystemNotice.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`.
- **Terminado cuando:** `SystemNotice.spec` cubre el aviso válido, el payload mal formado (cae al genérico) y el chip con
  su ruta. Pasan `messages.spec` y `vue-tsc -b`.

### [ ] Fase 6 — Interruptor del ajuste en la web [riesgo]
- **Alcance:**
  - Campo en el tipo `Project`, `updateProject` en el cliente y un interruptor visible para quien puede editar el
    proyecto, con estado de carga, error con toast y valor que se refleja en el store de proyectos.
  - Riesgo: no hay pantalla de ajustes del proyecto. Propuesta: en la cabecera de `PlanView`, junto al título. Confirmar
    con el usuario antes de implementar si se prefiere otro lugar.
- **Archivos:** `web/src/api/types.ts`, `web/src/api/projects.ts`, `web/src/views/PlanView.vue` (o el componente
  elegido), `web/src/i18n/en.json`, `web/src/i18n/es.json`.
- **Terminado cuando:**
  - Specs cubren mostrarlo u ocultarlo según el permiso, el cambio con éxito, el error que revierte, y el store
    actualizado.
  - `vue-tsc -b` limpio.
  - Verificación en el navegador: activar el ajuste, mover una tarea creada desde un aviso a Hecho y ver el grupo
    resuelto en el canal.

## Decisiones
- 2026-10-11 (usuario): el ajuste es por proyecto (columna en `projects`), desactivado por defecto.
- 2026-10-11 (usuario): al reabrirse un grupo con tarea en Hecho, solo se avisa con un mensaje de sistema en el canal; la
  tarea no se mueve ni se marca.
- 2026-10-11 (usuario): sin efecto inverso. Resolver el grupo no mueve la tarea y sacar la tarea de Hecho no reabre el
  grupo.
- 2026-10-11: la fase 2 resuelve canales M-19 (sacar `postStatusNotice` a una acción), que ahora sí tiene un segundo
  punto de uso.
- 2026-10-11 (fase 1): el ajuste lo cambia quien pasa `ProjectPolicy::update` (owner y admin; un member recibe 403).
  Se valida `sometimes|boolean` solo en update (en create se ignora). `Project` lo tiene en Fillable y con
  `$attributes` default false, para que el POST devuelva false sin recargar.
- 2026-10-11: el trabajo va en el worktree `feat/tarea-grupo-efectos`. Como los contenedores montan el checkout
  principal, los tests del API se corren con `.claude/worktrees/t.sh` (contenedor desechable con el api del worktree).

## Notas para la próxima sesión
- Seguir con la fase 3. La acción es `App\Actions\PostLogGroupStatusNotice::__invoke(LogGroup $group, LogGroupStatus $previousStatus, User $actor)` (se resuelve con `app()` o por inyección). La web (fase 6) muestra el interruptor solo a owner/admin. Leer `docs/lecciones.md` (L-41 concurrencia, L-42 condiciones en el worker, L-49 suite completa
  al tocar accesos o transacciones, L-13 guards de payload).

## Mejoras propuestas
