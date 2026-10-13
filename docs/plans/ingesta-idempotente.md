# Plan: ingesta-idempotente

**Objetivo:** que reintentar la ingesta de log (el job en la cola o el POST del cliente) no duplique eventos ni sume de más en
los grupos, y que un fallo a mitad de lote no pierda el resto. Origen: M-5 de `docs/plans/terminados/log.md`.
**Estado:** en curso · Fase actual: 7
<!-- El hook plan-state busca "en curso" en esta línea. Al terminar el plan: "terminado". -->
<!-- Mantén el plan corto: detalla solo la fase siguiente; las lejanas, en 2–3 líneas. -->


## Contexto mínimo
- Apps afectadas: `api/` y el repo hermano `../sereno-laravel` (paquete `ascariodev/sereno-laravel`, último tag v0.2.1,
  con 4 commits sin publicar). Los commits del monorepo van con `git` en la raíz; los del paquete, en su repo.
- Flujo actual: `POST /api/ingest/events` (`log.source`, `throttle:log-ingest`) → `LogIngestController::store` normaliza
  y despacha **un** `IngestLogEvents` por lote (`$tries = 3` con backoff desde la fase 4, ShouldBeEncrypted) → `LogEventRecorder::record()` por evento,
  cada uno en su `DB::transaction`: upsert de `log_groups` (`ON CONFLICT (project_id, fingerprint)`, `events_count+1`,
  `RETURNING old.status`), insert en `log_events` y `LogGroupOpened`/`LogGroupReopened` tras el commit.
- `log_events` está particionada por día (`received_at`, PK `(id, received_at)`, retención 30 días por particiones en
  `MaintainLogPartitions`): un único de evento ahí tendría que incluir `received_at`, y un reintento puede caer otro día.
  Por eso la deduplicación va en una tabla aparte, no particionada.
- Hoy: si falla el evento k, 0..k-1 quedan guardados y k..n se pierden; `queue:retry` duplicaría 0..k-1.
- `sereno-laravel`: `SerenoLogHandler` manda lotes síncronos por HTTP (timeout 2 s), sin cola ni reintento; si falla, avisa
  al canal de respaldo y descarta. `EventFormatter` no genera id por evento.
- Tests: `api/tests/Feature/Log/{LogIngestApiTest,LogEventRecorderTest,PostLogGroupNoticeTest}.php`
  (incluye 'tries the job only once', que cambia en la fase 4). Convención de carpetas: `.claude/rules/tests-api.md`.
- Modelo de datos y migraciones: `.claude/rules/database.md`. Antes de cada fase, el grafo (`graphify explain/affected`).

## Fases

### [x] Fase 1 — Tabla de recibos de evento
- **Alcance:** migración de `log_event_receipts` (`organization_id`, `log_source_id`, `event_id` string(64), `received_at`),
  único `(log_source_id, event_id)` e índice por `received_at` para podarla; FK compuestas según `database.md`. Modelo si
  hace falta. Documentar la tabla en `.claude/rules/database.md`. Sin uso todavía.
- **Archivos:** migración, `api/app/Models/LogEventReceipt.php`, `.claude/rules/database.md`
- **Terminado cuando:** `migrate:fresh` pasa en la base de tests y un test inserta dos recibos con el mismo
  `(log_source_id, event_id)` y el segundo falla por el único.

### [x] Fase 2 — Recorder que descarta eventos repetidos [riesgo]
- **Alcance:** `LogEventRecorder::record()` recibe el id del evento y, dentro de su transacción y antes del upsert del grupo,
  inserta el recibo con `ON CONFLICT DO NOTHING`; si ya existía, no toca el grupo, no guarda el evento ni emite eventos.
  El job pasa el id. Riesgo: concurrencia entre dos workers con el mismo evento.
- **Archivos:** `api/app/Support/LogEventRecorder.php`, `api/app/Jobs/IngestLogEvents.php`
- **Terminado cuando:** test en `LogEventRecorderTest`: el mismo id grabado dos veces deja un solo `log_events` y
  `events_count = 1`, sin segundo `LogGroupOpened`.

### [x] Fase 3 — Id de evento en el contrato de ingesta
- **Alcance:** `IngestEventsRequest` acepta `events.*.id` opcional (string 1–64, sin `\0`); el controlador asigna un UUID
  a cada evento que no lo traiga antes de despachar, para que los reintentos del job también sean idempotentes. La
  respuesta no cambia (`202 {"accepted": n}`).
- **Archivos:** `api/app/Http/Requests/LogIngest/IngestEventsRequest.php`, `api/app/Http/Controllers/Api/LogIngestController.php`
- **Terminado cuando:** tests en `LogIngestApiTest`: el mismo lote con ids enviado dos veces (cola sync) graba una vez; un
  lote sin ids recibe ids en el job; un id inválido da 422.

### [x] Fase 4 — Reintentos del job de ingesta
- **Alcance:** `IngestLogEvents` pasa a `$tries = 3` con `backoff`; con los recibos, un reintento tras fallo parcial salta
  los eventos ya grabados y graba el resto. Revisar que `PostLogGroupNotice` no se duplique (solo se emite en eventos nuevos).
- **Archivos:** `api/app/Jobs/IngestLogEvents.php`
- **Terminado cuando:** test que hace fallar el evento k la primera vez y, al reintentar, deja exactamente n eventos y
  conteos correctos; 'tries the job only once' se reemplaza por uno de 3 intentos.

### [x] Fase 5 — Poda de recibos
- **Alcance:** borrar recibos con `received_at` más viejo que la ventana de reintento (48 h) desde `MaintainLogPartitions`
  o un comando programado propio.
