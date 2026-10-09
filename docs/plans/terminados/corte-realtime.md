# Plan: corte-realtime

**Objetivo:** que un miembro quitado de una organización deje de recibir en vivo los mensajes de sus canales: el API avisa por un canal privado del usuario y el cliente corta sus suscripciones de esa organización, recarga las organizaciones y sale de sus pantallas.
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz). Viene de la M-1 de `docs/plans/terminados/miembros.md`.
- Hoy hay un solo canal privado, `organizations.{organization}.channels.{channel}` (`api/routes/channels.php`, autoriza `App\Broadcasting\ChannelChannel::join`, sin `X-Organization-Id`), y un solo evento, `App\Events\MessageCreated` (`ShouldBroadcast` + `ShouldDispatchAfterCommit`, payload resuelto en el constructor porque el worker no tiene organización activa). `join()` solo se evalúa al suscribirse: el quitado sigue recibiendo `message.created` hasta reconectar.
- Quitar: `MemberController::destroy` → `Organization::removeMember` → `mutateMembership` (transacción con `lockForUpdate`). No despacha eventos.
- Reverb 1.12 no implementa `pusher:signin`; `terminate_connections` solo encuentra conexiones con `user_id`, que se rellena al unirse a un canal de presencia. No hay API para desuscribir a alguien de un canal concreto.
- Tests: `phpunit.xml` usa `BROADCAST_CONNECTION=null`; patrón en `tests/Feature/BroadcastingAuthTest.php` y `MessageBroadcastTest.php`.
- Web: `web/src/realtime/echo.ts` (`subscribeToChannel` con refcount por canal, L-28; `onReconnect`; `disconnectRealtime`; `createAuthorizer` sin header de organización), doble `web/src/test/fakeRealtimeClient.ts`. Consumidores: `ChannelView.vue`, `LogView.vue` (se van al cambiar `activeId`). `stores/auth.ts` llama a `disconnectRealtime()` en `clearSession()`. El 403 de "no perteneces" no tiene manejo global (`api/client.ts` solo trata el 401). Salir de una organización desde `MembersView` ya hace `organization.load()` y vuelve a projects (L-34).

## Fases

### [x] Fase 1 — Canal privado del usuario
- **Alcance:** canal `users.{user}` en `routes/channels.php` con su clase `App\Broadcasting\UserChannel`: solo lo autoriza el propio usuario; mismo rechazo de ids mal formados que `ChannelChannel` (L-08).
- **Archivos:** `api/routes/channels.php`, `api/app/Broadcasting/UserChannel.php` (nuevo), tests en `api/tests/Feature/BroadcastingAuthTest.php`.
- **Terminado cuando:** tests de autorizar al propio usuario (sin `X-Organization-Id`), rechazar a otro usuario, ids mal formados y 401 sin token pasan.

### [x] Fase 2 — Evento de membresía revocada
- **Alcance:** `App\Events\MembershipRevoked` (`ShouldBroadcast`, `ShouldDispatchAfterCommit`) al canal `users.{id}` del quitado, `broadcastAs` `membership.revoked`, payload `{organization_id}`. Se despacha desde `Organization::removeMember` (cubre quitar y salir); no sale si la operación lanza (último owner, no miembro).
- **Archivos:** `api/app/Events/MembershipRevoked.php` (nuevo), `api/app/Models/Organization.php`, tests en `api/tests/Feature/MembershipBroadcastTest.php` (nuevo).
- **Terminado cuando:** tests de canal, nombre y payload, que no se emite si la transacción hace rollback o lanza `LastOwnerException`, y que `changeMemberRole` no lo emite, pasan.

### [x] Fase 3 — Suscripción al canal del usuario en el cliente
- **Alcance:** en `echo.ts`, `subscribeToUser(userId, callback)` para `users.{id}` y el evento `.membership.revoked`, con el mismo refcount y la misma protección ante cliente viejo que `subscribeToChannel`; y `leaveOrganization(orgId)` que corta todas las suscripciones `organizations.{orgId}.*` del Map (para no seguir recibiendo aunque una vista no se desmonte).
- **Archivos:** `web/src/realtime/echo.ts`, `web/src/test/fakeRealtimeClient.ts` (si hace falta), `web/src/realtime/echo.spec.ts`.
- **Terminado cuando:** specs de suscribir y recibir, refcount, `leaveOrganization` que solo corta los canales de esa organización, y nada tras `disconnectRealtime`, pasan; typecheck limpio.

