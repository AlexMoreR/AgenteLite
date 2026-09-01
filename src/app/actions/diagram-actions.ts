"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import {
  fundirChatEnMapa,
  pasosLiteralesDelChat,
} from "@/features/diagramas/services/mapa-de-caminos";

/**
 * Diagramas: mapas mentales para pensar el negocio.
 *
 * Son PRIVADOS de quien los creó. Todas las consultas filtran por autor además de por negocio: un
 * mapa mental a medio pensar no es un documento del equipo, y encontrarse el borrador de otro en
 * la lista es la forma más rápida de que nadie vuelva a escribir nada honesto ahí.
 */

async function contexto() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  await requireClientWorkspaceAccess("diagramas");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return null;
  }
  return { userId: session.user.id, workspaceId: membership.workspace.id };
}

export async function crearDiagramaAction(
  titulo?: string,
): Promise<{ id?: string; error?: string }> {
  const ctx = await contexto();
  if (!ctx) {
    return { error: "No autorizado" };
  }

  const creado = await prisma.diagram.create({
    data: {
      workspaceId: ctx.workspaceId,
      createdById: ctx.userId,
      title: titulo?.trim().slice(0, 120) || "Sin título",
    },
    select: { id: true },
  });

  revalidatePath("/cliente/diagramas");
  return { id: creado.id };
}

/**
 * Guardar el lienzo.
 *
 * Se guarda ENTERO en cada pasada, no por diferencias: un mapa mental es chico (decenas de cajas)
 * y calcular qué cambió costaría más que reescribirlo. El límite de tamaño evita que un pegado
 * accidental de algo enorme quede atascado intentando guardarse para siempre.
 */
export async function guardarDiagramaAction(input: {
  id: string;
  titulo?: string;
  data?: unknown;
}): Promise<{ ok?: true; error?: string }> {
  const ctx = await contexto();
  if (!ctx) {
    return { error: "No autorizado" };
  }

  const propio = await prisma.diagram.findFirst({
    where: { id: input.id?.trim(), workspaceId: ctx.workspaceId, createdById: ctx.userId },
    select: { id: true },
  });
  if (!propio) {
    return { error: "Diagrama no encontrado" };
  }

  if (input.data !== undefined) {
    const peso = JSON.stringify(input.data ?? null).length;
    if (peso > 2_000_000) {
      return { error: "El diagrama es demasiado grande para guardarse." };
    }
  }

  await prisma.diagram.update({
    where: { id: propio.id },
    data: {
      ...(input.titulo === undefined ? {} : { title: input.titulo.trim().slice(0, 120) || "Sin título" }),
      ...(input.data === undefined ? {} : { data: input.data as Prisma.InputJsonValue }),
    },
  });

  revalidatePath("/cliente/diagramas");
  return { ok: true };
}

export async function borrarDiagramaAction(id: string): Promise<{ ok?: true; error?: string }> {
  const ctx = await contexto();
  if (!ctx) {
    return { error: "No autorizado" };
  }

  // Se borra buscando por AUTOR, no solo por id: un id prestado no puede borrar el mapa de otro.
  const propio = await prisma.diagram.findFirst({
    where: { id: id?.trim(), workspaceId: ctx.workspaceId, createdById: ctx.userId },
    select: { id: true },
  });
  if (!propio) {
    return { error: "Diagrama no encontrado" };
  }

  await prisma.diagram.delete({ where: { id: propio.id } });
  revalidatePath("/cliente/diagramas");
  return { ok: true };
}

/* ------------------------------------------------ el mapa de caminos de los clientes */

/** Donde queda anotado cual es el mapa comun y que chats ya entraron. */
function claveDelMapa(workspaceId: string) {
  return `diagramas:mapaDeCaminos:${workspaceId}`;
}

/**
 * La version del formato de las cajas.
 *
 * El primer mapa guardaba pasos resumidos por IA ("Pregunta precio"), el segundo los mensajes
 * cortados a 180 caracteres, y este los guarda enteros. Mezclarlos en el mismo arbol da un mapa
 * que no se entiende -mitad resumen, mitad frase cortada-, asi que al cambiar el formato se
 * empieza uno nuevo y el anterior queda en la lista de Diagramas por si se quiere mirar.
 */
const FORMATO_ACTUAL = "detalle-2";

type EstadoDelMapa = { diagramId: string; chats: string[]; formato?: string };

