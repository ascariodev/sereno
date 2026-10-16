# Plan: oauth-mcp

**Objetivo:** que Sereno se pueda agregar como conector MCP en claude.ai con OAuth 2.1 (registro dinámico, PKCE y
consentimiento en la web eligiendo organización), sin romper los tokens de acceso Bearer actuales de `/mcp`.
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz). `app/` (móvil) no cambia. Viene de M-1 de
  `docs/plans/terminados/integracion-mcp.md`.
- `laravel/mcp` v1.0.2: `Mcp::oauthRoutes()` (`vendor/laravel/mcp/src/Server/Registrar.php:124-215`) solo registra el
  discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) y `POST /oauth/register`
  (DCR, clientes públicos de Passport con scope `mcp:use`; valida `redirect_uris` contra `config('mcp.redirect_domains')`,
  por defecto `['*']`). No pisa una ruta GET de discovery que ya exista. `/oauth/authorize` y `/oauth/token` son de Passport.
  `AddWwwAuthenticateHeader` agrega `resource_metadata` al 401 de `/mcp` si existe la ruta de discovery.
- Passport no está instalado; `composer require laravel/passport` resuelve v13.10 (league/oauth2-server 9). Guard único hoy:
  `web` (sesión); el API usa Sanctum Bearer. La web no tiene sesión por cookie: el consentimiento de Passport (Blade con
  sesión) no sirve tal cual.
- `/mcp` (`api/routes/ai.php`): `SetLocale`, `auth:sanctum`, `ResolveTokenOrganization` (exige token de acceso propio con
  `organization_id` y ability `mcp`), `throttle:mcp`. Las tools exigen usuario y `CurrentOrganization`.
- Lecciones a mano: L-02 (limpiar organización por request), L-95 a L-97 (errores, normalización, tests por punto de entrada).
- Comandos en un worktree: `MSYS_NO_PATHCONV=1 docker compose --env-file ../../../api/.env -p workspace run --rm --no-deps -T
  -e APP_KEY=base64:$(openssl rand -base64 32) api <comando>` (sin `.env` en el worktree; `GenerateVapidKeysCommandTest`
  falla ahí por eso).

## Fases

### [x] Fase 1 — Instalar Passport junto a Sanctum [riesgo]
- **Alcance:** `composer require laravel/passport`, migraciones de Passport, guard `api` (driver `passport`), traits de
  `User` sin choque con `HasApiTokens` de Sanctum (`insteadof`: lo de Sanctum sigue mandando en el resto del API), claves
  por `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` o `storage/oauth-*.key`, `Passport::tokensCan(['mcp:use' => ...])`.
- **Archivos:** `api/composer.json`/`composer.lock`, `api/config/auth.php`, `api/app/Models/User.php`,
  `api/app/Providers/AppServiceProvider.php`, migraciones de Passport (+ `.claude/rules/database.md`).
- **Terminado cuando:** la suite del API pasa y un test emite un token de Passport y lo resuelve con `auth:api`, mientras
  `auth:sanctum` sigue resolviendo tokens de sesión y de acceso.

### [x] Fase 2 — Discovery de OAuth
- **Alcance:** `Mcp::oauthRoutes()` y `config/mcp.php` (`authorization_server`); discovery del authorization server
  propio (ruta GET exacta, que el paquete no pisa) con `authorization_endpoint` en la web (`<web>/oauth/authorize`) y
  `token_endpoint` en Passport.
- **Archivos:** `api/routes/ai.php`, `api/config/mcp.php`, controller de discovery propio.
- **Terminado cuando:** tests del discovery: protected resource y authorization server con endpoints, S256 y `mcp:use`; el
  401 de `/mcp` trae `resource_metadata`.

### [x] Fase 3 — Registro dinámico restringido
- **Alcance:** `redirect_domains` solo de claude.ai/claude.com (verificar los dominios de callback reales), throttle en
  `/oauth/register` y `/oauth/token`, errores en JSON.
