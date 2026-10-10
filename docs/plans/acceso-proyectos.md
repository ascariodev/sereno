# Plan: acceso-proyectos

**Objetivo:** membresía por proyecto: owner y admin ven toda la organización; un `member` solo ve los proyectos
asignados (y sus canales, mensajes, tareas, logs, menciones y realtime), se asignan desde la web y al invitar.
**Estado:** en curso · Fase actual: 5
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

### [ ] Fase 5 — Visibilidad de canales y mensajes
- **Alcance:** `ChannelPolicy::view` usa `ProjectAccess` (canal sin proyecto: ver Decisiones), `ChannelController`
  filtra; mensajes, hilos y adjuntos lo heredan por sus FormRequests.
- **Archivos:** `ChannelPolicy.php`, `ChannelController.php`.
- **Terminado cuando:** un member recibe 404 al listar mensajes, responder o subir adjunto en un canal ajeno, y
  `/api/channels` solo trae los suyos.

### [ ] Fase 6 — Acceso a tareas
- **Alcance:** `TaskPolicy` (`view`, `update`, `delete` por el proyecto de la tarea), `TaskController::index` y
  `StoreTaskRequest` autorizan `view` del proyecto; `assignee_id` de store y update exige acceso al proyecto (L-04).
- **Archivos:** `TaskPolicy.php`, `TaskController.php`, `StoreTaskRequest.php`, `UpdateTaskRequest.php`.
- **Terminado cuando:** un member no lista, crea ni mueve tareas de un proyecto ajeno (404) ni asigna a alguien sin
  acceso (422).

### [ ] Fase 7 — Acceso a logs
- **Alcance:** `LogGroupPolicy` por proyecto; `ListLogGroupsRequest`, `HourlyLogGroupsRequest` y
  `LogSourceController::index` autorizan `view` del proyecto.
- **Archivos:** `LogGroupPolicy.php`, `ListLogGroupsRequest.php`, `HourlyLogGroupsRequest.php`,
  `LogSourceController.php` (y `LogSourcePolicy.php` si hace falta).
- **Terminado cuando:** un member recibe 404 en grupos, gráfico por hora, cambio de estado y fuentes de un proyecto
  ajeno.

### [ ] Fase 8 — Autorización realtime por proyecto
- **Alcance:** `ChannelChannel` y `ProjectChannel` usan `ProjectAccess` con la organización del canal (sin team
  activo).
- **Archivos:** `app/Broadcasting/ChannelChannel.php`, `app/Broadcasting/ProjectChannel.php`.
- **Terminado cuando:** `BroadcastingAuthTest` cubre member sin acceso (rechazado) y con acceso, owner y admin.

### [ ] Fase 9 — Menciones respetan el acceso
- **Alcance:** `MessageMentions::target()` solo menciona a quien ve el canal; `MentionCreated::broadcastOn`
  revalida el acceso (L-42); `MentionController` (index, read, contador) filtra menciones de canales sin acceso
  (las filas se conservan: vuelven si recupera el acceso).
- **Archivos:** `app/Chat/MessageMentions.php`, `app/Events/MentionCreated.php`, `MentionController.php`.
- **Terminado cuando:** mencionar a un member sin acceso no crea fila ni evento, y la bandeja oculta menciones de
  proyectos que perdió.

### [ ] Fase 10 — API de miembros del proyecto [límite]
- **Alcance:** `GET/POST/DELETE /api/projects/{project}/members`. El GET devuelve quién ve el proyecto (owner,
  admin y members asignados: directorio para menciones y asignados); POST/DELETE asignan o quitan members, solo
  owner o admin (`ProjectPolicy::manageMembers`); agregar valida que sea `member` de la organización.
- **Archivos:** `ProjectMemberController.php` (nuevo), `StoreProjectMemberRequest.php` (nuevo), `routes/api.php`,
  `ProjectPolicy.php`, `lang/{en,es}.json`.
- **Terminado cuando:** test de API: listar, asignar, quitar, 403 a member, 422 si no es de la organización.

### [ ] Fase 11 — Quitar acceso corta lo que queda abierto [riesgo]
- **Alcance:** al quitar a alguien de un proyecto: desasignar sus tareas de ese proyecto, emitir
  `ProjectAccessChanged` a `users.{id}` (solo ids, L-38) y cortar sus sockets (`TerminateUserConnections`). Al
  asignar, el mismo evento con `granted`. Al degradar admin u owner a member, cortar sockets. `removeMember` borra
  sus filas de `project_user`.
