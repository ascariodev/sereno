# Plan: log-resumen

**Objetivo:** mini gráficos de eventos por hora de cada grupo de logs (lista Log, panel, avisos del canal) y conteo de grupos abiertos con nivel máximo por proyecto (barra lateral, tarjetas de Inicio). Viene de M-2 y M-3 de `docs/plans/terminados/ui-calma.md`.
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Repos afectados: `workspace-api` y `workspace-web` (commits con `git -C <repo>`).
- API: rutas de log groups en `routes/api.php` (grupo `auth:sanctum` + `organization`), `LogGroupController` (`show` es el patrón: `abort_unless` del proyecto + `Gate::authorize('view')`), `LogGroupApiTest` (helpers `asGroupReader()`, `insertGroupEvent()` que hace `LogPartitions::ensure`), `ProjectController@index` + `ProjectResource`, `ProjectApiTest`.
- `log_events` está particionada por día UTC sobre `received_at`, con un solo índice `(log_group_id, received_at DESC)`. Toda consulta filtra `received_at` por rango con parámetros calculados en PHP (no `now()` en SQL), para podar particiones. Nunca agrupar `log_events` por `project_id` (sin índice).
- Los niveles se guardan como texto: el orden sale de `LogLevel::severity()`. `LogEventRecorder` tiene `severitySql()` privado (`array_position(ARRAY[...], col)`); reutilizarlo, no copiar literales.
- Web: `src/api/logGroups.ts`, `src/api/types.ts`, `src/api/logLevels.ts`, `src/stores/projects.ts` (pide todas las páginas con `per_page=100`), `LogView.vue`, `LogGroupPanel.vue`/`useLogGroup.ts`, `SystemNotice.vue`, `AppSidebar.vue`, `ProjectCard.vue`/`ProjectsView.vue`. Colores por nivel: tokens `--level-*-bg/-fg` en `style.css`. No hay librería de gráficos: el sparkline es SVG propio.
- Reglas: tests de aislamiento para todo recurso con `organization_id` (`.claude/rules/tests-api.md`); textos por i18n en en/es (API `__()`, web `src/i18n`); `Carbon::setTestNow` en UTC en los tests de horas.

## Fases

### [x] Fase 1 — API: eventos por hora de grupos [riesgo]
- **Alcance:** `GET /api/projects/{project}/log-groups/hourly?ids=1,2,3` (1 a 100 ids del proyecto; ids ajenos o inexistentes se omiten). Ventana fija de 24 h: `from = now('UTC')->startOfHour()->subHours(23)`, cubos por `date_trunc('hour', received_at)`, una sola consulta agrupada por `log_group_id` y hora, huecos en 0 en PHP. Respuesta `{data: {from, hours: 24, counts: {"<id>": int[24]}}}`, de más antiguo a más nuevo (la última hora va incompleta).
- **Archivos:** `routes/api.php`, `LogGroupController.php` (método `hourly`), `app/Http/Requests/LogGroup/HourlyLogGroupsRequest.php` (nuevo), `app/Support/LogGroupHourlyCounts.php` (nuevo); test `tests/Feature/LogGroupHourlyApiTest.php` (nuevo).
- **Terminado cuando:** tests de cubos y relleno, borde de la ventana, cruce de medianoche (dos particiones), ids ajenos omitidos, 422 (sin ids, más de 100), 404 de proyecto ajeno, aislamiento 403 y número fijo de consultas (`DB::enableQueryLog`) pasan; Pint limpio.

### [x] Fase 2 — API: grupos abiertos y nivel máximo por proyecto
- **Alcance:** relación `Project::logGroups()`; en `index`, un agregado sin N+1 (`open_groups_count` y `open_max_level`, nulo sin abiertos) calculado con la severidad de `LogLevel` (sacar `severitySql()` a un lugar compartido). Campos solo en el listado (`whenHas`), aditivos.
- **Archivos:** `app/Models/Project.php`, `ProjectController.php`, `ProjectResource.php`, `app/Support/LogEventRecorder.php` + destino de `severitySql` (`app/Enums/LogLevel.php`); test `tests/Feature/ProjectApiTest.php`.
- **Terminado cuando:** tests de conteo solo `open`, nivel máximo, nulo sin abiertos, aislamiento y consultas fijas pasan; los tests de `LogEventRecorder` siguen en verde. **En el límite: 5 archivos.**

