# Sereno

Sereno (antes Workspace; la carpeta local, los contenedores y las claves internas conservan `workspace`) es un espacio de trabajo unificado multi-tenant para equipos, con tres módulos integrados alrededor del proyecto:
chat (comunicación), plan (gestión de proyectos) y log (avisos y retroalimentación de los sistemas de cada
proyecto, que llegan a los canales del proyecto). Primer cliente: el equipo propio (reemplaza Slack para los
logs de posveapi); a futuro, SaaS. Clientes previstos: web, escritorio (Windows, Linux, Mac) y móvil.

## Mapa del workspace

```
api/   Laravel 13 (solo API) + PostgreSQL 18. Sanctum (Bearer), spatie/laravel-permission
       (teams = organization), laravel-lang, Reverb, Pest. Pasos 1 a 5 del MVP hechos.
web/   Vue 3 + TypeScript + Vite SPA, Vitest (jsdom). Corre en Docker (servicio `web`, `node:24`).
       Escritorio: PWA y Tauri v2 (Windows) con la misma SPA, proyecto en `web/src-tauri/`.
app/   Expo (Expo Router, TypeScript), móvil Android. Corre en el host, no en Docker.
docker-compose.yml  Solo `include` de `api/docker-compose.yml` y `web/docker-compose.yml` (cada entorno vive en su carpeta).
docs/  Planes por tarea (docs/plans/), lecciones y diseño.
```

**Monorepo:** la raíz es el repo `sereno` (`https://gitea.ascario.dev/ascario/sereno.git`, rama `main`), con el
historial de los antiguos `workspace-api` y `workspace-web` bajo `api/` y `web/`. Los comandos `git` se corren en la
raíz. Cada app conserva su toolchain y su despliegue; los workflows de Gitea filtran por ruta.

Arquitectura: monolito modular en Laravel (núcleo, chat, plan, log) comunicado por eventos y colas, sin
microservicios. Los canales guardan mensajes de personas y de sistema en el mismo modelo; los avisos de log
son mensajes del canal con acciones.

## Puertos

Elegidos para no chocar con posven (8000/5432), bidfletes (8001/5433/8080) y medic (8002/5434/8081/8085).

| Servicio | Puerto |
|---|---|
| API (`artisan serve`) | 8003 |
| PostgreSQL 18 | 5435 |
| Reverb (WebSocket) | 8086 |
| Mailpit, interfaz web (solo localhost) | 8026 |
| Mailpit, SMTP desde el host (solo localhost) | 1026 |
| Web (Vite dev, `strictPort`) | 5174 |
| Metro (Expo, `app/`) | 8087 |

## Comandos

Todo desde la raíz. No hay PHP ni Composer en la máquina y no se instalan: el API corre en Docker.
Válidos desde la fase 2 del plan `nucleo`.

- Levantar: `docker compose up -d` (`--build` tras cambiar `api/docker/php/Dockerfile`)
- Base desde cero: `docker compose exec api php artisan migrate:fresh --seed`
- Dependencias PHP: `docker compose exec api composer install`
- Tests API: `docker compose exec api php artisan test --compact`
  (un archivo: `... test --compact tests/Feature/Core/AuthTest.php`; un caso: `--filter=nombre`)
- Cola y scheduler: servicios `queue` (`queue:work --tries=3`) y `scheduler` (`schedule:work`), misma imagen
  y volumen que `api`. Logs: `docker compose logs --tail=50 queue` (o `scheduler`). El worker no recarga
  el código: tras cambiar un job o algo que use, `docker compose restart queue`.
- Correo en desarrollo: servicio `mailpit` (captura todo, no envía fuera). Interfaz en http://localhost:8026.
  El usuario pone en `api/.env` (nadie más lo edita) y luego
  `docker compose restart api queue reverb scheduler` (cargan el `.env`):
  `MAIL_MAILER=smtp`, `MAIL_HOST=mailpit`, `MAIL_PORT=1025`, `MAIL_USERNAME=null`, `MAIL_PASSWORD=null`,
  `MAIL_FROM_ADDRESS="noreply@sereno.test"`, `MAIL_FROM_NAME="Sereno"`.
  El puerto 1025 es el interno de la red de Docker; desde el host el SMTP está en `127.0.0.1:1026`.
