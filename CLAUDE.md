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
       Escritorio: primero PWA, luego Tauri con la misma SPA.
app/   (futuro) Expo, móvil.
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
| Web (Vite dev, `strictPort`) | 5174 |

## Comandos

Todo desde la raíz. No hay PHP ni Composer en la máquina y no se instalan: el API corre en Docker.
Válidos desde la fase 2 del plan `nucleo`.

- Levantar: `docker compose up -d` (`--build` tras cambiar `api/docker/php/Dockerfile`)
- Base desde cero: `docker compose exec api php artisan migrate:fresh --seed`
- Dependencias PHP: `docker compose exec api composer install`
- Tests API: `docker compose exec api php artisan test --compact`
  (un archivo: `... test --compact tests/Feature/AuthTest.php`; un caso: `--filter=nombre`)
- Cola y scheduler: servicios `queue` (`queue:work --tries=3`) y `scheduler` (`schedule:work`), misma imagen
  y volumen que `api`. Logs: `docker compose logs --tail=50 queue` (o `scheduler`). El worker no recarga
  el código: tras cambiar un job o algo que use, `docker compose restart queue`.
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
6. Chat completo: hilos, menciones, adjuntos. **Hecho.**
7. Plan: tareas, tablero, crear tarea desde un aviso.
8. Escritorio: PWA instalable, luego Tauri.
9. Móvil, push y facturación SaaS.

Transversal: Docker de desarrollo y stacks de producción del API y la web (plan `web-docker`) hechos; falta el
deploy por Gitea.

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

Los hooks locales `post-commit`, `post-merge` y `post-checkout` (en `.git/hooks`, no versionados) actualizan el
grafo solos (solo código, sin LLM; log en `graphify-out/.hook.log`). Cambios sin commit no están en el grafo. Para
reconstruir a mano (nunca `graphify update` ni `graphify hook install`, que escriben dentro del repo):
`GRAPHIFY_OUT="$PWD/../.graphify-workspace/workspace/graphify-out" graphify extract "$PWD" --code-only --out ../.graphify-workspace/workspace`
y luego `graphify cluster-only ../.graphify-workspace/workspace`. No instalar graphify si falta: avisar y seguir con `grep`.

## Tareas grandes: flujo por fases
El estado de una tarea larga vive en `docs/plans/<tarea>.md`, **no en la conversación**.

1. **Planificar** (`/planificar <tarea>`): plan con fases pequeñas y criterio de "terminado". Esperar aprobación.
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
