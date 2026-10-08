---
name: planificar
description: Crea el plan por fases de una tarea grande en docs/plans/. Úsala cuando el usuario quiera planificar, diseñar el paso a paso o dividir en fases una funcionalidad, flujo, migración o refactor, antes de implementar.
argument-hint: <nombre-de-la-tarea> <descripción>
model: opus
effort: high
---

Vamos a planificar esta tarea: $ARGUMENTS

Si no llegaron argumentos (la skill se activó desde la conversación), toma la tarea de lo que el usuario acaba de pedir y propón un nombre corto en kebab-case para el plan. Si la tarea no está clara, pregunta antes de explorar.

1. Si necesitas entender código existente, usa un subagente para explorarlo y quédate solo con un resumen (archivos relevantes y cómo encajan). El subagente explora primero con el grafo del monorepo (`--graph ../.graphify-workspace/workspace/graphify-out/graph.json`, cubre `api/` y `web/`; si falta o no coincide, avisa y sigue con `grep`, sin reconstruirlo) y usa `graphify affected` para dimensionar qué toca cada fase. Consulta el modelo de datos en `.claude/rules/database.md` y el "Orden del MVP" de CLAUDE.md para ubicar la tarea.
2. Crea `docs/plans/<nombre-de-la-tarea>.md` a partir de `docs/plans/_plantilla.md`.
3. Divide el trabajo en fases que cumplan TODOS estos criterios de tamaño:
   - Modifica como máximo ~5 archivos (sin contar tests).
   - Tiene un solo objetivo. Si el nombre de la fase necesita un "y", son dos fases.
   - Tiene un criterio de "terminado" verificable (idealmente un test).
   - Deja el proyecto funcionando: compila y los tests existentes pasan al terminarla.
4. Marca con `[riesgo]` las fases con incertidumbre alta: código que no exploraste a fondo, integraciones externas, migraciones de datos, concurrencia o refactors transversales. Esas fases suelen crecer; hazlas más pequeñas todavía.
5. Revisa el plan terminado contra los criterios del punto 3 y divide lo que no cumpla.
6. Completa "Contexto mínimo" solo con lo indispensable para que una sesión nueva pueda arrancar.
7. No implementes nada todavía. Muéstrame el plan con una tabla resumen (fase, nº de archivos, riesgo) y espera mi aprobación. Si alguna fase quedó en el límite, dímelo explícitamente.
