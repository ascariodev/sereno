# Plan: notificaciones-push

**Objetivo:** que las notificaciones de Sereno (tarea asignada, comentario o mención en tarea, mención en el chat) lleguen
como Web Push a la PWA instalada o al navegador, con preferencias por tipo, sin duplicar lo que ya muestra la app abierta.
**Estado:** terminado · Fase actual: —
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

### [x] Fase 3 — Endpoints de suscripción
- **Alcance:** `GET /api/push/vapid-public-key` (autenticado), `POST /api/me/push-subscriptions` (alta o actualización por
  `endpoint`; si el endpoint era de otro usuario, pasa al actual), `DELETE /api/me/push-subscriptions` (por `endpoint`, solo
  el propio). Sin header de organización. Textos por `__()`.
- **Archivos:** `api/app/Http/Controllers/PushSubscriptionController.php`, request de alta, `api/routes/api.php`, `lang/{en,es}.json`.
- **Terminado cuando:** tests de alta, re-alta idempotente, cambio de dueño, baja ajena rechazada y validación.

### [x] Fase 4 — Preferencias push por tipo
- **Alcance:** clave `push` en `notification_preferences` (tipo ausente = encendido), `User::wantsPush()`, el PATCH acepta y
  mergea `push` además de `email`, el GET lo devuelve completo.
- **Archivos:** `api/app/Models/User.php`, `UpdateNotificationPreferencesRequest.php`, `AuthController.php`.
- **Terminado cuando:** tests de GET, PATCH parcial de `push` sin pisar `email` y validación `boolean:strict`.

### [x] Fase 5 — URL de destino única
- **Alcance:** extraer la URL de destino de cada tipo a un solo lugar que trabaje desde la fila `AppNotification` (type + data
  + organización), y que los `toMail` la usen. Refactor sin cambio de comportamiento.
- **Archivos:** `api/app/Support/NotificationUrl.php` (o similar), `TaskCommentNotification.php`, `TaskAssignedNotification.php`,
  `ChatMentionNotification.php`.
- **Terminado cuando:** los tests de mail existentes pasan sin cambios y hay tests unitarios de la URL por tipo (hilo y mensaje suelto en chat).

### [x] Fase 6 — Contenido del push
- **Alcance:** armar desde la fila `AppNotification` y el usuario el payload JSON del push: título y cuerpo con `__()` en el
  locale del usuario (mismos textos que el mail; extracto del mensaje o comentario), `url` (fase 5), `tag` por sujeto para
  agrupar, y el uuid. Contenido escrito por personas sin traducir.
- **Archivos:** `api/app/Support/PushPayload.php` (o similar), `lang/{en,es}.json`.
- **Terminado cuando:** tests por tipo y por locale (`en`/`es`), con límite de tamaño del payload.

### [x] Fase 7 — Envío del push [riesgo]
- **Alcance:** job en cola despachado por `AppChannel` solo cuando insertó y la fila sigue en pie. En el worker: la fila
  existe y no está leída, `wantsPush(type)`, y envía a cada suscripción del usuario con un envoltorio propio de la librería
  (ligable a un fake en tests); borra las suscripciones que responden expiradas (404/410) y actualiza `last_used_at`. Sin
  suscripciones no hace nada. Fallos de red: reintento de la cola, sin romper el insert.
- **Archivos:** `api/app/Jobs/SendPushNotification.php`, `api/app/Support/WebPushSender.php` (+ interfaz o binding),
  `AppChannel.php`, `AppServiceProvider.php`.
- **Terminado cuando:** tests con el fake: envío a todas las suscripciones, nada si está leída, borrada o con `push` apagado,
  limpieza de expiradas; y que `AppChannel` no lo despacha si `stillApplies` borró la fila (mutación que lo valide).

### [x] Fase 8 — Service worker: mostrar y abrir [riesgo]
- **Alcance:** en `web/pwa/sw.js`, handler `push` que muestra la notificación (título, cuerpo, ícono, `tag`, url en `data`)
  salvo que haya una ventana de Sereno enfocada; `notificationclick` que enfoca una ventana existente y navega a la url, o
  abre una nueva. Extraer la lógica a funciones testeables si `sw.js` no se puede probar tal cual.
