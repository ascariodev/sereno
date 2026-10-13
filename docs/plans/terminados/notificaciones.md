# Plan: notificaciones

**Objetivo:** bandeja de notificaciones in-app en vivo y email inmediato (con preferencias por tipo) para: tarea asignada,
mención en comentario, comentario en una tarea propia (asignada o creada) y mención en el chat. La bandeja reemplaza a la de menciones.
**Estado:** terminado · 17/17 fases
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `api/` y `web/`. Requiere terminado `comentarios-tareas` (evento `TaskCommentCreated`, menciones de comentarios).
- API: `User` ya es `Notifiable` y tiene `locale`; única notificación `api/app/Notifications/InvitationNotification.php`
  (mail, `ShouldQueue`, `ShouldBeEncrypted`, enlaces con `config('app.frontend_url')`). `MAIL_MAILER` por defecto `log`;
  en tests `array` y cola `sync`. No hay tabla `notifications` ni mailpit.
- Menciones del chat: `MentionCreated`/`MentionRemoved` a `users.{id}`, `MentionController` (bandeja con `read_at`
  y filtro de acceso), `web/src/stores/mentions.ts`, `MentionsView.vue`, badge en `AppSidebar.vue`.
- Enlaces profundos que ya existen en la web: `projects/:projectId/plan?task=<id>`, `channels/:id?thread=<id>`.
- Los tests de menciones y chat van en `api/tests/Feature/Chat/`.
- `api/.env` y `api/.env.example` están bloqueados por permisos: las variables `MAIL_*` las pone el usuario (L-52).
- Lecciones: L-06, L-07, L-66, L-67 (eventos a `users.{id}`), L-42 (membresía en `broadcastOn`), L-49, L-55, L-28.

## Fases

### [x] Fase 1 — Tabla de notificaciones y canal propio [riesgo]
- **Alcance:** tabla `notifications` (uuid, organization_id, user_id, project_id nullable, type, subject_type + subject_id
  para poder borrarlas, data jsonb, read_at, created_at; índice `(user_id, organization_id, read_at)`), modelo y un
  canal de notificación propio (`app`) que escribe en ella, en lugar del canal `database` de Laravel que no lleva tenant.
- **Archivos:** migración, `api/app/Models/AppNotification.php`, `api/app/Notifications/Channels/AppChannel.php`, `.claude/rules/database.md`
- **Terminado cuando:** test que notifica con una clase de prueba y afirma la fila con su organización y proyecto.

### [x] Fase 2 — API de la bandeja
- GET `notifications` (organización activa, cursor), POST `notifications/read` (ids o todas) y `unread_count`; resource y throttle. 5 archivos.

### [x] Fase 3 — Evento NotificationCreated
- Broadcast a `users.{id}` con membresía comprobada en `broadcastOn` (L-42). 2 archivos.

### [x] Fase 4 — Notificación de tarea asignada
- Al crear o reasignar, si el asignado no es quien actúa. Canales `app` y `mail`, textos en `lang/*.json`. 3-4 archivos.

### [x] Fase 5 — Notificaciones de comentarios
- Listener de `TaskCommentCreated`: mención a los mencionados; "comentario en tu tarea" a asignado y creador que no
  sean el autor ni estén mencionados (sin duplicar). 4-5 archivos.

### [x] Fase 6 — Notificación de mención en el chat [riesgo]
- Listener de `MentionCreated` crea la notificación; `MentionRemoved` la borra por subject. 3-4 archivos.

### [x] Fase 7 — Limpieza al perder acceso [riesgo]
- `MembershipRevoked` y `ProjectAccessChanged` borran las notificaciones que el usuario ya no puede ver; suite completa (L-49). 2-3 archivos.

### [x] Fase 8 — Limpieza al borrar el sujeto
- Borrar tarea, mensaje o comentario borra sus notificaciones. 2-3 archivos.

### [x] Fase 9 — Preferencias de email (API)
- `users.notification_preferences` jsonb (email por tipo, por defecto encendido), GET/PATCH en `me`, y `via()` las respeta. 5 archivos.

