# Plan: log

**Objetivo:** los sistemas de cada proyecto envían eventos con una API key de fuente; la API los recibe en lote,
los procesa por cola, los agrupa por fingerprint y los conserva un tiempo limitado. Se pueden listar los grupos
de un proyecto y cambiar su estado. (Paso 2 del MVP; los avisos a canales son el paso 3.)
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Repo afectado: `workspace-api` (commits con `git -C workspace-api`).
- `app/` es plano por tipo (Models, Http/Controllers/Api, Http/Requests/<Entidad>, Policies, Enums, Support).
  Lo de este módulo lleva prefijo `Log` (`LogSource`, `LogGroup`, `LogEvent`, `LogLevel`).
- Tenant: trait `BelongsToOrganization` + `OrganizationScope` (falla cerrado sin organización activa);
  `CurrentOrganization::set()` también fija el team de spatie. La ingesta no trae `X-Organization-Id`: la
  organización sale de la fuente.
- Patrón de secreto: `Invitation::newPlainToken()` / `hashToken()` (SHA-256) / `findByPlainToken()` con
  `withoutGlobalScope`. Se guarda solo el hash.
- Colas: `QUEUE_CONNECTION=database` (tablas `jobs` y `failed_jobs` ya migradas), `sync` en `phpunit.xml`.
  Hoy no hay worker ni scheduler en `docker-compose.yml`.
- Rate limiters en `AppServiceProvider::configureRateLimiting()`, 429 traducido con `tooManyAttemptsResponse`.
- Lecciones vigentes: L-02 (el middleware del tenant limpia al empezar), L-03 (team en `finally`),
  L-04 (autorizar antes de validar), L-05 (excepciones del framework no pasan por `__()`).

## Fases

### [x] Fase 1 — Worker de cola y scheduler en Docker
- **Alcance:** servicios `queue` (`php artisan queue:work --tries=3`) y `scheduler` (`php artisan schedule:work`)
  en `workspace-api/docker-compose.yml`, con la misma imagen y volumen que `api`, `depends_on: postgres` y
  `restart: unless-stopped`. Documentar en `CLAUDE.md` (raíz, Comandos) cómo ver sus logs y que hay que
  reiniciar `queue` tras cambiar código de jobs.
- **Archivos:** `workspace-api/docker-compose.yml`, `CLAUDE.md`.
- **Terminado cuando:** `docker compose up -d` deja `queue` y `scheduler` en estado running, y un job de prueba
  despachado con `php artisan tinker --execute` se procesa (aparece en `docker compose logs queue`) sin quedar en `jobs`.

### [x] Fase 2 — Notificación de invitación por cola (M-17 de nucleo, parte 1)
- **Alcance:** `InvitationNotification` implementa `ShouldQueue`. El enlace a `workspace-web` sigue pendiente.
- **Archivos:** `app/Notifications/InvitationNotification.php`.
- **Terminado cuando:** test con `Notification::fake()` / `Queue::fake()` confirma que se encola, y `InvitationApiTest` pasa.

### [x] Fase 3 — Modelo de fuentes de log
- **Alcance:** tabla `log_sources` (organization_id, project_id FK cascade, name, key_hash único, key_prefix
  para mostrar, last_used_at, revoked_at), modelo con `BelongsToOrganization`, `newPlainKey()` (prefijo `wsk_`),
  `findByPlainKey()` sin scope, factory y `LogSourcePolicy` (owner/admin gestionan, miembros ven).
- **Archivos:** migración, `app/Models/LogSource.php`, factory, `app/Policies/LogSourcePolicy.php`, `.claude/rules/database.md`.
- **Terminado cuando:** tests de modelo y policy pasan, incluido el aislamiento entre organizaciones.

### [x] Fase 4 — API de fuentes
- **Alcance:** `GET/POST /api/projects/{project}/log-sources` y `DELETE .../log-sources/{source}` (revoca, no borra).
  El POST devuelve la key en claro una sola vez. Proyecto archivado: no se crean fuentes.
- **Archivos:** controller, FormRequest, Resource, `routes/api.php`, `lang/*.json`.
- **Terminado cuando:** tests de API (crear, listar sin key, revocar, member 403, otra organización 404/403).

### [x] Fase 5 — Autenticación de ingesta por API key [riesgo]
- **Alcance:** middleware `log.source`: lee `Authorization: Bearer wsk_...`, resuelve la fuente (no revocada,
  proyecto no archivado), fija la organización activa (limpiándola al empezar, L-02) y deja la fuente en la
  petición; 401 traducido si falla. Rate limiter `log-ingest` por fuente. `last_used_at` sin escribir en cada
  petición (como mucho una vez por minuto).
