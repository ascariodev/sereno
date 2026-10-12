# Plan: tests-por-modulo

**Objetivo:** `api/tests/Feature` repartido en `Core/`, `Log/`, `Chat/` y `Plan/`, sin perder ni duplicar ningún test, y
la convención documentada para que los tests nuevos caigan en su carpeta. Origen: M-6 de
`docs/plans/terminados/comentarios-tareas.md` (alejarse del truncado de descubrimiento de L-64).
**Estado:** en curso · Fase actual: 1


## Contexto mínimo
- App afectada: `api/` (commits con `git` en la raíz del monorepo). Solo se mueven tests (`git mv`); no cambia código.
- `api/tests/Pest.php` aplica `->in('Feature')`, recursivo: las subcarpetas lo heredan. Sus helpers globales
  (`assignMembersToAllProjects`, `beforeOrganizationLock`, `archiveProjectBeforeLock`) siguen disponibles.
  `phpunit.xml` usa `<directory>` recursivo: no se toca.
- No hay dependencias de ruta entre tests (sin `__DIR__`, fixtures, datasets compartidos ni `require` entre tests);
  las ~78 funciones globales declaradas en archivos de test tienen nombres únicos.
- Hoy hay 94 archivos en `Feature/`: 81 sueltos y 13 en `TaskComments/`. `Unit/` (solo `LogLevelTest.php`) no se toca.
- Verificación de cada fase (L-64): contar con `./vendor/bin/pest --list-tests | wc -l` antes y después (debe coincidir),
  contar la carpeta movida (`pest tests/Feature/<Carpeta> --list-tests`) y correr la suite completa comparando el total
  reportado, no solo "sin fallos". Las corridas completas, una a la vez y en un subagente.
- Regla de ubicación: un test va al módulo dueño de la ruta, clase o comando que prueba; si cruza módulos, al del
  punto de entrada.

## Fases

### [ ] Fase 1 — Mover los tests de Plan [riesgo]
- **Alcance:** `Task*Test.php` (13) a `tests/Feature/Plan/` y `TaskComments/` a `tests/Feature/Plan/TaskComments/`.
  Registrar en "Decisiones" la cuenta base de `--list-tests` y del total de la suite antes de mover.
- **Archivos:** solo tests movidos.
- **Terminado cuando:** la cuenta de `--list-tests` es igual a la base, `Plan/` lista lo esperado y la suite completa
  da el mismo total sin fallos.

### [ ] Fase 2 — Mover los tests de Log
- **Alcance:** `CreateLogSourceCommand`, `RotateLogSourceKeyCommand`, `LogEvent*`, `LogGroup*` (incluido
  `LogGroupTaskApi`, cuyo punto de entrada es el grupo de log), `LogIngestApi`, `LogMaintenance`, `LogProjectAccess`,
  `LogSource*` y `PostLogGroupNotice` (16) a `tests/Feature/Log/`.
- **Archivos:** solo tests movidos.
- **Terminado cuando:** igual que la fase 1, con la carpeta `Log/`.

### [ ] Fase 3 — Mover los tests de Chat
- **Alcance:** `Attachment*Api`, `Channel*`, `Mention*`, `Message*` y `PruneOrphanAttachments` (28) a
  `tests/Feature/Chat/`.
- **Archivos:** solo tests movidos.
- **Terminado cuando:** igual que la fase 1, con la carpeta `Chat/`.

### [ ] Fase 4 — Mover los tests del núcleo
- **Alcance:** el resto (24): auth, organizaciones, miembros, invitaciones, proyectos, roles, tenant, idioma,
  traducciones e infraestructura (`Cors`, `Health`, `TrustProxies`, `DatabaseSeeder`, `BroadcastingAuth`,
  `ConnectionTerminator`, `MembershipBroadcast`) a `tests/Feature/Core/`. Al terminar no queda ningún `*Test.php`
  suelto en `tests/Feature/`.
- **Archivos:** solo tests movidos.
- **Terminado cuando:** igual que la fase 1, con `Core/`, y `ls tests/Feature/*.php` vacío.

### [ ] Fase 5 — Documentar la convención
- **Alcance:** `.claude/rules/tests-api.md` explica las carpetas y la regla de ubicación; el ejemplo de `CLAUDE.md`
  apunta a `tests/Feature/Core/AuthTest.php`; L-64 pasa a "aplicada en: tests-por-modulo"; `docs/plans/notificaciones.md`
  (activo) indica que sus tests de menciones van en `tests/Feature/Chat/`.
- **Archivos:** `.claude/rules/tests-api.md`, `CLAUDE.md`, `docs/lecciones.md`, `docs/plans/notificaciones.md`.
- **Terminado cuando:** no queda ninguna referencia a rutas planas de `tests/Feature/<X>Test.php` fuera de
  `docs/plans/terminados/` (grep).

## Decisiones
- 2026-10-12 — Cuatro carpetas (`Core`, `Log`, `Chat`, `Plan`), las de M-6; `TaskComments` queda dentro de `Plan`.
- 2026-10-12 — Una fase por módulo: si el montaje trunca o un test se pierde, el corte queda acotado a una carpeta.
- 2026-10-12 — Los planes terminados no se actualizan: son históricos y citan las rutas de su momento.

## Notas para la próxima sesión
- Arrancar por la fase 1 tomando la cuenta base. El worktree `planes-tareas-notificaciones` tiene su propia copia de
  `CLAUDE.md`: puede chocar con la fase 5 al mergear.

## Mejoras propuestas
