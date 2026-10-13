# Plan: notificaciones-push

**Objetivo:** que las notificaciones de Sereno (tarea asignada, comentario o mención en tarea, mención en el chat) lleguen
como Web Push a la PWA instalada o al navegador, con preferencias por tipo, sin duplicar lo que ya muestra la app abierta.
**Estado:** en curso · Fase actual: 3
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/` (commits con `git` en la raíz). Viene de M-2 del plan `terminados/notificaciones.md`.
- API: los 4 tipos (`App\Enums\NotificationType`) son `ShouldQueue` y pasan por `Notifications/Channels/AppChannel.php`, que
  hace `insertOrIgnore` por uuid, revalida con `RevalidatesAfterInsert::stillApplies` (borra la fila si ya no aplica) y solo
  si insertó emite `NotificationCreated`. El push se engancha ahí, después del insert válido, nunca como canal en `via()`.
- Preferencias: `users.notification_preferences` jsonb `{"email": {"<type>": bool}}`, tipo ausente = encendido;
  `User::wantsEmail()`, `GET|PATCH /api/me/notification-preferences` (`AuthController`,
  `Http/Requests/Auth/UpdateNotificationPreferencesRequest.php`).
- URLs de destino: hoy inline en cada `toMail` sobre `config('app.frontend_url')` (tareas `/projects/{p}/plan?task={t}&organization={o}`,
  chat `/channels/{c}?message={m}|thread={parent}&organization={o}`); la web repite la lógica en `NotificationsView.vue` `target()`.
- Web: PWA con plugin propio (`web/pwa/serviceWorkerPlugin.ts` inyecta en `web/pwa/sw.js`, emitido como `/sw.js` solo en
  build); registro en `web/src/pwa/serviceWorker.ts` solo en PROD. Preferencias en `components/NotificationPreferencesDialog.vue`
  (desde `UserMenu.vue`), API en `src/api/notificationPreferences.ts`, i18n en `src/i18n/{en,es}.json`.
- Dependencias / restricciones: `minishlink/web-push` ^11 (solo `ext-openssl`); `api/.env.example` lo edita el usuario (L-52);
  Web Push exige HTTPS o localhost; en dev no hay service worker (verificación con build de producción local).
- Lecciones clave: L-70, L-74, L-77 (decisiones en el worker, sin `Notification::fake`), L-76 (listeners after-commit).

## Fases

### [x] Fase 1 — Dependencia y claves VAPID [riesgo]
- **Alcance:** `composer require minishlink/web-push:^11`; config `workspace.push` (`vapid_public_key`, `vapid_private_key`,
  `vapid_subject`) desde env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); comando artisan que genera un par de
  claves con la librería y lo imprime (no escribe el `.env`). Verificar en el contenedor que la librería carga sin `gmp`;
  si su rendimiento lo pide, sumar `gmp` al Dockerfile y anotarlo en Decisiones.
- **Archivos:** `api/composer.json`, `api/composer.lock`, `api/config/workspace.php`, `api/app/Console/Commands/GenerateVapidKeys.php`
  (+ `api/docker/php/Dockerfile` solo si hace falta `gmp`).
- **Terminado cuando:** test del comando (imprime dos claves base64url válidas) y de la config; pide al usuario las variables
  para `.env` y `.env.example`.

### [x] Fase 2 — Tabla de suscripciones push
- **Alcance:** migración `push_subscriptions` (por usuario y dispositivo, sin `organization_id`: no es dato de negocio):
  `user_id`, `endpoint` (único), `public_key`, `auth_token`, `content_encoding`, `user_agent`, `last_used_at`, timestamps.
  Modelo `PushSubscription`, `User::pushSubscriptions()` (hasMany, cascada al borrar el usuario). Documentar en `database.md`.
- **Archivos:** migración, `api/app/Models/PushSubscription.php`, `api/app/Models/User.php`, factory, `.claude/rules/database.md`.
- **Terminado cuando:** migra y revierte limpio; test del modelo y de la cascada.

### [ ] Fase 3 — Endpoints de suscripción
- **Alcance:** `GET /api/push/vapid-public-key` (autenticado), `POST /api/me/push-subscriptions` (alta o actualización por
  `endpoint`; si el endpoint era de otro usuario, pasa al actual), `DELETE /api/me/push-subscriptions` (por `endpoint`, solo
  el propio). Sin header de organización. Textos por `__()`.
- **Archivos:** `api/app/Http/Controllers/PushSubscriptionController.php`, request de alta, `api/routes/api.php`, `lang/{en,es}.json`.
- **Terminado cuando:** tests de alta, re-alta idempotente, cambio de dueño, baja ajena rechazada y validación.

### [ ] Fase 4 — Preferencias push por tipo
- **Alcance:** clave `push` en `notification_preferences` (tipo ausente = encendido), `User::wantsPush()`, el PATCH acepta y
  mergea `push` además de `email`, el GET lo devuelve completo.
- **Archivos:** `api/app/Models/User.php`, `UpdateNotificationPreferencesRequest.php`, `AuthController.php`.
- **Terminado cuando:** tests de GET, PATCH parcial de `push` sin pisar `email` y validación `boolean:strict`.

### [ ] Fase 5 — URL de destino única
- **Alcance:** extraer la URL de destino de cada tipo a un solo lugar que trabaje desde la fila `AppNotification` (type + data
  + organización), y que los `toMail` la usen. Refactor sin cambio de comportamiento.
- **Archivos:** `api/app/Support/NotificationUrl.php` (o similar), `TaskCommentNotification.php`, `TaskAssignedNotification.php`,
  `ChatMentionNotification.php`.
- **Terminado cuando:** los tests de mail existentes pasan sin cambios y hay tests unitarios de la URL por tipo (hilo y mensaje suelto en chat).

### [ ] Fase 6 — Contenido del push
- **Alcance:** armar desde la fila `AppNotification` y el usuario el payload JSON del push: título y cuerpo con `__()` en el
  locale del usuario (mismos textos que el mail; extracto del mensaje o comentario), `url` (fase 5), `tag` por sujeto para
  agrupar, y el uuid. Contenido escrito por personas sin traducir.
- **Archivos:** `api/app/Support/PushPayload.php` (o similar), `lang/{en,es}.json`.
- **Terminado cuando:** tests por tipo y por locale (`en`/`es`), con límite de tamaño del payload.

### [ ] Fase 7 — Envío del push [riesgo]
- **Alcance:** job en cola despachado por `AppChannel` solo cuando insertó y la fila sigue en pie. En el worker: la fila
  existe y no está leída, `wantsPush(type)`, y envía a cada suscripción del usuario con un envoltorio propio de la librería
  (ligable a un fake en tests); borra las suscripciones que responden expiradas (404/410) y actualiza `last_used_at`. Sin
  suscripciones no hace nada. Fallos de red: reintento de la cola, sin romper el insert.
- **Archivos:** `api/app/Jobs/SendPushNotification.php`, `api/app/Support/WebPushSender.php` (+ interfaz o binding),
  `AppChannel.php`, `AppServiceProvider.php`.
- **Terminado cuando:** tests con el fake: envío a todas las suscripciones, nada si está leída, borrada o con `push` apagado,
  limpieza de expiradas; y que `AppChannel` no lo despacha si `stillApplies` borró la fila (mutación que lo valide).

### [ ] Fase 8 — Service worker: mostrar y abrir [riesgo]
- **Alcance:** en `web/pwa/sw.js`, handler `push` que muestra la notificación (título, cuerpo, ícono, `tag`, url en `data`)
  salvo que haya una ventana de Sereno enfocada; `notificationclick` que enfoca una ventana existente y navega a la url, o
  abre una nueva. Extraer la lógica a funciones testeables si `sw.js` no se puede probar tal cual.
- **Archivos:** `web/pwa/sw.js` (+ módulo auxiliar y `serviceWorkerPlugin.ts` si hace falta).
- **Terminado cuando:** specs de los handlers con `self`/`clients` simulados (enfocada: no muestra; click: enfoca o abre).

### [ ] Fase 9 — Suscripción del dispositivo en la web
- **Alcance:** `src/pwa/push.ts`: soporte (`PushManager`, SW registrado), pedir permiso, suscribir con la clave VAPID del
  API, enviar la suscripción, darse de baja; en el logout borra la suscripción del API antes de perder el token.
  `src/api/pushSubscriptions.ts`.
- **Archivos:** `web/src/pwa/push.ts`, `web/src/api/pushSubscriptions.ts`, store o acción de logout, `web/src/api/types.ts`.
- **Terminado cuando:** specs con `PushManager` y `Notification` simulados: alta, permiso denegado, sin soporte, baja en logout.

### [ ] Fase 10 — Preferencias push en la UI
- **Alcance:** en `NotificationPreferencesDialog`, activar o desactivar push en este dispositivo (estado del permiso, aviso si
  está bloqueado o sin soporte) y una columna push por tipo junto a la de email. i18n `en`/`es`.
- **Archivos:** `NotificationPreferencesDialog.vue`, `web/src/api/notificationPreferences.ts`, `web/src/i18n/{en,es}.json`.
- **Terminado cuando:** specs del diálogo (toggle por tipo envía `push`, activar dispositivo llama a la fase 9, estados sin soporte o bloqueado).

### [ ] Fase 11 — Verificación de punta a punta y documentación
- **Alcance:** con build de producción local de la web y claves VAPID de desarrollo: suscribir, recibir push con la app en
  segundo plano, no recibirlo con la app enfocada, click que abre la tarea o el mensaje. Actualizar CLAUDE.md (Orden del MVP,
  variables) y el deploy (variables VAPID en producción las carga el usuario).
- **Archivos:** `CLAUDE.md`, `api/CLAUDE.md` o `web/CLAUDE.md` si corresponde.
- **Terminado cuando:** recorrido manual hecho y anotado; docs actualizadas.

## Decisiones
- 2026-10-13 — Librería `minishlink/web-push` directa, sin `laravel-notification-channels/webpush` — tabla y job propios, y
  el push sale después de que `AppChannel` guardó una fila válida (respeta `stillApplies` y la deduplicación).
- 2026-10-13 — Preferencias push por tipo encendidas por defecto (tipo ausente = encendido, como el email) — el permiso del
  navegador ya es opt-in por dispositivo.
- 2026-10-13 — Con una ventana de Sereno enfocada, el service worker no muestra el push — la bandeja en vivo ya lo muestra.
- 2026-10-13 — Solo Web Push; el push móvil (Expo) va con la app móvil (`app/` no existe todavía).
- 2026-10-13 — `push_subscriptions` sin `organization_id`: es del usuario y su dispositivo, no de una organización; el payload
  lleva la organización en la url.
- 2026-10-13 — Sin `gmp` en el Dockerfile: `minishlink/web-push` v11 genera claves y cifra con `ext-openssl` y `bcmath`
  (presentes); `gmp` es opcional de rendimiento.
- 2026-10-13 — `push_subscriptions`: `public_key` y `auth_token` ocultos en la serialización (`#[Hidden]`);
  `content_encoding` por defecto `aes128gcm`; índice en `user_id` además de la FK en cascada.