- **Archivos:** `api/config/mcp.php`, `api/bootstrap/app.php`, `api/app/Providers/AppServiceProvider.php`.
- **Terminado cuando:** tests del DCR: acepta un `redirect_uri` de claude.ai, rechaza otro dominio y limita por IP.

### [x] Fase 4 — Vínculo de cliente OAuth con organización [riesgo]
- **Alcance:** tabla `mcp_oauth_grants` (`client_id`, `user_id`, `organization_id`, único `(client_id, user_id)`) con
  modelo; la escribe el consentimiento y la lee `/mcp`. Un cliente de DCR es una conexión de claude.ai, así que el par
  cliente-usuario fija la organización.
- **Archivos:** migración, `api/app/Models/McpOauthGrant.php`, `.claude/rules/database.md`.
- **Terminado cuando:** tests del modelo (único, cascadas al borrar usuario, organización o cliente).

### [x] Fase 5 — Endpoint JSON de autorización [riesgo]
- **Alcance:** `GET /api/oauth/authorize` (Sanctum, sesión): valida la petición con `AuthorizationServer` de league
  (cliente, `redirect_uri`, PKCE S256, scope) y devuelve nombre del cliente y organizaciones del usuario.
  `POST /api/oauth/authorize` (aprobar con `organization_id`, membresía validada): guarda el grant y devuelve la
  `redirect_url` con el código; `DELETE` (rechazar) devuelve la `redirect_url` con `access_denied`. Textos por `__()`.
- **Archivos:** controller, Form Request, `api/routes/api.php`, `api/lang/en.json`, `api/lang/es.json`.
- **Terminado cuando:** test del flujo completo: authorize, aprobar, canjear el código en `/oauth/token` con el
  `code_verifier` y recibir access y refresh token; casos de PKCE inválido, cliente o `redirect_uri` ajenos y organización
  ajena.

### [x] Fase 6 — `/mcp` acepta tokens OAuth [riesgo]
- **Alcance:** `auth:sanctum,api` en `/mcp`; `ResolveTokenOrganization` con rama Passport (scope `mcp:use`, organización
  desde `mcp_oauth_grants`, revalidar membresía, L-02); `throttle:mcp` por token en ambos tipos; comprobar `SetLocale` y el
  401 con `resource_metadata`.
- **Archivos:** `api/routes/ai.php`, `api/app/Http/Middleware/ResolveTokenOrganization.php`,
  `api/app/Providers/AppServiceProvider.php`, `api/app/Http/Middleware/SetLocale.php` (si hace falta).
- **Terminado cuando:** tests: token OAuth lista proyectos de su organización; sin grant, sin scope o ex miembro dan 403;
  los tokens de acceso Bearer siguen pasando todos los tests de `tests/Feature/Mcp`.

### [x] Fase 7 — Pantalla de consentimiento en la web
- **Alcance:** ruta `/oauth/authorize` en la SPA (sin sesión, al login y de vuelta con la query intacta), muestra el
  cliente y un selector de organización, aprueba o rechaza con la API de la fase 5 y redirige a la `redirect_url`.
- **Archivos:** `web/src/views/OAuthAuthorizeView.vue`, `web/src/router/index.ts`, `web/src/api/oauth.ts`,
  `web/src/i18n/en.json`, `web/src/i18n/es.json`.
- **Terminado cuando:** specs: carga, aprobar con la organización elegida, rechazar, error de petición inválida y
  redirección al login conservando la query.

### [x] Fase 8 — Revocar conexiones OAuth al salir de la organización
- **Alcance:** `Organization::removeMember` (como M-4 de integracion-mcp) borra los grants del usuario en esa organización y
  revoca sus tokens y refresh tokens de Passport de esos clientes.
- **Archivos:** `api/app/Models/Organization.php` (+ tests).
- **Terminado cuando:** test: al sacar al miembro el token OAuth deja de servir y los de otras organizaciones siguen.

