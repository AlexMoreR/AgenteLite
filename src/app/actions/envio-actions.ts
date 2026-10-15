"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  puedeEditarEnvioContraentrega,
  validarEnvioContraentrega,
  type EnvioContraentregaGuardado,
} from "@/lib/contraentrega";
import {
  borrarEnvioContraentrega,
  guardarEnvioContraentrega,
  leerEnvioContraentrega,
} from "@/lib/envio-contraentrega-guardado";
import {
  agregarUbicacion,
  buscarUbicaciones,
  type ResultadoDeAgregar,
  type ResultadoDeBusqueda,
} from "@/lib/envios-gestion";
import { AVISO_MODO_MONITOREO, estaEnModoMonitoreo } from "@/lib/modo-monitoreo";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

/**
 * Panel de envío del chat: consultar en Gestión a dónde llegamos, agregar una ubicación que no
 * existe y dejar en la ficha del contacto lo que se le dijo. Ver `lib/envios-gestion.ts`.
 */

/** El código del combo que se ofrece por defecto si la conversación no tiene producto activo. */
const CODIGO_POR_DEFECTO = "CMB05";

async function sesionDelChat(): Promise<{ error: string } | { userId: string; workspaceId: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }
  return { userId: session.user.id, workspaceId: membership.workspace.id };
}

/** `categoria` (la de Gestión, sincronizada) decide si hay contraentrega: solo combo de camilla. */
export type ProductoParaEnvio = { codigo: string; nombre: string; categoria: string | null };

/**
 * Los productos activos con código (el código es el de Gestión: lo pone la sincronización) y cuál
 * va elegido de entrada: el producto activo de la conversación o, si no hay, el Combo Camillas.
 */
export async function listarProductosParaEnvioAction(
  chatKey?: string | null,
): Promise<{ error: string } | { productos: ProductoParaEnvio[]; porDefecto: string | null }> {
  const sesion = await sesionDelChat();
  if ("error" in sesion) return sesion;

  const productos = await prisma.product.findMany({
    where: { workspaceId: sesion.workspaceId, activo: true, code: { not: null } },
    select: { id: true, code: true, name: true, category: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const lista = productos
    .filter((producto) => producto.code?.trim())
    .map((producto) => ({
      id: producto.id,
      codigo: producto.code!.trim(),
      nombre: producto.name,
      categoria: producto.category?.name ?? null,
    }));

  let porDefecto: string | null = null;
  const contexto = await leerProductoActivo(sesion.workspaceId, chatKey);
  if (contexto) {
    porDefecto =
      lista.find((producto) => producto.id === contexto.productId)?.codigo ??
      lista.find((producto) => contexto.code && producto.codigo === contexto.code)?.codigo ??
      null;
  }
  if (!porDefecto) {
    porDefecto =
      lista.find((producto) => producto.codigo.toUpperCase() === CODIGO_POR_DEFECTO)?.codigo ??
      lista.find((producto) => /combo\s+camillas?/i.test(producto.nombre))?.codigo ??
      null;
  }

  return { productos: lista.map(({ codigo, nombre, categoria }) => ({ codigo, nombre, categoria })), porDefecto };
}

async function leerProductoActivo(
  workspaceId: string,
  chatKey?: string | null,
): Promise<{ productId: string | null; code: string | null } | null> {
  if (!chatKey) return null;
  try {
    let contexto: unknown = null;
    if (chatKey.startsWith("official:")) {
      const fila = await prisma.officialApiConversation.findFirst({
        where: { id: chatKey.slice("official:".length), config: { workspaceId } },
        select: { activeProductContext: true },
      });
      contexto = fila?.activeProductContext ?? null;
    } else {
      const id = chatKey.startsWith("agent:") ? chatKey.slice("agent:".length) : chatKey;
      const fila = await prisma.conversation.findFirst({
        where: { id, workspaceId },
        select: { activeProductContext: true },
      });
      contexto = fila?.activeProductContext ?? null;
    }
    if (!contexto || typeof contexto !== "object" || Array.isArray(contexto)) return null;
    const valor = contexto as { productId?: unknown; code?: unknown };
    return {
      productId: typeof valor.productId === "string" ? valor.productId : null,
      code: typeof valor.code === "string" ? valor.code.trim() : null,
    };
  } catch {
    return null;
  }
}

export async function buscarUbicacionAction(q: string, productoCodigo?: string | null): Promise<ResultadoDeBusqueda> {
  const sesion = await sesionDelChat();
  if ("error" in sesion) return sesion;
  if (typeof q !== "string") return { error: "Datos invalidos" };
  return buscarUbicaciones(sesion.workspaceId, q, typeof productoCodigo === "string" ? productoCodigo : null);
}

const agregarSchema = z.object({
  cityId: z.string().trim().min(1).max(100),
  nombre: z.string().trim().min(2).max(120),
});

export async function agregarUbicacionAction(input: { cityId: string; nombre: string }): Promise<ResultadoDeAgregar> {
  const sesion = await sesionDelChat();
  if ("error" in sesion) return sesion;
  const parsed = agregarSchema.safeParse(input);
  if (!parsed.success) return { error: "Escribe el nombre y elige la ciudad" };

  // La monitora mira, no agrega nada en Gestión. Ver `modo-monitoreo.ts`.
  if (await estaEnModoMonitoreo({ workspaceId: sesion.workspaceId, userId: sesion.userId })) {
    return { error: AVISO_MODO_MONITOREO };
  }
  return agregarUbicacion(sesion.workspaceId, parsed.data);
}

const guardarSchema = z.object({
  contactId: z.string().trim().min(1),
  lugar: z.string().trim().min(1).max(160),
  departamento: z.string().trim().max(80).optional().default(""),
  envio: z.enum(["GRATIS", "ADICIONAL", "COTIZAR", "NO_LLEGA"]),
  gestionId: z.string().trim().max(100).nullable().optional(),
});

/**
 * Deja en la ficha del contacto la ubicación consultada: `metadata.city` (lo que ya muestra la
 * ficha) y `metadata.envio` con lo que dijo Gestión, quién y cuándo. Sin migración: se mezcla en el
 * JSON igual que `updateContactAction`.
 */
export async function guardarUbicacionEnContactoAction(
  input: z.input<typeof guardarSchema>,
): Promise<{ error: string } | { ok: true; city: string }> {
  const sesion = await sesionDelChat();
  if ("error" in sesion) return sesion;
  const parsed = guardarSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos invalidos" };

  if (await estaEnModoMonitoreo({ workspaceId: sesion.workspaceId, userId: sesion.userId })) {
    return { error: AVISO_MODO_MONITOREO };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, workspaceId: sesion.workspaceId },
    select: { id: true, metadata: true },
  });
  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  const city = parsed.data.departamento ? `${parsed.data.lugar}, ${parsed.data.departamento}` : parsed.data.lugar;
  const baseMetadata =
    contact.metadata && typeof contact.metadata === "object" && !Array.isArray(contact.metadata)
      ? (contact.metadata as Record<string, unknown>)
      : {};
  const nextMetadata: Record<string, unknown> = {
    ...baseMetadata,
    city,
    envio: {
      gestionId: parsed.data.gestionId ?? null,
      estado: parsed.data.envio,
      lugar: parsed.data.lugar,
      consultadoEn: new Date().toISOString(),
      porUserId: sesion.userId,
    },
  };

  await prisma.contact.update({
    where: { id: contact.id },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
  });

  return { ok: true, city };
}

/* ---------------------------------------------------------------------------------------------
   Valor del envío de contraentrega por ubicación (14-oct). Lo leen todas; lo escribe y lo borra
   solo el dueño o un administrador. Ver `lib/envio-contraentrega-guardado.ts`.
--------------------------------------------------------------------------------------------- */

const ubicacionSchema = z.object({
  tipo: z.enum(["ciudad", "corregimiento"]),
  id: z.string().trim().min(1).max(100),
});

async function accesoParaContraentrega(): Promise<
  | { error: string }
  | { workspaceId: string; userId: string; puedeEditar: boolean }
> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  const access = await requireClientWorkspaceAccess("chats");
  return { workspaceId: access.workspaceId, userId: access.userId, puedeEditar: puedeEditarEnvioContraentrega(access) };
}

