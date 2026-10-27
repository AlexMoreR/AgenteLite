import { Prisma } from "@prisma/client";

import { leerEtapasQuitadas } from "@/lib/etapas-quitadas";
import { prisma } from "@/lib/prisma";

import {
  armarFoto,
  haceFaltaVersionNueva,
  huellaDeFoto,
  productoIdDeClave,
  type FotoDelEmbudo,
} from "../dominio/versiones";
import { embudoActivo, leerConfigEmbudo } from "./config";

/**
 * VERSIONES DEL EMBUDO y chats marcados con su versión (Embudo 3).
 *
 * Solo REGISTRA: no cambia lo que el bot responde ni manda mensajes. Las funciones "protegidas"
 * (`...Protegido`, `marcarVersionDelChat`) nunca lanzan: si algo falla se anota en el log y el
 * guardado del embudo, o el registro del chat, siguen como si nada.
 */

export type QuienCambio = { id?: string | null; nombre?: string | null };
export type OrigenDeVersion = "inicial" | "pantalla" | "mcp" | "deshacer";

export const NOTA_VERSION_INICIAL = "V1 - embudo inicial";

function anotarError(donde: string, error: unknown, extra: Record<string, unknown> = {}) {
  console.warn(`[embudo-versiones] ${donde}`, { ...extra, error: error instanceof Error ? error.message : String(error) });
}

/** El embudo de un producto como está ahora mismo en la base. */
export async function leerFotoActual(workspaceId: string, productId: string): Promise<FotoDelEmbudo | null> {
  const playbook = await prisma.productPlaybook.findUnique({
    where: { workspaceId_productId: { workspaceId, productId } },
    select: {
      stages: {
        select: {
          stage: true,
          goal: true,
          script: true,
          stuckAfterMessages: true,
          sortOrder: true,
          followUps: {
            select: {
              sortOrder: true,
              timeType: true,
              timeValue: true,
              content: true,
              flowId: true,
              isActive: true,
              cancelOnActivity: true,
            },
          },
        },
      },
    },
  });
  if (!playbook) return null;
  return armarFoto(playbook.stages, await leerEtapasQuitadas(productId));
}

async function ultimaVersion(productId: string) {
  return prisma.embudoVersion.findFirst({
    where: { productId },
    orderBy: { numero: "desc" },
    select: { id: true, numero: true, huella: true, creadoEn: true },
  });
}

/** Crea la versión con el número siguiente; si dos guardados chocan por el número, reintenta. */
async function crearVersion(input: {
  workspaceId: string;
  productId: string;
  foto: FotoDelEmbudo;
  nota: string | null;
  quien?: QuienCambio;
  origen: OrigenDeVersion;
}) {
  const huella = huellaDeFoto(input.foto);
  for (let intento = 0; intento < 3; intento += 1) {
    const ultima = await ultimaVersion(input.productId);
    if (ultima && !haceFaltaVersionNueva(ultima.huella, huella)) return { ...ultima, creada: false as const };
    try {
      const creada = await prisma.embudoVersion.create({
        data: {
          workspaceId: input.workspaceId,
          productId: input.productId,
          numero: (ultima?.numero ?? 0) + 1,
          nota: input.nota?.trim() || null,
          quienId: input.quien?.id ?? null,
          quienNombre: input.quien?.nombre ?? null,
          origen: input.origen,
          huella,
          contenido: input.foto as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, numero: true, huella: true, creadoEn: true },
      });
      return { ...creada, creada: true as const };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue; // Otro guardado tomó ese número.
      throw error;
    }
  }
  throw new Error("no se pudo asignar el número de versión tras 3 intentos");
}

/**
 * Si el producto todavía no tiene ninguna versión, guarda lo que tiene ahora como
 * "V1 - embudo inicial". Se llama ANTES de aplicar un cambio, para que la V1 sea lo de antes.
 */
export async function asegurarVersionInicial(workspaceId: string, productId: string, quien?: QuienCambio) {
  if (await prisma.embudoVersion.findFirst({ where: { productId }, select: { id: true } })) return null;
  const foto = await leerFotoActual(workspaceId, productId);
  if (!foto) return null;
  return crearVersion({ workspaceId, productId, foto, nota: NOTA_VERSION_INICIAL, quien, origen: "inicial" });
}

