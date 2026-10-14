# Plan: dialogos-unificados

**Objetivo:** que los cinco diálogos de creación y gestión (CreateLogSource, Invite, OrganizationCreate, ProjectCreate,
ProjectMembers) usen `AppButton`, `AppInput` y un `AppSelect` nuevo en vez de HTML crudo con CSS duplicado, sin cambiar
su comportamiento ni su accesibilidad. Origen: invitaciones-web M-16.
**Estado:** terminado · Fase actual: -
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `web/` (los commits van con `git` en la raíz del monorepo).
- Componentes base en `web/src/components/ui/`:
  - `AppButton.vue`: sin props; solo el estilo primario de 46px (`--ink`/`--surface`), y los atributos caen en el `<button>`.
    Lo usan LoginView, RegisterView e InviteView.
  - `AppInput.vue`: props `id`, `label`, `modelValue`, `errors`, `errorTest` y `describedbyExtra`, con `inheritAttrs: false`
    y `$attrs` al `<input>`. Expone `focus()`. Ids de error `${id}-error-${i}` (los mismos que usan los diálogos). El slot
    por defecto va después de los errores. `aria-describedby` solo se pone si hay errores. Le falta `font: inherit`.
    Lo usan las mismas tres vistas.
- Diálogos en `web/src/components/`: todos sobre `AppDialog`, con el mismo bloque CSS scoped duplicado (campo, input de
  44px, error, `__actions` y botones cancel outline y submit relleno de 44px). Usan `data-test="cancel"`/`"submit"`,
  `data-test="error-<campo>"`, `role="alert" data-test="error-form"`, y `focus()` por ref al abrir.
- Los specs dependen de ids (`#org-create-name`...), `form`, `[name=retry]`, `[data-test=...]` y de los ids `*-error-N`,
  no de clases CSS. Si se conservan, los specs no deberían cambiar. InviteDialog no tiene spec (solo lo monta
  `InvitationsView`).
- Casos especiales: hint antes de los errores (CreateLogSource), textarea y `@input` que deriva la key (ProjectCreate),
  select y fieldset de checkboxes por proyecto (Invite), fila select más botón y error fuera del form referido por
  `aria-describedby` (ProjectMembers), botones retry y remove outline y pequeños.
- Colores solo con tokens del tema (L-38). jsdom no ve el layout (L-22): la verificación visual va en la última fase.

## Fases

### [x] Fase 1 — Variantes de AppButton
- **Alcance:**
  - Props `variant` (`primary` por defecto, `secondary` outline) y `size` (`lg` por defecto con los 46px actuales, `md` de
    44px para diálogos, `sm` para botones de fila como remove).
  - Sin `type` por defecto nuevo: las vistas que ya lo usan no cambian.
  - Solo tokens del tema.
- **Archivos:** `web/src/components/ui/AppButton.vue`, `AppButton.spec.ts` (nuevo).
- **Terminado cuando:**
  - El spec cubre las clases de variante y tamaño por defecto y explícitas, que `type`, `disabled`, `data-test` y
    `aria-label` llegan al `<button>`, y el slot.
  - Pasan los specs de LoginView, RegisterView e InviteView. `vue-tsc -b` limpio.

### [x] Fase 2 — AppInput con textarea, hint y descripción externa
- **Alcance:**
  - Prop `multiline` (con `rows`, padding vertical y `resize: vertical`) que pinta un `<textarea>` con la misma lógica de
    label, errores y `$attrs`.
  - Slot `hint`, antes de los errores, con id propio dentro de `aria-describedby`.
  - Prop `describedby` que se une siempre, haya o no errores (el actual `describedbyExtra` solo con errores; ver si se
    puede reemplazar sin romper las vistas).
  - Agregar `font: inherit`.
- **Archivos:** `web/src/components/ui/AppInput.vue`, `AppInput.spec.ts` (nuevo, o el existente si lo hay).
- **Terminado cuando:**
  - El spec cubre textarea con v-model, `$attrs` y errores; el hint en `aria-describedby` y su orden; `describedby` sin
    errores; y que `focus()` funciona en los dos casos.
  - Pasan los specs de las tres vistas que lo usan. `vue-tsc -b` limpio.

### [x] Fase 3 — AppSelect
- **Alcance:**
  - Componente nuevo con la misma API que AppInput (`id`, `label`, `modelValue`, `errors`, `errorTest`, `describedby`,
    `$attrs` al `<select>`, `focus()`) y las opciones por slot.
  - Mismo estilo de caja que el input.
