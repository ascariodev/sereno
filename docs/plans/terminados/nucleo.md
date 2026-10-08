# Plan: nucleo

**Objetivo:** dejar `workspace-api` funcionando en Docker con auth, idioma por usuario, organizaciones (tenant), membresías, roles por organización, invitaciones y proyectos, con el scope multi-tenant que falla cerrado. Es la etapa 1 del MVP de workspace.
**Estado:** terminado · Fase actual: —
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Producto: espacio de trabajo unificado multi-tenant con tres módulos integrados: chat (comunicación), plan (gestión de proyectos) y log (avisos y retroalimentación de los sistemas de cada proyecto). El proyecto es la entidad central: cada uno tendrá sus canales, su tablero y sus fuentes de log. Primer cliente: el equipo del usuario (hoy manda logs de posveapi a Slack); a futuro, SaaS. Clientes previstos: web, escritorio (Windows, Linux, Mac) y móvil.
- Layout: `Development/workspace/` es contenedor sin git (como medic). Repos: `workspace-api` (este plan) y luego `workspace-web` (Vue 3 SPA). Commits con `git -C workspace-api`.
- Código y BD en inglés (dominio incluido). La comunicación con el usuario sigue en español.
- Referencia directa: el núcleo de `../medic/medic-api` ya resuelve lo mismo con nombres en español. Copiar el patrón, no reinventarlo:
  `docker/php/Dockerfile`, `docker/postgres/init.sql`, `docker-compose.yml`, `app/Support/ConsultorioActual.php`,
  `app/Http/Middleware/ResolverConsultorio.php`, `app/Models/Concerns/BelongsToConsultorio.php`,
  `app/Models/Scopes/ConsultorioScope.php`, `config/permission.php` (teams), `app/Enums/Rol.php`, y la sección "Multi-tenant" de `medic-api/CLAUDE.md`.
- Equivalencias: consultorio → organization, `X-Consultorio-Id` → `X-Organization-Id`, `consultorio_user` → `organization_user`, `ConsultorioActual` → `CurrentOrganization`.
- Puertos (no chocar con posven 8000/5432, bidfletes 8001/5433/8080, medic 8002/5434/8081/8085): API 8003, PostgreSQL 5435.
- No hay PHP ni Composer en la máquina: todo corre en Docker.

## Fases

### [x] Fase 1 — Contenedor del workspace
- **Alcance:** aplicar la estructura por fases con `/aplicar-estructura` (kit `~/.claude/kit/claude-setup/`), escribir el `CLAUDE.md` raíz (descripción del producto, mapa del workspace, puertos, comandos, convenciones incluidas las de idioma, y el "Orden del MVP" de la sección Decisiones) y `docs/lecciones.md` vacío. Mover este plan si la estructura lo pide.
- **Archivos:** `CLAUDE.md`, `docs/lecciones.md` (los del kit no cuentan).
- **Terminado cuando:** una sesión abierta en `workspace/` carga el `CLAUDE.md` y el hook de estado detecta este plan como activo.

### [x] Fase 2 — Esqueleto Laravel en Docker [riesgo]
- **Alcance:** crear `workspace-api` (Laravel 13, PHP 8.4) con Composer dentro de un contenedor, `git init`, entorno Docker copiado de medic-api con los puertos nuevos, base `workspace_test` para tests, Pest instalado y `docker-compose.yml` raíz con `include`.
  Al final, tras el primer commit: copiar los hooks `post-commit`, `post-merge` y `post-checkout` de `../medic/medic-api/.git/hooks/` (son genéricos, derivan la ruta del repo) y construir el grafo inicial con el comando de "Descubrimiento con graphify" de CLAUDE.md. Los hooks no se versionan ni cuentan como archivos.
- **Archivos:** `workspace-api/docker/php/Dockerfile`, `workspace-api/docker/postgres/init.sql`, `workspace-api/docker-compose.yml`, `workspace-api/.env.example`, `docker-compose.yml` (raíz).
- **Terminado cuando:** `docker compose up -d` levanta API y Postgres, `GET /up` responde 200 en el puerto 8003 y `php artisan test --compact` pasa.

