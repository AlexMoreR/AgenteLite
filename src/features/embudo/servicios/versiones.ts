import { prisma } from "@/lib/prisma";
import { leerEtapasQuitadas } from "@/lib/etapas-quitadas";

import { CLAVE_COMBO } from "../dominio/combo";
import {
  armarFoto,
  claveDelChat,
  hayVersionNueva,
  huellaDeFoto,
  leerFotoGuardada,
  limpiarNota,
  NOTA_VERSION_INICIAL,
  productoIdDeClave,
  type FotoEmbudo,
} from "../dominio/versiones";
import { embudoActivo, leerConfigEmbudo } from "./config";

/**
 * VERSIONES DEL EMBUDO (Embudo 3): solo REGISTRA. No cambia lo que el bot responde ni manda nada.
 *
 * - `EmbudoVersion`: una foto completa del embudo de un producto por cada cambio guardado. La V1
 *   es el embudo inicial: se guarda la primera vez que se toca o se consulta un producto, ANTES de
 *   aplicar el cambio.
 * - `EmbudoChatVersion`: con qué versión entró cada chat. Se guarda una sola vez.
 *
 * La regla de oro: ninguna función de este archivo lanza. Guardar el embudo es lo importante; si
 * el registro de la versión falla, se anota en el log y el guardado queda hecho igual.
 */

export type OrigenDeVersion = "inicial" | "pantalla" | "mcp" | "deshacer";

export type VersionVigente = { id: string; numero: number; creadoEn: Date };

function anotarError(donde: string, error: unknown, extra: Record<string, unknown> = {}) {
  console.warn(`[embudo-versiones] ${donde}`, { ...extra, error: error instanceof Error ? error.message : String(error) });
}

const esChoqueDeUnico = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

/** La foto del embudo de un producto tal como está AHORA. Null si el producto no tiene embudo. */
export async function leerFotoActual(workspaceId: string, productId: string): Promise<FotoEmbudo | null> {
  const playbook = await prisma.productPlaybook.findFirst({
    where: { workspaceId, productId },
    select: {
      stages: {
        orderBy: { sortOrder: "asc" },
        select: {
          stage: true,
          goal: true,
          script: true,
          stuckAfterMessages: true,
          followUps: {
            orderBy: { sortOrder: "asc" },
            select: { sortOrder: true, timeType: true, timeValue: true, content: true, flowId: true, cancelOnActivity: true, isActive: true },
          },
        },
      },
    },
  });
  if (!playbook) return null;
  const quitadas = await leerEtapasQuitadas(productId);
  return armarFoto({ pasos: playbook.stages, quitadas });
}

/** La versión más nueva del producto, o null si todavía no tiene ninguna. */
export async function versionVigente(productId: string): Promise<VersionVigente | null> {
  const fila = await prisma.embudoVersion.findFirst({
    where: { productId },
    orderBy: { numero: "desc" },
    select: { id: true, numero: true, creadoEn: true },
  });
  return fila ?? null;
}

async function nombreDeQuien(quienId: string | null | undefined, quienNombre: string | null | undefined): Promise<string | null> {
  if (quienNombre?.trim()) return quienNombre.trim();
  if (!quienId) return null;
  try {
    const usuario = await prisma.user.findUnique({ where: { id: quienId }, select: { name: true, email: true } });
    return usuario?.name?.trim() || usuario?.email || null;
  } catch {
    return null;
  }
}

/**
 * Guarda la foto como versión nueva. Dos guardados a la vez pueden querer el mismo número: lo
 * frena el índice único (productId, numero) y se reintenta con el siguiente.
 * `soloSiCambio`: no crea nada si el contenido es idéntico al de la última versión.
 */