- **Archivos:** `app/Http/Middleware/AuthenticateLogSource.php`, `bootstrap/app.php`, `AppServiceProvider`, `LogSource`, `lang/*.json`.
- **Terminado cuando:** tests con una ruta de prueba: key válida, revocada, de proyecto archivado, mal formada y ausente; 429 al pasar el límite.

### [x] Fase 6 — Tabla de grupos
- **Alcance:** enum `LogLevel` (debug, info, notice, warning, error, critical, alert, emergency, como PSR-3) y
  tabla `log_groups` (organization_id, project_id, fingerprint, level, title, status `open|resolved|ignored`
  con CHECK, first_seen_at, last_seen_at, events_count; único `(project_id, fingerprint)`). Modelo y factory.
- **Archivos:** migración, `app/Enums/LogLevel.php`, `app/Models/LogGroup.php`, factory, `database.md`.
- **Terminado cuando:** tests de modelo (único por proyecto, aislamiento) pasan.

### [x] Fase 7 — Tabla de eventos particionada [riesgo]
- **Alcance:** `log_events` particionada por rango diario de `received_at` (hora del servidor; `occurred_at` del
  cliente se guarda aparte). PK `(id, received_at)`, FK a `log_groups` y `organizations`, `context` jsonb.
  `LogPartitions::ensure(date)` crea la partición del día si falta (`CREATE TABLE IF NOT EXISTS ... PARTITION OF`).
  La migración crea hoy y los próximos 7 días y su `down()` borra todo.
- **Archivos:** migración, `app/Models/LogEvent.php`, `app/Support/LogPartitions.php`, `database.md`.
- **Terminado cuando:** test que inserta en dos días distintos y verifica las particiones en `pg_inherits`; `migrate:fresh` funciona.

### [x] Fase 8 — Registro y agrupado de eventos [riesgo]
- **Alcance:** `LogEventRecorder::record(LogSource, array $event)`: fingerprint dado por el cliente o calculado
  (SHA-256 del mensaje normalizado, sin el nivel, sin números, UUIDs ni hex largos), upsert atómico del grupo con
  `INSERT ... ON CONFLICT (project_id, fingerprint) DO UPDATE` (count + 1, last_seen_at, nivel máximo) e insert del evento.
- **Archivos:** `app/Support/LogEventRecorder.php`, `app/Support/LogFingerprint.php`.
- **Terminado cuando:** tests: mismo mensaje con distinto id cae en el mismo grupo, fingerprint explícito manda, contador correcto.

### [x] Fase 9 — Endpoint de ingesta por cola
- **Alcance:** `POST /api/ingest/events` con `log.source`: lote de 1 a 100 eventos (level, message ≤ 8 KB,
  context ≤ 32 KB, occurred_at opcional, fingerprint opcional). Valida, encola `IngestLogEvents` y responde 202.
  El job llama a `LogEventRecorder::record()`, que ya asegura la partición del día.
- **Archivos:** controller, FormRequest, `app/Jobs/IngestLogEvents.php`, `routes/api.php`, `lang/*.json`.
- **Terminado cuando:** tests de validación (422 sin 500 con tipos raros), `Queue::fake` confirma el job, y con
  cola `sync` los eventos quedan agrupados. Prueba manual con curl y el worker de la fase 1.

### [x] Fase 10 — Retención y mantenimiento de particiones [riesgo]
- **Alcance:** comando `log:maintain`: crea particiones hasta +7 días, borra (`DROP TABLE`) las anteriores a la
  retención y borra grupos sin eventos desde entonces. Retención global en config (`LOG_RETENTION_DAYS`, 30 por
  defecto). Programado a diario en `routes/console.php`.
- **Archivos:** `app/Console/Commands/MaintainLogPartitions.php`, `config/workspace.php`, `routes/console.php`, `LogPartitions`.
- **Terminado cuando:** test que simula días viejos (`travelTo`) y verifica qué particiones y grupos quedan; `schedule:list` lo muestra.

### [x] Fase 11 — API de lectura de grupos
- **Alcance:** `GET /api/projects/{project}/log-groups` paginado (filtros `status`, `level`, orden `last_seen_at`
  desc) y `GET .../log-groups/{group}` con los últimos 50 eventos.
- **Archivos:** controller, FormRequest, `LogGroupResource`, `LogEventResource`, `routes/api.php`.
- **Terminado cuando:** tests de API, filtros, paginación y aislamiento.