### [x] Fase 9 — API de conexiones OAuth
- **Alcance:** `GET/DELETE /api/oauth-connections`: grants del usuario en la organización activa (cliente, organización,
  fecha); revocar borra el grant y revoca sus tokens y refresh tokens.
- **Archivos:** controller, resource, `api/routes/api.php`.
- **Terminado cuando:** tests: lista solo lo propio, ajeno o de otra organización = 404, revocar invalida el token en `/mcp`.

### [x] Fase 10 — Conexiones en la vista de tokens
- **Alcance:** sección "Conexiones" en `AccessTokensView` que lista y revoca con confirmación, con respuestas tardías (L-10).
- **Archivos:** `web/src/api/accessTokens.ts`, `web/src/api/types.ts`, `web/src/views/AccessTokensView.vue`, i18n de la web.
- **Terminado cuando:** specs de la vista: lista, vacío, revocar y respuesta tardía.

### [x] Fase 11 — Producción y documentación [manual] [riesgo]
- **Alcance:** claves de Passport en el `.env` del servidor (las carga el usuario) compartidas por `app`, `queue` y
  `reverb`; deploy; agregar Sereno como conector personalizado en claude.ai y probar listar proyectos y comentar una
  tarea; documentar en `CLAUDE.md`.
- **Archivos:** `CLAUDE.md` (+ configuración de producción solo si hace falta).
- **Terminado cuando:** claude.ai conecta por OAuth, lista proyectos y comenta una tarea en producción.

## Decisiones
- 2026-10-15 — Consentimiento en la SPA con un endpoint JSON propio sobre league/oauth2-server, no la vista Blade de
  Passport: la web no tiene sesión por cookie y así se reusa el login Bearer actual. El discovery propio apunta
  `authorization_endpoint` a la web; `/oauth/token` sigue siendo el de Passport.
- 2026-10-15 — La organización se fija en el consentimiento y se guarda por cliente y usuario (`mcp_oauth_grants`); los
  tokens de Passport no llevan `organization_id`.
- 2026-10-15 — Los tokens de acceso Bearer de integracion-mcp siguen igual (Claude Code); OAuth es otro camino a `/mcp`.
- 2026-10-16 — Fase 1: sin `insteadof`. Los `HasApiTokens` de Sanctum y Passport declaran `$accessToken` con tipos distintos
  (fatal al componerlos): `User` queda solo con el de Sanctum; el guard de Passport usa `withAccessToken()` y el `tokenCan()`
  de Sanctum sirve con el `AccessToken` de Passport. `$user->tokens()` es de Sanctum: las fases 8 y 9 consultan
  `Laravel\Passport\Token` directo, no `TokenRepository`.
- 2026-10-16 — Migraciones de Passport publicadas tal cual (`oauth_clients` con UUID, excepción anotada en database.md); claves
  por la config por defecto de Passport, sin publicar `config/passport.php`.

- 2026-10-16 — Fase 2: discovery propio en `OAuthDiscoveryController`; la ruta exacta `/.well-known/oauth-authorization-server`
  va antes de `Mcp::oauthRoutes()` (el paquete la omite si existe) y la variante `/{path}` después (reemplaza la del paquete por
  URI). `issuer` = `url('/')` (sobrescribible con `MCP_AUTHORIZATION_SERVER`), `token_endpoint_auth_methods_supported` = `['none']`
  (DCR crea clientes públicos). `config/mcp.php` propio se fusiona con `mergeConfigFrom` (superficial): una clave presente
  reemplaza la del paquete entera, así que la fase 3 define `redirect_domains` completo.

- 2026-10-16 — Callback verificado en https://claude.com/docs/connectors/building/authentication: claude.ai web, escritorio,
  móvil y Cowork usan exactamente `https://claude.ai/api/mcp/auth_callback` (claude.com no figura). Claude Code usaría
  loopback (`http://localhost:<puerto>/callback`), pero sigue con tokens Bearer: no se aceptan loopback en el DCR. Otros
  requisitos de Claude para fases 5, 6 y 11: `/oauth/token` con form-urlencoded, `invalid_grant` al refresh inválido, rotar
  refresh tokens (clientes públicos), respuesta en menos de 10 s, `resource` del protected resource igual a la URL que se
  pega en claude.ai (con `/mcp`), y la pantalla de consentimiento muestra el host del `redirect_uri`.
