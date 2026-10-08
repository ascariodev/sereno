# Plan: ui-calma

**Objetivo:** `workspace-web` con el diseño «Calma»: tema claro y oscuro, barra lateral, canal con tarjetas de aviso y panel de
detalle del grupo, vista Log, Inicio, Login y layout móvil, sobre Reka UI envuelto en componentes propios y fluido con canales grandes.
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Repo: `workspace-web` (commits con `git -C workspace-web`). La fase 25 usa el API en Docker solo para cargar datos.
- Diseño de referencia: `docs/diseno/calma/*.dc.html` (copia de los artboards del canvas
  https://claude.ai/artifact/PMrVLMBpQXzFVkyNyrVzJL). Son HTML con estilos en línea: sacar de ahí medidas, colores y estructura,
  no copiar el markup (el formato `<x-dc>`, `sc-for` y `{{ }}` es del canvas, no de Vue). `Foundations.dc.html` tiene los tokens.
- Tokens (claro / oscuro): fondo `#F3F4F6`/`#0F1114`, superficie `#FFFFFF`/`#171A1F`, tinta `#15171C`/`#ECEEF2`,
  tinta-2 `#4A5160`/`#B4BAC4`, tinta-3 `#626976`/`#8A919C`, borde `#E5E7EB`/`#2A2F37`, acento `#4B4FD8`/`#6E71E8`,
  acento suave `#EEEEFD`/`#23244A`, texto de acento `#3A3DB8`/`#A9ABF5`. Niveles y estados en ambos temas: `Foundations.dc.html`
  (`levels`, `levelsDark` y las pastillas de estado). Radios 6 chip, 9 control, 12 tarjeta, 14 panel, 999 pastilla; espaciado 4/8/12/16/24/32.
- Fuentes: Figtree (interfaz) y JetBrains Mono (todo lo que viene de los sistemas: títulos de grupos, contexto, claves de proyecto).
- Estado actual de la web (exploración del 2026-10-07): `style.css` casi vacío, sin fuentes ni librerías de UI. Rutas `/login`,
  `/session-error`, `/` (ProjectsView) y `/channels/:id` (ChannelView) dentro de `AppLayout` (header con `<select name=organization>`
  y `button[name=logout]`). `ProjectsView` carga proyectos (todas las páginas) y canales; `ChannelView` busca el canal en
  `GET channels?include_archived=1`. Store `messages` con `ref` y orden ascendente por id; `insert` dedupe por id.
  `api/logGroups.ts` solo tiene el PATCH.
- API disponible para grupos: `GET projects/{p}/log-groups` (filtros `status`, `level` = nivel mínimo, `per_page`; paginado por
  páginas, orden `last_seen_at` desc) y `GET projects/{p}/log-groups/{g}` con `events` (50 más nuevos). LogGroupResource:
  `id, project_id, level, title, status, events_count, first_seen_at, last_seen_at, events?`. LogEventResource:
  `id, level, message, context, occurred_at, received_at`. Leer los Resources antes de tipar (L-09).
- Los tests usan selectores que hay que conservar o actualizar a propósito: `button[name=resolve|ignore|send|load-older|logout|retry]`,
  `textarea[name=body]`, `input[name=email|password]`, `[data-test=error-*]`, `[role=alert]`, `h1`, `strong` del autor.
- Dependencias nuevas aprobadas por el usuario: `reka-ui` (2.11), `@lucide/vue` (no `lucide-vue-next`, que quedó en 1.0),
  `@fontsource-variable/figtree` y `@fontsource-variable/jetbrains-mono` (5.3). Sin Tailwind.

## Fases

### [x] Fase 1 — Tokens, fuentes y dependencias
- **Alcance:** instalar las cuatro dependencias. `style.css`: variables de los tokens en `:root` (claro, `color-scheme: light`),
  las oscuras en `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }` y repetidas en
  `:root[data-theme="dark"]`; reset mínimo (box-sizing, márgenes, `font: inherit` en controles), cuerpo con fondo y tinta de los
  tokens, Figtree 14px/1.45. `main.ts` importa las dos fuentes. Todavía sin cambiar componentes.
- **Archivos:** `package.json` (+ lock), `src/main.ts`, `src/style.css`.
- **Terminado cuando:** `src/style.spec.ts` lee `style.css` y comprueba que el bloque claro y los dos oscuros definen exactamente
  el mismo conjunto de variables (y que no está vacío, L-01); typecheck, tests y build pasan.

### [x] Fase 2 — Preferencia de tema
- **Alcance:** `src/theme/theme.ts`: preferencia `system | light | dark` en `localStorage['workspace.theme']` (try/catch), aplica o
  quita `data-theme` en `<html>`; script en línea en `index.html` que la aplica antes de pintar (sin parpadeo).
- **Archivos:** `src/theme/theme.ts`, `index.html`, `src/main.ts`. **Terminado cuando:** tests de leer, guardar, aplicar y valor inválido.

### [x] Fase 3 — Piezas visuales simples
- **Alcance:** `LevelPill` (8 niveles, texto por i18n `notice.level.*`, suave hasta error y sólida desde crítico), `StatusPill`,
  `AppAvatar` (iniciales y color estable por id), `ProjectKey`. Sin Reka.
- **Archivos:** `src/components/ui/` (4 componentes). **Terminado cuando:** tests de texto, nivel desconocido e iniciales.

### [x] Fase 4 — Envoltorios AppMenu y AppTooltip [riesgo]
- **Alcance:** primeros envoltorios de Reka UI con API propia (`items`, `@select`; tooltip con `text`), transición solo con
  `transform`/`opacity`. Confirma que Reka funciona en jsdom; si no, anotar en Decisiones cómo se prueba.
- **Archivos:** `src/components/ui/AppMenu.vue`, `AppTooltip.vue`. **Terminado cuando:** tests por rol y teclado (abre, flechas, Enter elige, Escape cierra y devuelve el foco).

### [x] Fase 5 — Store de proyectos
- **Alcance:** extraer de `ProjectsView` la carga de proyectos y canales a `stores/projects.ts` (lista, mapa proyecto→canal,
  recarga al cambiar de organización, descarta respuestas viejas L-10) para que la usen la barra lateral y la cabecera.
- **Archivos:** `src/stores/projects.ts`, `src/views/ProjectsView.vue`. **Terminado cuando:** tests del store; los de ProjectsView siguen pasando.

### [x] Fase 6 — Barra lateral
- **Alcance:** `AppLayout` pasa a barra lateral + contenido en tarjeta (flex-wrap: en angosto se apila). `AppSidebar`: Inicio,
  lista de proyectos con clave y activo, usuario abajo. El `<select>` de organización y el logout se mudan tal cual a la barra.
- **Archivos:** `src/layouts/AppLayout.vue`, `src/components/AppSidebar.vue`, `src/i18n/en.json`, `src/i18n/es.json`.
- **Terminado cuando:** tests del layout actualizados (proyecto activo marcado con `aria-current`).

### [x] Fase 7 — Menús de organización y de usuario [límite: 5 archivos]
- **Alcance:** `OrgSwitcher` (AppMenu, reemplaza el `<select>`) y `UserMenu` (tema sistema/claro/oscuro y cerrar sesión).
- **Archivos:** `src/components/OrgSwitcher.vue`, `src/components/UserMenu.vue`, `src/components/AppSidebar.vue`, `src/i18n/*.json`.
- **Terminado cuando:** tests: cambiar de organización por el menú, cerrar sesión, elegir tema.

### [x] Fase 8 — Cabecera del proyecto
- Clave, nombre y descripción del proyecto sobre el canal (`ProjectHeader`, datos del store de proyectos). Archivos:
  `ProjectHeader.vue`, `ChannelView.vue`, i18n. Terminado: test de la cabecera; los de ChannelView pasan.

### [x] Fase 9 — Mensajes de persona
- `MessageItem` (avatar, autor en `strong`, hora corta con fecha completa en AppTooltip) y separadores de día en `MessageList`.
  Archivos: `MessageItem.vue`, `MessageList.vue`, i18n. Terminado: tests de separador "Hoy"/fecha y de autor.

### [x] Fase 10 — Tarjeta de aviso
- `SystemNotice` como tarjeta (LevelPill, título en mono, eventos, botones con ícono conservando `name`) y línea compacta para el
  cambio de estado; emite `select` y `MessageList` lo reenvía. Archivos: `SystemNotice.vue`, `MessageList.vue`, i18n. Terminado: tests existentes + `select`.

### [x] Fase 11 — Cliente de grupos de logs
- `listLogGroups(projectId, {status, level, page})`, `getLogGroup(projectId, id)` y tipos `LogGroup`/`LogEvent` leídos de los
  Resources. Archivos: `api/logGroups.ts`, `api/types.ts`. Terminado: tests con fetch simulado.

### [x] Fase 12 — Panel de detalle del grupo
- `LogGroupPanel` (pastillas, conteos, primera/última vez, último evento con contexto, acciones) abierto por `?group=` en
  `ChannelView`; se recarga cuando llega un cambio de estado de ese grupo. Archivos: `LogGroupPanel.vue`, `ChannelView.vue`, i18n.
  Terminado: tests de carga, acción y recarga por tiempo real.

### [x] Fase 13 — Composer
- Caja con borde, pista de teclado y botón de enviar con ícono; mismo comportamiento. Archivos: `MessageComposer.vue`, i18n.
  Terminado: tests existentes pasan.

### [x] Fase 14 — Lista de mensajes fluida [riesgo]
- Store `messages` con `shallowRef` (reemplazo de arreglo, no mutación) y `insert` que agrupa lo que llega en el mismo tick en
  una sola actualización. Archivos: `stores/messages.ts`. Terminado: tests actuales + ráfaga de 200 inserts: orden, sin duplicados, un solo flush.

### [x] Fase 15 — Envoltorio AppSegmented
- Selector segmentado (ToggleGroup de Reka) para filtros y ES/EN. Archivos: `components/ui/AppSegmented.vue`. Terminado: tests de flechas y `aria-pressed`.

### [x] Fase 16 — Vista Log [límite: 5 archivos]
- Ruta `projects/:projectId/log`, `LogView` (filtro de estado con AppSegmented, nivel con `<select>` nativo, tabla paginada en
  caja con scroll horizontal, fila abre el panel) y pestañas Canal/Log en `ProjectHeader` como enlaces con `aria-current`.
  Archivos: `LogView.vue`, `router/index.ts`, `ProjectHeader.vue`, i18n. Terminado: tests de filtros, paginación y navegación.

### [x] Fase 17 — Inicio
- Saludo, rejilla de `ProjectCard` y estado vacío. Archivos: `ProjectsView.vue`, `ProjectCard.vue`, i18n. Terminado: tests de ProjectsView actualizados.

### [x] Fase 18 — Login
- Dos columnas (se apilan en angosto) y ES/EN antes de iniciar sesión, guardado en `localStorage['workspace.locale']` y usado por
  `Accept-Language`. Archivos: `LoginView.vue`, `i18n/index.ts`, i18n. Terminado: tests de LoginView y de la elección de idioma.

### [x] Fase 19 — Envoltorio AppDialog [riesgo]
- Diálogo modal con variantes centrado y hoja lateral/inferior; foco atrapado y devuelto; transición `transform`/`opacity`.
  Archivos: `components/ui/AppDialog.vue`. Terminado: tests de Escape, foco y `aria-labelledby`.

### [x] Fase 20 — Layout móvil
- Bajo 768 px: barra superior con botón que abre la barra lateral en AppDialog (hoja). Archivos: `AppLayout.vue`,
  `MobileTopBar.vue`, i18n. Terminado: test del cajón; revisión manual a 390 px en claro y oscuro.

### [x] Fase 21 — Panel de detalle como hoja en móvil
- `LogGroupAside`: `<aside>` en escritorio, hoja de AppDialog en angosto. Archivos: `LogGroupAside.vue`, `ChannelView.vue`, `LogView.vue`. Terminado: tests de ambas variantes.

### [x] Fase 22 — Paleta Ctrl K [riesgo] [límite: 5 archivos]
- `AppCommand` (Dialog + Combobox de Reka) y `CommandPalette`: ir al canal o al log de un proyecto y cambiar el tema; botón
  Buscar en la barra. Archivos: `ui/AppCommand.vue`, `CommandPalette.vue`, `AppSidebar.vue`, i18n. Terminado: tests de atajo, filtro y navegación.

### [x] Fase 23 — Envoltorio de toasts
- `AppToast` + `ui/toast.ts` (API `toast.success/error`) montado en `App.vue`. Terminado: tests de mostrar, cerrar y región `aria-live`.

### [x] Fase 24 — Uso de toasts
- Confirmación al resolver/ignorar desde el panel y aviso "Reconectado" tras `onReconnect`. Archivos: `LogGroupPanel.vue`,
  `ChannelView.vue`, i18n. Terminado: tests.

### [x] Fase 25 — Prueba de fluidez [riesgo]
- Sin código de la app: crear 1000 mensajes en un canal (tinker) y una ráfaga de 200 eventos con huellas distintas por
  `POST /api/ingest/events`; medir con el panel Performance. Terminado: sin tareas largas >50 ms al hacer scroll ni >100 ms
  durante la ráfaga, resultado anotado en Notas. Si falla: virtualizar (M-4) antes de cerrar el plan.

## Decisiones
- 2026-10-07 — Usuario: Reka UI como primitivas sin estilos + CSS propio con tokens en variables; sin Tailwind; íconos `@lucide/vue`.
- 2026-10-07 — Usuario: Reka UI solo dentro de `src/components/ui/` con API propia; vistas y componentes de dominio nunca lo
  importan. Estilos con clases propias (las reglas sobre `data-state` de Reka viven solo en el CSS del envoltorio). Tests por rol, texto y teclado.
- 2026-10-07 — Usuario: tema según el sistema, con elección manual guardada en `localStorage['workspace.theme']`.
- 2026-10-07 — Fuentes autohospedadas con `@fontsource-variable` (no Google Fonts): la PWA y Tauri funcionan sin red y no se filtran visitas a terceros.
- 2026-10-07 — Las pestañas Canal/Log son rutas (`RouterLink` con `aria-current`), no Tabs de Reka; el filtro de nivel es `<select>` nativo.
- 2026-10-07 — Rendimiento: `shallowRef` y agrupado de ráfagas en el store de mensajes; componentes por mensaje simples
  (`key` por id, valores en `computed`); animaciones solo `transform`/`opacity`; virtualizar solo si la fase 25 lo pide.
- 2026-10-07 — Fuera de este plan (no hay API o es de otro paso): Crear tarea y Plan (paso 7), hilos, menciones y adjuntos
  (paso 6), "Avisos abiertos" y "Menciones" globales, buscador de mensajes. En móvil, cajón lateral en vez de la barra inferior del diseño hasta que existan esas vistas.
- 2026-10-07 — Fase 1: versiones instaladas `reka-ui` 2.11.0, `@lucide/vue` 1.52.0, fontsource 5.3.0. Familias
  `'Figtree Variable'` y `'JetBrains Mono Variable'` (`--font-sans`, `--font-mono`). Los tokens de color van en tres bloques
  con el mismo conjunto (claro y dos oscuros); radios, espaciado y fuentes en un `:root` aparte que no depende del tema.
  Los specs que leen archivos usan `readFileSync` + `process.cwd()` y `/// <reference types="node" />` (`tsconfig.app` solo
  carga `vite/client`).
- 2026-10-07 — Fase 2: `src/theme/theme.ts` exporta `readThemePreference`, `applyTheme`, `saveThemePreference` (guarda y
  aplica aunque falle el guardado) e `initTheme`. Las fases 7 y 22 cambian el tema con `saveThemePreference`.
- 2026-10-07 — Fase 3: `LevelPill`/`StatusPill` usan `notice.level.*`/`notice.status.*`; un valor desconocido muestra el
  texto crudo con tono neutro (`debug`/`ignored`) y exponen `data-level`/`data-status`. `AppAvatar` (`name`, `id`, `size`)
  usa los 3 colores fijos de `Plan.dc.html` por `id mod 3` (sin variante oscura) y es `aria-hidden`. `ProjectKey` (`value`).
- 2026-10-07 — Fase 4: Reka funciona en jsdom sin mocks: montar con `attachTo: document.body`, buscar en `document`, disparar
  `KeyboardEvent` sobre `document.activeElement` y esperar `flushPromises` + `nextTick` + `setTimeout(0)` (FocusScope devuelve
  el foco en un timeout); al final `unmount` y vaciar el body. `AppMenu`: `items` (`value`, `label`, `icon?`, `disabled?`,
  `danger?`), `align`, `side`, emite `select`; el slot es el disparador (`<button>` propio, `as-child`); no modal.
  `AppTooltip`: `text`, `side` (`top`), `delay` (400). Los estilos de los envoltorios van sin `scoped` con prefijo
  (`.app-menu`, `.app-tooltip`) porque el contenido se monta en el body; la sombra del menú se tomó de la tarjeta de Login.
- 2026-10-07 — Fase 5: `useProjectsStore` expone `projects`, `channelByProject`, `loading`, `failed`, `reload()` y `clear()`;
  vigila `organization.activeId` (`immediate`): `null` limpia sin pedir, si no recarga. El logout lo limpia por esa cadena.
- 2026-10-07 — Fase 6: `AppSidebar` es dueño de `select[name=organization]`, `button[name=logout]` y del logout; `AppLayout`
  conserva la carga de organizaciones y el `flex-wrap`. Cada proyecto enlaza a su canal (`channelByProject`); sin canal, `span`
  atenuado. `aria-current` lo pone `RouterLink` por ruta exacta: **la fase 16 debe calcular el proyecto activo** (desde
  `route.params`) para que `projects/:id/log` también lo marque. Íconos de `@lucide/vue` (`House`, `LogOut`).
- 2026-10-07 — Fase 7: `OrgSwitcher` (disparador `button[name=organization]`, oculto sin organizaciones) y `UserMenu`
  (disparador `button[name=user-menu]`, ítems `theme:system|light|dark` y `logout`). El selector de logout pasó a
  `[role=menuitem][data-value="logout"]` (ya no existe `button[name=logout]`). Los specs que montan `AppLayout` usan
  `attachTo: document.body`.
- 2026-10-07 — Fase 8: `ProjectHeader` (`name`, `projectKey`, `description`, `channelName`; slots `tabs` y `actions` para la
  fase 16). `ChannelView` toma el proyecto de `useProjectsStore` con respaldo en `channel.project`. Los specs de `ChannelView`
  mockean `/api/projects` y cuentan solo las llamadas de la vista con el helper `viewCalls`.
- 2026-10-07 — Fase 9: `MessageItem` (`message`) solo para mensajes de persona; `MessageList` decide entre él y
  `SystemNotice`. Hora en `<time tabindex=0>` con `AppTooltip`. Los separadores son `<li class="message-list__day">`
  calculados en un `computed` (keys `day-<día local>` / `message-<id>`): los specs cuentan mensajes con `li.message`. Los
  tests de fechas fijan `process.env.TZ` y `vi.setSystemTime` (TZ en runtime sí afecta a `Intl` en vitest).
- 2026-10-07 — Fase 10: el título del grupo en `SystemNotice` es `<a href="?group=<id>" @click.prevent>` que emite
  `select(groupId)` (no `button`: un test exige que no haya botones sin acciones); `MessageList` lo reenvía. Claves i18n
  `notice.openedLabel`, `reopenedLabel`, `eventsWord` (reemplazan `groupOpened`, `groupReopened`, `events`). Hora con
  `<time title>` sin parada de tab. Borde de tarjeta crítica con `color-mix` de tokens.
- 2026-10-07 — Fase 11: `listLogGroups(projectId, {status, level, page, perPage}, signal?)` → `Paginated<LogGroup>` (`level` es
  nivel mínimo); `getLogGroup(projectId, id)` desenvuelve `data`. `LogGroup.events` opcional (`whenLoaded`, solo en `show`).
- 2026-10-07 — Fase 12: `ChannelView` lee `?group=` (solo entero positivo); `select`/`close` hacen `router.push`.
  `LogGroupPanel` (`projectId`, `groupId`, `refreshToken`; emite `close`) descarta respuestas viejas con generación +
  `AbortController`. La recarga por tiempo real vigila `messages.messages.length` y sube `refreshToken` si llega un
  `log.group_status_changed` de ese grupo con id mayor que `seenMessageId` (se reinicia al terminar cada carga).
- 2026-10-07 — Fase 14: `messages` es `shallowRef` y solo se reemplaza. `insert` responde al momento si acepta, pero deja el
  mensaje en cola y la aplica en el siguiente microtask (una actualización por ráfaga); `open`, `catchUp`, `loadOlder` y
  `send` vacían la cola antes de leer o reemplazar, `clear` la descarta. Quien inserta ve el mensaje tras `nextTick`.
  `ChannelView` vigila la referencia del arreglo, no `length`.
- 2026-10-07 — Fase 15: `AppSegmented` (`v-model` string, `options` con `value`, `label`, `count?`, `disabled?`; `label`
  obligatorio como nombre del `role=group`). Selección única con `aria-pressed`; nunca queda vacío (descarta el `undefined`
  de Reka y también el valor `''`: no usar `''` como opción "todos"). En tests, esperar un tick tras montar antes de
  usar flechas (RovingFocus registra el manejador post-flush).
- 2026-10-07 — Fase 16: ruta `project-log` (`projects/:projectId/log`). Query `status` (`open` por defecto, `all` sin
  filtro), `level` (mínimo) y `page`; los inválidos se ignoran; cambiar un filtro hace `router.push` y borra `page`.
  Pestañas Canal/Log en el slot `tabs` de `ProjectHeader` (props `projectId`, `channelId`; Canal sin canal es `span`
  `aria-disabled`); `ProjectHeader` usa `useI18n`. `AppSidebar` calcula el proyecto activo desde `route.name`/`params` con
  `aria-current` explícito. La fila de la tabla abre el panel con un `<a>` dentro de la celda.
- 2026-10-07 — Fase 17: `h1` "Hello, {name}" (`projects.greeting`) con respaldo `projects.title`. `ProjectCard` (`project`,
  `channelId?`) es `RouterLink` al canal o `div` sin canal, con `aria-labelledby` al nombre y `aria-describedby` a la
  descripción (ids `project-<id>-name|description`). Rejilla `ul > li`.
- 2026-10-07 — Fase 18: idioma en la web: `users.locale` > `localStorage['workspace.locale']` > navegador > `en`.
  `chooseLocale()` guarda y aplica (la elección viaja en `Accept-Language`); `setLocale(user.locale)` aplica sin
  sobrescribir lo guardado; `setLocale(null)` vuelve a lo guardado. Login sin "¿La olvidaste?" ni placeholders (no hay
  recuperación de contraseña); panel derecho solo texto.
- 2026-10-07 — Fase 19: `AppDialog`: `v-model:open` (también no controlado), `title` obligatorio, `hideTitle`,
  `description?` (sin ella no hay `aria-describedby`), `variant` `center` | `sheet-right` | `sheet-bottom`, `closeLabel?`
  (botón `button[name=close-dialog]`, el texto lo traduce quien lo usa), slot `trigger` opcional, slot por defecto como
  cuerpo con scroll. Capas: diálogo 40/41, menú 50, tooltip 60. Sin `trigger`, el foco vuelve al elemento previo.
- 2026-10-07 — Fase 20: bajo 768 px (solo CSS, `max-width: 767px`) `.app-layout` pasa a columna sin wrap, la barra lateral
  de escritorio va en `display: none` y aparece `MobileTopBar` (`button[name=open-sidebar]`). El cajón es `AppDialog`
  `sheet-left` (variante nueva) con otro `AppSidebar` montado solo al abrir; cierra al hacer clic en un `<a>`, al cambiar
  `route.fullPath` o al pasar a ≥768 px (`matchMedia`). `index.html` con `viewport-fit=cover`.
- 2026-10-07 — Fase 21: `LogGroupAside` decide entre `<aside>` (escritorio) y `AppDialog` `sheet-bottom` (máx. 85dvh, título
  oculto `logGroup.label`) con `matchMedia('(max-width: 767px)')`, con limpieza y respaldo sin `matchMedia`. Un solo
  `LogGroupPanel` montado por modo; cerrar emite `close` y la vista quita `group` de la query.
- 2026-10-08 — Fase 22: `AppCommand` (sobre `AppDialog` centrado, título oculto) usa `ListboxRoot` + `ListboxFilter` de Reka,
  no Combobox (sin desplegable posicionado); el campo lleva `role=combobox` a mano. Props `v-model:open`, `title`,
  `placeholder`, `emptyText`, `groups` (`label`, `items`: `value`, `label`, `hint?`, `keywords?`, `icon?`); emite `select` y
  cierra. Filtro por todas las palabras, sin mayúsculas ni tildes. Valores de `CommandPalette`: `home`, `channel:<id>`,
  `log:<projectId>`, `theme:*`. `AppLayout.vue` (fuera de la lista) es dueño único de `paletteOpen` y monta la paleta una
  vez; abrirla cierra el cajón móvil. Atajo Ctrl/Meta K en `window`, sin repeat, Shift ni Alt. Botón `button[name=search]`.
- 2026-10-08 — Fase 23: `toast` en `ui/toast.ts`: `toast.success|error(message, { duration? })` devuelven id; `dismiss(id)`,
  `clear()`. 4000 ms éxito (polite), 6000 ms error (assertive), máximo 3 visibles (descarta el más antiguo). Estado propio
  sobre `ToastProvider`/`ToastRoot`/`ToastViewport` de Reka (pausa con puntero y foco). `AppToast` montado en `App.vue`,
  z-index 70, abajo a la derecha (`bottom: 88px`) y centrado bajo 768 px.
- 2026-10-08 — Fase 24: el panel confirma resolver/ignorar con `toast.success` (`notice.actions.marked`); el error de la
  acción pasa de línea a `toast.error` (mismos textos; `loadError` sigue en línea). `ChannelView` muestra
  `channel.reconnected` en `onReconnect` (no en la primera conexión). No hay alias `@/`: imports relativos.
- 2026-10-08 — Usuario: el producto se llama **Sereno** (antes Workspace) y la marca es la opción C del canvas (burbuja
  con pulso, fondo `#4B4FD8` fijo en ambos temas). `ui/BrandMark.vue` (prop `size`) en login, barra lateral y barra móvil;
  `app.name` en i18n; `public/favicon.svg` y `public/apple-touch-icon.png` (180, cuadrado). Las claves `workspace.*` de
  `localStorage` y los nombres internos (repos, contenedores, config `workspace.*`) se conservan. Íconos PWA en
  `public/icons/` (192, 512 y maskable 512 con el contenido al 85 % y fondo a sangre); fuentes en `brand/` (`icon.svg`,
  `icon-maskable.svg`, `icon-1024.png` para `tauri icon`). Falta `APP_NAME=Sereno` en los `.env` del API.
- 2026-10-08 — PWA: `public/manifest.webmanifest` (nginx lo sirve como `application/manifest+json`) y service worker
  propio sin dependencias: plantilla `pwa/sw.js` y plugin `pwa/serviceWorkerPlugin.ts` (solo en build) que emite
  `dist/sw.js` con el precache del build y de `public/` (sin fuentes) y versión por hash del contenido. Navegación red
  primero con `/index.html` de respaldo, `/assets/` caché primero, resto red primero; otros orígenes (API, Reverb) no se
  interceptan. Se registra solo en producción (`main.ts`). Para probarlo: `npm run build` y la config `web-dist-nginx`
  (al pararla, `docker stop sereno_dist_preview`: cortar el CLI en Windows no detiene el contenedor).
- 2026-10-08 — Versión nueva: el SW nuevo queda en espera (sin `skipWaiting` al instalar) y `src/pwa/serviceWorker.ts`
  avisa con `toast.info` persistente y acción «Recargar» (manda `SKIP_WAITING`; recarga en `controllerchange` solo si se
  aceptó). Busca actualizaciones cada hora y al volver la pestaña visible. `toast` suma tipo `info` y `action`.

## Notas para la próxima sesión
- Fase 25 (2026-10-08, con M-10 y M-34 aplicadas): canal 2 con 1021 mensajes cargados (1025 `li`, 8446 nodos, 73 000 px).
  Scroll recorriendo la lista en 200 pasos: sin tareas largas, paso p50 2,6 ms, p95 4 ms, máx. 9 ms; relayout completo 17 ms.
  Ráfaga de 200 eventos con huellas distintas (2 lotes de 100, fuente local `carga-fase25`): 200 avisos en vivo, sin tareas
  largas. Medido con PerformanceObserver `longtask` y layout forzado porque el panel del navegador estaba oculto (sin
  pintado ni rAF): falta confirmarlo con el panel Performance visible. M-4 (virtualizar) no hace falta por ahora.
- Desde Git Bash, los comandos `docker compose exec` con rutas absolutas del contenedor llevan `MSYS_NO_PATHCONV=1`.

## Mejoras propuestas
- [x] M-1: título del grupo en el payload `log.group_status_changed`, para mostrar «resolvió *Timeout en webhook*».
      Complejidad: media · Archivos: ~4 (API + web) · Riesgo: contrato público → opus
- [x] M-2: endpoint de eventos por hora de un grupo para los mini gráficos de la tarjeta, el panel y la vista Log. (→ plan `log-resumen`)
      Complejidad: media · Archivos: ~5 · Riesgo: contrato público → opus
- [x] M-3: conteo de grupos abiertos por proyecto (y nivel máximo) para la barra lateral, las tarjetas de Inicio y «Necesita tu atención». (→ plan `log-resumen`)
      Complejidad: media · Archivos: ~5 · Riesgo: contrato público → opus
- [ ] M-4: lista de mensajes virtualizada (TanStack Virtual, ya viene con Reka) si la fase 25 no pasa.
      Complejidad: alta · Archivos: ~3 · Riesgo: ninguno → plan nuevo
- [ ] M-5: nombre de la fuente en `LogEventResource` para mostrar «Fuente api-prod» en el panel.
      Complejidad: baja · Archivos: ~3 · Riesgo: contrato público → sonnet
- [x] M-6: barra lateral contraída (solo íconos con AppTooltip), como en el artboard Plan.
      Complejidad: baja · Archivos: ~3 · Riesgo: ninguno → sonnet
- [x] M-7: el test del script de tema en `index.html` comprueba también `data-theme` y los valores `'light'`/`'dark'`, no solo la clave.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-8: `.gitattributes` en `workspace-web` (y `workspace-api`) para normalizar finales de línea y evitar avisos CRLF. (ya existía en ambos repos; el aviso CRLF viene de core.autocrlf=true)
      Complejidad: baja · Archivos: 1–2 · Riesgo: ninguno → sonnet
- [x] M-9: variante oscura de los colores de `AppAvatar` con tokens en `style.css` (hoy son pasteles fijos), y tests de que
      aplica los colores y del fallback de `paletteFor` con id negativo o no numérico.
      Complejidad: baja · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-10: un único `TooltipProvider` en `AppLayout` (en vez de uno por tooltip) para compartir `skipDelayDuration` entre
      tooltips vecinos y no crear uno por mensaje en `MessageList` (aplicar antes de la fase 25); tipar `AppMenuItem.icon` como componente de `@lucide/vue`.
      Complejidad: baja · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-11: test de `AppMenu` con mouse (clic en el disparador y en un ítem emite `select`).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-12: test de integración que compruebe que `auth.clearSession()` deja vacío el store de proyectos (hoy la cadena
      logout → organization.clear → watch se cubre por partes).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-13: barra lateral: `aria-disabled="true"` en el proyecto sin canal; quitar `role="alert"` de la nota de error de la
      barra (se anuncia dos veces en `/` junto con `ProjectsView`).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-14: `AppMenu` con ítem marcado (`checked`/ícono de visto) para mostrar la organización activa en `OrgSwitcher` y el
      tema actual en `UserMenu`; nombre accesible del disparador de `OrgSwitcher` que incluya el texto visible
      ("Organization: One") para cumplir "label in name".
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-15: `ProjectHeader`: `min-width: 0` y elipsis en el nombre para pantallas estrechas; test de `ChannelView` con
      `/api/projects` poblado que verifique clave y descripción desde el store.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-16: la hora de cada mensaje es una parada de tab (`tabindex=0`): con cientos de mensajes estorba al teclado. Buscar
      alternativa (tooltip al enfocar la fila, o `title`/texto oculto con la fecha completa) y decidirla.
      Complejidad: media · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-17: recalcular "Hoy" al pasar la medianoche con la página abierta (un `ref(now)` que cambie al cambiar el día) y
      test del borde de medianoche en una zona distinta de UTC.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-18: `SystemNotice`: el `aria-label` del `<article>` repite el nivel que ya anuncia la `LevelPill`; y `LEVELS` está
      duplicado entre `SystemNotice.vue` y `LevelPill.vue` (compartirlo).
      Complejidad: baja · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-19: tipar `updateLogGroupStatus` como `Promise<LogGroup>` (el PATCH devuelve `{data: LogGroup}`) y documentar que
      `level` de `listLogGroups` es nivel mínimo (o tiparlo con un `LogLevel`).
      Complejidad: baja · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-20: foco del `LogGroupPanel`: llevarlo al panel al abrir y devolverlo al elemento que lo abrió al cerrar;
      `role="status"` en el texto de carga.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-21: sincronizar el estado entre tarjeta y panel (la tarjeta guarda `doneStatus` local y no se entera de acciones
      del panel ni de otras personas) y no perder un `status_changed` que llegue mientras `messages.loading`.
      Complejidad: media · Archivos: 3–4 · Riesgo: ninguno → sonnet
- [x] M-22: composer: `aria-describedby` del textarea a la pista de teclado, `box-shadow` de foco más visible en la caja,
      y un token `--on-accent` para el `#fff` sobre acento (hoy literal).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-23: test del store de mensajes con un id en cola que también llega en la página de `open`/`loadOlder` o en la
      respuesta de `send`; `markMessagesSeen` lee el último elemento (lista ordenada) en vez de `reduce`; `clear()` reinicia
      `flushScheduled`.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-24: `AppSegmented`: nombre accesible del `count` con separador o texto oculto ("Abiertos, 4"); renombrar el test
      "Enter selects" que en realidad hace clic.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-25: `LogView`: tests de 404 (`notFound`), de petición pendiente al desmontar o al cambiar de organización (L-10) y
      de la ruta `project-log` en `router/index.spec`; ocultar el panel si `loadError` es `notFound`; limpiar `group` y
      `page` al cambiar de organización; recargar la lista cuando el panel resuelve o ignora un grupo (emit del panel).
      Complejidad: media · Archivos: 3–4 · Riesgo: ninguno → sonnet
- [x] M-26: Login: foco inicial en el correo; nombre accesible o `lang` por opción en el selector ES/EN ("Español",
      "English"), extendiendo `AppSegmentedOption`.
      Complejidad: baja · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-27: guardar en el API (`users.locale`) el idioma elegido en el Login o en el menú de usuario, para que no se pierda
      al entrar si el usuario ya tenía otro.
      Complejidad: media · Archivos: ~4 (API + web) · Riesgo: contrato público → opus
- [x] M-28: `AppDialog`: safe-area arriba y a la derecha en `sheet-right`; tests del bloqueo de scroll y de un `AppMenu`
      dentro del diálogo (elegir no lo cierra; Escape cierra primero el menú).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-29: móvil: padding de safe-area en las vistas fuera de `AppLayout` (Login, invitación) ahora que hay
      `viewport-fit=cover`; título del cajón distinto del `aria-label` del `nav` ("Menú"); cerrar el cajón solo con enlaces
      internos.
      Complejidad: baja · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-30: `LogGroupAside`: explicar o reemplazar el selector `.x.x` de especificidad; evitar que `LogGroupPanel` se
      remonte y vuelva a pedir el grupo al cruzar 768 px; tests de Escape y overlay menos atados a internals de Reka.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-31: API: el detalle del grupo muestra `events_count` > 0 con `events: []` cuando el seeder crea grupos sin eventos
      (grupo 3 en local); sembrar eventos coherentes con el contador.
      Complejidad: baja · Archivos: 1–2 (API) · Riesgo: ninguno → sonnet
- [x] M-32: paleta: `aria-expanded` fijo en el campo; ocultar el `<kbd>` del botón Buscar bajo 768 px; botón Buscar en
      `MobileTopBar`; extraer `isApple` a una utilidad; conservar el resaltado si el puntero sale de la lista.
      Complejidad: baja · Archivos: 3–4 · Riesgo: ninguno → sonnet
- [x] M-33: toasts: guardar y cancelar en `clear()` el `setTimeout` de `dismiss`; usar `TOAST_DURATION` en `AppToast.vue`
      en vez de 4000 fijo; tests del límite con uno saliendo y de la pausa con el puntero.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-34: canal: hoy hace scroll toda la página y el compositor queda al final del documento (no fijo abajo); fijar la
      altura de la vista para que solo la lista de mensajes haga scroll y el compositor quede visible. Revisar junto a la
      fase 25 y a M-4 (virtualizar).
      Complejidad: media · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-35: toasts de uso: deduplicar "Reconectado" si la red cae varias veces seguidas; decidir si el éxito del panel se
      muestra cuando ya se cambió de grupo; ordenar el import de `toast` en `ChannelView.spec.ts`.
      Complejidad: baja · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-36: `AppTooltip`: `delay` sin valor por defecto para usar el del provider de `App.vue`; test de que con provider no
      crea uno propio.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-37: `MessageList`: test del umbral de 80 px justo en el borde; volver a anclar al fondo cuando carguen imágenes o
      adjuntos tarde (al llegar el paso 6 del MVP).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-38: barra lateral contraída: `aria-label` con el nombre del proyecto sin canal (el `<span>` deshabilitado); test de que el tooltip está desactivado al expandir.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-39: `UserMenu`: el visto del tema queda viejo si se cambia con la paleta Ctrl K (releer `readThemePreference` al abrir el menú o `ref` compartido en `theme.ts`); test de `UserMenu` del visto inicial y tras elegir; `aria-label` de `OrgSwitcher` sin sufijo ": " si `activeName` está vacío.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-40: `statusFrom` está duplicada en `LogGroupPanel.vue` y `SystemNotice.vue`: moverla a `api/logGroups.ts`; los mocks de `SystemNotice.spec.ts` devuelven un `LogGroup` completo.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet
- [x] M-41: `LogGroupAside`: test de la transición móvil a escritorio que enfoca el aside; las vistas montan el aside con `v-if="channel && ..."`, y si `channel` pasa a null en una recarga se remonta y roba el foco.
      Complejidad: baja · Archivos: 2–3 · Riesgo: ninguno → sonnet
- [x] M-42: migrar el `#fff` sobre acento de `LoginView.vue` (línea ~190) al token `--on-accent`; `id` del hint del compositor con `useId()` si llegan varios compositores (hilos).
      Complejidad: baja · Archivos: 1–2 · Riesgo: ninguno → sonnet
- [x] M-43: `AppSegmented.vue`: `position: relative` en `.app-segmented__item` para anclar el separador oculto `.app-segmented__sep` (absolute) y evitar 1 px de overflow en contenedores con scroll.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-44: (separada de M-30) evitar que `LogGroupPanel` se remonte y vuelva a pedir el grupo al cruzar 768 px: composable `useLogGroup` en `LogGroupAside` que pase `group`, `loading` y `loadError` al panel por props.
      Complejidad: media · Archivos: 3–4 · Riesgo: ninguno → sonnet
- [x] M-45: `AppToast.spec.ts`: el test "stale remove timer" pasa también sin el cambio de M-33 (los ids no se reutilizan); afirmar `vi.getTimerCount()` en 0 tras `clear()`. (Se afirma relativo al conteo inicial: queda un timer ajeno a `toast.ts`; falla sin el `clear` de M-33.)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet

- [x] M-46: tests más finos de M-35 y M-36: en `AppTooltip.spec.ts`, con `vi.useFakeTimers`, que dentro del provider de App el tooltip abre a los 400 ms (valor efectivo heredado) y que `role=tooltip` aparece; en `ChannelView.spec.ts`, afirmar `toasts.value[0].open` antes de `dismiss`. (El test usa un provider de 1000 ms en vez de 400, para distinguir herencia de un default propio, L-08.)
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet

- [x] M-47: `MessageList`: test de que `pinnedToBottom` queda en `true` a 80 px exactos tras un evento `scroll` (hoy el borde solo se prueba por el watch); evaluar reanclar también cuando el alto cambia sin `load` (texto que se expande), con `ResizeObserver` si hace falta.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet

- [x] M-48: `AppSidebar`: el proyecto sin canal contraído usa `<span aria-label>` sin `role` (soporte irregular en lectores); evaluar `role="link"` + `aria-disabled`. En `AppLayout.spec.ts`, afirmar que la barra parte expandida en el test del tooltip.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet

- [x] M-49: `UserMenu.vue`: quitar `theme.value = readThemePreference()` del `setup` (muta el ref global en cada montaje y, sin localStorage, pisa el tema de la sesión con `system`); que el spec llame a `initTheme()`. Test en `CommandPalette.spec` de que elegir tema actualiza `themePreference`, si no existe.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet

- [x] M-50: `useLogGroup.spec`: afirmar que una recarga por `refreshToken` que falla conserva el grupo anterior con `loadError`; `LogGroupAside.spec`: test de que cambiar `refreshToken` recarga (cableado aside a composable).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet

- [x] M-51: `LogGroupAside`: si `ChannelView`/`LogView` remontan el aside por `v-if` (p. ej. `channel` pasa a null en una recarga), `onMounted` le roba el foco aunque estuviera fuera; evitar el remonte en las vistas o enfocar al montar solo si el foco estaba en `body` o en el opener. Con test.
      Complejidad: baja · Archivos: 2-3 · Riesgo: ninguno → sonnet

- [x] M-52: `AppToast.spec`: identificar el timer que sigue vivo tras `toast.clear()` (¿del componente?); si es una fuga, limpiarlo al desmontar. (Resultado: timer interno de reka-ui, expira solo y no sobrevive al desmontaje; sin fuga propia, se mantiene el conteo relativo.)
      Complejidad: baja · Archivos: 1-2 · Riesgo: ninguno → sonnet

- [x] M-53: `AppLayout.spec`: afirmar que el span del proyecto sin canal no tiene `tabindex` y que lleva `role="link"` también con la barra expandida.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet

- [x] M-54: `LogGroupAside`: en un remonte por `v-if` de `ChannelView`/`LogView`, el foco en un elemento no editable (p. ej. un botón del compositor) se sigue robando; evitar el remonte en las vistas (mantener el aside montado durante la recarga de `channel`). `isEditingField` podría cubrir `role="textbox"`.
      Complejidad: baja · Archivos: 2-3 · Riesgo: ninguno → sonnet

- [x] M-55: `LogGroupAside`/`ChannelView`: test de `notFound` en `ChannelView` (toast y `close(true)` con `replace`); flag `closed` local para no repetir el toast si llega otro `refreshToken` antes de desmontar; evitar la doble petición (la primera abortada) de `LogView` al cambiar de organización con `group`/`page` en la URL.
      Complejidad: baja · Archivos: 3 · Riesgo: ninguno → sonnet

- [x] M-56: `LogView`: recargar la lista (o actualizar la fila) cuando el estado de un grupo cambia en tiempo real por el mapa compartido de `useLogGroupStatuses` (acción de otra persona), no solo con la acción del propio panel.
      Complejidad: media · Archivos: 2-3 · Riesgo: ninguno → sonnet

- [x] M-57: Idioma: agregar el cambio de idioma a la paleta Ctrl K (vía `auth.chooseAndSaveLocale`, como el tema) y compartir las etiquetas "Español"/"English" entre `LoginView` y `UserMenu` en una constante.
      Complejidad: baja · Archivos: 3-4 · Riesgo: ninguno → sonnet

- [x] M-58: `LogView.spec.ts`: el test "links the Channel and Log tabs" falló una vez al correr varios specs juntos (pasa suelto y en la suite); revisar el aislamiento del router y del store de organización entre tests. (No reproducido en 26 corridas; el test espera la navegación con `vi.waitFor` en vez de un solo `flushPromises`.)
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet

- [ ] M-59: `SystemNotice`: en la línea de `log.group_status_changed`, que el título del grupo sea un enlace que abra el panel (como en la tarjeta de aviso nuevo); hoy un test exige que la línea no tenga enlace.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
