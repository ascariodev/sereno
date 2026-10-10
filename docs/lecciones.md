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
- L-08: Un caso negativo usa una entrada que solo se rechaza por la regla que prueba (p. ej. el id real con un cero delante, no `007`), y se comprueba que falla sin la regla; si un respaldo (índice único) da la misma respuesta, el test afirma algo que solo la regla da (su mensaje exacto, sin `UPDATE`). — aplicada en: test (BroadcastingAuthTest)
- L-09: Los tipos del cliente se escriben leyendo los Resources, migraciones y controladores del API (campos, nulos, `whenLoaded`, formato real de fechas verificado con tinker), no solo el contrato resumido del plan ni un comentario previo. — aplicada en: pendiente
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
- L-22: Un contenedor `flex-wrap` con altura mínima estira sus líneas (`align-content: normal`): fijar `align-content` o pasar a columna, y revisar el layout en el navegador, porque jsdom no lo detecta. — aplicada en: log-resumen M-19
- L-23: Un modal que se abre desde otro (cajón, hoja) cierra el primero o se prueba apilado: elegir una acción que no navega deja el de abajo abierto. — aplicada en: test (AppLayout.spec)
- L-24: Un cambio de scroll o layout trae tests que simulan `scrollTop` y `scrollHeight` (crecen con el DOM, no antes del render): sin ellos la lógica de anclaje queda sin cubrir. — aplicada en: test (MessageList.spec)
- L-27: Un estado derivado de los mensajes del canal se alimenta en todos los caminos que los cargan (`open`, `loadOlder`, `catchUp` en sus dos ramas, en vivo), no solo en el de tiempo real. — aplicada en: test (messages.spec)
- L-25: Un cambio de comportamiento visible (foco inicial, atributos ARIA nuevos) trae su test aunque la mejora no lo pida: sin él, el revisor lo devuelve. — aplicada en: test (LoginView.spec, AppSegmented.spec)
- L-26: Tras mover el scroll por código (`scrollTop += delta` al anteponer), se recalcula el estado derivado del scroll (anclado al fondo): un observer que lo lee después actúa con el valor viejo y salta. — aplicada en: test (MessageList.spec)
- L-29: Un helper global en un test de Pest lleva un nombre propio del archivo: uno repetido (`ingest`) rompe la carga de la suite completa aunque cada archivo pase solo. — aplicada en: pendiente
- L-31: Un test del guard que depende de un 401 instala el handler real (`installAuthOnApi` + `redirectToLogin`): con el handler simulado no se ve el `router.push` que cancela la navegación en curso. — aplicada en: test (router/index.spec)
- L-32: En una cadena async (register y luego accept), cada paso tras un `await` revisa la generación también en el camino de éxito, no solo en el `catch`: si no, el paso siguiente corre tras desmontar o cambiar de ruta. — aplicada en: test (InviteView.spec)
- L-33: Un mensaje nuevo bajo un campo (error o aviso) lleva `id` y entra en el `aria-describedby` del campo, con `aria-invalid`, igual que los demás campos del formulario, y el spec lo afirma. — aplicada en: test (InviteView.spec)
- L-30: Un `setTimeout` real que un store deja armado sobrevive al test y se dispara en el siguiente: se cancela de forma determinista en `afterEach` (p. ej. `useProjectsStore().clear()`), no con una espera real. — aplicada en: test (ChannelView.spec)
- L-34: Si una operación ya confirmada en el servidor cambia el estado global (salir de la organización), el refresco del store global corre siempre; solo lo local (toast, navegación) depende de la generación. — aplicada en: test (MembersView.spec)
- L-36: Un dato guardado entre dos eventos async (estado del último rechazo de auth) se borra al consumirlo, al iniciar cada intento nuevo y al desconectar; y un canal que se descarta por error se suelta también en la librería (Echo lo cachea y no re-autoriza). — aplicada en: test (echo.spec)
- L-35: Una acción async que devuelve "si cambió el estado" distingue el descarte por `clear()` (contador propio) del reemplazo por una carga más nueva, y en ese caso espera a la última carga: una recarga concurrente (reconexión) no debe ocultar el cambio. — aplicada en: test (organization.spec)
- L-37: Una acción que decide según si otra falló usa un flag propio de esa acción, no el `error` compartido del store: un fallo de otra acción (paginar) la bloquea en falso. — aplicada en: test (thread.spec)
- L-38: Un componente nuevo toma los colores de los tokens del tema (`var(--accent-soft)`...), nunca hex copiados del diseño: el tema oscuro redefine los tokens y el hex queda ilegible. — aplicada en: pendiente
- L-39: Un estado de fallo de un recurso con URL temporal (firmada) se guarda por URL, no por id: el id se reutiliza con una URL nueva y quedaría en fallo para siempre. — aplicada en: test (MessageAttachments.spec)
- L-40: Un spec que monta componentes con un reloj compartido (`useSharedNow`) los desmonta en `afterEach` (`enableAutoUnmount`): un intervalo real que queda armado de un test anterior hace fallar al siguiente que usa temporizadores falsos. — aplicada en: test (MentionsView.spec, ThreadSummary.spec)
- L-37: Todo endpoint o evento que devuelve un `MessageResource` carga lo mismo que `index` (`RELATIONS` y `loadParticipants`): el resource rellena con `[]` lo que falta y el cliente lo toma como dato. — aplicada en: test (MessageUpdateApiTest)
- L-38: Un evento a `users.{id}` sobre un cambio que puede afectar a quien ya no es miembro (mención quitada, revocación) lleva solo ids, nunca el contenido del mensaje. — aplicada en: test (MentionRemovedBroadcastTest)
- L-39: Un cambio de semántica de un store (p. ej. "ausente con `next_cursor: null` = borrado") corre también los specs de las vistas que lo usan con fixtures propios (`ChannelView.spec`), no solo el del store. — aplicada en: test (ChannelView.spec)
- L-40: Un estado local de una vista que no se desmonta al cambiar de ruta (diálogo abierto, mensaje seleccionado) se limpia en el `reload()` de la vista, con un spec de cambio de canal con el diálogo abierto. — aplicada en: test (ChannelView.spec)
- L-41: Un test con conexiones reales (datos confirmados, fuera de RefreshDatabase) restaura en `afterEach` primero la conexión por defecto y cierra transacciones y `lock_timeout` antes de borrar, todo en `try/finally`: una aserción fallida no debe dejar filas bloqueadas ni contaminar la suite. — aplicada en: test (MessageDeleteConcurrencyTest)
- L-42: Una condición que debe valer al entregar un evento en cola (membresía del destinatario) va en `broadcastOn()`, que corre en el worker; `broadcastWhen` se evalúa al despachar y no ve los cambios mientras el evento espera. — aplicada en: test (MentionBroadcastTest)
- L-43: La fuente de un `watch` es un valor comparable (string, número), no un array u objeto nuevo en cada evaluación: con `[a, b]` el watcher dispara con cualquier cambio de sus dependencias (p. ej. la query de la ruta) aunque `a` y `b` no cambien. — aplicada en: test (ChannelView.spec)

