# Plan: integraciones

**Objetivo:** owner y admin administran desde la web las fuentes de log de un proyecto (crear, listar, rotar,
revocar, ver la key una sola vez con instrucciones de conexión), y cualquier sistema Laravel se conecta a la
ingesta con un paquete Composer reutilizable (`ascario/sereno-laravel`) extraído de posveapi.
**Estado:** terminado
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

### [x] Fase 5 — Crear fuente
- **Alcance:** `CreateLogSourceDialog` (nombre; errores 422 de `name` y `project` archivado); al crear, agrega la
  fuente a la lista y abre `LogSourceKeyDialog`. Botón oculto si el proyecto está archivado.
- **Archivos:** `components/CreateLogSourceDialog.vue` (+ spec), `views/IntegrationsView.vue`, i18n.
- **Terminado cuando:** specs: alta correcta abre la key; 422 se muestra en el campo; archivado sin botón.

### [x] Fase 6 — Rotar y revocar fuentes
- **Alcance:** acciones por fila con confirmación en `AppDialog`; rotar abre `LogSourceKeyDialog` con la key nueva;
  revocar actualiza la fila. Mensajes para 409 (recargar) y 422 (archivado o revocada). Revocadas sin acciones.
- **Archivos:** `views/IntegrationsView.vue` (+ spec), i18n.
- **Terminado cuando:** specs de rotar, revocar, 409 y 422; prueba manual en `http://localhost:5174` creando una
  fuente y enviando un evento con el `curl` del diálogo.