- 2026-10-16 — Fase 3: `redirect_domains` = `['https://claude.ai/api/mcp/']` y `custom_schemes` = `[]` (el paquete valida con
  `startsWith(dominio + '/')`: el URI exacto no sirve como entrada; se acepta cualquier ruta bajo `/api/mcp/` de claude.ai).
  `Passport::ignoreRoutes()`: solo queda `/oauth/token`, registrado en `routes/ai.php` (`AccessTokenController@issueToken`,
  nombre `passport.token`). Throttle por IP: `oauth-register` 10/min y `oauth-token` 60/min; `oauth/*` responde en JSON.
- 2026-10-16 — Fase 4: `McpOauthGrant` sin `BelongsToOrganization` (como `personal_access_tokens`: `/mcp` lo busca antes de
  haber organización activa), así que toda consulta filtra por cliente y usuario a mano. `$guarded = ['*']`: escribir con
  `firstOrNew` + asignar por propiedad + `save`, no `updateOrCreate`. Revocar en Passport solo marca `revoked` (no borra el
  cliente ni dispara la cascada). Sin `User::mcpOauthGrants()` todavía.
- 2026-10-16 — Fase 5 (contrato para la fase 7): GET/POST/DELETE `/api/oauth/authorize` llevan la query OAuth intacta y la
  revalidan con `AuthorizationServer`; POST solo `organization_id` en el body, DELETE sin body. GET devuelve
  `{client:{id,name}, redirect_host, scopes, organizations:[{id,name}]}`; POST y DELETE `{redirect_url}`, sin envoltorio `data`.
  Errores OAuth: 400 `{error, message}` traducidos, nunca 401 (desloguearía la SPA). S256 obligatorio; scope exactamente
  `mcp:use` (si falta, se asume solo en este controller; `Passport::defaultScopes` descartado porque se aplica también a los
  personal access tokens). Re-aprobar mueve el grant (y con él los tokens ya emitidos de ese cliente y usuario) a la nueva
  organización.
- 2026-10-16 — Fase 6: `/mcp` usa `AuthenticateMcp:sanctum,api` (Sanctum primero: el guard de Passport borra el header si no
  lee el token) y `SetLocale:sanctum,api`. `PassportGuards::usable()` omite los guards `passport` sin clave pública: sin
  claves, `/mcp` sigue con tokens Bearer y responde 401, no 500. OAuth sin scope `mcp:use` = `access_token_required`, sin
  grant = `organization_forbidden`. Throttle `mcp-oauth:<oauth_access_token_id>` / `mcp-token:<id>`. Las claves de test
  salen de `usePassportTestKeys()` (`tests/Pest.php`), solo en los tests OAuth.
- 2026-10-16 — Fase 7: `/oauth/authorize` en la SPA fuera de `AppLayout`, con sesión obligatoria (el guard manda al login con
  `redirect=fullPath`; `safeRedirect` ya lo admitía). La query se reenvía tal cual; organización preseleccionada = la activa si
  está en la lista, si no la primera. La redirección final solo usa el `redirect_url` del API y solo si es http(s).
- 2026-10-16 — Fase 8: `Organization::removeMember` llama a `revokeOauthConnections` (privado) dentro de la transacción de
  `mutateMembership`: revoca `Token` y `RefreshToken` de los clientes de los grants del usuario en esa organización y borra los
  grants. Un cliente apunta a una sola organización por usuario (grant único por par), así que filtrar por cliente y usuario
  equivale a filtrar por organización.