- Formato API: `docker compose exec api ./vendor/bin/pint --test -q` (sin `--test` corrige)
- Traducciones del framework: `docker compose exec api php artisan lang:update`

Web (servicio `web` en Docker, Vite con recarga en http://localhost:5174; `docker compose up -d` lo levanta junto al API;
siempre desde la raíz, dentro de `web/` compose usa otro nombre de proyecto):
- Dependencias: `docker compose exec web npm install`. Al arrancar solo corre si falta Vite: tras cambiar
  `package.json`, correrlo a mano. El volumen `web-node-modules` tapa el `node_modules` del host.
- Tipos: `docker compose exec web npm run typecheck`
- Tests: `docker compose exec web npm run test -- --run` (un archivo: `... -- --run src/config.spec.ts`)
- Build: `docker compose exec web npm run build`
- Logs: `docker compose logs --tail=50 web`
- Configuración en `web/src/config.ts` (`VITE_API_URL`, `VITE_REVERB_*`, con valores de desarrollo por
  defecto salvo `VITE_REVERB_APP_KEY`, que va en `web/.env.local` y lo crea el usuario).

Escritorio (Tauri, en el **host Windows**, no en Docker; desde `web/`). En Git Bash anteponer
`export PATH="/c/Users/Windows 11/.cargo/bin:$PATH"`. `npm install` también en el host (su `node_modules` no choca con el
del contenedor).
- Desarrollo: `npm run tauri:dev`, con el Vite de Docker ya corriendo en 5174.
- Instalador de prueba: `npm run tauri:build -- --debug` (deja el NSIS y el MSI en `src-tauri/target/debug/bundle/`). Compila
  la SPA en el host: sobrescribe `web/dist` y usa `web/.env.production` (lo mantiene el usuario y no se lee; lleva las `VITE_*` de producción: `VITE_API_URL`, `VITE_REVERB_*`). Los avisos con clic y el
  autostart solo se comprueban con la app **instalada**.
- Publicar: la clave de firma está en `C:\Users\Windows 11\.tauri\sereno.key` (fuera del repo; en PowerShell `~` no se
  expande, usar rutas absolutas). En PowerShell: `$env:TAURI_SIGNING_PRIVATE_KEY_PATH` con esa ruta y
  `$env:SERENO_DESKTOP_SCP_TARGET="<usuario>@<host>:/var/www/html/workspace/prod/web/desktop/"`; luego
  `npm run release:desktop [-- <versión|patch|minor|major>]` (`--dry-run` y `--skip-build` disponibles). `SERENO_DESKTOP_BASE_URL` es opcional (por defecto `https://sereno.ascario.dev/desktop/`). Sube la versión,
  compila, firma y sube por `scp` el instalador y `latest.json`; hay que **commitear el bump de versión**. La carpeta del
  servidor la crea root en el deploy: darle dueño al usuario del `scp` (`sudo chown <usuario>: ...`). El actualizador lee
  `https://sereno.ascario.dev/desktop/latest.json` y la app busca versión nueva al arrancar y cada 6 h.
- SPA: `web/src/platform/` concentra lo de escritorio (`isDesktop()` envuelve `isTauri()`; en specs, `vi.stubGlobal('isTauri',
  true)`). En escritorio no hay service worker ni Web Push: los avisos nativos de las notificaciones en vivo siguen las
  preferencias `push` por tipo. `plugins.updater.requireSignedVersion` está activo: el primer `.sig` debe traer
  `version:0.1.0` en el comentario de confianza o se rompen las actualizaciones. La CSP de `tauri.conf.json` lleva los hosts
  de producción a mano (`sereno-api` y `sereno-ws`): si cambian, tocarla.

App móvil (Expo, en el **host Windows** con su Node, no en Docker; desde `app/`):
- Dependencias: `npm install`; librerías nuevas con `npx expo install <paquete>` (no fijar versiones a mano).
- Desarrollo: `npm start` (`npx expo start --port 8087`); `npm run android` abre la app en Expo Go en el emulador o el
  teléfono conectado por `adb`.
- Tests: `npm test` (jest-expo y Testing Library; un archivo: `npm test -- <ruta>`). Tipos: `npm run typecheck` (necesita `app/.expo/types/router.d.ts`, ignorado por git: lo genera `npm start`; en un clon limpio
  o CI arrancar Expo una vez antes, o el typecheck falla con las rutas tipadas). Lint: `npm run lint`.
