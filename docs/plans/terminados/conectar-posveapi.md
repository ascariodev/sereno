# Plan: conectar-posveapi

**Objetivo:** que los avisos de posveapi que hoy van a Slack (canales `slack` y `critical_alerts`, y el aviso de build)
se envíen a la ingesta de workspace-api y aparezcan en el canal del proyecto, y que luego se pueda retirar Slack.
**Estado:** terminado (fase 7 aplazada por decisión del usuario) · Fase actual: —
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Repos afectados: `workspace-api` (fase 1) y `../posven/posveapi` (fases 2 a 7). Commits con
  `git -C workspace-api` y `git -C "C:/Users/Windows 11/Documents/Development/posven/posveapi"`.
- posveapi tiene sus propias reglas: leer `posven/CLAUDE.md` y `posveapi/CLAUDE.md` antes de tocarlo. Laravel 13,
  PHP 8.3, PHPUnit 12 (`docker compose exec app vendor/bin/phpunit <ruta>` desde `posven/`), cola `sync`,
  rama base `pharmacies`, nunca `cd` (rutas absolutas), sin pint en el contenedor, `--no-verify` solo con permiso
  explícito en cada commit, sin push ni merge. Grafo: `posven/.graphify-workspace/posveapi/graphify-out/graph.json`.
- Contrato de ingesta (workspace-api): `POST /api/ingest/events`, `Authorization: Bearer wsk_...`, cuerpo
  `{"events":[{level, message, context?, occurred_at?, fingerprint?}]}`, 1 a 100 eventos, 202 `{"accepted":n}`.
  Un solo evento inválido rechaza el lote entero (422): `level` PSR-3 en minúsculas, `message` ≤ 8192 caracteres,
  `context` objeto ≤ 32 KB serializado y ≤ 8 niveles, sin byte nulo, `fingerprint` ≤ 255. 600 peticiones/min por
  fuente. Detalle en `workspace-api/app/Http/Requests/LogIngest/IngestEventsRequest.php`.
- posveapi hoy: `config/logging.php` define `stack` = `daily` + `critical_alerts` (nivel `error`) y `slack`
  (nivel `info`), ambos `SlackWebhookHandler` con `LOG_SLACK_WEBHOOK_URL`. Unos 20 archivos llaman a
  `Log::channel('slack'|'critical_alerts')` (SICM, imprenta digital, `LogApiRequest`, BCV...). Ninguno se toca: se
  cambia a dónde apuntan los canales. `scripts/build-notify.js` hace POST directo al webhook en `npm run build`.
- Sin PHP local en ninguna parte: todo por Docker.

## Fases

### [x] Fase 1 — Comando para crear una fuente de logs (workspace-api)
- **Alcance:** `php artisan log:source-create {project} {name}` crea la fuente con la misma lógica que
  `LogSourceController::store` (reutilizarla, no duplicarla), rechaza proyecto inexistente o archivado e imprime la
  key una sola vez. Textos por `__()` (en/es). Sirve para el alta local y para el paso a producción sin UI.
- **Archivos:** comando nuevo, `LogSourceController` o el lugar donde viva la generación de la key, `lang/en.json`,
  `lang/es.json` + test.
- **Terminado cuando:** test del comando: crea la fuente, la key autentica en `/api/ingest/events` (202) y el
  proyecto archivado falla sin crear nada. pint limpio.

### [x] Fase 2 — Conversión de un registro de Monolog a evento de ingesta (posveapi)
- **Alcance:** clase pura que convierte un `LogRecord` en un evento válido para el contrato: nivel PSR-3, mensaje
  recortado a 8192 caracteres (no bytes), contexto normalizado a JSON (excepciones con clase, mensaje, archivo:línea
  y traza recortada), recortado a 32 KB y 8 niveles con marca de truncado, sin bytes nulos, `occurred_at` ISO 8601
  y `fingerprint` explícito para excepciones (clase + archivo + línea) o si el contexto trae `fingerprint`.
- **Archivos:** `app/Logging/WorkspaceEventFormatter.php` + test unitario.
- **Terminado cuando:** tests con mensaje largo con emojis, contexto enorme, anidado profundo, byte nulo y excepción:
  el evento resultante siempre cumple los límites de la ingesta.

### [x] Fase 3 — Handler que envía los eventos a workspace-api [riesgo]
- **Alcance:** handler de Monolog que acumula registros y los envía en lotes de hasta 100 al cerrar (fin de la
  petición o del comando) o al llenarse. Timeout corto (2 s), sin reintentos, nunca lanza. Si falla, escribe una
  línea en `daily` sin pasar por sí mismo, para evitar recursión. Verificar que el envío ocurre después de responder
  al cliente (`fastcgi_finish_request`) y en comandos del scheduler.