### [x] Fase 4 — Reacción del store a la membresía revocada
- **Alcance:** acción `organization.handleMembershipRevoked(orgId)`: llama a `leaveOrganization(orgId)` y a `load()`; si era la activa, `load()` elige otra o deja `activeId` en null. Descarta lo viejo si hubo `clear()` o una carga más nueva (L-10). Devuelve si la activa cambió, para que quien la llame decida navegar.
- **Archivos:** `web/src/stores/organization.ts`, `web/src/stores/organization.spec.ts`.
- **Terminado cuando:** specs de revocar la activa (con otra y sin otras), revocar una no activa, y `clear()` durante la carga, pasan.

### [x] Fase 5 — Conectar el aviso en la sesión [riesgo]
- **Alcance:** al tener usuario en sesión, suscribirse a `users.{id}` y soltarlo en `clearSession()`; al recibir `membership.revoked`, `handleMembershipRevoked` y, si la activa cambió, toast traducido y volver a `projects` (si no quedan organizaciones, el estado vacío de AppLayout). En `onReconnect`, recargar organizaciones para cubrir avisos perdidos. Que salir desde `MembersView` no duplique la navegación ni el toast al recibir su propio aviso. Verificación en el navegador con Reverb real: dos sesiones, quitar a una y ver que deja de recibir mensajes del canal.
- **Archivos:** `web/src/stores/auth.ts` (o un composable `web/src/realtime/useMembershipWatch.ts` montado en `AppLayout.vue`; decidir y anotar), `web/src/i18n/en.json`, `web/src/i18n/es.json`, specs.
- **Terminado cuando:** specs de recibir el aviso de la activa y de otra, logout que suelta el canal, reconexión que recarga y salida propia sin doble toast pasan, y la verificación en vivo lo confirma.
- **Riesgo:** ciclo de vida de la suscripción frente a login/logout/reconexión y choque con el flujo de salir de `MembersView`; si crece, dividir en "suscribir en la sesión" y "reaccionar al aviso".

## Decisiones
- 2026-10-08 — El corte es cooperativo: el servidor avisa y el cliente oficial deja los canales. Un cliente modificado que ignore el aviso sigue recibiendo los mensajes de los canales ya autorizados hasta reconectar (al reconectar, `/broadcasting/auth` lo rechaza). Forzarlo del lado servidor exigiría identificar el socket por usuario, y Reverb 1.12 solo lo hace con canales de presencia (ver M-1). Aprobado por el usuario.
- 2026-10-08 — El canal es por usuario (`users.{id}`), no por organización: el aviso le llega al quitado aunque ya no pueda autorizar canales de esa organización, y servirá luego para menciones y avisos personales (paso 6 del MVP).
- 2026-10-08 — Cambiar el rol no emite evento en este plan (ver M-2).
- 2026-10-08 — Fase 1: el canal se registra en el servidor como `users.{userId}`, no `users.{user}`: con `{user}` Laravel hace binding implícito porque el primer parámetro de `join()` es `$user` (el autenticado), y daba 403 al propio usuario y 500 con ids mal formados. Ningún canal del servidor usa el placeholder `{user}`. En el cliente el nombre sigue siendo `users.{id}`.
- 2026-10-08 — Fase 2: `removeMember` despacha `MembershipRevoked($userId, $organizationId)` dentro del closure de `mutateMembership`, tras el `detach`; `ShouldDispatchAfterCommit` lo retiene hasta el commit. El evento guarda solo ids.
- 2026-10-08 — Fase 3: `subscribeToChannel` y `subscribeToUser(userId, cb)` comparten el helper interno `subscribe`; el callback de `subscribeToUser` recibe el `organization_id`. `leaveOrganization(orgId)` corta los canales con prefijo `organizations.{orgId}.` y borra sus entradas del Map. El unsubscribe solo hace `leave` si su entrada sigue vigente en el Map: tras `leaveOrganization`, `disconnectRealtime` o cambio de cliente es un no-op, y no corta una suscripción nueva del mismo nombre.
- 2026-10-08 — Fase 4: `handleMembershipRevoked(orgId): Promise<boolean>` llama a `leaveOrganization` y `load()`, espera a la última carga en vuelo (`latestLoad`, por si `onReconnect` lanza otra a la vez) y devuelve `activeId !== activa previa`; devuelve false solo si hubo `clear()` (contador propio `clearCount`). Si una carga rechaza, el error se propaga: en la fase 5 quien la llame lleva `catch`.
- 2026-10-08 — Fase 5: composable `web/src/realtime/useMembershipWatch.ts` montado en `AppLayout.vue` (no en `stores/auth.ts`: necesita router, toast e i18n). Vigila `auth.user?.id` (`immediate`), suelta la suscripción al cambiar de usuario y al desmontar; `onReconnect` recarga organizaciones. Si la activa cambió: `toast.info` `organization.revoked` (o `revokedUnknown`) y `router.replace({name:'projects'})`. Salida propia: `expectOwnLeave(orgId)` (conteo por organización, liberador idempotente) que `MembersView` marca durante el DELETE; con la marca, el aviso solo llama a `leaveOrganization`. Verificado en vivo con Reverb: el quitado recibe el toast, vuelve a proyectos y deja de recibir mensajes del canal.

