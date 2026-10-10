# Plan: pantallas-faltantes

**Objetivo:** que una persona pueda registrarse, crear su organización y crear proyectos desde la web, sin `curl`, y que
el registro abierto se pueda cerrar por entorno dejando solo la entrada por invitación.
**Estado:** en curso · Fase actual: 12
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` (fases 1 y 2) y `web/` (commits con `git` en la raíz). El API ya tiene:
  - `POST /api/auth/register` (`name`, `email`, `password`, `password_confirmation`; 201 `{token, user}`; throttle 5/min
    por IP, 429 con `Retry-After`). `stores/auth.ts` ya tiene `register()` (lo usa `InviteView`).
  - `POST /api/organizations` (`name`; sin `X-Organization-Id`; cualquier usuario autenticado; el creador queda owner;
    201 `OrganizationResource`).
  - `POST /api/projects` (`name`, `key` `^[A-Z][A-Z0-9]{1,9}$` única por organización, el API la pasa a mayúsculas y
    recorta; `description` opcional; necesita `X-Organization-Id`; solo owner/admin, si no 403; crea el canal del
    proyecto; 201 `ProjectResource`).
- Web: `api/client.ts` (`ApiError{status, message, errors}`, 422 con `errors`, 0 = red), tipos en `api/types.ts`, módulos por
  recurso en `api/` (no existen `organizations.ts` ni `projects.ts`). Stores `organization` (`load()`, `select(id)`,
  `isOwner`, `isAdmin`) y `projects` (`reload()`, `channelByProject`). i18n en `i18n/es.json` y `i18n/en.json`.
- Patrones a copiar: formulario y errores de `LoginView`/`InviteView` (ids `<vista>-<campo>-error-<i>`,
  `aria-invalid`, `aria-describedby`, `role="alert"` para 422 sin campos, 429 y red); diálogo con formulario de
  `TaskCreateDialog` (sobre `ui/AppDialog`, emite `created`, no cierra mientras envía); `toast`.
- `AppLayout` sin organizaciones muestra `organization.none`/`noneHint` y no renderiza `<RouterView>`: crear
  organización tiene que poder abrirse desde ese estado vacío.
- Invitaciones: `Invitation::findByPlainToken()` e `isUsable()` (no aceptada y sin vencer); `InviteView` registra con
  `auth.register()` y después acepta con el token de la ruta. Si el registro se cierra sin la fase 3, las invitaciones a
  personas sin cuenta dejan de funcionar.
- Lecciones a tener presentes: L-04 (autorizar antes de validar para no filtrar emails), L-10/L-32 (generación en async), L-25 y L-33 (tests de foco y ARIA), L-38 (tokens de
  tema), L-45 (`spyOn` siempre con implementación).

## Fases

### [x] Fase 1 — Interruptor de registro en el API [riesgo]
- **Alcance:** `REGISTRATION_ENABLED` (por omisión `true`) en `config/auth.php`. Con el registro cerrado,
  `RegisterRequest::authorize()` exige `invitation_token` de una invitación usable cuyo email coincida con el
  enviado (sin distinguir mayúsculas); si no, 403 con mensaje traducido ("El registro está cerrado"), igual para
  token inválido y email distinto, y antes de validar (L-04: un 422 de `unique` revelaría emails). Con el registro
  abierto, `invitation_token` se ignora. Registrarse no acepta la invitación (lo sigue haciendo `accept`).
- **Archivos:** `api/config/auth.php`, `api/app/Http/Requests/Auth/RegisterRequest.php`, `api/lang/en.json`,
  `api/lang/es.json`, tests en el archivo de tests de registro que exista.
- **Terminado cuando:** pasan los tests de abierto (como hoy), cerrado sin token, token inválido, vencido, aceptado,
  de otro email (403 sin filtrar si el email existe), token válido (201) y el mensaje en `es`; Pint pasa.

### [x] Fase 2 — Estado del registro en el API
- **Alcance:** `GET /api/auth/registration` público que devuelve `{"enabled": bool}`.
- **Archivos:** `api/routes/api.php`, `api/app/Http/Controllers/Api/AuthController.php`, test.
- **Terminado cuando:** el test cubre abierto y cerrado sin autenticación.

### [x] Fase 3 — La invitación manda su token al registrarse
- **Alcance:** `auth.register()` acepta un `invitationToken` opcional y lo envía como `invitation_token`; `InviteView`
  pasa el token de la ruta. Un 403 al registrarse se muestra como error general.
- **Archivos:** `web/src/stores/auth.ts`, `web/src/views/InviteView.vue`, specs de ambos.
- **Terminado cuando:** los specs afirman que el registro desde una invitación envía el token y que el 403 se muestra.

### [x] Fase 4 — Estado del registro en la web
- **Alcance:** función `registrationStatus()` en el módulo de API de auth (o uno nuevo) y composable
  `useRegistrationStatus` que la pide una vez y la cachea; ante error de red, se trata como cerrado.
- **Archivos:** el módulo de `web/src/api/` correspondiente, `web/src/composables/useRegistrationStatus.ts` (nuevo), spec.
- **Terminado cuando:** el spec cubre abierto, cerrado, error y que una segunda llamada no repite la petición.

### [x] Fase 5 — Crear organización en el store
- **Alcance:** `api/organizations.ts` con `createOrganization(name)`. Acción `create(name)` en `stores/organization.ts`:
  POST, `load()` y `select(id)` de la nueva; devuelve la organización. Errores sin capturar (los maneja la vista).
- **Archivos:** `web/src/api/organizations.ts` (nuevo), `web/src/stores/organization.ts`, spec del store.
- **Terminado cuando:** el spec cubre éxito (queda activa) y error 422 (no cambia la activa); typecheck y tests pasan.

### [x] Fase 6 — Crear proyecto en el store
- **Alcance:** `api/projects.ts` con `createProject({name, key, description})`. Acción `create()` en `stores/projects.ts`:
  POST y `reload()` (para tener el canal en `channelByProject`); devuelve el proyecto.
- **Archivos:** `web/src/api/projects.ts` (nuevo), `web/src/stores/projects.ts`, spec del store.
- **Terminado cuando:** el spec cubre éxito (el proyecto y su canal quedan en el store) y error; typecheck y tests pasan.

### [x] Fase 7 — Vista de registro
- **Alcance:** `RegisterView` en `/register` (`meta.public`). Con el registro cerrado (`useRegistrationStatus`) muestra
  "El registro está cerrado, pide una invitación" y el enlace a login, sin formulario. Abierto: nombre, email,
  contraseña y confirmación; `auth.register()` y navegación a `/` (o a `safeRedirect` de `?redirect`, L-12). Errores
  422 por campo, 403, 429 y red como `LoginView`; vaciar contraseñas tras error de contraseña. Foco inicial en nombre.
- **Archivos:** `web/src/views/RegisterView.vue` (nuevo), `web/src/router/index.ts`, `i18n/es.json`, `i18n/en.json`,
  spec de la vista.
- **Terminado cuando:** el spec cubre registro cerrado, registro exitoso, 422 por campo con ARIA, 403, 429, red y
  redirección de un usuario ya autenticado; typecheck y tests pasan.

### [x] Fase 8 — Enlace de login a registro
- **Alcance:** en `LoginView`, enlace "¿No tienes cuenta? Regístrate" a `/register` conservando `?redirect`, solo si
  el registro está abierto.
- **Archivos:** `web/src/views/LoginView.vue`, `i18n/es.json`, `i18n/en.json`, spec.
- **Terminado cuando:** el spec afirma el enlace con el registro abierto (conservando `redirect`) y su ausencia cerrado.

### [x] Fase 9 — Diálogo para crear organización
- **Alcance:** `OrganizationCreateDialog` (campo nombre) sobre `AppDialog`, con el patrón de `TaskCreateDialog`; usa
  `organization.create()`, emite `created`, toast de éxito.
- **Archivos:** `web/src/components/OrganizationCreateDialog.vue` (nuevo), `i18n/es.json`, `i18n/en.json`, spec.
- **Terminado cuando:** el spec cubre éxito, 422 con ARIA, red y que no cierra mientras envía.

### [x] Fase 10 — Entradas para crear organización
- **Alcance:** botón "Crear organización" en el estado vacío de `AppLayout` (al crear, la vista normal aparece con la
  nueva organización) e ítem "Nueva organización" en `OrgSwitcher`. Ajustar `organization.noneHint`.
- **Archivos:** `web/src/layouts/AppLayout.vue`, `web/src/components/OrgSwitcher.vue`, `i18n/es.json`, `i18n/en.json`,
  specs de ambos.
- **Terminado cuando:** los specs cubren abrir el diálogo desde los dos lugares y que tras crear la organización se
  renderiza la vista de proyectos.

### [x] Fase 11 — Diálogo para crear proyecto
- **Alcance:** `ProjectCreateDialog`: nombre, clave (sugerida desde el nombre mientras no se edite a mano, en
  mayúsculas, validación local con la misma regex) y descripción opcional; `projects.create()`; al crear navega al
  canal del proyecto y muestra un toast. Errores 422 por campo (incluida la clave duplicada), 403 y red.
- **Archivos:** `web/src/components/ProjectCreateDialog.vue` (nuevo), `i18n/es.json`, `i18n/en.json`, spec.
- **Terminado cuando:** el spec cubre la sugerencia de clave, éxito con navegación, clave duplicada, 403 y red.

### [x] Fase 12 — Entradas para crear proyecto
- **Alcance:** botón "Nuevo proyecto" en `ProjectsView` (cabecera y estado vacío) y en el grupo Proyectos de
  `AppSidebar`, solo para owner o admin (`ProjectPolicy::create`). Para un member, el estado vacío sigue igual.
- **Archivos:** `web/src/views/ProjectsView.vue`, `web/src/components/AppSidebar.vue`, `i18n/es.json`,
  `i18n/en.json`, specs.
- **Terminado cuando:** los specs cubren que owner/admin ven el botón y abre el diálogo, y que un member no lo ve.

## Decisiones
- 2026-10-10 — El API ya expone registro, alta de organización y de proyecto; solo se agrega el interruptor de
  registro (fases 1 y 2).
- 2026-10-10 — `REGISTRATION_ENABLED` por omisión `true` (desarrollo y tests como hoy). En producción se pone en `false`
  recién cuando la fase 3 esté desplegada; antes rompería las invitaciones a personas sin cuenta.
- 2026-10-10 — Crear organización y proyecto van en diálogos (como `TaskCreateDialog`), no en rutas: `AppLayout` sin
  organizaciones no renderiza rutas hijas.
- 2026-10-10 — (Fase 1) La clave es `config('auth.registration_enabled')` (env `REGISTRATION_ENABLED`); la fase 2 lee esa
  misma clave. El 403 sale de `RegisterRequest::failedAuthorization()` con `__('Registration is closed.')`; un
  `invitation_token` o `email` que no sea string también da 403.
- 2026-10-10 — Los contenedores montan el checkout principal: en el worktree, los tests corren con `docker run` sobre la
  imagen `workspace-php`/`node:24`, montando el worktree, los volúmenes `workspace_workspace_vendor` o
  `workspace_web-node-modules` y `api/.env` del checkout principal, en la red `workspace_default`.
- 2026-10-10 — (Fase 4) `useRegistrationStatus()` devuelve `{ enabled: Ref<boolean|null>, ready: Promise<boolean> }`
  (`null` mientras carga); cachea solo éxitos a nivel de módulo y comparte la petición en vuelo; un error (red, 4xx,
  5xx) cuenta como cerrado y no se cachea. Los specs de vistas llaman `resetRegistrationStatus()` en `beforeEach` y
  usan `vi.spyOn(registration, 'registrationStatus').mockResolvedValue(...)` (módulo `web/src/api/registration.ts`).
- 2026-10-10 — (Fase 9) `OrganizationCreateDialog` usa `v-model:open` y emite `created(org)`; no lleva el watcher de
  `organization.activeId` de `TaskCreateDialog` (lo cerraría antes de tiempo, porque `create()` cambia la activa).
- 2026-10-10 — (Fase 10) `AppLayout` es el único dueño de `OrganizationCreateDialog`; `OrgSwitcher` emite `create` y
  `AppSidebar` lo reenvía como `createOrganization` (se tocó `AppSidebar.vue`, fuera de la lista del plan). Al abrir el
  diálogo se cierra el cajón móvil (L-23). La fase 12 puede seguir el mismo patrón para `ProjectCreateDialog`.
- 2026-10-10 — (Fase 11) `ProjectCreateDialog` usa `v-model:open`, emite `created(project)` y `useRouter()`; tras crear
  navega a `{name:'channel'}` si `channelByProject[id]` existe, si no a `{name:'projects'}`.
- 2026-10-10 — (Fase 12) `AppLayout` es el único dueño de `ProjectCreateDialog` y hace
  `provide(openProjectCreateKey, fn)` (`composables/useProjectCreate.ts`); `ProjectsView` lo toma con
  `useOpenProjectCreate()` (no-op sin provider) y `AppSidebar` emite `createProject`. Getter nuevo
  `organization.canCreateProject` (`isOwner || isAdmin`). Botones `create-project` y `create-project-empty`.

## Notas para la próxima sesión
- Fase 1 hecha: con el registro cerrado, registrarse exige una invitación usable del mismo email, pero no la acepta.
- Fase 2 hecha: `GET /api/auth/registration` público devuelve `{"enabled": bool}`.
- Fase 3 hecha: `auth.register(name, email, password, passwordConfirmation, invitationToken?)` envía
  `invitation_token` solo si viene. Desde aquí `REGISTRATION_ENABLED=false` en producción ya no rompe invitaciones.
- Fase 4 hecha: `registrationStatus()` y `useRegistrationStatus` listos para las fases 7 y 8.
- Fase 5 hecha: `organization.create(name)` (POST, `reloadSettled()`, `select`); con `clear()` en medio no repuebla
  pero devuelve la creada.
- Fase 6 hecha: `projects.create(input)` hace POST y `await reload()` y devuelve el proyecto; si la recarga falla no
  lanza (queda `projects.failed`). La fase 11 debe contemplar que el canal no esté en `channelByProject`.
- Fase 7 hecha: `RegisterView` en `/register` (nombre de ruta `register`); el 403 usa `register.closedError`; con el
  estado `null` no muestra nada. La fase 8 apunta el enlace a `{ name: 'register', query: { redirect } }`.
- Fase 8 hecha: enlace `login.noAccount` en `LoginView`, solo con `enabled === true`.
- Fase 9 hecha: `OrganizationCreateDialog` (claves `orgCreate.*`). Desde el estado vacío de `AppLayout`, la vista
  normal aparece sola porque `create()` selecciona la nueva.
- Fase 10 hecha: botón `create-organization` en el estado vacío e ítem "Nueva organización" en `OrgSwitcher`.
- Fase 11 hecha: `ProjectCreateDialog` (claves `projCreate.*`). La fase 12 lo monta en un único dueño, como la 10.
- Fase 12 hecha: botón "Nuevo proyecto" en `ProjectsView` (cabecera y vacío) y en la barra lateral, solo owner/admin.
  El layout de los botones nuevos no se revisó en el navegador (L-22).
- Editar con Edit o `sed`: escribir con Python en Windows mete CRLF y rompe Pint (`line_ending`).
- Verificación web: `docker compose exec web npm run typecheck` y `docker compose exec web npm run test -- --run <spec>`.

## Mejoras propuestas
- [ ] M-1 (media, sonnet) — `api/app/Http/Requests/Auth/RegisterRequest.php`: con el registro cerrado, exigir también
  `inviterCanStillGrantRole()` en `authorize()`; hoy una invitación cuyo invitador perdió permisos crea una cuenta que
  `accept` rechaza después (cuenta huérfana, sin fuga). Ampliar `AuthTest`.
- [ ] M-2 (baja, sonnet) — `api/.env.example` (y stacks de producción): documentar `REGISTRATION_ENABLED=true`.
- [ ] M-3 (baja, sonnet) — `RegisterRequest::authorize()`: acortar el docblock a una línea.
- [ ] M-4 (baja, sonnet) — `web/src/views/InviteView.vue`: mostrar un texto propio para el 403 al registrarse
  ("el registro está cerrado") en vez de `invite.registerFailed`, y que `InviteView.spec` afirme el texto exacto.
- [ ] M-5 (baja, sonnet) — `web/src/composables/useRegistrationStatus.ts`: que `resetRegistrationStatus()` invalide
  la petición en vuelo (generación) para que no escriba la caché después del reset.
- [ ] M-6 (baja, sonnet) — `web/src/stores/organization.spec.ts`: probar `clear()` durante la recarga posterior al
  POST de `create()` (rama `reloadSettled() === false`).
- [ ] M-7 (media, sonnet) — `web/src/stores/projects.ts`: `reload()` vacía `projects` antes de recargar, así que la
  lista (barra lateral, `ProjectsView`) parpadea al crear un proyecto; conservar la lista hasta tener la nueva.
- [ ] M-8 (media, sonnet) — `web/src/composables/useRegistrationStatus.ts` y `RegisterView`: distinguir "no se pudo
  saber" (error de red) de "cerrado"; hoy un fallo de red al cargar `/register` muestra "registro cerrado".
- [ ] M-9 (baja, sonnet) — `web/src/components/OrganizationCreateDialog.spec.ts`: probar que un cierre externo
  (`open=false` desde el padre) con `create` en curso descarta `created` y el toast; y separar en tests propios los
  casos 429, red y 500, que hoy comparten montaje.
- [ ] M-10 (baja, sonnet) — `web/src/views/ProjectsView.vue`: el botón del estado vacío va dentro de un `<p>`; pasar a
  `<div>`.
- [ ] M-11 (baja, sonnet) — `web/src/composables/useProjectCreate.ts`: `console.warn` en desarrollo si
  `useOpenProjectCreate()` cae al no-op por falta de provider.
