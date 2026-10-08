# Plan: monorepo-sereno

**Objetivo:** un solo repo `sereno` (Gitea) con `api/`, `web/` y `app/`, el historial de `workspace-api` y
`workspace-web` conservado bajo su carpeta, y la raíz (compose, docs, CLAUDE.md, .claude) versionada.
**Estado:** terminado


## Contexto mínimo
- Hoy: la raíz `workspace/` no es repo; `workspace-api` (104 commits) y `workspace-web` (137) son repos con remoto en
  `gitea.ascario.dev/ascario/workspace-{api,web}.git`, ambos en `main` y al día con `origin/main`.
- Destino: la propia carpeta `workspace/` pasa a ser el repo `sereno` (la carpeta local conserva su nombre, ver
  Decisiones). Remoto `https://gitea.ascario.dev/ascario/sereno.git`.
- Herramienta: `git filter-repo --to-subdirectory-filter` no está instalado; se corre con `uvx git-filter-repo`
  (uv ya está en el PATH, sin instalar nada global). Requiere aprobación del usuario.
- Docker: el proyecto compose se llama `workspace` y los volúmenes (`workspace_pgdata`, `web-node-modules`) son
  nombrados, así que renombrar carpetas no pierde datos. Las rutas en los compose son relativas a cada archivo.
  Antes de mover carpetas: `docker compose down`; después: `up -d`.
- `core.autocrlf=true` en los dos repos: el repo nuevo debe usar lo mismo o `git status` saldrá sucio.
- Grafo: hoy solo existe `.graphify-workspace/workspace-api/` dentro de la raíz. Los hooks calculan la ruta como
  `dirname(repo)/.graphify-workspace/basename(repo)`, así que con el monorepo pasa a
  `Development/.graphify-workspace/workspace/`.
- Referencias a `workspace-api`/`workspace-web` por cambiar: CLAUDE.md raíz, `api/CLAUDE.md`, READMEs,
  `.claude/agents` (2), `.claude/rules` (2), `.claude/skills` (5), `.claude/launch.json`, `docs/plans/_plantilla.md`
  y `docs/plans/web-docker.md` (pausado en la fase 6, deploy por Gitea).
- Congelar los repos viejos de la fase 1 a la 2: ninguna otra sesión hace commits ahí. Si alguna los hace, se rehace
  la fase 1 desde el `HEAD` nuevo antes de seguir.
- Nunca `git push` sin pedirlo. Crear `sereno` y archivar repos en Gitea lo hace el usuario.

## Fases

### [x] Fase 1 — Reescribir los historiales en subcarpetas [riesgo]
- **Alcance:** `git bundle` de respaldo de ambos repos fuera del proyecto. Clonar cada uno en el scratchpad y
  correr `uvx git-filter-repo --to-subdirectory-filter api` (y `web`). Unir los dos en un tercer clon con
  `git merge --allow-unrelated-histories`, rama `main`, `core.autocrlf=true`. No toca el proyecto.
- **Archivos:** ninguno del proyecto (todo en el scratchpad).
- **Terminado cuando:** el clon unido tiene 104 + 137 commits más el merge, `git log --follow api/composer.json` y
  `git log --follow web/package.json` muestran la historia vieja, y el árbol coincide con los `HEAD` actuales
  (`git diff --stat` contra cada repo vacío).

### [x] Fase 2 — Montar el monorepo en la raíz [riesgo]
- **Alcance:** `docker compose down`; mover los `.git` viejos a un respaldo; renombrar `workspace-api` a `api` y
  `workspace-web` a `web` (conservan `.env`, `vendor`, `storage`, `node_modules`); poner el `.git` del clon unido
  en la raíz; ajustar el `include` del compose raíz, el `.gitignore` raíz y las rutas de `.claude/launch.json`;
  crear `app/README.md`; borrar la carpeta suelta `workspace/workspace-api/docker/nginx/default.conf;C` (vacía,
  restos de una ruta mal convertida). Commit de la raíz.
- **Archivos:** `docker-compose.yml`, `.gitignore`, `.claude/launch.json`, `app/README.md`.
- **Terminado cuando:** `git status` limpio; `docker compose up -d` levanta todo; typecheck y tests de la web pasan;
  la suite del API pasa (en un subagente); `docker compose ps` muestra los mismos contenedores `workspace_*`.

### [x] Fase 3 — Grafo de graphify del monorepo
- **Alcance:** copiar los hooks `post-commit`, `post-merge` y `post-checkout` a `.git/hooks`; mover el grafo a
  `../.graphify-workspace/workspace/` y reconstruirlo sobre la raíz (código de `api/` y `web/`); borrar el grafo
  viejo de dentro de la raíz.
