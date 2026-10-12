# Plan: error-form-compartido

**Objetivo:** que el error general de los formularios (`<p role="alert" data-test="error-form">`, hoy con una clase
`__error` y el mismo CSS copiado en nueve archivos) sea un componente base `AppFormError`, sin cambiar su aspecto ni su
accesibilidad. Origen: dialogos-unificados M-4.
**Estado:** en curso · Fase actual: 4
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->

## Contexto mínimo
- Apps afectadas: `web/` (los commits van con `git` en la raíz del monorepo).
- Estilo actual, idéntico en todos y en `.app-input__error` (`web/src/components/ui/AppInput.vue`): `margin: 0;
  color: var(--level-error-fg); font-size: 13px;`.
- Usos de `role="alert" data-test="error-form"`: CreateLogSourceDialog, InviteDialog, OrganizationCreateDialog,
  ProjectCreateDialog, TaskCreateDialog, TaskAside (en `web/src/components/`) y LoginView, RegisterView, InviteView (en
  `web/src/views/`). Otros avisos generales con `role="alert"` y la misma clase: `register.statusError` en RegisterView y
  `data-test="accept-error"` en InviteView.
- InviteDialog, TaskCreateDialog, TaskAside, RegisterView e InviteView usan su clase `__error` también en otros elementos
  (errores de campo, `projects-failed`, `email-taken-hint`): en esos archivos la clase y su CSS se quedan.
- Los specs buscan `[data-test=error-form]`, `[role=alert]` y el texto, no la clase: si el componente pasa los
  atributos al `<p>`, no deberían cambiar.
- Colores solo con tokens del tema (L-38).

## Fases

### [x] Fase 1 — Componente AppFormError
- **Alcance:**
  - `web/src/components/ui/AppFormError.vue`: un `<p class="app-form-error" role="alert">` con slot; `data-test` y demás
    atributos caen en el `<p>`. Mismo CSS que `.app-input__error`.
  - Sin `v-if` interno: el padre decide si se muestra, como hoy.
- **Archivos:** `web/src/components/ui/AppFormError.vue` (nuevo), `AppFormError.spec.ts` (nuevo).
- **Terminado cuando:** el spec cubre `role="alert"`, el slot, que `data-test` y `id` llegan al `<p>` y la clase.
  `vue-tsc -b` limpio.

### [x] Fase 2 — Migrar los diálogos de creación
- **Alcance:** CreateLogSourceDialog, InviteDialog, OrganizationCreateDialog y ProjectCreateDialog usan AppFormError para
  el `error-form`. Se borra el CSS `__error` donde ya no lo usa nada (en InviteDialog se queda).
- **Archivos:** los cuatro `.vue`.
- **Terminado cuando:** sus specs (InviteDialog, CreateLogSourceDialog, OrganizationCreateDialog, ProjectCreateDialog,
  IntegrationsView, InvitationsView) pasan sin cambios en los selectores; un grep no encuentra clases `__error` sin uso.
  `vue-tsc -b` limpio.

### [x] Fase 3 — Migrar las vistas de acceso
- **Alcance:** LoginView, RegisterView (también `statusError`) e InviteView (también `accept-error`) usan AppFormError.
  Se borra el CSS `__error` donde quede sin uso.
- **Archivos:** `web/src/views/LoginView.vue`, `RegisterView.vue`, `InviteView.vue`.
- **Terminado cuando:** LoginView.spec, RegisterView.spec e InviteView.spec pasan sin cambios en los selectores; grep sin
  clases huérfanas. `vue-tsc -b` limpio.

### [ ] Fase 4 — Migrar las tareas
- **Alcance:** TaskCreateDialog y TaskAside usan AppFormError para el `error-form`; los errores de campo siguen con su clase.
- **Archivos:** `web/src/components/TaskCreateDialog.vue`, `TaskAside.vue`.
- **Terminado cuando:** TaskCreateDialog.spec, TaskAside.spec y los specs de las vistas que los montan pasan sin cambios
  en los selectores. Medición en el navegador de un `error-form` antes y después (un diálogo y una vista) sin diferencias.
  Suite web completa en verde salvo los fallos de AppLayout.spec que ya existían en `main`.

## Decisiones
- 2026-10-12: alcance ampliado de los cuatro diálogos de M-4 a todos los `error-form` y avisos generales con
  `role="alert"` de la misma clase. Los errores de campo y los avisos sin `role="alert"` (`email-taken-hint`,
  `projects-failed`) quedan fuera.
- 2026-10-12: sin fase visual propia: el CSS es idéntico, así que basta una medición en la última fase.
- 2026-10-12: el trabajo va en el worktree `.claude/worktrees/error-form-compartido` (rama `feat/error-form-compartido`).
- 2026-10-12 (fase 1): AppFormError no usa `inheritAttrs: false`: es de raíz única, así que `class`, `data-test` e `id`
  del padre caen en el `<p>`.
- 2026-10-12 (fase 3): una regla de la vista sobre `p` con más especificidad (`.invite__card p`, color ink-2) pisa
  `.app-form-error`: ahí el AppFormError conserva la clase de la vista (`invite__error`) y su override. Revisar lo mismo
  en TaskCreateDialog y TaskAside.

## Notas para la próxima sesión
- Fases 1 a 3 hechas (AppFormError, diálogos de creación y vistas de acceso). Sigue la fase 4. AppLayout.spec tiene 6 fallos que ya existen en `main`.
- El servicio `web` monta el checkout principal: en un worktree, los tests corren en un contenedor `node:24` aparte que
  monta `web/` del worktree y el volumen `workspace_web-node-modules` (ver plan dialogos-unificados).

## Mejoras propuestas
- [ ] M-1 (baja, sonnet): en InviteView, `.invite__card .invite__error` repite `font-size: 13px`, que AppFormError ya
  trae; basta el `color`.
- [ ] M-2 (baja, sonnet): bajar la especificidad de las reglas de vista sobre `p` (o usar `:where()`) para que
  AppFormError no necesite la clase de la vista como parche. Solo si el caso de InviteView se repite.