### [x] Fase 10 — Mailpit en desarrollo
- Servicio `mailpit` en `api/docker-compose.yml` e instrucciones para `MAIL_*` en `CLAUDE.md` (el `.env` lo edita el usuario). 2 archivos.

### [x] Fase 11 — Correo en producción [riesgo]
- Variables SMTP en el stack de producción y el workflow de deploy del API. Revisar con el usuario antes. 2-3 archivos.

### [x] Fase 12 — Cliente y store de notificaciones (web)
- API, store con generación (L-10, L-55) y evento en vivo por `subscribeToUser`. 3 archivos.

### [x] Fase 13 — Vista de notificaciones (web)
- `NotificationsView` con un ítem por tipo y enlace profundo, ruta y badge de la barra lateral. 4 archivos.

### [x] Fase 14 — Retirar la bandeja de menciones (web) [riesgo]
- Quitar `MentionsView` y la parte de bandeja de `stores/mentions.ts`; `/mentions` redirige a la vista nueva. 3-4 archivos.

### [x] Fase 15 — Retirar la bandeja de menciones (API)
- Quitar `GET mentions` y `POST mentions/read` cuando la web ya no los use; `message_mentions` se conserva para los chips. 2-3 archivos.

### [x] Fase 16 — Preferencias de email (web)
- Diálogo desde `UserMenu` con un interruptor por tipo. 2-3 archivos.

### [x] Fase 17 — Enlace del email a la organización correcta [riesgo]
- El enlace lleva la organización y la web la activa al abrirlo; verificar cómo elige hoy la organización activa. 2-3 archivos.

## Decisiones
- 2026-10-11 — In-app + email inmediato, con preferencias por tipo; Mailpit en desarrollo, SMTP genérico en producción — elegido por el usuario.
- 2026-10-11 — Eventos: tarea asignada, mención en comentario, comentario en tarea propia (asignada o creada), mención en chat (unificada en la bandeja) — elegido por el usuario.
- 2026-10-11 — Tabla `notifications` propia con `organization_id` y canal `app`, no el canal `database` de Laravel (sin tenant).
- 2026-10-11 — Sin backfill: las menciones del chat sin leer antes del despliegue no pasan a la bandeja nueva (confirmado por el usuario el 2026-10-13).
- 2026-10-13 — Fase 11: en producción el `.env` vive solo en el servidor y Laravel lo lee de ahí, así que no hay variables SMTP nuevas
  en el stack ni en el workflow. La fase documenta las `MAIL_*` del `.env` del servidor y añade al paso "Comprobar .env del servidor"
  del deploy un aviso (no error) si `MAIL_MAILER` falta o es `log`, sin tocar el servidor — elegido por el usuario.

- 2026-10-13: el plan se ejecuta en el worktree `.claude/worktrees/notificaciones` (rama `feat/notificaciones`). Verificación desde el
  worktree (los contenedores montan el checkout principal), igual que `comentarios-tareas`: web con
  `MSYS_NO_PATHCONV=1 docker run --rm -v "<worktree>/web:/app" -v workspace_web-node-modules:/app/node_modules -w /app node:24 npx vitest --run <spec>`;
  API, desde la raíz del checkout principal (solo lectura), con
  `WT="$(cd .claude/worktrees/notificaciones/api && pwd -W)" && MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T -e APP_KEY="base64:$(head -c 32 /dev/urandom | base64)" -e DB_DATABASE=workspace_test -v "$WT:/var/www/api" api php artisan test --compact <archivos>`
  (igual con `./vendor/bin/pint --test -q`). Nunca leer ni montar `.env` (L-52).
