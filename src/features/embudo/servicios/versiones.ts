import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { leerEtapasQuitadas } from "@/lib/etapas-quitadas";

import {
  armarFoto,
  elegirVersion,
  fotoDeContenido,
  haceFaltaVersionNueva,
  huellaDeFoto,
  nombreDeVersion,
  productoIdDeClave,
  type ElegidaParaElChat,
  type FotoDelEmbudo,
} from "../dominio/versiones";
import { embudoActivo, leerConfigEmbudo } from "./config";

/**
 * VERSIONES DEL EMBUDO y la versión de cada chat (Embudo 3).
 *
 * Solo REGISTRA: nada de aquí cambia lo que el bot responde ni manda mensajes. Las funciones que
 * se llaman al guardar el embudo (`asegurarVersionInicial`, `registrarVersionDelEmbudo`) nunca
 * lanzan: si algo falla se anota en el log y el guardado del embudo sigue valiendo.
 */

export type QuienCambio = { id?: string | null; nombre?: string | null };
export type OrigenDeVersion = "inicial" | "pantalla" | "mcp" | "deshacer";

function anotarError(donde: string, error: unknown, extra: Record<string, unknown> = {}) {
  console.warn(`[embudo-versiones] ${donde}`, { ...extra, error: error instanceof Error ? error.message : String(error) });
}

