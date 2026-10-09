---
paths:
  - "api/database/**"
  - "api/app/Models/**"
---

# Base de datos

- **Motor:** PostgreSQL 18 en Docker (servicio `postgres`, contenedor `workspace_postgres`, puerto host 5435).
  Bases: `workspace` (desarrollo) y `workspace_test` (tests, creada por `api/docker/postgres/init.sql`).
- **Migraciones:** crear con `docker compose exec api php artisan make:migration <name>`, aplicar con
  `docker compose exec api php artisan migrate`, desde cero con `... migrate:fresh --seed`.

Reglas:
- Cambios de esquema solo con migraciones, nunca con `ALTER` directo.
- Las migraciones no importan clases de la app (requests, enums, modelos): usan literales, porque fijan el
  estado histórico y deben seguir corriendo aunque esas clases cambien o desaparezcan.
- Los CHECK se nombran `<table>_<column>_check`.
- Cambios múltiples de datos dentro de `BEGIN; ... COMMIT;` para poder revertir.
- Ver estructura con `\d table`, no volcando datos.
- Tablas y columnas en inglés, tablas en plural y `snake_case` (`organizations`, `projects`, `organization_user`).
- Fechas en UTC (`timestamp`).
- Toda tabla de negocio: `organization_id` con FK `cascadeOnDelete` y el trait `BelongsToOrganization` en
  el modelo. Los únicos por tenant incluyen `organization_id` (p. ej. `unique(organization_id, key)`).
- JSON en columnas `jsonb`.
- Toda función PL/pgSQL nueva lleva `SET search_path` y se borra en `down()` (`migrate:fresh` borra tablas,
  no funciones).
- Tablas particionadas (`log_events`): se crean con SQL crudo (`PARTITION BY RANGE`), la PK incluye la columna
  de partición y los índices se crean en la tabla padre (se propagan a cada partición). Particiones diarias
  en UTC `<tabla>_YYYYMMDD`, sin DEFAULT: se crean con `LogPartitions::ensure()` (advisory lock + `IF NOT
  EXISTS`); la migración repite esa lógica con literales en vez de importar la clase. `down()` borra la
  tabla padre, que arrastra sus particiones.
  Mantenimiento: `php artisan log:maintain` (diario, 00:10 UTC) crea hoy..+7 y borra las particiones y grupos más
  viejos que `LOG_RETENTION_DAYS` (30). No borrar particiones a mano.

## Modelo de datos

Previsto en el plan `nucleo` (actualizar al crear cada tabla):
- `users` (+ `locale` nullable), `personal_access_tokens`, tablas de spatie con `organization_id` como team.
- `organizations`: name, slug único, `settings` jsonb (`default_locale`).
- `organization_user`: solo membresía; los roles (`owner`, `admin`, `member`) viven en
  `model_has_roles.organization_id`. Un usuario puede pertenecer a varias organizaciones.
- `invitations`: organization_id, email (minúsculas), role (CHECK `invitations_role_check`), token (SHA-256 único; el token en claro solo va en el correo), expires_at, accepted_at, invited_by, locale (el `default_locale` de la organización al enviar). Se busca por token con `withoutGlobalScope` solo en `Invitation::findByPlainToken`.
- `projects`: organization_id, name, key (CHECK `projects_key_check`: `^[A-Z][A-Z0-9]{1,9}$`, único por organización), description nullable, archived_at nullable (archivar en vez de borrar). `ProjectPolicy`: owner/admin crean, editan y archivan; cualquier miembro ve; siempre exige que el proyecto sea de la organización activa.

- `log_sources`: organization_id, project_id (ambas FK `cascadeOnDelete`), name, key_hash (SHA-256 único; la key `wsk_...` en claro solo se muestra al crearla o rotarla; `LogSource::rotateKey` reemplaza hash y prefijo en la misma fila y la key anterior deja de valer en el acto; el UPDATE va condicionado al `key_hash` leído y `revoked_at` nulo, y si no afecta filas el API responde 409; desde consola, `log:source-create` y `log:source-rotate`), key_prefix (primeros 12 caracteres, `wsk_` + 8, para mostrar; índices por (organization_id, project_id) y por project_id), last_used_at, revoked_at (revocar en vez de borrar). El modelo (`saving`) exige que el proyecto sea de la misma organización. Se busca por key con `withoutGlobalScope` solo en `LogSource::findByPlainKey`. `LogSourcePolicy`: owner/admin crean, rotan (`POST .../log-sources/{source}/rotate-key`) y revocan; cualquier miembro ve.