### [x] Fase 12 — Ciclo de estado de grupos
- **Alcance:** `PATCH .../log-groups/{group}` con `status` (resolve, ignore, reopen; owner/admin y member según
  policy) y regresión: un evento nuevo en un grupo `resolved` lo reabre; en `ignored` solo suma.
- **Archivos:** `LogGroupPolicy`, controller, FormRequest, `LogEventRecorder`, `lang/*.json`.
- **Terminado cuando:** tests de transiciones, permisos y regresión.

## Decisiones
- 2026-10-06 — Cola `database` con worker en Docker, sin Redis ni Horizon por ahora: no hay dependencias nuevas y
  el volumen inicial (posveapi) lo soporta. Redis/Horizon cuando el volumen lo pida.
- 2026-10-06 — Ingesta con `Authorization: Bearer wsk_...`, ruta propia fuera de `auth:sanctum`: es lo estándar
  para clientes HTTP de logs.
- 2026-10-06 — Particiones diarias por `received_at` (no por `occurred_at`, que viene del cliente y puede ser
  cualquier fecha). Sin partición DEFAULT: el job y el comando crean la del día.
- 2026-10-06 — Retención global por ahora; por organización o plan, cuando haya facturación.
- 2026-10-06 — M-21 (TrustProxies) no entra: la ingesta limita por fuente, no por IP. Sigue pendiente para el despliegue.
- 2026-10-06 — La regla "fuente y proyecto de la misma organización" vive en hooks del modelo `LogSource`, no solo en la policy, para cubrir jobs y comandos.
- 2026-10-06 — Crear fuente en proyecto archivado responde 422 (error en el campo `project`), como el resto de validaciones.
- 2026-10-06 — La fuente autenticada viaja como atributo de la petición, no como binding scoped.
- 2026-10-06 — `log_events` sin índices por `organization_id` ni `log_source_id`: abarata la escritura; borrar una organización
  recorre las ~30 particiones, aceptable con la retención. `project_id` sin FK (la integridad llega por el grupo).
- 2026-10-06 — Las migraciones de particiones repiten el SQL con literales en vez de importar `LogPartitions`.
- 2026-10-06 — El nivel no entra en el fingerprint: un mismo fallo que pasa de warning a error es un solo grupo con el nivel máximo.
  Fingerprint explícito: SHA-256 de `explicit:<valor>`; calculado: SHA-256 de `message:<primeros 1024 bytes normalizados>`.
- 2026-10-06 — `first_seen_at`/`last_seen_at` del grupo usan `received_at`, no `occurred_at` del cliente.
- 2026-10-06 — `IngestLogEvents` con `$tries = 1`: un reintento del lote duplicaría eventos. Un fallo pierde el resto del lote
  (queda en `failed_jobs`). Una fuente revocada después del 202 se procesa igual; una borrada se descarta.
- 2026-10-06 — Las particiones viejas se borran con DROP directo (sin DETACH) con `lock_timeout` de 10 s y el mismo advisory
  lock que `ensure()`; si no consigue el lock, falla y reintenta al día siguiente.
- 2026-10-06 — El filtro `level` de grupos es "mínimo" (severidad >= dada), no igualdad.
- 2026-10-06 — Cualquier miembro cambia el estado de un grupo (triage reversible), también en proyectos archivados.
- 2026-10-06 — El aviso a canales (evento de dominio al abrir o reabrir un grupo) es del paso 3.

## Notas para la próxima sesión
- Fases 1 a 3 cerradas. `queue` y `scheduler` en Docker (`docker compose restart queue` tras cambiar jobs).
- `LogSource`: `newPlainKey()` da `wsk_` + 40; se guarda `key_hash` (SHA-256, Hidden) y `key_prefix` (12). `project_id`
  no está en Fillable: crear por relación (`$project->logSources()` o fijarlo antes de guardar). Hooks `creating`/`updating`
  exigen que el proyecto sea de la misma organización. Policy: `viewAny`, `view`, `create`, `revoke` (no hay delete).
- Archivar un proyecto no toca sus fuentes: la fase 5 comprueba `archived_at` (`Project::isArchived()`, `LogSource::isRevoked()`).
- Fase 12: `PATCH .../log-groups/{group}` (`status`), cualquier miembro; regresión `resolved` → `open` con CASE en el upsert.
- Fase 11: `GET /api/projects/{project}/log-groups` (filtros `status` y `level` mínimo, paginado como proyectos) y
  `GET .../log-groups/{group}` con `data.events` (50 últimos dentro de la retención). `LogGroupController` y `LogGroupPolicy`
  (viewAny/view) existen: la fase 12 agrega `update` y el PATCH.
