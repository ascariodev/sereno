# Plan: canales

**Objetivo:** cada proyecto tiene un canal donde llegan en tiempo real (Reverb) los avisos de log al abrirse o
reabrirse un grupo, y donde las personas leen y escriben mensajes simples. Los avisos llevan el grupo para
resolverlo o ignorarlo con la API existente. (Paso 3 del MVP; hilos, menciones y adjuntos son el paso 6.)
**Estado:** terminado · Fase actual: 11 (todas hechas)
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Repo afectado: `workspace-api` (commits con `git -C workspace-api`).
- `app/` plano por tipo. Tenant: `BelongsToOrganization` + `OrganizationScope`; rutas de organización con
  `['auth:sanctum', 'organization']` y header `X-Organization-Id`. Policies como `ProjectPolicy`.
- Log (plan `docs/plans/terminados/log.md`): `LogGroup` (status open/resolved/ignored), `LogEventRecorder` hace el
  upsert del grupo con `INSERT ... ON CONFLICT` y la regresión en `conflictAssignments()`; `PATCH
  /api/projects/{project}/log-groups/{group}` cambia el estado (cualquier miembro).
- Cola `database` con worker en Docker (`queue`); tras cambiar jobs o listeners, `docker compose restart queue`.
- Jobs con datos sensibles en el payload: `ShouldBeEncrypted` (L-06). Jobs de lote no idempotentes: `$tries = 1` (L-07).
- Reverb en el puerto 8086 (medic usa 8085).

## Fases

### [x] Fase 1 — Reverb en Docker [riesgo]
- **Alcance:** `composer require laravel/reverb` (y lo que pida `install:broadcasting --reverb`, p. ej.
  `pusher/pusher-php-server`), sin instalar nada de frontend. Servicio `reverb` en `docker-compose.yml`
  (`php artisan reverb:start --host=0.0.0.0 --port=8080`, puerto host 8086, misma imagen). Variables `REVERB_*` y
  `BROADCAST_CONNECTION=reverb` en `.env.example`; en `phpunit.xml`, `BROADCAST_CONNECTION=null`.
  Puerto en la tabla de `CLAUDE.md`.
- **Archivos:** `composer.json`/`.lock`, `config/broadcasting.php` y `config/reverb.php` (generados),
  `bootstrap/app.php`, `docker-compose.yml`, `.env.example`, `phpunit.xml`, `CLAUDE.md`.
- **Terminado cuando:** `docker compose up -d` deja `reverb` running y `curl http://localhost:8086` responde; la suite pasa.

### [x] Fase 2 — Modelo de canales
- **Alcance:** `channels` (organization_id, project_id nullable FK cascade, name, archived_at; único
  `(organization_id, project_id)`), modelo con `BelongsToOrganization` y `EnsuresProjectInOrganization`, factory y
  `ChannelPolicy` (cualquier miembro ve; owner/admin gestionan). Todos los miembros de la organización ven todos sus canales.
- **Archivos:** migración, `app/Models/Channel.php`, factory, `app/Policies/ChannelPolicy.php`, `database.md`.
- **Terminado cuando:** tests de modelo, policy y aislamiento.

### [x] Fase 3 — Un canal por proyecto
- **Alcance:** al crear un proyecto se crea su canal en la misma transacción (nombre = key del proyecto). Migración
  de datos para los proyectos que ya existen (con literales, idempotente).
- **Archivos:** `ProjectController` (o el punto donde se crea el proyecto), migración de datos, `Project` (relación `channel()`).
- **Terminado cuando:** test de creación de proyecto con canal y test de la migración de datos.

### [x] Fase 4 — Modelo de mensajes
- **Alcance:** `messages` (organization_id, channel_id FK cascade, user_id nullable nullOnDelete, kind `user|system`
  con CHECK, body text nullable, payload jsonb nullable, log_group_id nullable nullOnDelete, created_at; índice
  `(channel_id, id desc)`). Los mensajes de sistema no guardan texto: `payload.type` (`log.group_opened`, ...) y
  datos; el cliente arma el texto en su idioma.
