import { Prisma } from "@prisma/client";

import { hayBusqueda } from "@/lib/busqueda-de-chats";
import { prisma } from "@/lib/prisma";
import { sqlIdsNoLeidos, sqlIdsSinResponder } from "@/lib/ultimo-mensaje-de-chats";

import {
  DIAS_DE_NO_LEIDO,
  DIAS_DE_SIN_RESPONDER,
  GRUPO_POR_DEFECTO,
  SIN_ASIGNAR,
  condicionCompleta,
  limitesDeLaFecha,
  type CondicionDeBandeja,
  type FiltrosDeBandeja,
  type GrupoDeBandeja,
} from "../domain/filtros-de-bandeja";
import { leerConMemoria, type GuardadoEnMemoria } from "../domain/memoria-corta";
import type { ContactosInternos } from "./contactos-internos";

/**
 * Las consultas de los filtros de la bandeja.
 *
 * Lo que son los filtros y como se leen de la direccion vive en ../domain: eso lo comparte el
 * modal, que corre en el navegador y no puede arrastrar Prisma.
 */

export * from "../domain/filtros-de-bandeja";

const DIA_MS = 86_400_000;

/** ¿Hace falta pedir la lista de "sin responder"? (la condicion Sin responder, si o no) */
export function necesitaIdsSinResponder(filtros: FiltrosDeBandeja): boolean {
  return filtros.condiciones.some((c) => c.campo === "sin_responder");
}

/** ¿Hace falta pedir la lista de "no leidos"? (la condicion No leido) */
export function necesitaIdsNoLeidos(filtros: FiltrosDeBandeja): boolean {
  return filtros.condiciones.some((c) => c.campo === "no_leido");
}

/**
 * Los ids que piden algunas condiciones (se calculan aparte, en SQL). null = esa condicion no esta
 * puesta. Ver idsParaLosFiltros.
 */
export type IdsDeLosFiltros = { sinResponder: string[] | null; noLeidos: string[] | null };

/** Los mensajes del CLIENTE que cuentan (sin notas del sistema ni borrados). */
const DEL_CLIENTE: Prisma.MessageWhereInput = { direction: "INBOUND", type: { not: "SYSTEM" }, deletedAt: null };

function unaCondicion(
  c: CondicionDeBandeja,
  { sinResponder, noLeidos }: IdsDeLosFiltros,
  ahora: Date,
): Prisma.ConversationWhereInput {
  switch (c.campo) {
    /*
      La etapa y las etiquetas viven en la ficha del contacto. Cada condicion va en su propio
      elemento del AND: dos "tiene" son "tiene esta Y tiene esta otra", no se pisan.
    */
    case "etapa":
      return { contact: { crmStage: c.operador === "es" ? { in: c.valores } : { notIn: c.valores } } };
    case "etiquetas": {
      // Indexado: ContactTag tiene la llave (contactId, tagId).
      const filtro = { tagId: { in: c.valores } };
      return { contact: { ContactTag: c.operador === "tiene" ? { some: filtro } : { none: filtro } } };
    }
    case "asesora": {
      const ids = c.valores.filter((v) => v !== SIN_ASIGNAR);
      const sinAsignar = c.valores.includes(SIN_ASIGNAR);
      if (c.operador === "es") {
        const partes: Prisma.ConversationWhereInput[] = [];
        if (ids.length) partes.push({ assignedToUserId: { in: ids } });
        if (sinAsignar) partes.push({ assignedToUserId: null });
        return partes.length === 1 ? partes[0] : { OR: partes };
      }
      // "No es María": entran también los sin asignar (un NOT IN de SQL los dejaría afuera).
      const partes: Prisma.ConversationWhereInput[] = [];
      if (ids.length) partes.push({ OR: [{ assignedToUserId: null }, { assignedToUserId: { notIn: ids } }] });
      if (sinAsignar) partes.push({ assignedToUserId: { not: null } });
      return partes.length === 1 ? partes[0] : { AND: partes };
    }
    case "canal":
      return c.operador === "es"
        ? { channelId: { in: c.valores } }
        : { OR: [{ channelId: null }, { channelId: { notIn: c.valores } }] };
    case "fecha": {
      /*
        Sobre columnas de la conversacion con indice (workspaceId, lastMessageAt). Para "Llegó"
        (createdAt) se agrega ademas `lastMessageAt >= desde` —un chat que llego despues de "desde"
        tiene su ultimo mensaje despues—: no cambia el resultado y deja usar ese mismo indice.
      */
      const { desde, antesDe } = limitesDeLaFecha(c, ahora);
      const rango: Prisma.DateTimeFilter = { ...(desde ? { gte: desde } : {}), ...(antesDe ? { lt: antesDe } : {}) };
      if (c.sobre === "llego") return { createdAt: rango, ...(desde ? { lastMessageAt: { gte: desde } } : {}) };
      return { lastMessageAt: rango };
    }
    case "sin_responder": {
      const ids = sinResponder ?? [];
      return c.operador === "si" ? { id: { in: ids } } : ids.length ? { id: { notIn: ids } } : {};
    }
    case "no_leido":
      // Los ids de idsNoLeidos: sin la lista no entra ninguno, nunca todos.
      return { id: { in: noLeidos ?? [] } };
    case "dias_sin_responder": {
      // El cliente escribio alguna vez y nada suyo desde hace N dias (indice Message[conversationId, createdAt]).
      const corte = new Date(ahora.getTime() - c.dias * DIA_MS);
      return {
        AND: [
          { messages: { some: DEL_CLIENTE } },
          { messages: { none: { ...DEL_CLIENTE, createdAt: { gt: corte } } } },
        ],
      };
    }
  }
}