## Notas para la próxima sesión
- Plan completo. Datos de prueba de la verificación en vivo en la base local: usuario `rt-verify@example.test`, organización `rt-verify` y dos tokens Sanctum (`rt-a`, `rt-b`).

## Mejoras propuestas
- [ ] M-1 (alta, plan nuevo): corte forzado del lado servidor: que el cliente se una a un canal de presencia propio para que la conexión lleve `user_id` y llamar a `terminate_connections` (`Pusher::terminateUserConnections`) al quitar; el cliente reconecta y `/broadcasting/auth` rechaza la organización quitada.
- [ ] M-2 (media, sonnet): evento `membership.role_changed` al mismo canal para que la pantalla de miembros y los permisos se actualicen en vivo.
- [ ] M-3 (media, sonnet): manejo global del 403 "no perteneces a esta organización" en el cliente (recargar organizaciones), como respaldo si se perdió el aviso.
- [x] M-4 (baja, sonnet): quitar el docblock de `api/app/Broadcasting/UserChannel.php` que solo repite el nombre de la clase.
- [x] M-5 (baja, sonnet): simplificar la validación del id en `UserChannel` (`ctype_digit` y la comparación del string canónico se solapan con `FILTER_VALIDATE_INT`), cuidando que los casos de `BroadcastingAuthTest` sigan rechazados.
- [x] M-6 (baja, sonnet): en `MembershipBroadcastTest`, el test de rollback usa `Event::fake()` sin argumentos; pasar a `Event::fake([MembershipRevoked::class])` como el `beforeEach`.
- [x] M-7 (baja, sonnet): en `web/src/realtime/echo.ts`, tipar el Map de suscriptores sin el casteo `Subscriber = (value: never) => void` y sacar el prefijo de `leaveOrganization` a un helper junto a `channelName`.
- [ ] M-8 (baja, sonnet): en `useMembershipWatch`, registrar `onReconnect` dentro del watch junto a la suscripción, para que un cliente nuevo tras `disconnectRealtime` con AppLayout montado no quede sin listener; y acortar el docblock de `expectOwnLeave` a una línea.
- [ ] M-9 (baja, sonnet): `src/views/SessionErrorView.spec.ts` deja 18 "Unhandled Rejection" (`organizations.value.find is not a function` en `stores/organization.ts`): el mock devuelve una forma que no es lista; corregir el mock para que la suite quede sin errores.
- [ ] M-10 (baja, sonnet): `InvitationApiTest` "it throttles invitation preview" (línea ~386) depende del reloj: espera 60 segundos y llega 59 si las peticiones tardan más de un segundo (falla de forma estable en Docker sobre Windows). Congelar el tiempo (`$this->freezeTime()`) antes de agotar el límite. Ajeno a este plan.
