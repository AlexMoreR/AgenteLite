# Qué es esta aplicación

> Este archivo lo lee la herramienta del MCP `que_es_esta_aplicacion` para explicarle el sistema a un
> asesor de IA. Es la parte que NO se puede sacar del código: el negocio, las decisiones y lo que falta.
> Lo que sí se puede sacar del código (modelos de la base, versiones, líneas de WhatsApp, agentes y
> automatizaciones prendidas) la herramienta lo lee en vivo y no hace falta escribirlo acá.
>
> Reglas para editarlo:
> - Los títulos `## ...` no se cambian: la herramienta busca cada sección por su título.
> - En las secciones con lista (`Módulos`, `Entidades`, `Automatizaciones`) cada línea va así:
>   `- \`clave\`: descripción`. La clave tiene que coincidir con la del código. Si un modelo o un módulo
>   nuevo no tiene línea, la herramienta lo avisa en `falta_describir`; si queda una línea de algo que
>   ya no existe, lo avisa en `descrito_pero_no_existe`.
> - Escribir en español de Colombia, sin voseo.

## Qué es y qué resuelve

Aizenbot es el CRM que usa Magilus (fábrica de mobiliario para peluquerías, barberías, spa y salones de
belleza: camillas, sillas, tocadores, lavacabezas, combos) para vender por WhatsApp.

El negocio vive de leads que llegan casi todos por anuncios de Facebook e Instagram que abren un chat de
WhatsApp ("click to WhatsApp"). El problema que resuelve: atender muchos leads a la vez, rápido y sin que
se pierda ninguno, con un equipo chico de asesoras.

Para eso junta en un solo lugar:
- Todos los chats de las líneas de WhatsApp de la empresa, repartidos entre las asesoras.
- Un agente de IA que contesta el primer tramo de la conversación (saludo, qué servicio ofrece el
  cliente, fotos, precio) y le pasa el lead a una asesora cuando hay intención de compra o una duda que
  no sabe responder.
- Un CRM con etapas (de lead nuevo a ganado o descartado), llamadas, seguimientos y tableros, para que
  el dueño vea qué pasa con cada lead y cómo trabaja cada asesora.

Es multi-negocio (workspaces): Magilus es el principal y desde el 29-09-2026 cada negocio tiene su
propio catálogo (la hermana de Alex va a vender plantas y artículos de vivero en otro workspace).

## Stack y despliegue

- Next.js con App Router, React, TypeScript y Tailwind. Componentes de interfaz con shadcn sobre
  **Base UI** (no Radix en casi todo: en los menús de Base UI `onSelect` se ignora en silencio, se usa
  `onClick`).
- PostgreSQL con Prisma. La base es remota, en el mismo servidor.
- Autenticación con next-auth (sesión en JWT).
- WhatsApp por gateways intercambiables por línea (`metadata.gateway` del canal): **WAHA** (el actual,
  en `waha-1.magilus.com`), Evolution API y Evolution GO (evogo, que se está dejando), y la **API oficial
  de Meta** para Ventas 2. El código habla el "idioma" de Evolution: los eventos de WAHA se traducen a
  ese formato (`src/lib/waha.ts`) antes de entrar al mismo webhook.
- IA: OpenAI (respuestas, clasificación de intenciones del Agente V3, transcripción de audios con
  Whisper) y Gemini como alternativa en algunas partes.
- Hosting: un servidor propio (31.220.82.79) con Docker Swarm administrado por Portainer, detrás de
  Traefik. La app corre en el stack `aizenlite` (servicios `aizenbot_app`, `aizenbot_realtime` para el
  tiempo real, `aizenbot_files`, y dos relojes con curl: `follow_cron` cada minuto y
  `daily_report_cron`).
- Video de las Reuniones: LiveKit autoalojado (Apache 2.0) en el mismo servidor, con los servicios
  `livekit` (v1.13.0), `livekit_egress` (v1.15.0, graba solo audio) y `livekit_redis`; su configuración
  está en `docker/livekit/` y en el compose. Ver "Advertencias de operación".
- Respaldo: el servicio `aizenbot_respaldo` (misma imagen, `docker/respaldo/respaldo.sh`) copia la base
  con `pg_dump` a las 2:00 a. m. de Colombia, la sube a Google Drive (`Respaldos/AizenCRM`, últimos 30
  días) y avisa por correo si falla. aizen1 baja la copia a las 4:00 a. m. y guarda las últimas 30. Corre
  por fuera de la app y no escribe en la base: la app no sabe si corrió (se ve en Drive). Ver el README.
- Despliegue: cada push a `main` dispara el CI de GitHub ("Docker Image CI"), que construye la imagen
  `ghcr.io/alexmorer/agentelite:latest`; con el CI en verde se despliega solo. La versión que corre se ve
  en `https://app.aizenbot.com/api/version`.

## Pruebas E2E

- Playwright (`e2e/`, config en `e2e/playwright.config.ts`), Chromium emulando un Pixel 7, 1 trabajador.
- Recorrido de **solo lectura** de una asesora: entrar, lista de chats, abrir un chat, ficha del cliente,
  abrir el panel de envío (sin buscar ni crear ubicaciones) y cerrar sesión. No envía nada.
- Corre cada noche a las 3:00 a. m. (Colombia) contra `https://app.aizenbot.com` con el workflow
  `.github/workflows/e2e.yml` (también a mano con "Run workflow"); nunca en push, no despliega.
- Usa la cuenta de una asesora de un negocio de prueba sin WhatsApp conectado, por los secretos
  `E2E_EMAIL` y `E2E_PASSWORD`. Si faltan, las pruebas se saltan sin fallar.
- Resultado: artefacto `e2e-results` con `tiempos.json` (tiempo de cada paso) y el reporte HTML.
- Local: `E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e` (antes `npx playwright install chromium`).

## Módulos

