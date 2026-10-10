# Plan: integraciones

**Objetivo:** owner y admin administran desde la web las fuentes de log de un proyecto (crear, listar, rotar,
revocar, ver la key una sola vez con instrucciones de conexión), y cualquier sistema Laravel se conecta a la
ingesta con un paquete Composer reutilizable (`ascario/sereno-laravel`) extraído de posveapi.
**Estado:** en curso · Fase actual: 5
<!-- El hook plan-state busca "en curso" en esta línea. Pasar a "en curso" al empezar (hoy está activo acceso-proyectos). -->

## Contexto mínimo
- Apps afectadas: `web/` (fases 1 a 6, commits en la raíz de sereno); repo nuevo `../sereno-laravel`
  (fases 7 a 11, carpeta hermana de `workspace`); posveapi en `../posven/posveapi` (fase 12, repo propio).
- La API de fuentes ya existe y no cambia: `GET|POST projects/{project}/log-sources`,
  `DELETE .../log-sources/{source}` (marca `revoked_at`, idempotente, 200 con el resource),
  `POST .../{source}/rotate-key` (200; 409 si otra petición la cambió; 422 `project` archivado o `source` revocada).
  Resource: `id, project_id, name, key_prefix, last_used_at, revoked_at, created_at`; store y rotate agregan `key`
  (en claro, solo esa vez). Crear en proyecto archivado: 422 en `project`. Index lista también las revocadas.
  Policy: index cualquier rol; crear, rotar y revocar solo owner o admin.
- Ingesta: `POST {apiUrl}/api/ingest/events`, `Authorization: Bearer wsk_...`, cuerpo
  `{"events":[{level, message, context?, occurred_at?, fingerprint?}]}`, 1 a 100 eventos, 202 `{"accepted":n}`.
- Web: patrón de vista en `web/src/views/InvitationsView.vue` (lista, error con `role="alert"`, confirmación con
  `AppDialog`, toasts) y manejo de `ApiError` en `MembersView.vue`. Roles en `web/src/stores/organization.ts`.
  Pestañas del proyecto en `web/src/components/ProjectHeader.vue`. URL de la API: `config.apiUrl`
  (`web/src/config.ts`). No hay componente de copiar al portapapeles.
- posveapi: `app/Logging/{WorkspaceLogHandler,WorkspaceEventFormatter,CreateWorkspaceLogger}.php` (~470 líneas) y
  `tests/Unit/Logging/*` (~850). Depende de Laravel (facades Http, Log, `app()->terminating`, evento `Looping`,
  `Str`). Envía en lotes de 100, síncrono, sin reintentos; fallos al canal `daily`. Commits en la rama
  `feat/workspace-logs` sin merge. Decisiones de formato y flush en `docs/plans/terminados/conectar-posveapi.md`.
- No hay PHP en la máquina: el paquete se prueba en Docker (fase 7 fija el comando).
- Choque con `acceso-proyectos` (fases 13, 14 y 16 tocan `ProjectHeader.vue`, `api/types.ts`,
  `stores/organization.ts` e i18n): no correr las fases web de ambos planes en paralelo.

## Fases

### [x] Fase 1 — Cliente web de fuentes de log
- **Alcance:** tipo `LogSource` (y `LogSourceWithKey` con `key`) en `api/types.ts`; módulo `api/logSources.ts`
  con `listLogSources`, `createLogSource`, `rotateLogSourceKey`, `revokeLogSource`, siguiendo `api/members.ts`.
- **Archivos:** `web/src/api/types.ts`, `web/src/api/logSources.ts` (+ `logSources.spec.ts`).
- **Terminado cuando:** el spec verifica método, ruta y cuerpo de cada función; typecheck limpio.

### [x] Fase 2 — Vista de integraciones con la lista de fuentes
- **Alcance:** getter `canManageLogSources` (owner o admin); ruta `projects/:projectId/integrations`; vista que
  lista las fuentes (nombre, `key_prefix…`, último uso, creada, revocada) con carga, vacío y error; sin permiso,
  aviso en vez de la lista.
- **Archivos:** `stores/organization.ts`, `router/index.ts`, `views/IntegrationsView.vue` (+ spec), `i18n/en.json`,
  `i18n/es.json`. **[límite]**
- **Terminado cuando:** spec de la vista cubre lista, vacío, error y sin permiso.

### [x] Fase 3 — Pestaña Integraciones en el proyecto
- **Alcance:** enlace en `ProjectHeader` visible solo con `canManageLogSources`. `IntegrationsView` monta
  `ProjectHeader` como `LogView` y `PlanView` (proyecto del store, sin `<h1>` duplicado) y avisa si el proyecto no
  existe o no está en el store (hoy `notFound` solo cubre un id inválido).