### [x] Fase 3 — Web: cliente de eventos por hora
- **Alcance:** `getHourlyCounts(projectId, ids)` en el cliente y su tipo `HourlyCounts`.
- **Archivos:** `src/api/logGroups.ts`, `src/api/types.ts`; spec `logGroups.spec.ts`.
- **Terminado cuando:** el spec comprueba la URL con los ids, el parseo y el error; typecheck limpio.

### [x] Fase 4 — Web: componente Sparkline
- **Alcance:** `Sparkline.vue` en `components/ui`: SVG `aria-hidden`, texto accesible con el total de 24 h, color por nivel con los tokens `--level-*`, ancho fijo, todo en 0 se ve plano.
- **Archivos:** `src/components/ui/Sparkline.vue` (nuevo), `src/i18n/en.json`, `src/i18n/es.json`; spec `Sparkline.spec.ts` (nuevo).
- **Terminado cuando:** el spec cubre puntos, serie en cero, texto accesible en en/es y color por nivel; build limpio.

### [x] Fase 5 — Web: sparkline en la lista de la vista Log
- **Alcance:** tras cargar una página, una sola petición `hourly` con sus ids; descartar respuestas viejas (L-10); sin sparkline si falla (sin romper la lista).
- **Archivos:** `src/views/LogView.vue`; spec `LogView.spec.ts`.
- **Terminado cuando:** test de una sola petición por página, de respuesta vieja descartada y de fallo silencioso pasan.

### [x] Fase 6 — Web: sparkline en el panel del grupo
- **Alcance:** el panel pide `hourly` para su grupo y lo recarga con `refreshToken`.
- **Archivos:** `src/composables/useLogGroup.ts` (o composable nuevo), `src/components/LogGroupPanel.vue`; specs.
- **Terminado cuando:** tests de carga, recarga por token y fallo silencioso pasan.

### [x] Fase 7 — Web: sparkline en los avisos del canal [riesgo]
- **Alcance:** cargador por lotes que junta en un tick los ids de los `SystemNotice` montados del mismo proyecto y hace una petición (troceada a 100); caché por grupo que se invalida al llegar un aviso nuevo del grupo; se limpia al cambiar de canal u organización.
- **Archivos:** `src/composables/useHourlyCounts.ts` (nuevo), `src/components/SystemNotice.vue`; specs.
- **Terminado cuando:** tests de lote único con varias tarjetas, troceo, invalidación y limpieza pasan.

### [x] Fase 8 — Web: grupos abiertos en la barra lateral
- **Alcance:** tipos opcionales en `Project`; indicador con el nivel máximo y el número de abiertos junto a cada proyecto (también contraída, con `aria-label`); nada si no hay abiertos o si el campo falta.
- **Archivos:** `src/api/types.ts`, `src/components/AppSidebar.vue`, `src/i18n/en.json`, `src/i18n/es.json`; spec `AppLayout.spec.ts`.
- **Terminado cuando:** tests con abiertos, sin abiertos, campo ausente y barra contraída pasan.

### [x] Fase 9 — Web: línea de salud en las tarjetas de Inicio
- **Alcance:** «N abiertos · nivel máximo» o «Todo en calma» en `ProjectCard`, con plurales.
- **Archivos:** `src/components/ProjectCard.vue`, `src/i18n/en.json`, `src/i18n/es.json`; spec `ProjectsView.spec.ts`.
- **Terminado cuando:** tests de las tres variantes (abiertos, en calma, campo ausente) pasan.

### [x] Fase 10 — Web: refresco de los conteos [riesgo]
- **Alcance:** el store de proyectos vuelve a pedir el resumen (con espera de 300 ms) al recibir `log.group_opened`, `log.group_reopened` o `log.group_status_changed` en el canal suscrito, y tras un cambio de estado propio; descarta respuestas viejas.
- **Archivos:** `src/stores/projects.ts`, `src/views/ChannelView.vue`, `src/views/LogView.vue`; specs.
- **Terminado cuando:** tests de refresco por evento, por acción propia y de respuesta vieja descartada pasan.