- `chats`: la bandeja de WhatsApp. Une los chats de las líneas por Evolution/WAHA y los de la API oficial; reparto, filtros, ficha del contacto, transcripción de audios, descarga en PDF o con audios. En la ficha del contacto está el **panel de envío** (desde el 06-10-2026): la asesora busca la ciudad, barrio o corregimiento y Gestión dice si el envío es Gratis, Adicional, Se cotiza o No llegamos, con UN SOLO TOTAL para el producto elegido (por defecto el producto activo del chat o el Combo Camillas CMB05); el texto se inserta en el cuadro (no se envía solo) o se copia. Si la ubicación no existe se agrega en Gestión (queda "Se cotiza" hasta que la revisen). Consulta `/api/transporte/ubicaciones` de Gestión con la misma conexión y llave de la sincronización del catálogo (`lib/envios-gestion.ts`); si Gestión no responde, dice "No se pudo consultar Gestión" y el chat sigue igual. Debajo salen dos formas de pago: "50 % anticipo" y "Contraentrega" (solo combo de camilla; `lib/contraentrega.ts`). El envío de contraentrega no tiene valor fijo: el dueño o un administrador lo guarda por ubicación (ciudad o corregimiento) en la misma tarjeta y lo ven todas las asesoras con el total; sin valor guardado sale "Por confirmar con Ingrid". Se guarda en `AppSetting` con la clave `envio:contraentrega:<negocio>:<ciudad|corregimiento>:<id de Gestión>` (JSON `{ valor, nombre, actualizadoPor, fecha }`, sin migración; `lib/envio-contraentrega-guardado.ts`); el valor de una ciudad no se hereda a sus corregimientos.
- `crm`: el embudo de leads. Kanban por etapa, Registro, Informe del dueño, Mi día de cada asesora y el tablero del equipo. Adentro, `/cliente/crm/embudo` (solo quien supervisa) es el embudo del Combo de Camilla paso a paso: entrada, bienvenida, respondió, identificación, recomendación, señales, intención, asesora, cotización y anticipo, con la transición de más abandono y la comparación con otro período. Solo mide; se apaga con el AppSetting `embudo:activo:<negocio>` = `false`. Al lado, `/cliente/crm/supervisor` (solo quien supervisa) es el **Supervisor**: compara cada hora el bot y el embudo contra su línea base, revisa cada 5 minutos si cambió el libro V3 (diff + Change Guardian con escenarios dorados) y si hay clientes calientes esperando, y avisa al dueño por push. Solo lee, alerta y recomienda: nunca cambia el libro, el reparto ni los chats. Viene APAGADO: se prende con el AppSetting `supervisor:activo:<negocio>` = `true`. Desde el MCP, `ver_supervisor` (solo lectura; dueño, administradores y supervisora) entrega lo mismo agrupado POR ASESORA para armar un solo mensaje por cada una: sus avisos abiertos con el teléfono COMPLETO (la pantalla lo tapa), lo último que dijo el cliente, qué intentó el Supervisor accionable (aviso, plazo, segundo aviso, escalada) y la solución recomendada, más sus chats Caliente/Tibio con más de 24 h sin mensaje de una persona (el bot no cuenta). Aparte van "sin asesora" y "para Alexander" (avisos del bot, del embudo o del libro). Filtros opcionales por asesora (pedazo del nombre o id) y por fechas; no muestra lo que Alexander ya marcó como atendido. Código en `src/lib/mcp/supervisor.ts`, pruebas `npm run test:mcp-supervisor`.
- `mi-tablero`: tablero personal de la asesora (sus números del día).
- `llamadas`: registro de intentos de llamada por lead, con resultado, motivo de pérdida, grabación y transcripción.
- `contactos`: la libreta de contactos; desde aquí se oculta un contacto del CRM.
- `seguimientos`: reglas de seguimiento programado (FollowRule) y los envíos agendados (Follow).
- `campanas`: envíos masivos por tandas a contactos de una etapa.
- `flujos`: mensajes armados (textos, fotos, PDFs, audios, videos) que el agente o la asesora mandan de una vez.
- `productos-v2`: el catálogo con su playbook y embudo de ventas por producto, y el embudo en tres niveles (en construcción, apagado).
- `agentes`: el Agente V1 (por prompt).
- `agente-v2`: el Agente V2, un diagrama de nodos que se compila al motor de agentes.
- `agente-v3`: el Agente V3, el libro de reglas con simulador.
- `automatizaciones`: acciones masivas de jefes (asignar leads en cantidad). El descarte automático tiene código pero no aparece en pantalla.
- `conexion`: las líneas de WhatsApp: crear, QR, gateway, colaboradoras de cada línea, si alimenta o no el CRM.
- `api-oficial`: configuración de la API oficial de Meta (Ventas 2).
- `equipo`: el equipo del negocio: rol (asesora, supervisora, administradora), líneas, pantallas y horario de reparto. Adentro, `/cliente/equipo/coach` es el Coach de ventas: el informe de cada noche (el jefe ve al equipo; cada asesora solo lo suyo) y el botón "Generar ahora" del dueño.
- `negocio`: datos del negocio y la pestaña del Reporte diario.
- `notificaciones`: preferencias de avisos.
- `finanzas`: ingresos y egresos con un asistente de IA y sincronización con Google Sheets.
- `marketing-ia`: generador de anuncios con IA.
- `diagramas`: lienzos de diagramas libres (por ejemplo el mapa de caminos de los chats).
- `tablero-ia` (**Tablero IA**, antes "Tableros inteligentes"; pantalla `/cliente/tablero-ia`. La ruta vieja `/cliente/tableros-inteligentes` redirige (307, `redirects()` de `next.config.ts`) conservando `?tablero=` y `?tarjeta=`, así que los links viejos del MCP siguen sirviendo. La clave del módulo sigue siendo `tableros_inteligentes` porque está guardada en `WorkspaceMember.moduleAccess`; la API, las carpetas de código, las tablas y las herramientas del MCP tampoco cambiaron de nombre): las ideas que arma Claude por el MCP hablando con el dueño, dibujadas como un mapa por niveles, como carpetas (tarjetas unidas por flechas rectas sin punta, color e ícono por tipo, borde por estado, filtros por estado y por tipo, vista Lista por área y "Te toca a ti"). **Página de inicio** (desde el 20-oct-2026): `/cliente/tablero-ia` sin `?tablero`, `?tarjeta` ni `?area` ya no abre el último tablero sino el listado de los tableros del negocio (`InicioDeTableros.tsx`), el que cambió último primero: una tarjeta por tablero con su nombre, cuántas tarjetas tiene, la última actividad (`TableroInteligente.actualizadoEn`) y los mismos contadores que los chips del diagrama en la raíz (te toca / en curso / sigue / hecho, de todo el tablero; `contadoresDelConteo` de `services/niveles.ts` sobre el conteo agrupado de `listarTableros`); tocarla abre el diagrama (`?tablero=<id>`). Desde el 20-oct-2026 los tableros son **por cuenta** (ver "Conceptos"): cada persona ve los suyos, con **+ Nuevo tablero** y el lápiz **Cambiar nombre** en los suyos; el dueño o el ADMIN de la plataforma ven todos (los ajenos con "de Emanuel Diaz"), el lápiz en todos con **De quién es** y, abajo, la sección **Trabajador** (clave, último uso y aprobadores; antes era el panel lateral del robot de la barra del diagrama, que ya no está). Una columna en el celular, grilla en pantallas anchas. Los links con `?tablero`, `?tarjeta` o `?area` siguen abriendo el diagrama directo; uno a un tablero o tarjeta que ya no existe vuelve al listado. En el diagrama, la fila de arriba tiene el enlace **Tablero IA** (ícono de grilla) que vuelve al listado, y el selector de la barra termina en "Todos los tableros". Cada tablero tiene **tipos de tarjeta** configurables (`TipoTarjeta`; nace con **Área**, **Idea** y **Tarea**): de qué tipos puede colgar cada uno (Área dentro de Área, Idea dentro de Área, Tarea dentro de Idea), si pide aprobación (solo Tarea) y si tiene estados (Área no: es una carpeta, sin estado, fuera de filtros, contadores y "Te toca a ti"). Una tarjeta puede colgar de otra (`padreId`, sin ciclos, solo si el tipo lo permite) y llevar un link http(s) que se ve como botón en su ficha y como ícono en el mapa. **Mapa por niveles** (`services/niveles.ts` y `services/disposicion.ts`): al abrir, cada tarjeta sin madre ("Magilus") en el centro y sus hijas directas alrededor (radial, con contador "Ventas · 5"); las nietas no se ven. Tocar una tarjeta con hijas entra a ella (queda al centro con sus hijas alrededor); sin hijas abre su ficha; el botón "i" abre la ficha sin entrar. Arriba "← Atrás" y la ruta ("Tablero › Magilus › Ventas"); el nivel va en la URL (`?tablero=<id>&area=<tarjetaId>`, con `history.pushState`, así que atrás del navegador vuelve al nivel anterior). Solo se ven las flechas entre tarjetas visibles; la unión con la madre es una línea del centro a cada hija. Las posiciones no se guardan en la base: se calculan siempre igual y, mientras se mira un nivel, las que ya estaban (o se arrastraron) no se mueven. **Te toca a ti** (`GET /api/cliente/tableros-inteligentes/pendientes`): lo que espera al dueño en todos los tableros que la persona ve (POR_APROBAR de tipos con aprobación y FALLIDO), de la más vieja a la más nueva, con Aprobar. Panel **Tipos**: el dueño (o el ADMIN) crea y edita tipos y borra los que nadie usa; los demás solo los ven. Un negocio puede tener varios tableros (uno por tema). El nombre del tablero abierto va en la barra superior y es el selector de tableros: al tocarlo lista los que la persona ve (los suyos; el dueño o el ADMIN, todos con su dueño) con cuántas tarjetas tiene cada uno (todas las vivas, también las Áreas) y un numerito de las que esperan aprobación, y la lista se vuelve a pedir al abrirlo (`GET /api/cliente/tableros-inteligentes`) para que aparezcan los que Claude acaba de crear. Cada persona tiene el lápiz **Cambiar nombre** en sus tableros (el dueño o el ADMIN, en todos) y abajo **+ Nuevo tablero**: los dos abren un diálogo (Enter guarda, Esc cancela; nombre no vacío, hasta 60 letras y distinto del de otro tablero del negocio sin mirar mayúsculas, regla `problemaDelNombreDeTablero` de `services/reglas.ts`, la misma que usa el servicio; el dueño o el ADMIN eligen además **De quién es** entre los miembros activos). Las server actions `crearTableroAction` y `renombrarTableroAction` pasan por el alcance de la sesión: un tablero ajeno "no existe" y elegir el dueño lo rechaza si no es el dueño o el ADMIN. La barra lo recibe por `<TituloDeLaBarra>` (`src/components/breadcrumb-label-context.tsx`); las demás pantallas siguen con su breadcrumb. Las flechas son rectas y salen por el lado que mira a la otra tarjeta, con puntos que viajan del origen al destino (quietos si el teléfono pide menos movimiento), y una tarjeta nueva nunca cae encima de otra (`services/disposicion.ts`). La ficha de una tarjeta muestra tipo, detalle, link, de quién cuelga, sus hijas, sus flechas, el historial y el botón **Aprobar** (solo lo ven el dueño y el ADMIN de la plataforma, y solo en tarjetas POR_APROBAR de un tipo con aprobación). Se actualiza sola cada 5 s con la pestaña a la vista (`/api/cliente/tableros-inteligentes/<id>?desde=` solo lee `TableroInteligente.actualizadoEn`; nada con la pestaña oculta; 30 s de espera si falla). `?tablero=<id>` abre un tablero, `&area=<id>` un nivel, y `?tarjeta=<id>` abre el nivel de la madre de esa tarjeta con su ficha a la vista (es el link que devuelve el MCP). En el MCP: `listar_tableros`, `crear_tablero`, `renombrar_tablero` (el nombre, con las mismas reglas que en la pantalla, y opcional `dueno`; `crear_tablero` también acepta `dueno`), `ver_tablero`, `listar_tipos`, `crear_tipo`, `editar_tipo`, `crear_tarjeta`, `editar_tarjeta` (ambas con `tipo`, `padre_id`, `link`, `link_texto`, `repo` y `zona_protegida`; sin tipo queda Idea), `conectar_tarjetas`, `cambiar_estado_tarjeta`, `borrar_tarjeta`, `ver_historial_tarjeta`, `deshacer_cambio_tarjeta`, `ver_plan_y_resultado` y `aprobar_tarjeta` (fase 2: el trabajador, ver "Conceptos"). Código en `src/features/tableros-inteligentes` (reglas puras en `services/reglas.ts` y `services/niveles.ts`, pruebas `npm run test:tableros`; la migración de tipos se prueba con PGlite: `npm run test:tablero-tipos-migracion`, y la de tableros por cuenta con `npm run test:tableros-por-cuenta-migracion`) y `src/lib/mcp/tableros-inteligentes.ts`. Es distinto de `diagramas`: no comparten código ni tablas.
- `claude`: las claves para conectar Claude al CRM por el MCP.
- `onboarding`: el alta de un negocio nuevo.
- `reuniones`: **Reuniones** (desde el 23-oct-2026; módulo `reuniones` en la pantalla de permisos: lo ven el dueño, los administradores y quien lo tenga), reuniones solo de voz (sin cámara ni pantalla), propias en vez de Jitsi o Meet. "Nueva reunión" deja un link `/reunion/<título-en-minúsculas>` (el link sale del título: "Reunión de ventas" → `/reunion/reunion-de-ventas`, sin tildes ni ñ, máx. 60 caracteres; si ya existe se agrega `-2`, `-3`…; los links viejos con código al azar siguen funcionando y la sala de LiveKit es aparte, `reunion_<hex>`) con "Copiar" y "Enviar por WhatsApp" (wa.me: lo manda quien lo toca, no usa las líneas del CRM). La página pública `/reunion/<código>` se abre desde el celular o el PC sin instalar nada: el invitado escribe su nombre (quien tiene sesión entra con el suyo), adentro tiene audio, video en vivo (no se graba), compartir pantalla y chat (no se guarda). El pase de entrada lo firma el CRM (`/api/reuniones/pase`, 10 minutos) y no trae permiso de grabar ni de administrar; "Terminar reunión" lo ven quien la creó, el dueño y los administradores. Se graba SOLO EL AUDIO, una pista por persona (LiveKit Egress, sin Chrome); si alguien se cae y vuelve, su pista nueva se une por la hora. Siempre salen nombres, nunca identidades: se guarda el `name` del pase (el del usuario con sesión o el que escribió el invitado), los registros viejos con `u_<id>` toman el nombre del usuario, y los grabadores `EG_...` de Egress no se registran ni cuentan como personas (`servicios/nombres-de-participantes.ts`). El botón "Subir audio" se quitó de la pantalla el 24-oct-2026 (la ruta `/api/reuniones/subir` y su servicio siguen en el código, sin uso). Estados: Esperando, En vivo, En cola, Transcribiendo, Haciendo acta, Lista, Error (con "Reintentar"). El detalle tiene un reproductor por pista (link firmado de 1 hora), la transcripción con nombre y hora, y el acta (resumen, decisiones, tareas con responsable y fecha, mejoras en ventas y "qué puede mejorar Alexander como dueño"). Buscador por texto en títulos, transcripciones y actas. En el MCP: `listar_reuniones` y `ver_reunion` (solo lectura). La sala del navegador carga `livekit-client` 2.x del CDN jsDelivr (`cargar-livekit.ts`), no de npm. Código en `src/features/reuniones` y `src/lib/mcp/reuniones.ts`; pruebas `npm run test:reuniones-unir-pistas`, `test:reuniones-link-firmado` y `test:reuniones-migracion`.

