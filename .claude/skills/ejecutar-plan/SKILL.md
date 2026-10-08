---
name: ejecutar-plan
description: Ejecuta un plan aprobado de docs/plans/ de principio a fin sin parar, delegando cada fase a un subagente con contexto limpio, revisándola y haciendo commit por fase. Úsala cuando el usuario pida ejecutar, implementar o correr el plan completo o todas las fases.
argument-hint: <nombre-de-la-tarea>
model: sonnet
effort: medium
---

Ejecuta el plan `docs/plans/$ARGUMENTS.md` completo. Si no llegaron argumentos, usa el plan activo
(Estado "en curso"); si hay más de uno o ninguno, pregunta cuál.

Eres **el coordinador**: despachas, revisas, registras y haces commit. **No escribes el código tú mismo**
—cada fase la implementa un subagente con contexto limpio— y no pegas diffs ni contenido de archivos en
tu conversación: trabajas con los reportes cortos de los subagentes. Así tu contexto crece poco aunque el
plan tenga muchas fases.

## Antes de empezar
1. Lee el plan una vez (Contexto mínimo, Decisiones, lista de fases) y `docs/lecciones.md`.
2. Comprueba que el árbol de git de cada repo afectado está limpio (`git -C workspace-api status --short`,
   igual con `workspace-web`; la raíz no es repo). Si no, pregunta antes de seguir.
3. Anuncia en 2–3 líneas: cuántas fases pendientes hay y el orden.

## Bucle — por cada fase pendiente (`### [ ]`), en orden
1. **Implementar:** despacha el subagente `implementador-fase` con la ruta del plan y el número de fase.
   Si la fase está marcada `[riesgo]`, despáchalo con `model: opus`.
2. **Según su Estado:**
   - `HECHO` → sigue al paso 3.
   - `DIVIDIR` → si la división es clara y no cambia el alcance del plan, aplícala en el plan
     (anótala en "Decisiones") y vuelve al paso 1 con la primera subfase. Si cambia el alcance, detente y consulta.
   - `CONSULTA` o `BLOQUEADO` → detente y consulta al usuario (ver "Cuándo parar").
3. **Verificar:** corre los tests afectados y el formato con salida resumida
   (`docker compose exec api php artisan test --compact <archivos>`, `docker compose exec api ./vendor/bin/pint --test -q`;
   en `workspace-web`, cuando exista, la verificación de CLAUDE.md). Nunca dos corridas de tests a la vez.
4. **Revisar:** despacha el subagente `revisor-fase` con la ruta del plan.
   - `LISTO` → sigue al paso 5.
   - `CAMBIOS NECESARIOS` → vuelve a despachar `implementador-fase` pasándole los problemas.
     Máximo **2 rondas de corrección** por fase; si sigue fallando, detente y consulta.
5. **Cerrar** (lo haces tú, siguiendo los pasos de `.claude/skills/cerrar-fase/SKILL.md` salvo la revisión, que ya hiciste):
   marca la fase `[x]`, actualiza la línea de Estado, "Decisiones" y "Notas para la próxima sesión"
   con lo que reportó el subagente, registra una lección si hubo retrabajo, y haz **un commit por fase**
   en cada repo afectado (`git -C workspace-api` / `git -C workspace-web`) con un mensaje que nombre la tarea y la fase.
6. **Registra las mejoras no aplicadas:** las "Sugerencias menores" del revisor y los pendientes del
   implementador que no son parte del plan van a `## Mejoras propuestas` del plan, numeradas `M-<n>`
   y clasificadas con los criterios de `.claude/skills/aplicar-mejoras/SKILL.md`. No las implementes.
   Escríbelas en el momento (no al final), para que sobrevivan a una compactación.
7. Informa el avance en **una línea** (`Fase N/M lista: <nombre> (<commit>)`) y sigue con la siguiente sin esperar.

## Cuándo parar (y solo entonces)
- Un subagente reporta `CONSULTA` o `BLOQUEADO`, o una división que cambia el alcance.
- Una fase no pasa la revisión tras 2 rondas de corrección.
- Los tests fallan y la causa está fuera de la fase actual.
- Algo requiere una decisión irreversible no prevista en el plan (borrar datos, cambiar un contrato público, tocar producción).

Al parar: deja el plan actualizado con dónde quedaste, explica en máximo 5 líneas qué pasó y qué necesitas,
y espera. Cuando el usuario responda, retoma desde la fase pendiente.

## Al terminar el plan
Antes de cerrar, corre la suite completa del API en un subagente (si el plan tocó `workspace-api`).
Pon el Estado en `terminado`, mueve el plan a `docs/plans/terminados/` y resume en máximo
8 líneas: fases completadas, commits, decisiones relevantes, lecciones nuevas y qué conviene
actualizar en "Orden del MVP" de CLAUDE.md. Si hay mejoras propuestas,
lístalas en una tabla corta (id, mejora, complejidad, modelo) y recuerda que se aplican con `/aplicar-mejoras`.
