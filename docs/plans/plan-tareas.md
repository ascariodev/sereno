# Plan: plan-tareas

**Objetivo:** paso 7 del MVP: tareas por proyecto en un tablero de 4 columnas (vista Plan), con detalle, asignado,
movimiento entre columnas, cambios en vivo, y crear una tarea desde un aviso de log (panel del grupo y tarjeta del canal).
**Estado:** en curso · Fase actual: 15
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps: `api/` (fases 1 a 11) y `web/` (fases 12 a 26). Commits con `git` en la raíz.
- Diseño: `docs/diseno/calma/Plan.dc.html` (tablero: columnas Por hacer, En curso, En revisión, Hecho con punto de
  color; tarjeta con chip del aviso de origen, título, clave `POSVE-14`, avatar del asignado; filtros Todas, Mías,
  Desde avisos; botones "Nueva tarea" y "Agregar tarea" por columna). `Main.dc.html` 182-185 y 315-318 ("Crear
  tarea" en la tarjeta de aviso y en el aside del grupo), `Logs.dc.html` 181-186 (chip de la tarea en la tabla de
  grupos), `Mobile.dc.html` 66-70. No hay diseño de detalle de tarea, prioridad, etiquetas ni fechas.
- API, patrones a copiar: `LogGroup` (traits `BelongsToOrganization` y `EnsuresProjectInOrganization`, enum con CHECK),
  `LogGroupPolicy`, `UpdateLogGroupRequest` (autoriza antes de validar, L-04), `LogGroupController@update` (abort 404
  si el grupo no es del proyecto), `StoreMessageRequest::after()` (contenedor archivado), `MessageCreated`
  (`ShouldBroadcast` + `ShouldDispatchAfterCommit`, resource resuelto en el constructor), `ChannelChannel` (autoriza
  canal privado sin tenant activo). `Project` no tiene contador de tareas; su `updating` bloquea el cambio de
  organización si tiene fuentes o grupos. Los grupos se borran por retención (`log:maintain`).
  Rutas bajo `['auth:sanctum','organization']`, estilo `projects/{project}/log-groups/{group}`.
- Web: `router/index.ts` (hijos de `AppLayout`), `ProjectHeader.vue` (pestañas como `RouterLink`, slot `actions`),
  `AppSidebar.vue` (`activeProjectId`), `CommandPalette.vue`, `LogView.vue` (tabla de grupos), `LogGroupPanel.vue`
  (acciones Resolver/Ignorar), `LogGroupAside.vue`, `SystemNotice.vue`, `ChannelView.vue` (paneles por query
  `?group=`), `stores/memberDirectory.ts` (miembros con TTL), `stores/messages.ts` (patrón de generación e
  inserción en vivo), `realtime/echo.ts` (sin canal de proyecto; `leaveOrganization` recorre por prefijo),
  `components/ui/*` (AppDialog, AppMenu, AppSegmented, AppAvatar, ProjectKey, LevelPill, StatusPill), `style.css`
  (tokens; nada de hex del diseño en componentes). Sin librería de drag and drop.
- Helpers globales de Pest ya ocupados (L-29): `grep -rhoE '^function [a-zA-Z]+' api/tests | sort -u`.

## Fases

### API

### [x] Fase 1 — Esquema de tareas (api) [límite: 5 archivos]
- **Alcance:** migración con `projects.last_task_number` (int, default 0) y la tabla `tasks`: organization_id y
  project_id (FK `cascadeOnDelete`), number int, title string(200), description text nullable, status string
  (CHECK `tasks_status_check`: `todo|in_progress|in_review|done`, default `todo`), position double precision,
  assignee_id y created_by nullable (FK users `nullOnDelete`), log_group_id nullable (FK log_groups `nullOnDelete`),
  timestamps. Único `(project_id, number)`; único parcial `log_group_id WHERE log_group_id IS NOT NULL` (una tarea
  por aviso); índice `(project_id, status, position)`; índice por organization_id. Modelo `Task` con los dos traits,
  enum `TaskStatus` con orden de columnas, `key()` compuesta `{project.key}-{number}`; ids y number fuera de
  Fillable. `Project`: `tasks()` y su guarda `updating` también cuenta tareas. Actualizar `database.md`.