- 2026-10-16 — Fase 9 (contrato para la fase 10): `GET /api/oauth-connections` (auth:sanctum + organization, sin paginar, más
  nuevo primero) devuelve `{data:[{id (del grant), client:{id (uuid), name}, organization:{id, name}, created_at}]}` del
  usuario en la organización activa; `DELETE /api/oauth-connections/{id}` 204, ajeno/otra organización/inexistente 404 igual.
  `$grant->revoke()` (instancia) revoca `Token` y `RefreshToken` de su usuario y cliente y borra el grant; lo usan el
  controller (en `DB::transaction`) y `Organization::revokeOauthConnections`.
- 2026-10-16 — Fase 10: las conexiones tienen estado propio en `AccessTokensView` y cargan en paralelo con los tokens en el
  mismo `load()` (misma generación y AbortController); si falla una lista, la otra se muestra. Textos: "aplicaciones" y
  "Desconectar".
- 2026-10-16 — Fase 11: claves de Passport generadas con `openssl` en el servidor y cargadas en el `.env` de producción; deploy
  con las 6 migraciones; claude.ai conectó por OAuth, listó proyectos y comentó una tarea. Documentado en `CLAUDE.md`.

## Notas para la próxima sesión
- Fase 11 (manual): mergear `feat/oauth-mcp` a main, `composer install` en el vendor compartido, `restart queue`, `migrate`,
  `passport:keys` en desarrollo; en producción, claves de Passport en el `.env` del servidor (las carga el usuario), nginx de
  la web sirviendo la SPA en `/oauth/authorize`, deploy y prueba desde claude.ai. Al cerrar el worktree, borrar el volumen
  `workspace_oauthmcp_vendor`.
- El comando docker del worktree va sin `--network` (con él, 6 tests de notificaciones y push fallan por entorno).
- Fase 9: extraer la revocación de `Organization::revokeOauthConnections` (hoy privada) para reusarla en el DELETE de
  conexiones.
- En el worktree cada test da warning por el `.env` ausente: validar las corridas con `--display-warnings` y grep de
  "redeclare"/"runner warning", porque un archivo que no carga cuenta como warning y no como fallo.
- Tests de la web en el worktree (el servicio `web` monta el checkout principal), desde `web/` del worktree:
  `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/app" -v workspace_web-node-modules:/app/node_modules -w /app node:24 npx vitest --run <specs>`
  (`npm run typecheck` igual).
- Fase 11: el nginx de la web debe servir la SPA en `/oauth/authorize`. El registro desde el login del flujo OAuth no se probó.
- Tras mergear a main: OAuth en desarrollo necesita `php artisan passport:keys` (o `PASSPORT_*`); sin claves solo valen
  los tokens Bearer.
- Fase 6: un token OAuth toma la organización del grant actual (puede haber cambiado por re-aprobación); el parámetro
  `resource` del authorize no se valida (revisar si hace falta).
- Los revisores no ven `vendor/` en el worktree: leer Passport y laravel/mcp desde un contenedor con el volumen
  `workspace_oauthmcp_vendor` montado.
- El comando docker del worktree se pasa directo, sin `sh -c` (lo bloquea la comprobación de seguridad).
- En el worktree, `vendor/` vive en el volumen `workspace_oauthmcp_vendor` (con Passport): los comandos llevan además
  `-v workspace_oauthmcp_vendor:/var/www/api/vendor` y, desde `api/` del worktree, `--env-file ../../../../api/.env`. Al
  cerrar el worktree, borrar el volumen; tras el merge a main, `composer install` en el vendor compartido y `restart queue`.
- Passport registra sus rutas (`/oauth/authorize` con sesión, device, `/oauth/token`): la fase 2 o 3 decide
  `Passport::ignoreRoutes()` o deshabilitar las que sobran, y el throttle de `/oauth/token`.
- `ResolveTokenOrganization` y el limiter `mcp` asumen `PersonalAccessToken` de Sanctum (fase 6).

## Mejoras propuestas
- M-1: Revisar si `api/.env.example` debe documentar `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` (hoy solo en database.md),
  aclarando que sin `PASSPORT_PUBLIC_KEY` `/mcp` queda solo con tokens de acceso.
  Complejidad: baja (1 archivo, solución evidente). Modelo: sonnet. Origen: revisor fase 1.