- 2026-10-13 (fase 1): tabla `notifications` con PK `id` bigint (cursor de la fase 2) y columna `uuid` única con el id de la
  `Notification` de Laravel (`database.md` prohíbe PK UUID); `AppChannel` inserta con `insertOrIgnore`, así un reintento no duplica.
  Columnas: `uuid`, `organization_id`, `user_id`, `project_id` (nullable, FK compuesta `(project_id, organization_id)` con cascade),
  `type` string(64), `subject_type` (clase del modelo, sin morph map), `subject_id`, `data` jsonb (siempre objeto), `read_at`, `created_at`.
  Índices `(user_id, organization_id, read_at)`, `(subject_type, subject_id)`, `project_id`. `App\Models\AppNotification` usa
  `BelongsToOrganization`, relaciones `user`, `project`, `subject`. Contrato: `via()` devuelve `AppChannel::class` y la notificación
  implementa `toApp(User $notifiable): array` con `type`, `organization_id` y `subject` (Model) obligatorios, `project_id` y `data`
  opcionales; `organization_id` explícito porque en la cola no hay organización activa. Falta algo obligatorio o destinatario no `User`:
  `InvalidArgumentException`. El canal no comprueba membresía: la comprueba cada emisor.
- 2026-10-13 (fase 1): `User::notifications()` del trait `Notifiable` apunta a esta tabla con columnas `notifiable_*` inexistentes;
  documentado en `database.md` como "no usarlo" (ver M-3).
- 2026-10-13 (fase 2): `GET /api/notifications` (`cursor` sobre `id` desc, `per_page` 1-100, def. 50) responde
  `{data:[{id, type, project_id|null, data(objeto), read_at|null, created_at}], links, meta:{next_cursor, prev_cursor, path, per_page, unread_count}}`;
  no expone `uuid`, `subject_*`, `user_id` ni `organization_id`: el enlace profundo sale de `data`, que llena cada emisor.
  `POST /api/notifications/read` con `all: true` o `ids` (máx. 100) → `{unread_count}`, idempotente; ids ajenos se ignoran.
  Throttle `notifications` 60/min por usuario, compartido. Un member solo ve (y cuenta y marca) las de `project_id` null o de sus
  proyectos visibles (patrón `MentionController`); las filas ocultas se conservan.
- 2026-10-13 (fase 3): `App\Events\NotificationCreated` (`ShouldBroadcast`, `ShouldDispatchAfterCommit`) a `users.{id}`,
  `broadcastAs` `notification.created`, payload `{organization_id, notification}` con el mismo item de `NotificationResource`
  (resuelto al construir). Lo despacha `AppChannel::send` solo si `insertOrIgnore` insertó (un reintento no lo repite).
  `broadcastOn` devuelve `[]` si el usuario ya no es miembro o, con `project_id`, si `ProjectAccess::canViewId` es falso.
- 2026-10-13 (fase 3): `data` de cada notificación lleva ids y textos cortos (título, extracto breve), nunca cuerpos completos:
  la comprobación de acceso corre en el worker y queda una ventana hasta la entrega.
- 2026-10-13 (fase 4): enum `App\Enums\NotificationType` (`TaskAssigned` = `task_assigned`); las fases 5, 6 y 9 le añaden casos.
  `TaskAssignedNotification` (`ShouldQueue`, `via` `[AppChannel::class, 'mail']`, solo escalares, sin `ShouldBeEncrypted`) con
  `data` `{task_id, task_key, task_title (120 car.), actor_id, actor_name}`, `project_id` en la columna y subject la `Task`. La web
  enlaza `projects/:project_id/plan?task=:task_id`; el mail, `rtrim(frontend_url) + /projects/{id}/plan?task={id}`. Se dispara en
  `TaskController::notifyAssignee` (store y update) si hay asignado, cambió, no es el actor y ve el proyecto.
- 2026-10-13 (fase 4): toda notificación revalida en el worker con `shouldSend` (L-70; corre por canal, corta fila y mail): la de tarea
  asignada exige que la tarea exista, siga asignada al destinatario y este vea el proyecto. Las fases 7 y 8 solo limpian filas ya creadas.
- 2026-10-13 (fase 4): `User` implementa `HasLocalePreference` (`preferredLocale()` = `locale?->value`): las notificaciones toman el
  idioma del destinatario solas; un `->locale()` explícito (invitaciones) sigue mandando.