async function leerEstadoDelMapa(workspaceId: string): Promise<EstadoDelMapa | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDelMapa(workspaceId) } });
  if (!fila?.value) {
    return null;
  }
  try {
    const datos = JSON.parse(fila.value) as Partial<EstadoDelMapa>;
    if (typeof datos.diagramId !== "string") {
      return null;
    }
    return {
      diagramId: datos.diagramId,
      chats: Array.isArray(datos.chats) ? datos.chats : [],
      formato: typeof datos.formato === "string" ? datos.formato : "",
    };
  } catch {
    return null;
  }
}

/**
 * Suma un chat al mapa de caminos.
 *
 * Todos los chats caen en el MISMO diagrama y los pasos iguales se funden en una caja. Un chat
 * dibujado solo son cuarenta cajas que no se comparan con nada; treinta chats fundidos dicen "24
 * preguntan precio, 18 piden envio, 3 compran", que es donde se ve por donde se cae la venta.
 *
 * Solo dueño/admin: cada chat cuesta una llamada a la IA, y esto se enciende para ver si sirve
 * antes de dejarlo suelto para todo el equipo.
 *
 * La lista de chats ya incluidos vive en AppSetting y NO dentro del diagrama, a proposito: el
 * lienzo se guarda solo cada vez que alguien mueve una caja, y guarda unicamente nodos y aristas.
 * Guardada ahi, la lista se borraria la primera vez que alguien tocara el mapa y el mismo chat se
 * contaria dos veces.
 */
export async function agregarChatAlMapaDeCaminosAction(input: {
  conversationId: string;
}): Promise<{ diagramId?: string; pasos?: number; yaEstaba?: true; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "No autorizado" };
  }
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return { error: "Solo el dueño puede armar el mapa de caminos" };
  }

  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    return { error: "Conversación inválida" };
  }

  const conversacion = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: membership.workspace.id },
    select: {
      id: true,
      contact: { select: { name: true, phoneNumber: true } },
      messages: {
        where: { deletedAt: null, isStatusBroadcast: false, type: { not: "SYSTEM" } },
        orderBy: { createdAt: "asc" },
        take: 120,
        select: { direction: true, content: true, type: true },
      },
    },
  });
  if (!conversacion) {
    return { error: "No encontré ese chat" };
  }

  /*
    El chat AL DETALLE, no un resumen.

    Antes esto armaba una transcripcion y le pedia a la IA que la resumiera en pasos genericos
    ("Pregunta precio"). Alex lo probo y pidio lo contrario: quiere ver lo que se hablo, mensaje
    por mensaje. De paso deja de costar plata, deja de tardar y deja de poder equivocarse.
  */
  const pasos = pasosLiteralesDelChat(conversacion.messages);
  if (pasos.length === 0) {
    return { error: "Ese chat no tiene mensajes para dibujar" };
  }

  const guardado = await leerEstadoDelMapa(membership.workspace.id);
  // Un mapa de otro formato no se toca: se empieza uno nuevo.
  const estado = guardado?.formato === FORMATO_ACTUAL ? guardado : null;
  if (estado?.chats.includes(conversacion.id)) {
    return { diagramId: estado.diagramId, yaEstaba: true };
  }


  // El diagrama del mapa: el guardado, o uno nuevo si nunca se armo (o si lo borraron).
  const existente = estado
    ? await prisma.diagram.findFirst({
        where: { id: estado.diagramId, workspaceId: membership.workspace.id },
        select: { id: true, data: true },
      })
    : null;

  const contenido = (existente?.data ?? null) as { nodes?: unknown; edges?: unknown } | null;
  const fundido = fundirChatEnMapa({
    nodos: Array.isArray(contenido?.nodes) ? (contenido!.nodes as never[]) : [],
    aristas: Array.isArray(contenido?.edges) ? (contenido!.edges as never[]) : [],
    pasos,
  });

  const data = { nodes: fundido.nodos, edges: fundido.aristas } as unknown as Prisma.InputJsonValue;

  const diagramId = existente
    ? (
        await prisma.diagram.update({
          where: { id: existente.id },
          data: { data },
          select: { id: true },
        })
      ).id
    : (
        await prisma.diagram.create({
          data: {
            workspaceId: membership.workspace.id,
            createdById: session.user.id,
            title: "Caminos de los clientes",
            data,
          },
          select: { id: true },
        })
      ).id;

  const chats = [...(estado?.chats ?? []), conversacion.id];
  const value = JSON.stringify({ diagramId, chats, formato: FORMATO_ACTUAL } satisfies EstadoDelMapa);
  await prisma.appSetting.upsert({
    where: { key: claveDelMapa(membership.workspace.id) },
    create: { key: claveDelMapa(membership.workspace.id), value },
    update: { value },
  });

  revalidatePath("/cliente/diagramas");
  revalidatePath(`/cliente/diagramas/${diagramId}`);
  return { diagramId, pasos: pasos.length };
}