### [x] Fase 3 — Auth con Sanctum
- **Alcance:** `install:api`; register, login (token Bearer), logout y `me`. Mismo contrato que medic-api.
- **Archivos:** `AuthController`, `RegisterRequest`, `LoginRequest`, `UserResource`, `routes/api.php`.
- **Terminado cuando:** `AuthTest` cubre registro, login correcto e incorrecto, `me` con y sin token, y logout invalida el token.

### [x] Fase 4 — Resolución de idioma
- **Alcance:** columna `users.locale` (nullable), enum `Locale` (`en`, `es`), middleware `SetLocale` (preferencia del usuario, luego `Accept-Language`, luego `en`) aplicado a toda la API, y `PATCH /me/locale`. Las respuestas llevan `Content-Language`.
- **Archivos:** migración, `app/Enums/Locale.php`, `app/Http/Middleware/SetLocale.php`, `bootstrap/app.php`, `AuthController` (o controller de perfil).
- **Terminado cuando:** `LocaleTest`: un 422 sale en español con `Accept-Language: es`, la preferencia guardada del usuario gana sobre el header y un idioma no soportado cae a `en`.

### [x] Fase 5 — Traducciones base en español
- **Alcance:** `composer require laravel-lang/common` (aprobado; `laravel-lang/publisher` 16.8 soporta Laravel 13), `php artisan lang:add es` para generar las traducciones del framework, y `lang/es.json` / `lang/en.json` para los textos propios. Los archivos generados por el paquete no se editan a mano (se regeneran con `lang:update`).
- **Archivos:** `composer.json`, `lang/en.json`, `lang/es.json` (los generados por `lang:add` no cuentan).
- **Terminado cuando:** un test recorre las claves de `lang/en/*.php` y `lang/en.json` y falla si alguna falta en español.

### [x] Fase 6 — Modelo de organizaciones
- **Alcance:** tablas `organizations` (name, slug único, `settings` jsonb con `default_locale`) y `organization_user` (solo membresía), modelos y relaciones.
- **Archivos:** migración, `Organization`, `OrganizationFactory`, `User` (relación).
- **Terminado cuando:** test de modelo: un usuario puede pertenecer a varias organizaciones y el slug es único.

### [x] Fase 7 — Scope multi-tenant [riesgo]
- **Alcance:** `CurrentOrganization` (scoped), middleware `organization` (400 sin header o no numérico, 403 sin membresía), trait `BelongsToOrganization` y `OrganizationScope` que fallan cerrado; registro del alias en `bootstrap/app.php`.
- **Archivos:** `app/Support/CurrentOrganization.php`, `app/Http/Middleware/ResolveOrganization.php`, `app/Models/Concerns/BelongsToOrganization.php`, `app/Models/Scopes/OrganizationScope.php`, `bootstrap/app.php`.
- **Terminado cuando:** `TenantTest` (con ruta y modelo de prueba definidos en el test) verifica 400/403/200, que sin organización activa el scope no devuelve filas y que `organization_id` se rellena al crear.

### [x] Fase 8 — spatie/permission en modo teams [riesgo]
- **Alcance:** instalar spatie/laravel-permission con `team_foreign_key = organization_id`, enum `Role`, seeder de roles globales y sincronizar `setPermissionsTeamId()` desde `CurrentOrganization::set()`.
- **Archivos:** `config/permission.php`, migración publicada, `app/Enums/Role.php`, `database/seeders/RoleSeeder.php`, `app/Support/CurrentOrganization.php`.
- **Terminado cuando:** test: un usuario con rol `admin` en la organización A no tiene ese rol al activar la B.

### [x] Fase 9 — Endpoints de organizaciones
- **Alcance:** listar mis organizaciones (sin header) y crear una (el creador queda como `owner` vía `Organization::addMember()`).
- **Archivos:** `OrganizationController`, `CreateOrganizationRequest`, `OrganizationResource`, `Organization` (addMember), `routes/api.php`.
- **Terminado cuando:** `OrganizationApiTest`: crear deja al creador como miembro y owner; el listado no muestra organizaciones ajenas.

### [x] Fase 10 — Invitaciones
- **Alcance:** owner/admin invita por email (token con vencimiento, guarda el idioma con que se envía: el de la organización), el invitado acepta autenticado y queda como miembro con el rol indicado. Correo traducible con driver `log` por ahora.
- **Archivos:** migración `invitations`, `Invitation`, `InvitationController`, `InviteRequest`, `routes/api.php`.
- **Terminado cuando:** `InvitationApiTest`: un miembro sin rol admin recibe 403, un token vencido o usado no sirve, aceptar crea la membresía con el rol y el correo sale en el idioma de la organización.

