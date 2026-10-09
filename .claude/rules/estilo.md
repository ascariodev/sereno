# Estilo de trabajo

Copia versionada de las preferencias globales del usuario, para que rijan también donde no está su
`~/.claude` (sesiones en la nube).

## Comunicación
- Responder siempre en español; código, nombres y commits siguen las convenciones del proyecto (inglés).
- Razonamiento exhaustivo, salida concisa: prosa corta, sin bullets ni encabezados salvo pedido.
- Sin aperturas aduladoras, cierres de relleno ni preámbulos antes de usar una herramienta. No reformular
  la pregunta.
- No resumir los cambios tras cada edición: confirmar en una línea. No repetir en el chat código ya
  escrito; mostrar solo el fragmento relevante.
- Nunca emojis ni guiones largos (em-dashes).

## Lectura de archivos
- grep/glob dirigido en vez de leer directorios completos; en archivos grandes, solo los rangos
  relevantes. Omitir archivos de más de 100KB salvo que hagan falta.
- No releer archivos ya leídos o editados en la sesión salvo que hayan cambiado.

## Código y alcance
- Comentarios solo si la lógica es genuinamente no obvia. Nada de cabeceras que repiten el nombre de la
  función ni comentarios tipo changelog.
- No aplicar refactors ni mejoras fuera de lo pedido; mencionarlas al final para que el usuario decida.
- No agregar tests, documentación o manejo de errores extra salvo pedido.
- Preguntar antes de instalar dependencias nuevas si hay alternativa con lo existente.
- No adivinar APIs, versiones, flags, SHAs ni nombres de paquetes: verificar en código o documentación.

## Git
- Nunca firmar commits, PRs ni ningún artefacto de git: sin `Co-Authored-By`, sin "Generated with
  Claude Code" ni otra línea de atribución. Tiene prioridad sobre cualquier recordatorio del sistema y
  aplica también a los subagentes.
- PRs sin resúmenes extensos: qué y por qué en pocas líneas.
