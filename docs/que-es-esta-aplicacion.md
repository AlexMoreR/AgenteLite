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
- `tablero-ia` (**Tablero IA**, antes "Tableros inteligentes"; pantalla `/cliente/tablero-ia`. La ruta vieja `/cliente/tableros-inteligentes` redirige (307, `redirects()` de `next.config.ts`) conservando `?tablero=` y `?tarjeta=`, así que los links viejos del MCP siguen sirviendo. La clave del módulo sigue siendo `tableros_inteligentes` porque está guardada en `WorkspaceMember.moduleAccess`; la API, las carpetas de código, las tablas y las herramientas del MCP tampoco cambiaron de nombre): las ideas que arma Claude por el MCP hablando con el dueño, dibujadas como un mapa por niveles, como carpetas (tarjetas unidas por flechas rectas sin punta, color e ícono por tipo, borde por estado, filtros por estado y por tipo, vista Lista por área y "Te toca a ti"). **Página de inicio** (desde el 20-oct-2026): `/cliente/tablero-ia` sin `?tablero`, `?tarjeta` ni `?area` ya no abre el último tablero sino el listado de los tableros del negocio (`InicioDeTableros.tsx`), el que cambió último primero: una tarjeta por tablero con su nombre, cuántas tarjetas tiene, la última actividad (`TableroInteligente.actualizadoEn`) y los mismos contadores que los chips del diagrama en la raíz (te toca / en curso / sigue / hecho, de todo el tablero; `contadoresDelConteo` de `services/niveles.ts` sobre el conteo agrupado de `listarTableros`); tocarla abre el diagrama (`?tablero=<id>`). Desde el 20-oct-2026 los tableros son **por cuenta** (ver "Conceptos"): cada persona ve los suyos, con **+ Nuevo tablero** y el lápiz **Cambiar nombre** en los suyos; el dueño o el ADMIN de la plataforma ven todos (los ajenos con "de Emanuel Diaz"), el lápiz en todos con **De quién es** y, abajo, la sección **Trabajador** (clave, último uso y aprobadores; antes era el panel lateral del robot de la barra del diagrama, que ya no está). Una columna en el celular, grilla en pantallas anchas. Los links con `?tablero`, `?tarjeta` o `?area` siguen abriendo el diagrama directo; uno a un tablero o tarjeta que ya no existe vuelve al listado. En el diagrama, la fila de arriba tiene el enlace **Tablero IA** (ícono de grilla) que vuelve al listado, y el selector de la barra termina en "Todos los tableros". Cada tablero tiene **tipos de tarjeta** configurables (`TipoTarjeta`; nace con **Área**, **Idea** y **Tarea**): de qué tipos puede colgar cada uno (Área dentro de Área, Idea dentro de Área, Tarea dentro de Idea), si pide aprobación (solo Tarea) y si tiene estados (Área no: es una carpeta, sin estado, fuera de filtros, contadores y "Te toca a ti"). Una tarjeta puede colgar de otra (`padreId`, sin ciclos, solo si el tipo lo permite) y llevar un link http(s) que se ve como botón en su ficha y como ícono en el mapa. **Mapa por niveles** (`services/niveles.ts` y `services/disposicion.ts`): al abrir, cada tarjeta sin madre ("Magilus") en el centro y sus hijas directas alrededor (radial, con contador "Ventas · 5"); las nietas no se ven. Tocar una tarjeta con hijas entra a ella (queda al centro con sus hijas alrededor); sin hijas abre su ficha; el botón "i" abre la ficha sin entrar. Arriba "← Atrás" y la ruta ("Tablero › Magilus › Ventas"); el nivel va en la URL (`?tablero=<id>&area=<tarjetaId>`, con `history.pushState`, así que atrás del navegador vuelve al nivel anterior). Solo se ven las flechas entre tarjetas visibles; la unión con la madre es una línea del centro a cada hija. Las posiciones no se guardan en la base: se calculan siempre igual y, mientras se mira un nivel, las que ya estaban (o se arrastraron) no se mueven. **Te toca a ti** (`GET /api/cliente/tableros-inteligentes/pendientes`): lo que espera al dueño en todos los tableros que la persona ve (POR_APROBAR de tipos con aprobación y FALLIDO), de la más vieja a la más nueva, con Aprobar. Panel **Tipos**: el dueño (o el ADMIN) crea y edita tipos y borra los que nadie usa; los demás solo los ven. Un negocio puede tener varios tableros (uno por tema). El nombre del tablero abierto va en la barra superior y es el selector de tableros: al tocarlo lista los que la persona ve (los suyos; el dueño o el ADMIN, todos con su dueño) con cuántas tarjetas tiene cada uno (todas las vivas, también las Áreas) y un numerito de las que esperan aprobación, y la lista se vuelve a pedir al abrirlo (`GET /api/cliente/tableros-inteligentes`) para que aparezcan los que Claude acaba de crear. Cada persona tiene el lápiz **Cambiar nombre** en sus tableros (el dueño o el ADMIN, en todos) y abajo **+ Nuevo tablero**: los dos abren un diálogo (Enter guarda, Esc cancela; nombre no vacío, hasta 60 letras y distinto del de otro tablero del negocio sin mirar mayúsculas, regla `problemaDelNombreDeTablero` de `services/reglas.ts`, la misma que usa el servicio; el dueño o el ADMIN eligen además **De quién es** entre los miembros activos). Las server actions `crearTableroAction` y `renombrarTableroAction` pasan por el alcance de la sesión: un tablero ajeno "no existe" y elegir el dueño lo rechaza si no es el dueño o el ADMIN. La barra lo recibe por `<TituloDeLaBarra>` (`src/components/breadcrumb-label-context.tsx`); las demás pantallas siguen con su breadcrumb. Las flechas son rectas y salen por el lado que mira a la otra tarjeta, con puntos que viajan del origen al destino (quietos si el teléfono pide menos movimiento), y una tarjeta nueva nunca cae encima de otra (`services/disposicion.ts`). La ficha de una tarjeta muestra tipo, detalle, link, de quién cuelga, sus hijas, sus flechas, el historial y el botón **Aprobar** (solo lo ven el dueño y el ADMIN de la plataforma, y solo en tarjetas POR_APROBAR de un tipo con aprobación). Se actualiza sola cada 5 s con la pestaña a la vista (`/api/cliente/tableros-inteligentes/<id>?desde=` solo lee `TableroInteligente.actualizadoEn`; nada con la pestaña oculta; 30 s de espera si falla). `?tablero=<id>` abre un tablero, `&area=<id>` un nivel, y `?tarjeta=<id>` abre el nivel de la madre de esa tarjeta con su ficha a la vista (es el link que devuelve el MCP). En el MCP: `listar_tableros`, `crear_tablero`, `renombrar_tablero` (el nombre, con las mismas reglas que en la pantalla, y opcional `dueno`; `crear_tablero` también acepta `dueno`), `ver_tablero`, `listar_tipos`, `crear_tipo`, `editar_tipo`, `crear_tarjeta`, `editar_tarjeta` (ambas con `tipo`, `padre_id`, `link`, `link_texto`, `repo` y `zona_protegida`; sin tipo queda Idea), `conectar_tarjetas`, `cambiar_estado_tarjeta`, `borrar_tarjeta`, `ver_historial_tarjeta`, `deshacer_cambio_tarjeta`, `ver_plan_y_resultado`, `aprobar_tarjeta` (fase 2: el trabajador, ver "Conceptos") y `ver_coordinador` (solo lectura). **Coordinador en vivo** (24-oct-2026): en la página de inicio, el dueño y el ADMIN ven dos pestañas, "Tableros" y "Coordinador en vivo" (`?vista=coordinador`, `CoordinadorEnVivo.tsx`), que se actualiza sola cada 12 s (`GET /api/cliente/tableros-inteligentes/coordinador`) con: las tareas en marcha (etapa planeando/construyendo/probando/subiendo, dónde corre, modelo, hace cuánto empezó, intento o reparación), la carga de aizen1 con semáforo (verde bajo 70 %, amarillo hasta 85 %, rojo sobre 85 % o con poco disco), la fila con lo bloqueado y su motivo, lo de hoy (terminadas, falladas y reparadas con su duración) y el uso de Claude. El Coordinador manda un latido cada 15 s (`POST /api/trabajador/latido`, misma clave) que el CRM guarda como un ajuste (`AppSetting` `trabajador:latido:<negocio>:<clave>`, solo el último); con más de 2 minutos sin latido el panel dice "Coordinador apagado o sin conexión". Código en `services/coordinador-en-vivo.ts` y `services/reglas-coordinador-en-vivo.ts` (pruebas `npm run test:coordinador-en-vivo`). Código en `src/features/tableros-inteligentes` (reglas puras en `services/reglas.ts` y `services/niveles.ts`, pruebas `npm run test:tableros`; la migración de tipos se prueba con PGlite: `npm run test:tablero-tipos-migracion`, y la de tableros por cuenta con `npm run test:tableros-por-cuenta-migracion`) y `src/lib/mcp/tableros-inteligentes.ts`. Es distinto de `diagramas`: no comparten código ni tablas.
- `claude`: las claves para conectar Claude al CRM por el MCP.
- `onboarding`: el alta de un negocio nuevo.
- `reuniones`: **Reuniones** (desde el 23-oct-2026; módulo `reuniones` en la pantalla de permisos: lo ven el dueño, los administradores y quien lo tenga), reuniones solo de voz (sin cámara ni pantalla), propias en vez de Jitsi o Meet. "Nueva reunión" deja un link `/reunion/<título-en-minúsculas>` (el link sale del título: "Reunión de ventas" → `/reunion/reunion-de-ventas`, sin tildes ni ñ, máx. 60 caracteres; si ya existe se agrega `-2`, `-3`…; los links viejos con código al azar siguen funcionando y la sala de LiveKit es aparte, `reunion_<hex>`) con "Copiar" y "Enviar por WhatsApp" (wa.me: lo manda quien lo toca, no usa las líneas del CRM). La página pública `/reunion/<código>` se abre desde el celular o el PC sin instalar nada: el invitado escribe su nombre (quien tiene sesión entra con el suyo), adentro tiene audio, video en vivo (no se graba), compartir pantalla y chat (no se guarda). El pase de entrada lo firma el CRM (`/api/reuniones/pase`, 10 minutos) y no trae permiso de grabar ni de administrar; "Terminar reunión" lo ven quien la creó, el dueño y los administradores. Se graba SOLO EL AUDIO, una pista por persona (LiveKit Egress, sin Chrome); si alguien se cae y vuelve, su pista nueva se une por la hora. Siempre salen nombres, nunca identidades: se guarda el `name` del pase (el del usuario con sesión o el que escribió el invitado), los registros viejos con `u_<id>` toman el nombre del usuario, y los grabadores `EG_...` de Egress no se registran ni cuentan como personas (`servicios/nombres-de-participantes.ts`). El botón "Subir audio" se quitó de la pantalla el 24-oct-2026 (la ruta `/api/reuniones/subir` y su servicio siguen en el código, sin uso). Estados: Esperando, En vivo, En cola, Transcribiendo, Haciendo acta, Lista, Error (con "Reintentar"). El detalle tiene un reproductor por pista (link firmado de 1 hora), la transcripción con nombre y hora, y el acta (resumen, decisiones, tareas con responsable y fecha, mejoras en ventas y "qué puede mejorar Alexander como dueño"). Buscador por texto en títulos, transcripciones y actas. En el MCP: `listar_reuniones` y `ver_reunion` (solo lectura). La sala del navegador carga `livekit-client` 2.x del CDN jsDelivr (`cargar-livekit.ts`), no de npm. Código en `src/features/reuniones` y `src/lib/mcp/reuniones.ts`; pruebas (incluida la regla de borrar) `npm run test:reuniones-unir-pistas`, `test:reuniones-link-firmado` y `test:reuniones-migracion`.
- `pauta`: CRM → Pauta (solo dueño, administradores y supervisora). Por campaña y anuncio de Meta, en un rango de fechas: gasto (Meta Ads, solo lectura), chats, Calientes, ventas, monto vendido, tasa de cierre (ventas ÷ chats) y costo por venta (gasto ÷ ventas), con una fila aparte "Orgánico / Marketplace / Otro". También sale por el MCP con la herramienta de solo lectura `ventas_por_campana` (sin fechas usa el mes en curso).
- `comparar-embudos`: `/cliente/crm/comparar-embudos` (solo quien supervisa) compara dos versiones del libro del agente lado a lado para un producto: chats que entraron, % que respondió la bienvenida, % que dio su ciudad, % que llegó a Caliente, % que compró (tasa de cierre), el embudo dibujado y el paso donde se cae la mayoría, días promedio hasta la venta y plata vendida. La diferencia sale en verde (mejora) o rojo (empeora) y avisa "faltan datos" con menos de 100 chats por versión. Filtros: fechas, línea de WhatsApp y origen (anuncio / Marketplace / directo). Solo lee (`EmbudoLead`, `EmbudoEvento`, `Contact`), no cambia el bot ni manda mensajes. Desde el MCP, `comparar_embudos` devuelve lo mismo (mismo cálculo, `src/features/embudo/dominio/comparar.ts`) con un `resumen_para_decir` de qué versión vende más y dónde se cae la gente. Pruebas: `npm run test:comparar-embudos` y `npm run test:mcp-comparar-embudos`.
- `negocio/cerebro`: Mi empresa → Cerebro muestra "N documentos en el cerebro" (solo documentos, sin carpetas, sin ignorados ni ausentes). `cerebro_listar` del MCP devuelve lo mismo en `documentos_en_el_cerebro`. Muestra "Conectado con la cuenta de servicio <correo>", lista solo las carpetas compartidas con ella y preselecciona la que se llama "Magilus"; las notas nuevas pendientes salen como PENDIENTES.
- `embudo-por-paso`: `/cliente/direccion/embudo-por-paso` (solo quien supervisa): barras por producto y fechas de cuántos chats llegaron a cada paso del bot (Presentación, Producto, Objeciones, Cierre), cuántos se quedaron (más de 24 h sin escribir) y la tasa de paso a paso; los chats que tomó una asesora salen aparte.
- `direccion`: pantallas del dueño (Supervisor, agentes de área, embudos, pauta, recuperación, informe), separadas del CRM.
- `alertas`: todas las alertas internas en un solo lugar (dueño y administrador; menú Dirección → Alertas), ordenadas por prioridad (Urgente, Alta, Media, Baja) y, dentro de cada una, de la más nueva a la más vieja, con su fecha, el sistema que la generó (Supervisor, Agente de Ventas, Agente de Marketing, Agente de Sistemas, Coordinador, Línea de WhatsApp) y su estado (nueva, vista, resuelta). Filtra por estado y prioridad (por defecto oculta las resueltas) y tiene los botones "Marcar vista" y "Marcar resuelta". Por WhatsApp solo salen las urgentes, con 2 líneas y el link a esta pantalla. Además de las del negocio (dueño y administradores), cada persona del equipo ve en /cliente/alertas SOLO sus alertas personales; el link `?alerta=<id>` abre la lista en "Todas" y resalta esa alerta.
- `alertas_por_responsable`: cada alerta es de Sistemas o de Negocio (se calcula al leer con `responsableDeAlerta`, no se guarda). El responsable de Sistemas (Emanuel) se elige en /cliente/alertas (ajuste `alertas:responsable-sistemas:<workspaceId>` en AppSetting) y ve solo las de Sistemas más las personales suyas, aunque no sea jefe; Alexander ve por defecto las de Negocio y, con "Ver también las de Sistemas" (`?ver=todas`), todas. Sin el ajuste todo se ve como antes.
- `crm/supervisor`: las alertas de "Prioridades de Alexander" se ven como caja pequeña (insignia de gravedad, frase sencilla, leads afectados, responsable, desde cuándo y recordatorios); al tocarla, el detalle completo y el botón "Resuelto / atendido" se abren en una ventana a pantalla completa.

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
- `TarjetaTablero`: una tarjeta del tablero: título, detalle, área (texto libre, se mantiene), estado (`EstadoTarjeta`: IDEA, POR_APROBAR, APROBADO, EN_CURSO, HECHO, FALLIDO y, desde la fase 2 del trabajador, PLANEANDO, PLAN_LISTO, PLAN_APROBADO, POR_REVISAR, SUBIENDO y ERROR; las de un tipo sin estados guardan IDEA y no se muestra), orden, fecha, quién la creó, `tipoId` (obligatorio; un tipo en uso no se borra), `padreId` (su tarjeta madre; si la madre se borra de verdad queda en null), `link`/`linkTexto`, `borradoEn` (borrado suave: toda lectura la ignora; se deshace con su historial) y, para el trabajador (migración `20261020120000_tablero_trabajador`): `repo` (gestion | aizencrm; sin repo el trabajador no la toma), `plan`, `resultado` (JSON: resumen, pruebas, paso, rama, linkRama, commit, migracion, subida, error con motivo), `zonaProtegida` (META_ADS, BOT_VENTAS, LIBRO_V3: se aprueba solo en la pantalla), `intentos` y el candado `trabajoIniciadoEn`/`trabajoVenceEn`; y, desde la migración `20261022210000_tablero_riesgo` (solo aditiva, tres columnas de texto opcionales): `riesgo` (BAJO | ALTO; una tarjeta sin riesgo cuenta como ALTO), `riesgoMotivo` (una frase) y `riesgoPor` (CLAUDE | TRABAJADOR | DUENO); y, desde la migración `20261024120000_tablero_responsable` (solo aditiva): `responsableId` (opcional; el userId de una persona activa del negocio a quien se asignó la tarjeta; si se borra el usuario queda sin responsable; las tarjetas de antes quedan sin responsable).
- `ConexionTarjeta`: una flecha de una tarjeta a otra del mismo tablero (una sola por par y sentido; nunca de una tarjeta a sí misma). Con `esDependencia` la flecha dice "el destino depende del origen": el Coordinador no toma el destino hasta que el origen esté HECHO (no se permiten ciclos).
- `IntentoTarjeta`: el historial de intentos de una tarjeta del Coordinador: cada falla, espera, partida o escalada, con su etapa, la causa en una línea, el error exacto, qué hizo el Coordinador (reparar, partir, esperar o escalar) y si cuenta como intento (esperar por el límite de uso de Claude no cuenta). La ficha de la tarjeta lo muestra como "Intentos"; a los 3 intentos de reparación seguidos la tarjeta queda en ERROR con un resumen de 3 líneas (`TarjetaTablero.reparaciones` lleva la cuenta).
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
- `CerebroConexion`: la conexión del negocio con Google Drive para el Cerebro (Mi empresa → Cerebro): la cuenta de Google, el permiso de larga duración CIFRADO si se usa OAuth (nunca se muestra), la carpeta elegida, la última sincronización buena y el último error. Una por negocio.
- `CerebroDocumento`: la copia en la base de cada carpeta y documento de la carpeta del cerebro: id de Drive, ruta, tipo, fecha de modificación en Drive, versión de Drive, texto (Google Docs, .md y .txt; hasta 200.000 letras) y si `enDrive` (false = ya no está en el Drive). Se llena sola cada hora y con "Sincronizar ahora"; si hay diferencia, gana el Drive.
- `CerebroCambio`: el registro de todo lo que el CRM escribe en el Drive: quién, cuándo, desde dónde (MCP, pantalla, tablero o agente de área), qué documento, si creó, agregó o reemplazó, el texto antes y después, las palabras de confirmación del dueño y la tarjeta de origen.
- `CerebroNotaPorCrear`: pedido de una nota NUEVA del cerebro que crea aizen1 (ruta relativa a la carpeta del cerebro, contenido completo, estado PENDIENTE → CREADA | ERROR con motivo, quién y desde dónde). Nunca se borra: queda como registro.
- `OrigenDePauta`: de qué anuncio, conjunto y campaña de Meta llegó cada cliente (uno por cliente y negocio), con la red, el `ctwaClid`, la fecha de llegada y el chat. El anuncio sale de lo que los webhooks ya guardan en la ficha (`adSourceId`...); la campaña y el conjunto se le preguntan a Meta una vez por anuncio.
- `VentaDePauta`: una venta pagada (número en Gestión, cotización, teléfono, monto, fecha de pago) con el cliente y el origen de pauta que le tocó por teléfono (con y sin 57); categoría `PAUTA` u `ORGANICO_OTRO`.
- `UsoDelSistemaDia`: contador de uso del Agente de Sistemas. Una fila por negocio, día (hora de Colombia), tipo (pantalla o herramienta), clave (la ruta `/cliente/...` o el nombre de la herramienta del MCP) y persona, con el número de veces. Se suma en el latido de la app y en cada llamada al MCP, sin frenar ni romper nada si falla; las visitas y llamadas del propio Agente de Sistemas no se cuentan.
- `AgenteDeAreaDia`: resumen del día de un agente de área (`ventas`, `marketing` y `sistemas`): números de ayer, meta, lo que entregó cada subagente, clientes sugeridos (para medirlos al día siguiente), mensajes listos y si la corrida fue de prueba o salió tarde. Uno por negocio, área y día; si se guarda dos veces se reemplaza.
- `AgenteDeAreaEnvio`: un registro por cada WhatsApp interno que pidió un agente de área (a quién, texto, ENVIADO / BLOQUEADO / FALLIDO y el motivo). Un índice único parcial deja un solo envío vivo por número, área y día.
- `HistorialEtapa`: una fila por cada cambio de etapa del CRM (cliente, chat si se sabe, etapa anterior y nueva, fecha, origen ASESORA/BOT/AUTOMATICO/MCP/SISTEMA y quién). Empieza vacía el día que sube.
- `AlertaInterna`: una alerta interna (negocio, clave, prioridad URGENTE/ALTA/MEDIA/BAJA, título, detalle, sistema de origen, estado NUEVA/VISTA/RESUELTA, si salió por WhatsApp, cuántas veces se repitió y cuándo se vio o resolvió). La misma clave mientras sigue abierta no se duplica: se refresca y sube `veces`. Un solo punto de entrada: `registrarAlerta` (src/features/alertas). Columna `destinatarioId`: null = alerta del negocio; con valor = alerta personal de esa persona. Cada aviso de WhatsApp al equipo (tarea asignada, urgente, Coordinador necesita algo, recordatorio) queda también como alerta de quien lo recibe, y el WhatsApp trae el link a esa alerta.
- `AvisoTarjetaEquipo`: un aviso por WhatsApp al equipo por una tarjeta del Tablero IA (motivo, estado PENDIENTE/ENVIADO/FALLIDO/YA_VISTO, intentos); el índice único (tarjetaId, motivo) impide repetirlo.
- `EmbudoVersion`: foto completa del embudo de un producto (bienvenida, guiones, pasos quitados y seguimientos) cada vez que cambia, con número, fecha, quién, desde dónde y nota. La V1 es "embudo inicial".
- `EmbudoChatVersion`: con qué versión del embudo entró cada chat (una fila por chat, no cambia aunque el embudo cambie después).

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

