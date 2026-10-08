# api

API (solo JSON) de Sereno: espacio de trabajo multi-tenant con chat, plan y log alrededor del proyecto.
Laravel 13, PHP 8.4, PostgreSQL 18, Sanctum, spatie/laravel-permission (teams = organización) y Pest.

## Todo corre en Docker

No hay PHP ni Composer en la máquina y no hace falta instalarlos. Los comandos se lanzan desde la raíz del
monorepo (`workspace/`), cuyo `docker-compose.yml` incluye el de esta carpeta.

```bash
docker compose up -d                                   # levantar (API en :8003, Postgres en :5435)
docker compose exec api php artisan migrate:fresh --seed
docker compose exec api php artisan test --compact     # tests (base workspace_test)
```

Las credenciales de Postgres se leen de `.env` (copiar de `.env.example`).

## Más detalle

- `../CLAUDE.md`: mapa del monorepo, puertos, comandos y flujo de trabajo.
- `CLAUDE.md`: multi-tenant, roles y convenciones del API.