## Entidades

- `User`: una persona que entra a la app. Su `role` (ADMIN, CLIENTE, EMPLEADO) es el rol de la PLATAFORMA: ADMIN abre `/admin`.
- `EmailAuthToken`: tokens de un solo uso por correo (verificar correo, entrar sin contraseña, restablecerla).
- `Workspace`: un negocio. Casi todo cuelga de aquí (multi-negocio).
- `WorkspaceMember`: une una persona con un negocio; su `role` (OWNER, ADMIN, AGENT) y `moduleAccess` (qué pantallas ve).
- `QuickReply`: respuestas rápidas que las asesoras insertan en el chat.
- `Agent`: un agente de IA del V1 o V2 (`agentType`); el V2 guarda su diagrama en `graph`.
- `AgentKnowledgeProduct`: qué productos conoce cada agente y su guion por etapa.
- `AgentCopilotMessage`: la conversación con el copiloto que ayuda a configurar un agente.
- `WhatsAppChannel`: una línea de WhatsApp. `purpose` SALES o ADMIN; en `metadata` el gateway, las colaboradoras, quién está en pausa o monitoreando y si usa el Agente V3.
- `Contact`: el lead / cliente. Etapa del CRM (`crmStage`), motivo de pérdida, fecha real de venta (`wonAt`) y si está oculto del CRM (`excludedFromCrm`). En `metadata` van `city` y `address` de la ficha y, desde el panel de envío, `envio` = `{ gestionId, estado (GRATIS/ADICIONAL/COTIZAR/NO_LLEGA), lugar, consultadoEn, porUserId }`: lo último que se le consultó en Gestión para ese cliente (sin migración).
- `Conversation`: un chat de un contacto en una línea. Asesora asignada, estado, IA pausada, producto activo.
- `Message`: cada mensaje del chat (entrante, saliente o nota del sistema), con su medio y, si es audio, su transcripción.
- `Tag`: una etiqueta del negocio.
- `ContactTag`: qué etiquetas tiene cada contacto.
- `ContactMatch`: lo que el agente detectó en un chat (producto o flujo), con su confianza.
- `ConversationInsight`: lo que pasó en una conversación, leído por la IA y guardado (qué pidió, por qué se cayó).
- `CallAttempt`: un intento de llamada a un lead, con resultado, resumen y próximo contacto.
- `PlaybookScript`: guiones del playbook de ventas que el chat le muestra a la asesora según la etapa.
- `FollowRule`: una regla de seguimiento programado (cuándo y qué mandar).
- `Follow`: un seguimiento agendado para un contacto concreto, que el reloj ejecuta.
- `Campaign`: un envío masivo por tandas.
- `CampaignRecipient`: cada destinatario de una campaña y si ya se le envió.
- `DailyReport`: el informe diario del negocio (números del día, resumen de IA y link público).
- `CoachInforme`: el informe del coach de ventas de un día (uno por negocio y día): resumen del equipo, versión de la política con que se juzgó, tokens y costo estimado de la IA.
- `CoachAsesora`: la parte de cada asesora en el informe del coach: puntaje por eje de la rúbrica (sin "Resultado"), aciertos, errores y pendientes para el día siguiente con el mensaje sugerido. Desde el 10-oct trae en `resumen.habilidad` la "Habilidad del día" (la elige el código con sus conteos, ver `src/features/coach/habilidad.ts` y la fórmula en `politica.ts`): evidencia de sus chats, qué hacer diferente, mensaje modelo y la meta de mañana; lo que es de todo el equipo va una sola vez en `resumenEquipo.problemasDelEquipo`. Cada asesora ve solo la suya.
- `EmbudoEvento`: cada cosa que le pasa a un lead del embudo (entrada, bienvenida, respondió, paso, señal de compra, turno del bot, seguimiento, escalado, asignada, primera respuesta de la asesora, etapa, venta), con el paso, el producto, la regla y la versión del libro. No se edita. Lo escriben el webhook, el motor V3, los relojes, el reparto y el relleno histórico (sección "Historia" de `/cliente/crm/embudo`, solo el dueño; motor en `src/features/embudo/servicios/relleno-motor.ts`, estado en AppSetting `embudo:relleno:<workspaceId>`; también `scripts/embudo-backfill.mjs`). Ver `src/features/embudo`.
- `EmbudoLead`: la foto actual de cada lead del embudo (una por chat): producto y anuncio de entrada, si se mezcló con otro producto, paso actual y máximo, señales y puntaje "en sombra" (no decide nada todavía), transferencia a asesora, primera respuesta, cotización y venta.
- `SupervisorAlerta`: un incidente del Supervisor (uno abierto por clave, que se actualiza en cada vuelta): severidad, desde cuándo, los hallazgos con hechos, hipótesis, evidencia y recomendación, y cuándo se avisó al dueño.
- `WebPushSubscription`: un navegador o celular suscrito a las notificaciones push.
- `MediaLibraryItem`: la biblioteca de archivos (fotos, PDFs, audios) para mandar desde el chat.
- `SugerenciaDeRespuesta`: cada sugerencia de la estrella del cuadro de mensajes (texto que la IA le redacta a la vendedora, nunca se envía sola). Guarda quién la pidió, si la envió y si la editó antes: sirve para medir cuánto la usa cada vendedora.
- `PresenciaEnLinea`: si cada asesora está "Recibiendo clientes" (último latido de la app, desde cuándo está en línea y si se pausó a mano). Una fila por persona y negocio.
- `PeriodoEnLinea`: cada periodo cerrado en que una asesora estuvo recibiendo clientes; de ahí salen las horas por día y por semana en Mi empresa → Actividad.
- `Diagram`: un lienzo de diagrama libre.
- `TableroInteligente`: un tablero de ideas de un negocio (nombre) y de una persona (`duenoUserId`, desde el 20-oct-2026: tableros por cuenta). Esa persona lo ve y lo renombra; el dueño del negocio y el ADMIN de la plataforma ven todos y eligen de quién es cada uno; el MCP ve todos. La migración `20261020180000_tableros_por_cuenta` dejó los que ya existían del dueño del negocio (`Workspace.ownerId`). `actualizadoEn` se toca en cada cambio de sus tarjetas o flechas: es lo único que lee el refresco de la pantalla.
- `TipoTarjeta`: un tipo de tarjeta de un tablero (nombre único en el tablero, color, ícono, orden, `requiereAprobacion`, `usaEstados`). Cada tablero nace con Área (sin estados ni aprobación), Idea y Tarea (con aprobación); la migración `20261019180000_tableros_tipos_tarjeta` se los puso a los que ya existían y dejó todas sus tarjetas como Tarea.
- `TipoTarjetaPadre`: qué tipo puede ser madre de cuál (puede ser el mismo: Área dentro de Área).
- `TarjetaTablero`: una tarjeta del tablero: título, detalle, área (texto libre, se mantiene), estado (`EstadoTarjeta`: IDEA, POR_APROBAR, APROBADO, EN_CURSO, HECHO, FALLIDO y, desde la fase 2 del trabajador, PLANEANDO, PLAN_LISTO, PLAN_APROBADO, POR_REVISAR, SUBIENDO y ERROR; las de un tipo sin estados guardan IDEA y no se muestra), orden, fecha, quién la creó, `tipoId` (obligatorio; un tipo en uso no se borra), `padreId` (su tarjeta madre; si la madre se borra de verdad queda en null), `link`/`linkTexto`, `borradoEn` (borrado suave: toda lectura la ignora; se deshace con su historial) y, para el trabajador (migración `20261020120000_tablero_trabajador`): `repo` (gestion | aizencrm; sin repo el trabajador no la toma), `plan`, `resultado` (JSON: resumen, pruebas, paso, rama, linkRama, commit, migracion, subida, error con motivo), `zonaProtegida` (META_ADS, BOT_VENTAS, LIBRO_V3: se aprueba solo en la pantalla), `intentos` y el candado `trabajoIniciadoEn`/`trabajoVenceEn`.
- `ConexionTarjeta`: una flecha de una tarjeta a otra del mismo tablero (una sola por par y sentido; nunca de una tarjeta a sí misma).
- `HistorialTarjeta`: cada cambio de una tarjeta: quién, cuándo, desde dónde (`origen` MCP, PANTALLA o TRABAJADOR; con TRABAJADOR, `quien` es `trabajador:<id de ClaveTrabajador>`), la acción (crear, editar, estado, conectar, aprobar, borrar, deshacer; un cambio de tipo, madre, link, repo o zona es un "editar"; "borrar" guarda las flechas que quitó para devolverlas al deshacer; un "aprobar" guarda el momento —tarea, plan o subir—, la vía —pantalla o voz—, el nombre y userId de quien aprobó y el texto de confirmación), el antes y el después de los campos tocados (JSON) y si se deshizo. Sirve para ver el historial y para deshacer (las aprobaciones y lo del trabajador no se deshacen).
- `AprobadorTablero`: quién más (además del dueño) aprueba tarjetas del Tablero IA de un negocio: un miembro con `alcance` DESARROLLO (solo tarjetas con repo gestion/aizencrm) o TODO. `puedeSubir` existe pero hoy el sí final (subir a producción) es solo del dueño (`SI_FINAL_SOLO_DUENO` en `reglas-trabajador.ts`).
- `ClaveTrabajador`: la clave con que el trabajador del Tablero IA entra a `/api/trabajador/tablero/*` (Bearer `aizen_trab_...`). Se guarda solo la huella sha256 (se muestra una vez al crearla en la sección Trabajador de la página de inicio de Tablero IA); `ultimoUsoEn` dice cuándo preguntó por última vez y revocar es `revocadaEn`.
- `Reunion`: una reunión del módulo Reuniones: título, `codigo` del link público (24 caracteres al azar), `sala` de LiveKit, `origen` VIVO (videollamada) o SUBIDA (audio subido), `estado` (ESPERANDO, EN_VIVO, EN_COLA, TRANSCRIBIENDO, HACIENDO_ACTA, LISTA, ERROR), `aviso` (p. ej. "Falta la clave de OpenAI"), `intentos` y `motivoError` de la cola, cuándo empezó y terminó, la transcripción unida (`transcripcion` JSON con `{inicioMs, finMs, nombre, texto}` y `textoTranscripcion` en texto) y el acta (`acta` JSON y `textoActa` en texto, para buscar).
- `ReunionParticipante`: quién entró a una reunión: su identidad en LiveKit (`u_<userId>` con sesión, `i_<azar>` invitado; si se cae y vuelve es la misma fila), nombre y cuándo entró y salió.
- `ReunionPista`: un archivo de audio de una reunión: una pista por persona y por cada vez que publicó el micrófono (con su `egressId` de LiveKit Egress), o el audio subido (sin participante). `archivo` es la ruta relativa en el volumen privado de reuniones, `empiezaEn` sirve para unir las pistas por hora, `transcripcion` son sus frases y `estado` GRABANDO, LISTA, TRANSCRITA o ERROR.
- `AppSetting`: clave-valor para configuración y estado sin migrar la base (libro y estado del Agente V3, supervisoras, banderas de automatizaciones, etc.).
- `WebhookEventLog`: archivo de los eventos que llegan por webhook (se purga solo por antigüedad).
- `Product`: un producto del catálogo de un negocio.
- `ProductImage`: las fotos de un producto.
- `Category`: una categoría de productos de un negocio.
- `Supplier`: un proveedor del catálogo (de quién se compra).
- `ProductSupplier`: qué proveedor surte cada producto y a qué costo.
- `Quote`: una cotización a un cliente.
- `QuoteItem`: cada línea de una cotización.
- `ProductPlaybook`: el playbook de ventas de un producto (cómo se vende, con qué palabras se reconoce).
- `ProductPlaybookRule`: cada aprendizaje del playbook, por separado y con fecha.
- `ProductFunnelStage`: una etapa del embudo de ventas de un producto (presentación, identificación, producto, objeciones, cierre).
- `ProductStageFollowUp`: los seguimientos de cada etapa del embudo del producto.
- `SalesFunnel`: nivel 1 del embudo en tres niveles: el embudo del negocio (en construcción, apagado).
- `SalesFunnelStep`: un paso del embudo del negocio.
- `SalesFunnelStepFollowUp`: los seguimientos de un paso del embudo del negocio.
- `CategoryPlaybook`: nivel 2: lo que comparten los productos de una categoría.
- `CategoryObjection`: una objeción típica de una categoría y cómo responderla.
- `ProductSpec`: nivel 3: la ficha técnica de un producto.
- `ProductSpecField`: cada dato de la ficha técnica.
- `ProductObjection`: una objeción propia de un producto.
- `ConversationFunnelState`: en qué paso del embudo va cada conversación y desde cuándo.
- `OfficialApiClientConfig`: la configuración de la API oficial de Meta de un negocio.
- `OfficialApiContact`: un contacto de la API oficial (tabla aparte; se enlaza con `Contact` por `crmContactId`).
- `OfficialApiConversation`: un chat de la API oficial.
- `OfficialApiMessage`: un mensaje de la API oficial.
- `OfficialApiWebhookEvent`: eventos crudos que manda Meta.
- `OfficialApiAutomationRule`: respuestas automáticas por texto en la API oficial.
- `FinanceTransaction`: un ingreso o egreso del módulo de finanzas.
- `FinanceGoogleSheet`: la hoja de Google Sheets que se sincroniza con finanzas.
- `FinanceChatMessage`: la conversación con el asistente de finanzas.
- `FinanceAgentConfig`: las instrucciones del asistente de finanzas.

