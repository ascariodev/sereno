# Plan: invitaciones-web

**Objetivo:** que un owner o admin invite desde la web, que la persona invitada llegue por un enlace del correo, se registre o inicie sesión y acepte, y que el owner o admin vea y revoque las invitaciones pendientes.
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz del monorepo).
- Completa el paso 1 del MVP (núcleo): la invitación existe solo en la API (`POST /api/invitations`, `POST /api/invitations/accept`) y el correo manda el token en texto, sin enlace.
- API: `InvitationController` (store, accept), `InviteRequest` (autoriza con `Gate create` antes de validar), `InvitationPolicy::create(User, ?Role)` (owner todo; admin todo salvo owner; member nada), modelo `Invitation` (`VALID_DAYS`, `hashToken`, `findByPlainToken` sin scope, `scopePending`, `isUsable`, `inviterCanStillGrantRole`), `InvitationNotification` (encolada y cifrada), tests en `api/tests/Feature/InvitationApiTest.php`.
- `register` no acepta token; responde `{token, user}`. `GET /api/me` no trae roles: el rol en la organización activa sale de `organizationStore.active?.roles` (`GET /api/organizations`).
- No hay URL del frontend en la config del API (solo `app.url`).
- Web: guard en `web/src/router/index.ts` redirige toda ruta `meta.public` a projects si hay sesión; `/invite/:token` necesita otro meta. Patrón de formulario y errores 422 en `LoginView.vue`; no hay componentes de input ni botón. `AppDialog` para el diálogo de invitar. Tests con `vi.spyOn(api, ...)` y `createAppRouter(createMemoryHistory())` (ver `LoginView.spec.ts`).
- Textos: API en `api/lang/en.json` y `es.json` (un test exige la clave en español); web en `web/src/i18n/en.json` y `es.json`.

## Fases

### [x] Fase 1 — Enlace de aceptación en el correo
- **Alcance:** `config('app.frontend_url')` desde `FRONTEND_URL` (por defecto `http://localhost:5174`); el correo de invitación lleva un botón a `{frontend_url}/invite/{token}` y deja de mostrar el token en texto.
- **Archivos:** `api/config/app.php`, `api/.env.example`, `api/app/Notifications/InvitationNotification.php`, `api/lang/en.json`, `api/lang/es.json`, test en `InvitationApiTest.php`.
- **Terminado cuando:** un test comprueba que el `toMail` tiene la acción con la URL del frontend y el token; pint y los tests de invitaciones pasan.
- **Límite:** 5 archivos. Si el stack de producción del API declara sus variables una a una, agregar `FRONTEND_URL` ahí sería el sexto: anotarlo en Notas y hacerlo en el deploy.

### [x] Fase 2 — Vista previa pública de una invitación [riesgo]
- **Alcance:** `GET /api/invitations/{token}` sin autenticación y con throttle: si la invitación es usable, responde nombre de la organización, email, rol y vencimiento; si no, 404 con mensaje traducido (no distingue usada, vencida o inexistente).
- **Archivos:** `api/routes/api.php`, `api/app/Http/Controllers/Api/InvitationController.php`, `api/lang/en.json`, `api/lang/es.json`, tests en `InvitationApiTest.php`.
- **Terminado cuando:** tests de usable, vencida, aceptada, inexistente, invitador sin permiso y throttle pasan.
- **Riesgo:** ruta pública y lectura sin organización activa (scope global): usar `findByPlainToken` y cargar la organización quitando el scope de forma explícita.

### [x] Fase 3 — Listar invitaciones pendientes
- **Alcance:** `GET /api/invitations` (grupo `organization`) con las pendientes de la organización activa e invitador; `InvitationPolicy::viewAny` (owner y admin). `store` pasa a responder con el mismo resource.
- **Archivos:** `api/routes/api.php`, `InvitationController.php`, `InvitationPolicy.php`, `api/app/Http/Resources/InvitationResource.php` (nuevo), tests.
- **Terminado cuando:** tests de listado (solo pendientes, solo de la organización activa, member recibe 403) pasan y los de `store` siguen igual.