- Desde el emulador de Android el host es `10.0.2.2` (API `http://10.0.2.2:8003`, Reverb `10.0.2.2:8086`); desde un
  teléfono físico, la IP de la PC en la LAN.
- Variables de Reverb de la app (en `app/.env.local`, que crea el usuario; no hay `.env.example`): `EXPO_PUBLIC_REVERB_APP_KEY` (sin ella
  Echo queda en null en silencio y no hay tiempo real), `EXPO_PUBLIC_REVERB_HOST` (por defecto `10.0.2.2`), `EXPO_PUBLIC_REVERB_PORT`
  (`8086`) y `EXPO_PUBLIC_REVERB_SCHEME` (`http`; solo acepta `https`).
- Builds en EAS (`npx eas-cli`, sesión de `ascariodev`): `build --profile preview --platform android` (APK interno, canal
  `preview`) y `--profile production` (APK interno, canal `production`, `versionCode` remoto con autoincremento);
  `development` es el dev client. `.easignore` en la raíz sube solo `app/` (incluido `google-services.json`, sin versionar).
- Variables de builds y updates: entornos `preview` y `production` de EAS, no `eas.json` (`eas update` no lo lee). Una vez por
  variable: `npx eas-cli env:set --environment preview --environment production --visibility plaintext --name <N> --value <V>`
  con `EXPO_PUBLIC_API_URL=https://sereno-api.ascario.dev`, `EXPO_PUBLIC_REVERB_HOST=sereno-ws.ascario.dev`,
  `EXPO_PUBLIC_REVERB_PORT=443`, `EXPO_PUBLIC_REVERB_SCHEME=https` y `EXPO_PUBLIC_REVERB_APP_KEY` (la de producción, la pone
  el usuario). Sin ellas el build o el update apuntan a `10.0.2.2`. Revisar: `npx eas-cli env:list --environment production`.
- Publicar un update (solo JS y assets): `npx eas-cli update --channel production --environment production -m "<mensaje>"`
  (o `preview`). La app lo baja al abrir y lo aplica en el arranque siguiente. `runtimeVersion` sigue a `version` de
  `app.json`: tras un cambio nativo (librería o plugin nuevo, cambios en `app.json`) subir `version` y hacer un build nuevo.

## Convenciones

- Código, BD y dominio en inglés. La comunicación con el usuario, en español.
- Multi idioma (`en` por defecto, `es`): la API nunca devuelve textos fijos, todo pasa por `__()`. Textos
  propios en `lang/en.json` y `lang/es.json`; los archivos de laravel-lang no se editan a mano. Idioma:
  `users.locale`, luego `Accept-Language`, luego `en`. El contenido que escriben las personas no se traduce.
- Fechas en UTC en la BD.
- Multi-tenant en una sola BD: toda tabla de negocio lleva `organization_id`, y la organización activa viaja
  en el header `X-Organization-Id`. Mecanismo en `api/CLAUDE.md` (mismo patrón que `../medic/medic-api`).