## Agentes

Hay tres generaciones de agente de IA. Conviven; la herramienta dice en vivo cuál atiende cada línea.

- **V1 (por prompt)**: un agente con un `systemPrompt`, productos que conoce y un embudo de cinco pasos
  escrito en texto. La IA decide todo en cada respuesta. Es el más viejo.
- **V2 (diagrama de nodos)**: el mismo motor del V1, pero configurado como un diagrama (React Flow) que se
  compila a ese motor al publicar (`Agent.graph`). Agregar un tipo de nodo nuevo toca cinco lugares del
  código; si falta el de los manejadores, el nodo se dibuja y no responde a nada sin romper la
  compilación.
- **V3 (libro de reglas)**: arquitectura nueva y separada. Una sola fuente de verdad, el libro de reglas
  (`AppSetting agente-v3:libro:<workspace>`): cada regla dice cuándo se dispara (una frase literal, una
  intención, el paso en que va la charla, un tiempo sin respuesta) y qué hace (mandar un mensaje o un
  flujo, cambiar de paso, mover la etapa, avisar a una asesora, pausar la IA). El motor es determinista:
  la única llamada a la IA es para clasificar intenciones, y los empates se resuelven por el orden del
  libro (las reglas genéricas van al final). Tiene simulador y se edita por el MCP (`v3_*`). Se prende
  por línea con `agenteV3: true` en el metadata del canal.

Reglas que valen para todos los agentes: ningún agente pone GANADO ni PERDIDO (cerrar es decisión
humana; la única excepción es el descarte automático, por un camino aparte y hoy apagado); el agente
nunca repite un mensaje que ya mandó ese día (si no sabe qué decir, avisa a una asesora); un chat con
la IA pausada no lo contesta el agente.

## Conceptos del negocio

- **Etapas del CRM** (`Contact.crmStage`): NUEVO (en pantalla "---", sin etapa todavía; hasta el 03-oct-2026 decía "Nuevo"), CALIFICADO ("Frío"), PROPUESTA
  ("Tibio"), NEGOCIACION ("Caliente"), GANADO y PERDIDO ("Descartado"). Los nombres internos no
  coinciden con los de la pantalla. Las cuatro primeras son las "vivas". Hay relojes que enfrían un lead
  sin respuesta (Tibio a Frío) y lo recalientan cuando vuelve a escribir.
- **Embudo por producto**: cada producto tiene su embudo de cinco pasos (presentación, identificación,
  producto, objeciones, cierre) con guion y seguimientos por paso. El paso en que va un chat es distinto
  de la etapa del CRM.
- **Flujos**: mensajes armados (texto y archivos en orden) que se mandan de una vez. Escribir
  `/nombre-del-flujo` en un guion lo ata a ese producto.
- **Seguimientos**: hay tres clases. Los programados (`FollowRule` y `Follow`); los de cada paso del
  embudo del producto; y los del Agente V3, que son reglas "si no contesta en X minutos" y miran el paso
  en que va la charla.
- **Campañas**: envíos masivos por tandas a los contactos de una etapa, con intervalo entre tandas. Solo
  entran contactos que escribieron en los últimos 30 días, y a cada uno se le aplica el freno de
  automáticos antes de mandarle (los frenados quedan como `FAILED` con error "Frenado: …").
