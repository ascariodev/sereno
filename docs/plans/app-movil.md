# Plan: app-movil

**Objetivo:** app móvil de Sereno para Android (Expo, en `app/`) con paridad con la web (chat, log, plan, notificaciones,
ajustes) y push nativo, distribuida al equipo como APK interno por EAS. iOS queda para un plan posterior.
**Estado:** en curso · Fase actual: 46
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

### [x] Fase 2 — Endpoints para registrar y borrar el token
- **Alcance:** `POST /api/me/expo-push-tokens` (upsert por `token`, ligado al access token actual; valida el formato) y
  `DELETE /api/me/expo-push-tokens` (por `token`, solo los propios). Controlador, Form Request, rutas, `lang/*.json`.
- **Terminado cuando:** test de API: alta, re-alta desde otra sesión mueve el token, borrar ajeno no borra, 401 sin auth.

### [x] Fase 3 — Emisor de Expo push [riesgo]
- **Alcance:** `ExpoPushSender` (HTTP al servicio de push de Expo, lotes, `DeviceNotRegistered` → expirado, errores de
  red → reintento) con su propia interfaz o generalizando `PushSender`; verificar la API de Expo en su documentación
  antes de escribirlo. Token de acceso de Expo opcional por config (`EXPO_ACCESS_TOKEN`).
- **Terminado cuando:** test con `Http::fake`: éxito, token inválido marcado como expirado, 5xx como fallo reintentable.

### [x] Fase 4 — El job de push también envía a los dispositivos móviles [riesgo]
- **Alcance:** `SendPushNotification` envía a los tokens de Expo además de las suscripciones web, con el mismo filtro
  `wantsPush` y payload `{title, body, data: {url, organizationId}}`; la falta de claves VAPID solo corta la parte web.
  Expirados se borran, `last_used_at` se actualiza.
- **Terminado cuando:** `SendPushNotificationTest` ampliado (solo Expo, mixto, sin VAPID, preferencia apagada) y la suite
  de push en verde.

### Bloque B: base de la app

### [x] Fase 5 — Cuentas y herramientas [manual]
- **Alcance:** el usuario crea la cuenta de Expo (gratis) y hace `npx eas-cli login`; prepara un Android con depuración
  USB o un emulador de Android Studio. Firebase (FCM) se configura recién en la fase 30.
- **Terminado cuando:** `npx eas-cli whoami` responde y `adb devices` lista el teléfono o el emulador.

### [x] Fase 6 — Proyecto Expo en `app/` [riesgo]
- **Alcance:** `create-expo-app` con TypeScript y Expo Router; jest-expo y Testing Library; scripts `typecheck`, `test`,
  `lint`; `app.json` con nombre Sereno, `package` de Android y esquema `sereno`. Reemplaza `app/README.md`. Comandos de la
  app en `CLAUDE.md`.
- **Terminado cuando:** typecheck y un test de humo pasan, y la app abre en el teléfono con `npx expo start`.