- **Archivos:** `components/ProjectHeader.vue` (+ spec si existe), `views/IntegrationsView.vue` (+ spec), i18n.
- **Terminado cuando:** test: owner/admin ven la pestaña, member no; la vista muestra el header y el aviso de
  proyecto inexistente.

### [x] Fase 4 — Diálogo de key recién emitida
- **Alcance:** `CopyButton` (Clipboard API, toast al copiar o al fallar) y `LogSourceKeyDialog`: muestra la key
  completa con aviso de que no se vuelve a ver, el endpoint de ingesta, el bloque `.env` del paquete
  (`SERENO_LOG_URL`, `SERENO_LOG_KEY`) y un ejemplo `curl`. Al cerrar, la key se descarta del estado.
- **Archivos:** `components/ui/CopyButton.vue`, `components/LogSourceKeyDialog.vue` (+ specs), i18n.
- **Terminado cuando:** specs: copia el texto correcto, muestra la URL de `config.apiUrl`, al cerrar no queda la key.

### [ ] Fase 5 — Crear fuente
- **Alcance:** `CreateLogSourceDialog` (nombre; errores 422 de `name` y `project` archivado); al crear, agrega la
  fuente a la lista y abre `LogSourceKeyDialog`. Botón oculto si el proyecto está archivado.
- **Archivos:** `components/CreateLogSourceDialog.vue` (+ spec), `views/IntegrationsView.vue`, i18n.
- **Terminado cuando:** specs: alta correcta abre la key; 422 se muestra en el campo; archivado sin botón.

### [ ] Fase 6 — Rotar y revocar fuentes
- **Alcance:** acciones por fila con confirmación en `AppDialog`; rotar abre `LogSourceKeyDialog` con la key nueva;
  revocar actualiza la fila. Mensajes para 409 (recargar) y 422 (archivado o revocada). Revocadas sin acciones.
- **Archivos:** `views/IntegrationsView.vue` (+ spec), i18n.
- **Terminado cuando:** specs de rotar, revocar, 409 y 422; prueba manual en `http://localhost:5174` creando una
  fuente y enviando un evento con el `curl` del diálogo.