- **Archivos:** `app/Logging/WorkspaceLogHandler.php` + test con `Http::fake`.
- **Terminado cuando:** tests: lote correcto con header Bearer, corte en 100, error HTTP o timeout sin excepción ni
  recursión, y nada se envía sin URL o key configuradas.

### [x] Fase 4 — Canales `slack` y `critical_alerts` apuntan a workspace cuando está configurado (posveapi)
- **Alcance:** si `WORKSPACE_LOG_URL` y `WORKSPACE_LOG_KEY` están definidas, los dos canales usan el handler de la
  fase 3 con los mismos niveles mínimos de hoy. Si no, siguen con Slack como respaldo. Factory del logger
  (`driver: custom`), claves en `config/services.php` y variables en `.env.example`.
- **Archivos:** `config/logging.php`, `config/services.php`, `.env.example`, `app/Logging/CreateWorkspaceLogger.php`
  + test.
- **Terminado cuando:** test: con las variables, `Log::channel('critical_alerts')->error(...)` y una excepción no
  capturada llegan al `Http::fake` de la ingesta; sin ellas, la configuración de Slack queda igual que antes.

### [x] Fase 5 — Prueba de punta a punta en local [riesgo]
- **Alcance:** sin código salvo ajustes que aparezcan. Crear la fuente con la fase 1 en el proyecto DEMO local
  (pedir confirmación antes). El usuario pone `WORKSPACE_LOG_URL=http://host.docker.internal:8003` y la key en
  `posveapi/.env` (los agentes no tocan `.env`). Disparar desde posveapi un error por `tinker --execute`, un 500
  real de la API y una traza de nivel `info` por `slack`.
- **Archivos:** ninguno previsto.
- **Terminado cuando:** los tres llegan como avisos al canal DEMO en workspace-web. El 500 repetido agrupa en vez de
  duplicar. posveapi responde sin demora visible.

### [x] Fase 6 — Aviso de build a workspace (posveapi)
- **Alcance:** `scripts/build-notify.js` envía el aviso a la ingesta (nivel `info`) si están las variables de
  workspace, y si no, al webhook de Slack como hoy. Fallar en silencio, sin romper `npm run build`.
- **Archivos:** `scripts/build-notify.js`.
- **Terminado cuando:** con las variables locales, `node scripts/build-notify.js` deja un aviso en el canal DEMO y
  sin ellas no falla.

### [ ] Fase 7 — Retirar Slack (posveapi) [aplazada]
- **Requiere:** paso a producción hecho y confirmado por el usuario (ver Notas). `ejecutar-plan` se detiene antes
  de esta fase.
- **Alcance:** quitar el respaldo a Slack de `config/logging.php`, `config/health.php`, `build-notify.js` y
  `.env.example` (`LOG_SLACK_*`, `SLACK_WEBHOOK_URL`).
- **Archivos:** los 4 citados + ajuste del test de la fase 4.
- **Terminado cuando:** grep sin referencias a `hooks.slack.com` ni `LOG_SLACK_` en código y config, y tests de
  logging en verde.

## Decisiones
- 2026-10-07 — El cliente no reintenta (como el webhook de Slack hoy), así que la idempotencia de la ingesta (M-5 de
  `log.md`) no es requisito de este plan. Si se agregan reintentos, se hace M-5 antes.
- 2026-10-07 — Se cambian los canales, no las llamadas: los ~20 `Log::channel('slack'|'critical_alerts')` quedan
  igual. Renombrar `notifySlack` de SICM queda fuera.
- 2026-10-07 — Se envían los mismos datos que hoy recibe Slack (incluye usuario, empresa, URL y leads); sin filtrado
  nuevo.
- 2026-10-07 — Desplegar workspace-api y workspace-web queda fuera de este plan (plan propio). Las fases 1 a 6 se
  prueban en local y la fase 7 espera al paso a producción.
- 2026-10-07 — Fase 1: la creación de fuente y key vive en `LogSource::issueFor(Project, name)` (controlador y comando).
  Comando: `log:source-create {project} {name} {--organization=}`, `project` es la key del proyecto (se pasa a
  mayúsculas); si la key existe en varias organizaciones exige `--organization=<slug>`. El nombre se valida con
  `StoreLogSourceRequest::rules()`.