### [x] Fase 11 — Modelo de proyectos
- **Alcance:** tabla `projects` (name, key corta única por organización, description, archived_at), modelo con `BelongsToOrganization` y policy.
- **Archivos:** migración, `Project`, `ProjectFactory`, `ProjectPolicy`.
- **Terminado cuando:** test de policy: solo owner/admin crean, editan y archivan; cualquier miembro ve.

### [x] Fase 12 — Endpoints de proyectos
- **Alcance:** CRUD de proyectos bajo el middleware `organization` (archivar en vez de borrar).
- **Archivos:** `ProjectController`, `ProjectRequest`, `ProjectResource`, `routes/api.php`.
- **Terminado cuando:** `ProjectApiTest`: no se ven ni modifican proyectos de otra organización y la key repetida en la misma organización da 422.

## Decisiones
- 2026-10-05 — Un solo producto con tres módulos (chat, plan, log) alrededor del proyecto, no tres apps. — Visión del usuario: la integración es el diferenciador.
- 2026-10-05 — Monolito modular en Laravel; sin microservicios. — Equipo chico; el log es el único módulo con carga distinta y se aísla por cola.
- 2026-10-05 — Multi-tenant desde el día uno, una sola BD, mismo mecanismo que medic; tenant = `organization`. — Posible SaaS.
- 2026-10-05 — Código, BD y dominio en inglés. — Decisión del usuario ("ingles").
- 2026-10-05 — Aplicación multi idioma desde el día uno; idiomas iniciales `en` (por defecto) y `es`. La API nunca devuelve textos fijos: todo mensaje pasa por claves de traducción. El idioma se resuelve por usuario (`users.locale`), luego `Accept-Language`, luego `en`; la organización tiene un `default_locale` para lo que se envía a quien aún no es usuario. El contenido que escriben las personas (mensajes, tareas) no se traduce. Los frontends traducen su propia interfaz (vue-i18n / i18n en Expo). — Decisión del usuario.
- 2026-10-05 — Roles por organización: `owner`, `admin`, `member`. — Confirmado por el usuario.
- 2026-10-05 — Copiar a `workspace-api` los hooks de git de medic-api que actualizan el grafo de graphify. — Aprobado por el usuario.
- 2026-10-05 — `workspace-api` creado con `create-project --no-scripts` (sin `database.sqlite`); identidad git local igual a medic-api (`Sergio`); se conserva el `AGENTS.md` de Laravel como en medic. — Fase 2.
- 2026-10-06 — `SetLocale` va en el grupo `api` (antes de `auth:sanctum`) y resuelve al usuario con el guard `sanctum`; con token inválido cae al header. — Fase 4.
- 2026-10-06 — Invitaciones: admin puede invitar admin o member, no owner; una invitación nueva reemplaza las pendientes del mismo email en la organización; el correo lleva el token en texto hasta que exista `workspace-web`. — Fase 10.
- 2026-10-05 — Traducciones del framework con laravel-lang (`laravel-lang/common`). — Aprobado por el usuario.
- 2026-10-05 — Los canales aceptan mensajes de personas y de sistema en el mismo modelo; los avisos de log son mensajes del canal con acciones. — Evita que el log sea un "notificador" externo al chat.
- 2026-10-05 — En el MVP todos los miembros ven todos los proyectos; proyectos privados después. — Menos fases en el núcleo.
- 2026-10-05 — Auth por token Bearer (no cookies de sesión). — Sirve igual para web, escritorio (Tauri) y móvil.
- 2026-10-05 — Orden del MVP: 1) núcleo (este plan); 2) log: fuentes con API key por proyecto, ingesta por cola, agrupado de eventos, retención; 3) canales de proyecto con avisos de log y Reverb; 4) `workspace-web` mínima (login, proyectos, canal); 5) conectar posveapi y dejar Slack; 6) chat humano completo (hilos, menciones, adjuntos); 7) plan (tareas, tablero, crear tarea desde un aviso); 8) escritorio (Windows, Linux y Mac): primero PWA instalable de `workspace-web`, luego empaquetado nativo con Tauri reutilizando la misma SPA; 9) móvil, push y facturación SaaS.

