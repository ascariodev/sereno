# Plan: app-movil

**Objetivo:** app móvil de Sereno para Android (Expo, en `app/`) con paridad con la web (chat, log, plan, notificaciones,
ajustes) y push nativo, distribuida al equipo como APK interno por EAS. iOS queda para un plan posterior.
**Estado:** en curso · Fase actual: 2
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->
<!-- Mantén el plan corto: detalla solo la fase siguiente; las lejanas, en 2–3 líneas. -->


## Contexto mínimo
- Apps afectadas: `api/` (push móvil) y `app/` (nueva). Commits con `git` en la raíz del monorepo.
- La app consume la API tal cual la usa la web: Bearer de Sanctum (`POST /api/auth/login` con `device_name`, respuesta
  `{token, user}`), `X-Organization-Id` en las rutas de organización, `Accept-Language`. Referencia de cada pantalla: la
  vista o componente equivalente de `web/src/` (cliente en `web/src/api/*.ts`, Reverb en `web/src/realtime/echo.ts`, textos
  en `web/src/i18n/`, destino de un aviso en `web/src/notificationTarget.ts`, textos de avisos en `notificationText.ts`).
- Push web hoy: `AppChannel` inserta la notificación y encola `SendPushNotification`, que filtra con `User::wantsPush` y
  envía por `PushSender` (bind único a `WebPushSender`). Tests en `api/tests/Feature/Core/Push*`, `SendPushNotificationTest`.
- La app corre en el **host Windows** (Node del host, no Docker), como Tauri. El teléfono llega al API y a Reverb de
  desarrollo por la IP de la PC en la LAN (puertos 8003 y 8086 publicados en todas las interfaces; puede hacer falta
  abrirlos en el firewall de Windows). Las URLs firmadas de adjuntos usan `APP_URL`: en desarrollo apuntan a localhost
  y no cargan en el teléfono salvo que el usuario cambie `APP_URL` en `api/.env`.
- Versiones (Expo SDK, React Native, librerías): las que instale `create-expo-app` en la fase 2 y lo que pida
  `npx expo install`; no fijarlas de memoria.

## Fases
<!-- Cada fase debe caber en UNA sesión: máx. ~5 archivos, un solo objetivo,
     criterio verificable y el proyecto funcionando al terminar.
     Marcar con [riesgo] las fases con incertidumbre alta. -->

### Bloque A: push móvil en el API

### [x] Fase 1 — Tabla y modelo de tokens de Expo
- **Alcance:** migración `expo_push_tokens`: `user_id` (FK `cascadeOnDelete`, índice), `personal_access_token_id` (FK
  `cascadeOnDelete`: cerrar sesión borra el token del dispositivo), `token` string único (`ExponentPushToken[...]`),
  `platform` (CHECK `expo_push_tokens_platform_check`: `android|ios`), `device_name` nullable, `last_used_at` nullable,
  timestamps. Sin `organization_id` (como `push_subscriptions`). Modelo `ExpoPushToken` con factory y
  `User::expoPushTokens()`. Documentar la tabla en `.claude/rules/database.md`.
- **Archivos:** migración, `app/Models/ExpoPushToken.php`, factory, `app/Models/User.php`, `.claude/rules/database.md`.
- **Terminado cuando:** test de modelo: crear, relación con el usuario, borrar el access token borra el push token,
  token duplicado falla y plataforma inválida falla.

### [ ] Fase 2 — Endpoints para registrar y borrar el token
- **Alcance:** `POST /api/me/expo-push-tokens` (upsert por `token`, ligado al access token actual; valida el formato) y
  `DELETE /api/me/expo-push-tokens` (por `token`, solo los propios). Controlador, Form Request, rutas, `lang/*.json`.
- **Terminado cuando:** test de API: alta, re-alta desde otra sesión mueve el token, borrar ajeno no borra, 401 sin auth.

### [ ] Fase 3 — Emisor de Expo push [riesgo]
- **Alcance:** `ExpoPushSender` (HTTP al servicio de push de Expo, lotes, `DeviceNotRegistered` → expirado, errores de
  red → reintento) con su propia interfaz o generalizando `PushSender`; verificar la API de Expo en su documentación
  antes de escribirlo. Token de acceso de Expo opcional por config (`EXPO_ACCESS_TOKEN`).