- **Archivos:** migración nueva, `api/app/Models/Task.php`, `api/app/Enums/TaskStatus.php`,
  `api/app/Models/Project.php`, `.claude/rules/database.md`.
- **Terminado cuando:** `TaskTest`: CHECK de status rechaza un valor fuera del enum; número repetido en el mismo
  proyecto falla y en otro proyecto no; dos tareas con el mismo `log_group_id` fallan; borrar el grupo deja la tarea
  con `log_group_id` null; una tarea con proyecto de otra organización la rechaza el modelo; `migrate:fresh` corre.

### [x] Fase 2 — Policy de tareas (api)
- **Alcance:** `TaskPolicy`: `viewAny`, `view`, `create`, `update` para cualquier rol de la organización activa;
  `delete` para el creador, admin u owner. Siempre exige que la tarea sea de la organización activa. El proyecto
  archivado lo rechazan los FormRequest de las fases siguientes.
- **Archivos:** `api/app/Policies/TaskPolicy.php`.
- **Terminado cuando:** test con `Gate::forUser(...)` por rol y caso: miembro crea y edita; miembro no creador no
  borra; admin y owner sí; alguien de otra organización no ve ni edita.

### [x] Fase 3 — Listar las tareas de un proyecto (api)
- `GET projects/{project}/tasks` (todas, ordenadas por columna y `position`), `TaskResource` (`key`, `number`,
  campos, `assignee {id,name}`, `log_group {id, level, title, status, events_count}` o null). Aislamiento.

### [x] Fase 4 — Crear una tarea (api) [riesgo]
- `POST projects/{project}/tasks` con `StoreTaskRequest` (título, descripción, asignado miembro de la organización,
  status, `log_group_id` del proyecto sin tarea previa; proyecto archivado 422). Número con
  `UPDATE projects SET last_task_number = last_task_number + 1 ... RETURNING` en la transacción; `position` al final
  de la columna. Textos en `lang`. Test de números consecutivos y de grupo con tarea.

### [x] Fase 5 — Editar una tarea (api)
- `PATCH projects/{project}/tasks/{task}` (título, descripción, asignado) con `UpdateTaskRequest`; 404 si la tarea
  no es del proyecto; proyecto archivado 422.

### [x] Fase 6 — Mover una tarea (api) [riesgo]
- `POST projects/{project}/tasks/{task}/move` con `status` y `before_id`/`after_id` opcionales: calcula `position`
  entre vecinos de la columna destino (bloqueando las filas), renumera la columna si el hueco es demasiado chico.

### [x] Fase 7 — Borrar una tarea (api)
- `DELETE projects/{project}/tasks/{task}` (policy `delete`, proyecto archivado 422), borrado físico.

### [x] Fase 8 — Tarea vinculada en el grupo de log (api)
- `LogGroupResource` agrega `task {id, key, status}` o null, con carga eficiente en la lista y el detalle de grupos.

### [x] Fase 9 — Quitar un miembro desasigna sus tareas (api)
- Al quitar a alguien de la organización, sus tareas de esa organización quedan sin asignado (misma transacción que
  la baja). Test.

### [x] Fase 10 — Canal privado del proyecto (api)
- `organizations.{organization}.projects.{project}` en `routes/channels.php` con su clase de autorización (miembro y
  proyecto de esa organización, sin tenant activo), como `ChannelChannel`. Test en `BroadcastingAuthTest` o propio.