- `cerebro_de_los_agentes`: los Agentes de Ventas, Marketing y Sistemas consultan el cerebro (Drive "Magilus") antes de recomendar, cada uno SOLO su parte: Ventas lee Ventas, Precios y Equipo; Marketing, Marketing y Precios; Sistemas, Tecnología; los tres leen "Decisiones de Magilus" y su propia carpeta "Aprendizajes de <área>". Lo hacen con tres herramientas del MCP (`cerebro_del_area`, `cerebro_anotar_aprendizaje`, `cerebro_marcar_dato_viejo`) y tienen prohibidas `cerebro_listar`, `cerebro_buscar`, `cerebro_leer` y `cerebro_escribir`. Citan el documento en cada recomendación. El bot que atiende clientes (V2/V3) no se toca. Cada agente anota lo que descubre (unas líneas, con fecha) AGREGANDO al final de `aprendizajes-AAAA-MM.md` en su carpeta "Aprendizajes de <área>"; queda en `CerebroCambio` con origen `AGENTE_VENTAS`, `AGENTE_MARKETING` o `AGENTE_SISTEMAS`. Nunca escriben en "Decisiones de Magilus" (solo el dueño y Claude).

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
  EN_CURSO solo sale de APROBADO, y HECHO o FALLIDO de APROBADO o EN_CURSO (en una tarjeta con repo el
  HECHO lo pone el trabajador al subir, o el dueño a mano desde ERROR, FALLIDO o POR_REVISAR: ver
  "Advertencias de operación"). Si Claude edita una tarjeta
  aprobada, vuelve a POR_APROBAR. Toda escritura deja una fila en `HistorialTarjeta`.