- **Archivos:** migración, `app/Models/Message.php`, factory, `database.md`.
- **Terminado cuando:** tests de modelo (CHECK, persona con body, sistema con payload) y aislamiento.

### [x] Fase 5 — API de lectura de canales
- **Alcance:** `GET /api/channels` (no archivados, con proyecto) y `GET /api/channels/{channel}/messages` con
  paginación por cursor (más nuevos primero, `cursor` y `per_page`).
- **Archivos:** `ChannelController`, `MessageController`, `ChannelResource`, `MessageResource`, `routes/api.php`.
- **Terminado cuando:** tests de API, cursor y aislamiento (otra organización 404/403).

### [x] Fase 6 — Publicar mensajes de personas
- **Alcance:** `POST /api/channels/{channel}/messages` con `body` (1 a 4000 caracteres, sin `\u0000`), en canal no
  archivado; throttle por usuario.
- **Archivos:** `MessageController`, FormRequest, `routes/api.php`, `AppServiceProvider` (limiter), `lang/*.json`.
- **Terminado cuando:** tests de validación, permisos, canal archivado y 429.

### [x] Fase 7 — Autorización de canales privados [riesgo]
- **Alcance:** `/broadcasting/auth` con `auth:sanctum` (Bearer, sin sesión) y canal privado
  `organizations.{organization}.channels.{channel}`: el usuario es miembro de la organización y el canal es de ella.
  No depende de `X-Organization-Id`.
- **Archivos:** `bootstrap/app.php` (`withBroadcasting`), `routes/channels.php`, quizá `app/Broadcasting/ChannelChannel.php`.
- **Terminado cuando:** tests de `/broadcasting/auth`: miembro 200, no miembro 403, canal de otra organización 403, sin token 401.

### [x] Fase 8 — Emitir mensajes nuevos por Reverb [riesgo]
- **Alcance:** evento `MessageCreated` (`ShouldBroadcast`, después del commit) en el canal privado, con el
  `MessageResource`. Se dispara al crear cualquier mensaje.
- **Archivos:** `app/Events/MessageCreated.php`, `Message` (o el punto de creación).
- **Terminado cuando:** test con `Event::fake`/`Broadcast` y prueba manual: un script de Node con `pusher-js`
  (en el scratchpad, sin agregarlo al repo) recibe el mensaje publicado por la API.

### [x] Fase 9 — Evento de dominio al abrir o reabrir un grupo [riesgo]
- **Alcance:** `LogEventRecorder` sabe si el grupo se creó o se reabrió (Postgres 18 permite `RETURNING old.status`;
  si no, `xmax = 0` para el alta y otra vía para la regresión) y despacha `LogGroupOpened` / `LogGroupReopened`
  después del commit.
- **Archivos:** `LogEventRecorder`, `app/Events/LogGroupOpened.php`, `app/Events/LogGroupReopened.php`.
- **Terminado cuando:** tests: alta dispara Opened, segundo evento no dispara nada, resolved + evento dispara Reopened, ignored + evento no.

### [x] Fase 10 — Aviso de log en el canal del proyecto
- **Alcance:** listener en cola de los dos eventos: crea un mensaje de sistema en el canal del proyecto con
  `payload` (`type`, `log_group_id`, level, title, events_count) y `log_group_id`, lo que lo emite por Reverb (fase 8).
- **Archivos:** `app/Listeners/PostLogGroupNotice.php`, registro del listener si hace falta.
- **Terminado cuando:** test: ingerir un evento nuevo crea el aviso en el canal correcto, uno repetido no, y la regresión sí.

### [x] Fase 11 — Aviso al cambiar el estado de un grupo
- **Alcance:** al resolver, ignorar o reabrir por la API, mensaje de sistema `log.group_status_changed` con quién
  y el nuevo estado, para que el canal refleje la acción.
