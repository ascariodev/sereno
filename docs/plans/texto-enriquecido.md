# Plan: texto-enriquecido

**Objetivo:** la descripción de las tareas se escribe en Markdown con un editor con barra de formato y vista previa, y se muestra renderizada y saneada. El renderizador y el editor quedan reutilizables (los usan los comentarios del plan `comentarios-tareas`).
**Estado:** en curso · Fase actual: 2
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

### [ ] Fase 2 — Componente MarkdownContent
- **Alcance:** `MarkdownContent.vue` (prop `source`) que pinta `renderMarkdown` con `v-html` y estilos de prosa
  con tokens del tema (código, citas, listas, enlaces). Texto vacío: no pinta nada.
- **Archivos:** `web/src/components/MarkdownContent.vue`
- **Terminado cuando:** spec que monta Markdown y afirma la estructura y que el HTML peligroso no llega al DOM.

### [ ] Fase 3 — Editor MarkdownEditor
- **Alcance:** textarea con barra (negrita, cursiva, encabezado, lista, lista numerada, cita, código, enlace),
  atajos Ctrl+B/I/K, pestañas Escribir/Vista previa (usa `MarkdownContent`), contador de caracteres con `charCount`,
  `v-model`, `maxlength` y `readonly`. La lógica de envolver o prefijar la selección va en funciones puras.
- **Archivos:** `web/src/components/MarkdownEditor.vue`, `web/src/markdown/markdownFormat.ts`
- **Terminado cuando:** specs de `markdownFormat` (selección vacía, multilínea, deshacer el formato) y del editor
  (barra, atajos, vista previa, límite con emojis).

### [ ] Fase 4 — Editor Markdown en la tarea
- **Alcance:** `TaskAside` muestra la descripción renderizada y pasa a `MarkdownEditor` al editar (solo con permiso);
  `TaskCreateDialog` usa `MarkdownEditor`. Se conserva el flujo de guardado actual.
- **Archivos:** `web/src/components/TaskAside.vue`, `web/src/components/TaskCreateDialog.vue`
- **Terminado cuando:** `TaskAside.spec` y `TaskCreateDialog.spec` cubren ver renderizado, editar, guardar y modo solo lectura; revisión visual en el navegador (claro y oscuro).

## Decisiones
- 2026-10-11 — Markdown guardado como texto plano, editor con barra y vista previa, render con markdown-it sin HTML + DOMPurify — elegido por el usuario; no hay migración de datos.
- 2026-10-11 — Fase 1: markdown-it ^15.0.2, dompurify ^3.4.16 (trae sus tipos), @types/markdown-it ^14.2.0. Encabezados suben dos niveles con tope h4; `<s>` se mapea a `<del>`; `target`/`rel` de enlaces van en un hook `afterSanitizeAttributes` (DOMPurify quita `target` aunque esté permitido); las imágenes se eliminan. La salida termina en `
`.
- 2026-10-11 — El plan se ejecuta en el worktree `feat/texto-enriquecido`; npm corre con `docker run ... -v "$(pwd -W)/web:/app" -v workspace_web-node-modules:/app/node_modules node:24` porque el servicio `web` monta el checkout principal.

## Notas para la próxima sesión
- Este plan va primero: `comentarios-tareas` reutiliza `MarkdownContent` y `MarkdownEditor`.
- `renderMarkdown(source)` está en `web/src/markdown/renderMarkdown.ts`; el hook de DOMPurify es global (hoy es el único uso).

## Mejoras propuestas
- [ ] M-1: Casillas de lista de tareas (`- [ ]`) que se marcan desde la vista renderizada.
      Complejidad: media · Archivos: 3 · Riesgo: ninguno → sonnet
- [ ] M-2: La tarea creada desde un aviso de log arma su descripción en Markdown (nivel, conteo, bloque de código).
      Complejidad: baja · Archivos: 2 · Riesgo: ninguno → sonnet
- [ ] M-3: Aislar el hook de DOMPurify (instancia propia `DOMPurify(window)` o `addHook`/`removeHook` alrededor de `sanitize`) para que no afecte a otros usos futuros.
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → sonnet
- [ ] M-4: Simplificar `heading_close` en `renderMarkdown.ts` a `tokens[idx - 2].tag` (open, inline, close).
      Complejidad: baja · Archivos: 1 · Riesgo: ninguno → haiku
