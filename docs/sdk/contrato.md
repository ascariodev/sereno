# Contrato de los SDKs de Sereno

Comportamiento que cumple todo SDK oficial (PHP, Node.js, Python, navegador). La referencia es `ascariodev/sereno-laravel`
(`src/Logging/EventFormatter.php` y `SerenoLogHandler.php`); si este documento y esa implementación no coinciden, se
corrige uno de los dos en el mismo cambio, salvo en los puntos marcados **(fuera de Laravel)**: se agregaron para los
SDKs de otros lenguajes y sereno-laravel no los tiene. Los vectores de `api/tests/Fixtures/sdk/vectores.json` salen del
`EventFormatter` de referencia y cada SDK los copia en sus tests.

## Petición

`POST {url}/api/ingest/events`, con `{url}` la URL base del API sin barra final ni ruta. Cabeceras
`Authorization: Bearer <key>`, `Content-Type: application/json` y `Accept: application/json`. Cuerpo
`{"events": [<evento>, ...]}` con 1 a 100 eventos.

| Respuesta | Significado | El SDK |
|---|---|---|
| 202 `{"accepted": N}` | lote aceptado (se procesa en cola) | sigue |
| 401 | key inválida, revocada o proyecto archivado (respuesta uniforme) | no reintenta, avisa |
| 413 | cuerpo de más de 5 MB | no reintenta, avisa |
| 422 | algún evento no valida (`errors` con claves `events.N.campo`) | no reintenta, avisa |
| 429 | 30 fallos de autenticación por minuto por IP o 600 peticiones por minuto por fuente | no reintenta, avisa |
| 5xx, error de red o timeout | fallo transitorio | un reintento |

El servidor ignora las claves desconocidas, descarta los eventos cuyo `id` ya recibió de la misma fuente en las últimas
48 h y recorta los espacios de todos los strings (un string solo de espacios llega como `null`).

## Evento

| Campo | Regla |
|---|---|
| `id` | UUID v4 generado una vez al formatear; se conserva en el reintento |
| `level` | `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert` o `emergency` |
| `message` | ver "Mensaje" |
| `occurred_at` | momento del registro en UTC, `AAAA-MM-DDTHH:MM:SS.mmmZ` (milisegundos truncados, no redondeados) |
| `context` | ver "Contexto"; se omite si queda vacío |
| `fingerprint` | ver "Fingerprint"; se omite si no hay |

Las longitudes se cuentan en puntos de código Unicode (L-11), no en bytes ni en unidades UTF-16.

### Mensaje

1. Se pasa a UTF-8 válido (cada secuencia inválida se reemplaza por `?`) y se quitan los `\0`.
2. Se corta a 8192 puntos de código.
3. Si queda vacío después de recortar espacios, se envía `-`. "Espacios" son los de `Str::trim` de Laravel (L-16, L-18):
   espacio, `\t`, `\n`, `\v`, `\f`, `\r`, `\0` y U+00A0, U+00AD, U+034F, U+061C, U+115F, U+1160, U+17B4, U+17B5, U+180E,
   U+2000 a U+200F, U+202F, U+205F, U+2060 a U+2065, U+206A a U+206F, U+3000, U+2800, U+3164, U+FEFF, U+FFA0, U+1D159,
   U+1D173 a U+1D17A, U+E0020. El mensaje enviado no se recorta: solo decide si va `-`.

### Contexto

Se normaliza recursivamente. La raíz es profundidad 1 y cada mapa o lista anidado suma uno.

- Strings: UTF-8 válido, sin `\0`, cortados a 2048 puntos de código. Las claves de mapa también pierden los `\0`.
- Mapas y listas: solo los primeros 50 elementos. Un mapa o lista que aparece como valor en profundidad 8 se reemplaza
  por `"[truncated]"`.
- Excepciones (en cualquier lugar): `{"class", "message", "location", "trace"}`, con `trace` cortado a 2000 puntos de
  código. Ver "Excepciones por lenguaje".