- 2026-10-07 — Fase 2: `WorkspaceEventFormatter::format(LogRecord): array` devuelve `level`, `message`, `occurred_at`
  (UTC `Y-m-d\TH:i:s.v\Z`) y, si aplican, `context` y `fingerprint`. Contexto: strings a 2048 caracteres, arrays a 50,
  traza a 2000, `[truncated]` + `_truncated: true` arriba; excepción `{class, message, location, trace}`. Fingerprint:
  el del contexto (recortado) o `Clase|archivo:línea` (sha1 si > 255). Mensaje vacío o de solo espacios se envía como
  `-` (el API aplica TrimStrings + ConvertEmptyStringsToNull). No se envían `extra` ni `channel`.

- 2026-10-07 — El usuario: "sí, usa --no-verify en todos los commits del plan." (el hook pre-commit de posveapi
  corre `php vendor/bin/pint` y no hay PHP local).
- 2026-10-07 — El usuario: "no quitemos lo que esté de slack [...] lo dejamos de ultimo una vez que separemos
  ambientes." La fase 7 queda aplazada: este plan termina en la fase 6 y Slack se mantiene como respaldo.
- 2026-10-07 — Fase 3: `new WorkspaceLogHandler(?url, ?key, level = Debug, bubble = true, formatter = null,
  fallback = null, ?Closure $shutdownRegistrar = null)`. `url` es la base (el handler agrega `/api/ingest/events`);
  sin url o key no acepta registros. Vacía en `app()->terminating` (en FPM tras `fastcgi_finish_request`; con
  `artisan serve` el cliente espera hasta 2 s), en `Looping` del worker, en `register_shutdown_function` (fatales) y en
  el destructor; los callbacks guardan una `WeakReference`. Marca estática contra recursión. La fase 4 debe crear una
  instancia por canal, no por registro. Si llega Octane, revisar la acumulación de listeners por instancia.
- 2026-10-07 — Fase 4: workspace se activa solo con `WORKSPACE_LOG_URL` y `WORKSPACE_LOG_KEY` las dos; con una sola,
  sigue Slack. Con ellas, `slack` y `critical_alerts` se reemplazan (no se duplican) y `critical_alerts` entra al
  `stack` aunque no haya webhook de Slack. Config en `services.workspace_log.*`; niveles de `LOG_SLACK_LEVEL` y
  `LOG_SLACK_LEVEL_CRITICAL`. Tras poner las variables: reiniciar el contenedor o `config:clear`.
- 2026-10-07 — Fase 6: `build-notify.js` usa workspace solo con `WORKSPACE_LOG_URL` y `WORKSPACE_LOG_KEY`; esas dos
  variables del proceso tienen prioridad sobre `.env` (p. ej. `WORKSPACE_LOG_URL=http://localhost:8003` desde el host);
  el resto se lee como antes. El fallo de build va con nivel `error` (inicio y éxito, `info`). Timeout de 3 s de
  inactividad y tope total de 8 s, sin reintentos; el envío nunca rechaza ni cambia el código de salida.

## Notas para la próxima sesión
- Plan cerrado en la fase 6 (2026-10-07). La fase 7 (retirar Slack) se hará en un plan propio cuando se separen
  ambientes. Commits posveapi en `feat/workspace-logs` sin push ni merge: 5192ac4a, 1c3efa05, a222d25c, 8c7a9a9d.
- Fase 5 (sin código): fuente `posveapi` en DEMO local y variables en `posveapi/.env` (las agregó el coordinador con
  permiso del usuario, sin leer el archivo). Llegan los tres avisos (grupos 5, 6, 7 y la alerta 8 de `LogApiRequest`),
  el 500 repetido 5 veces da `events_count=5` y un solo aviso, y se ven en workspace-web. Los 500 tardan lo mismo que
  un 200. En local hay avisos falsos "Workspace log delivery failed" (cURL 28): la primera petición a `artisan serve`
  en frío tarda ~2 s; los eventos llegan igual. Quedan grupos de prueba abiertos en DEMO.
- 500 reproducible sin tocar datos: `GET /api/help-center/search?q[]=x` (TypeError en `trim()`).
- Fase 5 y producción: `php artisan log:source-create DEMO <nombre> --organization=<slug>` si DEMO no es único.
- Rama de trabajo en posveapi: `feat/workspace-logs` (creada desde `pharmacies` limpio, 2026-10-07).
- Paso a producción (usuario, fuera del plan): desplegar workspace, crear la fuente con la fase 1, poner
  `WORKSPACE_LOG_URL`/`WORKSPACE_LOG_KEY` en el `.env` de la VPS, mergear a `pharmacies`, probar con tinker y
  después ejecutar la fase 7.

