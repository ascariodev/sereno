# Plan: acceso-proyectos

**Objetivo:** membresía por proyecto: owner y admin ven toda la organización; un `member` solo ve los proyectos
asignados (y sus canales, mensajes, tareas, logs, menciones y realtime), se asignan desde la web y al invitar.
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz).
- Hoy todo se filtra solo por organización (`BelongsToOrganization` + `OrganizationScope`); no existe membresía por
  proyecto. Las policies repiten `belongsToActiveOrganization`/`canManage` como métodos privados, sin helper común.
- Recursos de proyecto: directos `channels` (`project_id` nullable, en la práctica siempre lleno), `tasks`,
  `log_sources`, `log_groups`, `log_events`; indirectos por canal: `messages`, `message_mentions`, `message_attachments`.
- Las rutas anidadas `projects/{project}/...` (tareas, log groups, fuentes) solo autorizan `viewAny` del hijo: el
  binding de `{project}` protege entre organizaciones, no dentro de una.
- Los FormRequests de `app/Http/Requests/Channel/*` (mensajes, hilos, adjuntos) autorizan con `Gate view` del canal:
  heredan el cambio de `ChannelPolicy`.
- Broadcasting: `ChannelChannel` (`organizations.{org}.channels.{channel}`) y `ProjectChannel`
  (`organizations.{org}.projects.{project}`) se autorizan sin `X-Organization-Id`: no hay team de spatie activo
  (leer roles fijando el team en `try/finally`, L-03). Reverb autoriza solo al suscribirse.
- `Organization::removeMember` ya desasigna tareas, emite `MembershipRevoked` y corta sockets
  (`TerminateUserConnections`, 5 s): patrón a imitar.
- Web: cualquier 403 con organización dispara `handleForbidden` (recarga organizaciones); por eso lo inaccesible da 404.
- Lecciones clave: L-03, L-04, L-08, L-29, L-34, L-36, L-38 (eventos a `users.{id}` solo con ids), L-42
  (condición de entrega en `broadcastOn()`). Migraciones: `.claude/rules/database.md`.

## Fases

### [x] Fase 1 — Limpieza de mejoras obsoletas y estado del MVP
- **Alcance:** marcar como resueltas `nucleo` M-21 (`trustProxies` ya en `api/bootstrap/app.php`), `corte-realtime`
  M-1 (resuelta por el plan `corte-forzado`) e `invitaciones-web` M-1 (resuelta por `miembros`), con la referencia;
  en `CLAUDE.md`, paso 8 con la PWA hecha (falta Tauri) y el deploy por Gitea hecho.
- **Archivos:** `docs/plans/terminados/{nucleo,corte-realtime,invitaciones-web}.md`, `CLAUDE.md`.
- **Terminado cuando:** las tres mejoras quedan `[x]` con su referencia y CLAUDE.md refleja el estado real.

### [x] Fase 2 — Tabla `project_user` y relaciones
- **Alcance:** migración `project_user` (`organization_id`, `project_id`, `user_id` con FK cascade, timestamps,
  `unique(project_id, user_id)`, índice `(user_id, organization_id)`); `Project::members()`, `User::projects()`
  (o modelo pivote con `BelongsToOrganization`, a elegir y anotar en Decisiones); documentar en `database.md`.
- **Archivos:** migración nueva, `Project.php`, `User.php`, `.claude/rules/database.md`.
- **Terminado cuando:** test de modelo: asignar y quitar un miembro, unicidad, cascade al borrar proyecto o usuario.

### [x] Fase 3 — Asignar a los members actuales a sus proyectos [riesgo]
- **Alcance:** migración de datos con SQL literal: por cada usuario con rol `member` en una organización, una fila
  en `project_user` por cada proyecto de esa organización (incluidos archivados). Owner y admin no necesitan filas.
  Verificar el `model_type` real de `model_has_roles` antes de escribir la consulta.
- **Archivos:** migración nueva.
- **Terminado cuando:** test que siembra org con owner, admin y member y dos proyectos, corre la migración y deja
  2 filas solo para el member; `migrate:fresh --seed` pasa.

### [x] Fase 4 — Regla de acceso y visibilidad de proyectos
- **Alcance:** soporte `App\Support\ProjectAccess` (`canView(User, Project)`, `visibleProjectIds`/scope; owner y
  admin ven todo; lee el rol de la organización del proyecto con team en `try/finally`); `ProjectPolicy::view`
  deniega con `denyAsNotFound()`; `ProjectController::index` filtra para members.