- 2026-10-13 (fase 5): listener en cola `NotifyTaskCommentRecipients` (`tries = 1`, L-07; autodescubierto) sobre `TaskCommentCreated`,
  con los datos del payload del evento. Tipos `task_comment_mention` y `task_commented` (base abstracta `TaskCommentNotification`),
  subject el `TaskComment`, `data` `{task_id, task_key, task_title, comment_id, comment_excerpt (140 car., <@id> → @Nombre solo con
  los mencionados del comentario), actor_id, actor_name}`. Mención: los de `mentions` del evento. Comentado: asignado y creador sin
  repetir, sin el autor ni los mencionados. `shouldSend`: comentario existe, ve el proyecto, y la mención sigue (o sigue siendo
  asignado o creador). El mail enlaza a la tarea (la web no admite parámetro de comentario). Editar un comentario no notifica menciones nuevas.
- 2026-10-13 (fase 6): tipo `chat_mention`, subject el `Message` (no la fila de `message_mentions`, que cambia en cada edición); la fila de
  un usuario es subject + `user_id`; `project_id` del canal, puede ser null. `data` `{channel_id, channel_name, message_id, parent_id|null,
  message_excerpt (140 car.), actor_id, actor_name}`. Mail a `/channels/{id}?message={id}` o `?thread={parent_id}`, como `MentionsView`.
  Listener síncrono `SyncChatMentionNotification` (`handleCreated`/`handleRemoved`): los eventos son `ShouldDispatchAfterCommit` y el
  borrado debe ver las filas ya guardadas; borra por user, organización, type y subject. Borrar un mensaje emite `MentionRemoved` por mención.
  `shouldSend`: la mención sigue, ve el canal (sin proyecto, basta la membresía) y no existe otra fila con el mismo (user, type, subject)
  y distinto uuid (quitar y volver a poner la mención no duplica; el uuid propio se excluye porque el job de mail corre tras el de app).
- 2026-10-13 (fase 6): `App\Support\MailMarkdown::escape` neutraliza el markdown del extracto en el correo (chat y comentarios); la bandeja
  guarda el texto sin escapar.
- 2026-10-13 (fase 7): listener síncrono autodescubierto `PruneInaccessibleNotifications` sobre `MembershipRevoked`,
  `ProjectAccessChanged` y también `MembershipRoleChanged` (degradar de admin a member no emite `ProjectAccessChanged`). Lee el
  acceso vigente, no el payload: sin membresía borra todas las de esa organización; owner/admin nada; member borra las de
  `project_id` fuera de `ProjectAccess::visibleProjectIds` (conserva las de `project_id` null). Todo en try/catch con `report`:
  corre en el callback de commit y un fallo daría 500 y cortaría `TerminateUserConnections`. Borrar proyecto, usuario u
  organización ya lo cubren los FK en cascada; lo que aún está en cola lo frena `shouldSend`. Suite completa (L-49): 1267 ok.
- 2026-10-13 (fase 8): `AppNotification::forgetSubjects(tipo, ids)` (sin scope) se llama dentro del `DB::transaction` del borrado, no
  en un listener: `DeleteTask` (la tarea y sus comentarios, ids leídos antes del delete por la cascada), `TaskCommentController::destroy`
  y `MessageDeletion` (soft delete; las respuestas de un raíz siguen vivas y conservan las suyas). No hay borrado de canales fuera de
  la cascada de proyecto u organización. `ChatMentionNotification::shouldSend` frena un job en cola porque `MessageDeletion` vacía
  `message_mentions` antes del soft delete (depende de ese orden).
- 2026-10-13 (fase 9): `users.notification_preferences` jsonb, `User::wantsEmail(NotificationType)`: ausente o null = encendido (un
  tipo futuro arranca encendido). `GET /api/me/notification-preferences` (sin `X-Organization-Id`) → `{data:{email:{task_assigned,
  task_comment_mention, task_commented, chat_mention}}}`, siempre los cuatro; `PATCH` con `{email:{tipo:bool}}`, merge parcial, responde
  el estado completo; 422 si falta `email` (también `[]`), no es array, clave fuera del enum o valor no booleano estricto. `GET /api/me`
  no las incluye. `via()` omite `mail` si está apagado (optimización) y `shouldSend` lo relee en el worker para el canal `mail`.