- **Tablero IA — el TRABAJADOR (fase 2, 20-oct-2026)**: una Tarea con `repo` (gestion o aizencrm) la
  ejecuta un PC aparte ("aizen1", carpeta `trabajador-tablero/` de este repo; NADA corre en el servidor de
  producción): pregunta cada minuto por HTTPS (`POST /api/trabajador/tablero/tomar`, con su clave) y la
  lleva por APROBADO → PLANEANDO (escribe un plan con `claude -p --permission-mode plan`) → PLAN_LISTO →
  (desde el 24-oct-2026 el plan pasa solo; espera el sí del dueño únicamente si toca dinero de Gestión o gasto en Meta Ads) PLAN_APROBADO → EN_CURSO (lo construye en la rama `tablero/<id>-<slug>`, corre
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
- **Tablero IA — responsable de la tarjeta (24-oct-2026)**: cada tarjeta puede asignarse a una persona activa
  del negocio (`responsableId`) sin crearla otra vez en otro tablero. Asigna quien puede editar ese tablero (su
  dueño, el dueño del negocio o un ADMIN) desde el selector "Responsable" de la ficha, o Claude con
  `responsable` en `crear_tarjeta` / `editar_tarjeta` (nombre o email; vacío lo quita; si el nombre coincide con
  dos personas da error y pide el email). La tarjeta muestra la inicial del responsable, el historial dice
  "Asignó a Emanuel" y `ver_tablero` devuelve el responsable y acepta el filtro `responsable`. Asignar NO
  reinicia la aprobación ni cambia el estado de la tarjeta. Arriba del tablero hay el filtro "Mis tarjetas"
  (las demás se ven apagadas) y la entrada del Tablero IA tiene la sección "Asignadas a mí". **Quién ve una
  tarjeta asignada**: la persona responsable ve la ficha completa y el historial de ESA tarjeta aunque esté en
  un tablero que no es suyo; no ve el resto de ese tablero, no la edita ni aprueba (aprobar sigue siendo del
  dueño y de los aprobadores). El link "ir al tablero" solo aparece si la persona alcanza ese tablero.
- **Tablero IA — el Coordinador se actualiza solo (25-oct-2026)**: cada 10 min (`autoactualizar` en `config.local.json`) el Coordinador hace `git fetch` en su copia y, si `origin/main` trae código que toca `trabajador-tablero/`, deja de tomar tarjetas, espera a que terminen las que corren, guarda `actualizacion.json` en su carpeta de trabajo (`anterior`, `nueva`, `estado`: probando, ok, revertida, no-actualizada), hace `git pull --ff-only`, prueba el código nuevo con `trabajador.mjs --probar-arranque` y sale con 0 para que se relance. Si no arranca vuelve a la versión anterior (`git reset --hard` solo en esa copia) y avisa por WhatsApp. `trabajador-tablero/lanzador.mjs` (lo que corre la tarea de Windows en lugar de `trabajador.mjs`) lo relanza al instante y deshace una versión que se cae en sus primeros 3 minutos. Ver el README de `trabajador-tablero`.
- **Tablero IA — cómo escoge, parte y sube el Coordinador (25-oct-2026)**: (1) los `.md` (como este archivo) y los globs de `repos.<x>.sinChoque` no hacen chocar a dos tarjetas, y al subir se juntan solos (`merge=union`, `rebaseSobre` en `lib/git.mjs`); (2) de las candidatas que no chocan toma primero subir, después construir, después planear; dentro de eso la que desbloquea a otras (`/candidatas` manda `desbloquea`: cuántas flechas `esDependencia` salen de ella) y la más chica (`lib/reparto.mjs`); (3) los pasos pesados (npm ci, lint, prisma generate, tsc, build, pruebas, ensayo de migración) de todas las sesiones pasan por UNA cola en aizen1 (`lib/cola.mjs`, `colaPesada.maximo`, 1 por defecto) y la CPU para abrir otra sesión es el promedio de 3 min (`limites.cpuPromedioMinutos`); (4) una tarea de aizen1 con más de 25 archivos de código en el plan (o migración y pantalla con más de 15) se parte ANTES de construir con `/partir`; las partes heredan la aprobación solo si no tocan módulos que el plan aprobado no nombra; (5) si main cambia mientras se verifica la subida, se hace rebase y se reintenta una vez sola; la corrida del CI se busca por sha y solo cuenta un número (un `null` ya no deshace una subida buena).
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
- **Tablero IA — riesgo BAJO / ALTO y aprobación automática (22-oct-2026)**: cada tarjeta con repo es de riesgo BAJO o ALTO; sin riesgo cuenta como ALTO y ante la duda es ALTO. Es ALTO si cumple CUALQUIERA: tiene zona protegida (CHATS, BOT_VENTAS, LIBRO_V3, META_ADS); habla de dinero (abonos, saldos, nómina, comisiones, facturación, pagos); de permisos, usuarios, contraseñas, claves o credenciales; envía mensajes a clientes; toca el propio trabajador o las reglas de aprobación; su migración borra o cambia algo que ya existe (DROP, ALTER destructivo, RENAME, DELETE, UPDATE, TRUNCATE); o sus archivos tocan una ruta de riesgo (lista fija en `reglas-riesgo.ts`: `trabajador-tablero/`, las reglas del tablero, abonos, nómina, comisiones, login, permisos y las rutas de las zonas protegidas). Solo es BAJO si no cumple ninguna. Se revisa tres veces y basta una para dejarla ALTO: (1) al crear o editar la tarjeta (título, detalle, repo y zonas), por el MCP (`crear_tarjeta` / `editar_tarjeta`, campos `riesgo` y `motivo_riesgo`: Claude propone, pero el servidor rechaza BAJO si algo calza con ALTO, y Claude no baja a BAJO una tarjeta que el trabajador o el dueño dejaron en ALTO) o por la pantalla (solo el dueño, con las mismas reglas); (2) cuando el trabajador entrega el plan: el plan trae al principio `RIESGO: BAJO|ALTO — motivo` y el CRM vuelve a revisar esa línea, si dice "TOCA ZONA PROTEGIDA", la parte de la migración y la lista de archivos (un plan sin la línea cuenta como ALTO); si resulta ALTO la tarjeta sube a ALTO y queda en PLAN_LISTO esperando al dueño; (3) cuando termina de construir: el trabajador manda los `archivos` que de verdad cambió y `migracionDestructiva`; si era BAJO y toca algo de riesgo alto pasa a ALTO y no sube sola (queda POR_REVISAR esperando el sí del dueño). Las tarjetas ALTO no cambian: el dueño aprueba la tarea, el plan y el sí final cuando aplique.
- **Tablero IA — interruptor de la aprobación automática**: "Aprobar solas las tareas de bajo riesgo", en la sección Trabajador del inicio de Tablero IA (solo el dueño lo mueve). Empieza prendido. Apagado, todo vuelve a pedir aprobación. Con el interruptor prendido o apagado, la subida a producción sigue como siempre (compila, pasan las pruebas y no toca zona protegida).
- `ventas_por_asesora`: la línea Admin nunca suma venta en `numeros_de_ventas`; la venta cuenta en la línea de ventas, a nombre de quien vendió, y un teléfono es una sola venta aunque quede GANADO en dos líneas.

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
- `reuniones_transcripcion`: la cola del módulo Reuniones. Toma UNA reunión a la vez (la que lleva más esperando "En cola"), pasa a texto cada pista con la API de OpenAI en español: primero ffmpeg `silencedetect` (silencios de más de 1 s bajo -40 dB) y solo los tramos con voz (con 0,3 s de colchón; se unen si están a menos de 2 s, máx. 90 s cada uno) se mandan como mp3 mono 16 kHz de 32 kbps, cada uno con su hora real de inicio en la pista, así la unión por hora no se corre. Modelo por defecto `gpt-4o-mini-transcribe` (no devuelve horas: cada tramo sale como una frase con la hora de inicio del tramo); con la variable `REUNIONES_MODELO_TRANSCRIPCION=whisper-1` se vuelve a whisper-1, que sí devuelve segmentos y cada uno se suma a la hora del tramo. Si ffmpeg falta o falla se manda el audio completo (en pedazos de 10 minutos si pasa de 25 MB). Una pista ya transcrita no se vuelve a pagar, une las pistas por hora con el nombre de quien habló y hace el acta con `gpt-4o-mini`. Si falla reintenta (a los 5 y 10 minutos) y al 3.er fallo queda en Error con el motivo. Sin `OPENAI_API_KEY` no gasta intentos: la reunión queda "En cola" con el aviso "Falta la clave de OpenAI". Cada minuto revisa también las reuniones con más de 30 minutos "En vivo" y le pregunta a LiveKit si la sala sigue abierta, por si se perdió el aviso del cierre. Corre en el servidor del CRM, no en aizen1 (sin GPU, 1 hora de audio tardaba 47 minutos con la CPU al 100 %). Cuesta unos 0,18 USD por hora de audio de pista con gpt-4o-mini-transcribe (0,36 con whisper-1) y solo se paga la voz: en una pista donde habla una de cada tres personas queda en ~0,06 USD por hora de pista. Código en `src/features/reuniones/servicios/cola-de-reuniones.ts`, `transcribir-pista.ts` y `tramos-de-voz.ts` (pruebas en `npm run test:reuniones-unir-pistas`).
- `aprobar_planes_solo_tablero`: (24-oct-2026, decisión del dueño por voz: "si ya construyó un plan, ¿por qué tiene que esperarme?") aprobada la TAREA, el Coordinador escribe el plan, lo guarda en la tarjeta y la tarjeta pasa sola de PLAN_LISTO a PLAN_APROBADO y a construir, con cualquier riesgo. En el historial quedan "plan listo" y "plan aprobado automáticamente (regla del dueño 24-oct)" (el resumen de las 9 p. m. la cuenta como las demás aprobaciones automáticas). ÚNICA excepción: el plan toca dinero de Gestión (abonos, saldos, nómina, comisiones, facturación, pagos) o puede subir presupuesto, activar campañas o crear gasto en Meta Ads: queda en PLAN_LISTO con el motivo en una línea. Lo detecta el Coordinador (línea `APROBAR PLAN: SOLO` o `APROBAR PLAN: ESPERA TU SÍ — motivo`) y el CRM lo revisa por su cuenta como respaldo (`porQueElPlanEsperaTuSi` en `reglas-riesgo.ts`: archivos de dinero, palabras de presupuesto, campañas o gasto en Meta Ads y, si el plan no trae la línea, palabras de dinero). Las tarjetas con zona protegida quedan fuera de la regla: su plan se aprueba en la pantalla (el trabajador solo toma esos planes si el dueño los aprobó ahí) y siguen pidiendo el sí final antes de subir. La vuelta del reloj (cada minuto) pasa a construir las PLAN_LISTO que esperaban y no caen en la excepción (las que están en ERROR no se tocan). Interruptor "Aprobar planes solo" (sección Coordinador del inicio de Tablero IA, solo el dueño, guardado en `AppSetting` como `tablero:planes-solos:<negocio>`; sin la fila está PRENDIDO). Apagado, todos los planes vuelven a pedir el sí del dueño.
- `aprobacion_automatica_tablero`: (22-oct-2026, decisión de Alexander: "las cosas básicas que ayudan al negocio y no tienen riesgo, hágalas sin pedirme permiso; lo súper importante sí me lo manda al tablero") una tarjeta del Tablero IA con repo y riesgo BAJO se aprueba SOLA: la tarea (POR_APROBAR → APROBADO) cuando se crea, se edita o en la vuelta del reloj (cada minuto), y el plan (PLAN_LISTO → PLAN_APROBADO) cuando el trabajador entrega un plan que sigue siendo BAJO. Cada aprobación queda en el historial como "aprobado automáticamente por regla de bajo riesgo", con el momento (tarea o plan) y el motivo. Sube sola a producción si compila y pasan las pruebas, como las demás. Solo corre con el interruptor "Aprobar solas las tareas de bajo riesgo" (sección Trabajador del inicio de Tablero IA, lo mueve solo el dueño, guardado en `AppSetting` como `tablero:aprobacion-automatica:<negocio>`; sin la fila está PRENDIDO). Apagado, todo vuelve a pedir la aprobación del dueño. Las reglas están en `src/features/tableros-inteligentes/services/reglas-riesgo.ts` (se prueban con `npm run test:tableros`).
- `resumen_diario_tablero`: el reloj del servidor arma una vez por día (el día del último envío queda en `AppSetting` `tablero:resumen-diario:<negocio>`) el resumen del Tablero IA. Desde el 26-oct-2026 es de 2 líneas fijas, sin commits, ramas ni ids: «Hoy: 4 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆» y «Ver: <link a `/cliente/tablero-ia?vista=hoy`>». La cifra en 0 no sale y, si las tres son 0, no se manda nada; "esperando tu sí" sale de la misma lista de "Te toca a ti". También se ve en la caja "Resumen de hoy" del inicio de Tablero IA y en la pestaña "Hoy" (el detalle queda ahí y dentro de cada tarjeta). Una nota dice que sale por WhatsApp entre las 8:55 y las 8:59 p. m. (antes del silencio) y otra del mismo día (`avisos_al_dueno_tablero`) dice que YA NO sale por WhatsApp: confirmar cuál quedó. Sale del historial de las tarjetas (`src/features/tableros-inteligentes/services/resumen-diario.ts`; pruebas en `npm run test:tablero-resumen-diario`).
- `tablero-ia`: pestaña nueva "Hoy" en el inicio (`?vista=hoy`, `VistaDeHoy.tsx`): listas hoy, con problema hoy y te toca a ti, una línea por tarjeta (título corto de `tituloCorto` y el resumen de una línea de la ficha). Solo el dueño o el ADMIN.
- `avisos_al_dueno_tablero`: (26-oct-2026, decisión del dueño: "WhatsApp solo cuando sea súper importante") el reloj del servidor (`api/cron/follows`, cada minuto) le manda al número personal del dueño, desde la línea Admin (id fijo `cmt06kiob00lw2hk2mgllstsb`; si no existe, la llamada "Admin"), un mensaje de máximo 3 líneas con link SOLO en estos casos: Coordinador sin señales hace más de 10 minutos, Sistemas sin trabajo (nada en curso ni en fila y tarjetas esperando al dueño), tarjeta trabada (más de 2 horas planeando, construyendo o subiendo sin cambiar de estado, o en ERROR tras las 3 reparaciones), tarjeta que necesita al dueño (Meta Ads, dinero o presupuesto, o un error que pide clave o permiso) y límite de Claude agotado con todo en pausa (lo manda el Coordinador con tipo "limite", o "necesita"). Un solo aviso por problema, se repite solo si sigue igual después de 3 horas; silencio de 9:00 p. m. a 7:00 a. m. (Bogotá) salvo Coordinador caído. El número, el interruptor (empieza prendido) y los últimos avisos están en la caja "Avisos de Sistemas por WhatsApp" de Mi empresa → Claude (solo dueño o administrador); el número se valida en el servidor (no puede ser de una asesora ni de una línea del negocio). Todo en `AppSetting` (`tablero:avisos-dueno:telefono|activo|estado:<negocio>`). Código: `src/features/tableros-inteligentes/services/avisos-al-dueno.ts`; pruebas en `npm run test:tablero-avisos-al-dueno`. El aviso "pasó el X % del plan" y el de "no pude leer el uso" se quitaron; el CRM descarta (200, `descartado`) los avisos del Coordinador que no traen tipo "limite" o "necesita".
- `aprobar_tareas_solas_tablero`: (25-oct-2026, decisión del dueño por voz) toda tarjeta Tarea con repo que entra en POR_APROBAR pasa sola a APROBADO, con cualquier riesgo, y queda "aprobada automáticamente (regla del dueño 25-oct)" en el historial. Se aplica al crear, editar y cambiar de estado la tarjeta, y en la vuelta del reloj (cada minuto, `aprobarSolasLasPendientes`). ÚNICA excepción, se queda POR_APROBAR con el motivo: su título o detalle hablan de dinero de Gestión (abonos, saldos, nómina, comisiones, facturación, pagos) o de subir presupuesto, activar campañas o crear gasto en Meta Ads, o tiene zona META_ADS o LIBRO_V3. CHATS y BOT_VENTAS arrancan solas (tarea y plan); su subida sigue igual (red de seguridad). Interruptor del dueño "Aprobar tareas solo" (`tablero:tareas-solas:<negocio>` en AppSetting; prendido sin fila); apagado, vale la regla de antes: solo se aprueban solas las de riesgo BAJO.
- `recoger_errores_tablero`: una vez al día (y la primera vez que arranca el Coordinador con este cambio) el Coordinador revisa todas las tarjetas del Tablero IA en ERROR, les aplica el diagnóstico de la autorreparación y las reintenta, las parte o deja una línea para el dueño; máximo 6 tarjetas por día y 2 recogidas por tarjeta (la fecha va en recoger-errores.json de la carpeta de trabajo del Coordinador).
- `ci_de_rama`: el Coordinador sube la rama `tablero/*` y espera el resultado de GitHub Actions en vez de compilar en aizen1 (interruptor `ciDeRama` en la configuración del repositorio del Coordinador); si Actions no responde en 20 minutos, compila en aizen1.
- `mejora_continua_tablero`: (26-oct-2026) cada agente del Coordinador (CRM, Gestión, Marketing) anota qué aprendió en `<carpetaTrabajo>/lecciones/<clave>.md`, solo en aizen1: una entrada corta (fecha, tarjeta, si falló o salió bien, causa, cómo se arregló y la regla para no repetirlo) cuando la tarjeta se repara, se parte o pasa a ERROR, y cuando sube después de haber fallado. No se anota si solo espera ni si se acabó el cupo de Claude. La misma falla no se repite (cuenta una vez más); con más de 40 entradas, las viejas pasan a "Lecciones viejas (resumidas)", una línea por lección. Las últimas 8 van en las instrucciones de planear y de construir ("Lecciones de este proyecto: no repitas estas fallas"). Al construir, el agente cierra con 3 líneas fijas (`Qué se hizo:`, `Qué se ve ahora:`, `Qué revisar juntos:`); el Coordinador las manda con la subida, el CRM las guarda dentro del resultado de la tarjeta (`resultado.subida.resumenTres`) y la pestaña "Hoy" las muestra debajo de cada tarea subida (no sale por WhatsApp). Si el agente escribe `NECESITO: <clave|acceso|decisión> …`, la tarjeta queda esperando al dueño (al construir en "Por revisar", al planear en "Plan listo"), sin reintentar, y sale UN solo aviso de tipo "necesita" por `/api/trabajador/aviso`. Nunca se le escribe a un cliente.
- `agente_de_ventas`: el Agente de Ventas corre en aizen1 (tarea de Windows a las 7:00 a. m., lunes a sábado) con Claude Code; reparte el trabajo a tres subagentes y el CRM solo da datos (MCP `numeros_de_ventas`), guarda el resumen (`guardar_resumen_del_dia`), entrega los WhatsApp internos (`mandar_whatsapp_al_equipo`) y se lee con `agente_de_ventas`. Pantalla `/cliente/crm/agente-de-ventas` (CRM → Agente de Ventas; dueño, administradores y supervisora): interruptor, resumen del día, un bloque por subagente, mensajes con su motivo e historial. Interruptor en AppSetting `agente-area:ventas:<negocio>`, apagado por defecto: apagado no sale ningún mensaje. Nunca le escribe a un cliente: el servidor solo deja mandar a números de Mi empresa → Equipo, por la línea Admin, una vez por persona y por día.
- `agente_de_marketing`: el Agente de Marketing (segunda área del molde de agentes de área) corre en aizen1 (tarea de Windows a las 6:45 a. m., lunes a sábado, antes del Agente de Ventas) con Claude Code y reparte el trabajo a tres subagentes: vigilante de pauta y calidad del lead (diarios) e ideas de anuncio (solo lunes, máximo 3). El CRM solo da datos (MCP `numeros_de_marketing`: conversaciones por anuncio de origen, Tibio/Caliente, ventas, sin respuesta y sin anuncio), guarda el resumen (`guardar_resumen_del_dia` con area marketing) y se lee con `agente_de_marketing`. Pantalla `/cliente/crm/agente-de-marketing` (CRM → Agente de Marketing; mismos permisos que Ventas): interruptor, línea para Alexander, una recomendación, tabla por campaña y anuncio, subagentes e historial. Interruptor en AppSetting `agente-area:marketing:<negocio>`, apagado por defecto: apagado genera y guarda el resumen pero su línea NO va en el mensaje de las 7:30; prendido, el lanzador de Ventas la agrega al MISMO mensaje a Alexander (Marketing nunca manda WhatsApp). Solo LEE Meta Ads: un candado de Claude Code (lista permitida de herramientas de lectura y lista prohibida de las que escriben) le impide pausar, prender, editar o crear nada.
- `agente_de_sistemas`: el Agente de Sistemas (tercera área del molde de agentes de área) corre en aizen1 (tarea de Windows a las 6:30 a. m., lunes a sábado) con Claude Code y reparte el trabajo a tres subagentes: revisor de producción (diario, abre en producción lo que quedó HECHO en las últimas 24 h y marca FUNCIONA / FALLA con el error exacto / NO SE PUEDE PROBAR), salud del sistema (diario: trabajador vivo, tarjetas atascadas más de 2 h o en ERROR, respaldos en Drive, disco/CPU/RAM de aizen1 y el VPS) y uso (solo lunes: qué de lo subido en 30 días nadie usa). El CRM solo da datos (MCP `revision_de_sistemas`), guarda el resumen (`guardar_resumen_del_dia` con area sistemas) y se lee con `agente_de_sistemas`. Pantalla `/cliente/crm/agente-de-sistemas` (CRM → Agente de Sistemas; mismos permisos que Ventas): interruptor, línea para Alexander, tabla de revisiones, tarjetas de arreglo, subagentes e historial. Interruptor en AppSetting `agente-area:sistemas:<negocio>`, apagado por defecto: apagado genera y guarda el resumen, su línea NO va en el mensaje de las 7:30 y las tarjetas de arreglo solo quedan escritas como "se crearía"; prendido, el lanzador de Ventas agrega su línea ("Sistemas: todo funciona" o lo roto) al MISMO mensaje a Alexander y se crean las tarjetas de arreglo POR_APROBAR en el tablero de Emanuel (marca `[sistemas:<commit>]` para no repetirlas). Solo LEE: un candado de Claude Code le impide modificar código, hacer deploy, aprobar o cambiar tarjetas, tocar datos de clientes o escribir a nadie.
- `cerebro_sincronizacion`: una vez por hora (minuto 41, en `/api/cron/follows`) y con el botón "Sincronizar ahora" trae de la carpeta de Google Drive lo que cambió a la copia `CerebroDocumento`. Gana siempre el Drive; lo que ya no está allá se marca "ya no está en Drive" y nunca se borra de la copia ni del Drive. La pestaña Cerebro (Mi empresa → Cerebro) la ve el dueño y quien él autorice (`AppSetting` `cerebro:autorizados:<negocio>`); permite leer, buscar y ver la fecha de modificación. Las herramientas del MCP `cerebro_listar`, `cerebro_leer`, `cerebro_buscar` y `cerebro_escribir` (esta última solo con la clave de la cuenta dueña; reemplazar un documento entero pide además la frase del dueño). "Pasar al cerebro" en una tarjeta HECHA (o de un tipo "Decisión") escribe solo la conclusión con la fecha y el link a la tarjeta. Lo leen el trabajador del Tablero IA (al tomar una tarjeta) y el coach de ventas (políticas y precios); el bot de ventas y el libro V3 NO lo leen. Apagada mientras no esté conectado Google y elegida la carpeta. El Cerebro ignora (no recorre, no indexa, no muestra) todo archivo o carpeta cuyo nombre empiece con punto (`.git`, `.obsidian`, `.claude`, `.gitignore`…) sin entrar en esas carpetas, las rutas de `RUTAS_IGNORADAS` en `src/features/cerebro/services/reglas.ts` (hoy `CRM-Gestion/export-dudas-2026-10-26` y todo lo de adentro) y las imágenes `.png`. Regla única: `seIgnora(ruta, nombre, tipo)`. Las filas que ya estaban en la copia y ahora se ignoran se marcan `enDrive = false` (igual que "ya no está en Drive"), aunque el recorrido venga truncado; no se borra ninguna fila ni nada del Drive. Además ignora las carpetas `node_modules` y `dist` en cualquier nivel (con todo lo de adentro, incluidos sus `src` y `test`), los archivos de código y datos (`.js`, `.mjs`, `.ts`, `.d.ts`, `.map`, `.json`, `.sql`, `.cmd`, `.csv`, `.html`), las imágenes (`.jpg`, `.jpeg`, `.png`, `.webp`) y los archivos `LICENSE` y `CODEOWNERS`. Quedan los `.md`, los `.txt` y los Google Docs (y los PDF solo por nombre). Las carpetas nunca se ignoran por extensión. Las filas viejas se marcan `enDrive = false` en la primera sincronización; no se borra nada del Drive.
- `cerebro_notas_en_aizen1`: la cuenta de servicio de Google no puede crear archivos en un Drive personal (403 storageQuotaExceeded). Cuando `cerebro_escribir` (modo crear) o "Pasar al cerebro" a un documento nuevo choca con eso, el CRM deja un `CerebroNotaPorCrear` PENDIENTE y responde "Se crea en aizen1 en ~1 minuto" (no es error). El Coordinador (`trabajador-tablero/lib/notas-boveda.mjs`), si tiene `boveda.ruta` en `config.local.json`, cada minuto pide las pendientes (`GET /api/trabajador/cerebro/notas-por-crear`), escribe `<boveda.ruta>/<ruta>` y la marca CREADA o ERROR (`POST`, misma clave `aizen_trab_...`). Drive para escritorio la sube a nombre del dueño y desde la siguiente sincronización el CRM la edita.
- `origen_de_pauta`: una vez al día (4 a. m. de Colombia, colgada del reloj de seguimientos) crea el origen de cada chat de anuncio (también de los que ya existían), resuelve su campaña con Meta Ads (solo lectura) y cruza las ventas pagadas de los últimos 60 días con esos clientes. Endpoint manual: `/api/cron/pauta`.
- `descarte_tras_seguimientos`: cada 10 minutos, si el seguimiento de 7 días (redes sociales) del paso Bienvenida salió hace 24 h o más y el cliente no escribió (ni una asesora le escribió a mano), pasa el lead a Descartado con motivo "Sin respuesta". Secuencia: 15 min → 1 h → 1 día → 3 días → 7 días → Descartado (24 h después del de 7 días). Si mostró ganas de comprar (precio, envío o ciudad, pago, cotización, anticipo; no cuenta lo de sus primeros 2 minutos) o está en Caliente, no lo descarta: le pone la etiqueta LLAMAR para una llamada. Si el cliente vuelve a escribir, lo reabre en su etapa anterior. Interruptor `crm:descarte-tras-seguimientos:<negocio>` (prendido salvo "off"); máximo 50 por vuelta.
- `avisos_al_equipo_tablero`: cada minuto (reloj de /api/cron/follows) manda un WhatsApp corto desde la línea Admin a personas activas del equipo con número en Mi empresa → Equipo: cuando les asignan una tarjeta, cuando es urgente (marca "urgente" o título que empieza por URGENTE; sale también de noche), cuando el Coordinador necesita algo de ellas (tarjeta en ERROR o esperando permiso, clave, VPS/Portainer o el sí del dueño; sin responsable le llega al dueño) y un recordatorio si pasan 24 horas sin movimiento. Un solo aviso por tarjeta y motivo, silencio de 9 p. m. a 7 a. m. salvo URGENTE. Interruptor general `tablero:avisos-equipo:<negocio>` = `{"activo": true}` (empieza apagado; al prenderlo lo que ya estaba asignado queda como "ya visto"). Cada persona lo apaga en /profile.
- `etapa_automatica`: saca solos a los leads de "---" (NUEVO). Al asignarse el chat a una asesora (reparto, "la que contesta se queda el chat", asignación a mano o regla por campaña) pasa a Frío; al crear la cotización en Gestión desde el chat, o al ENVIAR al cliente el panel de envío con el total, pasa a Caliente. Nunca pone Ganado ni Perdido, nunca baja a un lead y no toca cerrados, "fuera del CRM" ni la línea administrativa. Deja la nota "Etapa movida por el sistema: ..." en el chat y una fila en el historial de etapas (origen AUTOMATICO, nota "etapa automática"). Se apaga con el AppSetting `crm:etapa-automatica:<negocio>` = `off`.

## Qué no existe hoy

- **No hay fecha de pérdida**: PERDIDO se ubica en el tiempo por `updatedAt` (la última vez que se tocó la
  ficha), no por cuándo se perdió. Por eso "perdidos del mes" es aproximado: la corrida del descarte
  automático del 30-09-2026 marcó ~1.100 leads y todos parecen perdidos en septiembre.
- **No hay historial de etapas anterior a `HistorialEtapa`**: el contacto guarda la etapa en la que está hoy; por dónde pasó solo se sabe desde que existe `HistorialEtapa` (ver `historial_etapa_anterior_a_la_subida`).
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
  borrado de PLAN_LISTO o ERROR sin la marca no se deshace). Sus hijas se ven sueltas hasta que se deshaga. La pantalla casi no edita tarjetas: aprueba,
  asigna el responsable, administra los tipos y crea o renombra tableros. Un cambio de responsable hecho en la
  pantalla no se deshace por el MCP (como todo lo que se hace en la pantalla). Renombrar un tablero (o cambiarle el dueño) no queda en
  ningún historial (el historial es por tarjeta) y no hay forma de deshacerlo salvo volver a renombrarlo.
