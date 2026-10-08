# web

SPA Vue 3 + TypeScript + Vite de Sereno (login, proyectos, canal). Consume el API de `../api`.

Corre en Docker (servicio `web`). Desde la raíz del monorepo, `docker compose up -d` ya sirve Vite en http://localhost:5174. También `docker compose exec web npm install`, `npm run typecheck`, `npm run test -- --run`, `npm run build`.
Configuración en `src/config.ts` (`VITE_API_URL`, `VITE_REVERB_*`).