- [x] M-2: Acortar a una línea el comentario de `User.php` sobre el trait de Passport (ya está en database.md y Decisiones).
  Complejidad: baja. Modelo: sonnet. Origen: revisor fase 1.
- M-3: Documentar `MCP_AUTHORIZATION_SERVER` (opcional) en `api/.env.example`. Complejidad: baja. Modelo: sonnet. Origen:
  revisor fase 2 (puede ir junto con M-1).
- [x] M-4: Fijar `token_endpoint_auth_methods_supported => ['none']` en el `$expected` de `OAuthDiscoveryTest`. Complejidad: baja.
  Modelo: sonnet. Origen: revisor fase 2.
- M-5: Rechazar `..` (o normalizar la ruta) en los `redirect_uris` del DCR: hoy `https://claude.ai/api/mcp/../x` pasa el
  prefijo (mismo host, riesgo mínimo); para exigir el URI exacto habría que sobrescribir el controller del DCR.
  Complejidad: media (seguridad, 2 archivos). Modelo: sonnet. Origen: revisor fase 3.
- M-6: En el GET de `/api/oauth/authorize`, si la petición no trae `redirect_uri` y el cliente tiene varias, `redirect_host`
  muestra la primera; exigir `redirect_uri` o calcular el host igual que league. Complejidad: baja. Modelo: sonnet. Origen:
  revisor fase 5.
- M-7: Sin throttle propio en `/api/oauth/authorize` (solo `auth:sanctum`). Complejidad: baja. Modelo: sonnet. Origen:
  implementador fase 5.
- M-8: Passport hace `report()` del `OAuthServerException` de cada token inválido o vencido que llega al guard `api` en
  `/mcp`; evaluar `dontReport`. Complejidad: baja. Modelo: sonnet. Origen: implementador fase 6.
- M-9: Validar el parámetro `resource` (RFC 8707) del authorize contra la URL de `/mcp`. Complejidad: media (seguridad).
  Modelo: sonnet. Origen: revisor fase 5 e implementador fase 6.
- M-10: `PassportGuards::hasPublicKey()` solo mira la clave pública; con pública sin privada `/oauth/token` falla. Comprobar
  ambas o avisar al arrancar. Complejidad: baja. Modelo: sonnet. Origen: revisor fase 6.
- M-11: Destacar el host del `redirect_uri` en el consentimiento (línea propia o negrita, "Volverás a: claude.ai"): el nombre
  del cliente lo elige el cliente y Claude pide mostrar el host con claridad. Complejidad: baja. Modelo: sonnet. Origen:
  revisor fase 7.
- M-12: Accesibilidad del consentimiento (L-25): foco al `h1` al cargar y región `aria-live` siempre presente para "Volviendo
  a...". Complejidad: baja. Modelo: sonnet. Origen: revisor fase 7.
- M-13: Carrera entre un `approve` de OAuth y la expulsión del miembro: `ApproveAuthorizationRequest` valida la membresía sin
  bloqueo, así que un grant podría crearse justo al sacar al usuario. Validar la membresía bajo el lock de la organización.
  Complejidad: media (seguridad). Modelo: sonnet. Origen: revisor fase 8.
- M-14: En `AccessTokensView`, ignorar `AbortError` en `loadConnections` y en la carga de tokens (rechazos sin capturar al
  abortar). Complejidad: baja. Modelo: sonnet. Origen: revisor fase 10.
- M-15: Foco tras desconectar o revocar (L-65): al quitar la fila, el foco va al vecino o al encabezado, en tokens y
  conexiones, con spec. Complejidad: baja. Modelo: sonnet. Origen: revisor fase 10.
- M-16: "Reintentar" de conexiones recarga solo las conexiones, sin borrar los tokens ni cerrar diálogos. Complejidad: baja.
  Modelo: sonnet. Origen: revisor fase 10.
