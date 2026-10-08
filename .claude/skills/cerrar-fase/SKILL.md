---
name: cerrar-fase
description: Revisa y cierra la fase actual de un plan, guarda el estado y hace commit. Solo se invoca manualmente con /cerrar-fase.
argument-hint: <nombre-de-la-tarea>
model: sonnet
effort: low
disable-model-invocation: true
---

Cierra la fase actual de `docs/plans/$ARGUMENTS.md` (si no llegaron argumentos, usa el plan con el que se trabajó en esta sesión):

1. Corre la verificación completa de cada repo afectado, en un subagente que devuelva solo el resumen
   y sin otra corrida de tests en marcha:
   - `workspace-api`: `docker compose exec api php artisan test --compact` y `docker compose exec api ./vendor/bin/pint --test -q`.
   - `workspace-web` (cuando exista): la verificación que indique CLAUDE.md, "Comandos".
   Si algo falla, avísame antes de continuar.
2. Despacha el subagente `revisor-fase` con la ruta del plan. Si devuelve CAMBIOS NECESARIOS,
   muéstrame los problemas y espera mi decisión antes de seguir.
3. En el plan:
   - Marca la fase como hecha (`[x]`) y actualiza "Fase actual" en la línea de Estado.
   - Agrega a "Decisiones" cualquier decisión tomada en esta sesión que afecte fases futuras.
   - Reescribe "Notas para la próxima sesión": dónde quedamos, qué falta, riesgos o trampas encontradas.
   - Si descubrimos trabajo nuevo, agrégalo como fase nueva o dentro de una existente.
   - Las sugerencias del revisor que no se aplicaron van a `## Mejoras propuestas`, numeradas `M-<n>` y
     clasificadas con los criterios de `.claude/skills/aplicar-mejoras/SKILL.md`.
   - Si era la última fase: cambia el Estado a `terminado`, mueve el plan a `docs/plans/terminados/`
     y propón en una línea qué actualizar en "Orden del MVP" de CLAUDE.md si cambió el estado del proyecto.
4. Si en esta fase hubo un error que costó retrabajo (no un tropiezo corregido al momento),
   agrega una línea `L-<nn>` a `docs/lecciones.md`. Si algo aprendido aplica a todo el proyecto,
   propón añadirlo a CLAUDE.md o a una rule en una línea.
5. Haz commit en cada repo afectado (`git -C workspace-api` / `git -C workspace-web`) con un mensaje corto
   que mencione la tarea y la fase. El plan y `docs/` están en la raíz, que no se versiona.
6. Termina recordándome: "Listo. Haz /clear y luego /siguiente-fase $ARGUMENTS"
   (o "Plan terminado" si era la última fase).
