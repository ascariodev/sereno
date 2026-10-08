# Plan: web-docker

**Objetivo:** que la web se desarrolle en Docker (Vite con recarga, tests y typecheck dentro del contenedor) y que
`api/` y `web/` tengan un stack de producción en Docker desplegable como bidfletes/fletes-api (Gitea).
**Estado:** pausado (esperando datos de Gitea y servidor) · Fase actual: 6
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

### [ ] Fase 6 — Despliegue del API por Gitea (`api/`) [riesgo]
- **Requiere:** ruta del servidor, dominio y nombre del proyecto compose (los da el usuario), y el repo `sereno`
  publicado (fase 8 de `monorepo-sereno`). `ejecutar-plan` se detiene antes si faltan.
- **Alcance:** `.gitea/workflows/deploy-api.yml` con `on.push.branches: [main]` y
  `paths: ['api/**', '.gitea/workflows/deploy-api.yml']`. Scripts adaptados de fletes-api en `api/docker/deploy/`:
  `rsync` de `api/` (sin `.env`/`vendor`/`storage`) a la ruta del API en el servidor, rebuild por hash de
  `api/docker/` + `api/docker-compose.prod.yml`, composer `--no-dev`, permisos, `optimize`, `migrate --force`, reinicio
  de queue y reverb.
- **Archivos:** `.gitea/workflows/deploy-api.yml` y los scripts de `api/docker/deploy/`.
- **Terminado cuando:** los scripts corren en local contra el stack de la fase 5, el workflow pasa una validación de
  sintaxis y un cambio solo en `web/` no lo dispara (filtro `paths` revisado); el primer deploy real lo confirma el
  usuario.

### [ ] Fase 7 — Despliegue de la web por Gitea (`web/`) [riesgo]
- **Requiere:** lo mismo que la fase 6, la ruta de la web en el servidor y dónde viven los `VITE_*` de producción
  (servidor o secretos de Gitea).
- **Alcance:** `.gitea/workflows/deploy-web.yml` con `paths: ['web/**', '.gitea/workflows/deploy-web.yml']`: en
  `web/`, `npm ci && npm run build` con los `VITE_*` de producción, `rsync` de `web/dist/` y
  `web/docker/nginx/default.conf`, y `up -d` de `web/docker-compose.prod.yml` solo si cambió.
- **Archivos:** `.gitea/workflows/deploy-web.yml` (+ script en `web/docker/deploy/` si hace falta).
- **Terminado cuando:** el build del workflow corre en local con `VITE_*` de prueba, el workflow pasa una validación
  de sintaxis y un cambio solo en `api/` no lo dispara; el primer deploy real lo confirma el usuario.

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

## Notas para la próxima sesión
- Fase 6: con `validate_timestamps=0` el deploy reinicia `app`, `queue`, `scheduler` y `reverb`. El UID 1000 debe
  coincidir con el dueño del repo en el servidor (chown de `storage` y `bootstrap/cache`; `.env` legible por `app`).
- Fase 6: migrar antes de levantar `queue` en el primer deploy (o reiniciarlo después). `optimize` no se probó en local.
  El proxy del host debe añadir `X-Forwarded-For` (`$proxy_add_x_forwarded_for`), fijar `X-Forwarded-Proto` y
  reenviar `Host` (`proxy_set_header Host $host`, si no `url()` da `https://127.0.0.1:8003`); no
  publicar `API_BIND` en `0.0.0.0`. Si conviven dev y prod en la misma máquina, cambiar los puertos por defecto. El tag
  `workspace-api-fpm` es compartido por todos los proyectos compose de la máquina.
- `web/dist/` local quedó con un build de prueba (`VITE_*` falsos); ignorado por git, reconstruir si se usa.
- Fases 6 y 7: pedir al usuario ruta del servidor, dominios, proyecto compose y dónde van los `VITE_*` antes de
  empezar; el repo `sereno` tiene que estar publicado.

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