### [x] Fase 4 — Revocar una invitación pendiente
- **Alcance:** `DELETE /api/invitations/{invitation}`; `InvitationPolicy::delete` (owner cualquiera; admin salvo invitaciones de rol owner).
- **Archivos:** `api/routes/api.php`, `InvitationController.php`, `InvitationPolicy.php`, tests.
- **Terminado cuando:** tests de revocar, 403 por rol, 404 de otra organización, y que el token revocado ya no se acepta, pasan.

### [x] Fase 5 — Cliente web de invitaciones
- **Alcance:** `web/src/api/invitations.ts` con `previewInvitation`, `acceptInvitation`, `listInvitations`, `createInvitation`, `revokeInvitation`; tipos en `api/types.ts`.
- **Archivos:** `web/src/api/invitations.ts` (nuevo), `web/src/api/types.ts`, spec.
- **Terminado cuando:** el spec cubre rutas, cuerpos y errores; typecheck limpio.

### [x] Fase 6 — Aceptar una invitación con sesión iniciada [riesgo]
- **Alcance:** ruta `/invite/:token` accesible con y sin sesión (nuevo meta en el guard). `InviteView` muestra la vista previa; con sesión y el mismo email, botón Aceptar que acepta, recarga organizaciones, selecciona la nueva y va a projects. Con otro email, lo dice y ofrece cerrar sesión. Invitación no usable: mensaje y enlace al inicio.
- **Archivos:** `web/src/router/index.ts`, `web/src/views/InviteView.vue` (nueva), `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs del guard (la ruta no redirige con ni sin sesión) y de la vista (aceptar, otro email, no usable) pasan.
- **Riesgo:** el guard actual trata igual todas las rutas públicas; cambiarlo afecta a `/login` y `/session-error`.

### [x] Fase 7 — Registrarse o iniciar sesión desde la invitación
- **Alcance:** sin sesión, `InviteView` ofrece crear cuenta (nombre y contraseña; email fijo de la invitación) que llama a register y luego a accept, o iniciar sesión (a `/login?redirect=/invite/<token>`). `auth.register` en el store.
- **Archivos:** `web/src/views/InviteView.vue`, `web/src/stores/auth.ts`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de registro y aceptación encadenados, errores 422 por campo, y redirección del login de vuelta a la invitación pasan.

### [x] Fase 8 — Pantalla de invitaciones pendientes
- **Alcance:** ruta `/settings/invitations` solo para owner y admin (los demás van a projects); lista email, rol, invitador y vencimiento, con Revocar (confirmación). Enlace "Invitaciones" en `UserMenu` solo para owner y admin.
- **Archivos:** `web/src/router/index.ts`, `web/src/views/InvitationsView.vue` (nueva), `web/src/components/UserMenu.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de lista, revocar, lista vacía y acceso denegado a member pasan.
- **Límite:** 5 archivos.