/** Guarda una versión nueva con el embudo tal como quedó (si cambió respecto de la última). */
export async function registrarVersionDelEmbudo(input: {
  workspaceId: string;
  productId: string;
  nota?: string | null;
  quien?: QuienCambio;
  origen: OrigenDeVersion;
}) {
  const foto = await leerFotoActual(input.workspaceId, input.productId);
  if (!foto) return null;
  return crearVersion({ ...input, foto, nota: input.nota ?? null });
}

/** Lo mismo, sin lanzar nunca: así un fallo acá no puede impedir que el embudo se guarde. */
export async function registrarVersionProtegido(input: Parameters<typeof registrarVersionDelEmbudo>[0]): Promise<void> {
  try {
    await registrarVersionDelEmbudo(input);
  } catch (error) {
    anotarError("no se pudo registrar la versión", error, { productId: input.productId });
  }
}

export async function asegurarVersionInicialProtegido(workspaceId: string, productId: string, quien?: QuienCambio): Promise<void> {
  try {
    await asegurarVersionInicial(workspaceId, productId, quien);
  } catch (error) {
    anotarError("no se pudo guardar la versión inicial", error, { productId });
  }
}

export async function versionVigente(productId: string) {
  return ultimaVersion(productId);
}

/**
 * Qué versión le toca a un chat nuevo. HOY siempre la vigente, marcada "vigente".
 * Embudo 5 (prueba A/B) solo tiene que cambiar esta función para elegir al azar y marcar "ab".
 */
export async function elegirVersionParaChat(
  workspaceId: string,
  productId: string,
): Promise<{ versionId: string; numero: number; asignadaPor: "vigente" | "ab" } | null> {
  if (!(await prisma.embudoVersion.findFirst({ where: { productId, workspaceId }, select: { id: true } }))) {
    await asegurarVersionInicial(workspaceId, productId);
  }
  const vigente = await ultimaVersion(productId);
  return vigente ? { versionId: vigente.id, numero: vigente.numero, asignadaPor: "vigente" } : null;
}

/**
 * Marca el chat con la versión del embudo de su producto, UNA sola vez: si ya tiene una, no se
 * toca aunque el embudo haya cambiado. Sin producto reconocible queda sin versión. Nunca lanza.
 */
export async function marcarVersionDelChat(input: {
  workspaceId: string;
  conversationId: string;
  productoClave: string | null | undefined;
}): Promise<boolean> {
  try {
    if (!input.productoClave || !input.conversationId || !(await embudoActivo(input.workspaceId))) return false;
    if (await prisma.embudoChatVersion.findUnique({ where: { conversationId: input.conversationId }, select: { conversationId: true } })) {
      return false;
    }
    const [config, playbooks] = await Promise.all([
      leerConfigEmbudo(input.workspaceId),
      prisma.productPlaybook.findMany({
        where: { workspaceId: input.workspaceId },
        select: { productId: true, product: { select: { name: true } } },
      }),
    ]);
    const productId = productoIdDeClave(
      input.productoClave,
      config,
      playbooks.map((playbook) => ({ id: playbook.productId, nombre: playbook.product.name })),
    );
    if (!productId) return false;
    const elegida = await elegirVersionParaChat(input.workspaceId, productId);
    if (!elegida) return false;
    const { count } = await prisma.embudoChatVersion.createMany({
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
    return count > 0;
  } catch (error) {
    anotarError("no se pudo marcar el chat", error, { conversationId: input.conversationId });
    return false;
  }
}

/** La lista de versiones de un producto (la más nueva primero), con cuántos chats tiene cada una. */
export async function listarVersiones(workspaceId: string, productId: string) {
  const versiones = await prisma.embudoVersion.findMany({
    where: { workspaceId, productId },
    orderBy: { numero: "desc" },
    select: { id: true, numero: true, nota: true, quienNombre: true, origen: true, creadoEn: true },
  });
  const conteos = await prisma.embudoChatVersion.groupBy({
    by: ["versionId"],
    where: { workspaceId, productId },
    _count: { _all: true },
  });
  const porVersion = new Map(conteos.map((fila) => [fila.versionId, fila._count._all]));
  return versiones.map((version) => ({ ...version, chats: porVersion.get(version.id) ?? 0 }));
}

/** Una versión completa (la foto de ese momento). */
export async function leerVersion(workspaceId: string, productId: string, numero: number) {
  const version = await prisma.embudoVersion.findFirst({
    where: { workspaceId, productId, numero },
    select: { numero: true, nota: true, quienNombre: true, origen: true, creadoEn: true, contenido: true },
  });
  if (!version) return null;
  const chats = await prisma.embudoChatVersion.count({ where: { workspaceId, productId, numero } });
  return { ...version, chats };
}