- **Archivos:** `web/pwa/sw.js` (+ módulo auxiliar y `serviceWorkerPlugin.ts` si hace falta).
- **Terminado cuando:** specs de los handlers con `self`/`clients` simulados (enfocada: no muestra; click: enfoca o abre).

### [x] Fase 9 — Suscripción del dispositivo en la web
- **Alcance:** `src/pwa/push.ts`: soporte (`PushManager`, SW registrado), pedir permiso, suscribir con la clave VAPID del
  API, enviar la suscripción, darse de baja; en el logout borra la suscripción del API antes de perder el token.
  `src/api/pushSubscriptions.ts`.
- **Archivos:** `web/src/pwa/push.ts`, `web/src/api/pushSubscriptions.ts`, store o acción de logout, `web/src/api/types.ts`.
- **Terminado cuando:** specs con `PushManager` y `Notification` simulados: alta, permiso denegado, sin soporte, baja en logout.

### [x] Fase 10 — Preferencias push en la UI
- **Alcance:** en `NotificationPreferencesDialog`, activar o desactivar push en este dispositivo (estado del permiso, aviso si
  está bloqueado o sin soporte) y una columna push por tipo junto a la de email. i18n `en`/`es`.
- **Archivos:** `NotificationPreferencesDialog.vue`, `web/src/api/notificationPreferences.ts`, `web/src/i18n/{en,es}.json`.
- **Terminado cuando:** specs del diálogo (toggle por tipo envía `push`, activar dispositivo llama a la fase 9, estados sin soporte o bloqueado).

### [x] Fase 11 — Verificación de punta a punta y documentación
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
- 2026-10-13 — Endpoints push en `Http/Controllers/Api/PushSubscriptionController.php` y `Http/Requests/Push/`, como el
  resto del repo. La baja ajena o inexistente da el mismo 404 desde `authorize()` (L-72). Una re-alta sin
  `content_encoding` conserva el existente.
- 2026-10-13 — El PATCH de preferencias ya no exige `email`: basta `email` o `push` (`required_without` cruzado); la web
  actual, que solo manda `email`, sigue igual.
- 2026-10-13 — Payload push: título = asunto del mail (misma clave `__()`, locale del usuario), cuerpo = texto humano sin
  traducir (`task_title`, `comment_excerpt`, `message_excerpt`), `tag` `task-{id}` o `channel-{id}`; tope de 3000 bytes
  recortando solo el cuerpo por caracteres.
- 2026-10-13 — Envío push: `AppChannel` despacha el job en `DB::afterCommit` (corre al momento sin transacción) con
  try/catch y `report`, solo tras insert válido. Job con `$tries = 1` (L-07): las suscripciones con fallo de red, 429 o 5xx
  van a un job nuevo solo con ellas (esperas 30 s y 300 s, máximo 3 intentos, luego `Log::warning`); 404/410 borran la
  suscripción; otro 4xx o error al cifrar se registra sin reintento. El worker revalida fila, no leída, usuario y
  `wantsPush`. Sin VAPID completa o con payload null: `Log::warning` y no envía. Cola y conexión por defecto.
- 2026-10-13 — Service worker: payload inválido o sin datos muestra un aviso genérico "Sereno" (tag `sereno`, abre `/`, sin
  traducir: el SW no conoce el idioma) para no provocar el aviso de Chrome; url de otro origen se reemplaza por la raíz,
  al mostrar y al hacer click. Click: enfoca y navega la primera ventana, o `openWindow` si `navigate` falla o no hay.
- 2026-10-13 — La web borra la suscripción con `DELETE /api/me/push-subscriptions?endpoint=...` (query: `api.delete`
  no admite body); el API lo acepta (`input()`) y está probado. `content_encoding` según
  `PushManager.supportedContentEncodings` (`aes128gcm`, si no `aesgcm`, si no se omite). Una suscripción con otra clave
  VAPID se da de baja y se vuelve a crear.