- L-44: El error de la carga inicial se decide con un flag propio del recurso ("nunca cargó bien"), no con un parámetro por llamada: una recarga que reemplaza a la inicial y falla deja la vista vacía, sin error ni carga. — aplicada en: test (tasks.spec)

- L-45: Un `vi.spyOn` sobre una función de la API lleva siempre implementación (`mockResolvedValue`): sin ella llama al API real, la petición queda en vuelo y el test falla según lo que tarde (intermitente solo en corridas combinadas). — aplicada en: test (TaskAside.spec)

- L-46: Un deploy que sincroniza con rsync desde un job que corre como root deja el repo de root: todo lo que un proceso sin privilegios debe crear en la raíz (`vendor/`) se crea y se le da dueño como root antes, y la prueba local simula ese dueño. — aplicada en: pendiente

- L-47: Un formulario decide si un 422 tiene error visible solo con las claves que pinta; si ninguna aparece, muestra el error general (si no, un 422 en `password_confirmation` no muestra nada). Y el guard de generación tras un `await` lleva un spec que desmonta con la petición pendiente. — aplicada en: test (RegisterView.spec)

- L-48: Un cambio de store que busca un efecto visible (no parpadear, conservar la lista) se prueba en las vistas que lo leen: una vista que muestra "Cargando" con `v-if="loading"` anula el cambio aunque el store pase su spec. — aplicada en: test (ProjectsView.spec)

<!-- Ejemplo:
- L-01: Las fechas se guardan en UTC y se convierten solo al mostrarlas. — aplicada en: pendiente
-->
