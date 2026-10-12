# Plan: tests-por-modulo

**Objetivo:** `api/tests/Feature` repartido en `Core/`, `Log/`, `Chat/` y `Plan/`, sin perder ni duplicar ningún test, y
la convención documentada para que los tests nuevos caigan en su carpeta. Origen: M-6 de
`docs/plans/terminados/comentarios-tareas.md` (alejarse del truncado de descubrimiento de L-64).
**Estado:** terminado


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

### [x] Fase 1 — Mover los tests de Plan [riesgo]
- **Alcance:** `Task*Test.php` (13) a `tests/Feature/Plan/` y `TaskComments/` a `tests/Feature/Plan/TaskComments/`.
  Registrar en "Decisiones" la cuenta base de `--list-tests` y del total de la suite antes de mover.
- **Archivos:** solo tests movidos.
- **Terminado cuando:** la cuenta de `--list-tests` es igual a la base, `Plan/` lista lo esperado y la suite completa
  da el mismo total sin fallos.

### [x] Fase 2 — Mover los tests de Log
- **Alcance:** `CreateLogSourceCommand`, `RotateLogSourceKeyCommand`, `LogEvent*`, `LogGroup*` (incluido
  `LogGroupTaskApi`, cuyo punto de entrada es el grupo de log), `LogIngestApi`, `LogMaintenance`, `LogProjectAccess`,
  `LogSource*` y `PostLogGroupNotice` (16) a `tests/Feature/Log/`.
- **Archivos:** solo tests movidos.
- **Terminado cuando:** igual que la fase 1, con la carpeta `Log/`.

### [x] Fase 3 — Mover los tests de Chat
- **Alcance:** `Attachment*Api`, `Channel*`, `Mention*`, `Message*` y `PruneOrphanAttachments` (28) a
  `tests/Feature/Chat/`.
- **Archivos:** solo tests movidos.
- **Terminado cuando:** igual que la fase 1, con la carpeta `Chat/`.

### [x] Fase 4 — Mover los tests del núcleo
- **Alcance:** el resto (24): auth, organizaciones, miembros, invitaciones, proyectos, roles, tenant, idioma,
  traducciones e infraestructura (`Cors`, `Health`, `TrustProxies`, `DatabaseSeeder`, `BroadcastingAuth`,
  `ConnectionTerminator`, `MembershipBroadcast`) a `tests/Feature/Core/`. Al terminar no queda ningún `*Test.php`
  suelto en `tests/Feature/`.
- **Archivos:** solo tests movidos.
- **Terminado cuando:** igual que la fase 1, con `Core/`, y `ls tests/Feature/*.php` vacío.

### [x] Fase 5 — Documentar la convención
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
- 2026-10-12 — Cuenta base (fase 1): LISTED=1182; la suite reporta 1179 tests (warnings + passed) y 5034 aserciones. Cada fase debe dar exactamente esos números. La línea `Tests:` trae la palabra "warnings" (falta .env en el contenedor): no filtrar con `grep -vi warn`.
- 2026-10-12 — Fase 4: con Core corriendo tras Chat la suite agotaba los 128M por defecto (Request.php:471, payload de 6MB). Decisión del usuario: `memory_limit` 512M en `api/phpunit.xml`; la fuga queda como M-1.

## Notas para la próxima sesión
- Fase 1 hecha (26 archivos movidos, cuenta idéntica). Cuenta base en Decisiones. `LogGroupTaskApiTest` sigue en `Feature/` y va a Log en la fase 2.
- Fase 2 hecha (16 a `Log/`, cuenta idéntica). Siguiente: Chat (28).
- Fase 3 hecha (28 a `Chat/`, cuenta idéntica). Siguiente: Core (todo lo suelto restante).
- Fase 4 hecha (24 a `Core/`, `Feature/` sin tests sueltos, cuenta idéntica). Siguiente: documentar (fase 5).
- Fase 5 hecha: convención en `.claude/rules/tests-api.md`, ejemplo de `CLAUDE.md`, L-64 aplicada y nota en `notificaciones.md`. Plan terminado.
  `CLAUDE.md`: puede chocar con la fase 5 al mergear.

## Mejoras propuestas
- [ ] M-1: Buscar el test de Chat que acumula memoria (payload de 6MB en `Request.php:471`) y liberar lo retenido, para poder bajar el `memory_limit` de `phpunit.xml`. Complejidad: media · Archivos: 1-3 · sin riesgo → sonnet
