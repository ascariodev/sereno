# Monetización

Documento vivo para afinar la estrategia de cobro mientras se construye el MVP. No es un plan de
implementación: cuando algo de aquí se decida para construir, pasa a un plan en `docs/plans/`.

## Posicionamiento

El diferenciador es la integración: el aviso de log, la conversación y la tarea viven en el mismo lugar.
Competir con Slack solo como chat es muy difícil; la puerta de entrada es el log.

- Cliente objetivo inicial: equipos de desarrollo de 3 a 30 personas que hoy pagan por separado un chat
  (Slack), una herramienta de errores o alertas (Sentry, Better Stack) y un gestor de tareas (Jira, Linear),
  y los conectan con integraciones.
- Mensaje: "tus sistemas te avisan en un canal donde lo conversas y lo conviertes en tarea".
- El log trae al cliente; el chat y el plan hacen que se quede.

## Modelo de cobro

Híbrido: por usuario activo más por volumen de log.

- **Usuarios:** precio por usuario activo en el mes (facturación justa, como Slack), para que invitar
  gente no tenga fricción. Bots, fuentes de log e invitados no cuentan.
- **Log:** eventos ingeridos al mes y días de retención. Es la métrica de valor que más rinde: crece con
  los sistemas del cliente y no con su número de personas.
- Descuento por pago anual.

## Planes (borrador)

| | Free | Team | Business |
|---|---|---|---|
| Usuarios | generoso | por usuario activo | por usuario activo |
| Historial de mensajes visible | limitado (p. ej. 90 días) | completo | completo |
| Eventos de log al mes | bajo | incluido + excedente | alto + excedente |
| Retención de log | corta (p. ej. 7 días) | media | larga |
| SSO, auditoría | no | no | sí |
| Soporte | comunidad | correo | prioritario / SLA |

El límite de historial es la palanca de conversión más probada (es lo que más empuja a pagar en Slack).

## Complementos

- Retención extra de log.
- Resúmenes con IA de incidentes y canales, cobrados por uso (tienen costo variable).
- Más adelante: licencia autohospedada para empresas que no pueden sacar sus logs.

## Base técnica que conviene dejar lista antes del paso 9

La facturación es el paso 9 del MVP, pero estas piezas abaratan mucho llegar ahí:

1. **Medición de uso por organización desde ya:** eventos ingeridos al mes, usuarios activos y
   almacenamiento, en una tabla de contadores. Sin datos reales no se pueden fijar bien los límites.
2. **Planes como derechos de la organización:** límites y funciones habilitadas consultadas en un solo
   lugar, no condiciones repartidas por el código.
3. **Nunca descartar avisos en silencio:** si un cliente pasa su límite de log, muestrear o agrupar más y
   avisarle. Perder una alerta destruye la confianza en el producto.
4. **Retención por plan:** hoy es global (`config('workspace.log.retention_days')`) y se aplica borrando
   particiones por fecha en `MaintainLogPartitions`. Para retención por plan: mantener particiones hasta la
   retención más larga ofrecida, filtrar lecturas según el plan de la organización (ya se filtra por fecha
   en `LogGroupController`) y borrar por organización lo vencido.
5. **Rate limit de ingesta por plan:** el limitador `log-ingest` debería depender del plan.

## Pasarela de pago

- Laravel Cashier soporta Stripe y Paddle.
- Si se vende a otros países, Paddle o Lemon Squeezy actúan como comerciante registrado y gestionan los
  impuestos de cada país. Stripe da más control pero deja los impuestos a cargo propio.

## Preguntas abiertas

- Precios concretos de cada plan: revisar tarifas actuales de Slack, Sentry, Better Stack y Linear.
- Mercado inicial (país, moneda) y si eso define Stripe o Paddle.
- Si el plan Free limita usuarios o solo historial y log.
- Cuándo meter la medición de uso: ¿antes del paso 3 o junto con él?

## Registro de decisiones

<!-- Formato: AAAA-MM-DD: decisión. Motivo. -->