- Roles por organización: `owner`, `admin`, `member`. Policies en cada recurso.
- Auth por token Bearer (sirve igual para web, escritorio y móvil).
- Commits cortos (1–2 líneas), `tipo: descripción` (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`),
  sin líneas de atribución. Nunca `git push` sin pedirlo.

## Orden del MVP

1. Núcleo: auth, idioma, organizaciones, roles, invitaciones y proyectos. **Hecho.**
2. Log: fuentes con API key por proyecto, ingesta por cola, agrupado de eventos, retención. **Hecho.**
3. Canales de proyecto con avisos de log (Reverb). **Hecho.**
4. Web mínima: login, proyectos, canal. **Hecho.**
5. Conectar posveapi y dejar Slack. **Hecho**, salvo retirar Slack (aplazado: queda de respaldo).
6. Chat completo: hilos, menciones, adjuntos. **Hecho.** Las URLs firmadas de adjuntos duran 5 min (plan
   `adjuntos-url`): la web pide una nueva a `GET /api/attachments/{id}/url`, que valida el acceso, cuando la guardada vence.
7. Plan: tareas, tablero, crear tarea desde un aviso. **Hecho.**
8. Escritorio: PWA instalable y app Tauri para Windows (plan `escritorio-tauri`): bandeja, instancia única, avisos nativos,
   iniciar con Windows y actualizador firmado. **Hecho** y verificado con la app instalada (publicadas 0.1.0 y 0.1.1).
   Linux y Mac, sin hacer.
9. Push web hecho (plan `notificaciones-push`): Web Push con VAPID, preferencias por tipo, no se muestra con Sereno
   enfocado. Falta el push móvil (va con la app móvil) y la facturación SaaS.

Transversal: Docker de desarrollo y stacks de producción del API y la web (plan `web-docker`) y deploy por Gitea
(`.gitea/workflows/deploy-api.yml` y `deploy-web.yml`) hechos. Integración simple de sistemas Laravel (plan
`integracion-simple`) hecha: paquete `ascariodev/sereno-laravel` en Packagist (repo hermano `../sereno-laravel`),
`composer require` + `php artisan sereno:install <key>`, variables `SERENO_KEY`/`SERENO_URL`.
Notificaciones (plan `notificaciones`) hechas: bandeja in-app en vivo (`/notifications`, reemplaza a la de menciones) y
email inmediato con preferencias por tipo (tarea asignada, mención o comentario en tarea, mención en el chat). Tabla
`notifications` propia con canal `app`; en producción el correo necesita las `MAIL_*` en el `.env` del servidor.
Push web (plan `notificaciones-push`): variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (par de `php artisan push:vapid-keys`) y
`VAPID_SUBJECT` (`mailto:` o `https://`), un par distinto por entorno. En producción las carga el usuario en el `.env` del
servidor; el par se genera allí con `docker compose -p sereno-prod-api -f docker-compose.prod.yml exec -u app app php artisan push:vapid-keys`.
Probarlo en local: el service worker solo existe en el build de producción (`npm run build` y `vite preview` en 5174,
parando antes el servicio `web`); en Brave activar "Use Google services for push messaging" y recordar que Windows
puede silenciar las notificaciones del navegador.
Tras cambiar el `.env` del servidor (desde `api/` en producción, con `sudo docker compose -p sereno-prod-api -f docker-compose.prod.yml`):
`exec -u app app php artisan optimize` (la config está cacheada), `restart app queue scheduler reverb` y luego
`restart nginx`, que resuelve la IP de `app` al arrancar y sin reiniciarlo da 502. Un redeploy hace todo eso.
Servidor MCP (plan `integracion-mcp`) hecho: `POST /mcp` (laravel/mcp, `api/routes/ai.php`) con tools para leer
proyectos, tareas, mensajes y avisos de log, y para comentar, crear y mover tareas (nada de borrar). Claude actúa como el
dueño del token. Los tokens de acceso los crea cada persona en la web (menú de usuario, "Tokens de acceso"), van ligados a
una organización con ability `mcp` y solo valen en `/mcp` (403 en el resto). Conectar Claude Code con el comando que da la
web, más `--scope user` para que valga en todos los proyectos: `claude mcp add --transport http --scope user sereno https://sereno-api.ascario.dev/mcp --header "Authorization: Bearer <token>"`.
Un token por máquina; `claude mcp add` no reemplaza un nombre existente (antes `claude mcp remove sereno -s user`). En esta
PC el CLI no está en el PATH de PowerShell: lo corre una sesión de Code con el binario de la app.

(No confundir con las fases de un plan de `docs/plans/`.)

## Salida de comandos
- Correr solo los tests afectados (un archivo o `--filter`), salvo en /cerrar-fase.
- Salida resumida (`--compact`, `-q`) y mostrar solo los fallos.
- Filtrar logs largos con `tail` o `grep` (p. ej. `docker compose logs --tail=50 api`).
- Suite completa o fallos grandes: en un subagente que devuelva solo el resumen.
- **Nunca dos suites de tests a la vez**: comparten la base `workspace_test` y se pisan entre sí.

## Base de datos
- **Conexión:** `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`
  (PostgreSQL 18). Credenciales en `api/.env`: nunca escribirlas ni mostrarlas.
- **Solo desarrollo local. NUNCA conectarse a producción.**
- Nunca `SELECT *` sin `LIMIT`; explorar con `COUNT(*)` o `LIMIT 20`.
- `UPDATE` / `DELETE` / `INSERT`: mostrar antes la consulta y cuántas filas afecta, y esperar confirmación.
- Modelo de datos, migraciones y convenciones: `.claude/rules/database.md`.

## Descubrimiento con graphify
Un solo grafo para `api/` y `web/`, fuera del repo: `../.graphify-workspace/workspace/graphify-out/graph.json`
(junto a la carpeta `workspace`). Desde la raíz, cada consulta lleva
`--graph ../.graphify-workspace/workspace/graphify-out/graph.json`. Los nodos llevan la ruta (`api/app/...`, `web/src/...`).

1. `graphify explain "<símbolo>"`: relaciones y quién lo usa.
2. `graphify affected "<símbolo>"`: qué se rompe si lo cambio (tests incluidos).
   **Obligatorio antes de cambiar la firma o el comportamiento de algo exportado, o de quitarlo.**
3. `graphify query "<término>"`: solo sin el nombre exacto (es difuso y trunca).
4. `grep`: cadenas literales y lo que el grafo no tiene.

Los hooks `post-commit`, `post-merge` y `post-checkout` están versionados en `.githooks/`; un clon nuevo los activa con
`git config core.hooksPath .githooks`. Actualizan el grafo solos, solo desde el checkout principal (en un worktree no
hacen nada, y tampoco si graphify falta); solo código, sin LLM; log en `graphify-out/.hook.log`. Cambios sin commit no están en el grafo. Para
reconstruir a mano (nunca `graphify update` ni `graphify hook install`, que escriben dentro del repo):
`GRAPHIFY_OUT="$PWD/../.graphify-workspace/workspace/graphify-out" graphify extract "$PWD" --code-only --out ../.graphify-workspace/workspace`
y luego `graphify cluster-only ../.graphify-workspace/workspace`. No instalar graphify si falta: avisar y seguir con `grep`.

## Tareas grandes: flujo por fases
El estado de una tarea larga vive en `docs/plans/<tarea>.md`, **no en la conversación**.

1. **Planificar** (`/planificar <tarea>`): plan con fases pequeñas y criterio de "terminado", escrito en su worktree.
   Esperar aprobación; al aprobarlo se mergea a `main` en local (sin push) para que las demás skills lo encuentren.
2. **Ejecutar**:
   - **Automático** (`/ejecutar-plan <tarea>`): delega cada fase a `implementador-fase`, la revisa
     con `revisor-fase`, cierra y hace commit, y sigue hasta terminar o necesitar una decisión.
   - **Manual:** `/siguiente-fase <tarea>` → `/cerrar-fase <tarea>` → `/clear`.
     El hook `SessionStart` reinyecta el estado del plan activo.
3. **Mejoras:** lo no implementado queda en `## Mejoras propuestas` del plan; `/aplicar-mejoras` las aplica.

`planificar`, `ejecutar-plan`, `siguiente-fase` y `aplicar-mejoras` se activan también en lenguaje
natural. `cerrar-fase` solo con `/cerrar-fase`.

Reglas:
- Una fase por sesión; `/clear` al cerrarla.
- Plan que no aparece en `docs/plans/` ni en `terminados/`: puede estar en una rama sin mergear. Buscarlo con
  `git worktree list` y `git log --all --oneline -- docs/plans/<tarea>.md` antes de decir que no existe, decir en qué
  rama está y ofrecer mergearlo a `main` (merge local, solo con el ok del usuario).
- No leer archivos que no hacen falta para la fase actual; explorar código desconocido con un subagente.
- Si una fase crece más de lo previsto, dividirla en el plan en vez de seguir de largo.
- Toda decisión que afecte fases futuras se escribe en "Decisiones" del plan.
- Antes de implementar, leer `docs/lecciones.md`.
- Commits por fase en la raíz (`git`), con el plan incluido: `docs/` se versiona.

## Compact Instructions
Al resumir, conservar: la ruta del plan activo (`docs/plans/<tarea>.md`) y la fase en curso,
los archivos modificados y aún sin commit (con su repo), las decisiones que tomó el usuario
(textuales) y lo que falta para cerrar la fase. No conservar salidas de comandos ni contenido
de archivos: se vuelven a leer.