### [x] Fase 7 — Configuración y cliente HTTP
- **Alcance:** `config.ts` (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REVERB_*`) y cliente con Bearer, `Accept-Language`,
  `X-Organization-Id`, errores tipados, 401 y 403 `organization_forbidden` como en `web/src/api/client.ts`.
- **Terminado cuando:** tests del cliente (headers, errores, callbacks de 401/403).

### [x] Fase 8 — Idioma
- **Alcance:** i18n `es`/`en` con el idioma del sistema (expo-localization) y cambio manual; textos portados de la web solo
  para lo que use la app.
- **Terminado cuando:** test: idioma inicial según el sistema y cambio en vivo.

### [x] Fase 9 — Sesión
- **Alcance:** token en `expo-secure-store`, store de sesión (login, logout, `GET /api/me`), `device_name` del dispositivo.
  Además: llamar a `installI18nOnApi()` al arrancar, aplicar `users.locale` con `setLocale` tras `GET /api/me` y persistir la
  elección manual de idioma (como `workspace.locale` de la web).
- **Terminado cuando:** tests del store (persistencia, logout borra el token, 401 cierra la sesión).

### [x] Fase 10 — Login y protección de rutas
- **Alcance:** pantalla de login y redirección según haya sesión (Expo Router).
- **Terminado cuando:** test de la pantalla (error de credenciales, éxito navega) y login real contra el API local.

### [x] Fase 11 — Registro
- **Alcance:** pantalla de registro (`GET /api/auth/registration` y `POST /api/auth/register`) como `RegisterView.vue`.
- **Terminado cuando:** test de la pantalla con errores de validación y éxito.

### [x] Fase 12 — Organizaciones
- **Alcance:** organización activa persistida, selector y crear organización.
- **Terminado cuando:** tests: elegir, recordar la elegida, 403 vuelve al selector.

### [x] Fase 13 — Navegación principal y proyectos
- **Alcance:** pestañas o cajón (proyectos, notificaciones, ajustes) y lista de proyectos con su canal.
- **Terminado cuando:** test de la lista (vacía, con datos, archivados ocultos).

### [x] Fase 14 — Crear, editar y archivar proyectos
- **Alcance:** solo owner/admin, como `ProjectCreateDialog.vue` y `ProjectHeader.vue`.
- **Terminado cuando:** tests por rol.

### [x] Fase 15 — Tiempo real con Reverb [riesgo]
- **Alcance:** laravel-echo + pusher-js en React Native, autorización por `POST /broadcasting/auth` con Bearer, reconexión
  al volver de segundo plano.
- **Terminado cuando:** test del cliente con el transporte simulado y, en el teléfono, suscripción a `users.{id}` sin error.

### Bloque C: chat

### [x] Fase 16 — Lista de mensajes del canal
- **Alcance:** pantalla del canal con paginación por cursor hacia atrás y mensajes de usuario en texto plano.
- **Terminado cuando:** test de carga y paginación.

### [x] Fase 17 — Formato de mensajes [riesgo]
- **Alcance:** markdown y menciones (`web/src/mentionToken.ts`) en React Native con una librería verificada; enlaces abren
  el navegador.
- **Terminado cuando:** tests de render (negrita, código, enlace, mención).

### [x] Fase 18 — Avisos de sistema en el canal
- **Alcance:** render de los mensajes `system` (avisos de log y cambios de estado) como `SystemNotice.vue`.
- **Terminado cuando:** test por tipo de payload.

### [x] Fase 19 — Enviar mensajes
- **Alcance:** compositor con envío y estado de error.
- **Terminado cuando:** test de envío y de error.

### [x] Fase 20 — Autocompletar menciones
- **Alcance:** al escribir `@`, sugerir miembros e insertar el token de mención.
- **Terminado cuando:** test del autocompletado.

### [x] Fase 21 — Mensajes en vivo
- **Alcance:** `message.created/updated/deleted` en el canal abierto.
- **Terminado cuando:** test con eventos simulados.

### [x] Fase 22 — Editar y borrar mensajes propios
- **Alcance:** menú de mensaje con editar y borrar.
- **Terminado cuando:** tests de permisos y de ambas acciones.

### [x] Fase 23a — Contadores y resumen de hilo en el canal
- **Alcance:** `replies_count`, `last_reply_at` y `recent_participants` en el store del canal (`applyReply`, `replace` que
  conserva contadores, `root` de `.message.deleted` y de `meta.root` del DELETE) y `ThreadSummary` bajo cada mensaje.
- **Terminado cuando:** tests de contadores en vivo y del resumen.

### [x] Fase 23b — Pantalla de hilo
- **Alcance:** ver respuestas y responder (`.../messages/{m}/replies`): store del hilo, pantalla, `MessageRow` extraído,
  compositor y editor que sirven al hilo, eventos en vivo y `catchUp` del hilo.
- **Terminado cuando:** tests de carga y respuesta.

### [x] Fase 24 — Ver adjuntos
- **Alcance:** miniaturas de imágenes y apertura de archivos con URL fresca (`GET /api/attachments/{id}/url`).
- **Terminado cuando:** test: URL vencida pide una nueva.

### [x] Fase 25 — Subir adjuntos [riesgo]
- **Alcance:** elegir foto o archivo y subir multipart a `POST /channels/{c}/attachments` antes de enviar.
- **Terminado cuando:** test del flujo y subida real desde el teléfono.

### [x] Fase 26 — Acciones de los avisos de log
- **Alcance:** resolver, ignorar y crear tarea desde un aviso, como la web.
- **Terminado cuando:** tests de cada acción.

### Bloque D: notificaciones y push

### [x] Fase 27 — Bandeja de notificaciones
- **Alcance:** lista paginada, marcar leídas, contador en la pestaña y apertura del destino (`notificationTarget`).
- **Terminado cuando:** tests de la lista y del destino por tipo.

### [x] Fase 28 — Notificaciones en vivo
- **Alcance:** `notification.created` y menciones quitadas actualizan bandeja y contador.
- **Terminado cuando:** test con eventos simulados.

### [x] Fase 29 — Preferencias de notificación e idioma de la cuenta
- **Alcance:** pantalla de ajustes con preferencias email/push por tipo y `PATCH /api/me/locale`.
- **Terminado cuando:** tests de guardado.

### [x] Fase 30 — Firebase y build de desarrollo [manual] [riesgo]
- **Alcance:** el usuario crea el proyecto de Firebase, sube la credencial FCM V1 a EAS y genera un development build
  (Expo Go no recibe push remoto en Android). `eas.json` con perfil `development`.
- **Terminado cuando:** el development build instalado abre la app y la herramienta de push de Expo entrega un aviso de prueba.

### [x] Fase 31 — Registrar el dispositivo para push
- **Alcance:** pedir permiso, obtener el token con `expo-notifications`, registrarlo en el API tras el login y al cambiar;
  borrarlo antes de cerrar sesión.
- **Terminado cuando:** tests del registro y una tarea asignada desde la web llega como push al teléfono con la app cerrada.

### [x] Fase 32 — Abrir el destino al tocar el aviso
- **Alcance:** al tocar un push (app cerrada o en segundo plano) cambiar de organización si hace falta y abrir la pantalla;
  en primer plano no mostrar el aviso del sistema.
- **Terminado cuando:** tests del manejador y prueba en el teléfono.

### Bloque E: plan (tareas)

### [x] Fase 33 — Tablero de tareas
- **Alcance:** tareas del proyecto por estado (columnas deslizables o lista agrupada), como `PlanView.vue`.
- **Terminado cuando:** test de agrupado y orden.

### [x] Fase 34 — Crear y editar tareas
- **Alcance:** formulario de tarea (título, descripción, responsable) y detalle.
- **Terminado cuando:** tests de crear y editar.

### [x] Fase 35 — Mover y borrar tareas
- **Alcance:** cambiar de estado y posición con un menú (como `TaskMoveMenu.vue`, sin arrastrar) y borrar.
- **Terminado cuando:** tests de mover y borrar.

### [x] Fase 36 — Comentarios de tareas
- **Alcance:** listar, enviar, editar y borrar comentarios con menciones.
- **Terminado cuando:** tests del hilo de comentarios.

### [x] Fase 37 — Adjuntos en comentarios
- **Alcance:** reutilizar ver y subir adjuntos con las rutas `task-attachments`.
- **Terminado cuando:** test del flujo.

### [x] Fase 38 — Tareas en vivo
- **Alcance:** `task.*` y `task.comment.*` en tablero y detalle.
- **Terminado cuando:** test con eventos simulados.

### Bloque F: log y administración

### [x] Fase 39 — Vista de log del proyecto
- **Alcance:** grupos con filtros por estado y nivel y detalle del grupo, como `LogView.vue` y `LogGroupPanel.vue`.
- **Terminado cuando:** tests de lista y filtros.

### [x] Fase 40 — Integraciones del proyecto
- **Alcance:** fuentes de log: crear, rotar y revocar, mostrando la key una sola vez (como `IntegrationsView.vue`).
- **Terminado cuando:** tests por rol.

### [x] Fase 41 — Miembros del proyecto
- **Alcance:** agregar y quitar miembros (como `ProjectMembersDialog.vue`).
- **Terminado cuando:** tests por rol.

### [x] Fase 42 — Miembros de la organización
- **Alcance:** lista, cambio de rol, quitar y transferir la propiedad (como `MembersView.vue`).
- **Terminado cuando:** tests por rol.

### [x] Fase 43 — Invitaciones
- **Alcance:** invitar, listar y revocar (como `InvitationsView.vue`). Aceptar una invitación sigue en la web.
- **Terminado cuando:** tests por rol.

### Bloque G: distribución

### [x] Fase 44 — Identidad visual
- **Alcance:** ícono, ícono adaptativo, splash y colores del tema de la web.
- **Terminado cuando:** el build muestra ícono y splash de Sereno.

### [x] Fase 45 — Perfiles de build y EAS Update [riesgo]
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
- 2026-10-14 — Proyecto de EAS creado por el usuario en expo.dev: id `13898f47-6f81-4a6d-82e3-2b8e1b3a667d`. La fase 6 lo
  vincula con `npx eas-cli init --id <id>` desde `app/` (no crear otro proyecto de EAS).
- 2026-10-14 — Fase 8: el i18n de la app queda como módulo; su conexión al arranque, el idioma de la cuenta y la persistencia
  de la elección manual pasan a la fase 9.
- 2026-10-14 — Aceptar invitaciones sigue en la web (no hay deep links de `sereno.ascario.dev` en esta versión).
- 2026-10-14 — Fase 12: la organización activa sigue a la web: la guardada si sigue en la lista, si no la primera.
- 2026-10-14 — Fase 14: la app edita name/key/description y archiva proyectos (`POST /api/projects/{id}/archive`), que la
  web no ofrece; el toggle `tasks_resolve_log_groups` de `ProjectHeader.vue` queda como mejora. Los cambios del store de
  proyectos aún no se protegen de una `load` en vuelo (la web usa `recentUpdates`): la fase 15, al sumar sockets, lo resuelve.
- 2026-10-14 — Fase 15: `pusher-js/react-native` exige `@react-native-community/netinfo` (12.0.1, vía `npx expo install`);
  se acepta como dependencia. `refreshCounts` se porta en las fases 21 y 39; `useMembershipWatch` de la web (revocación,
  cambio de rol) no está en ninguna fase y queda como mejora.
- 2026-10-14 — Fase 17 (por la elección "Paridad con la web"): la web no renderiza markdown en el chat (`MessageBody.vue`:
  texto plano con chips de mención); solo en tareas y comentarios (`MarkdownContent.vue`). La app hace lo mismo: el chat
  usa `MessageBody` con menciones y la fase 17 deja además `MarkdownContent` RN (markdown-it) para las fases 34 y 36.
- 2026-10-14 — Fase 23 dividida en 23a (contadores y resumen en el canal) y 23b (pantalla de hilo): pasaba de ~8 archivos.
- 2026-10-14 — Fase 26: el estado del grupo (`messages/logGroups.ts`) no porta `forgetGroupTask` ni
  `taskWrittenAt`/`dropGroupTaskNotWrittenSince` (sin store de tareas ni hourly counts); un aviso viejo puede ofrecer
  "Crear tarea" y el 422 `log_group_id` lo resuelve. La fase 33 enlaza el chip a la tarea y suma `forgetGroupTask`.
- 2026-10-14 — Fase 28: la app escucha `.mention.removed` (`users.{id}`, emitido por `MentionRemoved`), que la web no
  escucha; `removedMentions` evita que una carga en vuelo reviva la fila. Mejora candidata para la web.
- 2026-10-14 — Las fases 30 a 32 (push) esperan a que el usuario cree Firebase y suba la credencial FCM V1 a EAS; con su
  ok se sigue con la 33 en adelante y se vuelve a la 30 cuando avise.
- Fase 44: ícono y splash quedan configurados; verlos en el dispositivo se hace con el dev build de la fase 30. La fase 45 va después de la 30 porque ambas escriben `eas.json` y su criterio necesita builds del usuario.
- 2026-10-15 — Fase 30: el aviso de prueba con la herramienta de push de Expo pasa a la 31 (necesita `expo-notifications` y un dev build nuevo). `eas.json` y `.easignore` quedan en el repo; la 45 suma los perfiles `preview` y `production`.
- 2026-10-15 — Fase 31: Android 13+ reporta `denied` antes del primer pedido, así que el pedido automático usa `!granted && canAskAgain` y una marca por instalación `sereno.pushPrompted` en secure-store (no se borra al cerrar sesión). La marca se escribe antes del diálogo: si el sistema mata la app con el diálogo abierto no se vuelve a pedir solo y queda el botón de Ajustes. Cerrar la app con `am kill` (no `force-stop`, que bloquea FCM) para probar push con la app cerrada.
- 2026-10-15 — Fase 32: en el dev build el toque con la app cerrada abre el lanzador del dev client y la respuesta del aviso se pierde; segundo plano y primer plano verificados. El arranque en frío se verifica en la fase 45 con el build `preview`. Un push de chat abre el canal o el hilo, sin hacer scroll al mensaje.
- 2026-10-15 — Fase 45: las `EXPO_PUBLIC_*` van como variables de los entornos `preview` y `production` de EAS (`eas env:set`), no en el bloque `env` de `eas.json`, porque `eas update` no lo lee y exige `--environment`. `runtimeVersion` con policy `appVersion`: tras un cambio nativo se sube `version`. preview y production comparten paquete: desinstalar antes de cambiar de uno a otro.
- 2026-10-16 — Usuario: la fase 46 (entrega del APK de producción) queda para después de un rediseño completo de la app. `app/google-services.json` se versiona (config cliente de Firebase, no es secreto).

## Notas para la próxima sesión
- Fase 45 hecha: perfiles `preview` y `production` (APK interno), `expo-updates` con `runtimeVersion` appVersion y canales por perfil; las `EXPO_PUBLIC_*` en los entornos de EAS. Probado con el build `preview` contra producción: login, tiempo real, push con la app cerrada que abre la tarea (pendiente de la 32) y tres updates aplicados en el segundo arranque. Retrabajo: import de Pusher en React Native y clave de Reverb equivocada en EAS (L-99). Siguiente: 46 [manual], APK de producción para el equipo.
- Fase 32 hecha: `app/src/push/open.ts` traduce `data.url` + `organizationId` a `/task`, `/thread` o `/channel`, cambia de organización si hace falta y no muestra aviso en primer plano. Retrabajo: navegar en el montaje crasheaba en Android (L-98). Pendiente de la 45: probar el toque con la app cerrada en el build `preview`. Siguiente: 45 `[riesgo]` (perfiles `preview` y `production` y EAS Update; necesita builds del usuario).

## Mejoras propuestas
<!-- Sugerencias que surgieron y NO se implementaron. Se aplican después con /aplicar-mejoras. -->
- [x] M-1: Tests de `ExpoPushTokenApiTest` para la rama 403 con token transitorio y para `device_name` nulo y `max:255`.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-2: Consultar los recibos de Expo (`/push/getReceipts`, a los ~15 min) guardando los ids de ticket, para purgar tokens
      con `DeviceNotRegistered` que el ticket no reporta. Sin esto los tokens muertos se purgan poco.
      Complejidad: alta · Archivos: 5+ (migración, job programado, emisor) · Riesgo: BD → plan nuevo
- [x] M-3: `ExpoPushSender`: tratar un ticket ausente (200 truncado) como FAILED y no REJECTED; test de `MismatchSenderId`.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-4: `SendPushNotification`: envolver cada canal (web y Expo) en try/catch con `report`, para que una excepción de un
      emisor (p. ej. claves VAPID inválidas en `makeWebPush`) no deje sin enviar el otro ni pierda sus FAILED. Con test.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-5: Log "gave up" de `SendPushNotification`: omitir la lista del canal que no falló (hoy sale `subscriptions: []`).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-6: Quitar restos de la plantilla de Expo que no se usan: `assets/expo.icon/`, `ios.icon` y `web.output` en `app.json`,
      scripts `ios` y `web`, y dependencias sin uso (`react-native-web`, `react-dom`, `expo-glass-effect`, `expo-symbols`,
      `@expo/ui`, `expo-web-browser`, `expo-image` si nadie la usa). Verificar con typecheck, tests y `expo lint`.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [ ] M-7: `app/.vscode/settings.json` reordena imports y miembros al guardar para todos: dejar solo `extensions.json`.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-8: Cliente HTTP de la app: tests de timeout y cancelación con un `AbortSignal` real y de `buildUrl` con `?` en el path;
      mover `FieldErrors` a `src/api/types.ts` cuando existan más tipos.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → haiku
- [ ] M-9: `login` de la app: si falla la escritura del token, borrarlo de disco solo si `mine === generation` o no hay token en
      memoria (hoy un login más nuevo podría perder su token guardado; muy improbable); documentar que `fetchMe` aplica el idioma
      de la cuenta sobre la elección manual si `saveLocale` falló sin conexión, como la web.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-10: `login.tsx`: tras un login correcto el guard desmonta la pantalla, así que el aviso `common.localeSaveFailed` nunca se ve y el `finally` llama a `setSubmitting` ya desmontado. Mostrar el aviso fuera de la pantalla (toast global) o en la siguiente. Complejidad baja, sonnet.
- [ ] M-11: Pasar los colores en línea (`#c0392b`, `#1f2937`) de login e inicio a un tema compartido cuando haya más pantallas. Complejidad baja, sonnet.
- [ ] M-12: `npm run typecheck` depende de `app/.expo/types/router.d.ts` (ignorado por git, lo genera `expo start`): en un clon limpio o en CI falla con rutas nuevas. Generarlo antes del typecheck (p. ej. `expo customize`/`npx expo start` previo o un script) o documentarlo. Complejidad baja, sonnet.
- [ ] M-13: `register.closedError` repite el texto de `register.closed` en `en.json` y `es.json`: dejar una sola clave. Complejidad baja, sonnet.
- [ ] M-14: Reintentar una carga fallida de organizaciones con sesión deja la pantalla en blanco (`_layout` devuelve null) hasta que se resuelve: mostrar un indicador de carga. Complejidad baja, sonnet.
- [ ] M-15: Toggle `tasks_resolve_log_groups` en el formulario del proyecto, como `ProjectHeader.vue`. Complejidad baja, sonnet.
- [ ] M-16: Tests de error de `archive` (403 y red) en `projectForm.test.tsx`. Complejidad baja, sonnet.
- [ ] M-17: Portar `useMembershipWatch` de la web (revocación de acceso, cambio de rol, `onChannelDenied`): la app hoy solo recarga proyectos. Complejidad media, sonnet.
- [ ] M-18: Documentar `EXPO_PUBLIC_REVERB_APP_KEY`, `_HOST`, `_PORT` y `_SCHEME` de la app (en `app/.env.example` o en CLAUDE.md, sección App móvil): sin la clave Echo queda null en silencio. Complejidad baja, sonnet.
- [ ] M-19: Tablas de markdown: la app las pinta como texto suelto y la web las descarta (DOMPurify). Decidir y alinear (p. ej. `md.disable('table')` en ambos lados). Complejidad baja, sonnet.
- [ ] M-20: Sumar `intent:` y `data:` al test de esquemas no permitidos de `markdownContent.test.tsx`; tipar `Message.mentions` como opcional o confirmar que la API siempre lo manda. Complejidad baja, sonnet.
- [ ] M-21: Quitar el aviso de `act(...)` que deja `loadOlder` en `channel.test.tsx`. Complejidad baja, sonnet.
- [ ] M-22: Sparkline de eventos por hora en la tarjeta del aviso (`/log-groups/hourly`), como `SystemNotice.vue`; no está en ninguna fase. Complejidad media, sonnet.
- [ ] M-23: Avisos de sistema: quitar la clave sin uso `channel.notice`, tests de `status_changed` sin título y de nivel o estado desconocido, y confirmar contra la web qué se muestra con un aviso con `deleted_at`. Complejidad baja, sonnet.
- [ ] M-24: Negritas en actor y estado de las líneas de aviso con `Trans` de react-i18next, como `i18n-t` en la web. Complejidad baja, sonnet.
- [ ] M-25: Ocultar el compositor en canales archivados (`archived_at` de `ChannelResource`, pasarlo a la pantalla del canal), como la web. Complejidad baja, sonnet.
- [ ] M-26: Envolver el canal en `KeyboardAvoidingView` (o el equivalente de Expo) si en el teléfono el teclado tapa el compositor. Complejidad baja, sonnet.
- [ ] M-27: Tests de `app/src/projects/members.ts` (TTL, dedupe en vuelo, vaciado al cambiar de organización). Complejidad baja, sonnet.
- [ ] M-28: `catchUp` sale si `loading`; la web solo si `hasNewer`. Si la carga de `open` falla y hay reconexión, no se recupera nada. Complejidad baja, sonnet.
- [ ] M-29: Tests de errores 404/422/429 del borrado y del `catchUp` en 404 (borrar y editar) en `messageActions.test.tsx`; tipar `t` de `deleteMessage` con `TFunction`. Complejidad baja, sonnet.
- [ ] M-30: Store de mensajes: separar el tope de 200 de `deletedRoots` (al expulsar una entrada un snapshot tardío puede resucitar la raíz; la web solo limita `unloadedDeletions`) y sumar la guarda `listVersion` en `loadOlder` como la web. Complejidad baja, sonnet.
- [x] M-31: `settle` debe vaciar `attachments` al borrar, como `asDeleted` de la web (cuando lleguen los adjuntos, fase 24). Complejidad baja, sonnet.
- [ ] M-32: `threadStore.catchUp` relanza errores que no son `ApiError`/`AbortError` y se llama con `void`: tragarlos como la web para evitar rechazos sin capturar. Complejidad baja, sonnet.
- [ ] M-33: Conservar el borrador de la respuesta del hilo entre aperturas de la misma raíz (`draft` de la web) y usar selectores en `thread.tsx`. Complejidad baja, sonnet.
- [ ] M-34: Un 422 de `attachment_ids` al enviar muestra el mensaje genérico: mostrar `errors.attachment_ids[0]`; test directo de `attachment_ids` en `send` del store del canal. Complejidad baja, sonnet.
- [ ] M-35: `TaskCreateModal`: lista de miembros en un `ScrollView` con altura máxima y comprobar en el teléfono que el teclado no tapa el modal. Complejidad baja, sonnet.
- [ ] M-36: Enfocar el mensaje mencionado al abrir una notificación `chat_mention` de primer nivel (la web usa `?message=`; la app necesita abrir el canal "around"). Complejidad media, sonnet.
- [ ] M-37: `notifications/store.ts`: condicionar el `refresh()` del cambio de organización a que el store esté iniciado (como `live` en la web), podar `removedMentions` en sesiones largas y sumar tests de `loadMore` filtrado por `removedMentions` y de cambio de organización con el store iniciado. Complejidad baja, sonnet.
- [ ] M-38: Web: escuchar `.mention.removed` en el store de notificaciones (hoy solo se entera al refrescar), como la app. Complejidad media, sonnet.
- [ ] M-39: Ajustes: test de que el idioma se guarda en SecureStore (`LOCALE_STORAGE_KEY`), del interruptor deshabilitado mientras guarda, y contenedor `radiogroup` para los botones de idioma. Complejidad baja, sonnet.
- [ ] M-40: Tablero de tareas: acceso desde la pantalla del canal (hoy solo desde la tarjeta del proyecto y el chip del aviso). Complejidad baja, sonnet.
- [ ] M-41: Detalle de tarea: checklist del markdown interactiva (`toggleTaskItem` de la web); hoy la descripción se muestra solo lectura. Complejidad media, sonnet.
- [ ] M-42: Tareas: pasar prettier a `app/tasks.tsx` (import sin `;`, `TaskCard` sin indentar), mostrar `error.message` en el 422 de mover como `moveErrorMessage` de la web, proteger `setDeleting` tras cerrar en `task.tsx` y quitar los avisos "overlapping act() calls" de `taskMove.test.tsx`. Complejidad baja, sonnet.
- [ ] M-43: Tests de la app: quitar el aviso que imprime `src/projects/members.ts:46` en jest (probable mock de miembros incompleto). Complejidad baja, sonnet.
- [ ] M-44: Quitar adjuntos al editar un comentario de tarea y un mensaje del chat (`remove_attachment_ids`, como `TaskCommentEditor` de la web); hoy el editor de la app no los toca. Complejidad media, sonnet.
- [ ] M-45: Extraer el bloque de selector y lista de subidas duplicado entre `MessageComposer` y `TaskComments`, y renombrar el parámetro `channelId` de `useAttachmentUploads` a `scopeId`. Complejidad baja, sonnet.
- [ ] M-46: Tareas en vivo: `setCommentsCount` que llega con una recarga en vuelo puede quedar pisado por el contador de la respuesta (igual en la web), test directo de `fetchAll` con una tarea en tombstone que el servidor sigue devolviendo, y quitar los avisos de `act` de `taskForm.test.tsx`. Complejidad baja, sonnet.
- [ ] M-47: Log: sparklines de actividad por hora (`getHourlyCounts`) en la lista y el detalle, como la web. Complejidad media, sonnet.
- [ ] M-48: Log: `loadMore` no debe cancelar un `refresh` en curso tras cambiar el estado desde el detalle (si no, la página siguiente se salta filas hasta el próximo refresh); y que el test "does not skip rows" espere el refresh con `waitFor`. Complejidad baja, sonnet.
- [ ] M-49: Integraciones: botón "Copiar" para la key y los comandos (requiere `npx expo install expo-clipboard`, con aprobación del usuario), curl de ejemplo como la web, test del botón "Integrations" de la tarjeta y ocultar la key al pasar a segundo plano (FLAG_SECURE o similar). Complejidad media, sonnet.
- [ ] M-50: Cablear `onMembersChanged` a `useMemberDirectoryStore.invalidate` en las pantallas de canal, tareas y log, como `ChannelView.vue:340`, `PlanView.vue:151` y `LogView.vue:238` (hoy menciones y asignados tardan hasta 5 min); tests de `clear()` e `invalidate()` sin id. Complejidad baja, sonnet.
- [ ] M-51: App: centralizar los colores en un tema (`app/src/theme.ts`) alineado con `web/src/style.css` y quitar `ios.icon` de plantilla (`./assets/expo.icon`) de `app.json`. Complejidad media, sonnet.
- [ ] M-52: `pushDevice.test.tsx`: resetear `secureStore.getItemAsync` en el `beforeEach` (`mockReset().mockResolvedValue(null)`); hoy el `'1'` de un test se filtra a los siguientes. Baja, sonnet.
- [ ] M-53: test de que un fallo al escribir la marca `sereno.pushPrompted` no pide el permiso y se reintenta al volver. Baja, sonnet.
- [ ] M-54: los íconos de la barra de pestañas se ven como cuadros vacíos (tofu) en el dev build de Android; revisar la fuente o el paquete de símbolos que usan. Media, sonnet.
- [ ] M-55: abrir el push de chat en el mensaje concreto (`?message=`) con scroll, y pasar el nombre del canal en el payload para el título. Media, sonnet.
- [ ] M-56: si la carga de organizaciones falla, el toque del aviso se consume sin avisar; reintentar o avisar. Baja, sonnet.
- [ ] M-57: acortar el comentario de `pushDestination` en `app/src/push/open.ts`, que repite el nombre. Baja, sonnet.
- [ ] M-58: `autoIncrement` también en el perfil `preview` de `app/eas.json`, para que un preview no choque por downgrade con un production más nuevo. Baja, sonnet.