- **Archivos:** `LogGroupController` (o un evento + listener), `MessageResource` si hace falta.
- **Terminado cuando:** tests del PATCH que crean el mensaje correcto y no lo crean si el estado no cambia.

## Decisiones
- 2026-10-07 — Reverb en el puerto 8086; driver `null` en tests.
- 2026-10-07 — Canales de organización sin miembros propios: todo miembro ve todos los canales. Canales privados
  y no leídos, cuando llegue el chat completo (paso 6).
- 2026-10-07 — Mensajes de sistema sin texto: `payload.type` + datos, y el cliente traduce. La API no guarda textos
  fijos en un idioma.
- 2026-10-07 — Avisos de log solo al abrir o reabrir un grupo, no por cada evento (evita ruido).
- 2026-10-07 — Las acciones del aviso usan el `PATCH` de log-groups que ya existe; no hay endpoints nuevos de acción.
- 2026-10-07 — (Fase 1) Igual que medic: `api`, `queue` y `scheduler` llevan en `docker-compose.yml` `REVERB_HOST=reverb`,
  `REVERB_PORT=8080`, `REVERB_SCHEME=http` (pisan `.env`): el backend publica por la red interna y los clientes entran
  por `localhost:8086`. Se deshicieron los cambios de frontend del instalador (`resources/js/*`).
- 2026-10-07 — (Fase 2) `EnsuresProjectInOrganization` omite la validación si `project_id` es null (canales sin
  proyecto); en `LogGroup`/`LogSource` el NOT NULL de la BD rechaza el null. `Channel`: `name` string(80), único fillable.
- 2026-10-07 — (Fase 3) El canal se crea en `ProjectController::store` (transacción), sin observer: hoy no hay otro
  punto que cree proyectos. La migración de datos no tiene `down()` (no distingue canales creados a mano).
- 2026-10-07 — (Fase 4) `Message`: solo `created_at`; constantes `KIND_USER`/`KIND_SYSTEM`; fillable `kind`, `body`,
  `payload` (los ids se asignan por relación); factory con estado `system(array $payload)`. La fase 6 fija `kind`
  en el servidor, nunca desde la entrada.
- 2026-10-07 — (Fase 5) `GET /api/channels` sin paginar, orden `name`,`id`, con `project` (desde M-8, resumen
  `{id, name, key}`).
  `MessageResource`: `id, channel_id, kind, body, payload, log_group_id, user{id,name}|null, created_at`; `user` es
  `whenLoaded` (la fase 8 carga `user` antes de serializar). Mensajes: cursor por `id` desc, `per_page` 1..100 (50); desde M-10, un cursor que no decodifica a un `id`
  entero positivo da 422 en `cursor`.
  Se pueden leer mensajes de un canal archivado.
- 2026-10-07 — (Fase 6) Publicar exige `ChannelPolicy::view` (sin habilidad nueva). Canal archivado: 422 con error en
  `channel`. Limiter `channel-messages`: 30/min por usuario (`AppServiceProvider::CHANNEL_MESSAGES_PER_MINUTE`).
  Respuesta 201 con `MessageResource` y `user` cargado; el mensaje se crea con `save()` en `MessageController::store`.
- 2026-10-07 — (Fase 7) `POST /broadcasting/auth` con `auth:sanctum` (`withBroadcasting`). Canal privado
  `organizations.{organization}.channels.{channel}` (cliente: `private-organizations.{id}.channels.{id}`), clase
  `App\Broadcasting\ChannelChannel`: membresía por `$user->organizations()` y canal buscado sin `OrganizationScope`
  filtrando por `organization_id`. `redirectGuestsTo` devuelve null (desde M-11, para todas las rutas) y el 401 de
  `api/*` y `broadcasting/*` sale en JSON.
  Los tests de auth usan el driver `reverb` con claves falsas (con `null` todo se autoriza).