- **Archivos:** ninguno versionado (hooks y grafo viven fuera del árbol).
- **Terminado cuando:** un commit de prueba actualiza el grafo (`.hook.log` sin errores) y `graphify explain` de un
  símbolo del API y uno de la web responden con `--graph ../.graphify-workspace/workspace/graphify-out/graph.json`.

### [x] Fase 4 — CLAUDE.md y READMEs con las rutas nuevas
- **Alcance:** mapa, comandos (`git` en la raíz en vez de `git -C workspace-*`), sección de graphify y regla de que
  los planes ahora se versionan. Los comandos `docker compose exec api|web` no cambian.
- **Archivos:** `CLAUDE.md`, `api/CLAUDE.md`, `api/README.md`, `web/README.md`.
- **Terminado cuando:** `grep -rn "workspace-api\|workspace-web\|git -C"` sobre esos archivos solo deja menciones
  históricas intencionales.

### [x] Fase 5 — Agentes y reglas de .claude con las rutas nuevas
- **Archivos:** `.claude/agents/implementador-fase.md`, `.claude/agents/revisor-fase.md`,
  `.claude/rules/database.md`, `.claude/rules/tests-api.md`.
- **Terminado cuando:** el mismo `grep` sobre `.claude/agents` y `.claude/rules` no devuelve nada.

### [x] Fase 6 — Skills y plantilla de planes con las rutas nuevas
- **Archivos:** los 5 `SKILL.md` de `.claude/skills/` y `docs/plans/_plantilla.md` (cambios mecánicos de texto).
- **Terminado cuando:** el mismo `grep` sobre `.claude/skills` y la plantilla no devuelve nada.

### [x] Fase 7 — Adaptar el plan web-docker al monorepo
- **Alcance:** reescribir las fases 6 y 7 de `docs/plans/web-docker.md` como workflows en `.gitea/workflows/` de la
  raíz con filtro por ruta (`api/**`, `web/**`), cada uno con su propio deploy.
- **Archivos:** `docs/plans/web-docker.md`.
- **Terminado cuando:** el plan ya no menciona los repos separados y cada fase indica su filtro `paths`.

### [x] Fase 8 — Publicar en Gitea [riesgo]
- **Requiere:** que el usuario cree el repo vacío `sereno` en Gitea y pida el push.
- **Alcance:** `git remote add origin`, push de `main`, verificar historial y archivos en Gitea. Después, el usuario
  archiva `workspace-api` y `workspace-web` y borra o archiva `workspace-app`.
- **Archivos:** ninguno.
- **Terminado cuando:** `git status -sb` muestra `main...origin/main` sin diferencias y Gitea muestra el historial
  completo bajo `api/` y `web/`.

## Decisiones
- 2026-10-08 — Repo `sereno` con carpetas `api/`, `web/` y `app/` (lo decidió el usuario).
- 2026-10-08 — La carpeta local sigue llamándose `workspace` (memoria y sesiones de Claude Code dependen de la ruta).
- 2026-10-08 — Contenedores, proyecto compose, volúmenes y claves internas conservan `workspace`.
- 2026-10-08 — `docs/` pasa a versionarse con el repo, planes incluidos.

## Notas para la próxima sesión
- El usuario aprobó `uvx git-filter-repo` (2026-10-08). Las mejoras pendientes de otros planes se aplican después de la fase 6.
- Fases 1 y 2: commits `9fddbec` (merge de historiales, 242 commits) y `f7e4712` (raíz). Respaldo en
  `Development/_respaldo-monorepo-2026-10-08/` (bundles y los `.git` viejos); borrarlo tras la fase 8.
- Identidad git: no hay global; el repo tiene `user.name`/`user.email` locales copiados de los repos viejos.
- `web/.gitattributes` fija `eol=lf`: 43 archivos tenían CRLF en disco con el mismo contenido y se reescribieron con
  `git checkout`. Si `git status` vuelve a marcar archivos sin diff, es lo mismo.
- Fase 8: push de `main` a `origin` (2026-10-08), `main...origin/main` al día. Queda del lado del usuario: archivar
  `workspace-api` y `workspace-web` en Gitea, borrar o archivar `workspace-app`, y decidir si se borra el respaldo.

## Mejoras propuestas
- [ ] M-1: renombrar `name` de `web/package.json` a `sereno-web` (toca también `package-lock.json`).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-2: versionar los hooks de graphify en `.githooks/` con `core.hooksPath` para que un clon nuevo los tenga.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