### [x] Fase 9 — Diálogo para invitar
- **Alcance:** botón "Invitar" en la pantalla abre un `AppDialog` con email y rol (owner solo lo ve un owner); errores 422 por campo y 403 como mensaje; al crear, toast y la invitación aparece en la lista. Verificación visual en el navegador (L-22) de la pantalla, el diálogo y `InviteView`, en escritorio y móvil y en ambos temas.
- **Archivos:** `web/src/components/InviteDialog.vue` (nuevo), `web/src/views/InvitationsView.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de crear, errores y opciones de rol pasan, y la revisión visual no deja defectos.

## Decisiones
- 2026-10-08 — Se invita a la organización, no a un proyecto: el modelo actual no tiene permisos por proyecto.
- 2026-10-08 — Registro y aceptación desde la web se encadenan (register y luego accept) en vez de que `register` acepte un token: no toca la autenticación del API. Si accept falla, la cuenta queda creada sin organización y la vista lo informa.
- 2026-10-08 — Volver a invitar el mismo email ya reemplaza la invitación pendiente: no hace falta un endpoint de reenvío.
- 2026-10-08 — Fase 1: la clave "Your invitation token is: :token" se reemplazó por "Accept invitation" (botón). La URL usa `rtrim(frontend_url, '/')`. Producción lee el `.env` del servidor (no declara variables una a una en `docker-compose.prod.yml`): `FRONTEND_URL` se agrega en ese `.env` al desplegar.
- 2026-10-08 — Fase 2: `GET /api/invitations/{token}` responde `{data:{organization:{name}, email, role, expires_at}}` (organization es objeto anidado: tiparlo así en la fase 5). Throttle con limitador con nombre `invitation-preview` (30/min por IP) en `AppServiceProvider`, en vez de tocar `lang/*.json`: el 404 reutiliza "The invitation is invalid or has expired.".
- 2026-10-08 — Fase 3: `InvitationResource` = `{id, email, role, locale, invited_by: {id, name} | null, expires_at, created_at}` (envuelto en `data`; nunca el token). `invited_by` es null si el invitador fue borrado. `GET /api/invitations` sin paginar, ordenado por `created_at` e `id` desc. `store` responde 201 con el mismo resource.
- 2026-10-08 — Fase 4: `DELETE /api/invitations/{invitation}` responde 204 sin cuerpo y borra la fila (`revokeInvitation` no espera JSON). Aceptada o vencida: 404 con "The invitation is invalid or has expired.". Otra organización: 404 por el binding con scope. `InvitationPolicy::delete` delega en `create` con el rol de la invitación.
- 2026-10-08 — Fase 5: `web/src/api/invitations.ts` exporta `previewInvitation(token, signal?)`, `acceptInvitation(token)` (→ `{organization_id}`), `listInvitations(signal?)`, `createInvitation(email, role)`, `revokeInvitation(id)` (void), todas con `data` desenvuelto. Tipos `InvitationRole`, `Invitation`, `InvitationPreview`, `AcceptedInvitation` en `api/types.ts`. Errores del API: preview 404 si no es usable; accept 422 si inválida/vencida/invitador sin permiso y 403 si el email no coincide.
- 2026-10-08 — Fase 6: meta `anySession: true` en `/invite/:token`. Sin sesión entra; con sesión pasa por `fetchMe` como ruta privada (5xx a `session-error?redirect=...`; 401 queda en la invitación sin sesión). `whileLoadingSession(router, fn)` en `redirectToLogin.ts` suspende la redirección del handler global de 401 mientras el guard carga la sesión (para cualquier ruta; el guard decide). InviteView compara emails sin distinguir mayúsculas; al aceptar hace `organization.load()` + `select(id)`, toast y projects (si `load` falla, `clear()` y guarda el id en `ORGANIZATION_STORAGE_KEY`). Errores de accept: 422 no usable, 403 otro email, 401 `invite.sessionExpired` con enlace a `/login?redirect=/invite/<token>`. Con otro email ofrece cerrar sesión y queda en la vista previa sin sesión.
- 2026-10-08 — Fase 7: `auth.register(name, email, password, passwordConfirmation)` (envía `password_confirmation`; guarda token, user y locale como `login`). Sin sesión, InviteView muestra registro (email de solo lectura) y un enlace a `/login?redirect=<fullPath>`. Tras registrar llama a `accept()`; si falla, queda el botón Aceptar con "cuenta creada, aún no te uniste" (422: "no usable" + "cuenta creada, no se pudo aceptar"). Si el registro termina tras desmontar o cambiar de token, la sesión queda iniciada sin aceptar. Se tocaron 7 archivos (specs extra de `auth` y `LoginView` por L-25).
- 2026-10-08 — Fase 8: el acceso a `/settings/invitations` (name `invitations`, hija de AppLayout) se resuelve en la vista, no en el guard: AppLayout solo renderiza el RouterView con organización activa, y un `watch` inmediato sobre `[activeId, canManage]` carga la lista o hace `router.replace` a projects sin llamar a la API. `canManage` sale de `organization.active?.roles` (duplicado en UserMenu y la vista). Un admin no ve Revocar en invitaciones de rol owner. Revocar: 404 saca la fila y avisa; 403 y otros dejan la fila con toast. Roles reutilizan `invite.roles.*`.
- 2026-10-08 — Fase 9: `InviteDialog` (`v-model:open`, prop `isOwner`, emite `created`); rol con `<select>` nativo, por defecto member, owner solo para owner. Al crear, la vista pone la nueva arriba y quita la pendiente del mismo email. Revisión visual hecha por el coordinador en el navegador (escritorio claro y móvil oscuro), con flujo real: crear, 422, otro email, registro + aceptar, invitación usada y member redirigido. Sin defectos.

## Notas para la próxima sesión
- Plan terminado.
- En la revisión visual, el correo enlazó a `http://localhost:3000/invite/...`: el `api/.env` local parece tener `FRONTEND_URL` (o equivalente) en 3000; conviene ponerlo en `http://localhost:5174`.
- Con `APP_DEBUG` los 404 traen la traza: los tests revisan `message` con `assertJsonPath`, no `assertExactJson`.
- Pendiente del usuario: agregar `FRONTEND_URL=http://localhost:5174` a `api/.env.example` (una regla de permisos impide al agente leerlo o editarlo) y al `.env` de producción al desplegar.

## Mejoras propuestas
- [ ] M-1 (alta, plan nuevo): gestión de miembros (listar, cambiar rol, quitar), que hoy no existe en el API.
- [ ] M-2 (media, sonnet): componentes `AppInput` y `AppButton` para no copiar los estilos de `LoginView` en cada formulario.
- [x] M-3 (baja, haiku): `InvitationController::show` carga `organization` con una consulta aparte; usar `load('organization')` o equivalente.
- [x] M-4 (baja, haiku): test de que un admin que lista ve también las invitaciones de rol owner.
- [ ] M-5 (media, sonnet): paginar `GET /api/invitations` si el volumen crece.
- [x] M-6 (baja, haiku): `InvitationPolicy::delete` falla cerrado si `Role::tryFrom` devuelve null (hoy un admin pasaría con un rol inválido en BD).
- [x] M-7 (baja, haiku): test unitario de `whileLoadingSession` que compruebe que libera el bloqueo cuando la función lanza.
- [ ] M-8 (baja, haiku): `InviteView.spec` lee `loadError` desde `vm` de la vista desmontada; afirmar por el DOM o por una señal pública para no depender del acceso a `script setup`.
- [x] M-9 (baja, haiku): en InviteView, un 422 de register en `email` (ya registrado) muestra solo el mensaje del API; agregar un texto que lleve a "Iniciar sesión".
- [x] M-10 (baja, haiku): unificar `role="alert"`/`role="status"` en los avisos de "cuenta creada" de InviteView, y usar una key con índice en los `v-for` de errores.
- [x] M-11 (baja, haiku): mover `canManageInvitations` a `organizationStore` para quitar el duplicado entre UserMenu e InvitationsView.
- [ ] M-12 (baja, haiku): en InvitationsView, el 404 al revocar (ya no existe) muestra un toast informativo, no de error; y limpiar `pending` en la rama que redirige a projects.
- [ ] M-13 (baja, haiku): deshabilitar el botón Invitar mientras la lista carga, para que `load` no pise una invitación recién creada.
- [ ] M-14 (baja, haiku): estilo destructivo (rojo) en el botón "Revocar invitación" del diálogo de confirmación.
- [ ] M-15 (baja, haiku): `LoginView.vue` usa `:key="message"` en los `v-for` de errores; pasar a `${index}-${message}` como InviteView.
