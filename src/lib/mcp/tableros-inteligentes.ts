import {
  aprobarTarjeta,
  borrarTarjeta,
  cambiarEstadoTarjeta,
  conectarTarjetas,
  crearTablero,
  crearTarjeta,
  crearTipo,
  deshacerCambioTarjeta,
  editarTarjeta,
  editarTipo,
  historialDeTarjeta,
  linkDeLaTarjeta,
  linkDelTablero,
  listarTableros,
  listarTipos,
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
} from "@/features/tableros-inteligentes/services/reglas";
import { contarHijas } from "@/features/tableros-inteligentes/services/niveles";
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

  Fase 2 (20-oct-2026): las tarjetas con `repo` (gestion, aizencrm) las ejecuta el TRABAJADOR (un PC
  aparte): arma un plan, el dueño lo aprueba, lo construye en una rama, el dueño da el sí final y lo
  sube. ver_plan_y_resultado muestra todo eso; aprobar_tarjeta aprueba la tarea, el plan o el sí final
  SOLO cuando la persona lo dijo explícitamente en la conversación.

  Lo que Claude NO puede hacer, por diseño:
  - Aprobar por su cuenta. La única puerta es aprobar_tarjeta: el servidor exige un texto de
    confirmación de la persona ("sí, apruebo"), que el userId de la clave sea el dueño o un aprobador
    con alcance, que el estado corresponda, y rechaza las tarjetas con zona protegida (esas, solo en la
    pantalla). El sí final (subir) es solo del dueño. Ningún inputSchema de cambiar_estado_tarjeta
    ofrece APROBADO ni los estados del trabajador.
  - Ejecutar algo sin aprobar: EN_CURSO solo sale de APROBADO (en tipos que piden aprobación); en
    tarjetas con repo, EN_CURSO, HECHO y los demás estados del trabajador los pone solo el trabajador.
  - Quitar una zona protegida (solo ponerla).
  - Dejar intacta una aprobación al editar: si edita una tarjeta APROBADA, vuelve a POR_APROBAR; si
    le cambia el tipo, queda POR_APROBAR o IDEA.
  - Quitarle la aprobación a un tipo, ni borrar tipos (solo el dueño en la pantalla).
  - Borrar una tarjeta APROBADA o EN_CURSO.
  - Deshacer una aprobación, ni dejar algo APROBADO deshaciendo.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const BORRA = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

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
    "Si es un cambio de código que hace el TRABAJADOR: en qué repositorio (gestion = ventas y cotizaciones; aizencrm = este CRM). Solo tipos con aprobación (Tarea). Sin repo, el trabajador no la toma. Opcional.",
} as const;