- **Mi día**: la pantalla de cada asesora con sus leads del día, sus números y a quién llamar primero.
- **Contactos ocultos del CRM** (`excludedFromCrm`): contactos que no son leads (proveedores, logística).
  Salen de los tableros, el kanban y los conteos, pero sus chats siguen en la bandeja. Se ocultan a mano,
  o solos cuando escriben por una línea administrativa (`purpose = ADMIN`).
- **Reparto**: un chat se asigna por turnos entre las colaboradoras de la línea que no estén en pausa
  ni fuera de su horario (Mi empresa → Equipo). Se dispara cuando la clienta contesta con contenido a
  algo del agente o de un flujo (desde el 02-10-2026), cuando el agente pide un asesor, o por el
  rescate de chats huérfanos; si viene de un anuncio con regla de campaña, va a quien diga la regla. El
  reparto nunca le quita un chat a quien ya lo tiene. Solo en líneas de ventas (`purpose = SALES`).
  Desde el 06-10-2026 **el reparto avisa al asignar**: la asesora que recibe el chat recibe un push
  "Nuevo chat asignado" (nombre o teléfono del cliente y su último mensaje) que abre ese chat. Solo le
  llega si activó las notificaciones en ese aparato. Cuando el reparto lo dispara el agente al pedir
  asesor, ella ya recibe el WhatsApp del aviso y el push solo sale si ese WhatsApp no le llegó. El
  mismo chat no repite el push en 2 minutos (`src/lib/reparto-de-leads.ts`).
  Desde el 08-10-2026 **solo reciben las asesoras "en línea"**: con el CRM abierto quedan "🟢 Recibiendo
  clientes" solas y siguen así aunque escondan la app o bloqueen el celular; solo salen solas del
  reparto si pasan 2 horas sin abrir el CRM (`PAUSA_SOLA_SIN_ABRIR_MS`). Las horas "recibiendo" se
  miden hasta el último latido + 6 min, no las 2 h de espera. Pueden ponerse en Pausa a mano desde la barra superior (vale hasta que la quiten o hasta el
  día siguiente). Si nadie está recibiendo, el cliente va a la **asesora de respaldo** (Mi empresa →
  Actividad), con push a ella y a los administradores (a ellos, uno cada 30 min). El respaldo no mueve la
  rueda del turno. La pausa de reparto de Equipo sigue mandando por encima (`src/lib/en-linea-reglas.ts`).
  El respaldo (y sus avisos) solo funciona de **7 a. m. a 11 p. m.** (`FRANJA_DEL_RESPALDO`). De noche,
  sin nadie en línea, el bot atiende y el chat queda sin dueña con una nota "de madrugada"; desde las
  7:00 esos chats se reparten (más antiguos primero, a la que menos lleva) a las que van quedando en
  línea, con tope de 3 por asesora (`TOPE_DE_MADRUGADA_POR_ASESORA`); desde las 8:00
  (`REPARTO_LIBRE_DE_MADRUGADA_HORA`) lo que quede va por la rueda normal o al respaldo
  (`src/lib/reparto-de-madrugada.ts`, en el reloj de cron/follows).
- **Ganado exige cotización**: nadie puede marcar GANADO sin el número de la cotización de Gestión
  (`COT-00123`), desde ninguna pantalla; se guarda en `Contact.wonQuoteRef` junto a `wonAt`. Ningún
  agente ni automatismo pone GANADO o PERDIDO.
- **Contactos bloqueados** (`Contact.bloqueadoEn`): solo dueño o admin bloquean desde la bandeja. Se
  bloquean en WhatsApp en cada línea donde tienen chat, salen de la bandeja y del CRM y se les pausa el
  agente. Se desbloquean en Contactos → Bloqueados.
- **El Agente V3 y el catálogo**: el V3 contesta por reglas, que nombran productos por su id (hoy solo el
  Combo Camillas). Si ninguna regla aplica y la clienta nombra un producto ACTIVO del catálogo (por código
  o por las palabras del nombre), le responde con nombre, precio, descripción de venta y foto, o le
  pregunta cuál si encaja con varios, y avisa a una asesora. Un producto inactivo (oculto o borrado en
  Gestión) no se ofrece: sus reglas no se aplican y una charla que era de ese producto pasa a una asesora.
- **Precio al por mayor**: el agente (V3 y V2) nunca lo menciona ni lo ofrece, aunque Gestión lo tenga.
  Si una clienta pide 3 o más unidades o pregunta por precio al por mayor, el V3 le dice que la atiende
  una asesora, no da el precio y avisa (`agente-v3/servicios/mayorista.ts`, va antes que las reglas).
- **Freno de automáticos**: ningún mensaje automático (seguimientos del V3, programados, reactivación, campañas)
  sale si el último mensaje nuestro no está leído, ni un tercero seguido sin respuesta del cliente. Las
  respuestas a lo que escribe el cliente no pasan por el freno.
- **Origen Marketplace** (desde el 06-10-2026): la extensión NETMAGI (repo `messenger-basic`) atiende a
  los compradores de Facebook Marketplace y, cuando les pasa el WhatsApp (3046481994, línea "Ventas 2"),
  agrega un enlace wa.me con el texto pre-llenado "Hola, vengo de Marketplace 🛒 (ref MK-XXXXX)".
  MK-XXXXX es un hash corto de la cuenta de Facebook que lo atendió (no es su id ni su nombre). Si ese
  texto ("vengo de Marketplace" o "ref MK-") llega como PRIMER mensaje de un contacto, el webhook de
  Evolution/WAHA (en un `after()`, sin demorar al agente) le pone la etiqueta **Marketplace** (la crea
  si no existe), guarda `Contact.metadata.origen = { canal: "marketplace", cuenta: "MK-XXXXX", fecha,
  channelId }` y, si no tenía, `metadata.crmOrigin = "marketplace"` (el CRM lo muestra en el origen
  MARKETPLACE). No re-escribe un origen ya guardado (`src/lib/origen-marketplace.ts`). Para medir:
  contactos con la etiqueta → cuántos llegaron; de esos, `crmStage = GANADO` → cuántos compraron. Para
  saber a qué cuenta corresponde un MK-XXXXX: en el CRM de NETMAGI, los eventos `whatsapp` llevan
  `detalle.ref` con el mismo código y la cuenta que los mandó. Al V3 ese texto le llega como un saludo
  normal (sale la Bienvenida, probado el 06-10-2026). Si el cliente borra el texto pre-llenado o
  escribe al número a mano, no se detecta.
- **Roles**: asesora (sus chats), supervisora (ve "Todas" pero solo de sus líneas, asigna, ve tableros y
  automatizaciones; se guarda en `AppSetting equipo:supervisoras:<workspace>`), administradora y dueño.
  La monitora mira sin poder escribir.