async function crearVersion(input: {
  workspaceId: string;
  productId: string;
  foto: FotoEmbudo;
  origen: OrigenDeVersion;
  nota: string | null;
  quienId?: string | null;
  quienNombre?: string | null;
  soloSiCambio: boolean;
}): Promise<{ creada: boolean; version: { id: string; numero: number } | null }> {
  const huella = huellaDeFoto(input.foto);
  for (let intento = 0; intento < 3; intento += 1) {
    const ultima = await prisma.embudoVersion.findFirst({
      where: { productId: input.productId },
      orderBy: { numero: "desc" },
      select: { id: true, numero: true, huella: true },
    });
    if (input.soloSiCambio && ultima && !hayVersionNueva(ultima.huella, huella)) {
      return { creada: false, version: { id: ultima.id, numero: ultima.numero } };
    }
    try {
      const creada = await prisma.embudoVersion.create({
        data: {
          workspaceId: input.workspaceId,
          productId: input.productId,
          numero: (ultima?.numero ?? 0) + 1,
          nota: input.nota,
          quienId: input.quienId ?? null,
          quienNombre: input.quienNombre ?? null,
          origen: input.origen,
          huella,
          contenido: input.foto as unknown as object,
        },
        select: { id: true, numero: true },
      });
      return { creada: true, version: creada };
    } catch (error) {
      if (esChoqueDeUnico(error)) continue;
      throw error;
    }
  }
  return { creada: false, version: null };
}

/**
 * La V1 ("embudo inicial"): si el producto todavía no tiene ninguna versión, guarda lo que tiene
 * AHORA. Hay que llamarla ANTES de aplicar un cambio, para que la V1 sea lo de antes del cambio.
 * Nunca lanza; null si no se pudo o el producto no tiene embudo.
 */
export async function asegurarVersionInicial(workspaceId: string, productId: string): Promise<VersionVigente | null> {
  try {
    const existente = await prisma.embudoVersion.findFirst({
      where: { productId },
      orderBy: { numero: "asc" },
      select: { id: true, numero: true, creadoEn: true },
    });
    if (existente) return existente;
    const foto = await leerFotoActual(workspaceId, productId);
    if (!foto) return null;
    await crearVersion({ workspaceId, productId, foto, origen: "inicial", nota: NOTA_VERSION_INICIAL, soloSiCambio: false });
    return await versionVigente(productId);
  } catch (error) {
    anotarError("no se pudo guardar la versión inicial", error, { productId });
    return null;
  }
}

/**
 * Una versión nueva DESPUÉS de guardar un cambio del embudo. Si el contenido quedó idéntico al de
 * la última versión, no crea otra. Nunca lanza: si falla, el cambio ya está guardado.
 */
export async function registrarVersionDelEmbudo(input: {
  workspaceId: string;
  productId: string;
  origen: Exclude<OrigenDeVersion, "inicial">;
  nota?: unknown;
  quienId?: string | null;
  quienNombre?: string | null;
}): Promise<{ ok: boolean; creada: boolean; numero?: number }> {
  try {
    const foto = await leerFotoActual(input.workspaceId, input.productId);
    if (!foto) return { ok: true, creada: false };
    const quienNombre = await nombreDeQuien(input.quienId, input.quienNombre);
    const { creada, version } = await crearVersion({
      workspaceId: input.workspaceId,
      productId: input.productId,
      foto,
      origen: input.origen,
      nota: limpiarNota(input.nota),
      quienId: input.quienId ?? null,
      quienNombre,
      soloSiCambio: true,
    });
    return { ok: version !== null, creada, numero: version?.numero };
  } catch (error) {
    anotarError("no se pudo registrar la versión del embudo", error, { productId: input.productId });
    return { ok: false, creada: false };
  }
}

/**
 * ÚNICO PUNTO donde se decide con qué versión entra un chat. Hoy siempre es la vigente, marcada
 * "vigente". Embudo 5 (prueba A/B) solo tiene que cambiar esta función para elegir al azar entre
 * versiones y devolver `asignadaPor: "ab"`.
 */
export async function elegirVersionParaChat(input: {
  workspaceId: string;
  productId: string;
  conversationId: string;
}): Promise<{ versionId: string; numero: number; asignadaPor: "vigente" | "ab" } | null> {
  const version = (await versionVigente(input.productId)) ?? (await asegurarVersionInicial(input.workspaceId, input.productId));
  if (!version) return null;
  return { versionId: version.id, numero: version.numero, asignadaPor: "vigente" };
}

/** Los chats que ya se sabe que tienen versión: evita la consulta en cada evento del mismo chat. */
const marcados = new Set<string>();
const MAXIMO_MARCADOS = 5000;