- **Terminado cuando:** test con `Http::fake`: éxito, token inválido marcado como expirado, 5xx como fallo reintentable.

### [ ] Fase 4 — El job de push también envía a los dispositivos móviles [riesgo]
- **Alcance:** `SendPushNotification` envía a los tokens de Expo además de las suscripciones web, con el mismo filtro
  `wantsPush` y payload `{title, body, data: {url, organizationId}}`; la falta de claves VAPID solo corta la parte web.
  Expirados se borran, `last_used_at` se actualiza.
- **Terminado cuando:** `SendPushNotificationTest` ampliado (solo Expo, mixto, sin VAPID, preferencia apagada) y la suite
  de push en verde.

### Bloque B: base de la app

### [ ] Fase 5 — Cuentas y herramientas [manual]
- **Alcance:** el usuario crea la cuenta de Expo (gratis) y hace `npx eas-cli login`; prepara un Android con depuración
  USB o un emulador de Android Studio. Firebase (FCM) se configura recién en la fase 30.
- **Terminado cuando:** `npx eas-cli whoami` responde y `adb devices` lista el teléfono o el emulador.

### [ ] Fase 6 — Proyecto Expo en `app/` [riesgo]
- **Alcance:** `create-expo-app` con TypeScript y Expo Router; jest-expo y Testing Library; scripts `typecheck`, `test`,
  `lint`; `app.json` con nombre Sereno, `package` de Android y esquema `sereno`. Reemplaza `app/README.md`. Comandos de la
  app en `CLAUDE.md`.
- **Terminado cuando:** typecheck y un test de humo pasan, y la app abre en el teléfono con `npx expo start`.

