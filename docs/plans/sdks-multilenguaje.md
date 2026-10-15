# Plan: sdks-multilenguaje

**Objetivo:** SDKs oficiales de Sereno para PHP sin Laravel (Monolog, Symfony), Node.js (Express, NestJS, Next.js servidor),
Python (logging, Django, FastAPI) y JS en navegador (Vue, React), con captura automática de errores, envío por lotes,
reintento, ids idempotentes y fingerprint como `ascariodev/sereno-laravel`; keys públicas para navegador en el API y
fragmentos por lenguaje en el diálogo de la key.
**Estado:** en curso · Fase actual: 14

## Contexto mínimo
- Repos: monorepo (`api/`, `web/`, `app/`, `docs/`) y repos hermanos nuevos `../sereno-php`, `../sereno-js` y
  `../sereno-python` (los crea la fase 2, 8 y 16 con `git init`; cada uno con su worktree vía `worktree.mjs`). Referencia:
  `../sereno-laravel` (`src/Logging/EventFormatter.php`, `SerenoLogHandler.php`, `src/Support/ConnectionTester.php`, `README.md`).
- Contrato de ingesta: `POST {url}/api/ingest/events`, `Authorization: Bearer wsk_<40 alfanum>`, body `{"events": [...]}`
  de 1 a 100; por evento `level` (8 niveles PSR-3), `message` (≤8192, sin `\0`), `id` (1..64, dedupe por fuente durante 48 h),
  `context` (≤32768 bytes de `json_encode` PHP, profundidad 8), `occurred_at`, `fingerprint` (≤255). 202 `{"accepted": N}`,
  401 uniforme, 413 (>5 MB), 422, 429 (30 fallos de auth/min por IP, 600 req/min por fuente). Archivos:
  `api/routes/api.php`, `api/app/Http/Requests/LogIngest/IngestEventsRequest.php`,
  `api/app/Http/Middleware/{AuthenticateLogSource,RejectOversizedIngestBody}.php`, `api/app/Models/LogSource.php`,
  `api/app/Support/LogFingerprint.php`, `api/config/cors.php` (abierto, sin credenciales).
- Web: `web/src/components/{CreateLogSourceDialog,LogSourceKeyDialog}.vue`, `web/src/views/IntegrationsView.vue`, textos
  `keyDialog.*` en `web/src/i18n/{es,en}.json`. Móvil: `app/src/app/integrations.tsx`.
- Verificación desde un worktree del monorepo: los comandos de `docs/plans/terminados/integracion-simple.md` (Contexto
  mínimo), con `-e DB_DATABASE=workspace_test`. Nunca leer ni montar `.env` (L-52).
- SDKs: sin Node, Python ni PHP del host para tests; correr en contenedores (`node:24`, `python:3.12`, `composer:2`) con el
  repo montado. Prueba real contra el API local en `http://host.docker.internal:8003` con una key de desarrollo creada con
  `log:source-create`.
- Nada se publica (npm, PyPI, Packagist) ni se hace push sin pedido del usuario.

## Fases

### [x] Fase 1 — Contrato del cliente y vectores de conformidad
- **Alcance:** documento único del comportamiento que todo SDK debe cumplir, sacado de sereno-laravel: forma del evento,
  normalización del `context` (excepciones `{class, message, location, trace}`, límites 2048/50/8, recorte a 32768−64 con
  `_truncated`), `message` (UTF-8 válido, sin `\0`, ≤8192, `-` si vacío), `occurred_at` UTC con milisegundos, fingerprint
  del cliente (explícito, o `Clase|archivo:línea` de la excepción, `sha1` si >255), lote de 100, un reintento solo ante red
  o 5xx con los mismos ids, presupuesto de 10 s, timeout por defecto 2 s, nunca lanzar, guardia contra bucles, puntos de
  vaciado. Vectores JSON (entrada → evento esperado) para el formateo. Test del API que envía cada evento esperado y
  exige 202.
- **Archivos:** `docs/sdk/contrato.md`, `api/tests/Fixtures/sdk/vectores.json`, `api/tests/Feature/Log/SdkVectorsTest.php`
- **Terminado cuando:** el test pasa con todos los vectores y el contrato cubre cada punto del README de sereno-laravel.

