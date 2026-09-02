"use server";

import { Prisma } from "@prisma/client";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import {
  CAMPOS_DE_FICHA,
  armarTranscripcion,
  buscarConIA,
  buscarPorReglas,
  fichaVacia,
  type CampoDeFicha,
  type FichaDeCotizacion,
  type Sugerencias,
  type TurnoDelChat,
} from "@/features/cotizaciones/services/datos-de-cotizacion";

/**
 * La ficha de datos para cotizar, guardada en el contacto.
 *
 * Vive en `Contact.metadata` y no en una tabla nueva porque son cinco casillas de texto que
 * pertenecen al cliente, no a una cotizacion en particular: el mismo cliente que compra dos veces
 * tiene la misma cedula y la misma direccion, y asi la segunda vez ya estan puestas.
 *
 * `city` y `address` son las MISMAS claves que usa la ficha de contacto de siempre. Es a
 * proposito: dos casillas con el mismo nombre y valores distintos es peor que no tenerlas, y
 * corregir la direccion en un lado tiene que corregirla en el otro.
 */
const CLAVE_ORIGENES = "quoteFieldSources";

/** De donde salio cada casilla, para poder mostrarlo al lado del dato. */
export type OrigenDeCampo = {
  origen: "chat" | "manual";
  /** La frase del cliente, cuando salio del chat. */
  frase?: string;
  fecha?: string | null;
};

export type Origenes = Partial<Record<CampoDeFicha, OrigenDeCampo>>;

export type FichaCargada = {
  ficha: FichaDeCotizacion;
  origenes: Origenes;
};

function leerTexto(metadata: unknown, clave: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }
  const valor = (metadata as Record<string, unknown>)[clave];
  return typeof valor === "string" ? valor : "";
}

function leerOrigenes(metadata: unknown): Origenes {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const crudo = (metadata as Record<string, unknown>)[CLAVE_ORIGENES];
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
    return {};
  }
  const origenes: Origenes = {};
  for (const campo of CAMPOS_DE_FICHA) {
    const item = (crudo as Record<string, unknown>)[campo.clave];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const registro = item as Record<string, unknown>;
    origenes[campo.clave] = {
      origen: registro.origen === "chat" ? "chat" : "manual",
      frase: typeof registro.frase === "string" ? registro.frase : undefined,
      fecha: typeof registro.fecha === "string" ? registro.fecha : null,
    };
  }
  return origenes;
}

/** Sesion + negocio + el contacto, verificando que sea de ESTE negocio. */
async function contexto(contactId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  await requireClientWorkspaceAccess("chats");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return null;
  }
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId: membership.workspace.id },
    select: { id: true, name: true, metadata: true },
  });
  if (!contact) {
    return null;
  }
  return { workspaceId: membership.workspace.id, contact };
}

export async function leerFichaDeCotizacionAction(
  contactId: string,
): Promise<{ datos?: FichaCargada; error?: string }> {
  const ctx = await contexto(contactId);
  if (!ctx) {
    return { error: "No autorizado" };
  }

  const metadata = ctx.contact.metadata;
  const ficha: FichaDeCotizacion = {
    // El nombre de WhatsApp sirve de arranque, pero no se da por bueno: para la factura hace
    // falta el nombre completo, y el de WhatsApp suele ser "Ana 💅" o el nombre del salon.
    fullName: leerTexto(metadata, "fullName") || ctx.contact.name || "",
    document: leerTexto(metadata, "document"),
    email: leerTexto(metadata, "email"),
    city: leerTexto(metadata, "city"),
    department: leerTexto(metadata, "department"),
    address: leerTexto(metadata, "address"),
    products: leerTexto(metadata, "products"),
  };

  return { datos: { ficha, origenes: leerOrigenes(metadata) } };
}

/**
 * Buscar en el chat los datos que faltan.
 *
 * NO guarda nada: devuelve propuestas. Quien atiende las ve con la frase del cliente al lado y
 * acepta las que estan bien. Es un toque por casilla contra tipear cinco campos, y una direccion
 * mal leida nunca entra sola.
 *
 * Solo se buscan los campos VACIOS: lo que alguien ya escribio a mano vale mas que lo que la IA
 * deduzca, y pisarlo seria borrar trabajo hecho.
 */
