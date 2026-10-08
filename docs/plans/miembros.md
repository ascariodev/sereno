# Plan: miembros

**Objetivo:** que cualquier miembro vea quién está en la organización, que owner y admin cambien roles y quiten miembros según su rango, y que cualquiera pueda salir de la organización, sin que la organización se quede nunca sin owner.
**Estado:** en curso · Fase actual: 8
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz del monorepo). Viene de la M-1 de `docs/plans/terminados/invitaciones-web.md`. Completa el paso 1 del MVP (núcleo).
- Membresía: pivote `organization_user` (sin rol). El rol vive en `model_has_roles.organization_id` (team de spatie). `Organization::addMember` cambia el team y lo restaura en un `finally` (L-03); mismo patrón en `Invitation::inviterCanStillGrantRole`. `ResolveOrganization` valida la membresía en cada request (403 si no pertenece). Enum `App\Enums\Role` (owner, admin, member).
- Nada garantiza hoy al menos un owner. No hay soft deletes. Quitar a alguien del pivote no borra sus filas de `model_has_roles` de esa organización: hay que hacerlo a mano.
- Referencias: reglas en `InvitationPolicy` (owner todo; admin todo salvo owner; member nada); patrón de controlador en `InvitationController` (`Gate::authorize`, `DB::transaction` + `lockForUpdate`, `noContent()`); FormRequest que autoriza antes de validar (L-04). Tests en `api/tests/Feature/` (`OrganizationModelTest`, `InvitationApiTest`, `TenantTest`).
- Al quitar un miembro: sus tokens siguen (son por usuario) pero el middleware ya le responde 403; sus mensajes se conservan; sus invitaciones pendientes quedan inválidas solas (`inviterCanStillGrantRole`). Una suscripción Reverb ya autorizada no se corta.
- Web: patrón de pantalla en `InvitationsView.vue` (watch de `[activeId, permiso]`, `AppDialog` de confirmación, toasts por status), cliente en `web/src/api/invitations.ts`, getters `isOwner` y `canManageInvitations` en `organizationStore`, entrada en `UserMenu`, ruta `settings/invitations`.

## Fases

### [x] Fase 1 — Listar miembros
- **Alcance:** `GET /api/members` (grupo `organization`) con los miembros de la organización activa: `{id, name, email, role, joined_at}`, ordenados por nombre. Cualquier miembro puede listar. Decidir aquí dónde viven las reglas de miembros (policy propia o `Gate::define`) y anotarlo en Decisiones.
- **Archivos:** `api/routes/api.php`, `api/app/Http/Controllers/Api/MemberController.php` (nuevo), `api/app/Http/Resources/MemberResource.php` (nuevo), `api/app/Policies/MemberPolicy.php` (nuevo, o el registro de Gates), tests en `api/tests/Feature/MemberApiTest.php` (nuevo).
- **Terminado cuando:** tests de listado (solo miembros de la organización activa, rol correcto por organización, sin N+1, 403 de organización ajena, 401 sin sesión) pasan.

### [x] Fase 2 — Operaciones de membresía en el modelo [riesgo]
- **Alcance:** `Organization::changeMemberRole(User, Role)` y `Organization::removeMember(User)`: cambian o borran el rol del team (restaurando el team en `finally`, L-03) y el pivote, en transacción con lock sobre las membresías de la organización; si la operación deja la organización sin owner, lanzan una excepción de dominio con mensaje traducido (422).
- **Archivos:** `api/app/Models/Organization.php`, `api/app/Exceptions/LastOwnerException.php` (nuevo), `api/lang/en.json`, `api/lang/es.json`, tests en `OrganizationModelTest.php`.
- **Terminado cuando:** tests de cambiar rol, quitar (pivote y `model_has_roles` de esa organización, sin tocar otras), último owner bloqueado al degradar y al quitar, y team restaurado incluso si lanza, pasan.
- **Riesgo:** concurrencia (dos owners se degradan a la vez); el lock debe cubrir el conteo de owners.

