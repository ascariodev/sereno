# Plan: descripcion-desde-aviso

**Objetivo:** al crear una tarea desde un aviso de log (Aside del grupo o aviso del canal), la descripción del
diálogo llega prellenada en Markdown con nivel, conteo de eventos y el mensaje en un bloque de código.
Sale de M-2 de `docs/plans/terminados/texto-enriquecido.md`.
**Estado:** en curso · Fase actual: 2
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->


## Contexto mínimo
- Apps afectadas: `web/` solamente. El API guarda `description` tal cual (máx. 10000, `StoreTaskRequest`).
- Archivos principales: `web/src/components/TaskCreateDialog.vue` (props `initialTitle`, `logGroupId`; `reset()`
  pone `description = ''` y corre en el `watch(open, …, {flush:'sync'})`), `web/src/components/LogGroupAside.vue`
  (tiene el grupo completo de `useLogGroup`, con `events[0]` = último evento), `web/src/views/ChannelView.vue`
  (`startCreateTask(id, title)` fija `createTarget` y abre tras `nextTick`), `web/src/components/SystemNotice.vue`
  (`emit('createTask', opened.log_group_id, opened.title)`) y `web/src/components/MessageList.vue` (lo reemite).
- Datos: `LogGroup` (`web/src/api/types.ts`) tiene `level`, `title`, `events_count`, `first_seen_at`,
  `last_seen_at`, `events?`; no hay `message` ni `environment` en el grupo (el mensaje está en `LogEvent.message`).
  El aviso del canal (`LogGroupOpenedPayload`) trae `log_group_id`, `level`, `title`, `events_count` (foto del
  momento del aviso), sin fechas ni mensaje.
- Restricciones del render (`web/src/markdown/renderMarkdown.ts`): sin tablas y sin enlaces relativos
  (`ALLOWED_URI_REGEXP` solo `https?:`/`mailto:`). Por eso: lista con negritas, sin tabla y sin enlace al grupo
  (TaskAside ya enlaza al grupo de origen por `log_group`).
- Límite: `TASK_DESCRIPTION_MAX_LENGTH` y `charCount` en `web/src/components/taskLimits.ts` (L-11: caracteres, no
  unidades UTF-16).
- i18n: `web/src/i18n/en.json`/`es.json`, mismas claves (lo comprueba `index.spec.ts`). Reutilizables:
  `log.level.label`, `notice.level.<level>`, `logGroup.events`, `logGroup.firstSeen`, `logGroup.lastSeen`.
- Comandos web desde el worktree: ver el comando `docker run … node:24` de las fases de texto-enriquecido
  (el servicio `web` monta el checkout principal). Lecciones: L-11, L-25, L-51.

## Fases

### [x] Fase 1 — Helper que arma la descripción desde un grupo
- **Alcance:** función pura `buildLogGroupTaskDescription(data, t, locale)` con
  `data = { level, events_count, message, first_seen_at?, last_seen_at? }`. Forma exacta (L-51):
  lista `- **<Nivel>:** <etiqueta del nivel>`, `- **<Eventos>:** <n>`, y si vienen, primera y última vez
  formateadas como `formatDate` de `LogGroupPanel.vue` (`toLocaleString(locale, { dateStyle: 'medium',
  timeStyle: 'short' })`, local a ese componente: el helper recibe `locale`, no se extrae); línea en blanco; bloque de código con valla de backticks
  más larga que la racha más larga del mensaje (mínimo 3). Si el total supera el máximo (`charCount`), recorta
  el mensaje por caracteres con `…` y cierra la valla. Nivel desconocido: el texto crudo (como `LevelPill`).
  Claves nuevas solo si las existentes no sirven.
- **Archivos:** `web/src/components/logGroupTaskDescription.ts` (nuevo), `web/src/i18n/en.json`,
  `web/src/i18n/es.json` + `logGroupTaskDescription.spec.ts`.
- **Terminado cuando:** el spec cubre la forma exacta en en/es, mensaje con backticks (valla más larga),
  mensaje con emoji recortado sin partir pares sustitutos, campos opcionales ausentes y total ≤ 10000.

### [ ] Fase 2 — Prop `initialDescription` en TaskCreateDialog
- **Alcance:** prop `initialDescription` (por defecto `''`) que `reset()` usa en vez de `''`; se toma al abrir,
  igual que `initialTitle`. Si la descripción inicial queda sin tocar, se envía tal cual.
- **Archivos:** `web/src/components/TaskCreateDialog.vue` + `TaskCreateDialog.spec.ts`.
- **Terminado cuando:** test que abre con descripción inicial, la envía en el POST, y tras cancelar y reabrir
  vuelve a la inicial; el test existente de L62 sigue pasando.

### [ ] Fase 3 — Prellenado desde el Aside del grupo
- **Alcance:** `LogGroupAside` pasa `initial-description` armada con el grupo completo: nivel, `events_count`,
  primera y última vez, y como mensaje `events[0].message` o, si no hay eventos, `title`. Cubre también LogView y
  el Aside de ChannelView, que usan este componente.
- **Archivos:** `web/src/components/LogGroupAside.vue` + `LogGroupAside.spec.ts` (L347-363 y L383-398).
- **Terminado cuando:** el test de crear tarea comprueba la descripción enviada y que persiste al cruzar el
  breakpoint móvil/escritorio.

### [ ] Fase 4 — Prellenado desde el aviso del canal
- **Alcance:** `SystemNotice` emite el payload del aviso (`LogGroupOpenedPayload`) en vez de `(id, title)`;
  `MessageList` lo reemite; `ChannelView` guarda en `createTarget` nivel y conteo y pasa `initial-description`
  armada sin fechas y con `title` como mensaje. Sin petición extra (ver Decisiones).
- **Archivos:** `web/src/components/SystemNotice.vue`, `web/src/components/MessageList.vue`,
  `web/src/views/ChannelView.vue` + `SystemNotice.spec.ts` (L252-253), `ChannelView.spec.ts` (L1338-1375).
- **Terminado cuando:** `ChannelView.spec` comprueba la descripción enviada al crear desde el aviso y
  `SystemNotice.spec` el nuevo payload emitido.

## Decisiones
- 2026-10-12 — Sin tabla ni enlace al grupo en la descripción — el render no admite tablas ni enlaces relativos, y
  TaskAside ya enlaza al grupo de origen.
- 2026-10-12 — (confirmada por el usuario) El aviso del canal prellena con los datos del payload, sin pedir el grupo:
  evita una petición pesada (hasta 50 eventos) y la carrera con el reset síncrono del diálogo. El conteo es el del
  momento del aviso.
- 2026-10-12 — Los rótulos de la plantilla siguen el idioma de la interfaz de quien crea la tarea; luego es
  contenido de la persona y no se traduce.

## Notas para la próxima sesión
- Fase 1 hecha: `buildLogGroupTaskDescription(data, t, locale)` en `web/src/components/logGroupTaskDescription.ts`, `t: (key) => string`, sin claves i18n nuevas. Siguiente: fase 2. Leer `docs/lecciones.md` (L-11, L-25, L-51). Al terminar el plan, marcar M-2 `[x]` en
  `docs/plans/terminados/texto-enriquecido.md`.

## Mejoras propuestas
