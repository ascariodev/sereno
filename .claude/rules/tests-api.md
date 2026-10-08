---
paths:
  - "workspace-api/tests/**"
  - "workspace-api/phpunit.xml"
---

# Tests del API

- Pest sobre PostgreSQL (`workspace_test`), nunca SQLite: el esquema usa `jsonb` y tipos de Postgres.
- Autenticar con `Sanctum::actingAs($user)`. Para rutas de organización, enviar
  `withHeader('X-Organization-Id', (string) $organization->id)`.
- `CurrentOrganization` y el team de spatie persisten entre requests dentro de un mismo test: al probar a
  nivel de modelo, fijarlos con `app(CurrentOrganization::class)->set(...)`.
- Todo recurso nuevo con `organization_id` lleva un test de aislamiento: otra organización no lo ve ni lo
  modifica, y un `X-Organization-Id` ajeno da 403.
- Los mensajes que devuelve la API se verifican por clave de traducción o en ambos idiomas, no con texto fijo.
- Nombres de los tests en inglés con `it('...')`.
