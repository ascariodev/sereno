# Plan: notificaciones

**Objetivo:** bandeja de notificaciones in-app en vivo y email inmediato (con preferencias por tipo) para: tarea asignada,
mención en comentario, comentario en una tarea propia (asignada o creada) y mención en el chat. La bandeja reemplaza a la de menciones.
**Estado:** en curso · Fase actual: 2
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

### [ ] Fase 2 — API de la bandeja
- GET `notifications` (organización activa, cursor), POST `notifications/read` (ids o todas) y `unread_count`; resource y throttle. 5 archivos.

### [ ] Fase 3 — Evento NotificationCreated
- Broadcast a `users.{id}` con membresía comprobada en `broadcastOn` (L-42). 2 archivos.

### [ ] Fase 4 — Notificación de tarea asignada
- Al crear o reasignar, si el asignado no es quien actúa. Canales `app` y `mail`, textos en `lang/*.json`. 3-4 archivos.

### [ ] Fase 5 — Notificaciones de comentarios
- Listener de `TaskCommentCreated`: mención a los mencionados; "comentario en tu tarea" a asignado y creador que no
  sean el autor ni estén mencionados (sin duplicar). 4-5 archivos.

### [ ] Fase 6 — Notificación de mención en el chat [riesgo]
- Listener de `MentionCreated` crea la notificación; `MentionRemoved` la borra por subject. 3-4 archivos.

### [ ] Fase 7 — Limpieza al perder acceso [riesgo]
- `MembershipRevoked` y `ProjectAccessChanged` borran las notificaciones que el usuario ya no puede ver; suite completa (L-49). 2-3 archivos.

### [ ] Fase 8 — Limpieza al borrar el sujeto
- Borrar tarea, mensaje o comentario borra sus notificaciones. 2-3 archivos.

### [ ] Fase 9 — Preferencias de email (API)
- `users.notification_preferences` jsonb (email por tipo, por defecto encendido), GET/PATCH en `me`, y `via()` las respeta. 5 archivos.

### [ ] Fase 10 — Mailpit en desarrollo
- Servicio `mailpit` en `api/docker-compose.yml` e instrucciones para `MAIL_*` en `CLAUDE.md` (el `.env` lo edita el usuario). 2 archivos.

### [ ] Fase 11 — Correo en producción [riesgo]
- Variables SMTP en el stack de producción y el workflow de deploy del API. Revisar con el usuario antes. 2-3 archivos.

### [ ] Fase 12 — Cliente y store de notificaciones (web)
- API, store con generación (L-10, L-55) y evento en vivo por `subscribeToUser`. 3 archivos.

### [ ] Fase 13 — Vista de notificaciones (web)
- `NotificationsView` con un ítem por tipo y enlace profundo, ruta y badge de la barra lateral. 4 archivos.

### [ ] Fase 14 — Retirar la bandeja de menciones (web) [riesgo]
- Quitar `MentionsView` y la parte de bandeja de `stores/mentions.ts`; `/mentions` redirige a la vista nueva. 3-4 archivos.

### [ ] Fase 15 — Retirar la bandeja de menciones (API)
- Quitar `GET mentions` y `POST mentions/read` cuando la web ya no los use; `message_mentions` se conserva para los chips. 2-3 archivos.

### [ ] Fase 16 — Preferencias de email (web)
- Diálogo desde `UserMenu` con un interruptor por tipo. 2-3 archivos.

### [ ] Fase 17 — Enlace del email a la organización correcta [riesgo]
- El enlace lleva la organización y la web la activa al abrirlo; verificar cómo elige hoy la organización activa. 2-3 archivos.

## Decisiones
- 2026-10-11 — In-app + email inmediato, con preferencias por tipo; Mailpit en desarrollo, SMTP genérico en producción — elegido por el usuario.
- 2026-10-11 — Eventos: tarea asignada, mención en comentario, comentario en tarea propia (asignada o creada), mención en chat (unificada en la bandeja) — elegido por el usuario.
- 2026-10-11 — Tabla `notifications` propia con `organization_id` y canal `app`, no el canal `database` de Laravel (sin tenant).
- 2026-10-11 — Sin backfill: las menciones del chat sin leer antes del despliegue no pasan a la bandeja nueva (pendiente de confirmar).

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

## Notas para la próxima sesión
- Fase 2: la bandeja lee `AppNotification` (no `$user->notifications()`), con cursor sobre `id`.
- Último de los tres planes. La fase 10 toca `api/docker-compose.yml`, que hoy tiene cambios sin commit de otra sesión.

## Mejoras propuestas
- [ ] M-1: Retrasar el email unos minutos y no mandarlo si la notificación ya se leyó.
      Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [ ] M-2: Notificaciones push (PWA y móvil), del paso 9 del MVP.
      Complejidad: alta · Archivos: 8+ · Riesgo: integración externa → plan nuevo
- [ ] M-3: Sobrescribir en `User` `notifications()` (hasMany `AppNotification`) y hacer que `unreadNotifications()`/`readNotifications()`
      lancen, para que el trait `Notifiable` no deje consultas a columnas `notifiable_*` inexistentes. (revisor, fase 1)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-4: Decidir si `AppChannel` comprueba que el destinatario es miembro de la organización, en vez de dejarlo a cada emisor. (revisor, fase 1)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-5: Recortar el docblock de `AppChannel` a lo no obvio del contrato `toApp`. (revisor, fase 1)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