/**
 * Las condiciones como WHERE de Prisma (todas: Y). `ids`: lo de idsParaLosFiltros. Una lista sola
 * se toma como los ids de "Sin responder" (como se llamaba antes).
 */
export function whereDeFiltros(
  filtros: FiltrosDeBandeja,
  ids: IdsDeLosFiltros | string[] | null = null,
  ahora = new Date(),
): Prisma.ConversationWhereInput {
  const todos: IdsDeLosFiltros = Array.isArray(ids) || ids === null ? { sinResponder: ids, noLeidos: null } : ids;
  const partes = filtros.condiciones.filter(condicionCompleta).map((c) => unaCondicion(c, todos, ahora));
  return partes.length ? { AND: partes } : {};
}

/* ------------------------------------------------------------------------------------------------
   EL GRUPO (clientes / equipo / proveedores / todos). Que es: ../domain/filtros-de-bandeja.
   La misma regla la aplica la linea oficial en SQL (fragmentosDeFiltrosOficiales): las dos leen
   `reglaDelGrupo` para no separarse.
------------------------------------------------------------------------------------------------ */

/**
 * El grupo que de verdad filtra: con texto en el buscador ninguno ("todos"), para que buscar a
 * alguien del equipo o a un proveedor lo encuentre igual.
 */
export function grupoQueAplica(filtros: FiltrosDeBandeja, q: string | null | undefined): GrupoDeBandeja {
  if (hayBusqueda(q)) return "todos";
  return filtros.grupo ?? GRUPO_POR_DEFECTO;
}

export type ReglaDelGrupo =
  | { tipo: "nada" }
  /** Solo estos: equipo o proveedores. */
  | { tipo: "solo"; de: "equipo" | "proveedores" }
  /** Clientes: sin el equipo y/o sin los proveedores. */
  | { tipo: "sin"; equipo: boolean; proveedores: boolean };

/** ¿Hay una condicion "Etiquetas tiene" con alguna de estas etiquetas? */
function pideLaEtiqueta(filtros: FiltrosDeBandeja, etiquetas: readonly string[]): boolean {
  if (!etiquetas.length) return false;
  return filtros.condiciones.some(
    (c) => c.campo === "etiquetas" && c.operador === "tiene" && c.valores.some((v) => etiquetas.includes(v)),
  );
}