### [x] Fase 3 — Endpoint para cambiar el rol
- **Alcance:** `PATCH /api/members/{user}` con `{role}`. Owner cambia a cualquiera a cualquier rol; admin solo entre admin y member y nunca a un owner; member nada. 404 si el usuario no es miembro de la organización activa.
- **Archivos:** `api/routes/api.php`, `MemberController.php`, `api/app/Http/Requests/Member/UpdateMemberRoleRequest.php` (nuevo), `MemberPolicy.php`, tests.
- **Terminado cuando:** tests por combinación de rol (owner, admin, member, sobre sí mismo), 404 de usuario ajeno, 422 de último owner y respuesta con `MemberResource` pasan.

### [x] Fase 4 — Endpoint para quitar un miembro o salir
- **Alcance:** `DELETE /api/members/{user}` (204). Owner quita a cualquiera; admin quita admins y members, no owners; cualquiera puede quitarse a sí mismo (salir). 422 si deja la organización sin owner.
- **Archivos:** `api/routes/api.php`, `MemberController.php`, `MemberPolicy.php`, tests.
- **Terminado cuando:** tests de quitar por rol, salir, último owner, que el quitado recibe 403 en la siguiente petición y que sus invitaciones pendientes ya no se aceptan, pasan.

### [x] Fase 5 — Cliente web de miembros
- **Alcance:** `web/src/api/members.ts` con `listMembers`, `updateMemberRole`, `removeMember`; tipo `Member` en `api/types.ts` leído del Resource (L-09).
- **Archivos:** `web/src/api/members.ts` (nuevo), `web/src/api/types.ts`, spec.
- **Terminado cuando:** el spec cubre rutas, cuerpos y errores (403, 404, 422, 204); typecheck limpio.

### [x] Fase 6 — Pantalla de miembros
- **Alcance:** ruta `/settings/members` para cualquier miembro; lista nombre, email, rol y fecha de ingreso, marcando "tú". Entrada "Miembros" en `UserMenu` para todos.
- **Archivos:** `web/src/router/index.ts`, `web/src/views/MembersView.vue` (nueva), `web/src/components/UserMenu.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de lista, error con reintento, cambio de organización activa (L-10) y entrada del menú pasan.
- **Límite:** 5 archivos.

### [x] Fase 7 — Cambiar el rol desde la pantalla
- **Alcance:** selector de rol por fila solo donde la regla lo permite (mismas reglas que la fase 3, como getters del store); 422 de último owner como mensaje; si cambia el propio rol, recargar organizaciones (`organization.load()`) y la pantalla se adapta.
- **Archivos:** `web/src/views/MembersView.vue`, `web/src/stores/organization.ts`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de opciones por rol, cambio con éxito, 422 y degradarse a sí mismo pasan.

### [ ] Fase 8 — Quitar un miembro o salir desde la pantalla [riesgo]
- **Alcance:** "Quitar" por fila y "Salir de la organización" en la fila propia, con confirmación (`AppDialog`). Al salir: recargar organizaciones, seleccionar otra y volver a projects; si no queda ninguna, el estado que muestre AppLayout sin organizaciones. Verificación visual en el navegador (L-22) de la pantalla y los diálogos, en escritorio y móvil y en ambos temas.
- **Archivos:** `web/src/views/MembersView.vue`, `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de quitar, salir con otra organización, salir sin otras, 422 de último owner y cancelar pasan, y la revisión visual no deja defectos.
- **Riesgo:** no está explorado cómo se comporta AppLayout con cero organizaciones; si hace falta tocarlo, dividir la fase.

