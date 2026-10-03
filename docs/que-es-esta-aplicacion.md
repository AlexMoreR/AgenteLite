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
- Despliegue: cada push a `main` dispara el CI de GitHub ("Docker Image CI"), que construye la imagen
  `ghcr.io/alexmorer/agentelite:latest`; con el CI en verde se despliega solo. La versión que corre se ve
  en `https://app.aizenbot.com/api/version`.

## Módulos

- `chats`: la bandeja de WhatsApp. Une los chats de las líneas por Evolution/WAHA y los de la API oficial; reparto, filtros, ficha del contacto, transcripción de audios, descarga en PDF o con audios.
- `crm`: el embudo de leads. Kanban por etapa, Registro, Informe del dueño, Mi día de cada asesora y el tablero del equipo.
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
- `equipo`: el equipo del negocio: rol (asesora, supervisora, administradora), líneas, pantallas y horario de reparto.
- `negocio`: datos del negocio y la pestaña del Reporte diario.
- `notificaciones`: preferencias de avisos.
- `finanzas`: ingresos y egresos con un asistente de IA y sincronización con Google Sheets.
- `marketing-ia`: generador de anuncios con IA.
- `diagramas`: lienzos de diagramas libres (por ejemplo el mapa de caminos de los chats).
- `claude`: las claves para conectar Claude al CRM por el MCP.
- `onboarding`: el alta de un negocio nuevo.

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
- `Contact`: el lead / cliente. Etapa del CRM (`crmStage`), motivo de pérdida, fecha real de venta (`wonAt`) y si está oculto del CRM (`excludedFromCrm`).
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
- `WebPushSubscription`: un navegador o celular suscrito a las notificaciones push.
- `MediaLibraryItem`: la biblioteca de archivos (fotos, PDFs, audios) para mandar desde el chat.
- `Diagram`: un lienzo de diagrama libre.
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
- **Roles**: asesora (sus chats), supervisora (ve "Todas" pero solo de sus líneas, asigna, ve tableros y
  automatizaciones; se guarda en `AppSetting equipo:supervisoras:<workspace>`), administradora y dueño.
  La monitora mira sin poder escribir.

## Automatizaciones

- `seguimientos_programados`: el reloj manda los seguimientos agendados (Follow) cuando les toca.
- `seguimientos_v3`: las reglas "sin respuesta" del Agente V3: le escriben al cliente callado a los 15 minutos o a la hora, según el paso en que va.
- `aviso_cliente_esperando`: si un cliente escribió y lleva 15 minutos sin respuesta, se le avisa a la asesora (no le escribe al cliente).
- `rescate_de_mensajes_v3`: vuelve a pasarle al motor un mensaje que nunca miró (por una caída o un despliegue), solo en chats sin asesora ni pausa.
- `rescate_de_chats_huerfanos`: reparte un chat que lleva media hora con el cliente esperando y sin nadie a cargo.
- `reparto_por_turno`: en las líneas de ventas, cuando la clienta contesta CON CONTENIDO (no solo saludo, emoji, "ok" o "gracias") a algo del agente o de un flujo y el chat no tiene asesora, se reparte por la rueda de la línea. Asignar no pausa al agente: sigue hasta que la asesora escribe.
- `enfriamiento_por_llamadas`: un lead en Caliente baja a Tibio con la regla del Playbook: 3 intentos nuestros sin respuesta (mensajes de asesora o llamadas), 5 días desde su último mensaje y cero respuesta. Nunca si tiene cotización o próximo contacto agendado. Vuelve a Caliente si contesta.
- `temperatura`: un lead en Tibio baja a Frío con la misma regla del Playbook (ver `enfriamiento_por_llamadas`); nunca si tiene cotización. Vuelve a Tibio si contesta. Hasta el 03-10-2026 bajaba con "2 días sin escribir".
- `descarte_automatico`: lleva a Descartado a los leads con 30 días sin respuesta y 3 insistencias nuestras. Se corrió una vez y se apagó; hoy no aparece en pantalla.
- `campanas`: manda la siguiente tanda de cada campaña en curso.
- `transcripcion_de_audios`: pasa a texto cada nota de voz (Whisper) y la deja debajo del audio.
- `purga_de_webhooks`: borra el archivo de webhooks viejo para no llenar el disco.
- `sincronizacion_gestion`: trae el catálogo de Gestión (magilus.com) una vez al día a las 3 a. m. y con el botón "Sincronizar con Gestión". Gestión manda nombre, código, precios, categoría e imágenes (las que no cargan se descartan); la descripción de venta, el embudo, los seguimientos y los flujos son del CRM y no se tocan. Un producto oculto o borrado en Gestión queda inactivo, nunca se borra. No corre hasta que se apruebe el emparejamiento de los productos que ya existían.
- `informe_diario`: a las 11:59 p. m. (hora de Colombia) arma el informe del día y lo manda por WhatsApp.

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
- **No hay suite de pruebas automáticas**: el chequeo es `tsc`, `eslint` y el build.
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

## Advertencias de operación

- **Una migración que falla tumba la app**: el contenedor corre `prisma migrate deploy` antes de
  arrancar, con `set -eu`. Si la migración falla, el servidor no arranca. Las migraciones se escriben a
  mano, aditivas, y se ensayan en producción dentro de una transacción que se deshace antes de subir.
- **No usar `prisma migrate dev`** contra la base: tiene drift y querría borrarla. El puerto 5432 está
  cerrado desde afuera; para leer la base se entra por SSH al servidor.
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
