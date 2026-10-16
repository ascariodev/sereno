# Plan: integracion-mcp

**Objetivo:** que Claude Code se conecte a Sereno por MCP (HTTP, token Bearer de acceso personal ligado a una organización)
y pueda ver proyectos, tareas, mensajes de canal y avisos de log, comentar tareas, crearlas y moverlas, actuando como el
usuario dueño del token y con sus permisos. Los tokens se crean, listan y revocan desde la web.
**Estado:** terminado · 16/16 fases
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz). `app/` (móvil) no cambia.
- Paquete oficial `laravel/mcp` (docs: https://laravel.com/docs/13.x/mcp). Servidor `App\Mcp\Servers\...` extiende
  `Laravel\Mcp\Server`, tools en `$tools`; tool = `Laravel\Mcp\Server\Tool` con `handle(Request): Response` y
  `schema(JsonSchema)`; `#[Description]`, anotaciones `#[IsReadOnly]`, `#[IsIdempotent]` en
  `Laravel\Mcp\Server\Tools\Annotations`; `$request->user()`, `$request->validate()`, `Response::text|structured|error`.
  Ruta: `Mcp::web('/mcp', Server::class)->middleware([...])` en `routes/ai.php` (`vendor:publish --tag=ai-routes`).
  Tests: `Server::actingAs($user)->tool(Tool::class, [...])->assertOk()->assertSee(...)`, `assertHasErrors`.
  Inspector: `php artisan mcp:inspector mcp`.
- Auth hoy: `AuthController::tokenResponse()` crea tokens Sanctum con abilities `*` y sin expiración (sesiones web y
  móvil, nombre = `device_name`). `expo_push_tokens.personal_access_token_id` en cascada. No hay tokens personales.
- Multi-tenant: `Http/Middleware/ResolveOrganization.php` (header `X-Organization-Id`: limpia, valida membresía,
  `CurrentOrganization::set` que llama a `setPermissionsTeamId`, `unsetRelation('roles')`). `BelongsToOrganization` falla
  cerrado sin organización activa. El MCP repite ese flujo con la organización del token en vez del header.
- Dominio: la lógica vive en los controllers. Proyectos `ProjectController::index` + `Support/ProjectAccess.php`; tareas
  `TaskController` (`index` sin filtros, `show`, `store` con `notifyAssignee()` privado, `move` con locks, renumeración y
  `PostLogGroupStatusNotice`; eventos `TaskCreated`/`TaskUpdated`); comentarios `TaskCommentController::store`
  (`syncMentions()` privado, `TaskCommentCreated`, listener `NotifyTaskCommentRecipients`); mensajes
  `MessageController::index` (L-66: `RELATIONS` + `loadParticipants`); avisos `LogGroupController::index` (status, level).
- Web: ajustes como rutas hijas de `AppLayout` en `web/src/router/index.ts` (`settings/invitations`, `settings/members`),
  entrada por `components/UserMenu.vue`; cliente `src/api/client.ts`, módulos por recurso (patrón `src/api/invitations.ts`),
  tipos `src/api/types.ts`, i18n `src/i18n/{en,es}.json`.
- Lecciones clave: L-02 (limpiar organización por petición), L-04/L-72 (autorizar y 404 antes de validar), L-15 (otro
  punto de entrada reutiliza las `rules()` del Form Request), L-49 (suite completa al restringir acceso), L-66, L-82
  (`forgetGuards()` entre peticiones Bearer de usuarios distintos), L-09 (tipos web leyendo los Resources).
- Restricciones: `api/.env.example` lo edita el usuario. Antes de extraer lógica de un controller, `graphify affected`.

## Fases

### [x] Fase 1 — Token de acceso ligado a organización
- **Alcance:** migración que suma `organization_id` nullable a `personal_access_tokens` (FK `cascadeOnDelete`, índice).
  Modelo propio `App\Models\PersonalAccessToken` (extiende el de Sanctum, relación `organization()`, `isAccessToken()`
  = `organization_id !== null`) registrado con `Sanctum::usePersonalAccessTokenModel`. `User::createAccessToken(Organization,
  string $name, ?CarbonInterface $expiresAt)` con abilities `['mcp']`. Documentar en `database.md`. Verificar que
  `ExpoPushTokenController` sigue aceptando el modelo propio.
- **Archivos:** migración, `api/app/Models/PersonalAccessToken.php`, `api/app/Providers/AppServiceProvider.php`,
  `api/app/Models/User.php`, `.claude/rules/database.md`.
- **Terminado cuando:** migra y revierte limpio; tests del modelo (ability, organización, cascada al borrar la organización)
  y los de `ExpoPushToken` siguen pasando.

### [x] Fase 2 — Endpoints de tokens de acceso
- **Alcance:** en el grupo `auth:sanctum` + `organization`: `GET /api/access-tokens` (los del usuario en la organización
  activa: id, name, last_used_at, expires_at, created_at; nunca el token), `POST /api/access-tokens` (name requerido,
  `expires_in_days` nullable en 30/90/365; devuelve el token en claro una sola vez), `DELETE /api/access-tokens/{id}`
  (solo los propios de esa organización; ajeno o de otra organización = 404). Textos por `__()`.
- **Archivos:** `api/app/Http/Controllers/Api/AccessTokenController.php`, `StoreAccessTokenRequest.php`,
  `AccessTokenResource.php`, `api/routes/api.php`, `lang/{en,es}.json`.
- **Terminado cuando:** tests de alta, listado (no incluye sesiones ni tokens de otra organización), expiración, baja propia,
  baja ajena 404 y validación.

### [x] Fase 3 — La API REST rechaza tokens de acceso [riesgo]
- **Alcance:** middleware que responde 403 si el token actual es de acceso (`isAccessToken()`), aplicado a los grupos
  `auth:sanctum` de `api/routes/api.php` y a la autorización de broadcasting. Los tokens de sesión y
  `Sanctum::actingAs` (mock sin `organization_id`) siguen pasando. Así un token filtrado solo sirve para el MCP.
- **Archivos:** `api/app/Http/Middleware/RejectAccessTokens.php`, `api/bootstrap/app.php`, `api/routes/api.php`
  (+ `routes/channels.php` o donde se registre `/broadcasting/auth`).
- **Terminado cuando:** test de token de acceso rechazado en REST y en broadcasting, token de sesión aceptado; suite
  completa del API en verde (L-49, en subagente).

### [x] Fase 4 — Servidor MCP autenticado [riesgo]
- **Alcance:** `composer require laravel/mcp`, publicar `routes/ai.php` y comprobar cómo se carga. Servidor
  `App\Mcp\Servers\SerenoServer` sin tools, con nombre, versión e instrucciones. Ruta `Mcp::web('/mcp', ...)` con
  `auth:sanctum`, un middleware `ResolveTokenOrganization` (exige token de acceso con ability `mcp`, valida membresía
  vigente, `CurrentOrganization::set`, `unsetRelation('roles')`, limpia al empezar como pide L-02) y `throttle:mcp`
  (limitador por token en `AppServiceProvider`).
- **Archivos:** `api/composer.json`, `api/composer.lock`, `api/routes/ai.php`, `api/app/Mcp/Servers/SerenoServer.php`,
  `api/app/Http/Middleware/ResolveTokenOrganization.php` (+ `AppServiceProvider.php` para el limitador).
- **Terminado cuando:** tests HTTP del endpoint: sin token 401, token de sesión 403, token de acceso de un ex miembro 403,
  token válido completa `initialize` y `tools/list` vacío.

### [x] Fase 5 — Base de tools y listado de proyectos
- **Alcance:** clase base o trait para las tools (usuario y organización actual, `Gate` con error MCP en vez de excepción,
  serializar con los Resources existentes a `Response::structured`). Tool `list-projects` (visibles por `ProjectAccess`,
  `include_archived`). Descripciones y schemas en inglés (son para el modelo); errores por `__()`.
- **Archivos:** `api/app/Mcp/Tools/Tool.php` (o trait), `api/app/Mcp/Tools/ListProjectsTool.php`, `SerenoServer.php`.
- **Terminado cuando:** tests: owner ve todos, member solo los suyos, archivados solo con el flag, nada de otra organización.

### [x] Fase 6 — Prueba con Claude Code local [manual]
- **Alcance:** con el stack de desarrollo, crear un token (tinker o el endpoint de la fase 2), registrar el servidor en
  Claude Code por HTTP con la cabecera `Authorization` (verificar la sintaxis de `claude mcp add` en la documentación
  vigente) y pedirle que liste proyectos. Probar también `php artisan mcp:inspector mcp`. Anotar en Decisiones la URL y el
  comando que funcionaron.
- **Archivos:** ninguno (salvo ajustes que aparezcan, que van en una fase nueva).
- **Terminado cuando:** Claude Code lista los proyectos del usuario en una sesión real.

### [x] Fase 7 — Lectura de tareas
- **Alcance:** tools `list-tasks` (por proyecto; filtros opcionales `status`, `assignee_id`, `search` en título; límite de
  hechas como `done_limit`) y `get-task` (tarea con `TaskResource` y sus últimos comentarios, paginado por cursor).
  Mismas comprobaciones que `TaskController::show` (proyecto visible, tarea del proyecto).
- **Archivos:** `api/app/Mcp/Tools/ListTasksTool.php`, `GetTaskTool.php`, `SerenoServer.php`.
- **Terminado cuando:** tests de filtros, tarea de otro proyecto o no visible = error, comentarios en orden.

### [x] Fase 8 — Mensajes del canal
- **Alcance:** tool `list-channel-messages` (canal del proyecto, raíces por cursor con sus respuestas contadas; opcional
  `thread_id` para leer un hilo). Carga como `MessageController::index` (L-66).
- **Archivos:** `api/app/Mcp/Tools/ListChannelMessagesTool.php`, `SerenoServer.php`.
- **Terminado cuando:** tests de paginación, hilo, canal no visible = error.

### [x] Fase 9 — Avisos de log
- **Alcance:** tools `list-log-groups` (por proyecto, filtros `status` y `level` reutilizando `ListLogGroupsRequest`
  como pide L-15) y `get-log-group` (detalle con eventos recientes, `LogGroupPolicy`).
- **Archivos:** `api/app/Mcp/Tools/ListLogGroupsTool.php`, `GetLogGroupTool.php`, `SerenoServer.php`.
- **Terminado cuando:** tests de filtros, grupo de otro proyecto o no visible = error.

### [x] Fase 10 — Comentar tareas
- **Alcance:** extraer de `TaskCommentController::store` una acción `App\Actions\CreateTaskComment` (transacción,
  `syncMentions`, `TaskCommentCreated`) sin cambiar el comportamiento; el controller la usa. Tool `comment-on-task`
  (body con menciones; sin adjuntos), autorizada con `TaskCommentPolicy`, validada con las `rules()` del Form Request.
- **Archivos:** `api/app/Actions/CreateTaskComment.php`, `TaskCommentController.php`, `api/app/Mcp/Tools/CommentOnTaskTool.php`,
  `SerenoServer.php`.
- **Terminado cuando:** tests existentes de comentarios en verde; tests de la tool (crea, menciona y notifica, evento
  emitido, sin permiso = error).

### [x] Fase 11 — Crear tareas
- **Alcance:** extraer de `TaskController::store` una acción `App\Actions\CreateTask` (incluye `notifyAssignee` y
  `TaskCreated`) sin cambiar el comportamiento. Tool `create-task` (title, description, status, assignee_id, log_group_id
  opcional), con las `rules()` de `StoreTaskRequest`.
- **Archivos:** `api/app/Actions/CreateTask.php`, `TaskController.php`, `api/app/Mcp/Tools/CreateTaskTool.php`, `SerenoServer.php`.
- **Terminado cuando:** tests existentes de alta en verde; tests de la tool (crea, notifica al asignado, evento, assignee
  fuera del proyecto = error).

### [x] Fase 12 — Extraer el movimiento de tareas [riesgo]
- **Alcance:** mover la lógica de `TaskController::move` (locks, renumeración, resolución del grupo de log, eventos) a
  `App\Actions\MoveTask`, sin cambio de comportamiento. Solo refactor.
- **Archivos:** `api/app/Actions/MoveTask.php`, `TaskController.php`.
- **Terminado cuando:** `TaskMoveApiTest` y los tests de resolución de grupos en verde sin tocarlos; suite de `Plan/` completa.

### [x] Fase 13 — Mover tareas
- **Alcance:** tool `move-task` (status requerido; `before_id`/`after_id` opcionales, por defecto al principio de la
  columna como hace la web), con las `rules()` de `MoveTaskRequest` y `TaskPolicy`.
- **Archivos:** `api/app/Mcp/Tools/MoveTaskTool.php`, `SerenoServer.php`.
- **Terminado cuando:** tests: cambia de columna, posición, resuelve el grupo de log si el proyecto lo pide, sin permiso = error.

### [x] Fase 14 — Vista de tokens en la web
- **Alcance:** módulo `src/api/accessTokens.ts` y tipos (leyendo `AccessTokenResource`, L-09). Vista `AccessTokensView.vue`:
  lista, crear (nombre y expiración; muestra el token una sola vez con botón copiar y el comando de Claude Code con la URL
  `${VITE_API_URL}/mcp`) y revocar con diálogo de confirmación. Textos en `en` y `es`.
- **Archivos:** `web/src/api/accessTokens.ts`, `web/src/api/types.ts`, `web/src/views/AccessTokensView.vue`,
  `web/src/i18n/en.json`, `web/src/i18n/es.json`.
- **Terminado cuando:** spec de la vista (listar, crear muestra el token una vez, revocar) con mocks estrictos por URL
  (L-73); typecheck en verde.

### [x] Fase 15 — Entrada a la vista de tokens
- **Alcance:** ruta `settings/access-tokens` bajo `AppLayout` e item en `UserMenu.vue`.
- **Archivos:** `web/src/router/index.ts`, `web/src/components/UserMenu.vue`, `web/src/i18n/{en,es}.json`.
- **Terminado cuando:** spec del menú navega a la vista; prueba en el navegador de crear, copiar y revocar.

### [x] Fase 16 — Producción y documentación [manual] [riesgo]
- **Alcance:** deploy; comprobar que `https://<api>/mcp` llega a PHP a través del proxy de producción (el nginx del stack
  ya manda todo a `index.php`) y que el límite de tamaño y tiempos no cortan la respuesta. Conectar Claude Code contra
  producción con un token real. Documentar en `CLAUDE.md` (sección del MVP o transversal) cómo conectarse.
- **Archivos:** `CLAUDE.md` (+ configuración de producción solo si hace falta).
- **Terminado cuando:** Claude Code lista proyectos y comenta una tarea de prueba en producción.

## Decisiones
- 2026-10-14 — Claude actúa como el usuario dueño del token (sin usuario de sistema) — mismo modelo que el conector de Jira;
  sin usuarios ni roles nuevos.
- 2026-10-14 — Tokens desde una pantalla de la web (crear, listar, revocar), cada uno ligado a una organización — el
  usuario los gestiona sin acceso al servidor.
- 2026-10-14 — Alcance: leer, comentar, crear y mover; nada de borrar.
- 2026-10-14 — OAuth (conector en claude.ai) queda para después; primero Claude Code con Bearer.
- 2026-10-14 — Tokens de acceso = `personal_access_tokens` con `organization_id` y ability `mcp`; las sesiones siguen con
  `organization_id` nulo. Solo valen en `/mcp` (fase 3) y la membresía se revalida en cada petición.
- 2026-10-14 — Descripciones y schemas de las tools en inglés (los lee el modelo, no las personas); errores por `__()`.
- 2026-10-15 — `User::createAccessToken` escribe el token en una sola operación con `organization_id` y abilities `['mcp']`;
  `organization_id` va en `$fillable` del modelo propio.
- 2026-10-15 — `/api/access-tokens`: el `POST` devuelve `data` y `token` (en claro) al mismo nivel; `DELETE` filtra por
  usuario y organización activa sin route-model binding (ajeno, de otra organización o de sesión = 404). Los vencidos se
  listan para poder revocarlos. Sin textos nuevos en `lang/`.
- 2026-10-15 — `RejectAccessTokens` va en el grupo `api` (append), no en cada grupo `auth:sanctum`: cubre solo las rutas
  nuevas. Prioridad justo después de `AuthenticatesRequests` y antes de `ResolveOrganization`; en `/broadcasting/auth`
  tras `auth:sanctum`. Responde 403 `{message, code: 'access_token_forbidden'}`. Como `SetLocale` ya resuelve el usuario
  con cualquier Bearer, un token de acceso también recibe 403 en rutas públicas del grupo `api`.
- 2026-10-15 — laravel/mcp v1.0.2. `McpServiceProvider` carga `routes/ai.php` sin grupo de middleware (ni `api` ni
  `web`), así que `RejectAccessTokens` no corre en `/mcp`. Middleware de `/mcp`: `SetLocale`, `auth:sanctum`,
  `ResolveTokenOrganization`, `throttle:mcp` (120/min por token). `ResolveTokenOrganization` exige el modelo propio con
  `isAccessToken()` y ability `mcp` (las sesiones tienen `*`), toma la organización solo del token (ignora
  `X-Organization-Id`) y revalida la membresía en cada petición. `mcp` se sumó a `$wantsJson` de `bootstrap/app.php`.
- 2026-10-15 — `Sanctum::actingAs` recibe 403 en `/mcp`: las tools se prueban con `SerenoServer::actingAs` (sin HTTP),
  así que deben fijar ellas la organización del token o del test.
- 2026-10-15 — Base `App\Mcp\Tools\Tool`: `handle()` final toma el usuario de `$request->user()` y la organización de
  `CurrentOrganization` (sin ellos, error: falla cerrado) y llama a `run(Request, User, Organization)`. `authorize()` usa
  `Gate::forUser`. `ModelNotFoundException`, `NotFoundHttpException` y `AuthorizationException` con status 404
  (`denyAsNotFound`) dan "Not found."; otra `AuthorizationException`, "You are not allowed to do this.". `structured()`
  envuelve siempre en `['data' => ...]` (`Response::structured` rechaza arrays vacíos). Cada tool lleva
  `#[Name('...')]` (si no, el nombre sale de la clase). `list-projects` no pagina.
- 2026-10-15 — Prueba local (fase 6): servidor del worktree en `http://localhost:8013/mcp` (`docker compose -p workspace
  run --rm --no-deps --name workspace_api_mcp -p 8013:8080 api php artisan serve --host=0.0.0.0 --port=8080
  --no-reload`). Registro: `claude mcp add --transport http --scope user sereno-dev http://localhost:8013/mcp --header
  "Authorization: Bearer <token>"`; queda Connected y una sesión nueva de Claude Code lista los proyectos. En este equipo
  el CLI `claude` no está en el PATH: el de la app vive en la AppData virtualizada de la app y solo se ve desde sus
  sesiones. `mcp:inspector` no se probó.
- 2026-10-15 — `list-tasks` y `get-task` duplican la consulta de `TaskController::index`/`show` (sin extraer) y reusan
  `RELATIONS`, `counts()`, `MAX_DONE_LIMIT`, `TaskResource` y `TaskCommentResource`; autorizan el proyecto antes de
  validar. `list-tasks` devuelve `data` y `meta{done_total, has_more_done}`; `get-task` devuelve `data` y
  `comments{data, next_cursor}` (más nuevos primero, `per_page` 30, reglas de `ListTaskCommentsRequest`).
- 2026-10-15 — `list-channel-messages` recibe `project_id` (no `channel_id`), resuelve `project->channel` y autoriza
  `view` del proyecto y del canal. Duplica las consultas de `MessageController::index`/`replies` con `RELATIONS` y
  `loadParticipants` (L-66). Devuelve `data` + `next_cursor` (+ `meta.root` con `thread_id`); sin `around`.
- 2026-10-15 — `list-log-groups` (reglas de `ListLogGroupsRequest`, argumento `page`, `data` + `meta{current_page, total,
  has_more}`) y `get-log-group` (`DETAIL_EVENTS_LIMIT`, retención, `LogGroupResource` con `events` y `task`) duplican
  `LogGroupController::index`/`show`. El contenedor de 8013 corre con `--no-reload`: reiniciarlo para ver tools nuevas.
- 2026-10-15 — Fase 10: además de `CreateTaskComment(Task, User, body, attachmentIds = [])` se extrajo
  `SyncTaskCommentMentions` (también la usa `update`). La acción carga `RELATIONS` y despacha `TaskCommentCreated` tras
  el commit; las notificaciones siguen en el listener. `comment-on-task` responde `{data: TaskCommentResource}`.
- 2026-10-15 — La base `Tool` normaliza los argumentos antes de `run()` como `TrimStrings` y `ConvertEmptyStringsToNull`
  (`Str::trim`, `''` a `null`, recursivo), porque MCP no pasa por esos middleware. Las tools reutilizan `rules()` de los
  Form Requests sin normalizar a mano.
- 2026-10-15 — Fase 11: `CreateTask(Project, User, title, ?description, TaskStatus, ?assigneeId, ?logGroupId)` (locks,
  transacción, aviso de grupo, relaciones, `TaskCreated`, notificación, 422 por índice único) y `NotifyTaskAssignee`
  (también la usa `update`). `TaskController::lockActiveProject` y `lockAssigneeAccess` son `public static` (las usan
  `CreateTask`, `update` y `move`). Las comprobaciones del `after()` de `StoreTaskRequest` están en
  `StoreTaskRequest::validateBusinessRules(Validator, Project, assigneeId, logGroupId)`, que usan `after()` y la tool.
  `create-task` devuelve `{data: TaskResource}`.
- 2026-10-15 — Fase 12: `MoveTask(Task $task, User $actor, TaskStatus $status, ?int $beforeId = null, ?int $afterId =
  null): Task`, proyecto desde `$task->project` (el controller hace `setRelation`). `moveSlot`, `renumberColumn` y
  `MIN_POSITION_GAP` viven en la acción; los locks siguen `public static` en `TaskController`. Sin `before_id` ni
  `after_id` la acción deja la tarea al final (como el REST).
- 2026-10-15 — `move-task` sin `before_id`/`after_id` la deja al principio de la columna, como pide el alcance: la tool
  pasa como `before_id` la primera tarea de la columna destino excluyendo la propia (`whereKeyNot`: si ya es la primera,
  se queda arriba); `MoveTask` y el REST no cambian. La tool replica `authorize()` y `after()` de `MoveTaskRequest` y usa
  sus `rules()` con un resolver de ruta mínimo (clase anónima local). `TaskPolicy::update` solo delega en `view`.
- 2026-10-15 — Web: `AccessTokensView` con los diálogos de crear, token emitido y revocar dentro de la vista. El token en
  claro vive solo en el estado local `issued` (ni store ni storage) y se descarta al cerrar, al confirmar y al cambiar de
  organización. El diálogo muestra el comando `claude mcp add --transport http sereno ${config.apiUrl}/mcp --header
  "Authorization: Bearer <token>"`. Sin restricción por rol: cada miembro gestiona sus tokens.
- 2026-10-15 — Fase 15: ruta `settings/access-tokens` (nombre `access-tokens`) e item "Tokens de acceso" en `UserMenu`
  después de Notificaciones, para todos los roles. Probado en el navegador con un Vite del worktree en 5184
  (`docker compose -p workspace run --rm --no-deps -T --name sereno_web_mcp -p 5184:5174 -e
  VITE_API_URL=http://localhost:8013 --entrypoint sh web -c "npm run dev"`): menú, crear con expiración, token visible
  una vez con el comando y revocar con confirmación. Copiar no se pudo probar en el panel embebido (portapapeles
  bloqueado; `CopyButton` muestra su aviso de fallo).
- 2026-10-15 — Se ejecuta en el worktree `.claude/worktrees/integracion-mcp`; los comandos del API corren desde la raíz
  del worktree con `MSYS_NO_PATHCONV=1 docker compose -p workspace run --rm --no-deps api ...` (monta el `api/` del
  worktree; `vendor/` es el volumen compartido con el checkout principal).
- 2026-10-15 — Fase 16: desplegado con el merge `b9a7bcc`. `https://sereno-api.ascario.dev/mcp` llega a PHP por el proxy
  sin cambios de configuración (401 sin token, `tools/list` 200 con token). Claude Code (servidor `sereno`, scope user)
  listó proyectos y comentó una tarea en producción. Conexión documentada en `CLAUDE.md` (transversal). Un token por
  máquina; el creado en el Mac quedó expuesto en el chat y se reemplazó por uno de Windows.

## Notas para la próxima sesión
- Tests de tools: `app(CurrentOrganization::class)->set(...)` antes de `SerenoServer::actingAs(...)->tool(...)`;
  aserciones `assertSee`, `assertDontSee`, `assertStructuredContent`, `assertHasErrors`. `tool()` solo ejecuta tools
  registradas en el servidor. Usar Edit (no sed) para los `use`: sed comió barras invertidas. `replies_count` no es
  fillable: en tests, `forceFill(...)->save()`. Pint reescribe los CRLF que deja Python en Windows: escribir con Edit.
- Plan terminado. En local quedaban el API del worktree en 8013 (registrado como `sereno-dev` en Claude Code, scope user)
  y la BD de desarrollo con la migración de la fase 1; las mejoras pendientes se aplican con `/aplicar-mejoras`.

## Mejoras propuestas
- [ ] M-1: OAuth 2.1 (`Mcp::oauthRoutes` con Passport) para usar Sereno como conector en claude.ai.
      Complejidad: alta · Archivos: 8+ · Riesgo: seguridad → plan nuevo
- [x] M-2: tool `update-task` (título, descripción, asignado) y `list-project-members` para elegir asignado.
      Complejidad: media · Archivos: 4 · Riesgo: ninguno → sonnet
- [ ] M-3: marcar el origen "vía MCP" en comentarios y tareas creadas por Claude.
      Complejidad: media · Archivos: 5 · Riesgo: BD → opus
- [x] M-4: revocar los tokens de acceso de un usuario al sacarlo de la organización (hoy solo dejan de funcionar).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-5: `ExpoPushTokenController` y `ExpoPushToken` importan el `PersonalAccessToken` de Sanctum; apuntarlos al modelo
      propio por coherencia. Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-6: corregir el comentario de `RejectAccessTokens` ("public routes trigger no token lookup" no es exacto por
      `SetLocale`) y agregar un test de token de acceso en una ruta pública (p. ej. `/api/auth/registration`).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-7: tests de `ResolveTokenOrganization`: usuario de dos organizaciones que manda `X-Organization-Id` de la otra
      (queda la del token), y en el de ex miembro fijar antes otra organización para que pruebe de verdad L-02.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-8: extraer la consulta del tablero (orden por CASE y límite de hechas) que comparten `TaskController::index` y
      `ListTasksTool`, para no mantenerla en dos sitios. Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-9: extraer la validación del cursor de `CursorPaginatedRequest::validCursor` (privada, copiada en
      `ListChannelMessagesTool`) a un método compartido; tests de hilo con raíz borrada y de `per_page` fuera de rango.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-10: extraer a una acción compartida la lógica de `LogGroupController::index`/`show` (y `levelsAtLeast`) que
      duplican las tools de log; tests de `get-log-group` con eventos fuera de retención o sobre el límite y de `page`
      inválido. Complejidad: media · Archivos: 4 · Riesgo: ninguno → sonnet
- [ ] M-11: mover `TaskCommentController::RELATIONS` (y el equivalente de tareas) al modelo, para que las acciones no
      importen un controller. Complejidad: baja · Archivos: 4 · Riesgo: ninguno → sonnet
- [ ] M-12: alinear el orden de autorización de `create-task` con el REST (`create` antes que `view`) y test de la tool
      para el 422 lanzado dentro de los locks (proyecto archivado o acceso perdido entre validación e insert).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-13: llevar los locks (`lockActiveProject`, `lockAssigneeAccess`), `RELATIONS` y `counts()` de `TaskController`
      a un soporte compartido, para que `CreateTask`, `MoveTask`, `UpdateTask` y `ListBoardTasks` no dependan del controller.
      Complejidad: media · Archivos: 5 · Riesgo: concurrencia → opus
- [ ] M-14: si se cambia de organización con un `createAccessToken` en vuelo, el token se crea pero no se muestra; avisar
      con un toast o revocarlo. Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-15: tests de `update-task` con un usuario que ve el proyecto pero no puede actualizar la tarea (policy `update`) y
      de que `list-project-members` excluye a un `member` no asignado. Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-16: `ListTaskCommentsRequest`, `ListChannelsRequest` y `ListInvitationsRequest` tienen su copia privada de
      `validCursor`; usar `CursorPaginatedRequest::isValidCursor`. Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