- **Archivos:** `app/Support/ProjectAccess.php` (nuevo), `ProjectPolicy.php`, `ProjectController.php`.
- **Terminado cuando:** un member lista solo sus proyectos y recibe 404 en uno ajeno; owner y admin ven todos.

### [x] Fase 5 — Visibilidad de canales y mensajes
- **Alcance:** `ChannelPolicy::view` usa `ProjectAccess` (canal sin proyecto: ver Decisiones), `ChannelController`
  filtra; mensajes, hilos y adjuntos lo heredan por sus FormRequests.
- **Archivos:** `ChannelPolicy.php`, `ChannelController.php`.
- **Terminado cuando:** un member recibe 404 al listar mensajes, responder o subir adjunto en un canal ajeno, y
  `/api/channels` solo trae los suyos.

### [x] Fase 6 — Acceso a tareas
- **Alcance:** `TaskPolicy` (`view`, `update`, `delete` por el proyecto de la tarea), `TaskController::index` y
  `StoreTaskRequest` autorizan `view` del proyecto; `assignee_id` de store y update exige acceso al proyecto (L-04).
- **Archivos:** `TaskPolicy.php`, `TaskController.php`, `StoreTaskRequest.php`, `UpdateTaskRequest.php`.
- **Terminado cuando:** un member no lista, crea ni mueve tareas de un proyecto ajeno (404) ni asigna a alguien sin
  acceso (422).

### [x] Fase 7 — Acceso a logs
- **Alcance:** `LogGroupPolicy` por proyecto; `ListLogGroupsRequest`, `HourlyLogGroupsRequest` y
  `LogSourceController::index` autorizan `view` del proyecto.
- **Archivos:** `LogGroupPolicy.php`, `ListLogGroupsRequest.php`, `HourlyLogGroupsRequest.php`,
  `LogSourceController.php` (y `LogSourcePolicy.php` si hace falta).
- **Terminado cuando:** un member recibe 404 en grupos, gráfico por hora, cambio de estado y fuentes de un proyecto
  ajeno.

### [x] Fase 8 — Autorización realtime por proyecto
- **Alcance:** `ChannelChannel` y `ProjectChannel` usan `ProjectAccess` con la organización del canal (sin team
  activo).
- **Archivos:** `app/Broadcasting/ChannelChannel.php`, `app/Broadcasting/ProjectChannel.php`.
- **Terminado cuando:** `BroadcastingAuthTest` cubre member sin acceso (rechazado) y con acceso, owner y admin.

### [x] Fase 9 — Menciones respetan el acceso
- **Alcance:** `MessageMentions::target()` solo menciona a quien ve el canal; `MentionCreated::broadcastOn`
  revalida el acceso (L-42); `MentionController` (index, read, contador) filtra menciones de canales sin acceso
  (las filas se conservan: vuelven si recupera el acceso).
- **Archivos:** `app/Chat/MessageMentions.php`, `app/Events/MentionCreated.php`, `MentionController.php`.
- **Terminado cuando:** mencionar a un member sin acceso no crea fila ni evento, y la bandeja oculta menciones de
  proyectos que perdió.

### [x] Fase 10 — API de miembros del proyecto [límite]
- **Alcance:** `GET/POST/DELETE /api/projects/{project}/members`. El GET devuelve quién ve el proyecto (owner,
  admin y members asignados: directorio para menciones y asignados); POST/DELETE asignan o quitan members, solo
  owner o admin (`ProjectPolicy::manageMembers`); agregar valida que sea `member` de la organización.
- **Archivos:** `ProjectMemberController.php` (nuevo), `StoreProjectMemberRequest.php` (nuevo), `routes/api.php`,
  `ProjectPolicy.php`, `lang/{en,es}.json`.
- **Terminado cuando:** test de API: listar, asignar, quitar, 403 a member, 422 si no es de la organización.

### [x] Fase 11 — Quitar acceso corta lo que queda abierto [riesgo]
- **Alcance:** al quitar a alguien de un proyecto: desasignar sus tareas de ese proyecto, emitir
  `ProjectAccessChanged` a `users.{id}` (solo ids, L-38) y cortar sus sockets (`TerminateUserConnections`). Al
  asignar, el mismo evento con `granted`. Al degradar admin u owner a member, cortar sockets. `removeMember` borra
  sus filas de `project_user`.