## Notas para la próxima sesión
- Fase 2 hecha (4abf2a4): Laravel 13.34, Pest 5.3 sobre `workspace_test`, `/up` 200 en 8003, hooks de graphify instalados y grafo inicial construido. `workspace-api/.env` ya existe (no leerlo). Archivos creados desde contenedores como root necesitan `chown -R 1000:1000` (receta en `workspace-api/CLAUDE.md`). Sigue la fase 3.
- Fase 3 hecha (2dba8d1): rutas `POST /api/auth/{register,login,logout}` y `GET /api/me`; register y login devuelven `{token, user}`. Fase 5 debe incluir la clave `The credentials are not valid.` en `lang/en.json` y `lang/es.json`. `UserResource` gana `locale` en la fase 4. Sigue la fase 4.
- Fase 4 hecha (f3912cd): `SetLocale` en el grupo `api` (lee `$request->user('sanctum')`), `Content-Language` en todas las respuestas, `PATCH /api/me/locale` devuelve `UserResource` con `locale`. En la fase 5, quitar el `addLines` del `beforeEach` de `LocaleTest` y usar las traducciones reales.
- Fase 5 hecha (5b3e1aa): laravel-lang/common en require-dev; `lang/en` y `lang/es` generados (correr pint tras `lang:update`, que conserva las claves propias de los JSON). Textos propios: clave en inglés en `lang/en.json` y `lang/es.json`; `TranslationsTest` falla si falta alguna. Sigue la fase 6.
- Fase 6 hecha (65b9c2e): `organizations` (slug único, `settings` jsonb con `default_locale` = `en`) y `organization_user` con `unique(organization_id, user_id)`; `User::organizations()`. Sigue la fase 7 (scope tenant).
- Fase 7 hecha (582ed4f): `CurrentOrganization` scoped en `AppServiceProvider`, middleware `organization` con prioridad tras auth, scope que falla cerrado. En la fase 8: `setPermissionsTeamId()` en `CurrentOrganization::set()` y `unsetRelation('roles')` en el middleware, como medic.
- Fase 8 hecha (e494d59): spatie/permission ^8.3 en teams con FKs a `organizations` y unique `NULLS NOT DISTINCT`; `RoleSeeder` lo siembran `DatabaseSeeder` y `TestCase`; `ResolveOrganization` limpia la organización activa al empezar. **Fase 9:** `Organization::addMember()` debe fijar el team, asignar y restaurar el anterior con `unsetRelation('roles')`, como `Consultorio.php:49-52` de medic. Chown desde Git Bash con `MSYS_NO_PATHCONV=1`.
- Fase 9 hecha (80a2df2): `GET/POST /api/organizations` (sin header); `Organization::addMember()` con try/finally que restaura el team; `User::organizationsWithRoles()` y `rolesInOrganizations()`. Para invitaciones (fase 10) usar `addMember()` al aceptar.
- Fase 10 hecha (638d099): `POST /api/invitations` (organization; autoriza en `InviteRequest::authorize()` antes de validar) y `POST /api/invitations/accept` (sin header; token en el cuerpo, SHA-256 en BD, 7 días). Admin no invita owner. Patrón de policy/authorize a reutilizar en proyectos.
- Fase 11 hecha (e009056): `projects` con CHECK `projects_key_check` (`^[A-Z][A-Z0-9]{1,9}$`) y `unique(organization_id, key)`; `ProjectPolicy` (viewAny, view, create, update, archive→update). **Fase 12:** `ProjectRequest` pasa la key a mayúsculas antes de validar y NO acepta `archived_at`; archivar es una acción aparte con `authorize('archive')`. En tests usar `->for($org)` con las factories.
- Fase 12 hecha (3756448): `/api/projects` (index con `?include_archived=1`, store, show, update) y `POST/DELETE /api/projects/{project}/archive`; sin borrado físico. Proyecto ajeno: 404 por scope; header ajeno: 403.
- Plan terminado: suite completa 87/87 (243 aserciones) y pint limpio. Siguiente etapa del MVP: log (plan nuevo con `/planificar`).