- **Tablero IA — estados y quién aprueba**: IDEA (una idea suelta), POR_APROBAR (lista para que
  el dueño la mire), APROBADO, EN_CURSO, HECHO y FALLIDO. Claude crea tarjetas como IDEA o POR_APROBAR y
  las mueve de estado, pero **nunca aprueba por su cuenta**: aprobar es su propia acción (botón de la
  pantalla, o `aprobar_tarjeta` del MCP SOLO cuando la persona lo dijo explícitamente, con su texto "sí,
  apruebo"), y solo desde POR_APROBAR (se valida en el servidor). Lo que no está aprobado no se ejecuta:
  EN_CURSO solo sale de APROBADO, y HECHO o FALLIDO de APROBADO o EN_CURSO. Si Claude edita una tarjeta
  aprobada, vuelve a POR_APROBAR. Toda escritura deja una fila en `HistorialTarjeta`.
- **Tablero IA — el TRABAJADOR (fase 2, 20-oct-2026)**: una Tarea con `repo` (gestion o aizencrm) la
  ejecuta un PC aparte ("aizen1", carpeta `trabajador-tablero/` de este repo; NADA corre en el servidor de
  producción): pregunta cada minuto por HTTPS (`POST /api/trabajador/tablero/tomar`, con su clave) y la
  lleva por APROBADO → PLANEANDO (escribe un plan con `claude -p --permission-mode plan`) → PLAN_LISTO →
  (el dueño aprueba el plan) PLAN_APROBADO → EN_CURSO (lo construye en la rama `tablero/<id>-<slug>`, corre
  tsc, lint, build y pruebas él mismo, marca las zonas protegidas que toca, ensaya la migración en PGlite y
  en producción dentro de BEGIN…ROLLBACK, y sube SOLO la rama) → SUBIENDO (rebase; si main no cambió no
  vuelve a compilar, si cambió verifica y ensaya de nuevo; push a main, espera el CI y comprueba
  `/api/version`) → HECHO con el resumen, el commit y su link; o ERROR con el motivo en palabras sencillas
  y el detalle técnico. Esos estados los pone solo el trabajador (`cambiar_estado_tarjeta` no puede). Un
  solo trabajo a la vez por negocio (candado con vencimiento: 5 min sin latido, tope 20/90/45 min por etapa;
  vencida = ERROR "se pasó del tiempo"). Desde ERROR el dueño reintenta (vuelve a APROBADO o a
  PLAN_APROBADO). Aprueban: el dueño todo; un aprobador (`AprobadorTablero`) DESARROLLO la tarea y el plan
  de tarjetas con repo; el sí final solo el dueño. Una tarjeta con zona protegida (Meta Ads, bot de ventas,
  libro V3, chats) se aprueba solo en la pantalla y solo el dueño; Claude puede ponerle la zona, no quitarla.
- **Tablero IA — sube solo (21-oct-2026, decisión de Alexander)**: el flujo es Planear → Aprobar plan →
  Hacer, y Hacer incluye subir a producción. Con `subirSolo` prendido en la configuración del trabajador
  (por repo), una tarjeta que pasa todo y no toca una zona protegida pasa de EN_CURSO directo a SUBIENDO
  (`destinoDelResultado` en `reglas-trabajador.ts`) y `/tomar` la elige antes que cualquier otra; ya no
  pasa por POR_REVISAR. Las zonas protegidas son CHATS (envío y recepción de WhatsApp, Evolution API,
  webhooks, la bandeja de las asesoras), BOT_VENTAS (bot de ventas, agentes V2/V3, flujos y sus
  pantallas), LIBRO_V3 y META_ADS (también la pantalla de campañas); el trabajador las detecta por los
  archivos que tocó (globs en su `config.local.json`). Si toca alguna, la construye y prueba igual pero
  queda POR_REVISAR marcada con la zona hasta el "Sí, subir a producción" del dueño en la pantalla (antes
  quedaba ERROR). El plan lo dice desde el principio: "Al terminar: sube solo a producción" o "Al
  terminar: espera tu sí (toca chats / agentes / Meta Ads)". Si el despliegue falla después de subir (CI
  que falla, `/api/version` que no muestra el commit o no contesta), el trabajador hace `git revert` en
  main (sin forzar, conservando las carpetas de migración) y la deja ERROR "Se subió, no arrancó y se
  deshizo"; si no puede, el motivo empieza con "URGENTE: no se pudo deshacer, revisar a mano". El
  historial de la tarjeta guarda "construido, sube solo" o "construido, espera tu sí (zona X)", "subido a
  main, commit X; en producción, versión X", o el error con la reversión (`resultado.error.reversion`).
  Con `subirSolo` apagado todo sigue como antes (POR_REVISAR); en aizencrm el trabajador no arranca con
  `subirSolo` prendido si le falta la zona CHATS.
  Contadores: "te toca" = POR_APROBAR + PLAN_LISTO + POR_REVISAR + ERROR + FALLIDO; "en curso" =
  PLANEANDO + PLAN_APROBADO + EN_CURSO + SUBIENDO; "siguen" = IDEA + APROBADO. En la pantalla (desde el
  23-oct-2026), la ficha de una tarjeta con aprobación muestra ARRIBA solo el repo, la zona, un **resumen
  corto** (hasta ~300 caracteres, en lenguaje sencillo: sale de las primeras líneas útiles de
  `resultado.resumen`, o de la sección "Qué se cambia" del plan, o del detalle; sin markdown ni frases de
  relleno; `services/resumen-corto.ts`) y el botón que toca: Aprobar tarea / Aprobar plan / **Sí, subir**
  (grande, solo el dueño, con confirmación en la misma pantalla "Se sube a producción. ¿Seguro?"; sale
  también con zona protegida y solo si el trabajador dijo que todo pasó) / Reintentar. Todo lo técnico
  (detalle completo, plan, resumen completo, pruebas, rama, commit, migración, error completo e
  historial) va en el acordeón cerrado **Ver detalles**. Ojo: un ADMIN de la plataforma que no es la
  cuenta dueña registrada del negocio NO ve "Sí, subir" (el servidor se lo rechazaría: el sí final es solo
  del dueño). La vista Lista / "Te toca a ti" ya no existe en la pantalla (el mapa la reemplazó; "Te toca"
  es un chip del mapa y el endpoint `pendientes` sigue, sin uso en la pantalla). El dueño (o el ADMIN de la plataforma, desde el 20-oct-2026) tiene el panel
  Trabajador (la sección de la página de inicio de Tablero IA: clave y aprobadores); sus server actions piden lo mismo
  (`personaPuedeAprobar`), así que una asesora no lo ve ni lo puede llamar.
  Solo las tarjetas de un **tipo que pide aprobación** (Tarea) pasan por POR_APROBAR y APROBADO; las de un tipo
  sin aprobación (Idea) van libres entre IDEA, EN_CURSO, HECHO y FALLIDO, y las de un tipo **sin estados**
  (Área) no tienen estado. Cambiarle el tipo a una tarjeta la deja POR_APROBAR (tipo con aprobación) o IDEA
  (sin): pierde la aprobación. Claude puede crear y editar tipos pero no quitarles la aprobación (solo el dueño
  en el panel Tipos, y nunca con tarjetas APROBADAS o EN_CURSO), ni quitarles los estados si alguna tarjeta
  tiene un estado distinto de IDEA. Los tipos se borran solo en la pantalla y solo si ninguna tarjeta (ni una
  borrada) los usa.
- **Tablero IA — tableros por cuenta (20-oct-2026)**: cada tablero es de una persona (`duenoUserId`). En la
  pantalla, cada quien ve, crea y renombra SUS tableros; el dueño del negocio y el ADMIN de la plataforma
  (`personaPuedeAprobar`) ven todos, con la etiqueta "de Emanuel Diaz" en los que no son suyos, y en el
  diálogo del nombre eligen "De quién es" entre los miembros activos del negocio. Lo aplica el servicio con
  el `Alcance` de la sesión (`alcanceDe` en `services/tableros.ts`): el listado y el selector, abrir un
  `?tablero`/`?tarjeta`/`?area` (uno ajeno vuelve al listado), "Te toca a ti", el refresco de 5 s (404) y
  todas las server actions (aprobar, historial, zonas, tipos, crear y renombrar). El MCP ve todos los
  tableros (la clave es del negocio); `listar_tableros` y cada respuesta dicen de quién es (`dueno`), y
  `crear_tablero` / `renombrar_tablero` aceptan `dueno` (nombre o email de un miembro activo; sin él,
  `crear_tablero` lo deja de la persona de la clave). El trabajador sigue tomando tarjetas de TODOS los
  tableros del negocio. Las reglas de aprobación y estados no cambiaron.
- **Tablero IA — motores del trabajador y aviso por WhatsApp (23-oct-2026)**: el trabajador (aizen1) planea
  y revisa con Claude Code y construye con Codex CLI (sesión de ChatGPT Plus), según `motores` de su
  `config.local.json`. Codex solo escribe archivos en el worktree (`codex exec --sandbox workspace-write`,
  nunca sin sandbox); commit, verificación y subida siguen siendo del trabajador. Si Codex se agota, la
  tarjeta se suelta sin ERROR y no pasa a Claude (salvo `respaldoClaude`). Cada 10 min lee `claude -p
  /usage`: con la sesión o la semana en 80 % o más, todos los pasos van con Codex y le avisa al dueño UNA vez
  por cruce. El resultado de la tarjeta guarda `resultado.motor` (`{ plan, construir, revisar }` = claude |
  codex; `resultadoDeEntrada` en `reglas-trabajador.ts`) y el plan termina con "Plan escrito con: …".
  El aviso sale por **`POST /api/trabajador/aviso`** (misma clave Bearer del trabajador que
  `/api/trabajador/tablero/*`; cuerpo `{ texto }` de hasta 500 caracteres; código en
  `services/aviso-del-trabajador.ts`): un WhatsApp desde la línea del negocio llamada "Admin" (si no, la de
  purpose ADMIN; conectada primero) con el envío de siempre (`sendEvolutionTextMessageWithReconnect`, que
  también sabe WAHA), al número de la AppSetting **`trabajador:aviso-telefono:<workspaceId>`** (solo
  dígitos, con indicativo). Sin número o sin línea Admin contesta 412; más de un aviso por minuto, 429. No
  queda guardado en ningún chat.

## Automatizaciones