- 2026-10-13 (fase 10): servicio `mailpit` (`axllent/mailpit:v1.31.5`) en `api/docker-compose.yml`, sin perfil (arranca con
  `docker compose up -d`), puertos `127.0.0.1:8026` (web) y `127.0.0.1:1026` (SMTP); dentro de la red, `mailpit:1025`. Instrucciones
  `MAIL_*` en `CLAUDE.md`; `api/.env` lo edita el usuario. Los tests no dependen de él (`phpunit.xml` fuerza `MAIL_MAILER=array`).
- 2026-10-13 (fase 11): las `MAIL_*` de producción (SMTP genérico) están documentadas en la cabecera de `api/docker-compose.prod.yml`;
  tras cambiarlas, `compose restart app queue` o redeploy. `deploy-api.yml` emite `::warning::` (sin fallar) si `MAIL_MAILER` falta o
  vale `log` en el `.env` del servidor; lee solo esa clave.
- 2026-10-13 (fase 12): tipos en `web/src/api/types.ts`: `AppNotification` unión discriminada por `type` (`task_assigned`,
  `task_comment_mention`, `task_commented`, `chat_mention`) más `UnknownNotification` (`type: 'unknown'`, `original_type`; también
  si el `data` no cumple su forma). Cliente `web/src/api/notifications.ts` (`parseNotification`, `listNotifications`,
  `markNotificationsRead`, `NOTIFICATIONS_PER_PAGE` 30). Store `useNotificationsStore` (refs como `mentions`): `notifications`,
  `unreadCount`, `nextCursor`, `loaded`, `loading`, `loadingMore`, `error`, `loadMoreFailed`; acciones `refresh`, `loadMore`,
  `markRead(row|rows)`, `markAllRead`, `start(userId)`, `stop`, `clear`; se limpia y recarga al cambiar de organización.
  `subscribeToUser` tiene handler opcional `onNotificationCreated` (`NOTIFICATION_CREATED_EVENT`). `refresh` fusiona, no reemplaza:
  una fila borrada en el API sigue en la lista hasta cambiar de organización (ver M-17).
- 2026-10-13 (fase 13): `NotificationsView` en la ruta `/notifications` (name `notifications`), entrada con icono `Bell` y badge en
  `AppSidebar` antes de Menciones; `AppLayout` arranca y para el store junto a `mentions`. Enlaces: tarea a `project-plan` con
  `?task=` y el `project_id` de la columna; chat a `channel` con `?message=` o `?thread=` (como `MentionsView`). `unknown` y tarea sin
  `project_id` son un botón que solo marca leída. Se marca leída al abrir (click y auxclick). `AppLayout.spec.ts` completo tiene 6
  fallos que ya existían en `main`, ajenos al plan (tarea aparte); los de notificaciones y menciones pasan aislados.
- 2026-10-13 (fase 14): borrados `MentionsView`, `stores/mentions.ts`, `api/mentions.ts`, sus specs, los tipos `Mention`/`MentionPage`,
  el i18n de la bandeja y la entrada de la barra. El store era solo bandeja (los chips salen de `message.mentions`). `subscribeToUser`
  ya no escucha `mention.created`/`mention.removed` (el API los sigue emitiendo; `SyncChatMentionNotification` los necesita).
  `/mentions` redirige a `{name:'notifications'}`. La web ya no usa `GET mentions` ni `POST mentions/read`. Suite web: 1698 ok y los
  5 fallos de arrastre previos de `AppLayout.spec.ts` (mismos nombres antes y después).