/**
 * Lo que hace el grupo, sin la base. En "clientes" los proveedores se sacan solo en "Mias" (un jefe
 * en Todas los sigue viendo), y una condicion "Etiquetas tiene EQUIPO/PROVEEDOR" desactiva la
 * exclusion de ese tipo: una lista guardada "con PROVEEDOR" sigue trayendo a los proveedores.
 */
export function reglaDelGrupo(input: {
  grupo: GrupoDeBandeja;
  internos: Pick<ContactosInternos, "etiquetasEquipoIds" | "etiquetasProveedorIds"> | null;
  asignacion: string;
  filtros: FiltrosDeBandeja;
}): ReglaDelGrupo {
  if (input.grupo === "todos" || !input.internos) return { tipo: "nada" };
  if (input.grupo === "equipo" || input.grupo === "proveedores") return { tipo: "solo", de: input.grupo };
  const equipo = !pideLaEtiqueta(input.filtros, input.internos.etiquetasEquipoIds);
  const proveedores =
    input.asignacion === "mine" && !pideLaEtiqueta(input.filtros, input.internos.etiquetasProveedorIds);
  return equipo || proveedores ? { tipo: "sin", equipo, proveedores } : { tipo: "nada" };
}

/**
 * El grupo como WHERE de Prisma, para WhatsApp normal. `internos` es null cuando el grupo que
 * aplica es "todos" (no hace falta leerlos). `asignacion`: la ya forzada a "mine" para asesoras.
 */
export function whereDeGrupo(input: {
  grupo: GrupoDeBandeja;
  internos: ContactosInternos | null;
  asignacion: string;
  filtros: FiltrosDeBandeja;
}): Prisma.ConversationWhereInput {
  const regla = reglaDelGrupo(input);
  const internos = input.internos;
  if (regla.tipo === "nada" || !internos) return {};
  if (regla.tipo === "solo") {
    return { contactId: { in: regla.de === "equipo" ? internos.equipoIds : internos.proveedorIds } };
  }
  const fuera = [
    ...(regla.equipo ? internos.equipoIds : []),
    ...(regla.proveedores ? internos.proveedorIds : []),
  ];
  // Un NOT IN vacio no saca a nadie: mejor no escribirlo.
  return fuera.length ? { contactId: { notIn: fuera } } : {};
}

type QuienPideIds = {
  workspaceId: string;
  visibleChannelIds: string[] | null;
  /** El canal elegido en la bandeja, si hay uno. */
  channelId?: string | null;
};

/** Los ids que piden las condiciones puestas, en paralelo (solo las que estan puestas). */
export async function idsParaLosFiltros(filtros: FiltrosDeBandeja, input: QuienPideIds): Promise<IdsDeLosFiltros> {
  const [sinResponder, noLeidos] = await Promise.all([
    necesitaIdsSinResponder(filtros) ? idsSinResponder(input) : null,
    necesitaIdsNoLeidos(filtros) ? idsNoLeidos(input) : null,
  ]);
  return { sinResponder, noLeidos };
}

/**
 * Menos que la de "sin responder": abrir un chat lo saca de No leido, y el numero de la pastilla
 * (cada 60 s) tiene que notarlo en el siguiente ciclo.
 */
const VIDA_DE_LA_CACHE_NO_LEIDOS_MS = 20_000;
const cacheNoLeidos = new Map<string, GuardadoEnMemoria<string[]>>();

/**
 * Las conversaciones de WhatsApp normal con mensajes del cliente que nadie abrio (el globo verde
 * de la fila). La linea oficial va aparte, en su propia consulta (sqlOficialNoLeido).
 *
 * Mismo patron que idsSinResponder: SQL que devuelve solo ids, con una memoria corta. Mira solo
 * los ultimos DIAS_DE_NO_LEIDO dias y no abre el rawPayload (ver sqlIdsNoLeidos).
 */