### [x] Fase 11 — Eventos en vivo de tareas (api)
- `TaskCreated`, `TaskUpdated` (incluye movimientos) y `TaskDeleted` en el canal del proyecto, tras el commit, con el
  resource resuelto (L-37 para lo que cargue) y la condición de entrega en `broadcastOn()` si hace falta (L-42).

### Web

### [x] Fase 12 — Tipos y API de tareas (web)
- Tipo `Task` según `TaskResource` (L-09), `api/tasks.ts` (listar, crear, editar, mover, borrar), `LogGroup.task`.

### [x] Fase 13 — Store de tareas (web) [riesgo]
- `stores/tasks.ts`: carga por proyecto con generación (L-10), columnas ordenadas, acciones que aplican la respuesta
  del API, `insert`/`replace`/`remove` para eventos en vivo e idempotentes con la respuesta propia, filtros Todas,
  Mías y Desde avisos.

### [x] Fase 14 — Ruta y pestaña Plan (web) [límite: 5 archivos]
- Ruta `projects/:projectId/plan` con `PlanView` (cabecera y estado de carga), pestaña Plan en `ProjectHeader`, i18n.

### [ ] Fase 15 — Plan en la barra lateral y la paleta (web)
- `AppSidebar` reconoce la ruta para el proyecto activo; `CommandPalette` agrega "Plan" por proyecto.

### [ ] Fase 16 — Tablero de solo lectura (web) [límite: 5 archivos]
- Cuatro columnas con contador y `TaskCard` (chip del aviso con nivel, título, clave, avatar); tokens de color de
  columna en `style.css` (claro y oscuro); vacío por columna; i18n.

### [ ] Fase 17 — Filtros del tablero (web)
- Chips Todas, Mías y Desde avisos (`aria-pressed`), recordados en la query.

### [ ] Fase 18 — Crear tarea desde el tablero (web)
- Diálogo `TaskCreateDialog` (título, descripción, asignado desde `memberDirectory`) desde "Nueva tarea" y "Agregar
  tarea" de cada columna; errores 422/429; foco al cerrar.

### [ ] Fase 19 — Panel de detalle de la tarea (web)
- `?task=<id>` abre `TaskAside` (hoja en móvil): editar título, descripción y asignado; enlace al aviso de origen.

### [ ] Fase 20 — Borrar una tarea (web)
- Acción en el panel con confirmación, según la policy; cierra el panel.

### [ ] Fase 21 — Mover con menú (web)
- "Mover a" en la tarjeta y en el panel (accesible por teclado), con la columna y la posición resultantes.

### [ ] Fase 22 — Arrastrar y soltar (web) [riesgo]
- HTML5 drag and drop entre y dentro de columnas con indicador de destino; sin dependencia nueva; el menú de la
  fase 21 queda como alternativa en táctil y teclado.

### [ ] Fase 23 — Tablero en vivo (web)
- `subscribeToProject` en `echo.ts` (conteo de referencias, L-28; incluido en `leaveOrganization`), `PlanView` aplica
  los eventos y recarga al reconectar.

### [ ] Fase 24 — Crear tarea desde el panel del grupo (web) [límite: 5 archivos]
- "Crear tarea" en `LogGroupPanel` (diálogo prellenado con el título del grupo y `log_group_id`); si ya tiene tarea,
  enlace "Ver POSVE-12" al tablero con `?task=`.

### [ ] Fase 25 — Crear tarea desde la tarjeta de aviso (web)
- Botón "Crear tarea" en `SystemNotice` (opened/reopened) que abre el mismo diálogo desde `ChannelView`; si el grupo
  ya tiene tarea, el 422 lleva al enlace de la existente.

### [ ] Fase 26 — Tarea en la tabla de grupos (web)
- Chip con la clave de la tarea bajo el título del grupo en `LogView`, enlazado al tablero. Al terminar, marcar el
  paso 7 en `CLAUDE.md`.