### [ ] Fase 7 — Configuración y cliente HTTP
- **Alcance:** `config.ts` (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REVERB_*`) y cliente con Bearer, `Accept-Language`,
  `X-Organization-Id`, errores tipados, 401 y 403 `organization_forbidden` como en `web/src/api/client.ts`.
- **Terminado cuando:** tests del cliente (headers, errores, callbacks de 401/403).

### [ ] Fase 8 — Idioma
- **Alcance:** i18n `es`/`en` con el idioma del sistema (expo-localization) y cambio manual; textos portados de la web solo
  para lo que use la app.
- **Terminado cuando:** test: idioma inicial según el sistema y cambio en vivo.

### [ ] Fase 9 — Sesión
- **Alcance:** token en `expo-secure-store`, store de sesión (login, logout, `GET /api/me`), `device_name` del dispositivo.
- **Terminado cuando:** tests del store (persistencia, logout borra el token, 401 cierra la sesión).

### [ ] Fase 10 — Login y protección de rutas
- **Alcance:** pantalla de login y redirección según haya sesión (Expo Router).
- **Terminado cuando:** test de la pantalla (error de credenciales, éxito navega) y login real contra el API local.

### [ ] Fase 11 — Registro
- **Alcance:** pantalla de registro (`GET /api/auth/registration` y `POST /api/auth/register`) como `RegisterView.vue`.
- **Terminado cuando:** test de la pantalla con errores de validación y éxito.

### [ ] Fase 12 — Organizaciones
- **Alcance:** organización activa persistida, selector y crear organización.
- **Terminado cuando:** tests: elegir, recordar la elegida, 403 vuelve al selector.

### [ ] Fase 13 — Navegación principal y proyectos
- **Alcance:** pestañas o cajón (proyectos, notificaciones, ajustes) y lista de proyectos con su canal.
- **Terminado cuando:** test de la lista (vacía, con datos, archivados ocultos).

### [ ] Fase 14 — Crear, editar y archivar proyectos
- **Alcance:** solo owner/admin, como `ProjectCreateDialog.vue` y `ProjectHeader.vue`.
- **Terminado cuando:** tests por rol.

### [ ] Fase 15 — Tiempo real con Reverb [riesgo]
- **Alcance:** laravel-echo + pusher-js en React Native, autorización por `POST /broadcasting/auth` con Bearer, reconexión
  al volver de segundo plano.
- **Terminado cuando:** test del cliente con el transporte simulado y, en el teléfono, suscripción a `users.{id}` sin error.

### Bloque C: chat

### [ ] Fase 16 — Lista de mensajes del canal
- **Alcance:** pantalla del canal con paginación por cursor hacia atrás y mensajes de usuario en texto plano.
- **Terminado cuando:** test de carga y paginación.

### [ ] Fase 17 — Formato de mensajes [riesgo]
- **Alcance:** markdown y menciones (`web/src/mentionToken.ts`) en React Native con una librería verificada; enlaces abren
  el navegador.
- **Terminado cuando:** tests de render (negrita, código, enlace, mención).

### [ ] Fase 18 — Avisos de sistema en el canal
- **Alcance:** render de los mensajes `system` (avisos de log y cambios de estado) como `SystemNotice.vue`.
- **Terminado cuando:** test por tipo de payload.

### [ ] Fase 19 — Enviar mensajes
- **Alcance:** compositor con envío y estado de error.
- **Terminado cuando:** test de envío y de error.

### [ ] Fase 20 — Autocompletar menciones
- **Alcance:** al escribir `@`, sugerir miembros e insertar el token de mención.
- **Terminado cuando:** test del autocompletado.

### [ ] Fase 21 — Mensajes en vivo
- **Alcance:** `message.created/updated/deleted` en el canal abierto.
- **Terminado cuando:** test con eventos simulados.

### [ ] Fase 22 — Editar y borrar mensajes propios
- **Alcance:** menú de mensaje con editar y borrar.
- **Terminado cuando:** tests de permisos y de ambas acciones.

### [ ] Fase 23 — Hilos
- **Alcance:** ver respuestas y responder (`.../messages/{m}/replies`), contador en vivo.
- **Terminado cuando:** tests de carga y respuesta.

### [ ] Fase 24 — Ver adjuntos
- **Alcance:** miniaturas de imágenes y apertura de archivos con URL fresca (`GET /api/attachments/{id}/url`).
- **Terminado cuando:** test: URL vencida pide una nueva.

### [ ] Fase 25 — Subir adjuntos [riesgo]
- **Alcance:** elegir foto o archivo y subir multipart a `POST /channels/{c}/attachments` antes de enviar.
- **Terminado cuando:** test del flujo y subida real desde el teléfono.

### [ ] Fase 26 — Acciones de los avisos de log
- **Alcance:** resolver, ignorar y crear tarea desde un aviso, como la web.
- **Terminado cuando:** tests de cada acción.

### Bloque D: notificaciones y push

### [ ] Fase 27 — Bandeja de notificaciones
- **Alcance:** lista paginada, marcar leídas, contador en la pestaña y apertura del destino (`notificationTarget`).
- **Terminado cuando:** tests de la lista y del destino por tipo.

### [ ] Fase 28 — Notificaciones en vivo
- **Alcance:** `notification.created` y menciones quitadas actualizan bandeja y contador.
- **Terminado cuando:** test con eventos simulados.

### [ ] Fase 29 — Preferencias de notificación e idioma de la cuenta
- **Alcance:** pantalla de ajustes con preferencias email/push por tipo y `PATCH /api/me/locale`.
- **Terminado cuando:** tests de guardado.

### [ ] Fase 30 — Firebase y build de desarrollo [manual] [riesgo]
- **Alcance:** el usuario crea el proyecto de Firebase, sube la credencial FCM V1 a EAS y genera un development build
  (Expo Go no recibe push remoto en Android). `eas.json` con perfil `development`.
- **Terminado cuando:** el development build instalado abre la app y la herramienta de push de Expo entrega un aviso de prueba.

### [ ] Fase 31 — Registrar el dispositivo para push
- **Alcance:** pedir permiso, obtener el token con `expo-notifications`, registrarlo en el API tras el login y al cambiar;
  borrarlo antes de cerrar sesión.
- **Terminado cuando:** tests del registro y una tarea asignada desde la web llega como push al teléfono con la app cerrada.

### [ ] Fase 32 — Abrir el destino al tocar el aviso
- **Alcance:** al tocar un push (app cerrada o en segundo plano) cambiar de organización si hace falta y abrir la pantalla;
  en primer plano no mostrar el aviso del sistema.
- **Terminado cuando:** tests del manejador y prueba en el teléfono.

### Bloque E: plan (tareas)

### [ ] Fase 33 — Tablero de tareas
- **Alcance:** tareas del proyecto por estado (columnas deslizables o lista agrupada), como `PlanView.vue`.
- **Terminado cuando:** test de agrupado y orden.

### [ ] Fase 34 — Crear y editar tareas
- **Alcance:** formulario de tarea (título, descripción, responsable) y detalle.
- **Terminado cuando:** tests de crear y editar.

### [ ] Fase 35 — Mover y borrar tareas
- **Alcance:** cambiar de estado y posición con un menú (como `TaskMoveMenu.vue`, sin arrastrar) y borrar.
- **Terminado cuando:** tests de mover y borrar.

### [ ] Fase 36 — Comentarios de tareas
- **Alcance:** listar, enviar, editar y borrar comentarios con menciones.
- **Terminado cuando:** tests del hilo de comentarios.

### [ ] Fase 37 — Adjuntos en comentarios
- **Alcance:** reutilizar ver y subir adjuntos con las rutas `task-attachments`.
- **Terminado cuando:** test del flujo.

### [ ] Fase 38 — Tareas en vivo
- **Alcance:** `task.*` y `task.comment.*` en tablero y detalle.
- **Terminado cuando:** test con eventos simulados.

### Bloque F: log y administración

### [ ] Fase 39 — Vista de log del proyecto
- **Alcance:** grupos con filtros por estado y nivel y detalle del grupo, como `LogView.vue` y `LogGroupPanel.vue`.
- **Terminado cuando:** tests de lista y filtros.

### [ ] Fase 40 — Integraciones del proyecto
- **Alcance:** fuentes de log: crear, rotar y revocar, mostrando la key una sola vez (como `IntegrationsView.vue`).
- **Terminado cuando:** tests por rol.

### [ ] Fase 41 — Miembros del proyecto
- **Alcance:** agregar y quitar miembros (como `ProjectMembersDialog.vue`).
- **Terminado cuando:** tests por rol.

### [ ] Fase 42 — Miembros de la organización
- **Alcance:** lista, cambio de rol, quitar y transferir la propiedad (como `MembersView.vue`).
- **Terminado cuando:** tests por rol.

### [ ] Fase 43 — Invitaciones
- **Alcance:** invitar, listar y revocar (como `InvitationsView.vue`). Aceptar una invitación sigue en la web.
- **Terminado cuando:** tests por rol.

### Bloque G: distribución

### [ ] Fase 44 — Identidad visual
- **Alcance:** ícono, ícono adaptativo, splash y colores del tema de la web.
- **Terminado cuando:** el build muestra ícono y splash de Sereno.

### [ ] Fase 45 — Perfiles de build y EAS Update [riesgo]
- **Alcance:** perfiles `preview` (APK interno) y `production` en `eas.json`, variables de producción, canal de EAS Update y
  versión en `app.json`; comandos en `CLAUDE.md`.
- **Terminado cuando:** `eas build --profile preview` genera el APK y una actualización por EAS Update llega a la app instalada.

### [ ] Fase 46 — Primera entrega al equipo [manual]
- **Alcance:** instalar el APK de producción desde el enlace de EAS, login contra producción, push, chat y tareas.
- **Terminado cuando:** revisión manual completa en el teléfono.

## Decisiones
- 2026-10-14 — Usuario: Android primero (iOS en otro plan), paridad con la web, distribución por APK interno de EAS.
- 2026-10-14 — Tokens de Expo en tabla propia `expo_push_tokens`, sin tocar `push_subscriptions` (otro formato y sin
  cifrado); ligados al access token de Sanctum para que cerrar sesión deje de enviar push a ese dispositivo.
- 2026-10-14 — La app no comparte código con la web (Vue y React): porta los módulos puros que necesite (menciones,
  textos y destino de avisos) con sus tests. Un paquete compartido queda como mejora.
- 2026-10-14 — La app se desarrolla en el host Windows, no en Docker (Metro y el teléfono necesitan la red local).
- 2026-10-14 — Aceptar invitaciones sigue en la web (no hay deep links de `sereno.ascario.dev` en esta versión).

## Notas para la próxima sesión
- Fase 1 hecha: tabla `expo_push_tokens`, modelo `ExpoPushToken` (Fillable: token, platform, device_name, last_used_at; `user_id` y
  `personal_access_token_id` se asignan por propiedad, no por mass assignment), `User::expoPushTokens()`, factory que crea un
  access token real. En la fase 2 hay que comprobar que el access token sea del usuario autenticado (`currentAccessToken()`).

## Mejoras propuestas
<!-- Sugerencias que surgieron y NO se implementaron. Se aplican después con /aplicar-mejoras. -->