- **Archivos:** `api/app/Console/Commands/MaintainLogPartitions.php` (o comando nuevo), `api/routes/console.php`
- **Terminado cuando:** test del comando: borra los recibos viejos y deja los recientes.

### [x] Fase 6 — Id por evento en sereno-laravel [riesgo]
- **Alcance:** en `../sereno-laravel`, `EventFormatter` genera un UUID por evento (`id`), para que un reenvío del mismo lote
  no duplique. Test unitario del formateador. Publicar un tag nuevo solo a pedido del usuario.
- **Archivos:** `../sereno-laravel/src/Logging/EventFormatter.php`, su test, `README.md`/`CHANGELOG` si existe
- **Terminado cuando:** los tests del paquete pasan y cada evento formateado lleva un `id` estable dentro del lote.

### [ ] Fase 7 — Un reintento en el envío de sereno-laravel [riesgo]
- **Alcance:** `SerenoLogHandler` reintenta una vez ante timeout o 5xx (no ante 4xx), dentro del tope de tiempo actual, antes
  de caer al canal de respaldo. Seguro gracias a los ids de la fase 6.
- **Archivos:** `../sereno-laravel/src/Logging/SerenoLogHandler.php`, su test
- **Terminado cuando:** test con `Http::fake` en secuencia (500 y luego 202) envía dos veces el mismo lote con los mismos ids
  y no escribe en el respaldo; ante 422 no reintenta.

## Decisiones
- 2026-10-12 — Deduplicación en tabla aparte (`log_event_receipts`), no en `log_events`: la partición por día obliga a incluir
  `received_at` en cualquier único y un reintento puede caer otro día.
- 2026-10-12 — El id es opcional en el contrato y el servidor pone uno si falta: los clientes viejos siguen funcionando y los
  reintentos del job quedan cubiertos siempre; los reenvíos HTTP solo se deduplican si el cliente manda id.

- 2026-10-12 — Fase 1: se agregó a `log_sources` el único `(id, organization_id)` (`log_sources_id_organization_id_unique`) como destino de la FK compuesta de los recibos (patrón `messages_parent_fk`); `received_at` es `timestamp` sin precisión.

- 2026-10-12 — Fase 2: el recibo se inserta con `ON CONFLICT (log_source_id, event_id) DO NOTHING` al inicio de la transacción del evento y con su mismo `received_at`; un rollback no deja recibo.

- 2026-10-12 — Fase 3: `events.*.id` va después de `message` en las reglas (si va antes, `validated()` reordena el lote); un id vacío se vuelve null y recibe UUID. El `id` del contrato se documenta en el README del paquete (fase 6).

- 2026-10-12 — Fase 4: un error permanente en un evento hace fallar el lote tras 3 intentos (los anteriores se conservan, los posteriores no se graban); aceptable porque la API valida el lote antes de encolar. `PostLogGroupNotice` mantiene `$tries = 1` (L-07): no se duplica, pero un fallo suyo pierde el aviso.

- 2026-10-12 — Fase 5: comando propio y no ampliar `MaintainLogPartitions`, cuya retención es por días de partición y aborta con configuración inválida; la ventana de 48 h es de reintento, no de retención.

- 2026-10-12 — Fase 6: `Str::uuid()` v4 como id; un servidor anterior ignora la clave `id` (las reglas no son estrictas), así que el paquete nuevo es compatible hacia atrás.

## Notas para la próxima sesión
- Fase 6 hecha (repo `sereno-laravel`, rama `feat/ingesta-ids`, worktree `../sereno-laravel/.claude/worktrees/ingesta-ids`, 1 commit): `EventFormatter` agrega `id` (UUID); el handler guarda el evento ya formateado. La fase 7 debe reenviar el mismo `$batch` sin volver a formatear y actualizar la línea "No retries" del README de "Delivery behavior" (hoy el README promete que el id sobrevive al reenvío, y solo será cierto con el reintento).
- Fase 5 hecha: comando propio `log:prune-receipts` (diario 00:40 UTC, lotes de 5000, ventana `LogEventReceipt::RETRY_WINDOW_HOURS` = 48). Al desplegar también `docker compose restart scheduler`. Siguen las fases 6 y 7 en el repo `../sereno-laravel` (propio git; el worktree se crea ahí).
- Fase 4 hecha: `IngestLogEvents` con `$tries = 3`, `backoff [5, 30]`. Al desplegar: vaciar la cola de ingesta antes (lotes encolados sin id no están protegidos) y `docker compose restart queue` (el worker no recarga código). Siguiente: poda de recibos (fase 5). Al terminar, marcar M-5 de `docs/plans/terminados/log.md`.

## Mejoras propuestas
- [ ] M-1: Mencionar el único `log_sources_id_organization_id_unique` también en la entrada de `log_sources` de `.claude/rules/database.md`. Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [ ] M-2: Test de concurrencia de `LogEventRecorder::record` con dos conexiones reales y el mismo id (como `MessageDeleteConcurrencyTest`, L-41): el segundo worker descarta tras el commit del primero. Complejidad: media · Archivos: 1 · sin riesgo → sonnet
- [ ] M-3: Test de ids repetidos dentro de un mismo lote (se graba uno solo y `accepted` cuenta los enviados). Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [ ] M-4: Comentario breve sobre `$tries` en `IngestLogEvents` que diga que el reintento es seguro por los recibos de evento. Complejidad: baja · Archivos: 1 · sin riesgo → sonnet
- [ ] M-5: En `sereno-laravel`: afirmar el formato UUID en el test del `id` y agregar un test de que el `id` llega en el payload del `Http::post` del handler. Complejidad: baja · Archivos: 1-2 · sin riesgo → sonnet