## Decisiones
- 2026-10-10 — Fase 1: `Task` deja en Fillable `title`, `description`, `status` y `position`; ids y `number` fuera.
  La guarda `updating` de `Project` también bloquea el cambio de organización si hay tareas.
- 2026-10-10 — Cuatro estados fijos (`todo`, `in_progress`, `in_review`, `done`) como enum con CHECK, sin columnas
  configurables. Motivo: es lo que muestra el diseño y basta para el MVP.
- 2026-10-10 — Número por proyecto con `projects.last_task_number` y `UPDATE ... RETURNING`; la tarea guarda solo
  `number` y la clave se compone con la `key` actual del proyecto. Motivo: atómico sin tabla de secuencias y sin
  claves desfasadas si la `key` cambia.
- 2026-10-10 — Orden manual con `position` (double precision) entre vecinos, renumerando la columna si el hueco se
  agota. Drag and drop con HTML5 nativo más menú "Mover a" accesible, sin dependencia nueva.
- 2026-10-10 — Una tarea por aviso (único parcial en `log_group_id`, `nullOnDelete` porque la retención borra
  grupos). Sin efectos cruzados en el MVP: mover a Hecho no resuelve el grupo ni reabrirlo toca la tarea.
- 2026-10-10 — Campos del MVP: título, descripción en texto plano, un asignado, estado y aviso de origen. Sin
  prioridad, etiquetas, fechas ni comentarios (sin diseño). Cualquier miembro crea, edita y mueve; borra el creador,
  admin u owner; un proyecto archivado es de solo lectura. Borrado físico.
- 2026-10-10 — Tiempo real con un canal privado por proyecto (`organizations.{org}.projects.{project}`). El tablero
  carga todas las tareas del proyecto sin paginar; los filtros se aplican en el cliente.
- 2026-10-10 — Fase 3: `TaskResource` expone `id`, `project_id`, `key`, `number`, `title`, `description`, `status`,
  `position`, `created_by`, `created_at`, `updated_at`, y `assignee`/`log_group` con `whenLoaded`: toda respuesta con
  una tarea (fases 4 a 6 y eventos de la 11) carga `assignee` y `logGroup` como `index` y fija `project` con
  `setRelation` para `key()`.
- 2026-10-10 — Fase 4: descripción de 10000 caracteres como máximo (`StoreTaskRequest::DESCRIPTION_MAX_LENGTH`) y
  título y descripción rechazan `\x00`; la fase 5 reutiliza ambas reglas. Si dos peticiones vinculan el mismo grupo,
  la `UniqueConstraintViolationException` se convierte en 422 sobre `log_group_id` con el texto de la validación.
  `TaskController::RELATIONS` es lo que carga toda respuesta con una tarea.
- 2026-10-10 — Fase 6: en `move`, `after_id` es la tarea que queda justo arriba y `before_id` la de justo abajo; con
  los dos deben ser contiguos en la columna destino (sin contar la movida). Sin vecinos va al final; columna vacía,
  1. Al inicio queda `next - 1`, así que `position` puede ser cero o negativa. Bloqueos: proyecto `FOR NO KEY UPDATE`
  y luego tarea y columna destino `FOR UPDATE`; un vecino que no está en la columna da 422. Con hueco <= 1e-9 la
  columna se renumera 1, 2, 3... con `DB::table` (sin tocar `updated_at` de las demás).
- 2026-10-10 — Fase 9: `Organization::removeMember` (único camino de baja) desasigna con `DB::table('tasks')` en la
  transacción de `mutateMembership`, sin eventos de modelo: esas desasignaciones no emiten `TaskUpdated` en vivo
  (el tablero las ve al recargar).