- **Archivos:** `ProjectMemberController.php` (o una acción), `app/Events/ProjectAccessChanged.php` (nuevo),
  `Organization.php`.
- **Terminado cuando:** tests: tareas desasignadas, evento con solo ids, job de corte despachado, filas borradas al
  quitar de la organización.

### [x] Fase 12 — Invitaciones con proyectos (API) [límite]
- **Alcance:** tabla `invitation_project` (FK cascade); `InviteRequest` acepta `project_ids` solo con rol `member`
  y de la organización (autorizar antes de validar, L-04); `accept` asigna los que sigan existiendo;
  `InvitationResource` los devuelve.
- **Archivos:** migración nueva, `Invitation.php`, `InviteRequest.php`, `InvitationController.php`,
  `InvitationResource.php`.
- **Terminado cuando:** invitar con proyectos y aceptar deja las filas; 422 con proyectos y rol admin; un proyecto
  borrado entre medio se ignora.

### [x] Fase 13 — Web: reaccionar a cambios de acceso
- **Alcance:** escuchar `ProjectAccessChanged` en `users.{id}`; al perder acceso, sacar el proyecto del store,
  soltar sus canales en Echo (L-36) y salir de la vista si estaba abierta; al ganarlo o al cambiar de rol, recargar
  proyectos y canales (L-34).
- **Archivos:** `api/types.ts`, `realtime/echo.ts`, `realtime/useMembershipWatch.ts`, `stores/projects.ts`,
  `stores/organization.ts`.
- **Terminado cuando:** specs de `useMembershipWatch` y `projects` cubren los tres casos.

### [x] Fase 14 — Web: pantalla de miembros del proyecto
- **Alcance:** diálogo desde el encabezado del proyecto (solo owner y admin) que lista quién lo ve y permite asignar
  o quitar members.
- **Archivos:** `api/projects.ts`, `components/ProjectMembersDialog.vue` (nuevo), `components/ProjectHeader.vue`,
  i18n.
- **Terminado cuando:** spec del diálogo: lista, asigna, quita; el botón no aparece para members.

### [x] Fase 15 — Web: menciones y asignados por proyecto [límite]
- **Alcance:** `memberDirectory` por proyecto (usa el GET de la fase 10) en el composer, el editor y las tareas.
- **Archivos:** `stores/memberDirectory.ts`, `MessageComposer.vue`, `MessageEditor.vue`, `TaskAside.vue`,
  `TaskCreateDialog.vue`.
- **Terminado cuando:** specs: el autocompletado y el selector de asignado solo ofrecen a quien ve el proyecto.

### [x] Fase 16 — Web: elegir proyectos al invitar
- **Alcance:** en `InviteDialog`, con rol `member`, selector múltiple de proyectos; la lista de invitaciones los
  muestra.
- **Archivos:** `api/invitations.ts`, `api/types.ts`, `components/InviteDialog.vue`, `views/InvitationsView.vue`,
  i18n.
- **Terminado cuando:** spec: envía `project_ids` solo con rol member; la invitación pendiente muestra sus proyectos.

## Decisiones
- 2026-10-10 — Owner y admin ven todos los proyectos sin filas en `project_user`; las filas solo cuentan para
  `member`. Motivo: crear proyectos ya es de owner o admin, y evita mantener filas redundantes.
- 2026-10-10 — Lo inaccesible responde 404 (`denyAsNotFound`), no 403: no revela que existe y no dispara
  `handleForbidden` en la web.
- 2026-10-10 — Canal sin proyecto (hoy no existen): visible para toda la organización, como hasta ahora, por si se
  agrega un canal general.
- 2026-10-10 — Al degradar a member no se asignan proyectos automáticamente: queda con los que tuviera asignados y
  el admin decide.
- 2026-10-10 — Al perder acceso se desasignan sus tareas del proyecto (como al salir de la organización) y se cortan
  sus sockets: Reverb no re-autoriza suscripciones abiertas.
- 2026-10-10 — `/api/members` sigue listando toda la organización (pantalla de miembros); menciones y asignados usan
  los miembros del proyecto.
- 2026-10-10 — El plan se ejecuta en el worktree `.claude/worktrees/acceso-proyectos` (rama `feat/acceso-proyectos`).
  Los contenedores montan el checkout principal: los tests corren con `docker run` sobre la imagen `workspace-php` o
  `node:24`, montando el worktree, los volúmenes `workspace_workspace_vendor` o `workspace_web-node-modules` y
  `api/.env` del checkout principal, en la red `workspace_default` (como en `pantallas-faltantes`).