### [x] Fase 2 — sereno-php: formateador
- **Alcance:** `../sereno-php` (`ascariodev/sereno-php`, PHP ^8.1, `monolog/monolog ^3`), PHPUnit. `EventFormatter` sin
  Illuminate (UUID propio con `random_bytes`) que pasa los vectores de la fase 1 (copiados en `tests/fixtures`).
- **Archivos:** `composer.json`, `phpunit.xml`, `src/EventFormatter.php`, `tests/EventFormatterTest.php`, `tests/fixtures/vectores.json`
- **Terminado cuando:** la suite pasa en `composer:2` con todos los vectores.

### [x] Fase 3 — sereno-php: transporte
- **Alcance:** `Transport` con ext-curl: lote, un reintento ante red/5xx, presupuesto de 10 s, timeout configurable (máx. 10),
  devuelve un resultado (enviado, rechazado con código, error) sin lanzar.
- **Archivos:** `src/Transport.php`, `src/DeliveryResult.php`, `tests/TransportTest.php`
- **Terminado cuando:** tests con un servidor HTTP local (`php -S`) cubren 202, 401 sin reintento, 500 con un reintento y
  timeout dentro del presupuesto.

### [x] Fase 4 — sereno-php: handler de Monolog
- **Alcance:** `SerenoHandler` (buffer, vaciado a 100, en `close`, `reset` y `register_shutdown_function`, guardia
  `$sending`, aviso por `error_log` al fallar). Inerte sin URL o key.
- **Archivos:** `src/SerenoHandler.php`, `tests/SerenoHandlerTest.php`
- **Terminado cuando:** tests del lote, vaciado y fallo pasan; un script contra el API local deja el evento en el canal.

### [x] Fase 5 — sereno-php: captura global
- **Alcance:** `Sereno::init(key, url, options)` para PHP puro: crea el logger, registra `set_exception_handler`,
  `set_error_handler` (desde un nivel) y fatales en shutdown, encadenando los handlers previos.
- **Archivos:** `src/Sereno.php`, `tests/SerenoTest.php`
- **Terminado cuando:** una excepción no capturada en un script de prueba llega como evento `error` con fingerprint
  `Clase|archivo:línea` y el handler previo se sigue llamando.

### [x] Fase 6 — sereno-php: comando de prueba
- **Alcance:** `vendor/bin/sereno-test` (lee `SERENO_KEY`/`SERENO_URL` o argumentos) con la misma interpretación que
  `ConnectionTester` (202, 401, URL o key faltante, error).
- **Archivos:** `bin/sereno-test`, `src/ConnectionTester.php`, `composer.json`, `tests/ConnectionTesterTest.php`
- **Terminado cuando:** contra el API local responde "conectado" con una key válida y código 1 con una revocada.

### [x] Fase 7 — sereno-php: README con Symfony
- **Alcance:** instalación, PHP puro con `Sereno::init`, Monolog a mano y Symfony (`monolog.yaml` + servicio), variables,
  comportamiento de envío. Tag local `v0.1.0`.
- **Archivos:** `README.md`, `LICENSE`
- **Terminado cuando:** una app Symfony nueva en un contenedor, siguiendo solo el README, envía una excepción al API local.

### [x] Fase 8 — sereno-js: formateador del núcleo [riesgo]
- **Alcance:** `../sereno-js` con npm workspaces (`packages/core`, `packages/node`, `packages/browser`), TypeScript,
  Vitest y build ESM+CJS; Node ≥20. En `core`: `formatEvent` que pasa los vectores (errores JS: `{class: name, message,
  location: archivo:línea del primer frame, trace}`).
- **Archivos:** `package.json`, `tsconfig.json`, `packages/core/{package.json,src/format.ts}`, `packages/core/test/format.test.ts`
- **Terminado cuando:** `npm test` y `npm run build` pasan en `node:24`.

### [x] Fase 9 — sereno-js: transporte y buffer del núcleo
- **Alcance:** `Client` con `fetch` y `AbortController`: buffer, lote de 100, reintento ante red/5xx, presupuesto, `flush()`
  que devuelve promesa, guardia de reentrada, nunca rechaza.
- **Archivos:** `packages/core/src/{client.ts,index.ts}`, `packages/core/test/client.test.ts`
- **Terminado cuando:** tests con un servidor `http` local cubren los mismos casos que la fase 3.