- **Tablero IA: no hay tableros compartidos, solo tarjetas sueltas compartidas.** Un tablero es de UNA persona (o de nadie): no se puede
  compartir con dos personas que no sean el dueño del negocio. Lo único que se comparte es una tarjeta,
  con su responsable (ve esa tarjeta, no el tablero). **No hay comentarios** en las tarjetas del Tablero IA:
  la persona asignada la ve y la trabaja, pero no escribe notas en ella (sería una tarea aparte). Un tablero sin dueño (su dueño se borró, o
  el negocio no tenía `ownerId` al migrar) lo ven solo el dueño del negocio y el ADMIN. El nombre de un
  tablero no se puede repetir en el negocio aunque el otro no se vea, y el aviso dice su nombre.
- **Tablero IA: del Coordinador solo se guarda el último latido.** No hay historial de la carga de aizen1 ni de
  lo que hizo minuto a minuto: el panel "Coordinador en vivo" muestra el último latido (`AppSetting`
  `trabajador:latido:<negocio>:<clave>`) y, con varias claves, el más reciente. Lo de "hoy" sale del historial de
  las tarjetas, no de los latidos. Hoy todo se construye en aizen1: "Nube de Claude" aparece en el panel solo
  cuando el Coordinador mande tareas a la nube, y GitHub Actions solo mientras espera las pruebas automáticas al
  subir. Si aizen1 corre un Coordinador viejo (sin `lib/latido.mjs`), el panel dice "apagado".
