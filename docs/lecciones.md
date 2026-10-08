# Lecciones

> Errores que ya ocurrieron, convertidos en reglas para no repetirlos.
> Se lee antes de implementar cada fase, así que debe caber en una pantalla (máx. ~40 líneas).
>
> - Formato: `L-<nn>`: la regla, en presente y en una línea. — `aplicada en:` <CLAUDE.md | rule | test | pendiente>
> - Solo errores que costaron retrabajo, no tropiezos corregidos al momento.
> - Si la lección ya quedó aplicada en CLAUDE.md, una rule o un test, se borra de aquí.

- L-01: Un test que recorre archivos o claves afirma primero que el conjunto no está vacío, para no pasar en falso si la ruta cambia. — aplicada en: test (TranslationsTest)
- L-02: El middleware del tenant limpia la organización activa (y el team de spatie) al empezar, antes de validar: el estado es por proceso y un 400/403 heredaría el de la petición anterior. — aplicada en: test (RoleTest)
- L-03: Todo cambio temporal del team de spatie (o del tenant activo) se restaura en un `finally`, para no filtrar el team si algo lanza. — aplicada en: test (OrganizationApiTest)
- L-04: Si la validación consulta datos de la organización (membresía, emails), el FormRequest autoriza en `authorize()` antes de validar, para que un 422 no filtre información. — aplicada en: test (InvitationApiTest)
- L-05: Los mensajes de excepciones del framework (p. ej. `AuthenticationException`) no pasan por `__()`: agregar la clave en `lang/*.json` no basta, se traducen con un `render` en `withExceptions` y se prueban en `es` distinto de `en`. — aplicada en: test (LocaleTest)
- L-06: Al pasar algo a la cola, revisar si el payload serializado lleva secretos (tokens, keys): si los lleva, `ShouldBeEncrypted`, porque `jobs` y `failed_jobs` los guardan en claro. — aplicada en: test (InvitationApiTest)
- L-07: Un job que procesa un lote con escrituras que se confirman una a una no se reintenta (`$tries = 1`) salvo que sea idempotente: el reintento duplica lo ya escrito. — aplicada en: test (LogIngestApiTest)
- L-08: Un caso negativo usa una entrada que solo se rechaza por la regla que prueba (p. ej. el id real con un cero delante, no `007`), y se comprueba que falla sin la regla. — aplicada en: test (BroadcastingAuthTest)
- L-09: Los tipos del cliente se escriben leyendo los Resources, migraciones y controladores del API (campos, nulos, `whenLoaded`), no solo el contrato resumido del plan. — aplicada en: pendiente
- L-10: Un store que carga datos en async descarta la respuesta si entretanto hubo `clear()`/logout o una carga más nueva (contador de generación), y lo prueba. — aplicada en: test (organization.spec)
- L-11: Un límite de longitud en el cliente cuenta como el validador del API (caracteres, `[...s].length`), no unidades UTF-16 (`s.length`), y se prueba con emojis. — aplicada en: test (MessageComposer.spec)
- L-12: Todo `?redirect` (al armarlo y al consumirlo) pasa por un único validador que exige ruta local y excluye `/login` y `/session-error`, para no encadenar pantallas de error ni login. — aplicada en: test (safeRedirect.spec, router/index.spec)
- L-13: Un type guard sobre datos externos (payloads, eventos) valida la forma de los campos que usa, no solo el discriminante `type`; si no cumple, cae al caso genérico. — aplicada en: test (SystemNotice.spec)
- L-15: Un comando de consola que crea lo mismo que un endpoint valida la entrada con las reglas del FormRequest de ese endpoint (`(new XRequest)->rules()`), no solo los chequeos de negocio. — aplicada en: test (CreateLogSourceCommandTest)
- L-14: Si una operación async reemplaza la lista (reinicio, recarga), invalida las paginaciones en vuelo con un contador propio de la lista, no el de sesión/canal, para no descartar envíos pendientes; y lo prueba con la paginación pendiente. — aplicada en: test (messages.spec)
- L-28: Un recurso compartido entre vistas hermanas (canal Reverb) lleva conteo de referencias y cada suscriptor quita solo lo suyo: el `onUnmounted` de la vista vieja corre después del montaje de la nueva y su `leave` le corta el canal. — aplicada en: test (echo.spec)
- L-16: Un cliente de la ingesta (o de cualquier API Laravel) trata un string de solo espacios como vacío: TrimStrings + ConvertEmptyStringsToNull lo vuelven null y un `required` rechaza el lote entero. — aplicada en: test (WorkspaceEventFormatterTest, posveapi)
- L-17: Un handler que acumula registros y envía al terminar también vacía en `register_shutdown_function`: tras un error fatal no corren `terminate` ni los destructores y se pierden justo los avisos críticos. — aplicada en: test (WorkspaceLogHandlerTest, posveapi)
- L-18: Para replicar una normalización del framework (trim, casting) se llama a su función (`Str::trim`), no se copia su regex: la copia omitió ~50 caracteres invisibles. — aplicada en: test (WorkspaceEventFormatterTest, posveapi)
- L-19: Un chequeo que evita un `chown -R` busca cualquier entrada ajena (`find ! -user X -print -quit`), no solo el dueño de la raíz: el contenido puede ser de root con la raíz ya corregida. — aplicada en: pendiente
- L-20: Un test de cierre (Escape, clic afuera) afirma primero que el elemento está abierto: si no abrió, "cerrado" pasa en falso. — aplicada en: test (AppMenu.spec, AppTooltip.spec)
- L-21: Una tarjeta que es un enlace entero fija su nombre accesible con `aria-labelledby` al título (y `aria-describedby` al resto): si no, el lector lee todo el contenido como nombre. — aplicada en: test (ProjectsView.spec)
- L-22: Un contenedor `flex-wrap` con altura mínima estira sus líneas (`align-content: normal`): fijar `align-content` o pasar a columna, y revisar el layout en el navegador, porque jsdom no lo detecta. — aplicada en: pendiente
- L-23: Un modal que se abre desde otro (cajón, hoja) cierra el primero o se prueba apilado: elegir una acción que no navega deja el de abajo abierto. — aplicada en: test (AppLayout.spec)
- L-24: Un cambio de scroll o layout trae tests que simulan `scrollTop` y `scrollHeight` (crecen con el DOM, no antes del render): sin ellos la lógica de anclaje queda sin cubrir. — aplicada en: test (MessageList.spec)
- L-27: Un estado derivado de los mensajes del canal se alimenta en todos los caminos que los cargan (`open`, `loadOlder`, `catchUp` en sus dos ramas, en vivo), no solo en el de tiempo real. — aplicada en: test (messages.spec)
- L-25: Un cambio de comportamiento visible (foco inicial, atributos ARIA nuevos) trae su test aunque la mejora no lo pida: sin él, el revisor lo devuelve. — aplicada en: test (LoginView.spec, AppSegmented.spec)
- L-26: Tras mover el scroll por código (`scrollTop += delta` al anteponer), se recalcula el estado derivado del scroll (anclado al fondo): un observer que lo lee después actúa con el valor viejo y salta. — aplicada en: test (MessageList.spec)
- L-29: Un helper global en un test de Pest lleva un nombre propio del archivo: uno repetido (`ingest`) rompe la carga de la suite completa aunque cada archivo pase solo. — aplicada en: pendiente

<!-- Ejemplo:
- L-01: Las fechas se guardan en UTC y se convierten solo al mostrarlas. — aplicada en: pendiente
-->