### [x] Fase 10 — sereno-node: init y captura del proceso
- **Alcance:** `init({key, url})` (o `SERENO_KEY`/`SERENO_URL`), `captureException`, `log(level, ...)`,
  `uncaughtException`/`unhandledRejection` sin cambiar la semántica de salida, vaciado en `beforeExit` y señales,
  `flush()` exportado para entornos sin proceso largo.
- **Archivos:** `packages/node/{package.json,src/index.ts,src/process.ts}`, `packages/node/test/process.test.ts`
- **Terminado cuando:** un script hijo que lanza una excepción no capturada deja el evento en el servidor de prueba y sale
  con el mismo código que sin el SDK.

### [x] Fase 11 — sereno-node: middleware de Express
- **Alcance:** `expressErrorHandler()` que captura y llama a `next(err)`, con método y ruta en el `context`.
- **Archivos:** `packages/node/src/express.ts`, `packages/node/test/express.test.ts`, `packages/node/package.json`
- **Terminado cuando:** test con una app Express que lanza en una ruta: evento enviado y la respuesta 500 de Express intacta.

### [x] Fase 12 — sereno-node: filtro de NestJS [riesgo]
- **Alcance:** `SerenoExceptionFilter` (extiende `BaseExceptionFilter`, ignora `HttpException` < 500) y `SerenoModule`.
  Peer dependencies opcionales.
- **Archivos:** `packages/node/src/nest.ts`, `packages/node/test/nest.test.ts`, `packages/node/package.json`
- **Terminado cuando:** test con una app Nest mínima: un 500 se envía, un 404 no, y la respuesta no cambia.

### [x] Fase 13 — sereno-node: Next.js en servidor [riesgo]
- **Alcance:** `onRequestError` para `instrumentation.ts` (verificar la firma en la documentación de Next antes de
  implementar) que captura y vacía antes de devolver.
- **Archivos:** `packages/node/src/next.ts`, `packages/node/test/next.test.ts`, `packages/node/package.json`
- **Terminado cuando:** una app Next mínima en un contenedor, con un route handler que lanza, deja el evento en el API local.

### [ ] Fase 14 — sereno-node: comando de prueba
- **Alcance:** `npx @ascariodev/sereno-node test` con la interpretación de `ConnectionTester`.
- **Archivos:** `packages/node/src/cli.ts`, `packages/node/package.json`, `packages/node/test/cli.test.ts`
- **Terminado cuando:** contra el API local da "conectado" y código 1 con una key revocada.

### [ ] Fase 15 — sereno-node: README
- **Alcance:** instalación, `init`, Express, NestJS, Next.js, variables y comportamiento de envío. Tag local `node-v0.1.0`.
- **Archivos:** `packages/node/README.md`, `packages/core/README.md`, `LICENSE`
- **Terminado cuando:** una app Express nueva, siguiendo solo el README, envía una excepción al API local.

### [ ] Fase 16 — sereno-python: formateador
- **Alcance:** `../sereno-python` (Python ≥3.10, `pyproject.toml` con hatchling, pytest, sin dependencias de runtime).
  `format_event` que pasa los vectores (excepciones con `traceback`).
- **Archivos:** `pyproject.toml`, `src/sereno/{__init__.py,format.py}`, `tests/test_format.py`, `tests/fixtures/vectores.json`
- **Terminado cuando:** `pytest` pasa en `python:3.12` y `python:3.10`.

### [ ] Fase 17 — sereno-python: transporte
- **Alcance:** `Transport` con `urllib.request` y un hilo de fondo con cola: lote, reintento, presupuesto, `flush(timeout)`.
- **Archivos:** `src/sereno/transport.py`, `tests/test_transport.py`
- **Terminado cuando:** tests con `http.server` local cubren los mismos casos que la fase 3.

### [ ] Fase 18 — sereno-python: handler de logging
- **Alcance:** `SerenoHandler(logging.Handler)` y `sereno.init(key, url)` que lo agrega al root logger, instala
  `sys.excepthook` y `threading.excepthook` encadenados y vacía en `atexit`.
- **Archivos:** `src/sereno/{handler.py,__init__.py}`, `tests/test_handler.py`
- **Terminado cuando:** un subproceso que lanza una excepción no capturada deja el evento en el servidor de prueba.