- 2026-10-13 — Comando `php artisan push:vapid-keys` imprime las líneas `VAPID_*` para el `.env`, no escribe archivos.
  `workspace.push.vapid_subject` no tiene valor por defecto: la fase 7 debe no enviar (y reportar claro) si falta alguna
  de las tres variables.

## Notas para la próxima sesión
- Fase 3: `PushSubscription` no tiene `user_id` en fillable; el alta va con `$user->pushSubscriptions()->updateOrCreate(['endpoint' => ...], ...)`
  y el cambio de dueño asigna `user_id` explícito. Validar longitudes: `public_key` y `auth_token` `max:255`, `user_agent`
  `max:512`, `endpoint` URL https acotada (es `text` único), `content_encoding` en `aes128gcm|aesgcm`.
- Fase 1 hecha. Pendiente del usuario: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (de `push:vapid-keys`) y `VAPID_SUBJECT`
  (`mailto:...`) en `api/.env` y los tres nombres en `api/.env.example`; luego `docker compose restart api queue reverb scheduler`.
- Ejecución en worktree (`.claude/worktrees/notificaciones-push`): los contenedores montan el checkout principal, así que
  los tests del API corren en un contenedor desechable con el api del worktree montado (volumen `workspace_workspace_vendor`,
  red `workspace_default`, `.env` principal montado solo lectura). El vendor compartido ya tiene `minishlink/web-push`:
  no correr `composer install` en el checkout principal antes del merge.

## Mejoras propuestas

- [ ] M-1 (baja, sonnet): `GenerateVapidKeysCommandTest` guarda y restaura las variables de entorno a mano; un helper
  compartido de tests lo simplificaría.
- [ ] M-2 (baja, sonnet): anotar en `database.md` que `push_subscriptions.endpoint` es `text` con índice único (endpoints largos).