- `reuniones_pantalla`: Reuniones ya no es solo voz: adentro hay voz, compartir pantalla (solo Chrome y Edge de PC; en celular el botón no aparece) y chat, sin cámara. La pantalla compartida no se graba: el acta sale solo del audio de los micrófonos (una pista por persona). Esto reemplaza la línea "Reuniones: solo voz".
- **Reuniones: grabación.** Solo se graba el audio, una pista por persona; el video compuesto (mp4) no
  está en esta versión porque Egress con Chrome come de 2 a 6 núcleos. El chat de la sala no se guarda.
  En un audio subido no se separa quién habló (sale todo como "Audio"). Los audios no se borran desde la
  pantalla. Una reunión SIN grabación (Esperando o Error) sí: botón "Borrar" en la lista y el detalle, con
  confirmación; solo quien la creó, el dueño y los administradores; el servidor rechaza los demás estados; quita
  la fila con sus participantes y pistas y la carpeta de la sala si quedó vacía. No hay MinIO: los audios viven en el volumen `aizenbot_reuniones`.
- **Reuniones: la sala carga `livekit-client` del CDN.** No se usan los paquetes de npm de LiveKit
  (`livekit-server-sdk`, `@livekit/components-react`): el trabajador que construyó el módulo no podía
  instalar paquetes. El servidor habla con LiveKit con `node:crypto` y `fetch` (`servicios/livekit.ts`) y
  la sala carga `livekit-client` 2.x de jsDelivr (`components/cargar-livekit.ts`, se puede fijar otra
  dirección con `NEXT_PUBLIC_LIVEKIT_CLIENT_URL`). Si jsDelivr no responde, no se puede entrar a la sala.