- 2026-10-13 — UI: el diálogo y la entrada del menú pasan de "Email notifications" a "Notifications"/"Notificaciones";
  tabla de tipos con columnas Email y Push; sección "Este dispositivo" independiente de la carga de preferencias. En la
  web, `NotificationEmailType`/`NOTIFICATION_EMAIL_TYPES` pasan a `NotificationType`/`NOTIFICATION_TYPES` y
  `updateNotificationPreferences(channel, changes)` manda solo `{[channel]: changes}`.
- 2026-10-13 — Comando `php artisan push:vapid-keys` imprime las líneas `VAPID_*` para el `.env`, no escribe archivos.
  `workspace.push.vapid_subject` no tiene valor por defecto: la fase 7 debe no enviar (y reportar claro) si falta alguna
  de las tres variables.

## Notas para la próxima sesión
- Fase 11 hecha (2026-10-13): recorrido manual en Brave sobre el build de producción local (`vite preview` en 5174) con
  claves VAPID de desarrollo: suscripción por FCM con `aes128gcm`; tarea asignada por otro usuario vía API, push recibido
  con Sereno en segundo plano; click que enfoca y abre la tarea; con Sereno enfocado no se muestra aviso del sistema.
  Tropiezos del entorno, no del código: Brave necesita "Use Google services for push messaging" y Windows silenciaba las
  notificaciones del navegador. Safari/WebKit no se probó. Suite completa del API: 1385 tests en verde.
- Contrato push (fase 3, para las fases 9 y 10): `GET /api/push/vapid-public-key` 200 `{data:{public_key}}` o 503 si falta
  la clave; `POST /api/me/push-subscriptions` `{endpoint, public_key, auth_token, content_encoding?, user_agent?}` 201 si crea,
  200 si existía, `{data:{id, endpoint, content_encoding}}`; `DELETE /api/me/push-subscriptions` `{endpoint}` 204, o 404 si no
  existe o es ajena (la web tolera el 404 al darse de baja).
- Preferencias (fase 4): GET y PATCH `/api/me/notification-preferences` con `{email:{tipo:bool}, push:{tipo:bool}}`; el
  PATCH exige al menos uno de los dos canales y mergea por clave. Falta agregar `push` en `web/src/api/types.ts` (fase 10).
  La fase 7 usa `User::wantsPush()`.
- URL (fase 5): `App\Support\NotificationUrl::for(AppNotification)` (además `task()` y `chatMessage()`). Con tipo desconocido
  o `data` incompleto lanza: la fase 6/7 decide si lo captura para no romper el job (reportar y no enviar).
  `web/src/views/NotificationsView.vue` `target()` sigue duplicando la lógica en el cliente.
- Payload (fase 6): `App\Support\PushPayload::for(AppNotification, User): ?string` devuelve el JSON codificado
  `{uuid,type,title,body,url,tag}` (máx. 3000 bytes, `MAX_BYTES`). `null` = fila de tipo desconocido o `data` incompleto: la
  fase 7 lo trata como "omitir sin reintento" y lo registra (`Log::warning` con el uuid). Pasarle el `User` con su `locale`.
- Envío (fase 7): `App\Jobs\SendPushNotification` (uuid + ids de suscripción + intento), `App\Support\PushSender`
  (interfaz, resultados `sent|expired|failed|rejected`) enlazada a `WebPushSender` en `AppServiceProvider`; en tests se
  liga un fake. `WebPushSender` (traducción del `MessageSentReport` de minishlink) no tiene test propio: se valida en la fase 11.
- Service worker (fase 8): handlers en `web/pwa/sw.js` sin módulo aparte (los specs cargan el archivo crudo). Fase 11:
  verificar en Safari/WebKit, que exige mostrar una notificación por cada push y revoca la suscripción tras varios push
  silenciosos (con ventana enfocada no se muestra nada); si aplica, mostrar siempre en Safari. Una ventana enfocada de otra
  cuenta u organización del mismo origen también silencia el push (aceptado).