- Fechas: ISO 8601 con segundos y desfase, `2026-01-02T03:04:05+00:00`. Una fecha sin zona se toma como UTC.
- Flotantes no finitos: `"NAN"`, `"INF"`, `"-INF"`.
- Enteros, flotantes finitos, booleanos y nulos: tal cual.
- Objetos con serialización propia (`JsonSerializable` en PHP, `toJSON()` en JS): se normaliza su resultado.
- Objetos convertibles a texto (`Stringable` en PHP): se normaliza como string. Python y JS no tienen equivalente: no se
  usa `__str__` ni `toString()`.
- Cualquier otro objeto: `"[object <Clase>]"` con el nombre de la clase del lenguaje.
- Cualquier otro valor no clasificado (recursos en PHP): `"[resource]"`. Los demás SDKs documentan su equivalente
  (por ejemplo funciones o símbolos en JS), siempre como string.

Después se ajusta el tamaño, clave por clave en el orden original de la raíz: si agregar la clave hace que el contexto
mida más de 32704 bytes (32768 − 64), se prueba con el valor `"[truncated]"`; si tampoco cabe, la clave se omite. Si
algo se cortó, omitió o reemplazó en cualquier paso, se agrega `"_truncated": true` al final.

**El tamaño se mide como `json_encode` de PHP con sus opciones por defecto**, que es como lo mide el validador del API,
no con el serializador del lenguaje: JSON compacto sin espacios; en strings y claves, `"`, `\`, `/`, `\b`, `\f`, `\n`,
`\r` y `\t` ocupan 2 bytes, el resto de los controles menores a U+0020 ocupan 6 (`\u00XX`), el ASCII imprimible 1, cada
punto de código no ASCII del plano básico 6 (`\uXXXX`) y cada uno fuera de él 12 (par sustituto). Un mapa con claves
0..n−1 consecutivas es una lista. Los flotantes pueden diferir en algún byte entre lenguajes; el margen de 64 lo cubre.

### Fingerprint

1. Si `context.fingerprint` es un string que, sin `\0` y recortado como en "Mensaje", no queda vacío: ese valor recortado.
2. Si no, y `context.exception` es una excepción: `<class>|<location>` (por ejemplo `RuntimeException|/app/src/Billing.php:42`).
3. Si no, no se envía y lo calcula el servidor a partir del mensaje.

Si el resultado pasa de 255 puntos de código, se envía su SHA-1 en hexadecimal minúsculo. La clave `fingerprint`
sigue también en el contexto.

### Excepciones por lenguaje

| Lenguaje | `class` | `location` | `trace` |
|---|---|---|---|
| PHP | `$e::class` | `getFile():getLine()` | `getTraceAsString()` |
| Node.js y navegador | `constructor.name`, si no `name`, si no `Error` | archivo:línea del primer frame de `stack` que los tenga (sin columna); vacío si no hay | `stack` |
| Python | `type(e).__qualname__`, con `módulo.` delante salvo en `builtins` | archivo:línea del frame más interno del traceback; vacío si no hay | `traceback.format_exception(e)` unido |

Un valor lanzado que no es una excepción (un string en JS, por ejemplo) se envía como mensaje (`String(valor)`) sin
contexto de excepción ni fingerprint.

## Envío

- **Inerte sin configurar:** sin URL o sin key no se acumula nada ni se hace ninguna petición.
- **Nivel mínimo:** configurable, `debug` por defecto.
- **Buffer y lote:** los eventos se acumulan en memoria y se envían en lotes de 100; al llegar a 100 se envía en el acto.
  **(fuera de Laravel)** Tope de 1000 eventos en el buffer, contando los que esperan mientras otro lote se envía: los que
  llegan con el buffer lleno se descartan, y el siguiente envío avisa una sola vez cuántos se perdieron.
- **Timeout:** 2 s por defecto por intento (conexión y total), configurable, máximo 10; un valor no numérico, no positivo
  o ausente vuelve a 2.
- **Reintento:** uno solo, con el mismo lote (mismos `id`), únicamente ante error de red, timeout o 5xx. Los dos intentos
  comparten un presupuesto de 10 s: el reintento usa el menor entre el timeout y lo que queda, y no se hace si quedan
  menos de 0,5 s.
- **Fallo:** si el lote no se entrega, se descarta y se escribe un aviso con el motivo (código, cantidad de eventos, hasta
  500 caracteres del cuerpo) por un canal que no vuelve al SDK: `error_log` en PHP puro, `console.error` en JS,
  `sys.stderr` en Python **(fuera de Laravel)**. Laravel usa su canal de respaldo (`daily` por defecto).
- **Nunca lanza:** ni al registrar, ni al formatear (un evento que no se puede formatear se descarta y se avisa), ni al
  enviar.
- **Sin bucles:** lo que el propio SDK registra mientras envía o avisa un fallo no entra al buffer. En entornos async o
  con hilos esto no descarta los eventos que la aplicación registra en paralelo: van al buffer y salen en el lote siguiente.
- **Puntos de vaciado:** al terminar la petición o el proceso (incluidos los errores fatales, L-17), al llamar a `flush()`,
  y en cada vuelta del worker de colas (Laravel lo hace en el evento `Looping`). **(fuera de Laravel)** En procesos de larga
  vida (servidores Node y Python) además como mucho 1 s después de que entra el primer evento al buffer. El temporizador no mantiene vivo el proceso. Los eventos en el buffer cuando el proceso muere por una señal
  que no se puede atrapar se pierden.

## Prueba de conexión

Envía un evento `info` con el mensaje `Sereno connection test`, timeout de 5 s y sin seguir redirecciones. Resultados:
conectado (202), key rechazada (401), falta URL o falta key (no envía nada) y error (red, timeout, redirección, con aviso
de revisar el esquema de la URL, o cualquier otro código). Sale con código 0 solo si está conectado.

## Configuración

Variables de entorno comunes: `SERENO_URL`, `SERENO_KEY`, `SERENO_TIMEOUT` y `SERENO_LEVEL`. Las opciones pasadas por
código ganan a las variables.

## Vectores

`api/tests/Fixtures/sdk/vectores.json` es una lista de `{name, input, expected}`; vive en `api/` y no en `docs/sdk/` porque
el contenedor del API solo monta esa carpeta. `input` tiene `level`, `message`, `time` (ISO 8601 con microsegundos y desfase) y `context` opcional; `expected` es el evento sin `id`. Cada SDK formatea `input` con su
formateador (con el reloj fijado en `time`), comprueba que el `id` es un UUID v4 y compara el resto con `expected`.
Marcadores, válidos en `input` y en `expected`:

- `{"$repeat": [s, n]}`: el string `s` repetido `n` veces.
- `{"$float": "NaN" | "Infinity" | "-Infinity"}`: el flotante no finito del lenguaje.
- `{"$date": "<ISO 8601>"}`: una fecha nativa.
- `{"$object": "<Clase>"}`: una instancia de una clase propia del test sin serialización. En `expected`, `[object <Clase>]`
  se reemplaza por el nombre real de esa clase.
- `{"$exception": {class, message, file, line}}`: una excepción del lenguaje con esos datos (`RuntimeException` se
  traduce a la excepción genérica del lenguaje: `RuntimeException`, `Error` o `RuntimeError`). En `expected`, `class`,
  `location` y el fingerprint usan el nombre traducido, y `"<trace>"` solo exige un string de hasta 2000 puntos de código.

`api/tests/Feature/Log/SdkVectorsTest.php` envía cada `expected` a la ingesta y exige 202, así que un vector nuevo debe
seguir siendo aceptado por el API.