export async function buscarDatosEnElChatAction(input: {
  contactId: string;
  conversationId?: string;
}): Promise<{ sugerencias?: Sugerencias; sinDatos?: boolean; error?: string }> {
  const ctx = await contexto(input.contactId);
  if (!ctx) {
    return { error: "No autorizado" };
  }

  const actual = await leerFichaDeCotizacionAction(input.contactId);
  const ficha = actual.datos?.ficha ?? fichaVacia();
  const faltantes = CAMPOS_DE_FICHA.map((campo) => campo.clave).filter(
    (clave) => !ficha[clave].trim(),
  );
  if (faltantes.length === 0) {
    return { sugerencias: {} };
  }

  /*
    Se leen los mensajes del CONTACTO, no solo los de la conversacion abierta.

    El mismo cliente puede haber escrito por dos lineas distintas —o su chat pudo reabrirse como
    conversacion nueva—, y la cedula que dicto la semana pasada sigue siendo su cedula. Buscar
    solo en la conversacion abierta perderia justo los casos largos, que son los que se compran.

    Igual se suma la conversacion abierta: `Message.contactId` acepta nulos, y un mensaje que
    quedo sin contacto pegado se perderia aunque este a la vista en la pantalla.
  */
  const mensajes = await prisma.message.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [
        { contactId: ctx.contact.id },
        ...(input.conversationId ? [{ conversationId: input.conversationId }] : []),
      ],
      deletedAt: null,
      content: { not: null },
    },
    select: { direction: true, content: true, type: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  const turnos: TurnoDelChat[] = mensajes
    .reverse()
    .map((mensaje) => ({
      direction: mensaje.direction === "OUTBOUND" ? "OUTBOUND" : "INBOUND",
      content: mensaje.content,
      type: String(mensaje.type),
      createdAt: mensaje.createdAt,
    }));

  if (turnos.length === 0) {
    return { sugerencias: {}, sinDatos: true };
  }

  const porReglas = buscarPorReglas(turnos);
  const sugerencias: Sugerencias = {};
  for (const clave of faltantes) {
    const hallado = porReglas[clave];
    if (hallado) {
      sugerencias[clave] = hallado;
    }
  }

  // A la IA solo lo que quedo sin resolver: las reglas ya cubrieron cedula y ciudad gratis.
  const paraLaIA = faltantes.filter((clave) => !sugerencias[clave]);
  if (paraLaIA.length > 0) {
    try {
      const porIA = await buscarConIA({
        transcripcion: armarTranscripcion(turnos),
        faltantes: paraLaIA,
      });
      for (const [clave, dato] of Object.entries(porIA)) {
        sugerencias[clave as CampoDeFicha] = dato;
      }
    } catch (error) {
      /*
        Si la IA falla, se devuelve igual lo que encontraron las reglas.

        Cortar todo por un 429 de OpenAI dejaria sin la cedula —que no costo nada y ya estaba
        encontrada— a quien solo queria adelantar trabajo.
      */
      console.error("[ficha cotizacion] la IA no pudo leer el chat", error);
    }
  }

  return { sugerencias, sinDatos: Object.keys(sugerencias).length === 0 };
}

/** Guardar la ficha. Lo que viene de una sugerencia aceptada llega marcado como "chat". */
export async function guardarFichaDeCotizacionAction(input: {
  contactId: string;
  ficha: FichaDeCotizacion;
  origenes: Origenes;
}): Promise<{ ok?: true; error?: string }> {
  const ctx = await contexto(input.contactId);
  if (!ctx) {
    return { error: "No autorizado" };
  }

  const limites: Record<CampoDeFicha, number> = {
    fullName: 120,
    document: 30,
    email: 160,
    city: 120,
    department: 120,
    address: 200,
    products: 300,
  };

  const base =
    ctx.contact.metadata &&
    typeof ctx.contact.metadata === "object" &&
    !Array.isArray(ctx.contact.metadata)
      ? (ctx.contact.metadata as Record<string, unknown>)
      : {};

  const siguiente: Record<string, unknown> = { ...base };
  const origenes: Origenes = {};

  for (const campo of CAMPOS_DE_FICHA) {
    const valor = (input.ficha[campo.clave] ?? "").trim().slice(0, limites[campo.clave]);
    siguiente[campo.clave] = valor || null;
    if (!valor) {
      continue;
    }
    const origen = input.origenes[campo.clave];
    origenes[campo.clave] =
      origen?.origen === "chat"
        ? {
            origen: "chat",
            frase: origen.frase?.slice(0, 160) || undefined,
            fecha: origen.fecha ?? null,
          }
        : { origen: "manual" };
  }
  siguiente[CLAVE_ORIGENES] = origenes;

  await prisma.contact.update({
    where: { id: ctx.contact.id },
    data: { metadata: siguiente as Prisma.InputJsonValue },
  });

  return { ok: true };
}