- 2026-10-10 — (Fase 2) Sin modelo pivote: `Project::members()` y `User::projects()` son `belongsToMany` con `withPivot('organization_id')` y timestamps. Se asigna y quita solo con `Project::addMember(User)` (idempotente, `syncWithoutDetaching`, llena `organization_id`) y `Project::removeMember(User)`; las fases 10 a 12 los usan, nunca `attach` directo. `User::projects()` hereda el `OrganizationScope` de `Project` (solo la organización activa).
- 2026-10-10 — (Fase 3) La migración `assign_members_to_their_projects` toma el rol de `model_has_roles` (`model_type` = `App\Models\User`, sin morph map; team en `model_has_roles.organization_id`), une `roles` por nombre `member` y `organization_user` para exigir membresía; `DISTINCT` + `ON CONFLICT (project_id, user_id) DO NOTHING` (idempotente). `down()` vacío: revertir borraría asignaciones posteriores.
- 2026-10-10 — (Fase 4) API de `App\Support\ProjectAccess` (estática; organización siempre explícita, sin team activo ni `CurrentOrganization`; rol leído con `setPermissionsTeamId` en `try/finally` restaurando el previo y `unsetRelation('roles')`): `seesAll(User, int $orgId)`, `canView(User, Project)`, `canViewId(User, int $orgId, int $projectId)`, `visibleProjectIds(User, int $orgId)`, `restrict(Eloquent\Builder, User, int $orgId, string $col = 'projects.id')` (no-op para owner y admin). Un member ve un proyecto solo con rol `member` en esa organización y fila en `project_user`. Hace 1 o 2 consultas por llamada: en listados usar `restrict` o `visibleProjectIds` una vez por petición, no `canView` por fila.
- 2026-10-10 — (Fase 4) `ProjectPolicy::view` devuelve `Response|bool`: proyecto de otra organización o sin `viewAny`, false (403 como antes); de la organización sin acceso, `denyAsNotFound()` (404).
- 2026-10-10 — (Fase 5) `ChannelPolicy::view` devuelve `Response|bool` (`ProjectAccess::canViewId`, `denyAsNotFound`); es el único sitio de la regla para mensajes, hilos y adjuntos (`MessagePolicy` la hereda). Los FormRequests que deben dar 404 usan `Gate::authorize(...)->allowed()`: con `Gate::allows` el 404 de la policy se vuelve 403. Editar o borrar un mensaje en un canal sin acceso sigue en 403 (solo llega al autor).
- 2026-10-10 — (Fase 5) Tests: el helper `assignMembersToAllProjects()` de `tests/Pest.php` (mismo SQL que la migración de la fase 3) asigna los members a todos los proyectos existentes; los tests de acceso crean el proyecto o canal ajeno después de llamarlo. Las fases 6 a 9 ajustan sus tests igual y corren la suite completa del API antes de dar la fase por hecha.
- 2026-10-10 — (Fase 6) `TaskPolicy::view`, `update` y `delete` usan `ProjectAccess::canViewId` con el proyecto de la tarea (404 sin acceso; `delete` propaga ese 404 y después exige creador, owner o admin: 403). `StoreTaskRequest::validateAssigneeAccess()` (estática, reutilizada por `UpdateTaskRequest`) valida en `after()` que el asignado vea el proyecto: 422 en `assignee_id` con `__('The selected assignee does not have access to this project.')`, y se salta si ya falló la regla de organización.
- 2026-10-10 — (Fase 7) `LogGroupPolicy::view` y `update` por el proyecto del grupo (404 sin acceso); las Requests de logs con `Gate::authorize(...)->allowed()`; `LogSourceController::index` autoriza `view` del proyecto; `LogSourcePolicy` sin cambios (store, rotate y destroy ya son de owner o admin). "Crear tarea desde un aviso" es `POST projects/{p}/tasks` con `log_group_id`: lo cubre la fase 6. La ingesta por API key no pasa por policies.
- 2026-10-10 — (Fase 8) `ChannelChannel` y `ProjectChannel` usan `ProjectAccess::canViewId` con la organización del nombre del canal, después de comprobar que el canal o proyecto es de esa organización; canal sin `project_id`, visible para todo miembro. Ojo: `canViewId` no comprueba que el proyecto sea de `$orgId` (para owner y admin `seesAll` devuelve true sin mirarlo): quien lo llame valida antes la organización del proyecto.
- 2026-10-10 — (Fase 9) Menciones: `MessageMentions::target()` filtra con `ProjectAccess::canViewId` antes del tope por mensaje; `MentionCreated::broadcastOn` revalida membresía y acceso con el canal cargado sin scopes (`[]` si no); `MentionController` filtra `index`, `read` y `unread_count` con `seesAll`/`visibleProjectIds` una vez por petición. Las filas de quien perdió el acceso se conservan y vuelven si lo recupera, salvo que el mensaje se edite: `sync` las borra (emite `MentionRemoved`) y no vuelven.
- 2026-10-10 — (Fase 10) Contrato de miembros del proyecto (con `X-Organization-Id`; cada elemento es `MemberResource` `{id, name, email, role, joined_at}`, como `/api/members`; `joined_at` es la entrada a la organización, no la asignación): `GET /api/projects/{p}/members` 200 `{data: [...]}` sin paginar, por nombre e id, con owners, admins y members asignados (404 a member sin acceso). `POST` `{user_id}` 200 `{data: miembro}` idempotente; 403 a member antes de validar; 422 en `user_id` si no es de la organización o es owner o admin. `DELETE /members/{user}` 204 (también si no estaba asignado); 404 si no es de la organización; 422 en `user` si es owner o admin. El cliente deduce "quitable" de `role === 'member'`. Proyectos archivados también se gestionan.
- 2026-10-10 — (Fase 10) `ProjectMemberController::assign()` y `unassign()` (privados) son el único sitio que llama a `Project::addMember`/`removeMember`: la fase 11 engancha ahí sus efectos.
- 2026-10-10 — (Fase 11) Contrato realtime para la web: `ProjectAccessChanged` (`ShouldBroadcast`, `ShouldDispatchAfterCommit`) a `private-users.{id}`, `broadcastAs` `project.access_changed`, payload `{organization_id: int, project_id: int, granted: bool}`. Al degradar a member no se emite: la web reacciona a `membership.role_changed` recargando proyectos y canales.
- 2026-10-10 — (Fase 11) `Project::addMember`/`removeMember` devuelven `bool` (si hubo cambio); sin cambio no hay evento ni corte. `assign()`/`unassign()` corren en transacción con el lock de fila de `organizations` (como los cambios de membresía) y revalidan que el usuario siga en la organización (404 si no). Al quitar, las tareas del proyecto se desasignan con UPDATE directo por `project_id` y `assignee_id`, sin `TaskUpdated` (como `Organization::removeMember`), y se corta con `TerminateUserConnections::scheduleAfterCommit($userId)` (5 s; `Organization` lo reutiliza). `changeMemberRole` corta sockets solo al pasar de admin u owner a member. `Organization::removeMember` borra las filas de `project_user` de esa organización.
- 2026-10-10 — (Fase 12) Contrato de invitaciones con proyectos: `POST /api/invitations` `{email, role, project_ids?: number[]}`; `project_ids` opcional, solo con `role` = `member` (si no, 422 en `project_ids`), enteros distintos de proyectos de la organización activa (422 en `project_ids.N`), máx. 100, archivados valen, `[]` válido. `InvitationResource` añade `projects: [{id, name, key}]` (`whenLoaded`, cargado en el POST 201 y en el GET de pendientes; `[]` sin proyectos); el preview público no cambia. `accept` no cambia: `Invitation::assignProjectsTo($user)` asigna con `Project::addMember` los que sigan existiendo en la organización de la invitación, solo con rol `member`, y no emite `ProjectAccessChanged` (el usuario carga todo al entrar).
- 2026-10-10 — (Fase 12) `invitation_project`: PK `(invitation_id, project_id)`, FK cascade, índice por `project_id`, sin `organization_id` (sale de la invitación; excepción documentada en `database.md`). Reemplazar una invitación borra la anterior y su pivote por cascade.
- 2026-10-10 — (Fase 13) Web: `subscribeToUser` escucha `.project.access_changed` (guard de forma, L-13) y se ignoran los de otra organización. Perder acceso: `projects.removeProject(id)` (devuelve el id del canal), `leaveProject` de `echo.ts` suelta `projects.{id}` y `channels.{id}` (borra la entrada, vacía callbacks y deja de cachear; el `unsubscribe` posterior de la vista no hace nada), toast y salida a `projects` si la ruta abierta era de ese proyecto, y `projects.refresh()` (`load(true)` sin vaciar las listas). Ganar acceso y cambio de rol: `refresh()`; tras el cambio de rol sale si el proyecto abierto ya no está en `projects` ni en `channelByProject`.
- 2026-10-10 — (Fase 14) Web: `ProjectMembersDialog` vive en `ProjectHeader` (botón "Miembros" con `projectId` y `organization.canCreateProject`, es decir owner o admin), así que lo usan canal, plan y log sin tocarlas; `ProjectHeader` ahora necesita Pinia al montarse. `api/projects.ts` expone `listProjectMembers`, `assignProjectMember` y `unassignProjectMember` tipados con `Member`.
- 2026-10-10 — (Fase 15) Web: `memberDirectory` es por proyecto (`listProjectMembers`): `membersOf(projectId)`, `ensureLoaded(projectId)`, `invalidate(projectId?)` (sin id, todos) y `clear()`; generación por proyecto y época por organización o logout; TTL de 5 min por proyecto; `null` no carga ni ofrece nada. `projects.projectIdOfChannel(channelId)` da el proyecto del canal a Composer y Editor. Se invalida al asignar o quitar en `ProjectMembersDialog`, con `project.access_changed` (ese proyecto), con `membership.role_changed` y en MembersView (todos). `/api/members` queda solo para MembersView y el diálogo de miembros.
- 2026-10-10 — (Fase 16) Web: `InviteDialog` muestra con rol `member` un `fieldset` de checkboxes con `useProjectsStore().projects` (sin archivados, aunque el API los acepta); la selección se conserva al cambiar de rol pero `createInvitation(email, role, projectIds?)` solo envía `project_ids` con `member` y lista no vacía, filtrada contra el store. `Invitation.projects` es obligatorio en `types.ts`.