## Mejoras propuestas
- [ ] M-1 — posveapi: las guardas `config('logging.channels.slack.url')` (ApiResponser, Handler, comandos de
      facturación, ContactController) nunca se cumplen y esos avisos no se envían. Decidir si se activan (algunos
      llevan datos personales de leads) o se borran. Alta (más de 5 archivos) · plan nuevo tras decidirlo.
- [x] M-2 — workspace-api: rotación de key de una fuente (hoy: crear nueva y revocar). Alta (seguridad) · opus.
- [x] M-3 — workspace-api: el chequeo de proyecto archivado está duplicado entre `StoreLogSourceRequest::after()` y
      `CreateLogSource`; extraerlo a un método de `Project`. Baja · haiku.
- [x] M-4 — workspace-api: el mensaje "Project :project not found." no menciona la organización cuando se pasa
      `--organization`. Baja · haiku.
- [x] M-5 — posveapi: `WorkspaceEventFormatter` usa `trim()`, que no quita espacios Unicode (NBSP); un mensaje solo
      de esos llegaría null al API (TrimStrings sí los quita) y rechazaría el lote. Usar `preg_replace('/^\s+|\s+$/u')`. Baja · haiku.
- [x] M-6 — posveapi: `exceptionToArray` no limita `getMessage()`; un mensaje enorme hace que `exception` entero (falso positivo: ya se recortaba en normalizeArray; se agregó solo un test de caracterización)
      quede `[truncated]` y se pierden clase y ubicación. Pasarlo por `limitedString`. Baja · haiku.
- [x] M-7 — posveapi: en `WorkspaceEventFormatter::normalize()` sobra la rama `elseif (is_object(...))` duplicada, y
      faltan tests de `JsonSerializable` que devuelve array y de fingerprint > 255 que acaba en sha1. Baja · haiku.
- [ ] M-8 — posveapi: confirmar el SAPI de la VPS (FPM) para que el envío ocurra tras responder; con otro SAPI el
      cliente espera hasta 2 s. Baja · haiku (verificación).
- [x] M-9 — posveapi: en `WorkspaceLogHandler::registerFlushPoints` acortar el docblock y renombrar `$handler` a
      `$handlerRef`. Baja · haiku.
- [x] M-10 — posveapi: en `config/logging.php`, `$workspaceLogConfigured` cuenta un valor de solo espacios como
      configurado (apaga Slack y el handler descarta); usar `trim()`. Baja · haiku.
- [x] M-11 — posveapi: el test "sin variables" de `WorkspaceLogChannelsTest` no compara `username`, `emoji` ni
      `replace_placeholders`; comparar el bloque de Slack completo. Baja · haiku.
- [x] M-12 — posveapi: `GET /api/help-center/search?q[]=x` da 500 (TypeError en `trim()` con array); validar `q`
      como string. Baja · haiku.
- [x] M-13 — posveapi: timeout del handler configurable (`WORKSPACE_LOG_TIMEOUT`, por defecto 2 s) para evitar los
      avisos falsos de entrega fallida en local con `artisan serve` frío. Baja · haiku.
- [x] M-14 — posveapi: `build-notify.js` ignora sin aviso un 4xx/5xx de workspace (p. ej. key revocada); agregar un
      `console.warn` de una línea sin la key. Baja · haiku.
- [x] M-15 — posveapi: `WorkspaceLogChannelsTest::test_con_las_variables_...` espera niveles `info`/`error` sin limpiar `LOG_SLACK_LEVEL` y `LOG_SLACK_LEVEL_CRITICAL`; fallaría si el `.env` los define distinto. Baja · haiku.
- [x] M-16 — posveapi: `HelpCenterController` acepta `category` y `type` como arreglos sin validar (mismo tipo de 500 que M-12). Baja · haiku.
- [x] M-17 — workspace-api: dos rotaciones simultáneas de la misma fuente: gana la última y la primera respuesta
      entrega una key que ya no vale. UPDATE condicionado al `key_hash` anterior y 409 si no afecta filas. Baja · sonnet.
- [x] M-18 — workspace-api: opción de rotar desde consola (`log:source-rotate`) para producción sin UI. Baja · sonnet.
- [x] M-19 — posveapi: `HelpCenterSearchTest`: el test de `type` ausente/vacío solo afirma 200; afirmar que devuelve los artículos `help`, y fijar que `type=otro` sigue respondiendo 200. Baja · haiku.
- [x] M-20 — workspace-api: `RotateLogSourceKeyCommandTest` solo afirma códigos de salida; afirmar el texto de error (y uno en `es`) en los casos de rechazo. Baja · haiku.