### [ ] Fase 19 — sereno-python: Django [riesgo]
- **Alcance:** configuración por `LOGGING` (el logger `django.request` ya registra los 500 con `exc_info`); helper
  `sereno.django.logging_config()` si hace falta.
- **Archivos:** `src/sereno/django.py`, `tests/test_django.py`
- **Terminado cuando:** test con un proyecto Django mínimo: una vista que lanza produce un evento `error` con fingerprint
  de la excepción, y un 404 no.

### [ ] Fase 20 — sereno-python: FastAPI [riesgo]
- **Alcance:** middleware ASGI `SerenoMiddleware` que captura y relanza (sin depender de los logs de uvicorn).
- **Archivos:** `src/sereno/asgi.py`, `tests/test_asgi.py`
- **Terminado cuando:** test con una app FastAPI y `TestClient`: la excepción llega una sola vez y la respuesta 500 no cambia.

### [ ] Fase 21 — sereno-python: comando de prueba
- **Alcance:** `python -m sereno test` con la interpretación de `ConnectionTester`.
- **Archivos:** `src/sereno/__main__.py`, `tests/test_cli.py`
- **Terminado cuando:** contra el API local da "conectado" y código 1 con una key revocada.

### [ ] Fase 22 — sereno-python: README
- **Alcance:** instalación, `init`, logging, Django, FastAPI, variables y comportamiento de envío. Tag local `v0.1.0`.
- **Archivos:** `README.md`, `LICENSE`
- **Terminado cuando:** una app FastAPI nueva, siguiendo solo el README, envía una excepción al API local.

### [ ] Fase 23 — API: tipo de fuente pública [riesgo]
- **Alcance:** migración `log_sources.kind` (`server` por defecto, `browser`) y `allowed_origins` (jsonb); keys de navegador
  con prefijo `wsp_`; crear con tipo y orígenes (validados como origen `https://host[:puerto]`); resource expone ambos.
- **Archivos:** migración nueva, `api/app/Models/LogSource.php`, `api/app/Http/Requests/LogSource/StoreLogSourceRequest.php`,
  `api/app/Http/Controllers/Api/LogSourceController.php`, `api/app/Http/Resources/LogSourceResource.php`
- **Terminado cuando:** tests de creación de ambos tipos, validación de orígenes y que las fuentes existentes quedan `server`.

### [ ] Fase 24 — API: ingesta con key de navegador [riesgo]
- **Alcance:** `AuthenticateLogSource` acepta `wsp_` solo con `Origin` en `allowed_origins` (401 uniforme si no); las `wsk_`
  siguen igual; límite propio por IP para keys de navegador. Actualizar `.claude/rules/database.md` (columnas de la fase 23).
- **Archivos:** `api/app/Http/Middleware/AuthenticateLogSource.php`, `api/app/Providers/AppServiceProvider.php`,
  `.claude/rules/database.md`
- **Terminado cuando:** tests: origen permitido 202, otro origen 401, sin `Origin` 401, límite por IP 429, keys `wsk_` sin cambios.

### [ ] Fase 25 — API: cabeceras CORS en los rechazos de la ingesta [riesgo]
- **Alcance:** que 401, 413 y 429 de la ingesta lleven las cabeceras CORS (hoy el 413 sale antes de `HandleCors`), para que el
  SDK de navegador lea el código en vez de un error de red.
- **Archivos:** `api/app/Http/Middleware/RejectOversizedIngestBody.php`, `api/bootstrap/app.php`
- **Terminado cuando:** tests con `Origin` permitido: 401, 413 y 429 traen `Access-Control-Allow-Origin`.

### [ ] Fase 26 — Web: crear fuente de navegador
- **Alcance:** `CreateLogSourceDialog` con tipo (servidor o navegador) y lista de orígenes; la lista de Integraciones muestra
  el tipo.
- **Archivos:** `web/src/components/CreateLogSourceDialog.vue`, `web/src/views/IntegrationsView.vue`, tipos del API en
  `web/src/`, `web/src/i18n/{es,en}.json`
- **Terminado cuando:** specs del diálogo (envío con tipo y orígenes, validación) y typecheck pasan.