## Decisiones
- 2026-10-08 — Cualquier miembro puede listar miembros (lo necesitarán las menciones del chat); cambiar roles y quitar sigue el rango de `InvitationPolicy`.
- 2026-10-08 — Un miembro tiene un solo rol por organización: cambiar el rol reemplaza el anterior.
- 2026-10-08 — Salir de la organización es el mismo `DELETE` sobre uno mismo; el último owner no puede salir ni degradarse.
- 2026-10-08 — Las reglas de miembros viven en `MemberPolicy`, registrada con `Gate::policy(User::class, ...)` (el objetivo es un `User`; no existe `UserPolicy`). Hoy solo `viewAny` (cualquier rol de la organización activa); las fases 3 y 4 añaden `updateRole(actor, target, Role)` y `remove(actor, target)`. `MemberResource` toma el rol de `roles->first()?->name` (el eager load ya filtra por team) y `joined_at` de `pivot->created_at`.
- 2026-10-08 — `Organization::changeMemberRole/removeMember` toman `lockForUpdate` sobre la fila de `organizations` (serializa toda mutación de membresía) antes de contar owners; `addMember` no lo toma. Usuario no miembro: `ModelNotFoundException` (404). `LastOwnerException` se renderiza sola como 422 traducido: los controladores no la capturan. `changeMemberRole` usa `syncRoles` (reemplaza el rol).
- 2026-10-08 — `MemberPolicy::updateRole(actor, target, ?Role)`: owner todo; admin solo si el target no es owner y el rol pedido no es owner; member nada (403 antes de saber si el target existe). Owner/admin sobre un no miembro reciben 404.
- 2026-10-08 — `MemberPolicy::remove(actor, target)`: quien se quita a sí mismo siempre pasa; owner quita a cualquiera; admin no quita owners; member nada. El 422 de último owner y el 404 de no miembro los da el modelo. `DELETE` responde 204.
- 2026-10-08 — Web: `Member = {id, name, email, role: InvitationRole | null, joined_at: string | null}`; `joined_at` es ISO 8601 UTC con Z (verificado). Firmas: `listMembers(signal?)`, `updateMemberRole(id, role)`, `removeMember(id)`.
- 2026-10-08 — Web: ruta `members` (`/settings/members`) visible para todo miembro; `MembersView` carga solo con `activeId` (generación + AbortController, L-10); "tú" = `auth.user.id === member.id`; roles con `invite.roles.*`; textos en `members.*` y `userMenu.members`; `joined_at` null se muestra "-"; fecha en zona local del navegador (intencional).
- 2026-10-08 — `organizationStore` expone `isAdmin` y `assignableRolesFor(targetRole)` (espejo de `MemberPolicy::updateRole`). `MembersView` muestra `<select>` solo si hay roles asignables; error por fila `roleError` (`role="alert"`, `aria-describedby`) con el `message` de 403/422, reutilizable para quitar; si cambia su propio rol hace `organization.load()` y revisa la generación (L-32).
- 2026-10-08 — No se cortan las suscripciones Reverb ya autorizadas del miembro quitado (queda como mejora).

## Notas para la próxima sesión
- Fases 1 a 7 hechas. Empezar por la fase 8 (riesgo): "Quitar"/"Salir" en `MembersView.vue` reutilizando `roleError` por fila y `AppDialog`; explorar AppLayout con cero organizaciones (si hay que tocarlo, dividir); verificación visual L-22. Leer `docs/lecciones.md` antes.

## Mejoras propuestas
- [ ] M-1 (alta, plan nuevo): cortar en vivo las suscripciones Reverb de un miembro quitado (requiere un canal privado por usuario u organización).
- [ ] M-2 (media, sonnet): transferir la propiedad (owner) en un paso, sin pasar por dos owners.
- [ ] M-3 (baja, sonnet): fijar `joined_at` con `toIso8601String()` en `MemberResource` y probar el formato.
- [ ] M-4 (baja, sonnet): test de que `MemberPolicy::viewAny` no concede sin team activo.
- [ ] M-5 (baja, sonnet): test de concurrencia real con dos conexiones para el lock de `mutateMembership` (hoy solo se prueba el orden del SQL).
- [ ] M-6 (baja, sonnet): en `UpdateMemberRoleRequest::authorize()`, evitar el aviso por `(string)` si `role` llega como array (usar `$this->string('role')->value()` o `is_string`).
- [ ] M-7 (baja, sonnet): en el test de invitaciones del quitado, afirmar el mensaje del 422 con `assertJsonPath`, no solo `assertUnprocessable`.
- [ ] M-8 (baja, sonnet): ordenar el import de `MembersView` en `web/src/router/index.ts` y parametrizar `mountView` en `MembersView.spec.ts` para el test de error con reintento.
- [ ] M-9 (baja, sonnet): si `organization.load()` falla tras cambiar el propio rol, no restaurar el select ni mostrar `roleFailed`: separar el `load()` en su propio try.
- [ ] M-10 (baja, sonnet): spec de L-10/L-32 para el cambio de rol: cambiar de organización con la petición en vuelo no aplica la respuesta.