- `log_groups`: organization_id y project_id (FK `cascadeOnDelete`), fingerprint string(64), level (CHECK `log_groups_level_check`, 8 niveles PSR-3), title string(255), status (CHECK `log_groups_status_check`: `open|resolved|ignored`, default `open`), first_seen_at, last_seen_at, events_count bigint default 0. Único `(project_id, fingerprint)`; índices `(project_id, last_seen_at)` (listar sin filtro) y `(project_id, status, last_seen_at)` (filtrar por status); índice por organization_id. Enums `LogLevel` (`severity()`, `isAtLeast()`, `highest()`; orden explícito 0 debug a 7 emergency) y `LogGroupStatus`. La regla proyecto-de-la-misma-organización vive en el trait `EnsuresProjectInOrganization` (LogSource y LogGroup). El trait omite la regla si `project_id` es null: los modelos con `project_id` NOT NULL (LogSource, LogGroup) dependen de la BD para rechazar el null.
  `LogEventRecorder` hace el upsert del grupo con `RETURNING old.*`/`new.*` (`old.status AS previous_status`), que exige PostgreSQL 18.

- `log_events` (particionada por rango diario de `received_at`, hora del servidor): id (identity) y PK `(id, received_at)`, organization_id (FK `cascadeOnDelete`), project_id (sin FK: la integridad llega por el grupo), log_group_id (FK `cascadeOnDelete`), log_source_id nullable (FK `ON DELETE SET NULL`), level (CHECK `log_events_level_check`), message text, context jsonb nullable, occurred_at (del cliente), received_at. Índice `(log_group_id, received_at DESC)`. La migración crea las particiones de hoy y los 7 días siguientes. Modelo `LogEvent`: `received_at` hace de `CREATED_AT`, sin `updated_at`; `primaryKey` `id`; ids de grupo, proyecto y fuente fuera de Fillable.

- `channels`: organization_id y project_id nullable (FK `cascadeOnDelete`), name string(80), archived_at nullable (archivar en vez de borrar). Único `(organization_id, project_id)` (un canal por proyecto); índice por project_id. Traits `BelongsToOrganization` y `EnsuresProjectInOrganization` (esta omite la regla si project_id es null). `ChannelPolicy`: cualquier miembro ve; owner/admin crean, editan y archivan; exige canal de la organización activa.

- `messages`: organization_id y channel_id (FK `cascadeOnDelete`), user_id nullable (FK `nullOnDelete`), kind (CHECK `messages_kind_check`: `user|system`), body text nullable, CHECK `messages_body_payload_check` (`user` exige `body`; `system` exige `payload` objeto JSON (`jsonb_typeof = 'object'`, rechaza `null`, arrays y escalares) y `body` nulo; `user_id` no se restringe porque es `nullOnDelete` y los avisos de cambio de estado llevan el actor), payload jsonb nullable, log_group_id nullable (FK `nullOnDelete`), solo `created_at` (sin `updated_at`). Índice `(channel_id, id DESC)`. Hilos (un solo nivel): `parent_id` nullable, `replies_count` int default 0 y `last_reply_at` nullable; único `(channel_id, id)` y FK compuesta `messages_parent_fk` `(channel_id, parent_id)` a `messages(channel_id, id)` con `ON DELETE CASCADE` (una respuesta no cuelga de otro canal; borrar la raíz borra sus respuestas); índice `(parent_id, id DESC)` e índice parcial `(channel_id, id DESC) WHERE parent_id IS NULL` para la lista principal. Los mensajes de sistema no guardan texto: `payload.type` + datos y el cliente lo traduce. Modelo `Message` con `BelongsToOrganization`; kind, body y payload en Fillable, ids de canal, usuario, grupo y los de hilo (`parent_id`, contador, `last_reply_at`) fuera; relaciones `parent` y `replies`.

- `message_mentions`: organization_id, message_id y user_id (FK `cascadeOnDelete`), read_at nullable, solo `created_at`. Único `(message_id, user_id)`; índice `(user_id, organization_id, read_at)` para la bandeja de no leídas. Modelo `MessageMention` con `BelongsToOrganization`, sin Fillable (se asigna por propiedad); relaciones `message`, `user`; `Message::mentions()`.

**Futuro:** tareas del módulo plan.