export async function leerEnvioContraentregaAction(
  input: z.input<typeof ubicacionSchema>,
): Promise<{ error: string } | { guardado: EnvioContraentregaGuardado | null; puedeEditar: boolean }> {
  const sesion = await accesoParaContraentrega();
  if ("error" in sesion) return sesion;
  const parsed = ubicacionSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos invalidos" };
  const guardado = await leerEnvioContraentrega(sesion.workspaceId, parsed.data);
  return { guardado, puedeEditar: sesion.puedeEditar };
}

const guardarContraentregaSchema = ubicacionSchema.extend({
  nombre: z.string().trim().min(1).max(160),
  valor: z.union([z.string().max(20), z.number()]),
});

export async function guardarEnvioContraentregaAction(
  input: z.input<typeof guardarContraentregaSchema>,
): Promise<{ error: string } | { guardado: EnvioContraentregaGuardado }> {
  const sesion = await accesoParaContraentrega();
  if ("error" in sesion) return sesion;
  if (!sesion.puedeEditar) return { error: "Solo el dueño o un administrador puede cambiar este valor" };
  const parsed = guardarContraentregaSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos invalidos" };
  const validado = validarEnvioContraentrega(parsed.data.valor);
  if (!validado.ok) return { error: validado.error };

  const usuario = await prisma.user.findUnique({
    where: { id: sesion.userId },
    select: { name: true, email: true },
  });
  const guardado: EnvioContraentregaGuardado = {
    valor: validado.valor,
    nombre: parsed.data.nombre,
    actualizadoPor: usuario?.name?.trim() || usuario?.email || sesion.userId,
    fecha: new Date().toISOString(),
  };
  await guardarEnvioContraentrega(
    sesion.workspaceId,
    { tipo: parsed.data.tipo, id: parsed.data.id },
    guardado,
  );
  return { guardado };
}

export async function borrarEnvioContraentregaAction(
  input: z.input<typeof ubicacionSchema>,
): Promise<{ error: string } | { ok: true }> {
  const sesion = await accesoParaContraentrega();
  if ("error" in sesion) return sesion;
  if (!sesion.puedeEditar) return { error: "Solo el dueño o un administrador puede cambiar este valor" };
  const parsed = ubicacionSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos invalidos" };
  await borrarEnvioContraentrega(sesion.workspaceId, parsed.data);
  return { ok: true };
}