- `seguimientos_programados`: el reloj manda los seguimientos agendados (Follow) cuando les toca.
- `seguimientos_v3`: las reglas "sin respuesta" del Agente V3: le escriben al cliente callado a los 15 minutos o a la hora, según el paso en que va.
- `aviso_cliente_esperando`: si un cliente escribió y lleva 15 minutos sin respuesta, se le avisa a la asesora (no le escribe al cliente).
- `rescate_de_mensajes_v3`: vuelve a pasarle al motor un mensaje que nunca miró (por una caída o un despliegue), solo en chats sin asesora ni pausa. Siempre activo: no tiene interruptor (desde el 11-10-2026).
- `rescate_de_chats_huerfanos`: reparte un chat que lleva media hora con el cliente esperando y sin nadie a cargo, y la asesora que lo recibe recibe el push "Nuevo chat asignado". Cuenta como repartido solo lo que de verdad se asignó.
- `reparto_por_turno`: en las líneas de ventas, cuando la clienta contesta CON CONTENIDO (no solo saludo, emoji, "ok" o "gracias") a algo del agente o de un flujo y el chat no tiene asesora, se reparte por la rueda de la línea y la asesora recibe el push "Nuevo chat asignado". Asignar no pausa al agente: sigue hasta que la asesora escribe.
- `enfriamiento_por_llamadas`: un lead en Caliente baja a Tibio con la regla del Playbook: 3 intentos nuestros sin respuesta (mensajes de asesora o llamadas), 5 días desde su último mensaje y cero respuesta. Nunca si tiene cotización o próximo contacto agendado. Vuelve a Caliente si contesta.
- `temperatura`: un lead en Tibio baja a Frío con la misma regla del Playbook (ver `enfriamiento_por_llamadas`); nunca si tiene cotización. Vuelve a Tibio si contesta. Hasta el 03-10-2026 bajaba con "2 días sin escribir".
- `descarte_automatico`: lleva a Descartado a los leads con 30 días sin respuesta y 3 insistencias nuestras. Se corrió una vez y se apagó; hoy no aparece en pantalla.
- `campanas`: manda la siguiente tanda de cada campaña en curso.
- `transcripcion_de_audios`: pasa a texto cada nota de voz (Whisper) y la deja debajo del audio.
- `purga_de_webhooks`: borra el archivo de webhooks viejo para no llenar el disco.
- `sincronizacion_gestion`: trae el catálogo de Gestión (magilus.com) una vez al día a las 3 a. m. y con el botón "Sincronizar con Gestión". Gestión manda nombre, código, precios, categoría e imágenes (las que no cargan se descartan); la descripción de venta, el embudo, los seguimientos y los flujos son del CRM y no se tocan. Un producto oculto o borrado en Gestión queda inactivo, nunca se borra. No corre hasta que se apruebe el emparejamiento de los productos que ya existían.
- `informe_diario`: a las 11:59 p. m. (hora de Colombia) arma el informe del día y lo manda por WhatsApp. El reloj se autentica con cualquiera de `DAILY_REPORT_CRON_SECRET` o `FOLLOW_CRON_SECRET` (en `x-daily-report-secret`, `x-follow-cron-secret`, `x-webhook-secret` o `Authorization: Bearer`), comparado en tiempo constante. Hasta el 06-10-2026 solo valía el primero configurado y el informe podía responder 401 y no salir.
- `coach_de_ventas`: entre las 11:30 y las 11:58 p. m. (hora de Colombia), con el mismo reloj del informe diario, lee los chats del día de las líneas de ventas y deja por asesora aciertos, errores (sin respuesta, demoras de más de 15 min en horario L-V 8-18 y S 9-14, promesas sin cumplir, envío cobrado donde es gratis, contraentrega, descartes antes de 72 h), puntaje y pendientes para el día siguiente con el mensaje sugerido. Un informe por negocio y día. Solo corre en los negocios que lo prendieron en la pantalla del coach. Usa OpenAI (`gpt-4.1-mini`, o `COACH_MODEL`), sin teléfonos completos. Nunca escribe a clientes ni toca el bot. Las reglas están en `src/features/coach/politica.ts`.
- `reuniones_transcripcion`: la cola del módulo Reuniones. Toma UNA reunión a la vez (la que lleva más esperando "En cola"), pasa a texto cada pista con la API de OpenAI (`whisper-1` en español, con la hora de cada frase; los archivos de más de 25 MB se parten con ffmpeg en pedazos de 10 minutos; una pista ya transcrita no se vuelve a pagar), une las pistas por hora con el nombre de quien habló y hace el acta con `gpt-4o-mini`. Si falla reintenta (a los 5 y 10 minutos) y al 3.er fallo queda en Error con el motivo. Sin `OPENAI_API_KEY` no gasta intentos: la reunión queda "En cola" con el aviso "Falta la clave de OpenAI". Cada minuto revisa también las reuniones con más de 30 minutos "En vivo" y le pregunta a LiveKit si la sala sigue abierta, por si se perdió el aviso del cierre. Corre en el servidor del CRM, no en aizen1 (sin GPU, 1 hora de audio tardaba 47 minutos con la CPU al 100 %). Cuesta unos 0,36 USD por hora de audio por persona. Código en `src/features/reuniones/servicios/cola-de-reuniones.ts`.

## Qué no existe hoy

- **No hay fecha de pérdida**: PERDIDO se ubica en el tiempo por `updatedAt` (la última vez que se tocó la
  ficha), no por cuándo se perdió. Por eso "perdidos del mes" es aproximado: la corrida del descarte
  automático del 30-09-2026 marcó ~1.100 leads y todos parecen perdidos en septiembre.
- **No hay historial de etapas**: el contacto solo guarda la etapa en la que está hoy, no por dónde pasó.
- **Ganados sin fecha**: los ganados históricos sin `wonAt` no entran en ningún periodo.
- **La etiqueta "Proveedor" no oculta del CRM**: existe, pero no está conectada a `excludedFromCrm`.
- **Los audios de la API oficial no se transcriben** (solo los de las líneas por Evolution/WAHA).
- **Un mismo cliente puede tener dos chats** (uno por línea, o el del número oculto de un anuncio con
  `@lid`); cada uno se reparte por separado.
- **El rol de la sesión no se relee**: el JWT guarda el rol al iniciar sesión y dura hasta 30 días.
  Bajarle el rol a alguien se nota del todo cuando vuelve a entrar (`/admin` sí lo verifica en la base).
- **"Hacer administrador" da el admin de la plataforma** (`User.role = ADMIN`, abre `/admin`), no solo
  el del negocio.
- **Casi no hay pruebas automáticas**: el chequeo es `tsc`, `eslint` y el build, más el recorrido E2E de
  solo lectura (ver "Pruebas E2E").
- **El PDF de una conversación no muestra emojis** (fuentes estándar sin emoji) ni reproduce audios; para
  eso está la descarga con audios (HTML).
- **El embudo en tres niveles** (SalesFunnel, CategoryPlaybook, ProductSpec) tiene tablas pero no está
  en uso.
- **Las líneas por WAHA salen todas por una sola IP** del servidor.
- **La cotización de un Ganado no se verifica contra Gestión**: solo se valida el formato. Gestión no
  tiene cómo consultar una cotización por número (su MCP solo lista por fechas y trae el nombre del
  cliente, sin teléfono).
- **Los clientes con el visto apagado no reciben automáticos**: sus mensajes nunca pasan a "leído", así
  que el freno los detiene siempre (1 de cada 4 chats que responden, medido el 02-10-2026).
- **El buscador de chats no busca en todos los mensajes**: la caja "Buscar chats" de la bandeja (y la
  `q` de `/api/cliente/chats/list` y `/counts`) busca nombre y número siempre, pero en el texto de los
  mensajes solo con 4 letras o más y solo en los de los últimos 90 días (`lib/busqueda-de-chats.ts`). No
  hay índice de texto (`pg_trgm`) en `Message`; buscar en todo sería recorrer la tabla en cada pedido.

- **Tablero IA, trabajador**: corre en UN PC (aizen1) y solo si está prendido y con `claude` y `codex`
  logueados; si se apaga a mitad de algo, la tarjeta queda ERROR por vencimiento. El único aviso por
  WhatsApp es el del uso de Claude (`/api/trabajador/aviso`); su límite de 1 por minuto vive en la memoria
  del proceso (se reinicia con el contenedor). No hay todavía avisos por WhatsApp de tarjetas por aprobar, ni aprobar respondiendo "sí" por WhatsApp (sí en la conversación con Claude, con
  `aprobar_tarjeta`). Solo conoce los repos `gestion` y `aizencrm` (lista fija en el código). Las tarjetas
  sin repo siguen la fase 1 (APROBADO → EN_CURSO → HECHO a mano). Los latidos del trabajador no quedan en
  el historial.
- **Tablero IA, sube solo: nadie mira el resultado antes de producción.** Lo frena que compile, pasen las
  pruebas que ya existen, no haya lint nuevo y la migración se ensaye; un error de lógica que compile bien
  llega igual. La lista de rutas de chats, agentes y Meta Ads es a mano (globs en `config.local.json` de
  aizen1): un archivo nuevo de esas áreas que no calce con ninguna subiría solo. Deshacer (revert) no
  deshace la base: lo que agregó una migración que ya corrió queda (es aditiva). No hay pruebas
  automáticas nuevas del flujo de subir solo ni de la reversión.
- **Tablero IA: borrar.** No se borran tableros. `borrar_tarjeta` (MCP) es un borrado SUAVE (`borradoEn`):
  quita la tarjeta con todas sus flechas en un paso, guarda esas flechas en el historial y se deshace con
  `deshacer_cambio_tarjeta` (vuelven las flechas cuya otra punta no está borrada). Por el MCP no borra lo
  que tiene el trabajador en la mano (PLANEANDO, EN_CURSO, SUBIENDO), ni APROBADO, PLAN_APROBADO o
  POR_REVISAR, ni ninguna tarjeta con zona protegida (esas, solo en la pantalla). PLAN_LISTO y ERROR se
  borran solo por voz del dueño: `texto_confirmacion` con "sí" y una palabra de borrar ("sí, bórrala") y
  la cuenta de la clave tiene que ser la dueña. El historial guarda quién, el texto exacto y "borrado por
  voz por <nombre>"; con esa marca, deshacer la trae de vuelta con su estado, su plan y sus flechas (un
  borrado de PLAN_LISTO o ERROR sin la marca no se deshace). Sus hijas se ven sueltas hasta que se deshaga. La pantalla no edita tarjetas: aprueba,
  administra los tipos y crea o renombra tableros. Renombrar un tablero (o cambiarle el dueño) no queda en
  ningún historial (el historial es por tarjeta) y no hay forma de deshacerlo salvo volver a renombrarlo.
- **Tablero IA: no hay tableros compartidos.** Un tablero es de UNA persona (o de nadie): no se puede
  compartir con dos personas que no sean el dueño del negocio. Un tablero sin dueño (su dueño se borró, o
  el negocio no tenía `ownerId` al migrar) lo ven solo el dueño del negocio y el ADMIN. El nombre de un
  tablero no se puede repetir en el negocio aunque el otro no se vea, y el aviso dice su nombre.
- **Reuniones: solo voz.** No hay cámara, video ni compartir pantalla (la sala pide solo micrófono y el pase de LiveKit solo deja publicar `microphone`). Solo se graba el audio, una pista por persona; el video compuesto (mp4) no
  está en esta versión porque Egress con Chrome come de 2 a 6 núcleos. El chat de la sala no se guarda.
  En un audio subido no se separa quién habló (sale todo como "Audio"). No se borran reuniones ni audios
  desde la pantalla. No hay MinIO: los audios viven en el volumen `aizenbot_reuniones`.
