# Plan: integracion-simple

**Objetivo:** conectar un sistema Laravel a Sereno en dos pasos: crear la fuente en la web y pegar
`composer require sereno/laravel && php artisan sereno:install wsk_...`; el diálogo de la key pasa de
"Esperando el primer evento" a "Conectado" cuando llega el primero.
**Estado:** en curso · Fase actual: 6
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Repos: paquete `../sereno-laravel` (fases 1 a 5 y 12, worktree propio con `worktree.mjs`); monorepo `api/` y `web/`
  (fases 6 a 11); posveapi `../posven/posveapi` (fase 13, rama `feat/sereno-paquete`, aún sin merge a `pharmacies`).
- Paquete hoy: `ascario/sereno-laravel` v0.1.1 en Gitea privado, namespace `Ascario\Sereno\`, `src/SerenoServiceProvider.php`,
  `src/Logging/{CreateSerenoLogger,EventFormatter,SerenoLogHandler}.php`, `config/sereno.php` (`SERENO_LOG_URL`, `_KEY`,
  `_TIMEOUT`, `_LEVEL`, `_FALLBACK_CHANNEL`), sin comandos artisan. Tests en Docker desde la raíz del paquete:
  `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/app" -w /app composer:2 sh -c 'composer update --no-interaction --no-progress -q && vendor/bin/phpunit'`.
  Escribir PHP y JSON con Edit/Write (los heredocs rompen las `\`).
- Laravel 11+ arma el stack con `explode(',', env('LOG_STACK', 'single'))`: el instalador solo edita `.env`
  (`LOG_STACK`), no archivos PHP.
- API: `last_used_at` lo marca `LogSource::markAsUsed()` (UPDATE condicional, 1 vez por minuto) desde el middleware
  `AuthenticateLogSource`, dentro de la petición. Canal Reverb del proyecto `organizations.{org}.projects.{project}`
  (`ProjectChannel`); eventos con `ShouldBroadcast` + `ShouldDispatchAfterCommit` + `broadcastAs` (patrón `TaskCreated`).
- Web: `realtime/echo.ts` (`subscribeToProject`, `onReconnect`, fake en `test/fakeRealtimeClient.ts`; patrón de uso en
  `PlanView.vue`); `IntegrationsView.vue` sin tiempo real; `LogSourceKeyDialog.vue` arma `.env` y `curl` con `config.apiUrl`.
- Verificación web desde un worktree (los contenedores montan el checkout principal):
  `MSYS_NO_PATHCONV=1 docker run --rm -v "<worktree>/web:/app" -v workspace_web-node-modules:/app/node_modules -w /app node:24 npx vitest --run <spec>`.
  API desde un worktree: mismo patrón con la imagen `workspace-php` y el volumen `workspace_vendor` (fijarlo en la fase 6).
- Nunca leer ni montar archivos `.env` (L-52). En posveapi el hook pre-commit falla sin PHP: `--no-verify` solo con
  pedido del usuario.

## Fases

### [x] Fase 1 — Renombrar el paquete a sereno/laravel [límite]
- **Alcance:** `name` `sereno/laravel`, namespace `Sereno\Laravel\` (y `Sereno\Laravel\Tests\`), provider en
  `extra.laravel`, `license` `MIT` con archivo `LICENSE`. Solo renombre: sin cambios de comportamiento.
- **Archivos:** `composer.json`, `LICENSE`, `src/SerenoServiceProvider.php`, `src/Logging/*.php` (3); tests solo
  cambian `namespace`/`use`.
- **Terminado cuando:** la suite pasa y `grep -ri ascario src tests composer.json` queda vacío (el README se rehace
  en la fase 5).

### [x] Fase 2 — Variables SERENO_KEY y SERENO_URL
- **Alcance:** `config/sereno.php` lee `SERENO_KEY`, `SERENO_URL`, `SERENO_TIMEOUT`, `SERENO_LEVEL`,
  `SERENO_FALLBACK_CHANNEL`, con respaldo en las `SERENO_LOG_*` (compatibilidad con posveapi). `url` toma por defecto
  la constante `SerenoServiceProvider::DEFAULT_URL` (hoy `null`: hasta definir el dominio del SaaS, sin URL no envía).
- **Archivos:** `config/sereno.php`, `src/SerenoServiceProvider.php` (+ tests).
- **Terminado cuando:** tests: las nuevas variables configuran el canal, las viejas siguen valiendo y las nuevas
  tienen prioridad.

### [x] Fase 3 — Comando sereno:install
- **Alcance:** `php artisan sereno:install {key} {--url=}`: valida el formato `wsk_`, escribe o reemplaza `SERENO_KEY`
  (y `SERENO_URL` si llega `--url`) en `.env` y agrega `sereno` a `LOG_STACK` sin duplicar. Si `LOG_CHANNEL` no es
  `stack`, avisa cómo agregarlo a mano. No toca archivos PHP. Sin `.env`, falla con un mensaje claro.
- **Archivos:** `src/Console/InstallCommand.php`, `src/SerenoServiceProvider.php` (+ test).
- **Terminado cuando:** tests sobre un `.env` temporal: alta, reemplazo, `LOG_STACK` vacío, con otros canales, ya con
  `sereno`, y clave inválida.

### [x] Fase 4 — Evento de prueba al instalar
- **Alcance:** `sereno:install` termina enviando un evento de prueba directo al endpoint de ingesta con la key y URL
  recién escritas y reporta el resultado: 202 conectado, 401 key inválida o revocada, error de red. Comando
  `sereno:test` con el mismo envío para usar después. `--no-test` lo omite.
- **Archivos:** `src/Console/TestCommand.php`, `src/Console/InstallCommand.php`, `src/Support/ConnectionTester.php`,
  `src/SerenoServiceProvider.php` (+ tests con `Http::fake`).
- **Terminado cuando:** tests de los tres resultados en ambos comandos.

### [x] Fase 5 — README para Packagist y v0.2.0
- **Alcance:** README desde cero: `composer require sereno/laravel`, `php artisan sereno:install`, variables nuevas y
  viejas, `sereno:test`, sin instrucciones de Gitea ni tokens. Commit y tag local `v0.2.0` (sin push).
- **Archivos:** `README.md`.
- **Terminado cuando:** cada comando, variable y valor por defecto del README coincide con el código (revisor).

### [ ] Fase 6 — Rotar reinicia el último uso
- **Alcance:** `LogSource::rotateKey` deja `last_used_at` en `null` (es el uso de la key nueva), para que el primer uso
  de una key rotada se detecte igual que el de una fuente nueva. Fijar el comando de tests del API desde un worktree.
- **Archivos:** `api/app/Models/LogSource.php` (+ test de rotación).
- **Terminado cuando:** test: tras rotar, `last_used_at` es null y el primer uso de la key nueva lo marca.

### [ ] Fase 7 — Evento log_source.connected [riesgo]
- **Alcance:** `markAsUsed()` distingue el primer uso (UPDATE `WHERE last_used_at IS NULL` que afecta una fila) y en
  ese caso emite `LogSourceConnected` al canal del proyecto (`log_source.connected`, payload `id`, `project_id`,
  `last_used_at`; sin key ni prefijo). Dos primeras peticiones simultáneas emiten un solo evento.
- **Archivos:** `api/app/Models/LogSource.php`, `api/app/Events/LogSourceConnected.php` (+ tests).
- **Terminado cuando:** tests: primer uso emite (`Event::fake`), los siguientes no, tras rotar vuelve a emitir;
  `broadcastOn` es el canal del proyecto. Suite completa del API en verde (L-49).

### [ ] Fase 8 — Suscripción a log_source.connected en la web
- **Alcance:** `subscribeToProject` acepta `onLogSourceConnected(payload)`, con type guard de la forma (L-13); el fake
  de tiempo real lo soporta.
- **Archivos:** `web/src/realtime/echo.ts`, `web/src/test/fakeRealtimeClient.ts`, `web/src/api/types.ts` (+ spec).
- **Terminado cuando:** spec de `echo` con payload válido e inválido.

### [ ] Fase 9 — Integraciones en tiempo real
- **Alcance:** `IntegrationsView` se suscribe al canal del proyecto (patrón de `PlanView`), actualiza `last_used_at`
  de la fila al recibir el evento, recarga en `onReconnect` y se desuscribe al cambiar de proyecto o desmontar.
- **Archivos:** `web/src/views/IntegrationsView.vue` (+ spec).
- **Terminado cuando:** spec: el evento actualiza la fila; cambio de proyecto suelta la suscripción vieja (L-28).

### [ ] Fase 10 — Comando de instalación en el diálogo de la key
- **Alcance:** `LogSourceKeyDialog` muestra primero el comando
  `composer require sereno/laravel && php artisan sereno:install <key> --url=<config.apiUrl>` con botón de copiar; el
  bloque `.env` pasa a `SERENO_KEY` y `SERENO_URL`; el `curl` queda para otros lenguajes.
- **Archivos:** `web/src/components/LogSourceKeyDialog.vue`, i18n `en`/`es` (+ spec).
- **Terminado cuando:** spec con la forma exacta de cada bloque copiado (L-51).

### [ ] Fase 11 — Estado de conexión en el diálogo
- **Alcance:** el diálogo recibe el estado de la fuente emitida y muestra "Esperando el primer evento…" con
  `aria-live` hasta que `last_used_at` deja de ser null, y entonces "Conectado". La vista pasa a `issuedSource` el
  `last_used_at` actualizado por el evento.
- **Archivos:** `web/src/components/LogSourceKeyDialog.vue`, `web/src/views/IntegrationsView.vue`, i18n (+ specs).
  Prueba manual: crear una fuente, correr el `curl` y ver "Conectado" sin recargar.
- **Terminado cuando:** specs de los dos estados y de la transición por evento; prueba manual hecha.

### [ ] Fase 12 — Publicar en Packagist [riesgo]
- **Alcance:** el usuario hace público el repo (Gitea público o espejo en GitHub, a decidir) y registra
  `sereno/laravel` en Packagist; push de `main` y `v0.2.0` solo con su pedido. Verificar en un contenedor limpio que
  `composer require sereno/laravel` instala sin credenciales y que el auto-discovery registra el provider.
- **Archivos:** ninguno en código (posible ajuste de README si cambia la URL del repo).
- **Terminado cuando:** instalación limpia desde Packagist verificada.

### [ ] Fase 13 — posveapi usa sereno/laravel de Packagist [riesgo]
- **Alcance:** en `feat/sereno-paquete`: quitar el repositorio `vcs`, `require sereno/laravel:^0.2`, namespace
  `Sereno\Laravel\` en `config/logging.php` y su test, variables `SERENO_KEY`/`SERENO_URL` en `.env.example`,
  `config/logging.php` y `scripts/build-notify.js`.
- **Archivos:** `composer.json`, `composer.lock`, `config/logging.php`, `.env.example`, `scripts/build-notify.js`
  (+ `SerenoLogChannelsTest`).
- **Terminado cuando:** tests de logging y `package:discover` en verde; un evento real llega a Sereno local.

## Decisiones
- 2026-10-10 — Paquete `sereno/laravel`, namespace `Sereno\Laravel\`, licencia MIT, en Packagist (usuario).
- 2026-10-10 — Dominio del SaaS aún sin definir: `DEFAULT_URL` queda `null` y el diálogo siempre agrega `--url`;
  cuando exista el dominio se fija la constante y se quita `--url` del diálogo (cambio de una línea en cada lado).
- 2026-10-10 — El instalador solo edita `.env` (`SERENO_KEY`, `SERENO_URL`, `LOG_STACK`), nunca archivos PHP.
- 2026-10-10 — Las variables `SERENO_LOG_*` siguen valiendo como respaldo en 0.x para no romper posveapi.
- 2026-10-10 — "Conectado" se basa en el primer uso de la key (`last_used_at` de null a valor) con un evento Reverb al
  canal del proyecto; rotar reinicia `last_used_at`. Cambio de semántica del API: "último uso" pasa a ser el de la key
  vigente.
- 2026-10-10 — OTLP y SDKs de otros lenguajes quedan fuera de este plan.
- 2026-10-10 — Worktrees: paquete en `../sereno-laravel/.claude/worktrees/integracion-simple` (rama
  `feat/integracion-simple`); monorepo en `.claude/worktrees/plan-integracion-simple` (rama `docs/plan-integracion-simple`,
  la misma del plan). Las fases 12 y 13 esperan al usuario (publicación).

## Notas para la próxima sesión
- Plan aprobado y en ejecución; worktrees creados (ver Decisiones).
- Fase 1: `LICENSE` con titular genérico "2026 Sereno" (el usuario puede cambiarlo). README aún con el nombre viejo
  hasta la fase 5. Los commits del paquete van en su worktree; los del plan, en este.
- Fase 2: `config/sereno.php` usa `env('SERENO_X', env('SERENO_LOG_X', default))`. Un `SERENO_KEY=` vacío tapa a
  `SERENO_LOG_KEY` (env solo cae al respaldo si la variable no existe): `sereno:install` nunca escribe valores vacíos.
  Con `DEFAULT_URL` null, `config('sereno.url')` es null: la fase 4 lo trata como "sin URL".
- Fase 3: `InstallCommand` valida key `/\Awsk_[A-Za-z0-9]+\z/` y `--url` con FILTER_VALIDATE_URL (rechaza `$ " ' \` y
  backtick); soporta `.env` en CRLF; `LOG_STACK` ausente se toma como `single`. Agrega `illuminate/console ^13.0`.
  Para la fase 4: el install pasa `$key` y `$url` directo al tester (la config del proceso no ve el `.env` recién
  escrito); `sereno:test` usa `config('sereno.key')` y `config('sereno.url')`. Mensajes de consola en inglés.
- Fase 4: `ConnectionTester::test(?url, ?key)` envía `POST {url}/api/ingest/events` (Bearer) con un evento `info`
  "Sereno connection test" armado por `EventFormatter`; estados `connected|unauthorized|no_url|no_key|failed`, timeout 5 s.
  `sereno:test` sale FAILURE si no conecta; `sereno:install` sale SUCCESS aunque la prueba falle (el `.env` ya quedó
  escrito): el README de la fase 5 lo dice, junto con `sereno:test` y `--no-test`. URL efectiva del install: `--url`,
  luego `SERENO_URL` del `.env`, luego `config('sereno.url')`.
- Fase 5: README en inglés; tag anotado local `v0.2.0` sobre el commit de la fase 5 en `feat/integracion-simple`
  (sin merge a `main` del paquete ni push: esperan al usuario, fase 12). El README no nombra la URL del repo.

## Mejoras propuestas

- M-1: Ordenar alfabéticamente los `use` de `tests/Unit/Logging/EventFormatterTest.php` (paquete; `Sereno\` quedó antes
  de `Monolog\`). Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet

- M-2: Agregar `.gitattributes` al paquete (`* text=auto eol=lf`) para evitar ruido LF/CRLF en Windows.
  Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet

- M-3: `sereno:install` ignora comentarios en línea (`LOG_STACK="a,b" # nota`) y detecta `export NAME=` o espacios
  antes del `=` para no duplicar la variable. Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet

- M-4: Compartir `INGEST_PATH` entre `ConnectionTester` y `SerenoLogHandler` (paquete) y enviar la prueba con
  `withoutRedirecting()` para que una redirección dé un mensaje claro. Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