### [ ] Fase 27 — sereno-browser: captura global [riesgo]
- **Alcance:** `packages/browser`: `init({key, url})`, `window.onerror` y `unhandledrejection`, deduplicación por
  fingerprint (una vez cada 60 s) y tope por página, vaciado con `fetch` `keepalive` en `pagehide`/`visibilitychange`
  (verificar que el preflight con `Authorization` funciona con `keepalive` en Chrome, Firefox y Safari; si no, decidir
  alternativa antes de seguir), URL de la página en el `context`.
- **Archivos:** `packages/browser/{package.json,src/index.ts,src/global.ts}`, `packages/browser/test/global.test.ts`
- **Terminado cuando:** tests en jsdom pasan y una página de prueba servida desde un origen permitido deja el evento en el
  API local.

### [ ] Fase 28 — sereno-browser: plugin de Vue
- **Alcance:** `SerenoVue` que encadena `app.config.errorHandler` con el componente y la info del hook en el `context`.
- **Archivos:** `packages/browser/src/vue.ts`, `packages/browser/test/vue.test.ts`, `packages/browser/package.json`
- **Terminado cuando:** test con un componente que lanza en `setup`: evento enviado y el handler previo llamado.

### [ ] Fase 29 — sereno-browser: ErrorBoundary de React
- **Alcance:** `SerenoErrorBoundary` (fallback configurable, `componentStack` en el `context`).
- **Archivos:** `packages/browser/src/react.tsx`, `packages/browser/test/react.test.tsx`, `packages/browser/package.json`
- **Terminado cuando:** test con un hijo que lanza: evento enviado y fallback renderizado.

### [ ] Fase 30 — sereno-browser: README
- **Alcance:** key pública y orígenes, `init`, Vue, React, deduplicación y límites. Tag local `browser-v0.1.0`.
- **Archivos:** `packages/browser/README.md`
- **Terminado cuando:** una app Vite + Vue nueva siguiendo solo el README envía un error al API local.

### [ ] Fase 31 — Web: fragmentos por lenguaje en el diálogo de la key
- **Alcance:** pestañas Laravel, PHP, Node.js, Python, Navegador y curl en `LogSourceKeyDialog` (para fuentes de navegador,
  solo Navegador); nombres de paquete tomados de Decisiones.
- **Archivos:** `web/src/components/LogSourceKeyDialog.vue`, `web/src/components/LogSourceKeyDialog.spec.ts`,
  `web/src/i18n/{es,en}.json`
- **Terminado cuando:** spec de cada pestaña con la key y la URL interpoladas, y typecheck.

### [ ] Fase 32 — App móvil: fragmentos y tipo de fuente
- **Alcance:** `integrations.tsx` muestra el tipo y los mismos fragmentos que la web.
- **Archivos:** `app/src/app/integrations.tsx`, `app/src/i18n/{es,en}.json`, su test
- **Terminado cuando:** test de la pantalla y `npm run typecheck` en `app/`.

## Decisiones
- 2026-10-15 — SDK oficial por lenguaje (no solo contrato HTTP con ejemplos); orden PHP, Node, Python, navegador,
  después la interfaz. Los avisos de log por email/push quedan para después de este plan (usuario).
- 2026-10-15 — Repos hermanos separados como sereno-laravel (Composer no instala desde subcarpetas; npm y PyPI tampoco
  lo necesitan). Node y navegador comparten repo `sereno-js` con un núcleo común.
- 2026-10-15 — El contrato del cliente vive en `docs/sdk/` del monorepo y los vectores se copian a cada SDK.
- 2026-10-15 — sereno-php no reemplaza el código de sereno-laravel en este plan (ver M-1).
- 2026-10-15 — Navegador con key pública `wsp_` restringida por origen; las `wsk_` nunca se usan en el cliente.
- 2026-10-15 — Nombres (libres en los registros ese día): npm `@ascariodev/sereno-core`, `@ascariodev/sereno-node`,
  `@ascariodev/sereno-browser` (usuario; necesita la org o usuario `ascariodev` en npm antes de publicar); PyPI `sereno-sdk`
  con módulo `sereno` (elegido por el coordinador, el usuario delegó); Packagist `ascariodev/sereno-php`.
