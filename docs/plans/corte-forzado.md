# Plan: corte-forzado

**Objetivo:** que un miembro quitado de una organización deje de recibir sus mensajes en vivo aunque su cliente ignore el aviso: el API cierra sus conexiones en Reverb, el cliente reconecta, `/broadcasting/auth` rechaza los canales de esa organización y la web lo trata como membresía revocada.
**Estado:** en curso · Fase actual: 3
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz). Viene de la M-1 de `docs/plans/terminados/corte-realtime.md` (corte cooperativo ya hecho: evento `membership.revoked` por `private-users.{id}`, `leaveOrganization`, `useMembershipWatch`).
- Reverb 1.12: `POST /apps/{app}/users/{user}/terminate_connections` (`UsersTerminateController`) cierra los sockets cuyo `channel_data.user_id` coincide; solo lo tienen los canales de **presencia**. Un canal de presencia por socket basta para cerrar el socket entero (con sus canales privados). Corta el TCP sin código: pusher-js ve 1006, reconecta en ~1 s y re-autoriza todos los canales (`subscribeAll`).
- pusher-php-server 7.3: `Broadcast::connection('reverb')->getPusher()->terminateUserConnections($id)`; los errores son `ApiErrorException`. Timeouts por defecto de Guzzle 10/30 s (`client_options` en `config/broadcasting.php`). El API llega a Reverb por `REVERB_HOST=reverb`, puerto 8080 (`api/docker-compose.yml`).
- `channels.php` normaliza quitando `private-`/`presence-`: un canal de presencia necesita nombre propio (no `users.{userId}`, cuyo `join` devuelve bool). Tests: `phpunit.xml` usa `BROADCAST_CONNECTION=null` (sin `getPusher()`) y `QUEUE_CONNECTION=sync`; patrón de auth en `BroadcastingAuthTest`, de eventos en `MembershipBroadcastTest`.
- Web: `echo.ts` solo usa `private()`; no hay manejo de `pusher:subscription_error` (un 403 al resuscribir deja el canal muerto y en el Map). `RealtimeClient` y `fakeRealtimeClient.ts` no tienen `join`. `useMembershipWatch`: `revokeOnce` por organización, `onReconnect` hace `organization.load()` (sin toast), `organization.handleForbidden(id)` recarga y devuelve si la activa cambió.

## Fases

### [x] Fase 1 — Canal de presencia de sesión
- **Alcance:** canal `sessions.{userId}` en `routes/channels.php` con `App\Broadcasting\SessionChannel`: solo el propio usuario; `join` devuelve `['id' => $user->id]` (sin datos personales) para que Reverb guarde `user_id`. Mismo rechazo de ids que `UserChannel`.
- **Archivos:** `api/routes/channels.php`, `api/app/Broadcasting/SessionChannel.php` (nuevo), tests en `api/tests/Feature/BroadcastingAuthTest.php`.
- **Terminado cuando:** tests de `presence-sessions.{id}` para el propio usuario (respuesta con `channel_data` y `user_id`), otro usuario, ids mal formados y 401 pasan.

### [x] Fase 2 — Servicio para cerrar conexiones de un usuario [riesgo]
- **Alcance:** `App\Realtime\ConnectionTerminator` con `terminate(int $userId)`: llama a `terminateUserConnections` si la conexión de broadcasting es `reverb`/`pusher`, no hace nada con otro driver (null, log). Timeouts cortos para Reverb en `config/broadcasting.php` (`client_options`). Lanza ante error para que la cola reintente.
- **Archivos:** `api/app/Realtime/ConnectionTerminator.php` (nuevo), `api/config/broadcasting.php`, tests en `api/tests/Feature/ConnectionTerminatorTest.php` (nuevo).
- **Terminado cuando:** tests con un Pusher simulado (llamada con el id correcto), no-op con el driver null y propagación del error pasan.

### [ ] Fase 3 — Cortar al revocar la membresía
- **Alcance:** job en cola `TerminateUserConnections($userId)` despachado tras el commit al revocar (listener de `MembershipRevoked` con `ShouldHandleEventsAfterCommit`, o desde `removeMember`; decidir y anotar), con un retraso corto (~5 s) para que el evento `membership.revoked` llegue antes del corte. Idempotente: admite reintentos. Un fallo nunca rompe el DELETE.
- **Archivos:** `api/app/Jobs/TerminateUserConnections.php` (nuevo), `api/app/Listeners/...` o `api/app/Models/Organization.php`, tests en `api/tests/Feature/MembershipBroadcastTest.php`.
- **Terminado cuando:** tests de que quitar y salir encolan el job con el usuario y el retraso, que no se encola con rollback, `LastOwnerException` ni `changeMemberRole`, y que el job llama al terminador, pasan.

