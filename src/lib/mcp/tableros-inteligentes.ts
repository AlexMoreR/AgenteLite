import {
  aprobarTarjeta,
  esperaLaPantallaDeLaTarjeta,
  borrarTarjeta,
  cambiarEstadoTarjeta,
  conectarTarjetas,
  crearTablero,
  crearTarjeta,
  crearTipo,
  deshacerCambioTarjeta,
  editarTarjeta,
  editarTipo,
  codigoDeLaTarjeta,
  historialDeTarjeta,
  idDeTarjetaPorCodigo,
  linkDeLaTarjeta,
  linkDelTablero,
  listarTableros,
  listarTipos,
  miembrosDelNegocio,
  planYResultado,
  renombrarTablero,
  tableroDeLaTarjeta,
  tableroDelCambio,
  tableroDelTipo,
  verTablero,
  type TableroDeReferencia,
  type ContextoTablero,
  type TipoVista,
} from "@/features/tableros-inteligentes/services/tableros";
import {
  ESTADOS_AL_CREAR,
  ESTADOS_SIN_APROBAR,
  ESTADOS_TARJETA,
  ICONOS_DE_TIPO,
  NOMBRE_DEL_ESTADO,
  elegirMiembro,
  sePuedeMarcarHechoAMano,
} from "@/features/tableros-inteligentes/services/reglas";
import { marcarUrgente } from "@/features/tableros-inteligentes/services/avisos-al-equipo";
import { terminadasDeLaSemana } from "@/features/tableros-inteligentes/services/archivadas";
import { textoDelCoordinador, vistaDelCoordinador } from "@/features/tableros-inteligentes/services/coordinador-en-vivo";
import { contarHijas } from "@/features/tableros-inteligentes/services/niveles";
import { dondeSeConstruyo } from "@/features/tableros-inteligentes/services/modelos-del-coordinador";
import { RIESGOS } from "@/features/tableros-inteligentes/services/reglas-riesgo";
import {
  MOMENTOS_DE_APROBACION,
  NOMBRE_DEL_MOMENTO,
  REPOS_DEL_TRABAJADOR,
  ZONAS_PROTEGIDAS,
  esMomento,
} from "@/features/tableros-inteligentes/services/reglas-trabajador";

/*
  TABLERO IA (tableros inteligentes) por el MCP (fase 1, 19-oct-2026).

  El dueño conversa con Claude y Claude anota las ideas en un tablero: tarjetas unidas con flechas.
  El dueño las ve como un mapa en /cliente/tablero-ia (pantalla "Tablero IA") y las aprueba con un botón.

  Cada tablero tiene TIPOS de tarjeta (nace con Área, Idea y Tarea; Claude puede crear y editar más
  con crear_tipo / editar_tipo). Solo las tarjetas de un tipo que pide aprobación pasan por
  POR_APROBAR y APROBADO. Los tipos sin estados (usa_estados = false, como Área) son carpetas: sus
  tarjetas no tienen estado (ver_tablero devuelve estado null). Una tarjeta puede colgar de una tarjeta madre (padre_id) si el tipo lo
  permite, y llevar un link.

  Fase 2 (20-oct-2026): las tarjetas con `repo` (gestion, aizencrm) las ejecuta el Coordinador (un PC
  aparte): arma un plan (desde el 24-oct pasa solo a construir; desde el 30-oct un solo sí del dueño, a la tarea, aprueba
  también el plan aunque toque dinero de Gestión; solo espera el sí del dueño si toca Meta Ads, si tiene preguntas abiertas
  o un NECESITO, si la tarea pasó sola sin el sí del dueño, si tiene zona protegida o si "Aprobar planes solo" está
  apagado), lo construye en una rama, el dueño da el sí final y lo
  sube. ver_plan_y_resultado muestra todo eso; aprobar_tarjeta aprueba la tarea, el plan o el sí final
  SOLO cuando la persona lo dijo explícitamente en la conversación.
  Desde el 21-oct-2026 (Planear -> Aprobar plan -> Hacer): si todo pasa, el Coordinador sube solo a
  producción y la deja HECHO con el link del commit; si el despliegue falla, deshace el commit (revert)
  y queda ERROR. El sí final ('subir') queda para las tarjetas que tocan chats, agentes, el libro V3 o
  Meta Ads (zona protegida) y las que ya estaban POR_REVISAR.

  Desde el 25-oct-2026 (decisión del dueño: "¿por qué esperan mi aprobación si ya dije que no la necesitan?")
  toda TAREA con repo que entra en POR_APROBAR pasa SOLA a APROBADO, con cualquier riesgo: queda "aprobada
  automáticamente (regla del dueño 25-oct)" en el historial. ÚNICA excepción: si el título o el detalle hablan
  de dinero de Gestión (abonos, saldos, nómina, comisiones, facturación, pagos) o de subir presupuesto, activar
  campañas o crear gasto en Meta Ads, o si tiene zona Meta Ads o libro V3, se queda POR_APROBAR con su motivo.
  CHATS y BOT_VENTAS también arrancan solas (la subida no cambia). El dueño la apaga con "Aprobar tareas solo".
  Un solo sí (30-oct-2026): si el dueño aprueba esa tarea (en la pantalla o por voz), su plan de dinero de Gestión pasa
  solo a construir, sin un segundo sí. El plan sigue esperando solo si toca Meta Ads, si tiene preguntas abiertas o un
  NECESITO (llegan por WhatsApp como aviso urgente), o si la tarea pasó sola sin el sí del dueño.

  Riesgo y aprobación automática (22-oct-2026, decisión del dueño): una tarjeta con repo es de riesgo BAJO
  o ALTO (reglas-riesgo.ts; sin riesgo cuenta como ALTO). Claude lo propone en crear_tarjeta /
  editar_tarjeta (riesgo, motivo_riesgo). Una tarjeta BAJO se aprueba SOLA (la tarea y el plan) si el
  interruptor de la pantalla está prendido: queda "aprobado automáticamente por regla de bajo riesgo" en
  el historial. El servidor revisa las reglas, no solo este texto: pedir BAJO con algo de riesgo alto es un
  error y la tarjeta no se guarda.

  Lo que Claude NO puede hacer, por diseño:
  - Marcar BAJO algo que cumpla un criterio ALTO (zona protegida, dinero, permisos o credenciales,
    mensajes a clientes, el propio trabajador, migraciones que borren o cambien datos), ni bajar a BAJO una
    tarjeta que el trabajador o el dueño dejaron en ALTO.
  - Aprobar por su cuenta. Las únicas aprobaciones son las automáticas del servidor (reglas del dueño) y aprobar_tarjeta: el servidor exige un texto de
    confirmación de la persona ("sí, apruebo"), que el userId de la clave sea el dueño o un aprobador
    con alcance, que el estado corresponda, y rechaza las tarjetas con zona protegida (esas, solo en la
    pantalla). El sí final (subir) es solo del dueño. Ningún inputSchema de cambiar_estado_tarjeta
    ofrece APROBADO ni los estados del Coordinador.
  - Ejecutar algo sin aprobar: EN_CURSO solo sale de APROBADO (en tipos que piden aprobación); en
    tarjetas con repo, EN_CURSO, HECHO y los demás estados del Coordinador los pone solo el Coordinador.
    Única excepción, el HECHO a mano (22-oct-2026): si el cambio se terminó por fuera del Coordinador y la
    tarjeta con repo quedó en ERROR, FALLIDO o POR_REVISAR, cambiar_estado_tarjeta la pasa a HECHO solo
    con texto_confirmacion del dueño ("sí, márcala hecha"), la clave de la cuenta dueña y una nota.
  - Quitar una zona protegida (solo ponerla).
  - Dejar intacta una aprobación al editar: si edita una tarjeta APROBADA, vuelve a POR_APROBAR; si
    le cambia el tipo, queda POR_APROBAR o IDEA.
  - Quitarle la aprobación a un tipo, ni borrar tipos (solo el dueño en la pantalla).
  - Borrar lo que tiene el Coordinador en la mano (PLANEANDO, EN_CURSO, SUBIENDO), una tarjeta
    APROBADA, PLAN_APROBADO o POR_REVISAR, o una con zona protegida. PLAN_LISTO y ERROR, solo por voz
    del dueño (texto "sí, bórrala" y la cuenta de la clave es la dueña).
  - Deshacer una aprobación, ni dejar algo APROBADO deshaciendo.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const BORRA = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/** El filtro de ver_tablero para las archivadas (services/archivadas.ts). No es un estado de la tarjeta. */
const ESTADO_ARCHIVADA = "ARCHIVADA";

/*
  Alexander y Emanuel le hablan a Claude por VOZ y cada uno tiene su tablero ('Magilus General' y
  'Desarrollo Emanuel'): no se pueden confundir. Va en la descripción de cada herramienta que escribe
  y en las instrucciones del servidor (src/app/api/mcp/route.ts). Cada respuesta trae `tablero`
  ({id, nombre}) para que Claude repita el nombre correcto.
*/
export const REGLA_DEL_TABLERO =
  " CUÁL TABLERO: si el negocio tiene más de un tablero y la persona no nombró cuál, preguntarle antes de actuar. " +
  "Antes de escribir, decir en voz alta el nombre del tablero ('Lo anoto en Magilus General, ¿listo?'). " +
  "Nunca adivinar por el último tablero usado. La respuesta trae `tablero` con su nombre: repetirlo.";