- Web push (fase 9): `web/src/pwa/push.ts` exporta `type PushState = 'unsupported'|'blocked'|'active'|'inactive'`,
  `getPushState()`, `enablePush()` (relanza el `ApiError`, p. ej. 503 sin VAPID: la fase 10 lo captura), `disablePush()`
  (relanza errores distintos de 404) y `releasePushOnLogout()` (nunca lanza, tope 3 s), llamado por `stores/auth.ts` antes
  del logout. En dev no hay SW registrado: el estado es `unsupported`. Una sesión que caduca por 401 (`clearSession`) no
  borra la suscripción del API (queda hasta 404/410).
- Fase 1 hecha. Pendiente del usuario: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (de `push:vapid-keys`) y `VAPID_SUBJECT`
  (`mailto:...`) en `api/.env` y los tres nombres en `api/.env.example`; luego `docker compose restart api queue reverb scheduler`.
- Ejecución en worktree (`.claude/worktrees/notificaciones-push`): los contenedores montan el checkout principal, así que
  los tests del API corren en un contenedor desechable con el api del worktree montado (volumen `workspace_workspace_vendor`,
  red `workspace_default`, `.env` principal montado solo lectura). El vendor compartido ya tiene `minishlink/web-push`:
  no correr `composer install` en el checkout principal antes del merge.

- 2026-10-13 (mejoras) — Service worker: el click enfoca y manda `postMessage {type:'NAVIGATE', url}` a la ventana, que navega con el router (`listenForNavigation` en `web/src/pwa/serviceWorker.ts`), sin recargar; sin ventana o si falla, `openWindow`. `renotify: true` con `tag` obligatorio (un tag vacío cae al aviso genérico). Una pestaña con SPA anterior al listener se enfoca pero no navega.

## Mejoras propuestas

- [x] M-1 (baja, sonnet): `GenerateVapidKeysCommandTest` guarda y restaura las variables de entorno a mano; un helper
  compartido de tests lo simplificaría.
- [x] M-2 (baja, sonnet): anotar en `database.md` que `push_subscriptions.endpoint` es `text` con índice único (endpoints largos).
- [x] M-3 (baja, sonnet): `PushSubscriptionController` store hace `firstOrNew` + `save` no atómico; dos altas simultáneas del
  mismo endpoint nuevo dan 500 por el índice único. Capturar `UniqueConstraintViolationException` y reintentar, o `upsert`.
- [x] M-4 (baja, sonnet): comentario o test en `DestroyPushSubscriptionRequest` que fije por qué la existencia se valida en
  `authorize()` con 404 y no con `exists` (evitar que un 422 distinga ajeno de inexistente).
- [x] M-5 (baja, sonnet): documentar la clave `push` de `users.notification_preferences` en `.claude/rules/database.md`.
- [x] M-6 (baja, sonnet): tests de preferencias para `{"email": [], "push": {...}}` (se acepta) y cuerpo `{}` autenticado (422).
- [x] M-7 (baja, sonnet): unificar la lógica repetida de `User::wantsEmail` y `wantsPush` en un helper privado.
- [x] M-8 (baja, sonnet): test de `NotificationUrl` con `app.frontend_url` sin barra final (hoy solo con barra).
- [x] M-9 (baja, sonnet): `PushPayload` fija y restaura el locale a mano; usar el trait `Localizable::withLocale`.
- [x] M-10 (baja, sonnet): `PushPayload` captura `ErrorException`/`TypeError` para las claves ausentes de `data`, lo que
  también oculta bugs de programación; validar las claves explícitamente y dejar de capturar esas excepciones.
- [x] M-11 (baja, sonnet): renombrar `PushPayload::TITLE_LIMIT` (`Str::limit` mide ancho, no caracteres).
- [x] M-12 (baja, sonnet): `WebPushSender` captura solo `ErrorException` por suscripción; la librería también lanza
  `RuntimeException` y `ValueError`, que cortan el bucle sin registrar las ya enviadas ni seguir con las demás. Capturar
  `Throwable` por suscripción, con test.
