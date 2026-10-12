# Plan: texto-enriquecido

**Objetivo:** la descripción de las tareas se escribe en Markdown con un editor con barra de formato y vista previa, y se muestra renderizada y saneada. El renderizador y el editor quedan reutilizables (los usan los comentarios del plan `comentarios-tareas`).
**Estado:** terminado
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `web/` (el API no cambia: `description` ya es `text` nullable, máx. 10000 caracteres).
- Archivos principales: `web/src/components/TaskAside.vue` (textarea en L283, `readonly` según permiso),
  `web/src/components/TaskCreateDialog.vue`, `web/src/components/taskLimits.ts` (`TASK_DESCRIPTION_MAX_LENGTH`, `charCount`).
- Hoy no hay ningún `v-html` en `web/src`: el único que entra es el de `MarkdownContent.vue` y solo con HTML saneado.
- Dependencias nuevas: `markdown-it` (+ `@types/markdown-it`) y `dompurify`. Versiones: las que resuelva `npm install`, no inventarlas.
- Lecciones: L-11 (límites en caracteres, con emojis), L-38 (colores con tokens del tema), L-25 (comportamiento visible con test).

## Fases

### [x] Fase 1 — Renderizador Markdown seguro
- **Alcance:** instalar `markdown-it`, `@types/markdown-it` y `dompurify`; `renderMarkdown(source): string` con
  `html: false`, `linkify: true`, `breaks: true`; enlaces con `target="_blank" rel="noopener noreferrer"`; salida
  pasada por DOMPurify con lista blanca de etiquetas (p, br, strong, em, del, code, pre, blockquote, ul, ol, li, a,
  h1-h4, hr) y solo `href` http(s)/mailto. Encabezados `#` se bajan de nivel (h1 -> h3) para no competir con el título del panel.
- **Archivos:** `web/package.json`, `web/package-lock.json`, `web/src/markdown/renderMarkdown.ts`
- **Terminado cuando:** `renderMarkdown.spec.ts` cubre formato básico y vectores XSS (`<script>`, `<img onerror>`,
  `[x](javascript:...)`, `data:`), y typecheck y tests pasan.

### [x] Fase 2 — Componente MarkdownContent
- **Alcance:** `MarkdownContent.vue` (prop `source`) que pinta `renderMarkdown` con `v-html` y estilos de prosa
  con tokens del tema (código, citas, listas, enlaces). Texto vacío: no pinta nada.
- **Archivos:** `web/src/components/MarkdownContent.vue`
- **Terminado cuando:** spec que monta Markdown y afirma la estructura y que el HTML peligroso no llega al DOM.

### [x] Fase 3 — Editor MarkdownEditor
- **Alcance:** textarea con barra (negrita, cursiva, encabezado, lista, lista numerada, cita, código, enlace),
  atajos Ctrl+B/I/K, pestañas Escribir/Vista previa (usa `MarkdownContent`), contador de caracteres con `charCount`,
  `v-model`, `maxlength` y `readonly`. La lógica de envolver o prefijar la selección va en funciones puras.
- **Archivos:** `web/src/components/MarkdownEditor.vue`, `web/src/markdown/markdownFormat.ts`
- **Terminado cuando:** specs de `markdownFormat` (selección vacía, multilínea, deshacer el formato) y del editor
  (barra, atajos, vista previa, límite con emojis).

### [x] Fase 4 — Editor Markdown en la tarea
- **Alcance:** `TaskAside` muestra la descripción renderizada y pasa a `MarkdownEditor` al editar (solo con permiso);
  `TaskCreateDialog` usa `MarkdownEditor`. Se conserva el flujo de guardado actual.
- **Archivos:** `web/src/components/TaskAside.vue`, `web/src/components/TaskCreateDialog.vue`
- **Terminado cuando:** `TaskAside.spec` y `TaskCreateDialog.spec` cubren ver renderizado, editar, guardar y modo solo lectura; revisión visual en el navegador (claro y oscuro).

