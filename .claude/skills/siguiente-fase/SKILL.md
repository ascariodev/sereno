---
name: siguiente-fase
description: Retoma una tarea grande desde su plan en docs/plans/ e implementa solo la siguiente fase pendiente. Úsala cuando el usuario quiera seguir, continuar o retomar un plan o la siguiente fase.
argument-hint: <nombre-de-la-tarea>
model: sonnet
effort: medium
---

Lee `docs/plans/$ARGUMENTS.md`.

Si no llegaron argumentos, usa el plan activo que indicó el hook `plan-state` al iniciar la sesión, o busca en `docs/plans/` el plan con Estado "en curso". Si hay más de uno, o ninguno, pregunta cuál.

1. Identifica la primera fase sin marcar (`[ ]`) y revisa "Decisiones" y "Notas para la próxima sesión". Lee también `docs/lecciones.md`.
2. Resúmeme en 3–5 líneas qué vas a hacer en esta fase y qué archivos vas a tocar.
3. **Revisión de tamaño, antes de tocar código:** con lo que sabes ahora, comprueba si la fase sigue cumpliendo los criterios del plan: ~5 archivos como máximo, un solo objetivo y un criterio verificable. Si no los cumple, o si descubres dependencias que el plan no preveía, NO empieces. Propón cómo dividirla, actualiza el plan cuando yo apruebe y toma la primera subfase.
4. Implementa SOLO esa fase. Lee únicamente los archivos que necesita. Explora con el grafo del monorepo (`--graph ../.graphify-workspace/workspace/graphify-out/graph.json`, cubre `api/` y `web/`; si falta o no coincide, avisa y sigue con `grep`, sin reconstruirlo) y corre `graphify affected` antes de cambiar algo exportado. Tests: solo los afectados, con `--compact`.
5. **Durante la implementación**, detente y avísame si:
   - Necesitas modificar archivos que no estaban previstos.
   - Llevas dos intentos fallidos con el mismo problema.
   - La sesión ya se siente larga (muchas lecturas o salidas de comandos).
   En esos casos, propón cerrar lo que esté estable con /cerrar-fase y mover el resto a una fase nueva.
6. Al terminar, verifica el criterio de "terminado" y avísame. No pases a la siguiente fase.