## Mejoras propuestas
- [x] M-1: subir `"php"` de `^8.3` a `^8.4` en `workspace-api/composer.json` para igualar el Dockerfile.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-2: decidir si `workspace-api/README.md` (esqueleto de Laravel) se reemplaza por uno propio.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-3: avisar en `workspace-api/CLAUDE.md` que `init.sql` solo corre al crear el volumen (si falta `workspace_test`, recrear el volumen).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-4: `throttle` en `auth/login` y `auth/register` (`workspace-api/routes/api.php`) contra fuerza bruta, con test.
      Complejidad: alta · Archivos: 1 · Riesgo: seguridad → opus
- [x] M-5: en `AuthController::login`, `Hash::check` ficticio cuando el email no existe, para igualar tiempos y no permitir enumerar emails.
      Complejidad: alta · Archivos: 1 · Riesgo: seguridad → opus
- [x] M-6: test de que un 401 (`/api/me` sin token) también lleva `Content-Language` y sale traducido.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-7: agregar `Vary: Accept-Language` en `SetLocale` para cachés y CDN.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-8: pasar a inglés el comentario de exclusiones de `TranslationsTest` y anotar en `workspace-api/CLAUDE.md` que `lang/en/*.php` también es generado.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-9: derivar el `default_locale` de `$attributes` en `Organization` de `Locale::default()` en vez del literal `'en'`.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-10: test de que borrar una organización borra sus membresías (cascade).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-11: `ResolveOrganization` responde 401 si `$request->user()` es null (ruta con `organization` sin `auth`), en vez de un 500.
      Complejidad: alta · Archivos: 1 · Riesgo: seguridad → opus
- [x] M-12: comentarios de código en inglés (`OrganizationScope`, y revisar el resto) según la convención del proyecto.
      Complejidad: baja · Archivos: 1-2 · Riesgo: ninguno → sonnet
- [x] M-13: documentar en `workspace-api/CLAUDE.md` que `ResolveOrganization` limpia la organización activa al empezar, ajustar el comentario (la parte de Octane no aplica) y la receta de `chown` con `MSYS_NO_PATHCONV=1`.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-14: slug de organización atómico: capturar `UniqueConstraintViolationException` y reintentar `uniqueSlugFor` dentro de la transacción (hoy dos creaciones simultáneas con el mismo nombre dan 500).
      Complejidad: alta · Archivos: 2 · Riesgo: concurrencia / BD → opus
- [x] M-15: al invitar, no permitir que un admin reemplace una invitación pendiente de rol owner hecha por otro (limitar el `delete()` de pendientes por rol o por `invited_by`).
      Complejidad: alta · Archivos: 1-2 · Riesgo: seguridad → opus
- [x] M-16: al aceptar, revalidar que quien invitó sigue siendo owner/admin de la organización.
      Complejidad: alta · Archivos: 1-2 · Riesgo: seguridad → opus
- [ ] M-17: (parte de la cola hecha en log fase 2; falta el enlace a `workspace-web`) `InvitationNotification` con `ShouldQueue` cuando haya colas, y enlace a `workspace-web` en vez del token en texto cuando exista.
      Complejidad: media · Archivos: 1-2 · Riesgo: integración → sonnet
- [x] M-18: separar en `ProjectPolicyTest` el caso de key repetida en otra organización (permitido) del de key repetida en la misma (falla).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-19: paginar `GET /api/projects`.
      Complejidad: media · Archivos: 2 · Riesgo: contrato público → opus
- [x] M-20: quitar `archived_at` del `#[Fillable]` de `Project` (archivar ya usa `forceFill`).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-21: configurar `trustProxies` en `bootstrap/app.php` cuando el API corra detrás de un proxy, para que el límite por IP de login no agrupe a todos bajo la IP del proxy.
      Complejidad: media · Archivos: 1 · Riesgo: seguridad → opus (aplicar al definir el despliegue)
- [x] M-22: quitar `SetLocale` del grupo `api` si basta con la lista de prioridad (hoy está en ambos). Descartada: el grupo lo ejecuta y la prioridad solo lo ordena antes de auth; no es redundante.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-23: estado `invitedBy()` en `InvitationFactory` (o rellenar `invited_by` por defecto), porque desde M-16 una invitación sin invitador no se puede aceptar.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