const PROPIEDADES_DEL_TIPO = {
  nombre: { type: "string", description: "Nombre corto: 'Proyecto', 'Meta', 'Riesgo'" },
  color: { type: "string", description: "Color en hex, por ejemplo '#0ea5e9'. Opcional." },
  icono: { type: "string", enum: [...ICONOS_DE_TIPO], description: "Ícono de la tarjeta. Opcional." },
  requiere_aprobacion: {
    type: "boolean",
    description: "true si las tarjetas de este tipo las tiene que aprobar el dueño antes de ejecutarse (como Tarea).",
  },
  usa_estados: {
    type: "boolean",
    description:
      "false si el tipo es una carpeta (como Área): sus tarjetas no tienen estado ni se aprueban, solo agrupan. Por defecto true.",
  },
  padres: {
    type: "array",
    items: { type: "string" },
    description:
      "De qué tipos puede colgar una tarjeta de este tipo (nombres o ids): ['Área']. Puede incluir el mismo tipo (Área dentro de Área). Lista vacía = de ninguno.",
  },
  orden: { type: "number", description: "Posición en la lista de tipos (menor = primero). Opcional." },
} as const;

const PROPIEDAD_REPO = {
  type: "string",
  enum: [...REPOS_DEL_TRABAJADOR],
  description:
    "Si es un cambio de código que hace el Coordinador: en qué repositorio (gestion = ventas y cotizaciones; aizencrm = este CRM). Solo tipos con aprobación (Tarea). Sin repo, el Coordinador no la toma. Opcional.",
} as const;

const PROPIEDAD_ZONA = {
  type: "array",
  items: { type: "string", enum: [...ZONAS_PROTEGIDAS] },
  description:
    "Zonas protegidas que toca: META_ADS (anuncios y campañas), BOT_VENTAS (el bot que atiende, agentes V2/V3 y flujos), LIBRO_V3 (el libro del agente V3), CHATS (envío y recepción de WhatsApp, Evolution, webhooks, la bandeja de las asesoras). BOT_VENTAS, META_ADS y LIBRO_V3 (desde el 24-oct-2026) y CHATS (desde el 26-oct-2026) se aprueban también por voz y suben solas si compilan y pasan las pruebas, con vigilancia de 30 minutos (CHATS además exige la confirmación de que no manda mensajes nuevos a clientes; cualquier envío nuevo espera el sí del dueño); lo que gasta plata en Meta Ads (presupuesto, prender, crear) sigue esperando el sí del dueño. Opcional.",
} as const;

const PROPIEDAD_RIESGO = {
  type: "string",
  enum: [...RIESGOS],
  description:
    "Solo en tarjetas con repo. BAJO = una tarea sencilla y sin riesgo que se aprueba SOLA y arranca sin pedirle permiso al dueño; ALTO = la aprueba el dueño. Es BAJO únicamente si cumple TODO: sin zona protegida; sin migración o con una migración solo aditiva (nada de DROP, ALTER destructivo, borrar ni modificar datos existentes); no toca dinero (abonos, saldos, nómina, comisiones, facturación, pagos), ni permisos, usuarios, contraseñas o credenciales, ni envía mensajes a clientes; no toca el propio trabajador ni las reglas de aprobación. Si hay duda, ALTO. El servidor lo revisa: si pides BAJO y algo calza con ALTO, la tarjeta no se guarda. Sin riesgo cuenta como ALTO.",
} as const;

const PROPIEDAD_MOTIVO_RIESGO = {
  type: "string",
  description: "Una frase que explique por qué es BAJO o ALTO (se ve en la tarjeta y queda en el historial de la aprobación automática). Opcional.",
} as const;

const PROPIEDAD_RESPONSABLE = {
  type: "string",
  description:
    "A quién se le asigna la tarjeta: el nombre o el email de una persona activa del negocio (por ejemplo 'Emanuel'). Si el nombre coincide con más de una persona, da error y pide el email. La persona la ve en 'Asignadas a mí' aunque esté en un tablero que no es suyo. Opcional.",
} as const;