### [x] Fase 7 — Esqueleto del paquete sereno-laravel [riesgo]
- **Alcance:** `git init` en `../sereno-laravel`; `composer.json` (`ascario/sereno-laravel`, namespace
  `Ascario\Sereno\`, PHP ^8.3, `illuminate/*` y `monolog/monolog` en las versiones que use posveapi, Testbench
  compatible con Laravel 13 verificado en su documentación); PHPUnit; comando de tests en Docker
  (imagen oficial de Composer o la del API, a decidir y anotar); un test trivial.
- **Archivos:** `composer.json`, `phpunit.xml`, `.gitignore`, `tests/TestCase.php`, test trivial.
- **Terminado cuando:** `composer install` y la suite corren en Docker y pasan.

### [x] Fase 8 — Formatter en el paquete
- **Alcance:** traer `WorkspaceEventFormatter` como `Ascario\Sereno\Logging\EventFormatter` con sus tests, sin
  cambiar el comportamiento.
- **Archivos:** `src/Logging/EventFormatter.php` (+ test).
- **Terminado cuando:** los tests portados de posveapi pasan.

### [x] Fase 9 — Handler en el paquete
- **Alcance:** traer `WorkspaceLogHandler` como `Ascario\Sereno\Logging\SerenoLogHandler` con sus tests; el
  canal de respaldo por defecto pasa a ser configurable (hoy fijo en `daily`).
- **Archivos:** `src/Logging/SerenoLogHandler.php` (+ test), `composer.json` (`illuminate/events` e
  `illuminate/queue` ^13.0, que usa `Event::listen(Looping::class)`).
- **Terminado cuando:** los tests portados pasan.

### [x] Fase 10 — Integración con Laravel
- **Alcance:** `SerenoServiceProvider` (auto-discovery) que fusiona `config/sereno.php` (`url`, `key`, `timeout`,
  `level`, `fallback_channel`, desde `SERENO_LOG_*`), lo publica y registra el canal `sereno` en
  `logging.channels` si la app no lo define; factory `CreateSerenoLogger` para `driver => custom`. Sin URL o key,
  el canal no envía nada. Un `fallback_channel` vacío se normaliza a `daily` (`Log::channel('')` falla en silencio).
- **Archivos:** `src/SerenoServiceProvider.php`, `src/Logging/CreateSerenoLogger.php`, `config/sereno.php`,
  `composer.json` (+ test con Testbench).
- **Terminado cuando:** test: `Log::channel('sereno')` usa el handler con la config; sin variables no hace HTTP.

### [x] Fase 11 — README y primera versión del paquete
- **Alcance:** README (instalar con repositorio `vcs` de Gitea, variables, agregar `sereno` al `stack`, lotes,
  sin reintentos, FPM, acceso a repo privado con token); commit y tag `v0.1.0`. El usuario crea el repo en Gitea;
  el push solo con su pedido.
- **Archivos:** `README.md`.
- **Terminado cuando:** README completo y tag local creado; push hecho si el usuario lo pide.

### [x] Fase 12 — posveapi usa el paquete [riesgo]
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
- 2026-10-10 — Paquete: repo `../sereno-laravel` (main con commit vacío), trabajo en su worktree
  `.claude/worktrees/paquete` (rama `feat/paquete`). Tests en Docker con la imagen oficial `composer:2` (no depende
  del monorepo), desde la raíz del paquete:
  `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/app" -w /app composer:2 sh -c 'composer update --no-interaction --no-progress -q && vendor/bin/phpunit'`.
  `illuminate/{contracts,http,log,support}` ^13.0, `monolog/monolog` ^3.10 (como posveapi), dev `orchestra/testbench`
  ^11.0 y `phpunit/phpunit` ^12.5.12. `composer.lock` no se versiona (librería). La imagen trae PHP 8.5: el mínimo
  ^8.3 no se prueba.
- 2026-10-10 — Fase 12 (usuario): la rama de posveapi sale de `pharmacies` (ya contiene `feat/workspace-logs`); las
  variables pasan a `SERENO_LOG_*`; URL del paquete `https://gitea.ascario.dev/ascario/sereno-laravel.git` (repo
  creado y vacío).
- 2026-10-10 — La fase 3 suma montar `ProjectHeader` en `IntegrationsView` (como las demás pestañas del proyecto) y
  el aviso de proyecto inexistente, para poder volver a canal, plan y log desde Integraciones.

## Notas para la próxima sesión
- Fase 12: posveapi en la rama `feat/sereno-paquete` (desde `pharmacies`, worktree
  `posveapi/.claude/worktrees/sereno-paquete`, sin merge ni push). `slack` y `critical_alerts` usan `CreateSerenoLogger`
  con el mismo fallback a Slack; `scripts/build-notify.js` también pasó a `SERENO_LOG_*`. `package:discover` lista el
  paquete, tests de logging OK y un evento real de `Log::channel('sereno')` llegó a Sereno local (fuente
  `posveapi-paquete` en DEMO). Paquete subido a Gitea (`main` y `v0.1.0`) a pedido del usuario. Pendiente del
  usuario: renombrar `WORKSPACE_LOG_*` a `SERENO_LOG_*` en los `.env` reales (si no, cae a Slack sin aviso) y dar a
  Composer credenciales `http-basic.gitea.ascario.dev` en CI y producción.
- Fase 11: README en inglés; tag local `v0.1.0` en el último commit de `feat/paquete` (sin merge a `main` del
  paquete ni push: los pide el usuario). Repo privado con `http-basic.gitea.ascario.dev USUARIO TOKEN` (Composer no
  soporta `gitea-token`; verificado con Composer 2.10.3). Supuestos a confirmar: URL
  `https://gitea.ascario.dev/ascario/sereno-laravel.git` y scope del token `read:repository`. Sin licencia en el
  README (`composer.json` dice `proprietary`).
- Antes de la fase 12 el usuario decide: rama de posveapi (desde `feat/workspace-logs`), `WORKSPACE_LOG_*` o
  `SERENO_LOG_*`, y cómo instala posveapi el paquete sin el repo en Gitea (crear y subir el repo, o un repositorio
  `path` local temporal).
- Fase 10: el provider registra el canal `sereno` en `register()` solo si `logging.channels.sereno` no existe (vale
  con `config:cache`); publica con el tag `sereno-config`. Variables `SERENO_LOG_URL`, `_KEY`, `_TIMEOUT`, `_LEVEL`,
  `_FALLBACK_CHANNEL`. Testbench no usa el auto-discovery del paquete raíz: `tests/TestCase.php` declara el provider
  en `getPackageProviders`; el auto-discovery real se prueba en la fase 12. El README debe decir que `sereno` se
  agrega al `stack` a mano.
- Fase 9: `SerenoLogHandler` igual al de posveapi salvo nombres, mensajes de fallo "Sereno log ..." y el último
  parámetro del constructor `string $fallbackChannel` (default `DEFAULT_FALLBACK_CHANNEL` = `daily`): la factory de
  la fase 10 usa argumentos con nombre. Tests con `composer update` (el lock local queda viejo al cambiar
  `composer.json`).
- Fase 8: `EventFormatter` igual al de posveapi salvo floats no finitos: `'NAN'`/`'INF'`/`'-INF'` explícitos en vez de
  `(string) $value`, que en PHP 8.5 lanza "coerced to string" (misma salida). Su test usa la base Testbench
  `Ascario\Sereno\Tests\TestCase`. Escribir PHP con Edit/Write: heredocs, sed y python rompen las `\` de namespaces.
- Fase 7: tests PHPUnit en clases (como posveapi); `phpunit.xml` solo tiene el suite `tests/Unit`: ampliarlo si la
  fase 10 agrega `tests/Feature`. Escribir JSON con Write/Edit, no con heredocs (el escape de `\` rompió
  `composer.json`).
- Fase 6: acciones `data-test=rotate|revoke` con confirmación (`confirm`, `cancel`); 409 y 422 dan toast y recargan.
  Prueba manual hecha en una Vite temporal del worktree (`docker run ... -p 5175:5174`, CORS del API es `*`, login
  con el usuario del seeder): crear, curl del diálogo (202), aviso en el canal, rotar y revocar. Quedó revocada la
  fuente `integraciones-manual` en DEMO.
- Fase 5: `CreateLogSourceDialog` valida vacío y 255 caracteres (`[...s].length`). La vista agrega la fuente sin `key`
  y asigna la completa a `issuedSource`; `reset()` cierra diálogos y descarta la key al cambiar proyecto,
  organización o permiso: rotar (fase 6) reutiliza `issuedSource`. El store de proyectos filtra archivados, así que
  el `v-if` del botón es defensa.
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
- [x] M-1 — `canManageLogSources` es un alias de `canManageInvitations`: definirlo con su propia regla de roles para
  no acoplar el permiso de integraciones al de invitaciones. Complejidad: baja (sonnet).
- [x] M-2 — Revisar que el sidebar marque el proyecto activo también en la ruta `project-integrations` si lo decide
  por nombre de ruta. Complejidad: baja (sonnet).
- [x] M-3 — `projectMissing` en `IntegrationsView` exige `!projects.loading && !projects.failed`: si la vista monta
  antes de que el store empiece a cargar puede verse un instante "no encontrado"; distinguir "nunca cargó".
  Complejidad: baja (sonnet).
- [x] M-4 — Una carga de la lista en vuelo al crear puede pisar la fuente recién agregada (`IntegrationsView` `load()`
  asigna `sources` sin mirar lo creado): ocultar o deshabilitar el botón de crear mientras `loading`, con spec.
  Complejidad: baja (sonnet).
- [x] M-5 — Quitar la variable sin uso `_key` en `IntegrationsView.vue` (`onCreated`). Complejidad: baja (sonnet).
- [x] M-6 — Claves i18n duplicadas en `integrations` (`rotate`/`rotateAction`, `revoke`/`revokeAction`): reutilizar
  una de cada par. Complejidad: baja (sonnet).
- [x] M-7 — Los avisos de 409 y 422 de rotar o revocar no dicen qué acción falló; el 422 es genérico (archivado o
  revocada). Complejidad: baja (sonnet).
- [x] M-8 — En posveapi, `WorkspaceEventFormatter` hace `(string) $value` con floats no finitos, que lanza en PHP 8.5:
  aplicar el arreglo de la fase 8 si posveapi no pasa al paquete o corre PHP 8.5. Queda resuelto si la fase 12 se
  hace. Complejidad: baja (sonnet).
- [ ] M-9 — `SERENO_LOG_LEVEL=` vacío hace `Level::fromName('')` y lanza `ValueError` al resolver el canal
  (`CreateSerenoLogger`): tratar el vacío como `debug`, como el `fallback_channel`, con test. Complejidad: baja (sonnet).
- [ ] M-10 — `test_no_pisa_un_canal_definido_por_la_app` llama a `register()` a mano: definir el canal en
  `defineEnvironment` para seguir el orden real de arranque; y opcionalmente probar `vendor:publish --tag=sereno-config`.
  Complejidad: baja (sonnet).
- [ ] M-11 — Con organización activa `null`, `clear()` deja `projects.loaded = false` y `IntegrationsView` mostraría
  "cargando" sin fin; hoy las rutas exigen organización. Complejidad: baja (sonnet).
- [ ] M-12 — Si una recarga (cambio de proyecto u organización) cierra el diálogo de crear con la creación en vuelo,
  la fuente queda creada en el servidor y la key, que solo se ve una vez, se pierde: avisar o rotar. Caso raro.
  Complejidad: baja (sonnet).
- [ ] M-13 — Revocar es idempotente en el API (nunca 409 ni 422): `revokeConflict`, `revokeUnavailable`, la rama
  `revoke` de `unavailableKey` y el spec de revocar con 422 cubren un caso inalcanzable; quitarlos o dejarlos como
  defensa, a decidir. Complejidad: baja (sonnet).