const PROPIEDAD_ZONA = {
  type: "array",
  items: { type: "string", enum: [...ZONAS_PROTEGIDAS] },
  description:
    "Zonas protegidas que toca: META_ADS (anuncios), BOT_VENTAS (el bot que atiende), LIBRO_V3 (el libro del agente V3). Una tarjeta con zona protegida se aprueba SOLO en la pantalla. Opcional.",
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
      "Muestra las tarjetas de un tablero (título, detalle, tipo, de qué tarjeta cuelga, área, estado, fecha, link) con qué flechas las unen, y los tipos del tablero. Hay que llamarla antes de editar o conectar: devuelve los ids.",
    inputSchema: {
      type: "object",
      properties: {
        tablero_id: { type: "string", description: "Id del tablero (ver listar_tableros)" },
        estado: { type: "string", enum: [...ESTADOS_TARJETA], description: "Solo las tarjetas en este estado. Opcional." },
      },
      required: ["tablero_id"],
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
      "Agrega una tarjeta (un área, una idea, una tarea...) al tablero. Sin tipo queda como Idea. Puede colgar de otra tarjeta (padre_id) si su tipo lo permite (Área > Idea > Tarea; un Área también dentro de otra Área). Queda IDEA, o POR_APROBAR si su tipo pide aprobación y ya está lista para que el dueño la mire. Un Área no lleva estado. Si es un cambio de código que debe hacer el trabajador, poner repo (gestion o aizencrm; solo tipos con aprobación, como Tarea) y, si toca Meta Ads, el bot de ventas o el libro V3, zona_protegida. Aprobarla lo hace el dueño (en la pantalla, o con aprobar_tarjeta si lo dice explícitamente)." +
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
      "Cambia el título, el detalle, el tipo, de qué tarjeta cuelga, el área, la fecha, el orden, el link, el repo o la zona protegida de una tarjeta. Se manda solo lo que cambia. Si estaba aprobada (APROBADO, o con el trabajador: PLAN_LISTO, PLAN_APROBADO, POR_REVISAR, ERROR), vuelve a POR_APROBAR. Mientras el trabajador la tiene (PLANEANDO, EN_CURSO, SUBIENDO) no se edita. Si se le cambia el tipo, queda POR_APROBAR (tipo con aprobación) o IDEA (sin aprobación): pierde la aprobación que tuviera. La zona protegida se puede agregar, no quitar (eso solo el dueño en la pantalla)." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero)" },
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
      "Mueve una tarjeta de estado. NO aprueba (para eso está aprobar_tarjeta, solo si la persona lo dice) y no pone ningún estado del trabajador (PLANEANDO, PLAN_LISTO, PLAN_APROBADO, POR_REVISAR, SUBIENDO, ERROR). Para pedir aprobación, dejarla POR_APROBAR (solo tipos con aprobación). En tipos con aprobación y SIN repo, EN_CURSO solo sale de una APROBADA, y HECHO de una APROBADA o EN_CURSO; en tarjetas CON repo, EN_CURSO y HECHO los pone solo el trabajador, y mientras él la tiene no se mueve. FALLIDO (abandonarla) sale de algo aprobado o de lo que dejó el trabajador. Los tipos sin aprobación van libres entre IDEA, EN_CURSO, HECHO y FALLIDO. Las tarjetas de un tipo sin estados (Área) no tienen estado: se rechaza." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero)" },
        estado: { type: "string", enum: [...ESTADOS_SIN_APROBAR] },
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
      "Saca una tarjeta del tablero en un solo paso, con TODAS sus flechas (no hay que borrarlas aparte). Se puede deshacer con deshacer_cambio_tarjeta y vuelve con sus flechas. Sus hijas quedan sueltas hasta que se deshaga. No borra una tarjeta APROBADA ni EN_CURSO: eso lo decide el dueño." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: { tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero)" } },
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
      properties: { tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero)" } },
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
    title: "Ver el plan y el resultado del trabajador",
    description:
      "Muestra en qué va una tarjeta que ejecuta el trabajador: estado, repo, zona protegida, el plan que escribió, el resultado (resumen, pruebas, si pasó, la rama con su link, commit, migración, la subida o el error con su motivo) y quién aprobó qué (la tarea, el plan, el sí final), cuándo y por dónde (pantalla o voz). Llamarla antes de aprobar_tarjeta para poder leerle a la persona lo que aprueba.",
    inputSchema: {
      type: "object",
      properties: { tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero)" } },
      required: ["tarjeta_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "aprobar_tarjeta",
    title: "Aprobar una tarjeta (solo si la persona lo dijo)",
    description:
      "Úsala SOLO si la persona lo dijo explícitamente en esta conversación. Antes, léele el título y qué se aprueba, y espera que diga 'sí, apruebo'. Nunca apruebes por tu cuenta. " +
      "momento: 'tarea' (una tarjeta POR_APROBAR; o reintentar desde ERROR, planeando de nuevo), 'plan' (el plan del trabajador, PLAN_LISTO; o reintentar desde ERROR con el mismo plan) o 'subir' (el sí final para subir a producción, POR_REVISAR con todo pasado; solo el dueño). " +
      "texto_confirmacion es lo que dijo la persona, tal cual (tiene que decir 'sí' y 'apruebo'). Una tarjeta con zona protegida no se aprueba acá: solo en la pantalla. " +
      "Aprueba la cuenta que creó la clave de Claude (no la que mira la pantalla): tiene que ser la cuenta dueña de este negocio. Si no lo es, el error dice qué cuenta llegó y por qué." +
      REGLA_DEL_TABLERO,
    inputSchema: {
      type: "object",
      properties: {
        tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero)" },
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
function queFalta(estado: string, conRepo: boolean, conZona: boolean): string {
  const dondeAprobar = conZona ? "en la pantalla (tiene zona protegida)" : "en la pantalla o diciéndolo aquí";
  switch (estado) {
    case "POR_APROBAR":
      return `Espera que el dueño apruebe la tarea, ${dondeAprobar}.`;
    case "APROBADO":
      return conRepo ? "Aprobada: el trabajador la toma en el próximo minuto y arma el plan." : "Aprobada. Sin repo: no la ejecuta el trabajador.";
    case "PLANEANDO":
      return "El trabajador está escribiendo el plan.";
    case "PLAN_LISTO":
      return `El plan está listo: espera que el dueño lo apruebe, ${dondeAprobar}.`;
    case "PLAN_APROBADO":
      return "Plan aprobado: el trabajador la toma en el próximo minuto y la construye en una rama.";
    case "EN_CURSO":
      return conRepo ? "El trabajador la está construyendo y probando." : "En curso.";
    case "POR_REVISAR":
      return "Lista en su rama: espera el sí final del dueño para subir a producción.";
    case "SUBIENDO":
      return "El dueño dio el sí final: el trabajador la está subiendo a producción.";
    case "HECHO":
      return "Hecha.";
    case "ERROR":
      return "Falló (ver resultado.error). El dueño puede reintentar: aprobar la tarea de nuevo (planea otra vez) o el plan (construye otra vez).";
    default:
      return "Nada pendiente del trabajador.";
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
  args: Argumentos,
  contextoMcp: Contexto,
): Promise<unknown> {
  // Todo lo que entra por acá queda anotado como hecho por Claude. La clave es del negocio: ve TODOS los
  // tableros (soloDe null), aunque los tableros sean por cuenta en la pantalla.
  const contexto: ContextoTablero = { ...contextoMcp, soloDe: null, origen: "MCP" };

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
          "El dueño del negocio (o un aprobador que él agregó), en la pantalla o con aprobar_tarjeta cuando lo dice explícitamente; solo tarjetas de un tipo que pide aprobación. El sí final (subir a producción) lo da solo el dueño. Las de zona protegida, solo en la pantalla.",
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
      const { tablero, tarjetas, conexiones, tipos } = await verTablero(contexto,args.tablero_id);
      const filtro = typeof args.estado === "string" ? args.estado : null;
      const titulo = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta.titulo]));
      const tipoDe = new Map(tipos.map((tipo) => [tipo.id, tipo]));
      const nombres = new Map(tipos.map((tipo) => [tipo.id, tipo.nombre]));
      const hijas = contarHijas(tarjetas);
      const usaEstados = (tipoId: string) => tipoDe.get(tipoId)?.usaEstados ?? true;
      // Las carpetas (Área) no tienen estado: el filtro por estado no las trae.
      const visibles = filtro
        ? tarjetas.filter((tarjeta) => usaEstados(tarjeta.tipoId) && tarjeta.estado === filtro)
        : tarjetas;
      const ids = new Set(visibles.map((tarjeta) => tarjeta.id));
      return {
        tablero: referencia(tablero),
        tablero_id: tablero.id,
        nombre: tablero.nombre,
        total_tarjetas: tarjetas.length,
        tipos: tipos.map((tipo) => tipoParaClaude(tipo, nombres)),
        tarjetas: visibles.map((tarjeta) => {
          const tipo = tipoDe.get(tarjeta.tipoId);
          return {
            tarjeta_id: tarjeta.id,
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
            orden: tarjeta.orden,
            fecha: dia(tarjeta.fecha),
            link: tarjeta.link,
            link_texto: tarjeta.linkTexto,
            ...(tarjeta.repo
              ? { repo: tarjeta.repo, tiene_plan: Boolean(tarjeta.plan), intentos: tarjeta.intentos }
              : {}),
            ...(tarjeta.zonaProtegida.length ? { zona_protegida: tarjeta.zonaProtegida } : {}),
          };
        }),
        conexiones: conexiones
          .filter((conexion) => !filtro || ids.has(conexion.origenId) || ids.has(conexion.destinoId))
          .map((conexion) => ({
            de: conexion.origenId,
            de_titulo: titulo.get(conexion.origenId) ?? null,
            a: conexion.destinoId,
            a_titulo: titulo.get(conexion.destinoId) ?? null,
          })),
        link: linkDelTablero(tablero.id),
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
      });
      return {
        ok: true,
        tablero: referencia(resultado.tablero),
        tarjeta_id: resultado.tarjeta.id,
        tipo: resultado.tipo.nombre,
        padre_id: resultado.tarjeta.padreId,
        estado: resultado.tipo.usaEstados ? resultado.tarjeta.estado : null,
        ...(resultado.tarjeta.repo ? { repo: resultado.tarjeta.repo } : {}),
        ...(resultado.tarjeta.zonaProtegida.length ? { zona_protegida: resultado.tarjeta.zonaProtegida } : {}),
        cambio_id: resultado.cambioId,
        aviso: !resultado.tipo.usaEstados
          ? `Listo: es de tipo ${resultado.tipo.nombre}, una carpeta sin estado. Para ponerle cosas adentro, usar su tarjeta_id como padre_id.`
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
      });
      const aviso = resultado.cambioDeTipo
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
        tipo: resultado.tipo.nombre,
        padre_id: resultado.tarjeta.padreId,
        estado: resultado.tipo.usaEstados ? resultado.tarjeta.estado : null,
        repo: resultado.tarjeta.repo,
        zona_protegida: resultado.tarjeta.zonaProtegida,
        cambio_id: resultado.cambioId,
        aviso,
        link: linkDeLaTarjeta(resultado.tarjeta.id),
      };
    }
    case "conectar_tarjetas": {
      const tablero = await tableroDeLaTarjeta(contexto,args.origen_id);
      const resultado = await conectarTarjetas(contexto, args.origen_id, args.destino_id);
      return {
        ok: true,
        tablero: referencia(tablero),
        cambio_id: resultado.cambioId,
        aviso: `Flecha de "${resultado.origen}" a "${resultado.destino}".`,
        link: linkDeLaTarjeta(resultado.conexion.origenId),
      };
    }
    case "cambiar_estado_tarjeta": {
      const tarjetaId = typeof args.tarjeta_id === "string" ? args.tarjeta_id : "";
      const tablero = await tableroDeLaTarjeta(contexto,tarjetaId);
      const resultado = await cambiarEstadoTarjeta(contexto, tarjetaId, args.estado);
      return {
        ok: true,
        tablero: referencia(tablero),
        cambio_id: resultado.cambioId,
        antes: resultado.antes,
        ahora: resultado.ahora,
        aviso:
          resultado.ahora === "POR_APROBAR"
            ? "Quedó POR_APROBAR: el dueño la aprueba en la pantalla."
            : `"${resultado.titulo}" pasó de ${resultado.antes} a ${resultado.ahora}.`,
        link: linkDeLaTarjeta(tarjetaId),
      };
    }
    case "borrar_tarjeta": {
      const tablero = await tableroDeLaTarjeta(contexto,args.tarjeta_id);
      const resultado = await borrarTarjeta(contexto, args.tarjeta_id);
      return {
        ok: true,
        tablero: referencia(tablero),
        cambio_id: resultado.cambioId,
        aviso: `Se borró "${resultado.titulo}" con ${resultado.flechas} flecha(s)${
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
                  ? "el trabajador"
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
      const [{ tarjeta, aprobaciones }, tablero] = await Promise.all([
        planYResultado(contexto,args.tarjeta_id),
        tableroDeLaTarjeta(contexto,args.tarjeta_id),
      ]);
      const resultado = tarjeta.resultado;
      return {
        tablero: referencia(tablero),
        tarjeta_id: tarjeta.id,
        titulo: tarjeta.titulo,
        estado: tarjeta.estado,
        estado_texto: NOMBRE_DEL_ESTADO[tarjeta.estado],
        repo: tarjeta.repo,
        zona_protegida: tarjeta.zonaProtegida,
        intentos: tarjeta.intentos,
        plan: tarjeta.plan,
        resultado: resultado
          ? {
              resumen: resultado.resumen ?? null,
              pruebas: resultado.pruebas ?? null,
              paso: resultado.paso === true,
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
        })),
        que_falta: queFalta(tarjeta.estado, Boolean(tarjeta.repo), tarjeta.zonaProtegida.length > 0),
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
      return {
        ok: true,
        tablero: referencia(tablero),
        cambio_id: resultado.cambioId,
        antes: resultado.antes,
        ahora: resultado.ahora,
        aviso: `Aprobado por voz con la cuenta ${resultado.quien}${resultado.quienCorreo ? ` (${resultado.quienCorreo})` : ""}: ${NOMBRE_DEL_MOMENTO[resultado.momento]} de "${resultado.titulo}". Quedó ${resultado.ahora}${
          resultado.ahora === "SUBIENDO" ? ": el trabajador la sube a producción en el próximo minuto" : ""
        }. Una aprobación no se deshace.`,
        link: linkDeLaTarjeta(String(args.tarjeta_id ?? "")),
      };
    }
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