- **Archivos:** `web/src/components/ui/AppSelect.vue` (nuevo), `AppSelect.spec.ts` (nuevo).
- **Terminado cuando:** el spec cubre v-model, opción deshabilitada, errores con `aria-invalid` y `aria-describedby`,
  `describedby` externo, `$attrs` y `focus()`. `vue-tsc -b` limpio.

### [x] Fase 4 — Migrar los diálogos de un campo
- **Alcance:**
  - OrganizationCreateDialog y CreateLogSourceDialog pasan a AppInput (el hint en el slot `hint`) y AppButton
    (`secondary`/`primary`, `md`).
  - Se borra el CSS duplicado y se conservan ids, `data-test`, autocomplete, `required` y el foco al abrir.
- **Archivos:** `web/src/components/OrganizationCreateDialog.vue`, `web/src/components/CreateLogSourceDialog.vue`.
- **Terminado cuando:** sus specs pasan sin cambios en los selectores. `vue-tsc -b` limpio.

### [x] Fase 5 — Migrar ProjectCreateDialog
- **Alcance:** nombre, key y descripción pasan a AppInput (la descripción con `multiline`) y los botones a AppButton.
  Se conservan `@input` para derivar la key, `maxlength`, `autocapitalize`, `spellcheck` y `returnFocus`.
- **Archivos:** `web/src/components/ProjectCreateDialog.vue`.
- **Terminado cuando:** `ProjectCreateDialog.spec` pasa sin cambios en los selectores, incluido el derivado de la key.
  `vue-tsc -b` limpio.

### [x] Fase 6 — Migrar InviteDialog [riesgo]
- **Alcance:**
  - Email con AppInput, rol con AppSelect, y los botones cancel, submit y retry con AppButton.
  - El fieldset de checkboxes por proyecto queda como está; solo se ajusta su CSS para convivir.
  - Riesgo: no tiene spec propio. Se agrega uno antes de migrar, que fije el comportamiento actual.
- **Archivos:** `web/src/components/InviteDialog.vue`, `InviteDialog.spec.ts` (nuevo).
- **Terminado cuando:**
  - El spec nuevo, escrito y en verde contra la versión actual antes del cambio, sigue en verde tras migrar. Cubre envío,
    errores por campo con sus ids, error general, retry de la carga de proyectos y foco al abrir.
  - `InvitationsView.spec` pasa. `vue-tsc -b` limpio.

### [x] Fase 7 — Migrar ProjectMembersDialog
- **Alcance:**
  - El select pasa a AppSelect, con `describedby` hacia el error externo.
  - Asignar, retry y remove pasan a AppButton (remove en `secondary`/`sm`, conservando `aria-label`).
  - Se conserva la fila select más botón.
- **Archivos:** `web/src/components/ProjectMembersDialog.vue`.
- **Terminado cuando:** `ProjectMembersDialog.spec` pasa sin cambios en los selectores. `vue-tsc -b` limpio.

### [x] Fase 8 — Verificación visual
- **Alcance:**
  - Revisar en el navegador los cinco diálogos en tema claro y oscuro, en escritorio y en móvil: alturas, alineación de
    la fila de acciones y de la fila select más botón, errores, foco visible.
  - Corregir lo que haga falta en los componentes base o en los diálogos. Si algo crece, se divide.
- **Archivos:** los que haga falta corregir (se espera 0 a 3).
- **Terminado cuando:**
  - Capturas de los cinco diálogos sin diferencias de layout con la versión anterior, o con diferencias aceptadas por el
    usuario.
  - La suite web completa pasa.

## Decisiones
- 2026-10-11: alcance limitado a los cinco diálogos de M-16. TaskCreateDialog, LogSourceKeyDialog y las confirmaciones de
  InvitationsView y MembersView usan el mismo patrón, pero quedan como mejora posterior si el usuario no amplía el alcance.
- 2026-10-11: AppButton no cambia su `type` por defecto ni su tamaño por defecto, para no tocar las vistas que ya lo usan.
- 2026-10-12: AppButton aplica clases `app-button--<variant>` y `app-button--<size>`. `lg` igual que antes (46px, 15px,
  sin padding); `md` 44px con padding 0 16px y fuente heredada (como los diálogos actuales); `sm` 32px, padding 0 10px,
  13px (valores propios, se ajustan en las fases 7 u 8). `secondary`: borde 1px `--border`, fondo transparente, `--ink`.
- 2026-10-12: AppInput reemplaza `describedbyExtra` por `describedby` (se une siempre; el único uso, InviteView, lo pasa
  solo con errores porque su `<p>` tiene `v-if`). Orden de `aria-describedby`: hint (`${id}-hint`), errores, `describedby`.
  `aria-invalid` depende solo de los errores. `multiline` con `rows` (3 por defecto). El hint usa `--ink-3`.