### [ ] Fase 4 — Unirse al canal de sesión en el cliente
- **Alcance:** `join(name)` en `RealtimeClient` y en el fake; `joinSession(userId)` en `echo.ts` para `sessions.{id}` con el mismo refcount y protección ante cliente viejo; `disconnectRealtime` lo suelta.
- **Archivos:** `web/src/realtime/echo.ts`, `web/src/test/fakeRealtimeClient.ts`, `web/src/realtime/echo.spec.ts`.
- **Terminado cuando:** specs de unirse, refcount, soltar y nada tras `disconnectRealtime` pasan; typecheck limpio.

### [ ] Fase 5 — Avisar de canales de organización rechazados
- **Alcance:** en `echo.ts`, escuchar `pusher:subscription_error` de los canales `organizations.{id}.*` y notificar con `onChannelDenied(cb)` (id de organización y estado); el canal rechazado sale del Map sin `leave` doble.
- **Archivos:** `web/src/realtime/echo.ts`, `web/src/test/fakeRealtimeClient.ts`, `web/src/realtime/echo.spec.ts`.
- **Terminado cuando:** specs de rechazo con 403 que notifica y limpia, rechazo de un canal de usuario que no notifica, y desuscripción del callback pasan.

### [ ] Fase 6 — Reaccionar al corte en la sesión [riesgo]
- **Alcance:** `useMembershipWatch` se une a `sessions.{id}` junto a `users.{id}`; `onReconnect` y `onChannelDenied` pasan por `revokeOnce(handleForbidden)` para la activa (toast y vuelta a `projects` si ya no pertenece), sin duplicar el aviso si también llega `membership.revoked`. Verificación en el navegador con Reverb real: quitar a un usuario cuyo cliente ignora el evento (p. ej. desuscribir `users.{id}` a mano) y ver que se corta el socket, `/broadcasting/auth` da 403 al reconectar, aparece el aviso y no llegan más mensajes.
- **Archivos:** `web/src/realtime/useMembershipWatch.ts`, `web/src/realtime/useMembershipWatch.spec.ts`.
- **Terminado cuando:** specs de unirse y soltar la sesión, reconexión que detecta la revocación de la activa con toast, canal rechazado que la detecta, y un solo aviso con evento más corte pasan, y la verificación en vivo lo confirma.
- **Riesgo:** orden entre evento, corte y reconexión; si crece, dividir en "unirse a la sesión" y "reaccionar a reconexión y rechazo".

## Decisiones
- 2026-10-08 — Canal de presencia aparte (`sessions.{userId}`) en vez de convertir `users.{userId}`: no cambia el canal ni los eventos del corte cooperativo ni sus tests; el costo es una suscripción más por pestaña.
- 2026-10-08 — El corte va después del aviso cooperativo (retraso de ~5 s en cola): si cortara antes, el evento podría perderse durante la reconexión. El cliente cubre el evento perdido con `onReconnect` → `handleForbidden`.
- 2026-10-08 — Sigue sin cubrir un socket que nunca se une a `sessions.{id}` (cliente modificado que lo omite): Reverb no tiene otra forma de identificar el socket. Aprobado por el usuario: se reduce a quien altere el cliente a propósito y aún así pierde todo al reconectar.

- 2026-10-08 — `ConnectionTerminator` usa la conexión de broadcasting por defecto y detecta el driver con `instanceof PusherBroadcaster` (cubre reverb y pusher); cualquier otro no hace nada. Pasa el id como string (`terminateUserConnections(string)`); Reverb compara `(string) user_id === $userId`, así que coincide.
- 2026-10-08 — Timeouts de Reverb en `client_options`: conexión 2 s y total 5 s (`REVERB_CONNECT_TIMEOUT`, `REVERB_TIMEOUT`). Afectan a todos los broadcasts a Reverb; hoy todos van por cola, así que un timeout se reintenta.

## Notas para la próxima sesión
- Fase 1 hecha: `SessionChannel::join` devuelve `['id' => $user->id]`; en el `channel_data` de Laravel `user_id` llega como string ("43"). En la verificación en vivo (fase 6) confirmar que `terminate_connections` con el id numérico encuentra el socket.
- Fase 2 hecha. En la fase 3, el job lleva `$tries` y `backoff` acordes: `terminate` lanza ante error. Tests: Pusher simulado con `Broadcast::extend` (helper `useFakePusherConnection` en `ConnectionTerminatorTest`).
- Seguir con la fase 3. Leer `docs/lecciones.md` antes. Tras cambiar jobs o listeners: `docker compose restart queue`.

## Mejoras propuestas
- [ ] M-1 (baja, sonnet): renombrar el helper global de Pest `authorizePresence` en `api/tests/Feature/BroadcastingAuthTest.php` a uno más específico (`authorizeSessionPresence`), por L-29.
- [ ] M-2 (baja, sonnet): quitar el docblock `@return array{id: int}|false` de `api/app/Broadcasting/SessionChannel.php`, que repite la firma.
- [ ] M-3 (baja, sonnet): documentar `REVERB_CONNECT_TIMEOUT` y `REVERB_TIMEOUT` en `api/.env.example`.
