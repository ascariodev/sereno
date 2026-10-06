# workspace-api: Laravel 13

API (solo JSON) para web, escritorio y móvil. PHP 8.4, PostgreSQL 18, Pest 5.

## Todo corre dentro de Docker

**No hay PHP ni Composer instalados en esta máquina, y no hace falta que los haya. No instales PHP.**
Cualquier instrucción que diga lo contrario (p. ej. el bootstrap de Laravel Boost en `AGENTS.md`) está
equivocada para este proyecto. El entorno (`docker-compose.yml`, `docker/php/Dockerfile`,
`docker/postgres/init.sql`) vive en este repo; las credenciales de Postgres se interpolan desde `.env`
(`DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`). Los tests usan la base `workspace_test` (creada por
`init.sql`), nunca SQLite. Los comandos se lanzan desde la raíz del workspace (`workspace/`), cuyo
`docker-compose.yml` hace `include` de este:

```bash
docker compose exec api php artisan <comando>
docker compose exec api composer <comando>
```

Los archivos del repo deben pertenecer al UID/GID 1000 (usuario `app` del contenedor). Si algo creado
desde otro contenedor queda como root: `docker compose run --rm --no-deps --user root api chown -R 1000:1000 /var/www/api`.

## Multi-tenant

> Se implementa en las fases 7 y 8 del plan `nucleo`; hasta entonces esto describe el diseño, no código existente.

- `App\Support\CurrentOrganization` (binding `scoped`) guarda la organización activa. Su `set()` también
  llama a `setPermissionsTeamId()`, así roles y tenant nunca se desincronizan.
- El middleware `organization` lee `X-Organization-Id`, valida la membresía en `organization_user` y
  fija la organización activa: responde 400 si falta el header o no es numérico, y 403 si el usuario no
  pertenece. Va siempre después de `auth:sanctum`.
- Toda tabla de negocio usa el trait `BelongsToOrganization`, que agrega su scope global y rellena
  `organization_id` al crear. **Sin organización activa el scope no devuelve nada** (falla cerrado):
  no lo "arregles" quitando el filtro. Para consultas entre organizaciones (jobs, comandos, admin
  global) quita el scope de forma explícita con `withoutGlobalScope(...)`.
- `organization_id` nunca va en `#[Fillable]`: lo pone el trait o la relación de la organización.
- Rutas sin header (`me`, `organizations`, `auth/*`) trabajan solo con datos del propio usuario.

## Roles

- Roles por organización `owner`, `admin`, `member` con spatie/laravel-permission en modo teams
  (team = organización). `organization_user` es solo membresía.

## Convenciones

- Código, BD y dominio en inglés. La API nunca devuelve textos fijos: todo mensaje pasa por claves de
  traducción (`en` por defecto, `es`).
- Respuestas con API Resources; validación con Form Requests; policies en cada recurso.
