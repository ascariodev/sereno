# Plan: web-docker

**Objetivo:** que la web se desarrolle en Docker (Vite con recarga, tests y typecheck dentro del contenedor) y que
`api/` y `web/` tengan un stack de producción en Docker desplegable como bidfletes/fletes-api (Gitea).
**Estado:** terminado · 9/9 fases
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Monorepo `sereno` (plan `monorepo-sereno`): `api/` (fases 4 a 6) y `web/` (fases 1, 3, 7); todo se commitea en la
  raíz. Las fases 1 a 5 se hicieron con los repos separados y conservan los nombres viejos (`workspace-api/` = `api/`,
  `workspace-web/` = `web/`).
- Desarrollo: la raíz hace `include` de `api/docker-compose.yml` y `web/docker-compose.yml` (proyecto `workspace`:
  api con `php:8.4-cli-alpine` + `artisan serve` en 8003, reverb 8086, queue, scheduler, postgres 18 en 5435, y `web`
  con Vite en 5174 desde la fase 1).
- Web: `src/config.ts` lee `VITE_API_URL`, `VITE_REVERB_APP_KEY`, `VITE_REVERB_HOST`, `VITE_REVERB_PORT`,
  `VITE_REVERB_SCHEME` **al compilar**. Router en history mode (`createWebHistory`): producción necesita fallback SPA.
  `VITE_REVERB_APP_KEY` está en `web/.env.local` (lo crea el usuario; nunca leerlo ni mostrarlo).
- Referencia de desarrollo: `../sicm/.docker-workspace/sicm-v2/docker-compose.yml`, servicio `vite` (node, bind mount,
  `node_modules` en volumen con nombre, `npm install` si falta `node_modules/.bin/vite`, `--host 0.0.0.0`; sin polling,
  con `origin`).
- Referencia de producción: `../bidfletes/fletes-api/` (`docker-compose.yml`, `docker/php/Dockerfile` php-fpm,
  `docker/nginx/default.conf`, `.dockerignore`, `.gitea/workflows/deploy.yml`). El código no se copia a la imagen: el
  runner hace build y `rsync` a la ruta del servidor (sin `.env`, `vendor`, `storage`), y un script reconstruye
  imágenes solo si cambió el hash de `docker/` + compose; luego composer, permisos, `optimize`, `migrate --force`,
  reinicios. El `.env` vive solo en el servidor.
- API: health en `/up`; CORS `*` fijo en `config/cors.php` (auth Bearer); no usa `storage:link`; sin `.dockerignore`.
- Remoto: `https://gitea.ascario.dev/ascario/sereno.git` (rama `main`). Las fases 6 y 7 son dos workflows en
  `.gitea/workflows/` de la raíz, cada uno con filtro `paths` para que un push solo despliegue la app que cambió.
  Requieren los datos del servidor.

## Fases

### [x] Fase 1 — Servicio de desarrollo `web` en Docker (workspace-web)
- **Alcance:** `workspace-web/docker-compose.yml` con servicio `web` (`node:24`, bind mount del repo, `node_modules` en
  volumen con nombre, `npm install` si falta Vite, `npm run dev -- --host 0.0.0.0`, puerto 5174) incluido desde el
  `docker-compose.yml` de la raíz. `vite.config.ts`: `host` y polling del watcher activables por variable de entorno
  (el bind mount desde Windows no propaga eventos), sin cambiar el comportamiento fuera de Docker. Los tests y el
  typecheck corren con `docker compose exec web ...`.
- **Archivos:** `workspace-web/docker-compose.yml`, `docker-compose.yml` (raíz), `workspace-web/vite.config.ts`.
- **Terminado cuando:** `docker compose up -d` levanta `web` junto al API; http://localhost:5174 responde; un cambio
  en un `.vue` se refleja sin reiniciar; `docker compose exec web npm run test -- --run` y `... run typecheck` pasan.