- `reuniones_video_grabado`: solo se graba el audio (una pista por persona); el video no se graba. En audios subidos no se separa quién habló.
- `reuniones_sin_grabar`: la opción "Sin grabar" solo se elige al crear la reunión; no se puede cambiar con la reunión ya empezada, y una reunión sin grabar no deja audio, transcripción ni acta.
- `equipo`: el nombre visible de una persona del equipo ya se edita en Equipo > Editar (solo dueño o administrador); la firma de los chats (`chatSignature`) es un campo aparte y no cambia sola con el nombre.
- `pausa_acordada`: el detector es por palabras (sin IA): reconoce "espero que me organicen el lugar", "reuniendo la plata", "te aviso", "más adelante", "cuando tenga…", "el 15 te confirmo". Una frase de pausa con otras palabras no se reconoce y el chat se alerta como siempre. El recordatorio del día de retomar es una tarea para la asesora (motor del seguimiento inteligente en modo activo); con el motor en sombra solo se anota. El sistema nunca le escribe al cliente.
- `esperando_a_otra`: "Esperando a otra" no es un estado de la tarjeta; se calcula con las flechas de dependencia que ya existen (el panel "Coordinador en vivo" y ver_coordinador muestran "En error" y "Esperando a otra").
- `tasa_respuesta_bienvenida`: la tasa de respuesta a la bienvenida se calcula con los leads de EmbudoLead; una conversación nueva sin registro ahí no entra (la herramienta lo avisa en advertencias). No se guarda histórico: se recalcula en cada consulta.
- `historial_etapa_anterior_a_la_subida`: los cambios de etapa hechos antes de crear `HistorialEtapa` no tienen fecha real; `listar_conversaciones` los marca como "aproximada". Tampoco existe todavía una herramienta del MCP que mueva etapas (el origen `MCP` está listo para cuando exista).
- `cerebro_bot_de_ventas`: el bot de ventas y el libro V3 no leen el cerebro; solo lo leen el trabajador del Tablero IA, el coach de ventas y los Agentes de Ventas, Marketing y Sistemas (cada uno su parte).
- `cerebro_pdf_e_imagenes`: los PDF y las imágenes de la carpeta se ven solo por nombre, con link a Drive; no se leen por dentro ni se buscan por contenido.
- `cerebro_escribir_google_docs`: solo se escriben textos .md y .txt (crear uno nuevo, agregar al final o reemplazar). Un Google Doc no se modifica desde el CRM (perdería su formato): se crea un documento nuevo en su carpeta. El CRM nunca borra ni mueve archivos del Drive.
- `cerebro_original_en_obsidian`: hasta la fecha el cerebro de verdad es la carpeta `D:\Magilus` (Obsidian, respaldada en GitHub), no una carpeta de Drive. Antes de conectar hay que decidir si el original pasa a ser la carpeta "Empresa Magilus" de Drive.
- `cerebro_deshacer`: no hay botón para deshacer un cambio del cerebro; se hace con el historial de versiones de Drive y el "antes" guardado en CerebroCambio.
- `alertas_posible_dato_viejo`: cuando el cerebro choca con un dato del CRM o de Gestión, el agente crea una alerta "Posible dato viejo: …" en la página del Supervisor con familia CEREBRO y nivel Observación (el más bajo: sin push ni WhatsApp, solo en el resumen). Una sola abierta por documento y dato (si se vuelve a marcar suma "vista N veces"). El Supervisor NO las cierra solas y todavía no hay un botón para cerrarlas: las cierra el dueño (por ahora pidiéndoselo a Claude). La página de alertas con prioridades Alta/Media/Baja no está en main; cuando llegue, estas se leen como Media.
- `agentes_de_area_faltan`: el molde de agentes de área tiene hoy tres agentes (Ventas, Marketing y Sistemas); las demás áreas no tienen agente.
- `agente_de_ventas_sin_dinero`: los números que da el CRM al agente (`numeros_de_ventas`) no incluyen dinero; las ventas, abonos y saldos los lee el agente directo del MCP de Gestión, que es de solo lectura.
- `agente_de_marketing_sin_campana`: el CRM guarda el anuncio de origen de cada lead (id y título), no la campaña; el agente une anuncio con campaña leyendo Meta. Las conversaciones sin anuncio de origen no entran al costo por venta (el resumen dice el porcentaje). Falta la tarjeta "Guardar la campaña de origen de cada lead".
- `agente_de_marketing_sin_escritura_en_meta`: el Agente de Marketing no puede pausar, prender, editar presupuestos ni crear anuncios; las decisiones en Meta Ads las toma Alexander.
- `agente_de_sistemas_sin_uso_antes_de_subir`: el contador de uso empieza el día que se sube este cambio; de lo anterior no hay visitas ni llamadas medidas.
- `agente_de_sistemas_no_arregla`: el Agente de Sistemas no corrige, no hace deploy ni revierte commits: solo propone el arreglo en una tarjeta POR_APROBAR y espera al dueño.
- `meta_ads_gasto_sin_si`: el gasto en Meta Ads (subir presupuesto, prender campañas, conjuntos o anuncios, crear gasto nuevo) sigue esperando el sí del dueño. El Coordinador lo detecta por la línea «GASTO EN META ADS» del plan y por palabras en el código (`daily_budget`, `ACTIVE`...); las herramientas de Meta Ads que Claude usa fuera del repositorio no pasan por esa revisión.
- `monto_de_ventas_en_el_crm`: el CRM no guarda el monto de la venta. El monto del reporte de pauta solo existe si Gestión responde `GET /api/ventas/pagadas?desde&hasta` (ese endpoint hay que agregarlo en Gestión); si no, se cuentan los GANADO del CRM sin monto y el reporte lo avisa.
- `gasto_de_pauta`: sin META_ADS_ACCESS_TOKEN (permiso `ads_read`) y META_ADS_ACCOUNT_ID el gasto sale "no disponible" y las campañas no tienen nombre (se agrupa por anuncio).
- `origen_de_pauta_api_oficial`: los chats de la API oficial no llenan el anuncio en la ficha, así que no entran al reporte de pauta.
- `comparar_embudos_plata`: la plata vendida sale siempre "no disponible": el CRM no guarda el monto (vive en la cotización COT-xxxxx de Gestión) y no hay integración que lo lea.
- `comparar_embudos_ab`: no existe una prueba A/B real (Embudo 5); el botón "Prueba A/B activa" de la pantalla va apagado. La "versión" es `EmbudoLead.libroVersionEntrada`; los chats sin ese dato salen como "Sin versión".
- `comparar_embudos_origen`: no hay campo de campaña; el origen es anuncio (tiene `anuncioId`/título), Marketplace (línea Ventas 2) o directo.
- `embudo_por_paso_historial`: el historial de pasos guarda solo los últimos 10 cambios por chat, así que el tiempo en cada paso es aproximado en chats con muchas vueltas; los chats de antes del 27-oct-2026 solo tienen paso anterior y fecha de entrada si el relleno histórico los reconstruyó.

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
- **Una tarea con repo terminada por fuera se marca hecha a mano, no se borra**: el dueño toca "Marcar
  hecho a mano" en la ficha (ERROR, FALLIDO o POR_REVISAR), con una nota de qué se hizo y, si quiere, el
  commit; o Claude lo hace con `cambiar_estado_tarjeta` (HECHO) solo si el dueño dijo "sí, márcala hecha".
  Queda en el historial como "marcado hecho a mano por el dueño". No se hace mientras el trabajador la
  tiene (PLANEANDO, EN_CURSO, SUBIENDO). Desde ERROR o POR_REVISAR no se puede deshacer desde Claude.
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
- **Tablero IA: el plan ya no espera al dueño (24-oct-2026).** Con "Aprobar planes solo" prendido, el
  dueño aprueba la tarea una vez y el plan pasa solo a construir; el plan solo se queda esperando su sí si
  toca dinero de Gestión o gasto en Meta Ads. El Coordinador del PC aizen1 debe actualizarse para escribir
  la línea `APROBAR PLAN:`; mientras tanto el CRM aplica la revisión de respaldo, más estricta (un plan sin
  la línea que nombre abonos, saldos, nómina, comisiones, facturación o pagos espera). La revisión final de
  archivos (que sube a ALTO una tarjeta BAJO) solo cubre las tarjetas BAJO: una ALTO cuyo plan pasó solo
  se construye y, si compila y pasan las pruebas, sube sin que el dueño la vea (como antes pasaba tras su
  sí del plan). Las tarjetas con zona protegida no entran en esta regla: su plan se aprueba en la pantalla.
- **Tablero IA: hay que actualizar el trabajador del PC aizen1 para el riesgo.** La aprobación automática
  de la tarea ya funciona sin tocar aizen1, pero el trabajador viejo no manda la línea `RIESGO:` en el
  plan ni los `archivos` del resultado: el CRM cuenta esos planes como ALTO, así que siguen pidiendo la
  aprobación del dueño y no se ahorra trabajo hasta actualizarlo (copiar `trabajador-tablero/` y reiniciar
  la tarea programada). No se rompe nada.
- **Tablero IA: la aprobación automática no se "deshace".** Una aprobación (también la automática) no se
  deshace con `deshacer_cambio_tarjeta`. Para frenar una tarjeta aprobada sola hay que editarla (vuelve a
  POR_APROBAR) o apagar el interruptor antes de que el trabajador la tome. La revisión por palabras marca
  ALTO de más a propósito (por ejemplo, cualquier tarjeta que nombre "usuarios", "pagos", "chats" o "WhatsApp").
- **Tablero IA: el resumen de las 9 p. m. sale una vez.** Si la línea Admin está desconectada o no hay
  número de avisos configurado, el WhatsApp no sale y NO se reintenta ese día; el resumen queda igual en la
  caja "Resumen de hoy" con el motivo.
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
- **Tablero IA: las tareas grandes se construyen en la nube (25-oct-2026, decisión del dueño).** aizen1
  corre como máximo 2 tareas a la vez. Al CONSTRUIR, una tarea GRANDE (el plan nombra más de 8 archivos,
  trae migración, crea un agente nuevo, o ya falló por tamaño o recursos) va SIEMPRE a la nube con
  `claude --cloud`; una chica va a aizen1 si tiene puesto y, si aizen1 ya tiene sus 2, la siguiente
  aprobada también va a la nube (desborde). Planear y subir siguen en aizen1. La sesión de la nube trabaja
  en la rama `tablero/<id>-<slug>` de GitHub (sin `--force`), deja un commit vacío `resultado: build=OK|FALLO
  tests=OK|FALLO segundos=N` y el Coordinador (que mira la rama cada minuto, nunca con `claude --teleport`)
  trae la rama a aizen1 y repite la verificación, las zonas protegidas y el ensayo de la migración contra
  producción. Las claves de producción, los `.env` y los tokens de WhatsApp NUNCA van a la nube. La tarjeta
  dice dónde se construyó y trae el link de la sesión (solo `claude.ai/code/session_…`). Construir en la
  nube tiene tope de 180 minutos (en aizen1, 90) y el CRM acepta hasta 12 tarjetas a la vez entre las dos.
  Si el Coordinador se reinicia con tareas en la nube, pierde la pista de esas sesiones: las tarjetas
  vuelven a la fila (la rama queda en GitHub). La nube gasta del mismo plan de Claude del dueño.
