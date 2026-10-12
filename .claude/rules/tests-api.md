---
paths:
  - "api/tests/**"
  - "api/phpunit.xml"
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
- Los tests viven por módulo en `api/tests/Feature/{Core,Log,Chat,Plan}` (los de comentarios de tareas, en
  `Plan/TaskComments/`). Va en la carpeta del módulo dueño de la ruta, clase o comando que se prueba; si el test
  cruza módulos, en el del punto de entrada.
- `memory_limit` de la suite está en 512M en `phpunit.xml`; no bajarlo.