- 2026-10-07 — (Fase 8) `MessageCreated` (`ShouldBroadcast` + `ShouldDispatchAfterCommit`), `broadcastAs`
  `message.created`, payload `{message: MessageResource}`; se dispara en `Message::$dispatchesEvents['created']`.
  El evento guarda ids y el recurso ya resuelto, no el modelo: el worker no tiene organización activa y
  `OrganizationScope` falla cerrado. Probado a mano con pusher-js contra `ws://localhost:8086` (script en el scratchpad).
- 2026-10-07 — (Fase 9) El upsert de `LogEventRecorder` usa `RETURNING new.*, old.status AS previous_status`
  (PG18): null = alta (Opened), `resolved`→`open` = Reopened; nada en otro caso. `LogGroupOpened`/`LogGroupReopened`
  son `ShouldDispatchAfterCommit`, no broadcast, y llevan solo escalares: `organizationId, projectId, logGroupId,
  level, title, eventsCount`. La fase 10 los usa sin consultar la BD.
- 2026-10-07 — (Fase 10) `PostLogGroupNotice` (`ShouldQueue`, `$tries = 1`: el insert no es idempotente) busca canal
  y grupo con `withoutGlobalScopes()` filtrando por `organization_id` y `project_id`; omite canal inexistente o
  archivado y grupo borrado. Crea el mensaje con `forceFill` (organization_id, channel_id, log_group_id) y payload
  `{type: log.group_opened|log.group_reopened, log_group_id, level, title, events_count}`.
- 2026-10-07 — (Fase 11) `LogGroupController::update` crea, en la misma transacción que el `save()` y solo si el
  estado cambia, un mensaje de sistema con `user_id` = actor y payload `{type: log.group_status_changed,
  log_group_id, status, previous_status}`. Sin canal o con canal archivado, guarda el estado sin aviso.
- 2026-10-07 — (M-6) `archived_at` del canal refleja siempre el de su proyecto: `ProjectController` archive/unarchive
  lo sincroniza en la misma transacción, y una migración de datos corrigió los canales existentes.

## Notas para la próxima sesión
- Fases 1 a 11 hechas. Con `$tries = 1` un fallo transitorio pierde el aviso (queda en `failed_jobs`). La BD de desarrollo ya tiene las migraciones de canales (se corrió `migrate` en la fase 8). Write puede dejar CRLF: correr pint sin `--test` si falla el formato.
- `ChannelPolicy` sigue a `ProjectPolicy` (exige organización activa); la fase 7 no usa
  `X-Organization-Id` y comprueba la membresía por su cuenta.
- Pendiente de la fase 1: `.env.example` sin `REVERB_*` ni `BROADCAST_CONNECTION=reverb` (una regla de
  permisos bloquea `.env*` a los agentes); lo agrega el usuario a mano.
- `.env` local tiene `REVERB_PORT=8080` (puerto del contenedor); para un cliente externo es 8086 (fase 8, script Node).

## Mejoras propuestas
- [x] M-1 — `docker-compose.yml`: mover el ancla `&reverb-internal` (hoy dentro de `api`) a un bloque `x-reverb-env`
  al inicio. Baja (1 archivo, evidente) · sonnet.
- [x] M-2 — Test que fije qué excepción da crear `LogGroup`/`LogSource` con `project_id` null (hoy `QueryException`).
  Baja (1 archivo de test) · sonnet.
- [x] M-3 — `ChannelTest`: caso de creación (no solo update) con proyecto de otra organización. Baja · sonnet.
- [x] M-4 — Nota en `database.md` o en el trait: los modelos con `project_id` NOT NULL dependen de la BD para el null.
  Baja · sonnet.
- [x] M-5 — `ProjectApiTest`: el test del rollback atrapa la excepción y afirma `Project::count() === 0` (hoy solo
  `throws`). Baja · sonnet.