### [x] Fase 2 — Documentación y preview apuntan al servicio `web`
- **Alcance:** "Comandos" y mapa de `CLAUDE.md` (la web corre en Docker; comandos `docker compose exec web ...`;
  `npm install` dentro del contenedor), `.claude/launch.json` (adjuntar a http://localhost:5174 en vez de lanzar npm)
  y cualquier skill/regla de `.claude/` que nombre `npm --prefix workspace-web`.
- **Archivos:** `CLAUDE.md`, `.claude/launch.json`, y las skills/reglas que lo citen (buscar con grep; si son más de 3,
  dividir).
- **Terminado cuando:** grep sin `npm --prefix workspace-web` fuera de notas históricas; `preview_start` con
  `workspace-web` abre la web servida por el contenedor.

### [x] Fase 3 — Stack de producción de la web (workspace-web)
- **Alcance:** nginx que sirve `dist/` con fallback SPA (`try_files $uri /index.html`), `index.html` sin caché y
  `assets/` con caché larga e inmutable, gzip. `docker-compose.prod.yml` con `nginx:alpine`, `dist/` y la conf montados
  (patrón fletes-api), `restart: unless-stopped`, puerto configurable. `.dockerignore`.
- **Archivos:** `workspace-web/docker/nginx/default.conf`, `workspace-web/docker-compose.prod.yml`,
  `workspace-web/.dockerignore`.
- **Terminado cuando:** con un `dist/` construido en el contenedor de desarrollo (con `VITE_*` de prueba), el stack de
  producción levantado en local con otro `-p` y otro puerto responde 200 en `/`, en una ruta profunda
  (`/channels/2`, devuelve `index.html`) y en un asset; cabeceras de caché correctas.

### [x] Fase 4 — Imagen PHP-FPM de producción del API (workspace-api)
- **Alcance:** Dockerfile `php:8.4-fpm-alpine` con las mismas extensiones que la imagen de desarrollo, opcache para
  producción y `uploads.ini`; usuario sin privilegios. Conf de nginx (`root public`, `fastcgi_pass app:9000`,
  `client_max_body_size` acorde a `uploads.ini`). `.dockerignore` que limite el contexto como fletes-api. La imagen de
  desarrollo no cambia.
- **Archivos:** `workspace-api/docker/php-fpm/Dockerfile`, `workspace-api/docker/php-fpm/opcache.ini`,
  `workspace-api/docker/nginx/default.conf`, `workspace-api/.dockerignore`.
- **Terminado cuando:** la imagen construye; `php -m` dentro muestra las extensiones; `docker compose build api`
  (desarrollo) sigue funcionando con el `.dockerignore` nuevo.

### [x] Fase 5 — Compose de producción del API (workspace-api) [riesgo]
- **Alcance:** `docker-compose.prod.yml` separado del de desarrollo: `nginx` (puerto configurable) + `app` (fpm) +
  `queue` + `scheduler` + `reverb` + `postgres:18-alpine` (solo `127.0.0.1`, volumen con nombre, healthcheck), todos con
  `restart: unless-stopped`, bind del repo y `.env` del servidor. Reverb publicado para que el proxy del host termine
  TLS. Healthcheck de `nginx`/`app` sobre `/up`.
- **Archivos:** `workspace-api/docker-compose.prod.yml` (+ ajustes menores a la fase 4 si aparecen).
- **Terminado cuando:** `docker compose -f docker-compose.prod.yml config --quiet` pasa y, levantado en local con otro
  `-p` y otros puertos (sin tocar el stack de desarrollo ni leer `.env`), `/up` da 200 a través de nginx, un job de la
  cola se procesa y reverb acepta conexión.

### [x] Fase 6 — Imagen por ambiente y scripts de deploy del API (`api/`) [riesgo]
- **Alcance:** en `api/docker-compose.prod.yml`, `image: ${API_IMAGE:-workspace-api-fpm}` para que cada ambiente
  tenga su imagen. Scripts en `api/docker/deploy/`, adaptados de fletes-api y parametrizados por ambiente
  (`prod`/`qa`/`dev`): `compose.sh` (docker:cli con la ruta del host montada en la misma ruta, `-p sereno-<env>-api`),
  `rebuild-images.sh` (build + `up -d` solo si cambió el hash de `docker/`, `docker-compose.prod.yml` y
  `.dockerignore`; hash en `.deploy/` de la ruta del ambiente) y `deploy.sh`: crea la estructura de `storage/`,
  `up -d postgres app nginx`, `composer install --no-dev` dentro de `app`, `chown` de `storage` y `bootstrap/cache` a
  `app` (como root), `optimize`, `migrate --force`, `db:seed --class=RoleSeeder --force` (verificar que sea
  idempotente), `up -d --remove-orphans` y reinicio de `app`, `queue`, `scheduler` y `reverb`
  (`validate_timestamps=0`). Todo artisan como `app`.
- **Archivos:** `api/docker-compose.prod.yml`, `api/docker/deploy/*.sh` (nuevos).
- **Terminado cuando:** `docker compose -f docker-compose.prod.yml config --quiet` pasa con y sin `API_IMAGE`;
  `bash -n` pasa en los scripts; `deploy.sh` corre en local contra un stack de prueba (otro `-p`, otros puertos,
  `.env` de prueba creado para la prueba) y deja `/up` en 200.

### [x] Fase 7 — Workflow de deploy del API (`.gitea/workflows/deploy-api.yml`) [riesgo]
- **Alcance:** `on.push.branches: [main, qa, dev]` con `paths: ['api/**', '.gitea/workflows/deploy-api.yml']`. Un paso
  resuelve el ambiente por rama (`main` → `prod`, `qa` → `qa`, `dev` → `dev`) y fija `HOST_DIR`
  (`/var/www/html/workspace/<env>/api`) y `SERVER_DIR` (`/workspace/<env>/api`, montaje del runner). Instala `rsync` y
  el cliente docker como fletes-api; falla si no existe `$SERVER_DIR/.env`; `rsync -a --delete` de `api/` sin
  `.git`, `.env`, `/storage/`, `/vendor/`, `/.deploy/`; luego `rebuild-images.sh` y `deploy.sh`, y guarda el hash.
- **Archivos:** `.gitea/workflows/deploy-api.yml`.
- **Terminado cuando:** el YAML pasa una validación de sintaxis, el filtro `paths` no dispara con un cambio solo en
  `web/`, y el mapeo rama → ambiente se revisó para las tres ramas.

### [x] Fase 8 — Deploy de la web (`web/`) [riesgo]
- **Alcance:** `.gitea/workflows/deploy-web.yml`, mismas ramas y mapeo, `paths: ['web/**',
  '.gitea/workflows/deploy-web.yml']`. `actions/setup-node` con Node 24 (`engines`), copia
  `$SERVER_DIR/.env` (las `VITE_*` y `WEB_PORT` del ambiente, viven en el servidor) a `web/.env.production.local`,
  `npm ci && npm run build`, `rsync --delete` de `web/dist/`, `web/docker/nginx/default.conf` y
  `web/docker-compose.prod.yml` a `/workspace/<env>/web`, y `up -d` con `-p sereno-<env>-web` (recrea solo si cambió
  la conf). Falla si falta el `.env` del servidor.
- **Archivos:** `.gitea/workflows/deploy-web.yml` (+ script en `web/docker/deploy/` si hace falta).
- **Terminado cuando:** el build corre en local con un `.env.production.local` de prueba, el YAML pasa una validación
  de sintaxis y un cambio solo en `api/` no lo dispara.

### [x] Fase 9 — Primer deploy de producción (con el usuario)
- **Alcance:** el usuario crea en el servidor `/var/www/html/workspace/prod/{api,web}/.env` con las plantillas que
  se le pasan (sin que Claude vea los valores), habilita Actions en `sereno` y se hace el merge a `main`. Se revisa el
  job y se verifica `https://sereno-api.ascario.dev/up`, la web y la conexión a `sereno-ws.ascario.dev`.
- **Terminado cuando:** los tres responden, login y un canal funcionan en producción, y el primer deploy queda
  confirmado por el usuario.

## Decisiones
- 2026-10-07 — Se sigue el patrón de fletes-api: el código no va dentro de la imagen; producción monta el repo
  sincronizado por `rsync`. Para la web, el `dist/` se construye en el runner y nginx lo sirve montado (en vez de un
  Dockerfile multi-stage), porque los `VITE_*` se fijan al compilar y así viven en el servidor como el `.env` del API.
- 2026-10-07 — Los compose de producción son `docker-compose.prod.yml` dentro de cada repo; los `docker-compose.yml`
  siguen siendo los de desarrollo (la raíz los incluye). Distinto de fletes-api, donde el del repo es el de deploy.
- 2026-10-07 — TLS lo termina el proxy del host (fuera del plan); los stacks publican HTTP.
- 2026-10-08 — Monorepo: un workflow por app en `.gitea/workflows/` de la raíz con filtro `paths`; cada app sigue con
  su `docker-compose.prod.yml` y su ruta propia en el servidor (solo se sincroniza su carpeta).
- 2026-10-07 — Fase 1: `vite.config.ts` activa `server.host` con `DEV_HOST` y el polling con `DEV_POLLING=true`; sin
  ellas no cambia nada fuera de Docker. Los comandos de la web se corren desde la raíz (`docker compose exec web ...`):
  dentro de `workspace-web/` compose usa otro nombre de proyecto.
- 2026-10-07 — Fase 2: `.claude/launch.json` se adjunta por `url` + `port`, sin comando (el contenedor lo levanta
  `docker compose up -d`). El README de `workspace-web` también pasó a los comandos con Docker.
- 2026-10-07 — Fase 3: el puerto de producción de la web es `WEB_PORT` (8080 por defecto); `dist/` y la conf se montan
  en solo lectura. `.dockerignore` es `*` porque ninguna imagen copia código. La fase 7 sincroniza `dist/` y
  `docker/nginx/default.conf`.
- 2026-10-07 — Fase 4: la imagen fpm se construye con contexto en la raíz del repo
  (`dockerfile: docker/php-fpm/Dockerfile`); `.dockerignore` es `*` con excepciones para `docker/php/uploads.ini` y
  `docker/php-fpm/opcache.ini` (el build de desarrollo usa contexto `./docker/php` y no se ve afectado). Usuario `app`
  UID/GID 1000; composer va en la imagen para correr `--no-dev` dentro. `opcache.validate_timestamps=0`.
- 2026-10-07 — Fase 5: el compose de producción no usa `env_file`: Laravel lee el `.env` del repo montado y compose lo
  usa para las credenciales de postgres; `DB_HOST/PORT` y `REVERB_HOST/PORT/SCHEME` internos van en `environment`.
  Puertos `${API_BIND:-127.0.0.1}:${API_PORT:-8003}`, `${REVERB_BIND:-127.0.0.1}:${REVERB_PUBLISH_PORT:-8086}`,
  postgres `127.0.0.1:${DB_PUBLISH_PORT:-5435}`. Sin `name:`: el proyecto lo fija el deploy con `-p`. Solo `app`
  construye la imagen `workspace-api-fpm`. `trustProxies(at: 'REMOTE_ADDR')` (confía solo en nginx, toma la IP real
  de `X-Forwarded-For`), con `TrustProxiesTest`. Por M-3 solo confía en `X-Forwarded-For` y `X-Forwarded-Proto`:
  el host público sale del `Host` que recibe nginx, sin subpath ni puerto público distinto de 80/443.

- 2026-10-09 — Servidor `server.ascario.dev` (Debian 13): HTTPS por Cloudflare Tunnel (`cloudflared` en el host), sin
  nginx de por medio; el runner `gitea_runner` (act_runner 0.6.1, etiquetas `ubuntu-latest`) monta en los jobs
  `/var/www/html/workspace` en `/workspace` (`options` y `valid_volumes` de su `config.yaml`, ya hecho).
- 2026-10-09 — Tres ambientes en `/var/www/html/workspace/{prod,qa,dev}/{api,web}`, uno por rama (`main`, `qa`,
  `dev`), proyectos compose `sereno-<env>-api` y `sereno-<env>-web`. Puertos solo en `127.0.0.1`: prod web 8090, API
  8091, Reverb 8092, Postgres 5440; qa 8093-8095 y 5441; dev 8096-8098 y 5442 (8080, 8000 y 8081 están ocupados).
  Los puertos, `API_IMAGE` y las `VITE_*` de cada ambiente van en el `.env` de su carpeta en el servidor.
- 2026-10-09 — Hostnames (un nivel, por el certificado universal de Cloudflare): `sereno`, `sereno-api`, `sereno-ws`
  `.ascario.dev` para prod; `sereno-qa*` y `sereno-dev*` para los otros. Ya dados de alta en el túnel.
- 2026-10-09 — Fases 6 y 7 originales reemplazadas por las 6 a 9 (ambientes, scripts, workflows y primer deploy).
- 2026-10-09 — Fase 6: los scripts de `api/docker/deploy/` reciben `DEPLOY_ENV` (prod|qa|dev), `HOST_DIR` (ruta del
  host, para el daemon) y `SERVER_DIR` (ruta en el job; por omisión `HOST_DIR`); `env.sh` valida y fija
  `-p sereno-<env>-api`, `compose` y `artisan` (por `compose exec`, sin nombres de contenedor fijos). No tienen modo
  ejecutable: se invocan con `bash`. `rebuild-images.sh` deja el hash en `.deploy/docker.sha256.new` (excluye
  `docker/deploy/`) y recrea con `--force-recreate`; `deploy.sh` lo guarda solo si `/up` da 200, así que la fase 7 no
  guarda el hash. `deploy.sh`: corta si `app` no puede leer `.env`; crea `vendor/` y le da dueño `app` como root (el
  rsync del job deja el repo de root); composer dentro de `app` con sus scripts; `migrate`, `RoleSeeder`
  (idempotente) y luego `optimize`; reinicia `nginx` después de `app` (guarda la IP de `app` al arrancar: 502). Sin
  `storage:link`: los adjuntos usan el disco `local` por stream.
- 2026-10-09 — Fase 7: `deploy-api.yml` resuelve el ambiente en `$GITHUB_ENV`, comprueba `$SERVER_DIR/.env` antes del
  checkout (sin `mkdir` del destino: lo crea el usuario con su `.env`, con dueño 1000), y hace `rsync -a --delete` de
  `api/` sin `.git`, `.env`, `node_modules`, `/storage/`, `/vendor/`, `/.deploy/` ni `/bootstrap/cache/` (los cachés de
  `optimize`). Los scripts corren desde el checkout. Sin `concurrency`: Gitea 1.25.5 no lo soporta; con `capacity` del
  runner mayor que 1, dos deploys del mismo ambiente podrían pisarse.
- 2026-10-09 — Fase 8: `deploy-web.yml` sigue el esquema del API (ambiente en `$GITHUB_ENV`, chequeo de `.env` antes del
  checkout, `setup-node@v4` con Node 24); copia `$SERVER_DIR/.env` a `web/.env.production.local` y compila. Sincroniza
  primero `dist/assets/` sin borrar y luego `dist/` con `--delete-after` (actualiza dentro del directorio montado, no lo
  recrea); conf y compose archivo a archivo, sin `--delete`. `web/docker/deploy/deploy.sh` recrea nginx con
  `--force-recreate` solo si cambió el hash de compose + conf (`.deploy/nginx.sha256`, guardado tras un 200 en `/`);
  el hash no incluye el `.env` (compose detecta solo un cambio de `WEB_PORT`).
- 2026-10-10 — Fase 9: primer deploy de producción (merge `742cec7`, push a Gitea): los dos workflows en verde; `/up`,
  la web (también rutas profundas) y `sereno-ws` (101) responden; login, organización, proyecto y canal en vivo
  confirmados por el usuario. La web no tiene registro ni alta de organización o proyecto: se hicieron por `curl` al API.

## Notas para la próxima sesión
- Fase 6: con `validate_timestamps=0` el deploy reinicia `app`, `queue`, `scheduler` y `reverb`. El UID 1000 debe
  coincidir con el dueño del repo en el servidor (chown de `storage` y `bootstrap/cache`; `.env` legible por `app`).
- Fase 6: migrar antes de levantar `queue` en el primer deploy (o reiniciarlo después). `optimize` no se probó en local.
  El proxy del host debe añadir `X-Forwarded-For` (`$proxy_add_x_forwarded_for`), fijar `X-Forwarded-Proto` y
  reenviar `Host` (`proxy_set_header Host $host`, si no `url()` da `https://127.0.0.1:8003`); no
  publicar `API_BIND` en `0.0.0.0`. Si conviven dev y prod en la misma máquina, cambiar los puertos por defecto. El tag
  `workspace-api-fpm` es compartido por todos los proyectos compose de la máquina.
- `web/dist/` local quedó con un build de prueba (`VITE_*` falsos); ignorado por git, reconstruir si se usa.

## Mejoras propuestas
- [x] M-1 (baja, sonnet) — `workspace-web/docker-compose.yml`: correr el servicio `web` como `user: node` para que
  `npm install` dentro del contenedor no reescriba `package-lock.json` como root en el bind mount.
- [x] M-2 (baja, sonnet) — `workspace-web/README.md`: indicar que `docker compose up -d` desde la raíz ya sirve Vite en
  http://localhost:5174.
- [x] M-3 (alta, opus) — `workspace-api/bootstrap/app.php`: limitar `trustProxies` a
  `HEADER_X_FORWARDED_FOR | HEADER_X_FORWARDED_PROTO` para que un cliente no manipule `url()` con
  `X-Forwarded-Host/Port/Prefix` si el proxy del host no los fija; ampliar `TrustProxiesTest`.
- [x] M-4 (baja, sonnet) — `workspace-web/docker-compose.yml`: hacer condicional el `chown -R` de `web-init` (solo si
  `find /app/node_modules ! -user node -print -quit` encuentra algo, no `stat` de la raíz) para no recorrer todo `node_modules` en cada `up`; quitar `restart: "no"`.
- [x] M-5 (baja, sonnet) — `workspace-api/docker-compose.prod.yml:23`: precisar el comentario "confía en X-Forwarded-*"
  (tras M-3 solo `For` y `Proto`).
- [x] M-6 (baja, sonnet) — `api/docker/deploy/deploy.sh:3`: el comentario de cabecera nombra el dueño de `storage` y
  `bootstrap/cache`; agregar `vendor/`.
- [x] M-7 (baja, sonnet) — `api/docker/deploy/deploy.sh:25`: el mensaje de error de `test -r .env` asume que la causa es
  el `.env`; mencionar también que `app` puede no poder entrar al directorio.
- [x] M-8 (media, sonnet) — Caché persistente de composer para el deploy (volumen o carpeta en `/var/www/html/workspace`),
  para no descargar todo cuando se recrea `app`.
- [ ] M-9 (baja, sonnet) — Agregar `concurrency` por ambiente a los workflows de deploy cuando Gitea lo soporte (no
  está en 1.25.5), o confirmar `capacity: 1` en el `config.yaml` del runner.
- [x] M-10 (baja, sonnet) — `.gitea/workflows/deploy-web.yml`: `--chmod=D755,F644` en los rsync de `dist/` y de la conf,
  para no depender del umask del runner.
- [x] M-11 (media, sonnet) — Conservar los assets del deploy anterior en `dist/assets/` (p. ej. borrar solo los de más
  de N deploys), para que una pestaña abierta con el `index.html` viejo no dé 404 al cargar rutas diferidas.
- [ ] M-12 (baja, sonnet) — `.gitea/workflows/deploy-web.yml`: el `find` de poda de `dist/assets` falla con `set -e` si el directorio no existe; protegerlo con `[ -d ... ]` o `|| true`.
