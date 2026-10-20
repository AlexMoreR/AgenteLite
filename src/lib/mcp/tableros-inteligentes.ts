import {
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
  verTablero,
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

/*
  TABLERO IA (tableros inteligentes) por el MCP (fase 1, 19-oct-2026).

  El dueño conversa con Claude y Claude anota las ideas en un tablero: tarjetas unidas con flechas.
  El dueño las ve como un mapa en /cliente/tablero-ia (pantalla "Tablero IA") y las aprueba con un botón.

  Cada tablero tiene TIPOS de tarjeta (nace con Área, Idea y Tarea; Claude puede crear y editar más
  con crear_tipo / editar_tipo). Solo las tarjetas de un tipo que pide aprobación pasan por
  POR_APROBAR y APROBADO. Los tipos sin estados (usa_estados = false, como Área) son carpetas: sus
  tarjetas no tienen estado (ver_tablero devuelve estado null). Una tarjeta puede colgar de una tarjeta madre (padre_id) si el tipo lo
  permite, y llevar un link.

  Lo que Claude NO puede hacer, por diseño:
  - Aprobar. No hay herramienta para eso, ningún inputSchema ofrece APROBADO y el servicio igual lo
    rechaza (reglas.ts). `aprobarTarjeta` del servicio no se importa en este archivo.
  - Ejecutar algo sin aprobar: EN_CURSO solo sale de APROBADO (en tipos que piden aprobación).
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

export const HERRAMIENTAS_MCP_TABLEROS = [
  {
    name: "listar_tableros",
    title: "Ver los tableros de ideas",
    description:
      "Muestra los tableros de ideas del negocio, con cuántas tarjetas hay en cada estado. Empezar por acá para tener los ids. Si no hay ninguno, crear uno con crear_tablero.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "crear_tablero",
    title: "Crear un tablero de ideas",
    description:
      "Crea un tablero nuevo, por ejemplo uno por tema ('Ventas', 'Producción', 'Marketing'). Nace con 3 tipos de tarjeta: Área (una carpeta sin estado; puede ir dentro de otra Área), Idea (cuelga de un Área) y Tarea (cuelga de una Idea y la aprueba el dueño). Antes mirar listar_tableros para no repetir uno que ya existe.",
    inputSchema: {
      type: "object",
      properties: { nombre: { type: "string", description: "Nombre corto del tablero: 'Ventas'" } },
      required: ["nombre"],
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
      "Crea un tipo de tarjeta nuevo en un tablero (por ejemplo 'Proyecto' que cuelga de un 'Área'). Si requiere_aprobacion es true, sus tarjetas pasan por POR_APROBAR y las aprueba el dueño.",
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
      "Cambia el nombre, color, ícono, orden, de qué tipos puede colgar, si tiene estados, o le pone aprobación a un tipo. Se manda solo lo que cambia. NO puede quitarle la aprobación a un tipo (eso lo hace solo el dueño en la pantalla), ni quitarle los estados si alguna de sus tarjetas tiene un estado distinto de IDEA. No quita un 'padre' que alguna tarjeta está usando.",
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
      "Agrega una tarjeta (un área, una idea, una tarea...) al tablero. Sin tipo queda como Idea. Puede colgar de otra tarjeta (padre_id) si su tipo lo permite (Área > Idea > Tarea; un Área también dentro de otra Área). Queda IDEA, o POR_APROBAR si su tipo pide aprobación y ya está lista para que el dueño la mire. Un Área no lleva estado. Aprobarla lo hace solo el dueño en la pantalla.",
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
      "Cambia el título, el detalle, el tipo, de qué tarjeta cuelga, el área, la fecha, el orden o el link de una tarjeta. Se manda solo lo que cambia. Si estaba APROBADA, vuelve a POR_APROBAR. Si se le cambia el tipo, queda POR_APROBAR (tipo con aprobación) o IDEA (sin aprobación): pierde la aprobación que tuviera.",
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
      "Une dos tarjetas del mismo tablero con una flecha que sale de la primera y llega a la segunda (por ejemplo: 'esto lleva a esto' o 'esto depende de esto'). Para decir 'esto es parte de esto' se usa padre_id, no una flecha.",
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
      "Mueve una tarjeta de estado. NO puede aprobar: eso lo hace solo el dueño en la pantalla. Para pedir aprobación, dejarla POR_APROBAR (solo tipos con aprobación). En tipos con aprobación, EN_CURSO solo sale de una APROBADA, y HECHO o FALLIDO de una APROBADA o EN_CURSO. Los tipos sin aprobación van libres entre IDEA, EN_CURSO, HECHO y FALLIDO. Las tarjetas de un tipo sin estados (Área) no tienen estado: se rechaza.",
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
      "Saca una tarjeta del tablero en un solo paso, con TODAS sus flechas (no hay que borrarlas aparte). Se puede deshacer con deshacer_cambio_tarjeta y vuelve con sus flechas. Sus hijas quedan sueltas hasta que se deshaga. No borra una tarjeta APROBADA ni EN_CURSO: eso lo decide el dueño.",
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
      "Deja la tarjeta como estaba antes de ese cambio (deshacer una creación la saca del tablero; deshacer un borrado la devuelve con sus flechas). No deshace lo que hizo el dueño en la pantalla, no quita ni devuelve una aprobación, y si después hubo otro cambio sobre lo mismo, avisa y no toca nada.",
    inputSchema: {
      type: "object",
      properties: { cambio_id: { type: "string", description: "Id del cambio (ver ver_historial_tarjeta)" } },
      required: ["cambio_id"],
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
  // Todo lo que entra por acá queda anotado como hecho por Claude.
  const contexto: ContextoTablero = { ...contextoMcp, origen: "MCP" };

  switch (nombre) {
    case "listar_tableros": {
      const tableros = await listarTableros(contexto.workspaceId);
      return {
        tableros: tableros.map((tablero) => ({
          tablero_id: tablero.id,
          nombre: tablero.nombre,
          tarjetas: tablero.total,
          por_estado: tablero.porEstado,
          ultimo_cambio: hora(tablero.actualizadoEn),
          link: linkDelTablero(tablero.id),
        })),
        ...(tableros.length ? {} : { aviso: "Todavía no hay tableros. Crear uno con crear_tablero." }),
        estados: Object.entries(NOMBRE_DEL_ESTADO).map(([clave, texto]) => ({ clave, texto })),
        quien_aprueba:
          "Solo el dueño del negocio (o el administrador de la plataforma), con el botón Aprobar de la pantalla, y solo tarjetas de un tipo que pide aprobación.",
      };
    }
    case "crear_tablero": {
      const tablero = await crearTablero(contexto, args.nombre);
      return {
        ok: true,
        tablero_id: tablero.id,
        nombre: tablero.nombre,
        aviso:
          "Nació con los tipos Área (carpeta sin estado; puede ir dentro de otra Área), Idea (cuelga de un Área) y Tarea (cuelga de una Idea; la aprueba el dueño). Ver listar_tipos.",
        link: linkDelTablero(tablero.id),
      };
    }
    case "ver_tablero": {
      const { tablero, tarjetas, conexiones, tipos } = await verTablero(contexto.workspaceId, args.tablero_id);
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
      const { tablero, tipos } = await listarTipos(contexto.workspaceId, args.tablero_id);
      const nombres = new Map(tipos.map((tipo) => [tipo.id, tipo.nombre]));
      return {
        tablero_id: tablero.id,
        nombre: tablero.nombre,
        tipos: tipos.map((tipo) => ({ ...tipoParaClaude(tipo, nombres), tarjetas: tipo.tarjetas })),
        iconos: [...ICONOS_DE_TIPO],
        aviso: "Sin tipo, una tarjeta nueva queda como Idea. Quitarle la aprobación a un tipo o borrarlo lo hace solo el dueño en la pantalla.",
      };
    }
    case "crear_tipo": {
      const { tipo, tablero } = await crearTipo(contexto, args.tablero_id, datosDelTipo(args));
      const { tipos } = await listarTipos(contexto.workspaceId, tablero.id);
      return {
        ok: true,
        ...tipoParaClaude(tipo, new Map(tipos.map((uno) => [uno.id, uno.nombre]))),
        link: linkDelTablero(tablero.id),
      };
    }
    case "editar_tipo": {
      const { tipo, volvieronAIdea } = await editarTipo(contexto, args.tipo_id, datosDelTipo(args));
      return {
        ok: true,
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
      });
      return {
        ok: true,
        tarjeta_id: resultado.tarjeta.id,
        tipo: resultado.tipo.nombre,
        padre_id: resultado.tarjeta.padreId,
        estado: resultado.tipo.usaEstados ? resultado.tarjeta.estado : null,
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
      });
      const aviso = resultado.cambioDeTipo
        ? `Ahora es de tipo ${resultado.tipo.nombre} y quedó ${resultado.tipo.usaEstados ? resultado.tarjeta.estado : "sin estado"}${
            resultado.perdioAprobacion ? ": perdió la aprobación, hay que avisarle al dueño" : ""
          }.`
        : resultado.volvioAPorAprobar
          ? "Estaba APROBADA y cambió: volvió a POR_APROBAR. Hay que avisarle al dueño que la apruebe de nuevo."
          : "Listo. Para volver atrás: deshacer_cambio_tarjeta.";
      return {
        ok: true,
        tarjeta_id: resultado.tarjeta.id,
        tipo: resultado.tipo.nombre,
        padre_id: resultado.tarjeta.padreId,
        estado: resultado.tipo.usaEstados ? resultado.tarjeta.estado : null,
        cambio_id: resultado.cambioId,
        aviso,
        link: linkDeLaTarjeta(resultado.tarjeta.id),
      };
    }
    case "conectar_tarjetas": {
      const resultado = await conectarTarjetas(contexto, args.origen_id, args.destino_id);
      return {
        ok: true,
        cambio_id: resultado.cambioId,
        aviso: `Flecha de "${resultado.origen}" a "${resultado.destino}".`,
        link: linkDeLaTarjeta(resultado.conexion.origenId),
      };
    }
    case "cambiar_estado_tarjeta": {
      const tarjetaId = typeof args.tarjeta_id === "string" ? args.tarjeta_id : "";
      const resultado = await cambiarEstadoTarjeta(contexto, tarjetaId, args.estado);
      return {
        ok: true,
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
      const resultado = await borrarTarjeta(contexto, args.tarjeta_id);
      return {
        ok: true,
        cambio_id: resultado.cambioId,
        aviso: `Se borró "${resultado.titulo}" con ${resultado.flechas} flecha(s)${
          resultado.hijas ? `; sus ${resultado.hijas} hija(s) quedan sueltas` : ""
        }. Para traerla de vuelta: deshacer_cambio_tarjeta con este cambio_id.`,
      };
    }
    case "ver_historial_tarjeta": {
      const { tarjeta, cambios, borrada } = await historialDeTarjeta(contexto.workspaceId, args.tarjeta_id);
      return {
        tarjeta_id: tarjeta.id,
        titulo: tarjeta.titulo,
        estado: tarjeta.estado,
        ...(borrada ? { borrada: true } : {}),
        cambios: cambios.map((cambio) => ({
          cambio_id: cambio.id,
          cuando: hora(cambio.creadoEn),
          quien: cambio.quienNombre,
          desde: cambio.origen === "MCP" ? "Claude" : cambio.origen === "PANTALLA" ? "la pantalla" : cambio.origen,
          accion: cambio.accion,
          antes: cambio.antes,
          despues: cambio.despues,
          deshecho: cambio.deshechoEn ? hora(cambio.deshechoEn) : null,
        })),
      };
    }
    case "deshacer_cambio_tarjeta": {
      const resultado = await deshacerCambioTarjeta(contexto, args.cambio_id);
      return { ok: true, ...("cambioId" in resultado ? { cambio_id: resultado.cambioId } : {}), aviso: resultado.aviso };
    }
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