## Decisiones
- 2026-10-11 — Markdown guardado como texto plano, editor con barra y vista previa, render con markdown-it sin HTML + DOMPurify — elegido por el usuario; no hay migración de datos.
- 2026-10-11 — Fase 1: markdown-it ^15.0.2, dompurify ^3.4.16 (trae sus tipos), @types/markdown-it ^14.2.0. Encabezados suben dos niveles con tope h4; `<s>` se mapea a `<del>`; `target`/`rel` de enlaces van en un hook `afterSanitizeAttributes` (DOMPurify quita `target` aunque esté permitido); las imágenes se eliminan. La salida termina en `
`.
- 2026-10-11 — El plan se ejecuta en el worktree `feat/texto-enriquecido`; npm corre con `docker run ... -v "$(pwd -W)/web:/app" -v workspace_web-node-modules:/app/node_modules node:24` porque el servicio `web` monta el checkout principal.

- 2026-10-11 — Fase 4: la descripción se ve renderizada y se edita con un botón "Editar/Agregar descripción" (no al hacer clic en el texto), con Cancelar que restaura el valor y limpia su error; un 422 en `description` reabre y enfoca el editor; el foco vuelve al botón solo tras guardar o cancelar (no al cambiar de tarea).
- 2026-10-11 — Fase 4: la regla de ancho del panel de PlanView nunca se aplicaba (la raíz dinámica de TaskAside no recibe el scope id) y el panel cambiaba de ancho con el contenido; se corrigió con `.plan-view__layout > :deep(.plan-view__aside)`, mismo patrón que LogView.

## Notas para la próxima sesión
- Retrabajo en fase 4: dos rondas de revisión (foco, Cancelar, specs) y el ancho del panel detectado solo en la revisión visual.
- Retrabajo en fase 3: el cambio entre tipos de lista dejaba el prefijo anterior (`1. - a`); se corrigió quitando cualquier prefijo de bloque.
- Este plan va primero: `comentarios-tareas` reutiliza `MarkdownContent` y `MarkdownEditor`.
- Fase 3: `charCount` ahora se exporta de `taskLimits.ts`; TaskAside y TaskCreateDialog aún tienen copia local: la fase 4 las importa y borra las copias.
- `MarkdownEditor` no usa `maxlength` nativo (UTF-16, L-11): la prop `maxLength` solo pinta el contador "n / max" y lo marca en error; el padre sigue validando y bloqueando el guardado. Props: `modelValue`, `maxLength`, `readonly`, `id`, `name`, `rows`, `ariaInvalid`, `ariaDescribedby` (van al textarea); el `label for` lo pone el padre. Textos en el bloque `markdownEditor` de i18n.
- `MarkdownContent` acepta `source: string | null | undefined` (se le pasa `description` directo) y no pinta nada si queda vacío; estilos con `:deep()` y tokens.
- `renderMarkdown(source)` está en `web/src/markdown/renderMarkdown.ts`; el hook de DOMPurify es global (hoy es el único uso).

## Mejoras propuestas
- [ ] M-1: Casillas de lista de tareas (`- [ ]`) que se marcan desde la vista renderizada.
      Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [ ] M-2: La tarea creada desde un aviso de log arma su descripción en Markdown (nivel, conteo, bloque de código).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [x] M-3: Aislar el hook de DOMPurify (instancia propia `DOMPurify(window)` o `addHook`/`removeHook` alrededor de `sanitize`) para que no afecte a otros usos futuros.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [x] M-4: Simplificar `heading_close` en `renderMarkdown.ts` a `tokens[idx - 2].tag` (open, inline, close).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
- [ ] M-5: El formato desde la barra asigna `el.value` y rompe el historial de deshacer nativo del textarea (Ctrl+Z); usar `document.execCommand('insertText')` o un historial propio.
      Complejidad: media · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-6: Tooltips y atajos del editor muestran "Ctrl+" también en Mac; mostrar "⌘" según la plataforma.
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → haiku