- `chats_pegar_imagen`: en la caja de mensaje de Chats se puede pegar una imagen (Ctrl+V o «Pegar» en el celular); abre la vista previa y no se envía sola. La imagen puede llegar en `clipboardData.files` o en `items`. Si ya se está enviando otra imagen, un audio o grabando, el pegado avisa y no hace nada. Probada solo con eventos simulados: falta revisarla en Android Chrome e iPhone Safari reales.
- `silencio_de_avisos_del_tablero`: los WhatsApp del Coordinador (`POST /api/trabajador/aviso`) no salen de 9:00 p. m. a 7:00 a. m. (Bogotá): el CRM contesta 200 con `silenciado: true`, el Coordinador no anota el aviso como enviado y lo reintenta en la próxima mirada del uso de Claude, así que sale a las 7 a. m. si sigue siendo cierto. Todo aviso se recorta a 3 líneas. No aplica a los avisos graves del Supervisor (líneas caídas, incidentes).
- `avisos_al_dueno_412`: el 412 del aviso del Coordinador (26-oct-2026) no venía de WhatsApp: el CRM no encontraba a qué número mandar porque ninguna pantalla guardaba la AppSetting `trabajador:aviso-telefono:<negocio>`. Ahora el número se guarda en Mi empresa → Claude (el ajuste viejo sirve de respaldo). Sin número, el aviso queda anotado como "falta su número en Mi empresa → Claude" y no sale nada. El cambio de `trabajador-tablero/` corre en aizen1: hay que actualizarlo allá (`git pull` y reiniciar la tarea).
- `reuniones_sin_grabar`: las reuniones sin grabar pasan directo a "Lista" al cerrarse la sala, sin pasar por la cola de transcripción (no gastan tokens de OpenAI ni disco).
- `reuniones_disco_y_puertos`: los audios pesan unos 30 MB por hora de reunión en el volumen `aizenbot_reuniones`; hay que vigilar el disco. LiveKit necesita abiertos 7881/TCP, 3478/UDP y 50000-50200/UDP en el firewall del VPS, y los DNS `video.aizenbot.com` y `turn.aizenbot.com`.
- `agente_de_marketing_aizen1`: el Agente de Marketing corre en aizen1 y solo lee Meta Ads; si aizen1 está apagado, no hay resumen (al prender corre solo y queda "salió tarde"). El conector de Meta tiene que estar autorizado en la cuenta de Claude del dueño; si no responde, el resumen dice "no se pudo leer Meta" y no recomienda nada. Comparte el límite del plan de Claude con el Agente de Ventas y el trabajador del tablero.
- `agente_de_marketing_cruce_incompleto`: si falta el anuncio de origen en muchos chats, el costo por venta sale incompleto; con un cierre de ~0,5 % un anuncio puede tener 0 ventas en un día por azar, por eso el costo por venta se mira en 7 días.
- `agente_de_sistemas_aizen1`: el Agente de Sistemas corre en aizen1 y solo lee; si aizen1 está apagado, no hay resumen (al prender corre solo y queda "salió tarde"). Comparte el límite del plan de Claude con Ventas, Marketing y el trabajador del tablero.
- `agente_de_sistemas_contador`: el contador de uso empieza a contar el día que se sube; lo de antes no tiene uso medido, y un "nadie lo usa" de una subida reciente puede ser solo que aún no hubo tiempo.
- `agente_de_ventas_aizen1`: el Agente de Ventas corre en aizen1; si aizen1 está apagado, no hay resumen (al prender corre solo y avisa "Salió tarde"). Comparte el límite del plan de Claude con el trabajador del tablero.
- `agente_de_ventas_sin_numero`: una asesora sin número de avisos en Mi empresa → Equipo no recibe su mensaje; la pantalla lo marca como "sin número de avisos".
- `ci_de_rama`: con `ciDeRama` prendido la rama se sube antes de probarla (es una rama de trabajo, no `main`); el ensayo de migraciones contra producción sigue en aizen1 porque las claves no van a GitHub, y la tarjeta guarda `linkWorkflow` y `verificadoEn`.
- `pausa_acordada`: el interruptor es `pausaAcordada.activo` (y `pausaAcordada.dias`, 3 por defecto) dentro de la configuración JSON `seguimiento-inteligente:config:<workspaceId>`; viene apagado. Apagado, el Supervisor y el motor se comportan exactamente como antes. Prendido, el Supervisor deja de alertar (y cierra las alertas abiertas y las acciones del Supervisor accionable) de los chats donde el cliente dejó la compra en pausa y una persona ya respondió; un "ya pagué", una pregunta o una señal de compra nueva sacan al chat de la pausa.
- `medir_antes_de_planear`: antes de planear, el Coordinador mide el tamaño de la tarjeta; si es grande la parte en 2 a 4 hijas "aprobadas, por planear" (sin plan copiado) y pone solo la flecha de dependencia cuando el texto nombra otra tarjeta como molde o requisito. Una flecha equivocada se quita con un clic en el tablero.
- `build_un_solo_candado`: nunca dos builds a la vez en la misma carpeta; si aparece el aviso de candado de Next, espera, limpia el candado viejo y reintenta sin contar intento.
- `tablero_vencida_error`: una tarjeta que vence por falta de latido vuelve a la fila (no cuenta intento) hasta 5 veces seguidas; solo la que se pasa del tope de su etapa o ya hizo 5 esperas pasa a ERROR.
- `cerebro_sincronizacion`: para ignorar otra carpeta se agrega su ruta (relativa a la carpeta del cerebro, sin importar mayúsculas) a `RUTAS_IGNORADAS`. Documentos del cerebro en SQL: `SELECT count(*) FROM "CerebroDocumento" WHERE "workspaceId" = '<ws>' AND "enDrive" AND NOT "esCarpeta"` (tras la primera sincronización con este cambio). La lista de lo que se ignora está en `CARPETAS_IGNORADAS`, `EXTENSIONES_IGNORADAS` y `NOMBRES_IGNORADOS` de `src/features/cerebro/services/reglas.ts`. Si hace falta volver a ver los `.json`, `.csv` o `.html` del Drive, se quita la extensión de esa lista. Tras la primera sincronización, `cerebro_listar` debe mostrar menos de 300 documentos y ninguno dentro de `node_modules`.
- `cerebro_notas_en_aizen1`: aizen1 NUNCA sobrescribe: si el archivo ya existe agrega el contenido al final tras una línea `---`. Rechaza (ERROR con motivo) rutas con `..`, absolutas o de unidad, que salen por un enlace, o que no son .md/.txt. Si aizen1 está apagado o la carpeta no existe, las notas quedan PENDIENTES (se ven así en Mi empresa → Cerebro y en `cerebro_listar` → `notas_nuevas`). Mientras la nota no se sincroniza al CRM, una segunda decisión con modo crear y el mismo nombre se agrega al final del mismo archivo.
- `cerebro_variables_del_servidor`: el cerebro entra al Drive con la CUENTA DE SERVICIO del servidor (`GOOGLE_SERVICE_ACCOUNT_EMAIL` y `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, las mismas de Google Sheets) con el permiso `drive` (lee y escribe textos .md/.txt; nunca borra). Ya NO hacen falta `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` ni `CEREBRO_CLAVE_CIFRADO`, ni "Conectar Google" (el OAuth en modo prueba vencía cada 7 días); ese camino queda solo como alternativa si no hay cuenta de servicio. El dueño comparte la carpeta del cerebro ("Magilus", también si está en Ordenadores) con el correo de la cuenta de servicio como Editor.
- `cerebro_cuenta_de_servicio_crear`: Google puede negar que una cuenta de servicio cree archivos NUEVOS en un Drive personal (no tiene espacio propio: error `storageQuotaExceeded`); en ese caso el CRM lo dice claro. Agregar o reemplazar en un .md que ya existe sí funciona (el archivo sigue siendo del dueño). Lo que se escribe aparece en la carpeta sincronizada del PC del dueño.
- `cerebro_gana_el_drive`: la copia del CRM es solo para buscar rápido. Si alguien edita un documento en el Drive, la próxima sincronización (máximo una hora) reemplaza la copia. No editar el mismo contenido a la vez en Obsidian y en Drive: quedarían dos versiones.
- `cerebro_permiso_perdido`: si Google revoca el permiso o el Drive deja de compartirse con la cuenta de servicio, la pestaña lo muestra con la última sincronización buena; el MCP responde "el cerebro no está conectado" y no inventa nada. Solo en la alternativa OAuth aparece "Reconectar Google" (la dirección de regreso a registrar en Google Cloud es `https://app.aizenbot.com/api/cerebro/google/volver`).
- `cerebro_escribir_candado`: `cerebro_escribir` solo escribe con la clave de la cuenta dueña y la versión del documento sin cambios en el Drive; crear y agregar ya no piden la frase del dueño, reemplazar todo un documento sí (`texto_confirmacion`). Claude anota cada decisión en el documento único "Decisiones de Magilus", y el servidor le pone la fecha (### AAAA-MM-DD) si falta. Nunca borra; todo queda en `CerebroCambio` (el antes y el después) y el Drive guarda además su historial de versiones.
- `cerebro_desconectado`: si la última sincronización del cerebro falla o lleva más de 3 horas sin hacerse, se abre una sola alerta IMPORTANTE `CEREBRO:desconectado` en /cliente/crm/supervisor (no se manda WhatsApp ni push). Se cierra sola al sincronizar bien.
- `aprendizajes_de_area`: las carpetas "Aprendizajes de Ventas", "Aprendizajes de Marketing" y "Aprendizajes de Sistemas" tienen que existir en el Drive, dentro de la carpeta del cerebro (en el primer nivel). Los agentes NO las crean: sin la carpeta, `cerebro_anotar_aprendizaje` devuelve un aviso y no escribe. Hay que esperar la sincronización (cada hora o con el botón) para que el CRM las vea. El archivo del mes tiene un tope de 60.000 letras.
- `cerebro_de_los_agentes`: si el cerebro no está conectado, las tres herramientas lo dicen y el agente sigue como antes (lo anota en su resumen). El CRM no sabe qué agente llama (los tres usan la misma clave): el área la dice el agente y las listas de herramientas y sus instrucciones lo frenan; un error quedaría en el registro de cambios del cerebro.
- `lecciones_del_coordinador`: las lecciones de cada agente viven solo en aizen1 (`<carpetaTrabajo>/lecciones/<clave>.md`): no van al repositorio ni a main, y el CRM no las puede leer. Las tarjetas que se construyen en la nube también las reciben, porque el Coordinador las pone en las instrucciones antes de lanzar la sesión. Si se borra la carpeta de trabajo se pierden. Un agente que abuse de `NECESITO:` deja tareas paradas: la tarjeta queda visible con el motivo y el aviso no se repite.
- `agentes_por_proyecto`: el Coordinador de Sistemas reparte cada tarjeta al agente de su proyecto (Agente CRM, Agente Gestión, Agente Marketplace (NETMAGI) y, cuando arranque, Agente Marketing). Cada agente tiene su cola: el tope de tarjetas a la vez de un proyecto está en `repos.<clave>.agente.maxEnParalelo` de `config.local.json` del trabajador (1 a 5; si falta, no tiene tope propio y vale el general: `maxParalelo` más la nube). Un proyecto con `activo: false` se ignora y sus tarjetas esperan con el aviso "no está configurado en este PC". El panel "Coordinador en vivo" y `ver_coordinador` muestran qué agente trabaja cada tarjeta.
- `aprobar_tareas_solas_trampa`: una tarea de dinero escrita sin las palabras clave (abonos, saldos, nómina, comisiones, facturación, pagos, presupuesto, campañas, gasto en Meta) pasa sola; quedan dos frenos más, la revisión del plan y la de los archivos que de verdad cambiaron. El freno de mano es apagar "Aprobar tareas solo".
- `chats_suben_solos`: desde el 26-oct-2026 la zona CHATS sube sola a producción (como el bot de ventas, Meta Ads y el libro V3): el que construye escribe «✔ chats: sin mensajes nuevos a clientes» y, si el cambio agrega cualquier envío de mensaje en las rutas de chats, la tarjeta espera el sí del dueño aunque el plan lo mencione. La configuración real del Coordinador (fuera del repositorio) necesita `"CHATS"` en `repos.aizencrm.zonasQueSubenSolas`; sin eso CHATS sigue esperando el sí. Las tarjetas de chats ahora también se aprueban por voz.
- `zonas_que_suben_solas`: desde el 24-oct-2026 las zonas protegidas `BOT_VENTAS`, `META_ADS` y `LIBRO_V3` no piden el sí final del dueño: si compilan y pasan las pruebas suben solas (`ZONAS_QUE_SUBEN_SOLAS` en `reglas-trabajador.ts`; `CHATS` sigue pidiéndolo hasta el 26-oct, ver `chats_suben_solos`). Antes de subir el Coordinador exige pruebas extra por zona y después vigila los logs 30 minutos; si algo se rompe, revierte con un commit nuevo. La tarjeta dice «Subió sola (zona X) — vigilancia 30 min OK» o «Revertida: motivo».
- `config_zonas_que_suben_solas`: el `config.json` real del Coordinador (fuera del repositorio) necesita `repos.aizencrm.zonasQueSubenSolas`, `repos.aizencrm.vigilancia` y `ssh.logs` / `ssh.estado`. Sin la lista todo sigue pidiendo el sí (error seguro); con la lista y sin `ssh.logs` el Coordinador no arranca. Mientras vigila una tarjeta (30 min) no sube otra, y el candado de «subir» en el CRM pasó de 45 a 80 minutos.
- `pausa_uso_claude`: el Coordinador entra en "Pausado por uso de Claude" cuando la sesión o la semana del plan de Claude llegan al umbral (80 % por defecto; interruptor y umbral de 50 a 95 % en Coordinador en vivo → Uso de Claude, AppSetting `tablero:pausa-uso-claude:<negocio>`). En pausa no toma tarjetas, detiene planear y construir (vuelven a la fila sin ERROR ni intento; lo escrito en aizen1 queda en `intentos/<id>/trabajo.patch`) y manda UN WhatsApp tipo "limite"; al bajar el uso retoma solo y avisa en una línea. Pueden ser horas (la sesión) o días (la semana) sin que avance ninguna tarjeta. Subir no se corta, Codex también para, y los Agentes de Ventas y Marketing de aizen1 no se pausan. Si no se puede leer el porcentaje no se pausa: el panel lo dice y avisa una sola vez. Estado en `estado-uso.json` del PC del Coordinador.
- `ventas_solo_en_admin`: un cliente que quede GANADO solo por la línea Admin (sin chat de ventas) no cuenta como venta en los números por asesora; el recibo de caja deja Cliente/GANADO en Admin y eso ya no suma a nadie.
- `ventas_en_organico_sin_serlo`: un cliente que llegó por anuncio antes de que el CRM guardara el dato, o que compró desde otro número, queda en "Orgánico / Marketplace / Otro"; por eso la tasa de cierre de la pauta puede salir más baja que la real. Un cliente que vio dos anuncios cuenta con el primero.
- `supervisor_cierre_corto`: un "ok", "listo", "gracias", 👍, sticker o reacción del cliente justo después de la asesora ya no cuenta como "esperando respuesta" si ella no preguntó ni dejó una promesa sin cumplir y el cliente no mostró señal de compra; la alerta abierta se cierra sola y el chat queda para el seguimiento programado.
- `si_final_del_dueno`: desde el 27-oct-2026 Sistemas solo le pide el "sí final" al dueño por dinero (pagos, nómina, comisiones, abonos, facturación), gasto en Meta Ads, claves o accesos, y envíos nuevos a clientes en chats o en el bot. La prueba extra de chats y del bot ("sin mensajes nuevos a clientes") la comprueba el Coordinador con el diff real de la rama; el sí que el dueño ya dio vale aunque la tarea se reconstruya (el historial de la tarjeta lo dice). El libro V3 sigue pidiendo su simulación.
- `rescate_por_revisar`: cada 3 minutos el Coordinador revisa de nuevo las tarjetas POR_REVISAR que pasaron build y pruebas y solo esperaban esa prueba o ya traían el sí del dueño (POST /api/trabajador/tablero/por-revisar y /:id/rescatar); si no hay envío nuevo, pasan a SUBIENDO con la vigilancia de 30 minutos.
- `revision_previa_coordinador`: antes de planear y de construir, el Coordinador revisa si la tarea se puede hacer. La sesión puede contestar `DEPENDE_DE: <id o «título»>` (la tarjeta queda "Esperando a otra", vuelve a Aprobado o Plan aprobado y no gasta intento ni reparación; arranca sola cuando la otra queda HECHO) o `YA_ESTA_HECHO: <commit> — <motivo>` (el Coordinador comprueba con git que el commit está en main; si lo está, la tarjeta pasa a HECHO con la nota "ya estaba hecho (commit X)" y en el resumen de Hoy sale aparte, en "Ya estaban hechas"; si no está, se sigue como antes). La búsqueda de "depende de / requiere…" mira también el título y el plan aprobado.
- `limpieza_main_errores_viejos`: si main ya trae errores de lint, tipos o pruebas, no se le cobran a la tarea que no los empeora (se comparan por archivo, regla y mensaje, o por nombre de la prueba; main se mide una vez por versión y comando). El Coordinador crea UNA tarjeta por repo, "Limpieza: main trae errores viejos (<repo>)", en Aprobado, y le agrega los errores nuevos si ya hay una abierta. En la nube (GitHub Actions) el paso Lint de `ci-tablero.yml` también falla solo con errores nuevos: hay que volver a copiar la plantilla a cada repo.
- `esperas_por_choque_se_sueltan`: la espera de una tarjeta que choca con otra guarda con cuál choca y se borra en el siguiente ciclo cuando esa otra ya no corre (HECHO, FALLIDO o ERROR), aunque el Coordinador siga lleno.
- `avisos_al_equipo_tablero`: si una persona no tiene número en Mi empresa → Equipo, no recibe nada y el aviso queda FALLIDO con ese motivo (no se reenvía al agregar el número después). La línea Admin caída se reintenta hasta 3 veces. Una tarjeta en ERROR sin responsable le llega al dueño una sola vez, salvo que el aviso de siempre al dueño ya la haya mandado.
- `descarte_tras_seguimientos`: no descarta a nadie hasta crear el seguimiento de 7 días en el paso Bienvenida (dato del embudo, con los links reales de Instagram, Facebook y TikTok; sin links se crea inactivo). Solo cubre a quienes recibieron ese mensaje: los chats viejos que no lo recibieron no se tocan, y los leads que solo recibieron el de 3 días ya no se descartan por esta regla. Si se prende el tope anti-bloqueo de 3 automáticos sin respuesta por contacto, frena el 4.º y 5.º seguimiento: habría que subirlo a 5. Para apagarlo, poner `crm:descarte-tras-seguimientos:<negocio>` en "off".
- `embudo_por_paso_se_quedo`: «se quedó aquí» no se guarda, se calcula al mirar (paso actual + más de 24 h sin que el cliente escriba); por eso nunca queda desactualizado y no hay reloj.
- `embudo_versiones`: los chats de antes de la subida de Embudo 3 quedan sin versión. Al subir hay que correr `node scripts/crear-versiones-iniciales.mjs --escribir` para crear la V1 de todos los productos; si no, la V1 se crea al primer uso y guarda lo que haya en ese momento.
- `direccion`: solo dueño y administradores; las supervisoras y las asesoras ya no entran a Supervisor, Recuperación, Embudo ni Informe.
- `permisos_del_crm`: desde el 26-10-2026 solo el dueño y los administradores (cuenta Magilus) ven y abren Tablero, Embudo, Comparar embudos, Pauta, Recuperación, Supervisor, los agentes de área, Informe, Guiones, Automatizaciones y Agente V3. Ingrid, María, Yair y las demás cuentas (aunque tengan rol de supervisora) ven solo Chats, Mi día y Kanban de lo suyo; las direcciones de los apartados de jefe las mandan a /cliente/crm/mi-dia. Registro queda para jefes y monitoras de canal. La regla vive en src/lib/permisos-del-crm.ts; `puedeSupervisar` no cambió (llamadas, asignar chats siguen igual).
- `menu_crm_asesoras`: el menú CRM de una asesora muestra solo Mi día y Kanban; Informe y Guiones son solo para quien supervisa (dueño, administrador, supervisoras) y Registro ya no está en el menú de nadie. Es ocultar, no bloquear: las direcciones `/cliente/crm/registro` e `/informe` siguen abriendo. Lo que dice `docs/crm-contexto.md` (el informe "no es solo-dueño") quedó desactualizado.
- `uso_por_ruta_direccion`: Embudo, Comparar embudos, Pauta, Recuperación e Informe pasaron de `/cliente/crm/<pantalla>` a `/cliente/direccion/<pantalla>`. La herramienta MCP de uso del sistema cuenta las visitas por ruta: el historial queda bajo la ruta vieja y la ruta nueva empieza de cero. Los links viejos redirigen (307) a la nueva.
- `numeros_de_ventas`: el campo `cotizaciones` sale de Gestión (GET /api/cotizaciones?desde=&hasta= con la misma llave del catálogo), por vendedora cruzada con la asesora por nombre; una vendedora sin asesora en el CRM sale en su propia fila "(solo en Gestión)". Si Gestión no responde, `cotizaciones` es null y el aviso va en `no_se_pudo_leer`. El número que antes se llamaba "cotizaciones" (chats que llegaron a Tibio o Caliente) ahora es `chatsCalientes`.
- `chats_enlace_chatkey`: abrir un chat con `?chatKey=` (y la ruta `/api/cliente/chats/live`) aplica las mismas reglas que la lista: una asesora solo abre sus chats de líneas que ve; quien monitorea, los de sus líneas; jefes y supervisoras, los de sus líneas. Sin permiso se abre la bandeja normal (la ruta responde "Conversacion no encontrada"). El PDF del chat (`exportar-conversacion.ts`) aún no aplica esta regla.
- `alertas`: la pantalla /cliente/alertas filtra por área (Ventas, CRM Ventas, Gestión, CRM Marketplace, Coordinador, General, Marketing). El área se calcula al leer (tarjeta del tablero y su subárea madre dentro de Tecnología; si no, por quién generó la alerta; si no, General) y no se guarda. El último filtro se recuerda solo en el navegador de cada dispositivo.
- `alertas_solo_urgentes`: desde el 29-oct-2026 por WhatsApp interno solo salen las alertas URGENTES, cortas, con el link a /cliente/alertas. Prioridades: Coordinador caído y límite de Claude = Urgente; "necesita tu decisión" = Urgente solo si es por dinero, Meta Ads o una clave (si no, Alta); "trabado" y "sin trabajo" = Alta (ya no llegan por WhatsApp, solo a la página); Supervisor: CRÍTICO = Urgente, IMPORTANTE = Alta, OBSERVACIÓN = Baja; línea de WhatsApp caída = Urgente. Esto cambia lo que el dueño decidió el 26-oct. El interruptor `alertas:solo-urgentes:<workspaceId>` (AppSetting, "false" lo apaga) empieza prendido; apagado, cada fuente vuelve a avisar como antes y la página igual guarda todo.
- `alertas_agentes_de_area`: `mandar_whatsapp_al_equipo` recibe `prioridad` (y `titulo`) y lo que va a Alexander (tipo "alexander") queda en la página de Alertas; solo sale por WhatsApp con prioridad "urgente" y sale corto. Los agentes que ya corren en aizen1 no mandan la prioridad: su mensaje de las 7:30 a Alexander queda solo en la página hasta que se actualicen sus instrucciones. La lista del día de una asesora (tipo "asesora") no es una alerta y sale como siempre.
- `alertas_avisos_v3`: los avisos de src/features/agente-v3/servicios/avisos.ts (zona del libro V3) NO pasan por la página de Alertas: siguen saliendo por WhatsApp como antes.
- `supervisor_sin_ruido`: "Prioridades de Alexander" muestra máximo 5 alertas (config `maxPrioridades`, rango 1 a 5, por defecto 5), un mismo problema sale como una sola tarjeta "×N", y OBSERVACIÓN, cambios del libro que pasaron el Guardian, avisos de versiones viejas y avisos "ya no aplica" no cuentan como alerta (quedan en un "Historial / informativo" plegado o no se muestran). Antes de pintar, cada escalada se revisa en vivo contra el chat; lo guardado se cierra en la siguiente vuelta del Supervisor (cada 5 min). No cambia ningún aviso por WhatsApp ni push.
- `supervisor_bienvenida_catalogo`: el Supervisor cuenta el paquete de bienvenida (texto + audio + catálogo del primer turno, sin pausas de más de 90 s entre mensajes, constante `PAUSA_DEL_PAQUETE` en `lead.ts`) como UN solo envío; la ráfaga (más de 3 envíos en 5 min) sola nunca es CRÍTICO: queda como OBSERVACIÓN y sube a IMPORTANTE solo si además baja la respuesta en 2 h de los leads nuevos frente a los 7 días anteriores.
- `supervisor_limpieza_libro`: en la revisión de cada hora (junto con la revalidación, que debe estar prendida) el Supervisor cierra como "Reemplazado" las alertas de versiones del libro anteriores a la vigente (salvo las que la revalidación dice que SIGUEN) y junta las repetidas con "Unida a <clave>": queda abierta solo la de la versión vigente. Si se apaga la revalidación, esta limpieza no corre.
- `chats_automaticos`: el Supervisor detecta chats de robots (bancos, Nequi, Daviplata, códigos de verificación) que nadie ha respondido, los oculta del CRM (`excludedFromCrm`, nota en `metadata.chatAutomatico`) y no avisa por ellos. Si oculta a un cliente real, se muestra de nuevo desde Contactos y no se vuelve a ocultar.
- `recarga_automatica_por_version`: tras cada subida la app de las asesoras se recarga sola cuando están quietas (5 s sin teclear, sin envío, audio ni archivo en curso), con el borrador guardado en la pestaña y un texto caído por versión vieja reenviado una sola vez. Como mucho una recarga por minuto; la pastilla "Actualizamos la app" queda solo de respaldo tras 2 recargas seguidas. Los archivos adjuntos que fallen no se reenvían solos. Es normal ver un parpadeo de pantalla y algún "Failed to find Server Action" de pestañas viejas justo después de subir.
- `envio_con_version_nueva`: antes de enviar un texto la app revisa la versión (usa la revisión de hace menos de 15 s o espera como mucho 1,5 s; si `/api/version` no contesta, envía normal). Con versión nueva el mensaje no se manda al servidor: queda como envío pendiente (solo texto, máximo 2 minutos), la app se recarga y al volver sale una sola vez. Las líneas `[nota-de-voz]` buenas ya no traen el campo `error`.
- `npm_install_en_magilus`: no correr `npm install` (ni crear `node_modules`) dentro de la carpeta `Magilus`: se sincroniza al Drive y llena el cerebro de miles de archivos de código. La herramienta del reporte SEO (`gsc-reporte.mjs`, `package.json`, `node_modules`) vive fuera de `Magilus`, en `D:\Proyectos\agentes\seo`, y solo los reportes `.md` se guardan en `Tecnologia/seo/datos`.
- `tablero_ia_filtros`: en /cliente/tablero-ia los chips tachados ocultan las tarjetas (no las atenúan); por defecto solo "Te toca" y la elección se recuerda en el navegador de cada dispositivo (`localStorage`, clave `tablero-ia:filtros`).
- `seguimientos_apagados`: los seguimientos automáticos (paso del embudo, por producto, reloj V3, "Tras asesora", "Inteligente") se cancelan solos si la asesora los apagó en el chat (interruptor "Seguimientos automáticos", columna `Conversation.seguimientosApagados`), el contacto está en Negociación o Ganado, o el cliente confirmó compra/pago; los del embudo/producto también si una asesora escribió a mano en las últimas 24 h, y "Tras asesora" si la asesora prometió enviar algo. Queda una nota interna "Seguimientos apagados: <motivo>" en el chat y se cancelan los pendientes sin borrar el historial.
- `alertas_por_responsable`: el WhatsApp de las urgentes técnicas sigue yendo al teléfono del dueño (no cambió). Si el responsable no es dueño ni administrador, el menú no le muestra Alertas: entra por el link directo /cliente/alertas. Las cuentas de Marketplace caídas y las rutinas que no corrieron aún no generan alertas; la regla ya las manda a Sistemas por su origen ("CRM Marketplace", "Rutinas").
- `avisos_al_equipo`: quien se asigna su propia tarjeta (responsable = quien la creó) no recibe "tienes una tarea nueva" ni el recordatorio de 24 horas; lo urgente, el ERROR y lo que espera su sí siguen avisando.
- `etapa_automatica_seguimientos`: si algún día se crea una regla de seguimiento por etapa Frío o Caliente (CRM_STAGE), se dispararía en unos 90 leads al día. Hoy las reglas activas son por producto y por paso del agente, así que no sale ningún mensaje nuevo. Los NUEVO de antes no se mueven solos: se clasifican desde "Mi día", que avisa cuántos chats suyos siguen sin etapa.