## Decisiones
- 2026-10-08 — Un solo endpoint por lotes `hourly?ids=` para lista, panel y avisos, en vez de meter el histograma en `index` — evita N peticiones desde los avisos del canal y no encarece la lista.
- 2026-10-08 — Ventana fija de 24 h por `received_at` — `occurred_at` lo manda el cliente y no está indexado; 24 h toca 1 o 2 particiones.
- 2026-10-08 — «Necesita tu atención» queda fuera — requiere un endpoint de grupos a nivel de organización y menciones, que no existen.
- 2026-10-08 — Fase 1: `hourly` autoriza `viewAny` en el FormRequest (L-04); `ids` llega en CSV, se deduplica; dos consultas fijas (filtro de ids del proyecto + agregado con `[from, from+24h)`). `from` va en ISO con microsegundos y `counts` vacío se serializa como `{}` (el tipo de la fase 3 debe aceptarlo como objeto).
- 2026-10-08 — Fase 2: `LogLevel::severitySql()` público (más `bySeverity()` y `fromSeverityPosition()`); `index` usa `withCount` + `withAggregate(max)` sobre `logGroups` abiertos. La API expone `open_groups_count` (int) y `open_max_level` (valor del enum o null), solo en el listado. Tipos web (fase 8): `open_groups_count?: number`, `open_max_level?: LogLevel | null`.
- 2026-10-08 — Fase 4: `<Sparkline :counts :level? />`, 96x24 fijo, normalizado al máximo de su propia serie (sin escala común entre grupos). Trazo con `--level-*-fg`, salvo critical y alert que usan `-bg` (su `-fg` es blanco).
- 2026-10-08 — Fase 5: `LogView` lleva contador `hourlyGeneration` y `AbortController` propios para `hourly` (L-14), lee `counts ?? {}`, conserva los sparklines anteriores mientras recarga, y la tabla sube a `min-width` 850 px por la columna «Últimas 24 h» (`log.table.activity`).
- 2026-10-08 — Fase 6: sin composable nuevo; `useLogGroup` expone `hourly` (`number[] | null`) con generación y abort propios, y `LogGroupAside` lo pasa al panel como prop. Los specs que cuentan `api.get` (Aside, ChannelView, useLogGroup) separan la ruta `hourly`; la fase 7 puede necesitar lo mismo.
- 2026-10-08 — Fase 7: `useHourlyCounts.ts` es estado de módulo (`requestHourlyCounts(projectId, groupId, messageId)`, `hourlyCountsOf`, `resetHourlyCounts`), lote por proyecto en una microtarea, troceo a 100, versión por grupo. Invalida al montar un aviso con id de mensaje mayor que el último visto del grupo (cubre vivo, `catchUp` y `loadOlder` sin tocar el store, L-27). `resetHourlyCounts()` se llama dentro de `messages.clear()`.
- 2026-10-08 — Fase 8: `Project` lleva `open_groups_count?: number` y `open_max_level?: string | null` (la web no tiene tipo `LogLevel`); nivel desconocido usa el tono debug. Nombre del nivel desde `notice.level.*`; claves `sidebar.openGroups` (plural) y `sidebar.projectOpen`.
- 2026-10-08 — Fase 10: `projects.refreshCounts()` (espera 300 ms, generación propia) solo copia `open_groups_count`/`open_max_level` por id a los proyectos existentes, sin reemplazar la lista; se cancela en `clear()` y `reload()`; si falla, conserva los conteos.
- 2026-10-08 — Sin evento de Reverb nuevo a nivel de organización — los conteos se refrescan solo con el canal abierto y las acciones propias; el resto, al recargar la organización.

## Notas para la próxima sesión
- Plan terminado el 2026-10-08. M-4 aplicada; suite API 396/396 y web 469/469.