### [ ] Fase 7 — Esqueleto del paquete sereno-laravel [riesgo]
- **Alcance:** `git init` en `../sereno-laravel`; `composer.json` (`ascario/sereno-laravel`, namespace
  `Ascario\Sereno\`, PHP ^8.3, `illuminate/*` y `monolog/monolog` en las versiones que use posveapi, Testbench
  compatible con Laravel 13 verificado en su documentación); PHPUnit; comando de tests en Docker
  (imagen oficial de Composer o la del API, a decidir y anotar); un test trivial.
- **Archivos:** `composer.json`, `phpunit.xml`, `.gitignore`, `tests/TestCase.php`, test trivial.
- **Terminado cuando:** `composer install` y la suite corren en Docker y pasan.

### [ ] Fase 8 — Formatter en el paquete
- **Alcance:** traer `WorkspaceEventFormatter` como `Ascario\Sereno\Logging\EventFormatter` con sus tests, sin
  cambiar el comportamiento.
- **Archivos:** `src/Logging/EventFormatter.php` (+ test).
- **Terminado cuando:** los tests portados de posveapi pasan.

### [ ] Fase 9 — Handler en el paquete
- **Alcance:** traer `WorkspaceLogHandler` como `Ascario\Sereno\Logging\SerenoLogHandler` con sus tests; el
  canal de respaldo por defecto pasa a ser configurable (hoy fijo en `daily`).
- **Archivos:** `src/Logging/SerenoLogHandler.php` (+ test).
- **Terminado cuando:** los tests portados pasan.

### [ ] Fase 10 — Integración con Laravel
- **Alcance:** `SerenoServiceProvider` (auto-discovery) que fusiona `config/sereno.php` (`url`, `key`, `timeout`,
  `level`, `fallback_channel`, desde `SERENO_LOG_*`), lo publica y registra el canal `sereno` en
  `logging.channels` si la app no lo define; factory `CreateSerenoLogger` para `driver => custom`. Sin URL o key,
  el canal no envía nada.
- **Archivos:** `src/SerenoServiceProvider.php`, `src/Logging/CreateSerenoLogger.php`, `config/sereno.php`,
  `composer.json` (+ test con Testbench).
- **Terminado cuando:** test: `Log::channel('sereno')` usa el handler con la config; sin variables no hace HTTP.

### [ ] Fase 11 — README y primera versión del paquete
- **Alcance:** README (instalar con repositorio `vcs` de Gitea, variables, agregar `sereno` al `stack`, lotes,
  sin reintentos, FPM, acceso a repo privado con token); commit y tag `v0.1.0`. El usuario crea el repo en Gitea;
  el push solo con su pedido.
- **Archivos:** `README.md`.
- **Terminado cuando:** README completo y tag local creado; push hecho si el usuario lo pide.

### [ ] Fase 12 — posveapi usa el paquete [riesgo]
- **Alcance:** en posveapi (rama desde `feat/workspace-logs`, a confirmar con el usuario): repositorio `vcs` y
  `require` del paquete; `config/logging.php` usa `CreateSerenoLogger` manteniendo `WORKSPACE_LOG_*` (o migra a
  `SERENO_LOG_*`, a decidir); se borran `app/Logging/*` y sus tests unitarios; `WorkspaceLogChannelsTest` se adapta.
- **Archivos:** `composer.json`, `composer.lock`, `config/logging.php`, `config/services.php`, borrar `app/Logging/*`.
- **Terminado cuando:** la suite de posveapi pasa y un evento real llega al canal del proyecto en local.

## Decisiones
- 2026-10-10 — El paquete vive en un repo propio en Gitea, no en el monorepo: Composer no instala bien desde una
  subcarpeta. Se instala con un repositorio `vcs` y tags semver.
- 2026-10-10 — Solo Laravel (ServiceProvider, config publicable, canal listo), reusando lo de posveapi. Otros
  lenguajes usan el endpoint directo (el diálogo de la key muestra el `curl`).
- 2026-10-10 — La pestaña Integraciones es solo para owner y admin, aunque la API deja listar a cualquier rol.
- 2026-10-10 — La API de fuentes no cambia; si acceso-proyectos (fase 7) cambia la autorización del index, la web
  la hereda.
- 2026-10-10 — La fase 3 suma montar `ProjectHeader` en `IntegrationsView` (como las demás pestañas del proyecto) y
  el aviso de proyecto inexistente, para poder volver a canal, plan y log desde Integraciones.

## Notas para la próxima sesión
- Fase 4: `LogSourceKeyDialog` con `v-model:source` (`LogSourceWithKey | null`): abierto mientras no es null, al
  cerrar queda null; las fases 5 y 6 solo asignan la fuente devuelta. `SERENO_LOG_URL` = `config.apiUrl` sin ruta
  (el handler agrega `/api/ingest/events`). `CopyButton` recibe `text` y `label`.
- Fase 3: pestaña con icono `Plug`. `IntegrationsView` pide fuentes solo con el proyecto en el store; su spec usa
  un `stubGet` por ruta (`/api/projects`, `/api/channels`, log-sources) y filtra con `sourceCalls`: las fases 4 a 6
  lo reutilizan. Estructura: `<section>` con `ProjectHeader` y `div.integrations__body` (padding y `<h2>`).
- Fase 2: `canManageLogSources` delega en `canManageInvitations`; sin permiso, aviso `data-test="no-permission"` sin
  llamar a la API. Filas `data-test="source"` con `name`, `prefix`, `last-used` ("Never" si null), `created`, `revoked`.
  La vista descarta respuestas viejas (generación y AbortController).
- Fase 1: `api/logSources.ts` con list, create, rotate (POST sin cuerpo) y revoke (DELETE, devuelve la fuente); `LogSourceWithKey` solo al crear o rotar.
- Ejecución en el worktree `.claude/worktrees/plan-integraciones` (rama `docs/plan-integraciones`, main mergeado el 2026-10-10). Los contenedores montan el checkout principal: verificar web con `docker run --rm -v "$PWD/web:/app" -v workspace_web-node-modules:/app/node_modules -w /app node:24 npm run test -- --run <spec>` (y `npm run typecheck`).

## Mejoras propuestas
- [ ] M-1 — `canManageLogSources` es un alias de `canManageInvitations`: definirlo con su propia regla de roles para
  no acoplar el permiso de integraciones al de invitaciones. Complejidad: baja (sonnet).
- [ ] M-2 — Revisar que el sidebar marque el proyecto activo también en la ruta `project-integrations` si lo decide
  por nombre de ruta. Complejidad: baja (sonnet).
- [ ] M-3 — `projectMissing` en `IntegrationsView` exige `!projects.loading && !projects.failed`: si la vista monta
  antes de que el store empiece a cargar puede verse un instante "no encontrado"; distinguir "nunca cargó".
  Complejidad: baja (sonnet).