- 2026-10-13 (fase 15): borrados `MentionController`, `ListMentionsRequest`, `MarkMentionsReadRequest`, `MentionResource`,
  `MentionInboxApiTest`, las rutas `GET mentions`/`POST mentions/read` y el limiter `mentions`. Quedan `message_mentions` (chips),
  `MentionCreated`/`MentionRemoved` con su broadcast y `SyncChatMentionNotification`. `message_mentions.read_at` queda sin uso (M-20).
  Suite completa del API: 1275 ok.
- 2026-10-13 (fase 16): `NotificationPreferencesDialog` abierto desde `UserMenu` ("Email notifications", icono `Bell`), apilado sobre
  el cajón móvil sin cerrarlo; al cerrar, el foco vuelve a `user-menu`. Interruptores `input[type=checkbox][role=switch]` nativos (no
  hay componente switch), guardado optimista por tipo con `aria-busy`/`aria-disabled`; al fallar revierte y muestra `AppFormError`.
  Cliente `web/src/api/notificationPreferences.ts`. El GET de preferencias está en `sidebarData` de `AppLayout.spec.ts`.
- 2026-10-13 (fase 17): la web elegía la organización solo en el `load()` de `AppLayout` (en memoria, luego localStorage
  `workspace.organization`, luego la primera); la URL no la llevaba. Ahora los cuatro correos enlazan con `&organization=<id>` y el guard
  global, con sesión validada, llama `useOrganizationStore().activateFromLink(id)` si es entero positivo y redirige con `replace` sin el
  parámetro; sin sesión viaja dentro de `?redirect`. `activateFromLink` hace `select` si ya hay organizaciones cargadas o deja el id
  pendiente con prioridad para la próxima carga (se consume una vez, `clear()` lo borra); un id del que no es miembro se ignora.

- 2026-10-13: cierre. Se trajo `main` (arreglo de `AppLayout.spec.ts` de otra sesión; su lección quedó como L-73 y las de este plan
  pasaron a L-74, L-75 y L-76). Suite API 1276 ok y Pint ok; suite web 1731 ok y typecheck ok; `AppLayout.spec.ts` ya pasa completo.
  Queda 1 error no manejado previo en `TaskComments.spec.ts` (`scrollIntoView` en jsdom), también en `main`, ajeno al plan (tarea aparte).

## Notas para la próxima sesión
- Tras el merge, `docker compose restart queue`.
- Antes de desplegar: poner las `MAIL_*` en el `.env` del servidor de cada ambiente (ver `api/docker-compose.prod.yml`).
- Último de los tres planes. La fase 10 toca `api/docker-compose.yml`, que hoy tiene cambios sin commit de otra sesión.

## Mejoras propuestas
- [ ] M-1: Retrasar el email unos minutos y no mandarlo si la notificación ya se leyó.
      Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [ ] M-2: Notificaciones push (PWA y móvil), del paso 9 del MVP.
      Complejidad: alta · Archivos: 8+ · Riesgo: integración externa → plan nuevo
- [x] M-3: Sobrescribir en `User` `notifications()` (hasMany `AppNotification`) y hacer que `unreadNotifications()`/`readNotifications()`
      lancen, para que el trait `Notifiable` no deje consultas a columnas `notifiable_*` inexistentes. (revisor, fase 1)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-4: Decidir si `AppChannel` comprueba que el destinatario es miembro de la organización, en vez de dejarlo a cada emisor. (revisor, fase 1)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-5: Recortar el docblock de `AppChannel` a lo no obvio del contrato `toApp`. (revisor, fase 1)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [x] M-6: `ListNotificationsRequest` extiende `ListMessagesRequest` (y hereda `around()` sin uso): extraer una base o trait común
      de cursor y `per_page` para no acoplar la bandeja al chat. (revisor, fase 2)
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-7: Corregir el docblock de `TaskCommentController` (~línea 183) que dice que las menciones de comentarios no notifican. (revisor, fase 5)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-8: Notificar las menciones nuevas al editar un comentario (`TaskCommentUpdated`). (implementador, fase 5)
      Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-9: `TaskCommentNotification::isAssigneeOrCreator` hace una consulta por destinatario en el worker; pasar el estado ya cargado. (revisor, fase 5)
      Descartada: en cola cada canal y destinatario es un job con su propia instancia, así que una caché no ahorra consultas,
      y pasar el estado desde el listener lo congelaría al encolar (L-70).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-10: Cerrar el hueco entre `shouldSend` y el insert de `AppChannel` (una mención quitada justo ahí deja la fila) con un insert
      condicionado o un índice único parcial por (user, type, subject). (implementador y revisor, fase 6)
      Complejidad: media · Archivos: 3 · Riesgo: migración → opus