- 2026-10-15 — Fase 1: los vectores viven en `api/tests/Fixtures/sdk/vectores.json` (el contenedor del API solo monta
  `api/`); cada SDK los copia a sus tests. Se generaron con el `EventFormatter` de sereno-laravel corriendo en el
  contenedor del API; un vector nuevo se genera igual, no a mano. Marcadores `$repeat`, `$float`, `$date`, `$object`,
  `$exception` (ver el contrato).
- 2026-10-15 — El contrato agrega, marcado "(fuera de Laravel)": tope de 1000 eventos, vaciado por tiempo de 1 s en
  procesos largos, avisos de fallo por `error_log`/`console.error`/`stderr`, y la guardia de bucles que no descarta
  eventos concurrentes.
- 2026-10-15 — Ejecución: el monorepo trabaja en el worktree `.claude/worktrees/sdks-fase-1` (rama `feat/sdks-multilenguaje`),
  un commit por fase; el merge a `main` solo a pedido del usuario. Cada repo nuevo se crea con `git init -b main` y un
  commit vacío inicial, y se trabaja en su worktree `.claude/worktrees/sdks` (rama `feat/sdks`) con un commit por fase.
- 2026-10-15 — El usuario pidió ejecutar todas las fases seguidas sin parar.
- 2026-10-15 — sereno-php: `composer.lock` no se versiona (librería); PHPUnit `^10.5 || ^11`; commit de fase 2 fbbb912 en `feat/sdks` de sereno-php.
- 2026-10-15 — sereno-php fase 3 (a21c152): cualquier 2xx es enviado; 3xx no se sigue y cuenta como rechazo; sin `curl_close` (deprecado en 8.5).
- 2026-10-15 — sereno-php fase 4 (6b818e4): avisos en texto plano por `error_log` (notifier inyectable); el tope de 1000 es defensivo en PHP síncrono (el buffer no pasa de 99).
- 2026-10-15 — sereno-php fase 5 (02b0938): errores desde E_WARNING; los warnings y fatales llevan file/line/errno en el contexto y el fingerprint lo calcula el servidor; con handler previo de excepciones no se hace exit.
- 2026-10-15 — sereno-php fase 6 (fb0e778): ConnectionTester usa curl directo (Transport reintenta y no sirve para 5 s sin reintento); `.gitattributes` fuerza LF en `bin/sereno-test`.
- 2026-10-15 — Fase 8: sereno-js usa TypeScript ~5.9 (la salida CJS necesita moduleResolution node10, obsoleto en TS 6), Vitest 4 (el 5 pide Node 22.12) y build con tsc dos veces sin bundler; core compila con lib ES2020 y types [] (sin APIs de Node), SHA-1 propio síncrono y UUID con getRandomValues. package-lock.json se versiona. Valores propios de JS: surrogate suelto ?, undefined y Date inválida o fuera de 0000-9999 null, bigint su string, funciones [function], símbolos [symbol], Map y clases [object Nombre], ciclos [truncated] y lo que lanza al leerlo [unserializable], siempre con _truncated.
- 2026-10-15 — Fase 9: el Client de sereno-js envía secuencialmente por una cadena de promesas; drain saca lotes de 100 con splice para que lo pendiente cuente contra el tope de 1000; headers y fetchOptions son el punto de extensión (keepalive del navegador) y los campos propios del SDK siempre ganan; 3xx con redirect manual es rechazo sin reintento; avisos con el mismo texto que sereno-php.
- 2026-10-15 — Fase 10: sereno-node solo reemplaza la salida de Node en uncaughtException si no hay otro listener (imprime inspect, vacía con tope de 10 s y exit 1); en modos throw y strict no registra unhandledRejection (llega por uncaughtException); en señales sin listener de la app vacía con tope y reenvía la señal con process.kill. El tsconfig raíz mapea @ascariodev/sereno-core a su src con paths para el typecheck.
- 2026-10-15 — Fase 11: las integraciones de framework de sereno-node van por subpath (./express, y lo mismo para nest y next) para que el import raíz no arrastre el framework; el framework es peer dependency opcional y los tipos son propios. Criterio común: se ignoran errores con status < 500.
- 2026-10-15 — Fase 12: los decoradores de Nest se aplican como funciones (Catch()(X), Module({})(Y)) para no activar experimentalDecorators; RpcException y WsException se detectan por nombre de clase para no exigir @nestjs/microservices ni websockets; rxjs y reflect-metadata son peers opcionales.
- 2026-10-15 — Fase 13: el subpath next de sereno-node no importa nada de Node a nivel de módulo (solo import type) y carga el SDK con import() tras comprobar process.env.NEXT_RUNTIME === 'nodejs' escrito literal, para que el bundle edge de instrumentation.ts no arrastre node:util. Errores de control de Next se ignoran por digest (NEXT_REDIRECT, NEXT_NOT_FOUND, NEXT_HTTP_ERROR_FALLBACK, BAILOUT_TO_CLIENT_SIDE_RENDERING, DYNAMIC_SERVER_USAGE).