export async function idsNoLeidos(input: QuienPideIds): Promise<string[]> {
  const clave = JSON.stringify([
    input.workspaceId,
    input.visibleChannelIds ? [...input.visibleChannelIds].sort() : null,
    input.channelId ?? "",
  ]);
  // La pagina, /list y /counts piden a la vez: el que llega con la consulta en curso la espera.
  return leerConMemoria(cacheNoLeidos, clave, VIDA_DE_LA_CACHE_NO_LEIDOS_MS, async () => {
    const canales = input.channelId ? [input.channelId] : input.visibleChannelIds;
    const filas = await prisma.$queryRaw<Array<{ conversationId: string }>>(
      sqlIdsNoLeidos({ workspaceId: input.workspaceId, canales, dias: DIAS_DE_NO_LEIDO }),
    );
    return filas.map((fila) => fila.conversationId);
  });
}

/** La respuesta se reusa un minuto: la bandeja se recarga sola y esta consulta no es barata. */
const VIDA_DE_LA_CACHE_MS = 60_000;
const cacheSinResponder = new Map<string, GuardadoEnMemoria<string[]>>();

/**
 * Las conversaciones donde el ULTIMO que hablo fue el cliente.
 *
 * Es la lista con la que deberia empezar el dia una asesora, y hoy hay que buscarla a ojo.
 *
 * No se puede pedir con Prisma: "el ultimo mensaje es entrante" compara un dato de la conversacion
 * con uno de sus mensajes, y eso no se escribe en su lenguaje. Va en SQL y devuelve solo ids, que
 * despues entran como una condicion mas en cada una de las cuatro consultas de la bandeja.
 *
 * Se resuelve comparando DOS fechas por conversacion —la ultima entrante contra la ultima
 * saliente— en una sola pasada agrupada. Escrito de la forma evidente (un "no existe una saliente
 * posterior a la ultima entrante" por conversacion) tardaba 108 segundos contra la base de
 * verdad; asi tarda menos de dos decimas.
 *
 * Una saliente que fallo (status FAILED) tampoco: no le llego al cliente. El bot, los seguimientos
 * y los envios automaticos SI cuentan. La regla completa: ../domain/sin-responder.ts; el SQL vive
 * en src/lib/ultimo-mensaje-de-chats.ts para poder probarlo en PGlite (check-sin-responder.mjs).
 *
 * Las notas internas y de actividad NO cuentan como respuesta: se guardan como salientes, y la
 * nota de auto-asignacion es una de ellas, asi que sin excluirlas toda conversacion nueva
 * figuraria como ya contestada. Todas son de tipo SYSTEM, y por eso alcanza con mirar el tipo:
 * revisar en cambio el `source` del rawPayload obligaba a abrir 30.000 payloads enteros y era el
 * verdadero costo de la consulta (63 segundos de los 108).
 *
 * Se mira SOLO lo de los ultimos DIAS_DE_SIN_RESPONDER dias. Un mensaje sin contestar de hace
 * medio año no es trabajo pendiente de hoy, y ademas es lo que mantiene la consulta rapida.
 */
export async function idsSinResponder(input: {
  workspaceId: string;
  visibleChannelIds: string[] | null;
  /** El canal elegido en la bandeja, si hay uno. */
  channelId?: string | null;
}): Promise<string[]> {
  const clave = JSON.stringify([
    input.workspaceId,
    input.visibleChannelIds ? [...input.visibleChannelIds].sort() : null,
    input.channelId ?? "",
  ]);
  return leerConMemoria(cacheSinResponder, clave, VIDA_DE_LA_CACHE_MS, async () => {
    const canales = input.channelId
      ? [input.channelId]
      : input.visibleChannelIds;

    const filas = await prisma.$queryRaw<Array<{ conversationId: string }>>(
      sqlIdsSinResponder({ workspaceId: input.workspaceId, canales, dias: DIAS_DE_SIN_RESPONDER }),
    );
    return filas.map((fila) => fila.conversationId);
  });
}