- [x] M-13 (baja, sonnet): `SendPushNotification` con tipo desconocido salta `wantsPush` y depende de que `PushPayload`
  devuelva null; cortar ahí mismo.
- [x] M-14 (baja, sonnet): `sw.js` `notificationclick` toma el primer cliente de `matchAll` con `includeUncontrolled`; si no
  está controlado y otro sí, `navigate` falla y abre una ventana más. Priorizar un cliente controlado, con spec.
- [x] M-15 (baja, sonnet): `sw.js` aviso genérico con `data.url` relativo (`/`) mientras el resto es absoluto; y evaluar
  `renotify: true` para que un push con el mismo `tag` vuelva a sonar.
- [x] M-16 (baja, sonnet): `sw.spec.ts` no detecta un `showNotification` sin `await` dentro de `waitUntil`; afirmar que
  la promesa de `waitUntil` no resuelve antes que la de `showNotification`.
- [x] M-17 (media, sonnet): `notificationclick` usa `WindowClient.navigate`, que recarga la SPA; usar `postMessage` al
  router de la ventana enfocada y navegar en cliente.
- [x] M-18 (baja, sonnet): `push.spec.ts`: cubrir las guardas de generación intermedias de `enablePush` (tras
  `getRegistration`, `requestPermission` y `subscribe`); hoy se prueban dos puntos.
- [x] M-19 (baja, sonnet): `releasePushOnLogout`: `getSubscription` y `unsubscribe` quedan fuera del tope; meterlos en el race.
- [x] M-20 (baja, sonnet): `push.spec.ts` "unsupported without PushManager": simplificar a `delete window.PushManager`.
- [x] M-21 (media, sonnet): una sesión que caduca por 401 (`clearSession`) deja la suscripción ligada al usuario anterior;
  desuscribir el navegador al limpiar la sesión (sin token no se puede borrar en el API: queda hasta 404/410 o la próxima alta).
- [x] M-22 (baja, sonnet): `NotificationPreferencesDialog`: revisar el nivel del `<h3>` "Este dispositivo" frente al
  título que renderiza `AppDialog`.
- [x] M-23 (baja, sonnet): `NotificationPreferencesDialog`: mostrar el error de guardado junto al switch afectado en vez de
  bajo la tabla.
- [x] M-24 (baja, sonnet): `NotificationPreferencesDialog`: aviso cuando el usuario cierra el prompt de permiso y
  `enablePush` vuelve `inactive` (hoy no hay feedback).
- [x] M-25 (baja, sonnet): `.gitea/workflows/deploy-api.yml` avisa con `::warning::` si falta `MAIL_MAILER`; agregar un aviso
  análogo si faltan `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` o `VAPID_SUBJECT` en el `.env` del servidor.
- [x] M-26 (media, sonnet): si `pushManager.subscribe()` falla en el navegador (p. ej. Brave sin el servicio de push de
  Google), el diálogo muestra el mensaje genérico; distinguir ese caso con un texto que oriente a revisar el navegador.
- [ ] M-27 (media, sonnet): verificar el push en Safari/WebKit (exige mostrar una notificación por cada push y revoca la
  suscripción tras push silenciosos); si aplica, mostrar siempre en Safari aunque Sereno esté enfocado.
- [x] M-28 (baja, sonnet): `WebPushSender` registra el rechazo con el id de la suscripción; sumar el host del endpoint (sin el token) para diagnosticar.
- [x] M-29 (baja, sonnet): un 401 tardío de la sesión anterior con un login nuevo en curso limpia la sesión y ahora también desuscribe el navegador; comparar el token con el que salió la petición antes de actuar.
- [x] M-30 (baja, sonnet): `WebPushSender` registra `$e->getMessage()`; en errores HTTP reales (Guzzle) el mensaje puede traer la URL completa del endpoint con el token. Reemplazar el endpoint en el mensaje antes de registrarlo.