- **Reuniones: la sala carga `livekit-client` del CDN.** No se usan los paquetes de npm de LiveKit
  (`livekit-server-sdk`, `@livekit/components-react`): el trabajador que construyó el módulo no podía
  instalar paquetes. El servidor habla con LiveKit con `node:crypto` y `fetch` (`servicios/livekit.ts`) y
  la sala carga `livekit-client` 2.x de jsDelivr (`components/cargar-livekit.ts`, se puede fijar otra
  dirección con `NEXT_PUBLIC_LIVEKIT_CLIENT_URL`). Si jsDelivr no responde, no se puede entrar a la sala.

## Advertencias de operación

- **Una migración que falla tumba la app**: el contenedor corre `prisma migrate deploy` antes de
  arrancar, con `set -eu`. Si la migración falla, el servidor no arranca. Las migraciones se escriben a
  mano, aditivas, y se ensayan en producción dentro de una transacción que se deshace antes de subir.
- **No usar `prisma migrate dev`** contra la base: tiene drift y querría borrarla. El puerto 5432 está
  cerrado desde afuera; para leer la base se entra por SSH al servidor.
- **Un respaldo nunca se restaura sobre producción**: siempre en una base de pruebas aparte
  (`docker/respaldo/restaurar-prueba.sh` arma una desechable sin red y compara los conteos). Los pasos
  están en el README, "Respaldo de la base". Las claves (token de Drive, conexión de solo lectura, correo)
  están solo en las variables del servicio `aizenbot_respaldo` en Portainer y en `config.local.json` de
  aizen1. Las copias tienen teléfonos y conversaciones de clientes: la carpeta de Drive no se comparte.
- **Todo push a `main` se despliega solo** si el CI pasa. Para cambios que se quieren revisar antes, rama
  y pull request.
- **El contenedor corre en UTC**: las fechas que se muestran tienen que fijar `timeZone:
  "America/Bogota"`. En SQL, las columnas de Prisma son `timestamp without time zone` en UTC: para hora de
  Colombia usar `col - interval '5 hours'`, no `AT TIME ZONE` (da 10 horas de error).
- **Leer `rawPayload->>'campo'` sobre muchos mensajes es lentísimo** (detoast del JSON). Acotar siempre
  por fecha y preferir una columna que diga lo mismo.
- **La bandeja une dos consultas** (Evolution/WAHA y API oficial): un filtro nuevo hay que aplicarlo en
  las dos, en `/list`, en `/counts` y donde la página lee el filtro de la URL.
- **WhatsApp devuelve el eco de todo lo que mandamos**: si el eco llega antes de que el envío se guarde,
  puede parecer un mensaje escrito desde el celular. WAHA marca el origen (`source: api/app`) y el
  webhook lo usa para no pausar la IA por un eco propio.
- **Cada cambio de gateway se prueba primero en una línea de pruebas, y probando el ENVÍO**: una línea
  puede conectar y recibir y aun así no poder enviar.
- **Tablero IA: Claude nunca aprueba por su cuenta.** `cambiar_estado_tarjeta` no pone APROBADO ni
  ningún estado del trabajador. La única puerta es `aprobar_tarjeta`, que exige el texto de la persona
  ("sí" y "apruebo"), que el userId de la clave MCP sea el dueño o un aprobador con alcance, que el estado
  corresponda, y rechaza las de zona protegida. El sí final (subir a producción) es solo del dueño.
  `deshacer_cambio_tarjeta` no deja ni quita una aprobación y no deshace una aprobación, lo hecho en la
  pantalla ni lo del trabajador. Si Claude edita algo aprobado, vuelve a pedir aprobación.
- **Tablero IA: por voz aprueba la cuenta que creó la clave de Claude, no la que mira la pantalla.**
  La clave MCP guarda el negocio y la cuenta de quien la creó, y esa cuenta firma todo lo que hace
  Claude. Para aprobar por voz hay que crearla entrando con la cuenta DUEÑA del negocio (en Magilus:
  "Magilus", gestionmagilus@gmail.com), no con la ADMIN de la plataforma (GCM Projects). Cuenta como
  dueña (`esDuenoDelNegocio` en `reglas-trabajador.ts`): la cuenta dueña registrada del negocio
  (`Workspace.ownerId`), aunque sea ADMIN, o una CLIENTE con rol OWNER; siempre miembro activa. Ser ADMIN
  de la plataforma solo no da poder de dueño (en la pantalla sí aprueba la tarea y el plan, por voz no).
  Si falla, el error de `aprobar_tarjeta` dice con qué cuenta (nombre y correo) llegó la conexión y por
  qué no es la dueña. Esta regla es solo del Tablero IA: `client-workspace-access.ts` no cambió. Lo mismo
  vale para borrar por voz una tarjeta PLAN_LISTO o ERROR con `borrar_tarjeta`: antes de borrar, Claude
  le lee el título a la persona y espera el "sí, bórrala"; nunca borra por su cuenta.
- **Tablero IA: el trabajador sube solo a producción.** Desde el 21-oct-2026, con `subirSolo` prendido,
  una tarjeta que pasa todo y no toca chats, agentes, el libro V3 ni Meta Ads se empuja a `main` sin el sí
  final, y todo push a `main` de AizenCRM se despliega solo. Aprobar el plan es la última aprobación. El sí
  final ("subir") queda para las de zona protegida y las que ya estaban POR_REVISAR; antes de subir el
  trabajador verifica y ensaya de nuevo si `main` cambió; si algo falla, no sube y queda ERROR.
- **Tablero IA: la reversión automática hace un commit en main.** Si el despliegue falla después de
  subir, el trabajador empuja un `revert` a `main` (sin forzar), que también se despliega. No deshace la
  base (una migración que ya corrió deja lo que agregó) y conserva la carpeta de la migración. Si la
  tarjeta dice "URGENTE: no se pudo deshacer, revisar a mano", el commit roto sigue en `main`: revertirlo
  a mano. Para actualizar aizen1 al flujo nuevo hay que traer el código, agregar `subirSolo` y la zona
  CHATS en `config.local.json` (y `subirMinutos` 44) y reiniciar el trabajador.
- **Tablero IA: no confundir tableros por voz.** Alexander ('Magilus General') y Emanuel ('Desarrollo
  Emanuel') le hablan a Claude por voz. En la pantalla cada uno ve sus tableros, pero la clave del MCP es
  del negocio y ve TODOS: por el MCP nada impide escribir en el tablero del otro. Por eso las
  instrucciones del MCP y la descripción de cada herramienta que escribe (`REGLA_DEL_TABLERO` en
  `src/lib/mcp/tableros-inteligentes.ts`) le piden a Claude preguntar cuál tablero si hay más de uno y no
  se nombró, decir el nombre en voz alta antes de escribir y no adivinar por el último usado. Todas las
  respuestas del tablero traen `tablero` ({id, nombre, dueno}; las de tarjeta lo sacan de la tarjeta) y
  `listar_tableros` trae una `nota` con el dueño de cada uno cuando hay más de uno. Es una regla para
  Claude, no un permiso: el servidor no lo bloquea.
- **Reuniones: LiveKit necesita puertos y DNS a mano.** LiveKit (`livekit`, `livekit_egress` y
  `livekit_redis` en el compose) corre en el mismo VPS que el CRM. Traefik solo lleva la señalización
  (`video.magilus.com` → 7880) y el TURN por TLS (`turn.magilus.com` por el 443, router TCP HostSNI).
  El audio va DIRECTO al servidor: hay que abrir en el firewall del VPS 7881/TCP, 3478/UDP y
  50100-50200/UDP (en Swarm van con `mode: host`; hoy LiveKit manda todo el UDP por el 50100, `udp_port`
  en modo mux, y el resto del rango queda libre para crecer; el 50000 lo usa otro programa del VPS, `wacalls`) y crear los dos DNS. Sin eso la sala no conecta. Las
  variables `LIVEKIT_URL`, `LIVEKIT_API_KEY` y `LIVEKIT_API_SECRET` van en el CRM y en LiveKit; si el audio
  se corta (el VPS está en Francia, ~180 ms desde Colombia, y ya está cargado), LiveKit se pasa a otro VPS
  cambiando solo esas variables, con una condición: Egress escribe en el volumen que comparte con el CRM
  (los dos tienen que correr en el mismo nodo), así que se muda solo `livekit` o Egress pasa a guardar en
  S3/MinIO. Antes de usarlo en serio: prueba piloto de 3 personas (2 por 4G y 1 por
  PC) durante 15 minutos.
- **Reuniones: vigilar el disco.** Los audios quedan en el volumen privado `aizenbot_reuniones` (en el CRM
  `/app/reuniones`, en Egress `/out`), nunca en `/uploads`, y se escuchan solo con un link firmado de 1
  hora. Pesan poco (unos 30 MB por hora de reunión), pero no se borran solos. Egress corre como su usuario egress (uid 1001, grupo 0), no como root (con root pulseaudio no arranca); la carpeta del volumen debe ser escribible por el grupo (775 + ACL por defecto `g::rwx` en el VPS) y el CRM crea cada carpeta de sala con 775. Si una pista queda "No se grabó" o el CRM no puede leer un audio, revisar los permisos del volumen.
- **Reuniones: sin `OPENAI_API_KEY` no hay acta.** La reunión queda "En cola" con el aviso "Falta la clave
  de OpenAI" y arranca sola al poner la clave. Cuesta unos 0,36 USD por hora de audio por persona (con 3
  personas, unos 1,1 USD por hora de reunión); el acta cuesta centavos.