- 2026-10-10 — Fase 11, contrato en vivo: canal privado `organizations.{org}.projects.{project}`, eventos
  `.task.created` y `.task.updated` con `{ task: TaskResource }` (mover emite `task.updated`) y `.task.deleted` con
  `{ id, project_id }`. Sin `toOthers()`: quien actúa recibe su propio evento (la web aplica de forma idempotente).
  Un update sin cambios también emite. La renumeración de columna en `move` (muy rara, hueco <= 1e-9) no emite
  eventos para las demás tareas: la web tolera posiciones desfasadas y se corrige al recargar.
- 2026-10-10 — Fase 13, `useTasksStore`: gana la versión con `updated_at` mayor (microsegundos) y en empate la que
  llega; ids borrados recordados (`MAX_TOMBSTONES` = 500) para que nada los resucite; al recargar se descartan las que
  estaban y no vienen y se conservan las llegadas en vivo; sin actualización optimista. `error` solo si el proyecto
  nunca cargó bien; luego un `refresh()` fallido conserva la lista. `open()` del proyecto ya abierto solo recarga y
  no invalida las acciones en vuelo. Las fases 21 y 22 calculan `afterId`/`beforeId` sobre `columns`, nunca sobre
  `visibleColumns` (el API exige vecinos contiguos en la columna completa).
- 2026-10-10 — Fase 14: ruta `project-plan` (`projects/:projectId/plan`), pestañas Canal, Plan, Log; i18n bajo
  `plan.*`. Los límites de archivos de las fases cuentan solo código de producción, no specs.

## Notas para la próxima sesión
- API terminado (fases 1 a 11). Web: fase 14 hecha (`PlanView` abre el store por `projectId`, `clear()` al
  desmontar; un spec que monte `ProjectHeader` con router propio registra `project-plan`). Fase 13: `useTasksStore` con `open`, `refresh` (reconexión), `clear`,
  `columns`, `visibleColumns`, `filter` (`all|mine|from_notices`, no lo reinicia `clear`), `find`, `insert`/`replace`/
  `remove` (eventos), `create`/`update`/`move`/`destroy` (lanzan `ApiError`, devuelven la tarea). Fase 12 (`api/types.ts` con `Task`, `TASK_STATUSES` en orden de
  columnas, `isTaskStatus` para validar eventos, L-13; `api/tasks.ts` con parámetros en camelCase). Trampa de tests: una tarea creada a mano debe
  subir `projects.last_task_number`, o el store choca con `(project_id, number)` y da un 422 engañoso.
  Fases 1 a 10: Helpers de la 9: `removalTask`, `assigneeOf`; de la 10: `projectChannelName`
  (BroadcastingAuthTest). Canal: `ProjectChannel` en `organizations.{organization}.projects.{project}`. `LogGroupResource` trae `task` con `whenLoaded`: todo lugar que lo devuelva (hoy solo
  `LogGroupController`; si la fase 11 lo usa en un evento) carga `task` y llama `bindTaskProject`. graphify no está
  instalado en la nube: usar grep. Helpers de la 8: `groupTaskUrl`, `groupTaskGet`. Helpers de test: `columnTask`, `moveTaskAs`, `movedColumn` (fase 6),
  `deleteTaskAs` (fase 7). Tras una petición el tenant queda en su organización: los tests consultan con
  `Task::withoutGlobalScopes()`. Los archivos creados desde el contenedor quedan de root y pint no puede escribirlos:
  `chown ubuntu:ubuntu` en el host antes de pint. Las fases 6 y 7 copian el patrón de `UpdateTaskRequest`
  (policy en `authorize()`, proyecto archivado en `after()`, 404 en el controlador). Helpers de test ocupados: `makeTask` (TaskTest), `taskPolicyTask` (TaskPolicyTest),
  `seedListedTask` (TaskListApiTest), `storeTaskAs` y `storedTasks` (TaskStoreApiTest). Fechas de `TaskResource` sin verificar con tinker: confirmarlas en la fase 12.
  Los FormRequest de las fases 4 a 7 rechazan el proyecto archivado (la policy no lo hace). `Task` no tiene factory: los tests usan el helper global `makeTask` (`TaskTest`); crear
  `TaskFactory` si las fases siguientes lo necesitan. `Task::key()` carga `project` perezoso: `with('project')` en
  listados (fase 3).