- [x] M-6 — Los proyectos tienen `archived_at`, pero el backfill y el alta dejan su canal con `archived_at` null:
  archivar/desarchivar el canal junto con el proyecto (y en el backfill), o filtrar por proyecto archivado en
  `GET /api/channels`. Media (controlador + migración + tests) · sonnet.
- [x] M-7 — CHECK `messages_body_payload_check`: `user` exige `body`; `system` exige `payload` y no lleva `body`.
  `user_id` sin restringir (FK `nullOnDelete` y actor en los avisos de la fase 11). Alta · opus.
- [x] M-8 — `ChannelResource`: un resumen del proyecto (`id`, `name`, `key`) en vez del `ProjectResource` completo.
  Media (contrato público) · sonnet.
- [ ] M-9 — Paginar `GET /api/channels` si crece el número de canales. Media (contrato público) · sonnet.
- [x] M-10 — Validar `cursor` de mensajes: uno mal formado hoy devuelve la primera página en vez de 422. Baja · sonnet.
- [x] M-11 — Una petición a `api/*` sin token y sin `Accept: application/json` da 500 (`Route [login] not defined`;
  verificado con curl a `/api/channels`). Responder 401 JSON en todo `api/*` y simplificar `redirectGuestsTo` en
  `bootstrap/app.php`. Media (contrato de errores, 1-2 archivos + test) · sonnet.
- [x] M-12 — `ChannelChannel`: `ctype_digit` acepta números mayores que bigint, y Postgres da 500 en vez de 403;
  validar con `filter_var(..., FILTER_VALIDATE_INT)`. Alta (seguridad) · opus.
- [x] M-13 — `BroadcastingAuthTest`: un miembro pidiendo un canal inexistente de su organización da 403. Baja · sonnet.
- [x] M-14 — `/broadcasting/auth` no pasa por `SetLocale`: sus errores salen siempre en `en`. Baja · sonnet.
- [x] M-15 — `LogEventRecorderTest`: el test de rollback afirma también que no se despacha `LogGroupReopened`. Baja · sonnet.
- [x] M-16 — `LogEventRecorder::upsertGroup` devuelve `object`: tiparlo con una `readonly class`. Baja · sonnet.
- [x] M-17 — Anotar en `database.md` que `LogEventRecorder` usa `RETURNING old.*` y exige PostgreSQL 18. Baja · sonnet.
- [x] M-18 — `PostLogGroupNoticeTest`: quitar la aserción que solo repite `$tries`, y probar con el worker real
  (no `handle` a mano). Baja · sonnet.
- [ ] M-19 — Mover `postStatusNotice` del `LogGroupController` a una acción o evento si otro punto llega a cambiar el
  estado de un grupo (p. ej. el plan). Media · sonnet.
- [x] M-20 — `bootstrap/app.php`: extraer la condición repetida `is('api/*', 'broadcasting/*') || expectsJson()`.
  Baja · sonnet.
- [x] M-21 — `BroadcastingAuthTest`: sumar al dataset `007` y el borde `9223372036854775808` (`PHP_INT_MAX + 1`).
  Baja · sonnet.
- [x] M-22 — El CHECK de `messages` no detecta un `payload` JSON `'null'` (no es SQL NULL); sumar
  `jsonb_typeof(payload) = 'object'` si hace falta. Alta (esquema de BD) · opus.
- [x] M-23 — `ChannelTest`: los casos de proyecto ajeno afirman el mensaje de `InvalidArgumentException` y que no se
  insertó ninguna fila. Baja · sonnet.
- [x] M-24 — `BroadcastingAuthTest`: un usuario con `locale = es` y sin `Accept-Language` recibe `Content-Language: es`
  en `/broadcasting/auth`. Baja · sonnet.
- [x] M-25 — `ChannelApiTest`: cursores con `id` fuera de bigint, negativo y float dan 422. Baja · sonnet.
