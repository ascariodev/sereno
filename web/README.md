# workspace-web

SPA Vue 3 + TypeScript + Vite del Workspace (login, proyectos, canal). Consume `workspace-api`.

Corre en Docker (servicio `web`). Desde la raíz del workspace, `docker compose up -d` ya sirve Vite en http://localhost:5174. También `docker compose exec web npm install`, `npm run typecheck`, `npm run test -- --run`, `npm run build`.
Configuración en `src/config.ts` (`VITE_API_URL`, `VITE_REVERB_*`).
