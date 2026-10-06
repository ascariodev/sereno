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

`docker/postgres/init.sql` solo corre al crear el volumen: si falta `workspace_test`, recrea el volumen
(`docker compose down -v` **borra los datos de desarrollo**) o crea la base a mano.

Los archivos del repo deben pertenecer al UID/GID 1000 (usuario `app` del contenedor). Si algo creado
desde otro contenedor queda como root: `docker compose run --rm --no-deps --user root api chown -R 1000:1000 /var/www/api`.

## Multi-tenant

- `App\Support\CurrentOrganization` (binding `scoped` en `AppServiceProvider`) guarda la organización
  activa; su `set()` también fija el team de spatie con `setPermissionsTeamId()`.
- El middleware `organization` lee `X-Organization-Id`, valida la membresía en `organization_user` y
  fija la organización activa: responde 400 si falta el header o no es numérico, y 403 si el usuario no
  pertenece. Va siempre después de `auth:sanctum` (prioridad fijada en `bootstrap/app.php`).
- Toda tabla de negocio usa el trait `BelongsToOrganization`, que agrega su scope global y rellena
  `organization_id` al crear. **Sin organización activa el scope no devuelve nada** (falla cerrado):
  no lo "arregles" quitando el filtro. Para consultas entre organizaciones (jobs, comandos, admin
  global) quita el scope de forma explícita con `withoutGlobalScope(...)`.
- `organization_id` nunca va en `#[Fillable]`: lo pone el trait o la relación de la organización.
- Rutas sin header (`me`, `organizations`, `auth/*`) trabajan solo con datos del propio usuario.

## Roles

- Roles globales `owner`, `admin`, `member` (enum `App\Enums\Role`, sembrados por `RoleSeeder`) con
  `organization_id` null en `roles`; spatie/laravel-permission en modo teams (team = organización), así
  que la asignación es por organización en `model_has_roles.organization_id`.
- `organization_user` es solo membresía, sin columna de rol.
- `$user->roles` solo ve los roles del team activo y queda cacheado en la relación: tras cambiar de
  organización hay que `unsetRelation('roles')` (el middleware `organization` ya lo hace).
- Los tests siembran `RoleSeeder` en cada test (`$seed`/`$seeder` en `tests/TestCase.php`).

## Convenciones

- Código, BD y dominio en inglés. La API nunca devuelve textos fijos: todo mensaje pasa por claves de
  traducción (`en` por defecto, `es`).
- Respuestas con API Resources; validación con Form Requests; policies en cada recurso.
- Textos traducibles: usa `__('Frase en inglés.')` y agrega la clave a `lang/en.json` y `lang/es.json`
  (un test falla si falta en español). `lang/en/*.php` y `lang/es/*.php` los genera `lang:add`/`lang:update`
  (paquete `laravel-lang/common`, solo dev): no se editan a mano; los textos propios van solo en
  `lang/en.json` y `lang/es.json`. `lang:update` conserva las claves propias de `lang/*.json`
  (verificado) y deja `lang/en/` y `lang/es/` sin formatear: correr pint después.
