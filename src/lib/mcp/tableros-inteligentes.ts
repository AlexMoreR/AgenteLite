import {
  cambiarEstadoTarjeta,
  conectarTarjetas,
  crearTablero,
  crearTarjeta,
  deshacerCambioTarjeta,
  editarTarjeta,
  historialDeTarjeta,
  linkDeLaTarjeta,
  linkDelTablero,
  listarTableros,
  verTablero,
  type ContextoTablero,
} from "@/features/tableros-inteligentes/services/tableros";
import { ESTADOS_AL_CREAR, ESTADOS_SIN_APROBAR, ESTADOS_TARJETA, NOMBRE_DEL_ESTADO } from "@/features/tableros-inteligentes/services/reglas";

/*
  TABLERO IA (tableros inteligentes) por el MCP (fase 1, 19-oct-2026).

  El dueño conversa con Claude y Claude anota las ideas en un tablero: tarjetas unidas con flechas.
  El dueño las ve como un mapa en /cliente/tablero-ia (pantalla "Tablero IA") y las aprueba con un botón.

  Lo que Claude NO puede hacer, por diseño:
  - Aprobar. No hay herramienta para eso, ningún inputSchema ofrece APROBADO y el servicio igual lo
    rechaza (reglas.ts). `aprobarTarjeta` del servicio no se importa en este archivo.
  - Ejecutar algo sin aprobar: EN_CURSO solo sale de APROBADO.
  - Dejar intacta una aprobación al editar: si edita una tarjeta APROBADA, vuelve a POR_APROBAR.
  - Deshacer una aprobación, ni dejar algo APROBADO deshaciendo.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

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
      "Crea un tablero nuevo, por ejemplo uno por tema ('Ventas', 'Producción', 'Marketing'). Antes mirar listar_tableros para no repetir uno que ya existe.",
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
      "Muestra las tarjetas de un tablero (título, detalle, área, estado, fecha) y qué flechas las unen. Hay que llamarla antes de editar o conectar: devuelve los ids.",
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
    name: "crear_tarjeta",
    title: "Agregar una idea",
    description:
      "Agrega una tarjeta (una idea, tarea o propuesta) al tablero. Queda como IDEA, o POR_APROBAR si ya está lista para que el dueño la mire. Aprobarla lo hace solo el dueño en la pantalla.",
    inputSchema: {
      type: "object",
      properties: {
        tablero_id: { type: "string", description: "Id del tablero (ver listar_tableros)" },
        titulo: { type: "string", description: "Corto y claro: 'Responder en menos de 15 minutos'" },
        detalle: { type: "string", description: "Qué es, por qué y cómo se mediría. Opcional." },
        area: { type: "string", description: "Ventas, Marketing, Operación... Opcional." },
        estado: { type: "string", enum: [...ESTADOS_AL_CREAR], description: "IDEA (por defecto) o POR_APROBAR" },
        fecha: { type: "string", description: "Para cuándo, AAAA-MM-DD. Opcional." },
        orden: { type: "number", description: "Posición dentro de la lista (menor = primero). Opcional." },
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
      "Cambia el título, el detalle, el área, la fecha o el orden de una tarjeta. Se manda solo lo que cambia. Si la tarjeta estaba APROBADA, vuelve a POR_APROBAR: el dueño tiene que aprobar el texto nuevo.",
    inputSchema: {
      type: "object",
      properties: {
        tarjeta_id: { type: "string", description: "Id de la tarjeta (ver ver_tablero)" },
        titulo: { type: "string" },
        detalle: { type: "string" },
        area: { type: "string", description: "Vacío para quitarla" },
        fecha: { type: "string", description: "AAAA-MM-DD, o vacío para quitarla" },
        orden: { type: "number" },
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
      "Une dos tarjetas del mismo tablero con una flecha que sale de la primera y llega a la segunda (por ejemplo: 'esto lleva a esto' o 'esto depende de esto').",
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
      "Mueve una tarjeta de estado. NO puede aprobar: eso lo hace solo el dueño en la pantalla. Para pedir aprobación, dejarla POR_APROBAR. EN_CURSO solo sale de una APROBADA, y HECHO o FALLIDO de una APROBADA o EN_CURSO.",
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
    name: "ver_historial_tarjeta",
    title: "Historial de una tarjeta",
    description:
      "Quién cambió la tarjeta, cuándo, desde dónde (Claude o la pantalla) y qué tenía antes. Devuelve el id de cada cambio para deshacer.",
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
      "Deja la tarjeta como estaba antes de ese cambio (deshacer una creación la saca del tablero). No deshace lo que hizo el dueño en la pantalla, no quita ni devuelve una aprobación, y si después hubo otro cambio sobre lo mismo, avisa y no toca nada.",
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
        quien_aprueba: "Solo el dueño del negocio (o el administrador de la plataforma), con el botón Aprobar de la pantalla.",
      };
    }
    case "crear_tablero": {
      const tablero = await crearTablero(contexto, args.nombre);
      return { ok: true, tablero_id: tablero.id, nombre: tablero.nombre, link: linkDelTablero(tablero.id) };
    }
    case "ver_tablero": {
      const { tablero, tarjetas, conexiones } = await verTablero(contexto.workspaceId, args.tablero_id);
      const filtro = typeof args.estado === "string" ? args.estado : null;
      const titulo = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta.titulo]));
      const visibles = filtro ? tarjetas.filter((tarjeta) => tarjeta.estado === filtro) : tarjetas;
      const ids = new Set(visibles.map((tarjeta) => tarjeta.id));
      return {
        tablero_id: tablero.id,
        nombre: tablero.nombre,
        total_tarjetas: tarjetas.length,
        tarjetas: visibles.map((tarjeta) => ({
          tarjeta_id: tarjeta.id,
          titulo: tarjeta.titulo,
          detalle: tarjeta.detalle || null,
          area: tarjeta.area,
          estado: tarjeta.estado,
          orden: tarjeta.orden,
          fecha: dia(tarjeta.fecha),
        })),
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
      });
      return {
        ok: true,
        tarjeta_id: resultado.tarjeta.id,
        estado: resultado.tarjeta.estado,
        cambio_id: resultado.cambioId,
        aviso:
          resultado.tarjeta.estado === "POR_APROBAR"
            ? "Quedó POR_APROBAR: el dueño la ve en la pantalla y la aprueba él."
            : "Quedó como IDEA. Cuando esté lista, pasarla a POR_APROBAR para que el dueño la apruebe.",
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
      });
      return {
        ok: true,
        tarjeta_id: resultado.tarjeta.id,
        estado: resultado.tarjeta.estado,
        cambio_id: resultado.cambioId,
        aviso: resultado.volvioAPorAprobar
          ? "Estaba APROBADA y cambió: volvió a POR_APROBAR. Hay que avisarle al dueño que la apruebe de nuevo."
          : "Listo. Para volver atrás: deshacer_cambio_tarjeta.",
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
    case "ver_historial_tarjeta": {
      const { tarjeta, cambios } = await historialDeTarjeta(contexto.workspaceId, args.tarjeta_id);
      return {
        tarjeta_id: tarjeta.id,
        titulo: tarjeta.titulo,
        estado: tarjeta.estado,
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