export const HERRAMIENTAS_MCP_TABLEROS = [
  {
    name: "listar_tableros",
    title: "Ver los tableros de ideas",
    description:
      "Muestra TODOS los tableros de ideas del negocio, de quién es cada uno (dueno) y cuántas tarjetas hay en cada estado. Cada tablero es de una persona: ella lo ve en su pantalla; el dueño del negocio ve todos. Empezar por acá para tener los ids. Si no hay ninguno, crear uno con crear_tablero.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "crear_tablero",
    title: "Crear un tablero de ideas",
    description:
      "Crea un tablero nuevo, por ejemplo uno por tema ('Ventas', 'Producción', 'Marketing'). Nace con 3 tipos de tarjeta: Área (una carpeta sin estado; puede ir dentro de otra Área), Idea (cuelga de un Área) y Tarea (cuelga de una Idea y la aprueba el dueño). Antes mirar listar_tableros para no repetir uno que ya existe. Antes de crearlo, decir en voz alta el nombre que va a tener y de quién va a ser. Sin dueno, es de la persona de esta clave.",
    inputSchema: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre corto del tablero: 'Ventas'" },
        dueno: {
          type: "string",
          description: "De quién es el tablero: el nombre ('Emanuel') o el email de una persona activa del negocio. Opcional.",
        },
      },
      required: ["nombre"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "renombrar_tablero",
    title: "Cambiar el nombre de un tablero",
    description:
      "Le cambia el nombre a un tablero del negocio (sus tarjetas, tipos y links no cambian) y, si se pide, de quién es (dueno). El nombre no puede ir vacío, tiene hasta 60 letras y no puede ser el de otro tablero del negocio (sin mirar mayúsculas). Para cambiar solo el dueño, mandar el mismo nombre. Los ids salen de listar_tableros." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tablero_id: { type: "string", description: "Id del tablero (ver listar_tableros)" },
        nombre: { type: "string", description: "El nombre nuevo: 'Ventas 2027'" },
        dueno: {
          type: "string",
          description: "El dueño nuevo: nombre o email de una persona activa del negocio. Opcional.",
        },
      },
      required: ["tablero_id", "nombre"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "ver_tablero",
    title: "Ver un tablero",
    description:
      "Muestra las tarjetas de un tablero (título, detalle, tipo, de qué tarjeta cuelga, área, estado, responsable, fecha, link) con qué flechas las unen, y los tipos del tablero. Hay que llamarla antes de editar o conectar: devuelve los ids. " +
      "No trae las ARCHIVADAS: las HECHO y FALLIDO salen solas del tablero a los 3 días de terminar (siguen HECHO o FALLIDO, no cuentan para el límite de 300 y se ven en la pestaña 'Trabajos terminados'). Para verlas, estado 'ARCHIVADA'. Para lo terminado en una semana, listar_terminadas.",
    inputSchema: {
      type: "object",
      properties: {
        tablero_id: { type: "string", description: "Id del tablero (ver listar_tableros)" },
        estado: {
          type: "string",
          enum: [...ESTADOS_TARJETA, ESTADO_ARCHIVADA],
          description: "Solo las tarjetas en este estado. 'ARCHIVADA' trae solo las archivadas (las terminadas que ya salieron del tablero). Opcional.",
        },
        responsable: {
          type: "string",
          description: "Solo las tarjetas asignadas a esta persona: su nombre o email (de una persona activa del negocio). Opcional.",
        },
      },
      required: ["tablero_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "listar_terminadas",
    title: "Ver lo terminado en una semana",
    description:
      "SOLO LECTURA. Lo que se terminó (HECHO o FALLIDO, archivado o no) en la semana de la fecha que se pasa, de lunes a domingo en hora de Bogotá: código T-123, título, tablero, estado, cuándo terminó, repo y link al commit. Sirve para preguntas como '¿qué se terminó esta semana?'. Sin tablero_id trae todos los tableros del negocio. Máximo 500.",
    inputSchema: {
      type: "object",
      properties: {
        semana: { type: "string", description: "Cualquier fecha de la semana, AAAA-MM-DD (por ejemplo 2026-10-30 trae del lunes 26-oct al domingo 1-nov). Sin ella, la semana de hoy." },
        tablero_id: { type: "string", description: "Id del tablero (ver listar_tableros). Opcional." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "listar_tipos",
    title: "Ver los tipos de tarjeta",
    description:
      "Muestra los tipos de tarjeta de un tablero (Área, Idea, Tarea...): su color, ícono, si el dueño los tiene que aprobar, si tienen estados (Área no: es una carpeta), de qué tipos pueden colgar y cuántas tarjetas tiene cada uno.",
    inputSchema: {
      type: "object",
      properties: { tablero_id: { type: "string", description: "Id del tablero (ver listar_tableros)" } },
      required: ["tablero_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "crear_tipo",
    title: "Crear un tipo de tarjeta",
    description:
      "Crea un tipo de tarjeta nuevo en un tablero (por ejemplo 'Proyecto' que cuelga de un 'Área'). Si requiere_aprobacion es true, sus tarjetas pasan por POR_APROBAR y las aprueba el dueño." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: { tablero_id: { type: "string", description: "Id del tablero" }, ...PROPIEDADES_DEL_TIPO },
      required: ["tablero_id", "nombre"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "editar_tipo",
    title: "Editar un tipo de tarjeta",
    description:
      "Cambia el nombre, color, ícono, orden, de qué tipos puede colgar, si tiene estados, o le pone aprobación a un tipo. Se manda solo lo que cambia. NO puede quitarle la aprobación a un tipo (eso lo hace solo el dueño en la pantalla), ni quitarle los estados si alguna de sus tarjetas tiene un estado distinto de IDEA. No quita un 'padre' que alguna tarjeta está usando." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: { tipo_id: { type: "string", description: "Id del tipo (ver listar_tipos)" }, ...PROPIEDADES_DEL_TIPO },
      required: ["tipo_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "crear_tarjeta",
    title: "Agregar una tarjeta",
    description:
      "Agrega una tarjeta (un área, una idea, una tarea...) al tablero. Sin tipo queda como Idea. Puede colgar de otra tarjeta (padre_id) si su tipo lo permite (Área > Idea > Tarea; un Área también dentro de otra Área). Queda IDEA, o POR_APROBAR si su tipo pide aprobación y ya está lista para que el dueño la mire. Un Área no lleva estado. Si es un cambio de código que debe hacer el Coordinador, poner repo (gestion o aizencrm; solo tipos con aprobación, como Tarea) y, si toca Meta Ads, el bot de ventas o el libro V3, zona_protegida. Aprobarla lo hace el dueño (en la pantalla, o con aprobar_tarjeta si lo dice explícitamente). RIESGO (22-oct-2026, decisión del dueño: 'las cosas básicas que ayudan al negocio y no tienen riesgo, hágalas sin pedirme permiso; lo súper importante sí me lo manda al tablero'): en tarjetas con repo, proponer riesgo BAJO o ALTO. Una tarjeta BAJO POR_APROBAR se aprueba SOLA (si el interruptor de la pantalla está prendido) y el trabajador arranca sin pedir permiso. El servidor revisa las reglas: Claude nunca puede marcar BAJO algo con zona protegida, dinero, permisos o credenciales, mensajes a clientes, el propio trabajador o migraciones que borren o cambien datos. Si hay duda, ALTO." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tablero_id: { type: "string", description: "Id del tablero (ver listar_tableros)" },
        titulo: { type: "string", description: "Corto y claro: 'Responder en menos de 15 minutos'" },
        tipo: { type: "string", description: "Nombre o id del tipo: 'Área', 'Idea', 'Tarea'... (ver listar_tipos). Por defecto, Idea." },
        padre_id: { type: "string", description: "Id de la tarjeta de la que cuelga (su tipo tiene que estar permitido). Opcional." },
        detalle: { type: "string", description: "Qué es, por qué y cómo se mediría. Opcional." },
        area: { type: "string", description: "Ventas, Marketing, Operación... Opcional." },
        estado: { type: "string", enum: [...ESTADOS_AL_CREAR], description: "IDEA (por defecto) o POR_APROBAR (solo tipos con aprobación)" },
        fecha: { type: "string", description: "Para cuándo, AAAA-MM-DD. Opcional." },
        orden: { type: "number", description: "Posición dentro de la lista (menor = primero). Opcional." },
        link: { type: "string", description: "Un link http(s) relacionado (un documento, una hoja). Opcional." },
        link_texto: { type: "string", description: "Lo que dice el botón del link. Opcional (si no, se ve el dominio)." },
        repo: PROPIEDAD_REPO,
        zona_protegida: PROPIEDAD_ZONA,
        riesgo: PROPIEDAD_RIESGO,
        motivo_riesgo: PROPIEDAD_MOTIVO_RIESGO,
        responsable: PROPIEDAD_RESPONSABLE,
        conectar_con: {
          type: "array",
          items: { type: "string" },
          description: "Ids de tarjetas del mismo tablero a las que sale una flecha desde esta. Opcional.",
        },
      },
      required: ["tablero_id", "titulo"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "editar_tarjeta",
    title: "Editar una tarjeta",
    description:
      "Cambia el título, el detalle, el tipo, de qué tarjeta cuelga, el área, la fecha, el orden, el link, el repo, la zona protegida, el riesgo (BAJO / ALTO, con su motivo_riesgo) o el responsable (a quién se le asigna; asignar NO reinicia la aprobación) de una tarjeta. Se manda solo lo que cambia. Si queda POR_APROBAR con riesgo BAJO y el interruptor está prendido, se aprueba sola. Si estaba aprobada (APROBADO, o con el trabajador: PLAN_LISTO, PLAN_APROBADO, POR_REVISAR, ERROR), vuelve a POR_APROBAR. Mientras el Coordinador la tiene (PLANEANDO, EN_CURSO, SUBIENDO) no se edita. Si se le cambia el tipo, queda POR_APROBAR (tipo con aprobación) o IDEA (sin aprobación): pierde la aprobación que tuviera. La zona protegida se puede agregar, no quitar (eso solo el dueño en la pantalla)." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero) o su código, por ejemplo T-123" },
        titulo: { type: "string" },
        detalle: { type: "string" },
        tipo: { type: "string", description: "Nombre o id del tipo nuevo (ver listar_tipos)" },
        padre_id: { type: "string", description: "Id de la tarjeta madre, o vacío para que quede suelta" },
        area: { type: "string", description: "Vacío para quitarla" },
        fecha: { type: "string", description: "AAAA-MM-DD, o vacío para quitarla" },
        orden: { type: "number" },
        link: { type: "string", description: "http(s)://..., o vacío para quitarlo" },
        link_texto: { type: "string", description: "Texto del botón del link, o vacío para mostrar el dominio" },
        repo: { ...PROPIEDAD_REPO, enum: [...REPOS_DEL_TRABAJADOR, ""], description: `${PROPIEDAD_REPO.description} Vacío para quitarlo.` },
        zona_protegida: { ...PROPIEDAD_ZONA, description: "Zonas protegidas que AGREGAR (las que ya tiene se quedan: quitarlas es solo del dueño en la pantalla)." },
        riesgo: { ...PROPIEDAD_RIESGO, enum: [...RIESGOS, ""], description: `${PROPIEDAD_RIESGO.description} Vacío para quitarlo (queda como ALTO). Claude no puede bajar a BAJO una tarjeta que el trabajador o el dueño dejaron en ALTO.` },
        motivo_riesgo: PROPIEDAD_MOTIVO_RIESGO,
        responsable: { ...PROPIEDAD_RESPONSABLE, description: `${PROPIEDAD_RESPONSABLE.description} Vacío para quitar el responsable.` },
        urgente: {
          type: "boolean",
          description:
            "true para marcar la tarjeta URGENTE: si tiene responsable, le llega un WhatsApp que empieza por URGENTE (también de noche). Solo se marca, no se quita. No cambia el estado ni la aprobación.",
        },
      },
      required: ["tarjeta_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "conectar_tarjetas",
    title: "Unir dos tarjetas",
    description:
      "Une dos tarjetas del mismo tablero con una flecha que sale de la primera y llega a la segunda (por ejemplo: 'esto lleva a esto' o 'esto depende de esto'). Para decir 'esto es parte de esto' se usa padre_id, no una flecha." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        origen_id: { type: "string", description: "Tarjeta de donde sale la flecha" },
        destino_id: { type: "string", description: "Tarjeta a donde llega la flecha" },
        depende: {
          type: "boolean",
          description:
            "Verdadero si el destino DEPENDE del origen: el Coordinador no toma el destino hasta que el origen esté HECHO (por ejemplo, Marketing y Sistemas dependen de Ventas). Se rechaza si haría un ciclo. Por defecto falso.",
        },
      },
      required: ["origen_id", "destino_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "cambiar_estado_tarjeta",
    title: "Mover una tarjeta de estado",
    description:
      "Mueve una tarjeta de estado. NO aprueba (para eso está aprobar_tarjeta, solo si la persona lo dice) y no pone ningún estado del Coordinador (PLANEANDO, PLAN_LISTO, PLAN_APROBADO, POR_REVISAR, SUBIENDO, ERROR). Para pedir aprobación, dejarla POR_APROBAR (solo tipos con aprobación). En tipos con aprobación y SIN repo, EN_CURSO solo sale de una APROBADA, y HECHO de una APROBADA o EN_CURSO; en tarjetas CON repo, EN_CURSO y HECHO los pone solo el Coordinador, y mientras él la tiene no se mueve. FALLIDO (abandonarla) sale de algo aprobado o de lo que dejó el Coordinador. Los tipos sin aprobación van libres entre IDEA, EN_CURSO, HECHO y FALLIDO. Las tarjetas de un tipo sin estados (Área) no tienen estado: se rechaza. " +
      "HECHO A MANO: si un cambio con repo se terminó por fuera del Coordinador (por ejemplo, lo subió Claude Code) y la tarjeta quedó en ERROR, FALLIDO o POR_REVISAR, NO la borres: el dueño la marca hecha. Primero léele el título y espera que diga 'sí, márcala hecha'; manda eso en texto_confirmacion (tal cual) y en nota qué se hizo (obligatoria, hasta 500 letras); commit es opcional (código de 7 a 40 letras y números, o link de GitHub). La cuenta de la clave de Claude tiene que ser la dueña del negocio. Nunca lo hagas por tu cuenta ni mientras el Coordinador la tiene (PLANEANDO, EN_CURSO, SUBIENDO). Queda en el historial como 'marcado hecho a mano por el dueño'. Si venía de ERROR o POR_REVISAR no se puede deshacer desde acá." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero) o su código, por ejemplo T-123" },
        estado: { type: "string", enum: [...ESTADOS_SIN_APROBAR] },
        texto_confirmacion: {
          type: "string",
          description:
            "Solo para HECHO a mano: lo que dijo el dueño, tal cual, por ejemplo 'sí, márcala hecha'. Mínimo 8 caracteres, con 'sí' y 'hecha'.",
        },
        nota: {
          type: "string",
          description: "Solo para HECHO a mano: en pocas palabras, qué se hizo por fuera. Obligatoria, hasta 500 letras.",
        },
        commit: {
          type: "string",
          description: "Solo para HECHO a mano, opcional: el código del commit (7 a 40 letras y números) o un link de GitHub.",
        },
      },
      required: ["tarjeta_id", "estado"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "borrar_tarjeta",
    title: "Borrar una tarjeta",
    description:
      "Saca una tarjeta del tablero en un solo paso, con TODAS sus flechas (no hay que borrarlas aparte). Se puede deshacer con deshacer_cambio_tarjeta y vuelve con sus flechas. Sus hijas quedan sueltas hasta que se deshaga. " +
      "Una tarjeta PLAN_LISTO o ERROR se borra SOLO si el dueño lo pidió en esta conversación: antes, léele el título y espera que diga 'sí, bórrala'; texto_confirmacion es lo que dijo, tal cual. La cuenta de la clave de Claude tiene que ser la dueña del negocio. Nunca borres por tu cuenta. " +
      "No borra lo que tiene el Coordinador en la mano (PLANEANDO, EN_CURSO, SUBIENDO), ni APROBADO, PLAN_APROBADO o POR_REVISAR, ni una tarjeta con zona protegida (esa, solo en la pantalla)." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero) o su código, por ejemplo T-123" },
        texto_confirmacion: {
          type: "string",
          description:
            "Lo que dijo la persona para borrar, tal cual, por ejemplo 'sí, bórrala'. Obligatorio para PLAN_LISTO o ERROR; si viene en otra, queda anotado como borrado por voz. Mínimo 8 caracteres.",
        },
      },
      required: ["tarjeta_id"],
      additionalProperties: false,
    },
    annotations: BORRA,
  },
  {
    name: "ver_historial_tarjeta",
    title: "Historial de una tarjeta",
    description:
      "Quién cambió la tarjeta, cuándo, desde dónde (Claude o la pantalla) y qué tenía antes. Devuelve el id de cada cambio para deshacer. Sirve también con una tarjeta borrada (para deshacer el borrado).",
    inputSchema: {
      type: "object",
      properties: { tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero) o su código, por ejemplo T-123" } },
      required: ["tarjeta_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "deshacer_cambio_tarjeta",
    title: "Deshacer un cambio de una tarjeta",
    description:
      "Deja la tarjeta como estaba antes de ese cambio (deshacer una creación la saca del tablero; deshacer un borrado la devuelve con sus flechas). No deshace lo que hizo el dueño en la pantalla, no quita ni devuelve una aprobación, y si después hubo otro cambio sobre lo mismo, avisa y no toca nada." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: { cambio_id: { type: "string", description: "Id del cambio (ver ver_historial_tarjeta)" } },
      required: ["cambio_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "ver_plan_y_resultado",
    title: "Ver el plan y el resultado del Coordinador",
    description:
      "Muestra en qué va una tarjeta que ejecuta el trabajador: estado, repo, zona protegida, el plan que escribió, dónde se construyó (construida_en: aizen1 o la nube de Claude, con link_sesion para mirar la sesión), el resultado (resumen, pruebas, si pasó, si sube sola, la rama con su link, commit, migración, la subida con el link del commit o el error con su motivo y la reversión si la hubo) y quién aprobó qué (la tarea, el plan, el sí final), cuándo y por dónde (pantalla o voz). Llamarla antes de aprobar_tarjeta para poder leerle a la persona lo que aprueba.",
    inputSchema: {
      type: "object",
      properties: { tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero) o su código, por ejemplo T-123" } },
      required: ["tarjeta_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "ver_coordinador",
    title: "Ver qué está haciendo el Coordinador",
    description:
      "SOLO LECTURA. Úsala cuando la persona pregunte '¿qué está haciendo el Coordinador?', cómo va el PC o si está apagado. Devuelve lo mismo que la pestaña 'Coordinador en vivo' de Tablero IA: `resumen` (texto sencillo para leer en voz alta), las tareas en marcha (título, el agente del proyecto que la trabaja, etapa: planeando / construyendo / probando / subiendo, dónde corre: aizen1, nube de Claude o GitHub Actions, modelo, hace cuánto empezó y en qué intento o reparación va), la carga de aizen1 (procesador, memoria, disco y semáforo verde / amarillo / rojo, y si espera que el PC se desocupe), la fila con lo bloqueado y su motivo, lo de hoy (terminadas, falladas, reparadas y cuánto tomó cada una) y el uso de Claude (si llegó al límite y cuándo se reinicia). Si `en_linea` es false, el Coordinador está apagado o sin conexión (más de 2 minutos sin latido) y lo demás es el último dato conocido. No cambia nada.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "aprobar_tarjeta",
    title: "Aprobar una tarjeta (solo si la persona lo dijo)",
    description:
      "Úsala SOLO si la persona lo dijo explícitamente en esta conversación. Antes, léele el título y qué se aprueba, y espera que diga 'sí, apruebo'. Nunca apruebes por tu cuenta. Desde el 25-oct-2026 casi nunca hace falta para la tarea: toda tarea con repo pasa SOLA a APROBADO ('aprobada automáticamente (regla del dueño 25-oct)'; también CHATS y BOT_VENTAS). Solo se queda POR_APROBAR esperando este sí la que habla de dinero de Gestión (abonos, saldos, nómina, comisiones, facturación, pagos), de subir presupuesto, activar campañas o crear gasto en Meta Ads, o la de zona Meta Ads o libro V3, o cualquiera si el dueño apagó 'Aprobar tareas solo'. " +
      "momento: 'tarea' (una tarjeta POR_APROBAR; o reintentar desde ERROR, planeando de nuevo), 'plan' (el plan del Coordinador, PLAN_LISTO; o reintentar desde ERROR con el mismo plan; desde el 24-oct-2026 el plan pasa SOLO a construir al aprobar la tarea, y desde el 30-oct-2026 un solo sí del dueño, a la tarea, aprueba también el plan aunque toque dinero de Gestión; así que el sí del plan solo se pide si puede subir presupuesto, activar campañas o crear gasto en Meta Ads, si tiene preguntas abiertas o un NECESITO, si toca dinero de Gestión y la tarea pasó sola sin el sí del dueño, o si el dueño apagó 'Aprobar planes solo') o 'subir' (el sí final para subir a producción, POR_REVISAR con todo pasado; solo el dueño). " +
      "'subir' solo aplica a las tarjetas que tocan chats, a las de Meta Ads que gastan plata (presupuesto, prender campañas, conjuntos o anuncios, gasto nuevo) o a las que no pasaron las pruebas extra de su zona, y a las que ya estaban POR_REVISAR de antes: las demás las sube solo el Coordinador cuando todo pasa (quedan HECHO con el link del commit, o ERROR si algo falla). El bot de ventas, Meta Ads (sin gasto) y el libro V3 suben solos y el Coordinador los vigila 30 minutos. " +
      "texto_confirmacion es lo que dijo la persona, tal cual (tiene que decir 'sí' y 'apruebo'). Una tarjeta con la zona protegida de chats no se aprueba acá: solo en la pantalla (las de bot de ventas, Meta Ads y libro V3 sí se aprueban por voz). " +
      "PARA QUE ARRANQUE (regla del dueño 28-oct-2026, la misma que usa el Coordinador para tomarla): la tarea o el plan aprobados por voz cuentan igual que en la pantalla si la zona es SOLO chats y/o bot de ventas (o no hay zona). Si toca libro V3 o Meta Ads, la voz NO basta: queda aprobada pero el Coordinador no la toma hasta que el dueño la apruebe en la pantalla (la ficha muestra el botón 'Aprobar en pantalla' y queda una alerta del Coordinador). Avísale eso a la persona. " +
      "Aprueba la cuenta que creó la clave de Claude (no la que mira la pantalla): la cuenta dueña de este negocio o, hasta el 29-nov-2026 (periodo de prueba), la de Emanuel como aprobador de Sistemas: él aprueba la tarea, el plan y el sí final SOLO de tarjetas de Tecnología (CRM Ventas, Gestión, CRM Marketplace, Coordinador, General) y nunca las que tocan dinero de Gestión o Meta Ads (responde 'la aprueba Alexander'). Si no es ninguna, el error dice qué cuenta llegó y por qué." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero) o su código, por ejemplo T-123" },
        momento: { type: "string", enum: [...MOMENTOS_DE_APROBACION], description: "Qué se aprueba: tarea, plan o subir" },
        texto_confirmacion: {
          type: "string",
          description: "Lo que dijo la persona para aprobar, tal cual, por ejemplo 'sí, apruebo'. Mínimo 8 caracteres.",
        },
      },
      required: ["tarjeta_id", "momento", "texto_confirmacion"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
] as const;

const NOMBRES = new Set(HERRAMIENTAS_MCP_TABLEROS.map((herramienta) => herramienta.name));

export function esHerramientaDeTableros(nombre: string) {
  return NOMBRES.has(nombre as (typeof HERRAMIENTAS_MCP_TABLEROS)[number]["name"]);
}

const FECHA_BOGOTA = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  dateStyle: "medium",
  timeStyle: "short",
});
const DIA_BOGOTA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" });

const hora = (fecha: Date | null | undefined) => (fecha ? FECHA_BOGOTA.format(fecha) : null);
const dia = (iso: string | null) => (iso ? DIA_BOGOTA.format(new Date(iso)) : null);

function tipoParaClaude(tipo: TipoVista, nombres: Map<string, string>) {
  return {
    tipo_id: tipo.id,
    nombre: tipo.nombre,
    color: tipo.color,
    icono: tipo.icono,
    requiere_aprobacion: tipo.requiereAprobacion,
    usa_estados: tipo.usaEstados,
    puede_colgar_de: tipo.padres.map((id) => nombres.get(id) ?? id),
    orden: tipo.orden,
  };
}

/** Lo que sigue para una tarjeta, en una frase (para que Claude se lo cuente a la persona). */
function queFalta(estado: string, conRepo: boolean, conZona: boolean, hechoAMano?: { nota: string; commit: string | null; quien: string } | null): string {
  const dondeAprobar = conZona ? "en la pantalla (tiene zona protegida)" : "en la pantalla o diciéndolo aquí";
  switch (estado) {
    case "POR_APROBAR":
      return `Espera que el dueño apruebe la tarea, ${dondeAprobar}.`;
    case "APROBADO":
      return conRepo ? "Aprobada: el Coordinador la toma en el próximo minuto y arma el plan." : "Aprobada. Sin repo: no la ejecuta el Coordinador.";
    case "PLANEANDO":
      return "El Coordinador está escribiendo el plan.";
    case "PLAN_LISTO":
      return `El plan está listo y espera el sí del dueño (toca Meta Ads, tiene preguntas abiertas o un NECESITO, toca dinero de Gestión y la tarea pasó sola sin el sí del dueño, o 'Aprobar planes solo' está apagado), ${dondeAprobar}.`;
    case "PLAN_APROBADO":
      return "Plan aprobado: el Coordinador la toma en el próximo minuto y la construye en una rama.";
    case "EN_CURSO":
      return conRepo ? "El Coordinador la está construyendo y probando." : "En curso.";
    case "POR_REVISAR":
      return conZona
        ? "Lista en su rama: toca una zona protegida que pide el sí final (chats) o, en Meta Ads, algo que gasta plata (o le faltó una prueba extra de su zona), así que no sube sola. Espera el sí final del dueño; por voz con aprobar_tarjeta si es bot de ventas, Meta Ads o libro V3, en la pantalla si toca chats."
        : "Lista en su rama: espera el sí final del dueño para subir a producción.";
    case "SUBIENDO":
      return "El Coordinador la está subiendo a producción (sube sola si pasó todo, o el dueño dio el sí final). Si el despliegue falla, la deshace y queda ERROR.";
    case "HECHO":
      if (hechoAMano) {
        return `Marcada hecha a mano por el dueño (${hechoAMano.quien}): ${hechoAMano.nota}${hechoAMano.commit ? ` (commit ${hechoAMano.commit})` : ""}. No la subió el Coordinador.`;
      }
      return conRepo ? "Hecha: está en producción (ver resultado.subida, con el link del commit)." : "Hecha.";
    case "ERROR":
      return "Falló (ver resultado.error). El dueño puede reintentar: aprobar la tarea de nuevo (planea otra vez) o el plan (construye otra vez).";
    default:
      return "Nada pendiente del Coordinador.";
  }
}

const SIN_DUENO = "nadie (sin dueño)";

/** El campo `tablero` de cada respuesta: Claude repite este nombre (REGLA_DEL_TABLERO) y sabe de quién es. */
const referencia = (tablero: TableroDeReferencia | null) =>
  tablero ? { id: tablero.id, nombre: tablero.nombre, dueno: tablero.duenoNombre ?? SIN_DUENO } : null;

const datosDelTipo = (args: Argumentos) => ({
  nombre: args.nombre,
  color: args.color,
  icono: args.icono,
  requiereAprobacion: args.requiere_aprobacion,
  usaEstados: args.usa_estados,
  orden: args.orden,
  padres: args.padres,
});

export async function ejecutarHerramientaMcpTableros(
  nombre: string,
  argumentos: Argumentos,
  contextoMcp: Contexto,
): Promise<unknown> {
  // Todo lo que entra por acá queda anotado como hecho por Claude. La clave es del negocio: ve TODOS los
  // tableros (soloDe null), aunque los tableros sean por cuenta en la pantalla.
  const contexto: ContextoTablero = { ...contextoMcp, soloDe: null, origen: "MCP" };
  // Una tarjeta también se puede pedir por su código ("T-123"): se cambia por su id y todo sigue igual.
  const args: Argumentos =
    typeof argumentos.tarjeta_id === "string"
      ? { ...argumentos, tarjeta_id: await idDeTarjetaPorCodigo(contexto, argumentos.tarjeta_id) }
      : argumentos;

  switch (nombre) {
    case "listar_tableros": {
      const tableros = await listarTableros(contexto);
      return {
        tableros: tableros.map((tablero) => ({
          tablero_id: tablero.id,
          nombre: tablero.nombre,
          dueno: tablero.duenoNombre ?? SIN_DUENO,
          tarjetas: tablero.total,
          por_estado: tablero.porEstado,
          ultimo_cambio: hora(tablero.actualizadoEn),
          link: linkDelTablero(tablero.id),
        })),
        ...(tableros.length ? {} : { aviso: "Todavía no hay tableros. Crear uno con crear_tablero." }),
        ...(tableros.length > 1
          ? {
              nota: `Hay ${tableros.length} tableros (${tableros
                .map((tablero) => `${tablero.nombre}, de ${tablero.duenoNombre ?? SIN_DUENO}`)
                .join("; ")}): pregunta cuál antes de escribir.`,
            }
          : {}),
        estados: Object.entries(NOMBRE_DEL_ESTADO).map(([clave, texto]) => ({ clave, texto })),
        quien_aprueba:
          "El dueño del negocio (o un aprobador que él agregó), en la pantalla o con aprobar_tarjeta cuando lo dice explícitamente; solo tarjetas de un tipo que pide aprobación. El sí final (subir a producción) lo da solo el dueño; hasta el 29-nov-2026 también Emanuel (aprobador de Sistemas, periodo de prueba) en tarjetas de Tecnología que no tocan dinero ni Meta Ads. Las de la zona protegida de chats, solo en la pantalla.",
      };
    }
    case "crear_tablero": {
      const tablero = await crearTablero(contexto, args.nombre, args.dueno);
      return {
        ok: true,
        tablero: referencia(tablero),
        tablero_id: tablero.id,
        nombre: tablero.nombre,
        dueno: tablero.duenoNombre ?? SIN_DUENO,
        aviso:
          `Es de ${tablero.duenoNombre ?? SIN_DUENO}: esa persona lo ve en su pantalla (el dueño del negocio ve todos). ` +
          "Nació con los tipos Área (carpeta sin estado; puede ir dentro de otra Área), Idea (cuelga de un Área) y Tarea (cuelga de una Idea; la aprueba el dueño). Ver listar_tipos.",
        link: linkDelTablero(tablero.id),
      };
    }
    case "renombrar_tablero": {
      const tablero = await renombrarTablero(contexto, args.tablero_id, args.nombre, args.dueno);
      const igual = tablero.antes === tablero.nombre && tablero.duenoAntes === tablero.duenoNombre;
      return {
        ok: true,
        tablero: referencia(tablero),
        tablero_id: tablero.id,
        antes: tablero.antes,
        nombre: tablero.nombre,
        dueno: tablero.duenoNombre ?? SIN_DUENO,
        ...(tablero.duenoAntes !== tablero.duenoNombre ? { dueno_antes: tablero.duenoAntes ?? SIN_DUENO } : {}),
        ...(igual ? { aviso: "Ya era así: no cambió nada." } : {}),
        link: linkDelTablero(tablero.id),
      };
    }
    case "ver_tablero": {
      // ARCHIVADA no es un estado: trae solo las archivadas (siguen HECHO o FALLIDO) y no filtra más por estado.
      const soloArchivadas = args.estado === ESTADO_ARCHIVADA;
      const { tablero, tarjetas, conexiones, tipos } = await verTablero(contexto, args.tablero_id, { archivadas: soloArchivadas });
      const filtro = typeof args.estado === "string" && !soloArchivadas ? args.estado : null;
      const titulo = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta.titulo]));
      const tipoDe = new Map(tipos.map((tipo) => [tipo.id, tipo]));
      const nombres = new Map(tipos.map((tipo) => [tipo.id, tipo.nombre]));
      const hijas = contarHijas(tarjetas);
      const usaEstados = (tipoId: string) => tipoDe.get(tipoId)?.usaEstados ?? true;
      // Las carpetas (Área) no tienen estado: el filtro por estado no las trae.
      const porEstado = filtro
        ? tarjetas.filter((tarjeta) => usaEstados(tarjeta.tipoId) && tarjeta.estado === filtro)
        : tarjetas;
      // El filtro por responsable: una persona activa del negocio (nombre o email); si hay dudas, error.
      const pedidoResponsable = typeof args.responsable === "string" ? args.responsable.trim() : "";
      let filtroResponsable: { userId: string; nombre: string } | null = null;
      if (pedidoResponsable) {
        const elegido = elegirMiembro(await miembrosDelNegocio(contexto.workspaceId), pedidoResponsable, "responsable");
        if ("error" in elegido) throw new Error(elegido.error);
        filtroResponsable = { userId: elegido.miembro.userId, nombre: elegido.miembro.nombre };
      }
      const idDelFiltro: string | null = filtroResponsable ? filtroResponsable.userId : null;
      const visibles = idDelFiltro ? porEstado.filter((tarjeta) => tarjeta.responsableId === idDelFiltro) : porEstado;
      const ids = new Set(visibles.map((tarjeta) => tarjeta.id));
      return {
        tablero: referencia(tablero),
        tablero_id: tablero.id,
        nombre: tablero.nombre,
        total_tarjetas: tarjetas.length,
        ...(soloArchivadas
          ? { aviso: "Son las ARCHIVADAS: terminadas que ya salieron del tablero. Siguen HECHO o FALLIDO y no cuentan para el límite. Se devuelven al tablero con el botón Desarchivar de 'Trabajos terminados'." }
          : {}),
        tipos: tipos.map((tipo) => tipoParaClaude(tipo, nombres)),
        tarjetas: visibles.map((tarjeta) => {
          const tipo = tipoDe.get(tarjeta.tipoId);
          return {
            tarjeta_id: tarjeta.id,
            ...(tarjeta.codigo ? { codigo: tarjeta.codigo } : {}),
            titulo: tarjeta.titulo,
            tipo: tipo
              ? {
                  id: tipo.id,
                  nombre: tipo.nombre,
                  color: tipo.color,
                  icono: tipo.icono,
                  requiere_aprobacion: tipo.requiereAprobacion,
                  usa_estados: tipo.usaEstados,
                }
              : null,
            padre_id: tarjeta.padreId,
            padre_titulo: tarjeta.padreId ? (titulo.get(tarjeta.padreId) ?? null) : null,
            hijas: hijas.get(tarjeta.id) ?? 0,
            detalle: tarjeta.detalle || null,
            area: tarjeta.area,
            estado: usaEstados(tarjeta.tipoId) ? tarjeta.estado : null,
            responsable: tarjeta.responsableNombre,
            orden: tarjeta.orden,
            fecha: dia(tarjeta.fecha),
            link: tarjeta.link,
            link_texto: tarjeta.linkTexto,
            ...(tarjeta.repo
              ? {
                  repo: tarjeta.repo,
                  tiene_plan: Boolean(tarjeta.plan),
                  intentos: tarjeta.intentos,
                  riesgo: tarjeta.riesgo ?? "ALTO (sin riesgo puesto)",
                  ...(tarjeta.riesgoMotivo ? { motivo_riesgo: tarjeta.riesgoMotivo } : {}),
                }
              : {}),
            ...(tarjeta.zonaProtegida.length ? { zona_protegida: tarjeta.zonaProtegida } : {}),
          };
        }),
        conexiones: conexiones
          .filter((conexion) => (!filtro && !idDelFiltro) || ids.has(conexion.origenId) || ids.has(conexion.destinoId))
          .map((conexion) => ({
            de: conexion.origenId,
            de_titulo: titulo.get(conexion.origenId) ?? null,
            a: conexion.destinoId,
            a_titulo: titulo.get(conexion.destinoId) ?? null,
          })),
        link: linkDelTablero(tablero.id),
      };
    }
    case "listar_terminadas": {
      const semanaPedida = typeof args.semana === "string" && args.semana.trim() ? args.semana.trim() : DIA_BOGOTA.format(new Date());
      const tableroPedido = typeof args.tablero_id === "string" && args.tablero_id.trim() ? args.tablero_id.trim() : null;
      // El tablero pedido tiene que ser de este negocio (si no, "no existe").
      const tablero = tableroPedido ? (await verTablero(contexto, tableroPedido)).tablero : null;
      const { semana, tarjetas } = await terminadasDeLaSemana(contexto, semanaPedida, tablero?.id ?? null);
      return {
        semana: `del lunes ${semana.lunes} al domingo ${semana.domingo} (hora de Bogotá)`,
        ...(tablero ? { tablero: referencia(tablero) } : {}),
        total: tarjetas.length,
        hechas: tarjetas.filter((tarjeta) => tarjeta.estado === "HECHO").length,
        fallidas: tarjetas.filter((tarjeta) => tarjeta.estado === "FALLIDO").length,
        tarjetas: tarjetas.map((tarjeta) => ({
          tarjeta_id: tarjeta.id,
          ...(tarjeta.codigo ? { codigo: tarjeta.codigo } : {}),
          titulo: tarjeta.titulo,
          tablero: tarjeta.tableroNombre,
          estado: tarjeta.estado,
          terminada: hora(new Date(tarjeta.terminadaEn)),
          archivada: Boolean(tarjeta.archivadaEn),
          ...(tarjeta.repo ? { repo: tarjeta.repo } : {}),
          ...(tarjeta.commit ? { commit: tarjeta.commit } : {}),
          ...(tarjeta.linkCommit ? { link_commit: tarjeta.linkCommit } : {}),
        })),
        pantalla: "/cliente/tablero-ia?vista=terminados",
      };
    }
    case "listar_tipos": {
      const { tablero, tipos } = await listarTipos(contexto,args.tablero_id);
      const nombres = new Map(tipos.map((tipo) => [tipo.id, tipo.nombre]));
      return {
        tablero: referencia(tablero),
        tablero_id: tablero.id,
        nombre: tablero.nombre,
        tipos: tipos.map((tipo) => ({ ...tipoParaClaude(tipo, nombres), tarjetas: tipo.tarjetas })),
        iconos: [...ICONOS_DE_TIPO],
        aviso: "Sin tipo, una tarjeta nueva queda como Idea. Quitarle la aprobación a un tipo o borrarlo lo hace solo el dueño en la pantalla.",
      };
    }
    case "crear_tipo": {
      const { tipo, tablero } = await crearTipo(contexto, args.tablero_id, datosDelTipo(args));
      const { tipos } = await listarTipos(contexto,tablero.id);
      return {
        ok: true,
        tablero: referencia(tablero),
        ...tipoParaClaude(tipo, new Map(tipos.map((uno) => [uno.id, uno.nombre]))),
        link: linkDelTablero(tablero.id),
      };
    }
    case "editar_tipo": {
      const tablero = await tableroDelTipo(contexto,args.tipo_id);
      const { tipo, volvieronAIdea } = await editarTipo(contexto, args.tipo_id, datosDelTipo(args));
      return {
        ok: true,
        tablero: referencia(tablero),
        tipo_id: tipo.id,
        nombre: tipo.nombre,
        requiere_aprobacion: tipo.requiereAprobacion,
        ...(volvieronAIdea ? { aviso: `${volvieronAIdea} tarjeta(s) POR_APROBAR volvieron a IDEA.` } : {}),
      };
    }
    case "crear_tarjeta": {
      const resultado = await crearTarjeta(contexto, {
        tableroId: args.tablero_id,
        titulo: args.titulo,
        detalle: args.detalle,
        area: args.area,
        estado: args.estado,
        fecha: args.fecha,
        orden: args.orden,
        conectarCon: args.conectar_con,
        tipo: args.tipo,
        padreId: args.padre_id,
        link: args.link,
        linkTexto: args.link_texto,
        repo: args.repo,
        zonaProtegida: args.zona_protegida,
        riesgo: args.riesgo,
        motivoRiesgo: args.motivo_riesgo,
        responsable: args.responsable,
      });
      return {
        ok: true,
        tablero: referencia(resultado.tablero),
        tarjeta_id: resultado.tarjeta.id,
        ...(resultado.tarjeta.codigo ? { codigo: resultado.tarjeta.codigo } : {}),
        tipo: resultado.tipo.nombre,
        padre_id: resultado.tarjeta.padreId,
        estado: resultado.tipo.usaEstados ? resultado.tarjeta.estado : null,
        responsable: resultado.tarjeta.responsableNombre,
        ...(resultado.tarjeta.repo ? { repo: resultado.tarjeta.repo, riesgo: resultado.tarjeta.riesgo ?? "ALTO (sin riesgo puesto)" } : {}),
        ...(resultado.tarjeta.zonaProtegida.length ? { zona_protegida: resultado.tarjeta.zonaProtegida } : {}),
        ...(resultado.aprobacionAutomatica?.aprobada ? { aprobada_sola: true } : {}),
        cambio_id: resultado.cambioId,
        aviso: !resultado.tipo.usaEstados
          ? `Listo: es de tipo ${resultado.tipo.nombre}, una carpeta sin estado. Para ponerle cosas adentro, usar su tarjeta_id como padre_id.`
          : resultado.aprobacionAutomatica?.aprobada
            ? "Quedó APROBADA sola (regla del dueño 25-oct, o de bajo riesgo con el interruptor apagado): el trabajador la toma enseguida, sin pedirle permiso al dueño. Queda en el historial y en el resumen de las 9 p. m."
            : resultado.aprobacionAutomatica
              ? `No se aprobó sola (${resultado.aprobacionAutomatica.porQue}): quedó POR_APROBAR para el dueño.`
              : resultado.tarjeta.estado === "POR_APROBAR"
            ? "Quedó POR_APROBAR: el dueño la ve en la pantalla y la aprueba él."
            : resultado.tipo.requiereAprobacion
              ? "Quedó como IDEA. Cuando esté lista, pasarla a POR_APROBAR para que el dueño la apruebe."
              : `Quedó como IDEA. Las de tipo ${resultado.tipo.nombre} no pasan por aprobación.`,
        link: linkDeLaTarjeta(resultado.tarjeta.id),
      };
    }
    case "editar_tarjeta": {
      const tablero = await tableroDeLaTarjeta(contexto,args.tarjeta_id);
      if (args.urgente !== undefined && args.urgente !== true) throw new Error("urgente solo se puede marcar: va true.");
      const hayOtrosCambios = Object.entries(args).some(([campo, valor]) => campo !== "tarjeta_id" && campo !== "urgente" && valor !== undefined);
      if (args.urgente === true && !hayOtrosCambios) {
        const { yaEstaba } = await marcarUrgente(contexto, args.tarjeta_id);
        return {
          ok: true,
          tablero: referencia(tablero),
          tarjeta_id: args.tarjeta_id,
          urgente: true,
          aviso: yaEstaba
            ? "Ya estaba marcada como urgente."
            : "Marcada urgente. Si tiene responsable, en menos de un minuto le llega un WhatsApp que empieza por URGENTE (si los avisos al equipo están prendidos).",
          link: linkDeLaTarjeta(String(args.tarjeta_id)),
        };
      }
      const resultado = await editarTarjeta(contexto, args.tarjeta_id, {
        titulo: args.titulo,
        detalle: args.detalle,
        area: args.area,
        orden: args.orden,
        fecha: args.fecha,
        tipo: args.tipo,
        padreId: args.padre_id,
        link: args.link,
        linkTexto: args.link_texto,
        repo: args.repo,
        zonaProtegida: args.zona_protegida,
        riesgo: args.riesgo,
        motivoRiesgo: args.motivo_riesgo,
        responsable: args.responsable,
      });
      if (args.urgente === true) await marcarUrgente(contexto, args.tarjeta_id);
      const aviso = resultado.aprobacionAutomatica?.aprobada
        ? "Quedó APROBADA sola (regla del dueño 25-oct, o de bajo riesgo con el interruptor apagado): el trabajador la toma enseguida, sin pedirle permiso al dueño."
        : resultado.avisoDeRiesgo
          ? `${resultado.avisoDeRiesgo} Queda para el dueño.`
          : resultado.aprobacionAutomatica
            ? `No se aprobó sola (${resultado.aprobacionAutomatica.porQue}): queda POR_APROBAR para el dueño.`
            : null;
      const avisoBase = resultado.cambioDeTipo
        ? `Ahora es de tipo ${resultado.tipo.nombre} y quedó ${resultado.tipo.usaEstados ? resultado.tarjeta.estado : "sin estado"}${
            resultado.perdioAprobacion ? ": perdió la aprobación, hay que avisarle al dueño" : ""
          }.`
        : resultado.volvioAPorAprobar
          ? "Estaba APROBADA y cambió: volvió a POR_APROBAR. Hay que avisarle al dueño que la apruebe de nuevo."
          : resultado.perdioAprobacion
            ? "Estaba aprobada y cambió: volvió a POR_APROBAR. Hay que avisarle al dueño que la apruebe de nuevo."
            : "Listo. Para volver atrás: deshacer_cambio_tarjeta.";
      return {
        ok: true,
        tablero: referencia(tablero),
        tarjeta_id: resultado.tarjeta.id,
        ...(resultado.tarjeta.codigo ? { codigo: resultado.tarjeta.codigo } : {}),
        tipo: resultado.tipo.nombre,
        padre_id: resultado.tarjeta.padreId,
        estado: resultado.tipo.usaEstados ? resultado.tarjeta.estado : null,
        responsable: resultado.tarjeta.responsableNombre,
        repo: resultado.tarjeta.repo,
        riesgo: resultado.tarjeta.repo ? (resultado.tarjeta.riesgo ?? "ALTO (sin riesgo puesto)") : null,
        zona_protegida: resultado.tarjeta.zonaProtegida,
        ...(args.urgente === true ? { urgente: true } : {}),
        ...(resultado.aprobacionAutomatica?.aprobada ? { aprobada_sola: true } : {}),
        cambio_id: resultado.cambioId,
        aviso: aviso ? `${aviso} ${avisoBase}` : avisoBase,
        link: linkDeLaTarjeta(resultado.tarjeta.id),
      };
    }
    case "conectar_tarjetas": {
      const tablero = await tableroDeLaTarjeta(contexto,args.origen_id);
      const resultado = await conectarTarjetas(contexto, args.origen_id, args.destino_id, args.depende);
      return {
        ok: true,
        tablero: referencia(tablero),
        cambio_id: resultado.cambioId,
        aviso: resultado.conexion.esDependencia
          ? `Flecha de "${resultado.origen}" a "${resultado.destino}": "${resultado.destino}" espera a que "${resultado.origen}" esté HECHO.`
          : `Flecha de "${resultado.origen}" a "${resultado.destino}".`,
        link: linkDeLaTarjeta(resultado.conexion.origenId),
      };
    }
    case "cambiar_estado_tarjeta": {
      const tarjetaId = typeof args.tarjeta_id === "string" ? args.tarjeta_id : "";
      const tablero = await tableroDeLaTarjeta(contexto,tarjetaId);
      // HECHO a mano (tarjeta con repo en ERROR, FALLIDO o POR_REVISAR): el servidor revisa el texto del dueño,
      // la cuenta de la clave y la nota (services/reglas-trabajador.ts).
      const resultado = await cambiarEstadoTarjeta(contexto, tarjetaId, args.estado, {
        textoConfirmacion: args.texto_confirmacion,
        nota: args.nota,
        commit: args.commit,
      });
      const codigo = await codigoDeLaTarjeta(contexto, tarjetaId).catch(() => "");
      return {
        ok: true,
        tablero: referencia(tablero),
        ...(codigo ? { codigo } : {}),
        cambio_id: resultado.cambioId,
        antes: resultado.antes,
        ahora: resultado.ahora,
        aviso:
          resultado.aprobacionAutomatica?.aprobada
            ? "Quedó APROBADA sola (regla del dueño 25-oct, o de bajo riesgo con el interruptor apagado): el trabajador la toma enseguida."
            : resultado.ahora === "POR_APROBAR"
            ? "Quedó POR_APROBAR: el dueño la aprueba en la pantalla."
            : resultado.ahora === "HECHO" && sePuedeMarcarHechoAMano(resultado.antes)
            ? `"${resultado.titulo}" quedó marcada hecha a mano por el dueño (venía de ${resultado.antes}). ${
                resultado.antes === "FALLIDO" ? "Se puede deshacer con deshacer_cambio_tarjeta." : "No se puede deshacer desde acá: el dueño la reintenta o la marca Fallido."
              }`
            : `"${resultado.titulo}" pasó de ${resultado.antes} a ${resultado.ahora}.`,
        link: linkDeLaTarjeta(tarjetaId),
      };
    }
    case "borrar_tarjeta": {
      const tablero = await tableroDeLaTarjeta(contexto,args.tarjeta_id);
      // Por voz: el servidor revisa el texto de la persona, la cuenta de la clave y el estado (reglas.ts).
      const resultado = await borrarTarjeta(contexto, args.tarjeta_id, args.texto_confirmacion);
      return {
        ok: true,
        tablero: referencia(tablero),
        cambio_id: resultado.cambioId,
        ...(resultado.como ? { como: resultado.como } : {}),
        aviso: `Se borró "${resultado.titulo}" (${resultado.estado}) con ${resultado.flechas} flecha(s)${
          resultado.hijas ? `; sus ${resultado.hijas} hija(s) quedan sueltas` : ""
        }. Para traerla de vuelta: deshacer_cambio_tarjeta con este cambio_id.`,
      };
    }
    case "ver_historial_tarjeta": {
      const [{ tarjeta, cambios, borrada }, tablero] = await Promise.all([
        historialDeTarjeta(contexto,args.tarjeta_id),
        tableroDeLaTarjeta(contexto,args.tarjeta_id),
      ]);
      return {
        tablero: referencia(tablero),
        tarjeta_id: tarjeta.id,
        ...(tarjeta.codigo ? { codigo: tarjeta.codigo } : {}),
        titulo: tarjeta.titulo,
        estado: tarjeta.estado,
        ...(borrada ? { borrada: true } : {}),
        cambios: cambios.map((cambio) => ({
          cambio_id: cambio.id,
          cuando: hora(cambio.creadoEn),
          quien: cambio.quienNombre,
          desde:
            cambio.origen === "MCP"
              ? "Claude"
              : cambio.origen === "PANTALLA"
                ? "la pantalla"
                : cambio.origen === "TRABAJADOR"
                  ? "el Coordinador"
                  : cambio.origen,
          accion: cambio.accion,
          antes: cambio.antes,
          despues: cambio.despues,
          deshecho: cambio.deshechoEn ? hora(cambio.deshechoEn) : null,
        })),
      };
    }
    case "deshacer_cambio_tarjeta": {
      // Antes de deshacer: deshacer una creación saca la tarjeta y ya no se encontraría su tablero.
      const tablero = await tableroDelCambio(contexto,args.cambio_id);
      const resultado = await deshacerCambioTarjeta(contexto, args.cambio_id);
      return { ok: true, tablero: referencia(tablero), ...("cambioId" in resultado ? { cambio_id: resultado.cambioId } : {}), aviso: resultado.aviso };
    }
    case "ver_plan_y_resultado": {
      const [{ tarjeta, aprobaciones, hechoAMano }, tablero] = await Promise.all([
        planYResultado(contexto,args.tarjeta_id),
        tableroDeLaTarjeta(contexto,args.tarjeta_id),
      ]);
      const resultado = tarjeta.resultado;
      // Dónde se construyó (aizen1 o la nube de Claude) y el link de la sesión de la nube (25-oct-2026).
      const donde = dondeSeConstruyo(tarjeta.estado, resultado);
      return {
        tablero: referencia(tablero),
        tarjeta_id: tarjeta.id,
        ...(tarjeta.codigo ? { codigo: tarjeta.codigo } : {}),
        titulo: tarjeta.titulo,
        estado: tarjeta.estado,
        estado_texto: NOMBRE_DEL_ESTADO[tarjeta.estado],
        repo: tarjeta.repo,
        ...(donde ? { construida_en: donde.lugar === "nube" ? "la nube" : "aizen1", ...(donde.link ? { link_sesion: donde.link } : {}) } : {}),
        zona_protegida: tarjeta.zonaProtegida,
        ...(tarjeta.repo
          ? {
              riesgo: tarjeta.riesgo ?? "ALTO (sin riesgo puesto)",
              motivo_riesgo: tarjeta.riesgoMotivo,
              riesgo_puesto_por: tarjeta.riesgoPor,
            }
          : {}),
        intentos: tarjeta.intentos,
        plan: tarjeta.plan,
        resultado: resultado
          ? {
              resumen: resultado.resumen ?? null,
              pruebas: resultado.pruebas ?? null,
              paso: resultado.paso === true,
              sube_sola: resultado.subeSolo === true,
              rama: resultado.rama ?? null,
              link_rama: resultado.linkRama ?? null,
              commit: resultado.commit ?? null,
              migracion: resultado.migracion ?? null,
              ...(resultado.subida ? { subida: resultado.subida } : {}),
              ...(resultado.error && tarjeta.estado === "ERROR" ? { error: resultado.error } : {}),
            }
          : null,
        aprobaciones: aprobaciones.map((aprobacion) => ({
          momento: aprobacion.momento,
          que: esMomento(aprobacion.momento) ? NOMBRE_DEL_MOMENTO[aprobacion.momento] : aprobacion.momento,
          quien: aprobacion.quien,
          via: aprobacion.via,
          cuando: hora(new Date(aprobacion.cuando)),
          texto_confirmacion: aprobacion.textoConfirmacion,
          ...(aprobacion.automatica ? { aprobada_sola: true, motivo: aprobacion.motivo } : {}),
        })),
        ...(hechoAMano ? { hecho_a_mano: hechoAMano } : {}),
        que_falta: queFalta(tarjeta.estado, Boolean(tarjeta.repo), tarjeta.zonaProtegida.length > 0, hechoAMano),
        link: linkDeLaTarjeta(tarjeta.id),
      };
    }
    case "aprobar_tarjeta": {
      // La única puerta para aprobar desde Claude: el servidor revisa quién es (la clave), el estado,
      // el texto de la persona y la zona protegida (services/reglas-trabajador.ts).
      const tablero = await tableroDeLaTarjeta(contexto,args.tarjeta_id);
      const resultado = await aprobarTarjeta(contexto, args.tarjeta_id, {
        momento: typeof args.momento === "string" ? args.momento : "",
        via: "voz",
        textoConfirmacion: args.texto_confirmacion,
      });
      // 28-oct-2026: con libro V3 o Meta Ads la voz no basta para que el Coordinador la tome: se dice de una vez.
      const esperaLaPantalla = await esperaLaPantallaDeLaTarjeta(contexto, args.tarjeta_id).catch(() => null);
      const codigo = await codigoDeLaTarjeta(contexto, args.tarjeta_id).catch(() => "");
      return {
        ok: true,
        tablero: referencia(tablero),
        ...(codigo ? { codigo } : {}),
        cambio_id: resultado.cambioId,
        antes: resultado.antes,
        ahora: resultado.ahora,
        ...(esperaLaPantalla ? { espera_la_pantalla: `${esperaLaPantalla.texto}. El Coordinador no la toma hasta entonces.` } : {}),
        aviso: `Aprobado por voz con la cuenta ${resultado.quien}${resultado.quienCorreo ? ` (${resultado.quienCorreo})` : ""}: ${NOMBRE_DEL_MOMENTO[resultado.momento]} de "${resultado.titulo}". Quedó ${resultado.ahora}${
          resultado.ahora === "SUBIENDO" ? ": el Coordinador la sube a producción en el próximo minuto" : ""
        }. Una aprobación no se deshace.`,
        link: linkDeLaTarjeta(String(args.tarjeta_id ?? "")),
      };
    }
    case "ver_coordinador": {
      // Solo lectura: lo mismo que la pestaña "Coordinador en vivo", más el texto para leerlo por voz.
      const vista = await vistaDelCoordinador(contexto.workspaceId);
      return {
        resumen: textoDelCoordinador(vista),
        en_linea: vista.enLinea,
        ultimo_latido: vista.ultimoLatidoEn ? hora(new Date(vista.ultimoLatidoEn)) : null,
        ahora_mismo: vista.tareas.map((tarea) => ({
          tarjeta_id: tarea.tarjetaId,
          titulo: tarea.titulo,
          ...(tarea.agente ? { agente: tarea.agente } : {}),
          etapa: tarea.etapaTexto,
          donde: tarea.lugarTexto,
          modelo: tarea.modeloTexto,
          empezo: tarea.inicioEn ? hora(new Date(tarea.inicioEn)) : null,
          en_que_va: tarea.enQueVa,
          link: tarea.link,
          ...(tarea.linkSesion ? { link_sesion: tarea.linkSesion } : {}),
          ...(tarea.linkWorkflow ? { link_workflow: tarea.linkWorkflow } : {}),
          // 29-oct-2026: el paso (Plan → Construir → Revisar → Aprobar → Subido) y, en Revisar, los 4 revisores.
          paso: tarea.pasos.pasos.find((paso) => paso.clave === tarea.pasos.actual)?.nombre ?? null,
          necesita_humano: tarea.pasos.necesitaHumano,
          pasos: tarea.pasos.pasos.map((paso) => ({ paso: paso.nombre, estado: paso.estado })),
          revision: tarea.revision
            ? { vuelta: `R${tarea.revision.vuelta}`, revisores: tarea.revision.revisores.map((revisor) => ({ revisor: revisor.nombre, estado: revisor.estado })) }
            : null,
        })),
        carga_de_aizen1: vista.carga
          ? {
              semaforo: vista.carga.semaforo,
              procesador_porciento: vista.carga.cpu,
              memoria_usada_gb: vista.carga.memoriaUsadaGb,
              memoria_total_gb: vista.carga.memoriaTotalGb,
              disco_libre_gb: vista.carga.discoLibreGb,
              esperando_que_el_pc_se_desocupe: vista.carga.esperandoPc,
            }
          : null,
        // 31-oct-2026: el motivo, como en bloqueadas (null si no espera nada).
        fila: vista.fila.siguientes.map((item) => ({ tarjeta_id: item.tarjetaId, titulo: item.titulo, motivo: item.motivo, link: item.link })),
        bloqueadas: vista.fila.bloqueadas.map((item) => ({ tarjeta_id: item.tarjetaId, titulo: item.titulo, motivo: item.motivo, link: item.link })),
        en_error: {
          cantidad: vista.errores.cantidad,
          tarjetas: vista.errores.tarjetas.map((item) => ({ tarjeta_id: item.tarjetaId, titulo: item.titulo, linea_para_el_dueno: item.motivo, link: item.link })),
        },
        esperando_a_otra: {
          cantidad: vista.esperandoAOtra.cantidad,
          tarjetas: vista.esperandoAOtra.tarjetas.map((item) => ({ tarjeta_id: item.tarjetaId, titulo: item.titulo, esperando: item.motivo, link: item.link })),
        },
        hoy: {
          terminadas: vista.hoy.terminadas,
          falladas: vista.hoy.falladas,
          reparadas: vista.hoy.reparadas,
          trabajos: vista.hoy.trabajos.map((trabajo) => ({
            tarjeta_id: trabajo.tarjetaId,
            titulo: trabajo.titulo,
            resultado: trabajo.resultado === "terminada" ? "terminada" : "falló",
            duracion_minutos: trabajo.duracionMinutos,
            reparaciones: trabajo.reparaciones,
          })),
        },
        uso_de_claude: { limite_alcanzado: vista.uso.limiteAlcanzado, reinicia: vista.uso.reiniciaEn ? hora(new Date(vista.uso.reiniciaEn)) : null, texto: vista.uso.texto },
        pantalla: "/cliente/tablero-ia?vista=coordinador",
      };
    }
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
