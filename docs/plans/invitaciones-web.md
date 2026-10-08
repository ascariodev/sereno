# Plan: invitaciones-web

**Objetivo:** que un owner o admin invite desde la web, que la persona invitada llegue por un enlace del correo, se registre o inicie sesión y acepte, y que el owner o admin vea y revoque las invitaciones pendientes.
**Estado:** en curso · Fase actual: 3
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

### [ ] Fase 3 — Listar invitaciones pendientes
- **Alcance:** `GET /api/invitations` (grupo `organization`) con las pendientes de la organización activa e invitador; `InvitationPolicy::viewAny` (owner y admin). `store` pasa a responder con el mismo resource.
- **Archivos:** `api/routes/api.php`, `InvitationController.php`, `InvitationPolicy.php`, `api/app/Http/Resources/InvitationResource.php` (nuevo), tests.
- **Terminado cuando:** tests de listado (solo pendientes, solo de la organización activa, member recibe 403) pasan y los de `store` siguen igual.

### [ ] Fase 4 — Revocar una invitación pendiente
- **Alcance:** `DELETE /api/invitations/{invitation}`; `InvitationPolicy::delete` (owner cualquiera; admin salvo invitaciones de rol owner).
- **Archivos:** `api/routes/api.php`, `InvitationController.php`, `InvitationPolicy.php`, tests.
- **Terminado cuando:** tests de revocar, 403 por rol, 404 de otra organización, y que el token revocado ya no se acepta, pasan.

### [ ] Fase 5 — Cliente web de invitaciones
- **Alcance:** `web/src/api/invitations.ts` con `previewInvitation`, `acceptInvitation`, `listInvitations`, `createInvitation`, `revokeInvitation`; tipos en `api/types.ts`.
- **Archivos:** `web/src/api/invitations.ts` (nuevo), `web/src/api/types.ts`, spec.
- **Terminado cuando:** el spec cubre rutas, cuerpos y errores; typecheck limpio.

### [ ] Fase 6 — Aceptar una invitación con sesión iniciada [riesgo]
- **Alcance:** ruta `/invite/:token` accesible con y sin sesión (nuevo meta en el guard). `InviteView` muestra la vista previa; con sesión y el mismo email, botón Aceptar que acepta, recarga organizaciones, selecciona la nueva y va a projects. Con otro email, lo dice y ofrece cerrar sesión. Invitación no usable: mensaje y enlace al inicio.
- **Archivos:** `web/src/router/index.ts`, `web/src/views/InviteView.vue` (nueva), `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs del guard (la ruta no redirige con ni sin sesión) y de la vista (aceptar, otro email, no usable) pasan.
- **Riesgo:** el guard actual trata igual todas las rutas públicas; cambiarlo afecta a `/login` y `/session-error`.

### [ ] Fase 7 — Registrarse o iniciar sesión desde la invitación
- **Alcance:** sin sesión, `InviteView` ofrece crear cuenta (nombre y contraseña; email fijo de la invitación) que llama a register y luego a accept, o iniciar sesión (a `/login?redirect=/invite/<token>`). `auth.register` en el store.
- **Archivos:** `web/src/views/InviteView.vue`, `web/src/stores/auth.ts`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de registro y aceptación encadenados, errores 422 por campo, y redirección del login de vuelta a la invitación pasan.

### [ ] Fase 8 — Pantalla de invitaciones pendientes
- **Alcance:** ruta `/settings/invitations` solo para owner y admin (los demás van a projects); lista email, rol, invitador y vencimiento, con Revocar (confirmación). Enlace "Invitaciones" en `UserMenu` solo para owner y admin.
- **Archivos:** `web/src/router/index.ts`, `web/src/views/InvitationsView.vue` (nueva), `web/src/components/UserMenu.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de lista, revocar, lista vacía y acceso denegado a member pasan.
- **Límite:** 5 archivos.

### [ ] Fase 9 — Diálogo para invitar
- **Alcance:** botón "Invitar" en la pantalla abre un `AppDialog` con email y rol (owner solo lo ve un owner); errores 422 por campo y 403 como mensaje; al crear, toast y la invitación aparece en la lista. Verificación visual en el navegador (L-22) de la pantalla, el diálogo y `InviteView`, en escritorio y móvil y en ambos temas.
- **Archivos:** `web/src/components/InviteDialog.vue` (nuevo), `web/src/views/InvitationsView.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de crear, errores y opciones de rol pasan, y la revisión visual no deja defectos.

## Decisiones
- 2026-10-08 — Se invita a la organización, no a un proyecto: el modelo actual no tiene permisos por proyecto.
- 2026-10-08 — Registro y aceptación desde la web se encadenan (register y luego accept) en vez de que `register` acepte un token: no toca la autenticación del API. Si accept falla, la cuenta queda creada sin organización y la vista lo informa.
- 2026-10-08 — Volver a invitar el mismo email ya reemplaza la invitación pendiente: no hace falta un endpoint de reenvío.
- 2026-10-08 — Fase 1: la clave "Your invitation token is: :token" se reemplazó por "Accept invitation" (botón). La URL usa `rtrim(frontend_url, '/')`. Producción lee el `.env` del servidor (no declara variables una a una en `docker-compose.prod.yml`): `FRONTEND_URL` se agrega en ese `.env` al desplegar.
- 2026-10-08 — Fase 2: `GET /api/invitations/{token}` responde `{data:{organization:{name}, email, role, expires_at}}` (organization es objeto anidado: tiparlo así en la fase 5). Throttle con limitador con nombre `invitation-preview` (30/min por IP) en `AppServiceProvider`, en vez de tocar `lang/*.json`: el 404 reutiliza "The invitation is invalid or has expired.".

## Notas para la próxima sesión
- Fases 1 y 2 hechas. Sigue la fase 3.
- Fases 3 y 4: la ruta pública `GET invitations/{token}` está fuera del grupo `auth:sanctum`; al agregar `GET /invitations` y `DELETE /invitations/{invitation}` cuidar el orden para que no se pisen.
- Con `APP_DEBUG` los 404 traen la traza: los tests revisan `message` con `assertJsonPath`, no `assertExactJson`.
- Pendiente del usuario: agregar `FRONTEND_URL=http://localhost:5174` a `api/.env.example` (una regla de permisos impide al agente leerlo o editarlo) y al `.env` de producción al desplegar.

## Mejoras propuestas
- [ ] M-1 (alta, plan nuevo): gestión de miembros (listar, cambiar rol, quitar), que hoy no existe en el API.
- [ ] M-2 (media, sonnet): componentes `AppInput` y `AppButton` para no copiar los estilos de `LoginView` en cada formulario.
- [ ] M-3 (baja, haiku): `InvitationController::show` carga `organization` con una consulta aparte; usar `load('organization')` o equivalente.