- Fase 10: `log:maintain` (00:10 UTC) y `queue:prune-failed --hours=168` (00:20 UTC). `config/workspace.php`
  (`log_retention_days`, env `LOG_RETENTION_DAYS`, mínimo 1). `LogPartitions`: `ensureRange`, `all`, `dropBefore`.
- Fase 9: `POST /api/ingest/events` (log.source + throttle:log-ingest) → 202 `{accepted}`. `IngestLogEvents` cifrado,
  `$tries = 1`, lleva el id de la fuente. Body máx. 5 MB (413 en `authorize()`), context ≤ 32 KB y profundidad 8,
  el byte nulo (` `) → 422, `occurred_at` > 5 min en el futuro se ajusta a la recepción.
- Fase 8: `LogEventRecorder::record(LogSource, array)` devuelve el `LogEvent`; supone datos validados (nivel inválido → ValueError,
  fecha inválida → excepción de Carbon). Llama a `LogPartitions::ensure` solo. La regresión de la fase 12 va en
  `LogEventRecorder::conflictAssignments()`. No hay `LogEventFactory`.
- Fase 7: `log_events` particionada por día UTC de `received_at` (timestamp(0)), PK (id, received_at); `LogPartitions::ensure($day)`
  con advisory lock. `LogEvent`: `received_at` = CREATED_AT, sin updated_at; ids de grupo/proyecto/fuente fuera de Fillable.
  Para la fase 8: `occurred_at` NOT NULL (si falta, usar `received_at`); `organization_id`/`project_id` iguales a los del grupo;
  `received_at` en segundos enteros (con fracciones Postgres redondea y puede caer en el día siguiente). Falta `LogEventFactory`.
- Fase 6: `LogLevel` (PSR-3, `severity()` 0-7, `isAtLeast()`, `LogLevel::highest()`), `LogGroupStatus`, `log_groups`
  (`LogGroup::TITLE_MAX_LENGTH` = 255, status default `open`). Trait `EnsuresProjectInOrganization` (lo usan LogSource y LogGroup).
  El upsert crudo de la fase 8 no pasa por hooks: fijar `organization_id` a mano y truncar `title`.
- Fase 5: middleware `log.source` (`AuthenticateLogSource`): todo fallo da el mismo 401; fija la organización activa;
  la fuente se lee con `AuthenticateLogSource::source($request)`. Limiter `log-ingest` por fuente (600/min,
  `AppServiceProvider::LOG_INGEST_REQUESTS_PER_MINUTE`); `log.source` va antes de `throttle` por prioridad.
- Fase 4: `/api/projects/{project}/log-sources` (GET, POST, DELETE revoca). La key en claro sale solo en el POST
  (`data` + `key`). Proyecto archivado al crear: 422 con error en `project`. `Project::logSources()` existe.

## Mejoras propuestas
- [x] M-1: (aplicada en la fase 10) programar `queue:prune-failed` (p. ej. 7 días) para que `failed_jobs` no acumule payloads y trazas.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet (encaja en la fase 10)
- [x] M-2: validar que un proyecto no cambie de `organization_id` si tiene fuentes (hoy ninguna ruta lo permite).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-3: que `SetLocale` no llame a `user('sanctum')` si el Bearer empieza con `wsk_` (hoy hace una consulta inútil a `personal_access_tokens` por cada petición de ingesta).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-4: limitar por IP los fallos de autenticación de ingesta (401 repetidos). Depende de M-21 de nucleo (TrustProxies).
      Complejidad: media · Archivos: 2 · Riesgo: seguridad → opus
- [ ] M-5: (prerrequisito del paso 5 del MVP, antes de conectar posveapi) ingesta idempotente (id de evento del cliente o un job por evento) para poder reintentar sin duplicar ni perder el resto del lote.
      Complejidad: alta · Archivos: 3-4 · Riesgo: BD y contrato público → opus
- [x] M-6: limitar el tamaño del body también en el servidor (`post_max_size` en la imagen PHP y el proxy al desplegar), para no cargar 5 MB+ en memoria antes del 413.
      Complejidad: baja · Archivos: 1-2 · Riesgo: ninguno → sonnet
- [x] M-7: `LogPartitions::NAME_PATTERN` con `\z` (o modificador `D`) en vez de `$`, que acepta un `
` final.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-8: ordenar las rutas de `log-groups` aparte de las de `log-sources` en `routes/api.php`, test de `show` sin eventos y `$this->enum()` en `ListLogGroupsRequest`.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