- **Archivos:** `ProjectMemberController.php` (o una acción), `app/Events/ProjectAccessChanged.php` (nuevo),
  `Organization.php`.
- **Terminado cuando:** tests: tareas desasignadas, evento con solo ids, job de corte despachado, filas borradas al
  quitar de la organización.

### [ ] Fase 12 — Invitaciones con proyectos (API) [límite]
- **Alcance:** tabla `invitation_project` (FK cascade); `InviteRequest` acepta `project_ids` solo con rol `member`
  y de la organización (autorizar antes de validar, L-04); `accept` asigna los que sigan existiendo;
  `InvitationResource` los devuelve.
- **Archivos:** migración nueva, `Invitation.php`, `InviteRequest.php`, `InvitationController.php`,
  `InvitationResource.php`.
- **Terminado cuando:** invitar con proyectos y aceptar deja las filas; 422 con proyectos y rol admin; un proyecto
  borrado entre medio se ignora.

### [ ] Fase 13 — Web: reaccionar a cambios de acceso
- **Alcance:** escuchar `ProjectAccessChanged` en `users.{id}`; al perder acceso, sacar el proyecto del store,
  soltar sus canales en Echo (L-36) y salir de la vista si estaba abierta; al ganarlo o al cambiar de rol, recargar
  proyectos y canales (L-34).
- **Archivos:** `api/types.ts`, `realtime/echo.ts`, `realtime/useMembershipWatch.ts`, `stores/projects.ts`,
  `stores/organization.ts`.
- **Terminado cuando:** specs de `useMembershipWatch` y `projects` cubren los tres casos.

### [ ] Fase 14 — Web: pantalla de miembros del proyecto
- **Alcance:** diálogo desde el encabezado del proyecto (solo owner y admin) que lista quién lo ve y permite asignar
  o quitar members.
- **Archivos:** `api/projects.ts`, `components/ProjectMembersDialog.vue` (nuevo), `components/ProjectHeader.vue`,
  i18n.
- **Terminado cuando:** spec del diálogo: lista, asigna, quita; el botón no aparece para members.

### [ ] Fase 15 — Web: menciones y asignados por proyecto [límite]
- **Alcance:** `memberDirectory` por proyecto (usa el GET de la fase 10) en el composer, el editor y las tareas.
- **Archivos:** `stores/memberDirectory.ts`, `MessageComposer.vue`, `MessageEditor.vue`, `TaskAside.vue`,
  `TaskCreateDialog.vue`.
- **Terminado cuando:** specs: el autocompletado y el selector de asignado solo ofrecen a quien ve el proyecto.

### [ ] Fase 16 — Web: elegir proyectos al invitar
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

## Notas para la próxima sesión
- Fases 1 a 4 hechas (suite API 880 ok en el worktree). Siguiente: fase 5, canales y mensajes con `ProjectAccess`.
- Trabajar en el worktree (ver Decisiones). Al editar con Python en Windows, dejar finales LF (Pint falla con `line_ending`).
- La migración de datos no se corrió en la base de desarrollo: corre con el próximo `migrate` tras el merge.
- Los tests que asumían que cualquier member ve todo se ajustan asignando al member o usando admin donde el test no trata del acceso.

## Mejoras propuestas
- [ ] M-1 (media, sonnet): limitar `/api/members` a owner y admin, o sin email para members, para no exponer los
  correos de toda la organización.
- [ ] M-2 (media, sonnet): acortar el TTL de las URLs firmadas de adjuntos (hoy 60 min, siguen valiendo tras perder
  el acceso).
- [ ] M-3 (baja, sonnet): helper o trait común para `belongsToActiveOrganization`/`canManage`, repetidos en cada
  policy.
- [ ] M-4 (baja, sonnet): un member de ejemplo con proyectos asignados en `DatabaseSeeder`.
- [ ] M-5 (baja, sonnet): en `.claude/rules/database.md`, quitar la línea en blanco que separa el bullet de `project_user` del de `projects`.
- [ ] M-6 (baja, sonnet): `project_user.organization_id` puede diferir del de su proyecto si se inserta sin `Project::addMember`; evaluar una FK compuesta `(project_id, organization_id)` o un test que lo vigile.
- [ ] M-7 (baja, sonnet): test de `ProjectAccess` con un team previo no nulo y con una excepción dentro, para cubrir L-03 completo (hoy solo el caso null).
