---
name: aplicar-mejoras
description: Aplica las mejoras propuestas (M-n) de un plan, eligiendo el modelo de cada una según su complejidad, con revisión y un commit por mejora. Úsala cuando el usuario pida aplicar, implementar o hacer las mejoras o sugerencias que quedaron pendientes de un plan.
argument-hint: "[nombre-de-la-tarea] [M-1 M-3 | baja | todas]"
model: sonnet
effort: low
---

Aplica las mejoras de `## Mejoras propuestas` de un plan. Argumentos: $ARGUMENTS

**Qué plan:** el nombrado en los argumentos (búscalo en `docs/plans/` y en `docs/plans/terminados/`);
si no se nombra, el plan con el que se trabajó en esta sesión o, si no hay, el más reciente con mejoras
pendientes (`- [ ] M-`). Si hay dudas, pregunta.
**Qué mejoras:** las indicadas (`M-1 M-3`), las de un nivel (`baja`, `media`) o todas las pendientes.

Eres el coordinador: no escribes el código tú mismo y trabajas con reportes cortos.

## Criterios de complejidad
Si una mejora aún no está clasificada, o su clasificación parece desactualizada, clasifícala ahora
(con `graphify affected` si el proyecto usa graphify; si no, con una búsqueda acotada):

| Criterio | Baja | Media | Alta |
|---|---|---|---|
| Archivos afectados | 1–2 | 3–5 | más de 5 |
| Toca contrato público, esquema de BD, seguridad o integración externa | no | no | sí |
| Solución evidente | sí | mayormente | requiere investigar |
| Tests que cubren la zona | sí | parcial | no |

La mejora toma el **nivel más alto** que alcance en cualquier criterio. Ante la duda, sube un nivel.

| Nivel | Acción |
|---|---|
| Baja o media | `implementador-fase` con `model: sonnet` |
| Alta, hasta ~5 archivos | `implementador-fase` con `model: opus` |
| Alta y más de ~5 archivos | No la implementes: propón convertirla en un plan con `/planificar` |

## Antes de empezar
Comprueba que el árbol de git del monorepo está limpio (`git status --short` en la raíz). Muestra una tabla corta (id, mejora, nivel, modelo) de lo que
vas a aplicar. Si alguna requiere plan nuevo, dilo ahí. Luego sigue sin esperar, salvo que la selección
incluya mejoras de nivel alto: en ese caso confirma antes.

## Por cada mejora, en orden
1. Despacha `implementador-fase` con la ruta del plan, el id `M-<n>` y el modelo de la tabla.
   - `CONSULTA` / `BLOQUEADO` → detente y consulta.
   - `DIVIDIR` → la mejora era más grande de lo estimado: reclasifícala como alta y propón plan nuevo.
2. Corre los tests afectados y el formato con salida resumida (comandos en CLAUDE.md, "Comandos").
3. Despacha `revisor-fase` con la ruta del plan y el id. Máximo 2 rondas de corrección; si no pasa, detente.
4. Marca la mejora `[x]` en el plan, registra una lección si hubo retrabajo y haz **un commit por mejora**
   en la raíz del monorepo (`git`), con el plan incluido, y un mensaje que nombre la tarea y el id.
5. Informa en una línea (`M-<n> aplicada (<modelo>, <commit>)`) y sigue.

Las sugerencias nuevas que salgan del revisor se agregan como nuevas `M-<n>` clasificadas; no se aplican
en esta misma corrida salvo que el usuario lo pida.

## Al terminar
Resume en máximo 6 líneas: mejoras aplicadas con su modelo, las que quedaron pendientes y por qué, y las
que conviene convertir en plan.