## Notas para la próxima sesión
- Fase 13 cerrada (sereno-js c78b5bc): subpath @ascariodev/sereno-node/next con onRequestError, createOnRequestError(options?: {minStatus?}) y register(options?): Promise<void> (solo NEXT_RUNTIME nodejs, sin reinicializar); next >=15 peer opcional; el cliente activo vive en globalThis[Symbol.for('@ascariodev/sereno-node.active')]. Para el README (fase 15): receta export { register, onRequestError } from '@ascariodev/sereno-node/next' en instrumentation.ts, register es async, handlers: false si no se quieren los handlers de proceso dentro de Next, Pages Router y modo dev sin probar. Sigue la fase 14 (comando de prueba).

## Mejoras propuestas
- [ ] M-1: sereno-laravel depende de sereno-php para el formateo y el transporte, en vez de duplicarlos.
      Complejidad: media · Archivos: 5 · Riesgo: contrato público → opus
- [ ] M-2: transportes para pino y winston en sereno-node.
      Complejidad: media · Archivos: 4 · Riesgo: ninguno → sonnet
- [ ] M-3: CI (GitHub Actions) con tests y publicación por tag en los cuatro repos.
      Complejidad: media · Archivos: 4 · Riesgo: ninguno → sonnet
- [ ] M-4: source maps para desminificar los stacks del navegador.
      Complejidad: alta · Riesgo: BD → plan nuevo
- [ ] M-5: vectores extra: `trace` cortado a 2000, excepción anidada en profundidad 8, valor no string reemplazado por
      `"[truncated]"` por tamaño (hoy el ajuste de tamaño solo se prueba con strings).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-6: sereno-php: tests propios de UTF-8 inválido a `?` (mensaje y clave), `JsonSerializable`, `Stringable` y excepción anidada, y probar la suite en PHP 8.1.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-7: sereno-php: robustez de TransportTest (carrera de `freePort()`, hijos de `php -S` con workers, márgenes de tiempo reales).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-8: sereno-php: la fábrica de Transport del constructor de SerenoHandler va en try/catch (hoy si lanza, lanza el constructor).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-9: sereno-php: evitar duplicados en Sereno (E_USER_ERROR registrado en handleError y otra vez como fatal en shutdown; handler previo que lanza).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-10: sereno-php: `export-ignore` de `tests/` y archivos de desarrollo en `.gitattributes` para aligerar el dist.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-11: Contrato: una excepción JS sin frames en el stack da fingerprint "Error|" y agrupa todos esos errores juntos; decidir si sin location no se envía fingerprint (afecta a los cuatro SDKs). Complejidad baja.
- [ ] M-12: sereno-node: en modo strict con listeners propios de uncaughtException y unhandledRejection el mismo rechazo se captura dos veces; deduplicar con un WeakSet de errores ya capturados. Complejidad baja.
- [ ] M-13: sereno-node Express: un error con status fuera de 400-599 (por ejemplo 200) no se captura aunque Express responde 500; capturarlo o documentarlo, y agregar tests de headersSent y minStatus. Complejidad baja.
- [ ] M-14: sereno-node Nest: en rpc y ws toda RpcException o WsException se captura, aunque suelen ser errores esperados del cliente; ignorarlas como los HttpException < 500 o dejarlo como opción. Complejidad baja.
- [ ] M-15: sereno-node Nest: probar rpc y ws con un microservicio y un gateway reales, y Fastify, en vez de hosts falsos. Complejidad media.
- [ ] M-16: sereno-node Next: probar Pages Router y el modo dev (next dev). Complejidad baja.