function esChoqueDeUnico(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** La foto del embudo del producto tal como está guardado ahora. Null si el producto no tiene embudo armado. */
export async function fotoActualDelEmbudo(workspaceId: string, productId: string): Promise<FotoDelEmbudo | null> {
  const playbook = await prisma.productPlaybook.findFirst({
    where: { workspaceId, productId },
    select: {
      stages: {
        select: {
          stage: true,
          goal: true,
          script: true,
          stuckAfterMessages: true,
          followUps: {
            select: { sortOrder: true, timeType: true, timeValue: true, content: true, flowId: true, cancelOnActivity: true, isActive: true },
          },
        },
      },
    },
  });
  if (!playbook) return null;
  return armarFoto(playbook.stages, await leerEtapasQuitadas(productId));
}

async function crearVersion(input: {
  workspaceId: string;
  productId: string;
  origen: OrigenDeVersion;
  nota?: string | null;
  quien?: QuienCambio;
  foto: FotoDelEmbudo;
  /** Con true se crea aunque el contenido sea igual al de la última (la V1 de cada producto). */
  soloSiCambio: boolean;
}): Promise<{ id: string; numero: number } | null> {
  const huella = huellaDeFoto(input.foto);
  // Dos guardados a la vez pueden querer el mismo número: la regla única de la base lo frena y se reintenta.
  for (let intento = 0; intento < 3; intento += 1) {
    const ultima = await prisma.embudoVersion.findFirst({
      where: { productId: input.productId },
      orderBy: { numero: "desc" },
      select: { numero: true, huella: true },
    });
    if (input.soloSiCambio && ultima && !haceFaltaVersionNueva(huella, ultima.huella)) return null;
    if (!input.soloSiCambio && ultima) return null;
    try {
      return await prisma.embudoVersion.create({
        data: {
          workspaceId: input.workspaceId,
          productId: input.productId,
          numero: (ultima?.numero ?? 0) + 1,
          nota: input.nota?.trim().slice(0, 300) || null,
          quienId: input.quien?.id ?? null,
          quienNombre: input.quien?.nombre ?? null,
          origen: input.origen,
          huella,
          contenido: input.foto as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, numero: true },
      });
    } catch (error) {
      if (!esChoqueDeUnico(error)) throw error;
    }
  }
  return null;
}

/**
 * Si el producto todavía no tiene versiones, guarda lo que tiene AHORA como "V1 - embudo inicial".
 * Se llama ANTES de aplicar un cambio, así la V1 guarda lo de antes. Nunca lanza.
 */
export async function asegurarVersionInicial(workspaceId: string, productId: string): Promise<{ id: string; numero: number } | null> {
  try {
    const foto = await fotoActualDelEmbudo(workspaceId, productId);
    if (!foto) return null;
    return await crearVersion({ workspaceId, productId, origen: "inicial", nota: "Embudo inicial", foto, soloSiCambio: false });
  } catch (error) {
    anotarError("no se pudo guardar la V1", error, { productId });
    return null;
  }
}

/**
 * Guarda una versión nueva con lo que quedó después de un cambio. Si el contenido es igual al de
 * la última versión, no crea otra. Nunca lanza.
 */
export async function registrarVersionDelEmbudo(input: {
  workspaceId: string;
  productId: string;
  origen: Exclude<OrigenDeVersion, "inicial">;
  nota?: string | null;
  quien?: QuienCambio;
}): Promise<{ id: string; numero: number } | null> {
  try {
    const foto = await fotoActualDelEmbudo(input.workspaceId, input.productId);
    if (!foto) return null;
    return await crearVersion({ ...input, foto, soloSiCambio: true });
  } catch (error) {
    anotarError("no se pudo guardar la versión", error, { productId: input.productId });
    return null;
  }
}

/** La última versión del producto. */
export async function versionVigente(productId: string) {
  return prisma.embudoVersion.findFirst({
    where: { productId },
    orderBy: { numero: "desc" },
    select: { id: true, numero: true, creadoEn: true, origen: true, nota: true, quienNombre: true },
  });
}

/** El nombre del usuario para anotar quién cambió el embudo. */
export async function quienEs(userId: string | null | undefined): Promise<QuienCambio> {
  if (!userId) return {};
  try {
    const usuario = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    return { id: userId, nombre: usuario?.name || usuario?.email || null };
  } catch {
    return { id: userId };
  }
}

/** Las versiones de un producto, de la más nueva a la más vieja, con cuántos chats tiene cada una. */
export async function listarVersiones(workspaceId: string, productId: string) {
  const versiones = await prisma.embudoVersion.findMany({
    where: { workspaceId, productId },
    orderBy: { numero: "desc" },
    select: { id: true, numero: true, creadoEn: true, origen: true, nota: true, quienNombre: true },
  });
  const conteo = await prisma.embudoChatVersion.groupBy({
    by: ["versionId"],
    where: { workspaceId, productId },
    _count: { _all: true },
  });
  const chats = new Map(conteo.map((fila) => [fila.versionId, fila._count._all]));
  return versiones.map((version) => ({
    ...version,
    nombre: nombreDeVersion(version.numero, version.origen),
    chats: chats.get(version.id) ?? 0,
  }));
}

/** Una versión completa (bienvenida, guiones y seguimientos de ese momento). Null si no existe en este negocio. */
export async function leerVersion(workspaceId: string, productId: string, numero: number) {
  const version = await prisma.embudoVersion.findFirst({
    where: { workspaceId, productId, numero },
    select: { id: true, numero: true, creadoEn: true, origen: true, nota: true, quienNombre: true, contenido: true },
  });
  if (!version) return null;
  const chats = await prisma.embudoChatVersion.count({ where: { versionId: version.id } });
  return { ...version, nombre: nombreDeVersion(version.numero, version.origen), chats, foto: fotoDeContenido(version.contenido) };
}

/**
 * Qué versión le toca a un chat nuevo del producto. Hoy: siempre la vigente, marcada "vigente".
 * Embudo 5 (prueba A/B) cambia SOLO esta función para elegir al azar y marcar "ab".
 */
export async function elegirVersionParaChat(workspaceId: string, productId: string): Promise<ElegidaParaElChat | null> {
  let versiones = await prisma.embudoVersion.findMany({
    where: { workspaceId, productId },
    orderBy: { numero: "desc" },
    take: 1,
    select: { id: true, numero: true },
  });
  if (!versiones.length) {
    // El producto nunca se tocó: lo que tiene ahora es su V1.
    const inicial = await asegurarVersionInicial(workspaceId, productId);
    if (!inicial) {
      versiones = await prisma.embudoVersion.findMany({ where: { workspaceId, productId }, take: 1, orderBy: { numero: "desc" }, select: { id: true, numero: true } });
    } else {
      versiones = [inicial];
    }
  }
  return elegirVersion(versiones);
}

const yaMarcados = new Set<string>();

/**
 * Marca el chat con la versión del embudo con la que entró. Solo si todavía no tiene una: el chat
 * se queda con ella aunque el embudo cambie después. Sin producto reconocido, queda sin versión.
 * Nunca lanza y respeta el interruptor del embudo.
 */
export async function marcarVersionDelChat(input: {
  workspaceId: string;
  conversationId: string;
  /** La clave de producto del embudo (un id o "combo-camilla"). */
  productoClave: string | null | undefined;
}): Promise<boolean> {
  try {
    if (!input.productoClave || !input.conversationId || yaMarcados.has(input.conversationId)) return false;
    if (!(await embudoActivo(input.workspaceId))) return false;

    const existente = await prisma.embudoChatVersion.findUnique({ where: { conversationId: input.conversationId }, select: { conversationId: true } });
    if (existente) {
      yaMarcados.add(input.conversationId);
      return false;
    }

    const productos = await prisma.product.findMany({
      where: { workspaceId: input.workspaceId, playbooks: { some: { workspaceId: input.workspaceId } } },
      select: { id: true, name: true },
    });
    const productId = productoIdDeClave(
      input.productoClave,
      productos.map((producto) => ({ id: producto.id, nombre: producto.name })),
      await leerConfigEmbudo(input.workspaceId),
    );
    if (!productId) return false;

    const elegida = await elegirVersionParaChat(input.workspaceId, productId);
    if (!elegida) return false;

    try {
      await prisma.embudoChatVersion.create({
        data: {
          conversationId: input.conversationId,
          workspaceId: input.workspaceId,
          productId,
          versionId: elegida.versionId,
          numero: elegida.numero,
          asignadaPor: elegida.asignadaPor,
        },
      });
    } catch (error) {
      if (!esChoqueDeUnico(error)) throw error;
    }
    if (yaMarcados.size > 5000) yaMarcados.clear();
    yaMarcados.add(input.conversationId);
    return true;
  } catch (error) {
    anotarError("no se pudo marcar el chat", error, { conversationId: input.conversationId });
    return false;
  }
}