- [x] M-11: Reducir el conjunto de `MailMarkdown::escape` a lo que forma enlaces e imágenes (`\ ` * _ [ ] ( ) < >`, `!` antes de `[`):
      la parte de texto plano del correo muestra las barras; con test de `renderText`. (revisor, fase 6)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-12: Escapar también en las líneas del correo los nombres de actor y canal y los títulos de tarea (`TaskAssignedNotification`
      incluida), no en el asunto. (implementador y revisor, fase 6)
      Complejidad: baja · Archivos: 4 · Riesgo: ninguno → sonnet
- [x] M-13: En `SyncChatMentionNotification::handleCreated`, capturar y reportar un fallo al encolar para que no dé 500 al POST con el
      mensaje ya guardado. (revisor, fase 6)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-14: Que `ChatMentionNotification::shouldSend` mire también `deleted_at` del mensaje, para no depender de que `MessageDeletion`
      vacíe las menciones antes; y que `NotificationSubjectCleanupTest` use una fila `chat_mention` real en el caso del mensaje. (revisor, fase 8)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-15: Test de worker (preferencia de email apagada tras encolar) también para `ChatMentionNotification` y las de comentarios,
      parametrizado. (revisor, fase 9)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-16: En las instrucciones de Mailpit de `CLAUDE.md`, quitar el `up -d mailpit` redundante, reiniciar también `reverb` y
      `scheduler` (cargan el `.env`) y quitar `MAIL_SCHEME=null` del bloque. (revisor, fase 10)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-17: Las filas que el API borra (fases 7 y 8) siguen en la lista de la web: en el refresh tras reconectar, reemplazar las filas
      con `id` >= el menor de la página, o un evento `notification.removed`. (revisor, fase 12)
      Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-18: `markAllRead` marca como leídas también las filas llegadas en vivo durante la petición, que el servidor quizá no marcó:
      restringir a las que había al lanzarla. (revisor, fase 12)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-19: Renombrar la clase `app-sidebar__mentions` (enlace de notificaciones y su CSS de posición colapsada) a
      `app-sidebar__notifications` en `AppSidebar.vue`. (revisor, fase 14)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [x] M-21: En `activateFromLink`, si las organizaciones ya están cargadas y el id no está, recargar la lista una vez (miembro recién
      invitado con la lista vieja); y tests del guard para `?organization=abc` y el parámetro repetido. (revisor, fase 17)
      Complejidad: baja · Archivos: 4 · Riesgo: ninguno → sonnet
- [x] M-22: Envolver en `whileLoadingSession` la recarga de organizaciones que hace el guard al abrir un enlace con `?organization=`
      de una organización que no estaba en la lista, para que no quede la pantalla congelada si el servidor tarda. (revisor, M-21)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-23: Ampliar el test de `MailMarkdown::escape` con un autolink `<http://evil.test>` y una URL suelta (que no salga `href`),
      para detectar si algún día se suma la extensión de autolinks de GFM. (revisor, M-11)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-24: Escapar con `MailMarkdown::escape` el nombre de la organización y del que invita en las líneas de `InvitationNotification`. (implementador, M-12)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-25: Mismo try/catch con `report` en `SyncChatMentionNotification::handleRemoved` (corre tras el commit, un fallo da 500 con el cambio guardado). (revisor, M-13)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-26: El test de `task_assigned` con `notifyNow` de `NotificationPreferencesTest` (~línea 72) queda enmascarado por `via()` (L-77): quitarlo o pasarlo a `shouldSend` directo. (revisor, M-15)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