## Notas para la próxima sesión
- Plan terminado: 16 fases. Cierre: suite API 925 ok, Pint ok, suite web 1254 ok y typecheck ok, todo sobre el worktree.
- Falta: merge de `feat/acceso-proyectos` a `main` (pedirlo), `migrate` en desarrollo (corre la migración de datos de la fase 3) y probar en el navegador el diálogo de miembros, el directorio por proyecto y el selector de proyectos al invitar.

## Mejoras propuestas
- [ ] M-1 (media, sonnet): limitar `/api/members` a owner y admin, o sin email para members, para no exponer los
  correos de toda la organización.
- [ ] M-2 (media, sonnet): acortar el TTL de las URLs firmadas de adjuntos (hoy 60 min, siguen valiendo tras perder
  el acceso).
- [x] M-3 (baja, sonnet): helper o trait común para `belongsToActiveOrganization`/`canManage`, repetidos en cada
  policy.
- [x] M-4 (baja, sonnet): un member de ejemplo con proyectos asignados en `DatabaseSeeder`.
- [x] M-5 (baja, sonnet): en `.claude/rules/database.md`, quitar la línea en blanco que separa el bullet de `project_user` del de `projects`.
- [ ] M-6 (baja, sonnet): `project_user.organization_id` puede diferir del de su proyecto si se inserta sin `Project::addMember`; evaluar una FK compuesta `(project_id, organization_id)` o un test que lo vigile.
- [x] M-7 (baja, sonnet): test de `ProjectAccess` con un team previo no nulo y con una excepción dentro, para cubrir L-03 completo (hoy solo el caso null).
- [x] M-8 (baja, sonnet): `UpdateMessageRequest` y `DeleteMessageRequest` con `Gate::authorize(...)->allowed()` para que editar o borrar en un canal sin acceso dé 404 como el resto, con su test.
- [x] M-9 (baja, sonnet): `assignMembersToAllProjects()` repite el SQL de la migración de la fase 3; extraerlo a un lugar común o dejar un test que compare ambos resultados.
- [ ] M-10 (media, sonnet): `UpdateTaskRequest` valida el acceso del asignado aunque no cambie; si el asignado actual perdió el acceso (p. ej. admin degradado a member sin proyectos), cualquier edición que reenvíe `assignee_id` da 422. Validar solo cuando cambia respecto de `$task->assignee_id`.
- [x] M-11 (baja, sonnet): en las Requests que hacen `Gate::authorize(...)->allowed()`, el `->allowed()` es redundante (authorize lanza); dejar una forma única y clara en todas. Resuelta sin cambios: la forma `return Gate::authorize(...)->allowed();` es la que exige `FormRequest::authorize(): bool` y ya es la única.
- [ ] M-12 (baja, sonnet): tests de logs faltantes: PATCH de un grupo con un proyecto ajeno en la URL, y member sobre `store`, `rotate-key` y `destroy` de fuentes.
- [ ] M-13 (media, sonnet): `BroadcastingAuthTest`: caso de owner o admin de una organización pidiendo el canal o proyecto de otra (hoy los casos de otra organización usan un member y no aíslan el filtro por organización); y evaluar que `ProjectAccess::canViewId` compruebe él mismo que el proyecto es de `$orgId`.
- [ ] M-14 (baja, sonnet): `MessageMentions::target()` hace 1 o 2 consultas por id mencionado sin acceso (sin tope); calcular el acceso en lote (`seesAll` por usuario y `project_user` en una consulta) o topar los ids antes de filtrar. Y reajustar su docblock, que quedó en una línea larga.
- [ ] M-15 (baja, sonnet): en `DELETE /api/projects/{p}/members/{user}` el binding de `{user}` es global y un id inexistente da 404 antes del 403: resolver el usuario dentro del método tras `Gate::authorize`. Y en `en`, los 422 dicen "members of the organization" cuando la regla es el rol `member`: aclarar la redacción.
- [ ] M-16 (baja, sonnet): `GET /api/projects/{p}/members` filtra en PHP los usuarios de la organización; pasar el filtro a la consulta si las organizaciones crecen.
- [ ] M-17 (media, opus): carreras con el lock: la regla de rol `member` de asignar y quitar (`StoreProjectMemberRequest::after`, `ProjectMemberController::destroy`) corre fuera del lock de la organización, y un PATCH de tarea que asigna a alguien mientras pierde el acceso puede dejarlo asignado sin acceso (la validación del asignado no toma el lock). Revalidar dentro de la transacción.
- [ ] M-18 (baja, sonnet): emitir `TaskUpdated` (o un evento de lote) al desasignar tareas por pérdida de acceso o salida de la organización, para que los tableros abiertos lo vean en vivo.
- [ ] M-19 (baja, sonnet): test de que no sale `ProjectAccessChanged` ni el corte tras un rollback (forzar el 404 dentro de la transacción de `assign`/`unassign`).
- [ ] M-20 (baja, sonnet): tests de invitaciones: reenviar con otros `project_ids` reemplaza los proyectos y sin ellos los limpia; un invitado admin u owner no recibe filas aunque el pivote tenga proyectos.
- [ ] M-21 (media, sonnet): `useMembershipWatch` al perder acceso con el proyecto abierto: lanzar `refresh()` antes del `await router.replace` (un load en vuelo puede reponer el proyecto quitado) y, tras el `await`, revisar que siga la sesión y la misma organización activa antes de seguir (L-32), con spec. Y en `onMembershipRoleChanged`, capturar el nombre del proyecto antes del refresh para no usar `projectAccessLostUnknown`.
- [ ] M-22 (baja, sonnet): `ProjectMembersDialog`: ante un 404 al asignar o quitar (otra sesión ya lo cambió), recargar la lista con `load()`; `@click="load()"` en Reintentar; y un caso de spec del 403 con el mensaje del servidor.
- [ ] M-23 (baja, sonnet): specs que faltan del directorio por proyecto: TaskAside solo ofrece a los miembros de su proyecto y conserva al asignado actual ajeno; Composer y Editor sin el canal en `channelByProject` no ofrecen a nadie.
- [ ] M-24 (baja, sonnet): el directorio de un proyecto no se entera de que otro admin asignó o quitó a alguien (solo por TTL o invalidación propia); evaluar un evento a `projects.{id}` con solo ids que invalide el directorio.
- [ ] M-25 (baja, sonnet): specs de `InviteDialog`: la selección se conserva al pasar de admin a member, y un 422 sin claves visibles muestra el error general con el `fieldset` presente; `aria-invalid` también en los checkboxes; tipar el fixture con `Invitation['projects']`.
- [ ] M-26 (baja, sonnet): `InviteDialog` no permite invitar a proyectos archivados (el store los excluye) ni avisa si la carga de proyectos falló; decidir si se incluyen y mostrar el error.