/**
 * Marca el chat con la versión del embudo con la que entró. Solo si todavía no tiene una, así se
 * queda con ella aunque el embudo cambie después. Si no se sabe de qué producto es (o no se puede
 * traducir su clave), queda sin versión: no se inventa. Respeta el interruptor del embudo y nunca
 * lanza. Pensada para correr en segundo plano, dentro del registro del embudo.
 */
export async function marcarVersionDelChat(input: { workspaceId: string; conversationId: string }): Promise<boolean> {
  try {
    if (!input.workspaceId || !input.conversationId || marcados.has(input.conversationId)) return false;
    if (!(await embudoActivo(input.workspaceId))) return false;

    const yaTiene = await prisma.embudoChatVersion.findUnique({
      where: { conversationId: input.conversationId },
      select: { conversationId: true },
    });
    if (yaTiene) {
      recordarMarcado(input.conversationId);
      return false;
    }

    const lead = await prisma.embudoLead.findUnique({
      where: { conversationId: input.conversationId },
      select: { workspaceId: true, productoActual: true, productoEntrada: true },
    });
    const clave = lead && lead.workspaceId === input.workspaceId ? claveDelChat(lead) : null;
    if (!clave) return false;

    const config = await leerConfigEmbudo(input.workspaceId);
    const candidatos = await prisma.product.findMany({
      where: {
        workspaceId: input.workspaceId,
        playbooks: { some: { workspaceId: input.workspaceId } },
        ...(clave === CLAVE_COMBO ? {} : { id: clave }),
      },
      select: { id: true, name: true },
      take: 500,
    });
    const productId = productoIdDeClave(clave, candidatos.map((producto) => ({ id: producto.id, nombre: producto.name })), config);
    if (!productId) return false;

    const elegida = await elegirVersionParaChat({ workspaceId: input.workspaceId, productId, conversationId: input.conversationId });
    if (!elegida) return false;

    await prisma.embudoChatVersion.createMany({
      data: [
        {
          conversationId: input.conversationId,
          workspaceId: input.workspaceId,
          productId,
          versionId: elegida.versionId,
          numero: elegida.numero,
          asignadaPor: elegida.asignadaPor,
        },
      ],
      skipDuplicates: true,
    });
    recordarMarcado(input.conversationId);
    return true;
  } catch (error) {
    anotarError("no se pudo marcar el chat con su versión", error, { conversationId: input.conversationId });
    return false;
  }
}

function recordarMarcado(conversationId: string) {
  if (marcados.size >= MAXIMO_MARCADOS) marcados.clear();
  marcados.add(conversationId);
}

/** Solo para las pruebas: vacía la memoria de chats marcados. */
export function olvidarChatsMarcados() {
  marcados.clear();
}

/** La lista de versiones de un producto, de la más nueva a la más vieja, con cuántos chats tiene cada una. */
export async function listarVersiones(workspaceId: string, productId: string) {
  await asegurarVersionInicial(workspaceId, productId);
  const [versiones, conteos] = await Promise.all([
    prisma.embudoVersion.findMany({
      where: { workspaceId, productId },
      orderBy: { numero: "desc" },
      select: { numero: true, creadoEn: true, quienNombre: true, nota: true, origen: true },
    }),
    prisma.embudoChatVersion.groupBy({
      by: ["numero"],
      where: { workspaceId, productId },
      _count: { _all: true },
    }),
  ]);
  const chatsPorNumero = new Map(conteos.map((fila) => [fila.numero, fila._count._all] as const));
  return versiones.map((version) => ({ ...version, chats: chatsPorNumero.get(version.numero) ?? 0 }));
}

/** Una versión completa (bienvenida, guiones y seguimientos de ese momento). */
export async function leerVersion(workspaceId: string, productId: string, numero: number) {
  const fila = await prisma.embudoVersion.findFirst({
    where: { workspaceId, productId, numero },
    select: { numero: true, creadoEn: true, quienNombre: true, nota: true, origen: true, contenido: true },
  });
  if (!fila) return null;
  return { ...fila, foto: leerFotoGuardada(fila.contenido) };
}