## Mejoras propuestas
- [x] M-1 (baja, sonnet): `LogGroupHourlyResource` para documentar en un solo sitio la forma de la respuesta de `hourly`, en vez de `JsonResource::make` con `(object)`.
- [x] M-2 (baja, sonnet): test unitario de `LogLevel::bySeverity()` y `fromSeverityPosition()` que recorra todos los casos del enum.
- [x] M-3 (baja, sonnet): cachear en una estática el orden de `LogLevel::fromSeverityPosition()` (hoy hace `usort` en cada llamada, una por proyecto).
- [x] M-4 (baja, sonnet): la suite completa del API no carga: `ingest()` global está declarada en `tests/Feature/LogSourceAuthTest.php:32` y `RotateLogSourceKeyCommandTest.php:34` (viene de conectar-posveapi M-18/M-20, no de este plan). Renombrar o encapsular una de las dos.
- [x] M-5 (baja, sonnet): renombrar el caso de error de `getHourlyCounts` en `logGroups.spec.ts` para que diga que provoca el 422 con `ids` vacío.
- [x] M-6 (baja, sonnet): en `Sparkline.vue`, `emergency` usa `--level-emergency-fg` (~2:1 de contraste en tema claro); pasar a `-bg` como critical y alert, y revisar los colores en el navegador en ambos temas. (revisión visual pasa a M-19.)
- [x] M-7 (baja, sonnet): fundir las dos reglas `.sparkline` de `Sparkline.vue` y derivar ancho/alto del CSS de las constantes `WIDTH`/`HEIGHT` (p. ej. `v-bind`).
- [ ] M-8 (media, sonnet): clase global `sr-only` en `style.css` y usarla en `Sparkline.vue` (y donde se repita) en vez de CSS local.
- [ ] M-9 (baja, sonnet): en `LogView.vue`, `loadHourly` con página vacía limpia `hourly` antes de retornar, y extraer `hourly[String(group.id)]` del template a un helper.
- [ ] M-10 (baja, sonnet): el test de respuesta vieja de `LogView.spec.ts` respeta el `signal` en el mock para cubrir también el abort.
- [ ] M-11 (baja, sonnet): caso en `LogGroupAside.spec.ts` que verifique que `hourly` llega a `LogGroupPanel`, y unificar el filtro de llamadas `hourly` entre los specs de Aside y ChannelView.
- [ ] M-12 (baja, sonnet): en `useHourlyCounts.ts`, si un `fetchChunk` falla por algo distinto de un aborto, quitar de `newestNotice` los ids del trozo para que se reintenten al volver a montarse.
- [ ] M-13 (baja, sonnet): que el mock de `useHourlyCounts.spec.ts` respete el `AbortSignal` y un test cubra el aborto en `resetHourlyCounts`.
- [ ] M-14 (baja, sonnet): en `AppSidebar.vue`, extraer la píldora duplicada (enlace y span deshabilitado) a un subcomponente o calcular `openSummary(project)` una vez por fila; arreglar la línea en blanco del CSS.
- [ ] M-15 (baja, sonnet): con la barra contraída, el tooltip del proyecto muestra el mismo texto que el `aria-label` (conteo y nivel) cuando hay abiertos.
- [ ] M-16 (media, sonnet): extraer a `src/api/logLevels.ts` el mapa nivel a tono (`LOG_LEVELS.includes(level) ? level : 'debug'`) repetido en `AppSidebar`, `LevelPill`, `ProjectCard` (y Sparkline), con test del nivel desconocido.
- [ ] M-17 (baja, sonnet): en `stores/projects.ts`, si `refreshCounts` dispara mientras `reload()` está en curso, re-armar el timer en vez de perder el refresco.
- [ ] M-18 (baja, sonnet): refrescar los conteos en `onReconnect` de `ChannelView` y `LogView`, y simplificar `onLiveMessage` de `LogView` a un único `refreshCounts()`.
- [ ] M-19 (media, sonnet): verificación visual en el navegador (L-22) de lo que jsdom no cubre: columna de LogView, panel (ancho y hoja), fila de actividad de `SystemNotice` (móvil), píldora de la barra lateral y línea de salud de `ProjectCard`, en ambos temas.