## Mejoras propuestas
- [ ] M-1 (media, sonnet): mensaje de sistema en el canal al crear una tarea desde un aviso, y chip "Tarea POSVE-12"
  en la tarjeta del aviso.
- [ ] M-2 (alta, plan nuevo): comentarios en las tareas (contador del diseño).
- [ ] M-3 (media, sonnet): avisar al asignado por `users.{id}` (solo ids, L-38).
- [ ] M-4 (media, sonnet): paginar o limitar la columna Hecho si crece.
- [ ] M-5 (media, sonnet): efectos cruzados opcionales entre tarea y grupo (Hecho resuelve, reabierto avisa).
- [ ] M-6 (baja, sonnet): test de `TaskPolicy` sin organización activa (falla cerrada en `viewAny` y `create`).
- [ ] M-7 (baja, sonnet): orden por columna de `TaskController@index` con `orderByRaw` y bindings o un helper en `TaskStatus`, en vez de interpolar el `CASE`.
- [ ] M-8 (baja, sonnet): `TaskStoreApiTest`: caso de `assignee_id` inexistente, separar 404 y 403 en dos `it`, query log
  desactivado en `finally` y `Task::flushEventListeners()` explícito; `taskStatus()` con `$this->enum(...)`.
- [ ] M-9 (baja, sonnet): crear, editar y mover revalidan dentro de la transacción que el proyecto no esté archivado
  (carrera entre validar y archivar).
- [ ] M-11 (baja, sonnet): `TaskMoveApiTest`: fijar el locale en el test que afirma `validation.not_in` y
  `validation.different`; test de concurrencia real de `move` (L-41) en vez del query log.
- [ ] M-10 (baja, sonnet): `DESCRIPTION_MAX_LENGTH` a `Task` junto a `TITLE_MAX_LENGTH`; `assignee_id` en Fillable para
  simplificar `TaskController@update`; 404 de tarea de otro proyecto antes de validar.
- [ ] M-12 (baja, sonnet): `LogGroupTaskApiTest`: quitar el umbral arbitrario `toBeLessThan(12)`; basta el conteo
  constante.
- [ ] M-13 (media, sonnet): avisar en vivo al tablero de las tareas desasignadas al quitar un miembro (evento por
  proyecto afectado tras el commit).
- [ ] M-14 (baja, sonnet): extraer `positiveId` (duplicado en `ProjectChannel` y `ChannelChannel`) a un helper
  compartido; en `BroadcastingAuthTest`, el proyecto del canal en el `beforeEach`.
- [ ] M-15 (media, sonnet): `renumberColumn` emite `task.updated` por cada tarea renumerada (o un evento de columna),
  para que el tablero en vivo no quede desfasado.
- [ ] M-16 (baja, sonnet): el `catch (UniqueConstraintViolationException)` de `TaskController@store` solo traduce a 422
  la violación de `tasks_log_group_id_unique` y relanza las demás.
- [ ] M-17 (baja, sonnet): base común para `TaskCreated` y `TaskUpdated`; test de que un delete con 404 o 403 no
  emite `TaskDeleted`.
- [ ] M-18 (baja, sonnet): `TaskLogGroup.level` con el tipo de nivel de log existente; `createTask` arma el cuerpo
  solo con los campos definidos, como `updateTask`.
- [ ] M-19 (baja, sonnet): `tasks` store: `destroy` quita la tarea si el API responde 404; con "Mías" y sin usuario
  cargado, decidir qué mostrar; guard en vez de `as number` al olvidar el tombstone más viejo.
- [ ] M-20 (baja, sonnet): `PlanView.spec`: test del cambio de organización; orden de imports de iconos en
  `ProjectHeader.vue`.