- 2026-10-12: AppSelect tiene la API de AppInput sin hint, multiline ni slot por defecto bajo los errores (las opciones van
  en el slot); emite `update:modelValue` en `change`. Orden de `aria-describedby`: errores, `describedby`.
- 2026-10-12 (usuario): el hint de CreateLogSourceDialog va en el slot `hint` de AppInput y entra en `aria-describedby`
  (antes no); se cambió solo esa aserción de `CreateLogSourceDialog.spec`. Mismo criterio para otros hints.
- 2026-10-12: AppLayout.spec tiene 6 fallos (menú de usuario y menciones) que ya existen en `main`; no son de este plan.
- 2026-10-12: un campo que deriva otro valor al escribir usa `:model-value` + `@update:model-value` con su handler, no
  `@input` (con `inheritAttrs: false` caería en `$attrs` y su orden respecto del v-model no está garantizado).
- 2026-10-12: InviteDialog.spec se escribió y pasó contra la versión anterior antes de migrar (11 tests). El rol usa
  AppSelect con `@update:model-value="setRole"`; sus opciones solo cambian con `isOwner` y hay test de la vuelta a `member`.
  Retry, cancel y submit son AppButton `md` (retry y cancel `secondary`).
- 2026-10-12: AppSelect suma la prop `invalid` (fuerza `aria-invalid` con un error externo); ProjectMembersDialog la usa con
  `!!actionError` y pasa `describedby` solo con el error. `selectedId` es string (AppSelect emite strings) y la asignación
  sigue enviando el id numérico. AppSelect va en un wrapper propio `project-members__field` (`flex:1`): un `class` sobre
  AppInput/AppSelect cae en el control interno por `inheritAttrs: false`. Assign `md`; retry y remove `secondary`/`sm`.
- 2026-10-12: verificación visual por medición (getBoundingClientRect y estilos computados) de main (:5174) contra el
  worktree (:5175) en escritorio oscuro y móvil claro, con un 422 real. Única diferencia no prevista: el primario `md` medía
  2px menos (el CSS anterior tenía borde transparente); AppButton `primary` pasa a `border: 1px solid transparent`.
- 2026-10-12 (usuario): se aceptan Quitar y reintentar de ProjectMembersDialog en `sm` (antes 74x44, ahora 59x32, 13px) y
  el offset de foco de 1px en los inputs (antes 2px).
- 2026-10-12: el trabajo va en el worktree `.claude/worktrees/dialogos-unificados` (rama `feat/dialogos-unificados`). El
  servicio `web` monta el checkout principal: los tests del worktree corren en un contenedor `node:24` aparte que monta
  `web/` del worktree y el volumen `workspace_web-node-modules`.

## Notas para la próxima sesión
- Plan terminado. Pendientes solo las mejoras propuestas. AppLayout.spec tiene 6 fallos que ya existían en `main`.

## Mejoras propuestas
- [x] M-1 (baja, sonnet): fijar `font-size` en los tamaños `md` y `sm` de AppButton para que todos los diálogos midan
  igual, en vez de heredar el del contexto. En la fase 8 todos midieron 14px (heredado), así que es solo robustez.
- [x] M-2 (baja, sonnet): AppSelect con opciones que llegan después de fijar `modelValue` (`v-for` diferido): test de que
  el valor mostrado coincide con el modelo y, si falla, reaplicar el valor al cambiar las opciones.
- [x] M-3 (baja, sonnet): estilo atenuado de AppSelect con `disabled` y test de que un `modelValue` sin opción coincidente
  no emite nada.
- [x] M-4 (OBSOLETA: lo resolvió el plan `error-form-compartido` con `ui/AppFormError`) (alta por archivos: 4 diálogos + componente nuevo + spec = 6; no aplicada, convertir en plan con /planificar): el `error-form` (`<p role="alert">` con `__error`) repite en cada diálogo el estilo de
  `.app-input__error`: extraer una clase o componente compartido (también `.proj-create__error`).
- [x] M-5 (DESCARTADA por el usuario: con el store real "fallo y cargando" es inalcanzable, `load()` limpia `failed` al empezar; el `:disabled` es código defensivo y el test lo fija a mano a propósito) (baja, sonnet): InviteDialog.spec fija `store.loading = true` a mano en el test de retry; usar una carga
  pendiente del store en vez de acoplarse a su estado interno.
- [x] M-6 (baja, sonnet): reforzar el test de AppSelect "sin opción coincidente no emite" con `selectedIndex` en -1, para que
  falle también si el componente fuerza una opción.
