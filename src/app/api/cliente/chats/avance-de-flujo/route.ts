import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { canalesQueMonitorea } from "@/lib/modo-monitoreo";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { esSupervisora } from "@/lib/permisos-del-equipo";
import { puedeAbrirChatPorClave } from "@/lib/chats-acceso-por-enlace";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { leerPasosGuardados } from "@/lib/flujos/procesar-envio-de-flujo";
import {
  MAXIMO_DE_ENVIOS,
  MOSTRAR_EN_CURSO_POR_MS,
  armarAvance,
  debeMostrarse,
  type AvanceDeFlujo,
} from "@/lib/flujos/avance-de-flujo";

/*
  SOLO LECTURA: el avance de los flujos que está mandando el servidor a un chat (parte 3 de «Flujos:
  que se envíen completos aunque la asesora cambie de chat, y al instante»). No manda nada ni cambia
  nada: no es una ruta de envío (no va en RUTAS_DE_ENVIO de src/lib/chats/ruta-de-envio.ts).

  GET ?conversationId=<id pelado del chat> → { ok: true, envios: AvanceDeFlujo[] }: los EnvioDeFlujo
  de ese chat que están EN_CURSO o que terminaron CON_FALLAS hace poco. La franja de la caja de
  escribir lo consulta cada 1,5 s mientras haya uno en curso, en TODAS las pantallas con ese chat
  abierto.

  De cada paso sale su estado, su tipo y su error; nunca el contenido.

  Quien pide tiene que poder abrir el chat (las mismas reglas que /live). Esa revisión se hace solo si
  hay algo que devolver: casi siempre no hay envíos y se contesta con una sola lectura. Un chat ajeno
  contesta lo mismo que un chat sin envíos.
*/
export const dynamic = "force-dynamic";

/** El título de cada flujo, por negocio, un minuto: la franja pregunta cada 1,5 s y los flujos casi no cambian. */
const TITULOS_POR_MS = 60_000;
const titulosPorNegocio = new Map<string, { hasta: number; titulos: Map<string, string> }>();

async function titulosDeFlujos(workspaceId: string): Promise<Map<string, string>> {
  const guardado = titulosPorNegocio.get(workspaceId);
  if (guardado && guardado.hasta > Date.now()) return guardado.titulos;
  const items = await getCreatedFlowItems({ workspaceId, includeOfficialApi: true }).catch(() => []);
  const titulos = new Map(items.map((item) => [item.id, item.title?.trim() || "Flujo sin nombre"]));
  titulosPorNegocio.set(workspaceId, { hasta: Date.now() + TITULOS_POR_MS, titulos });
  return titulos;
}

const SIN_ENVIOS = { ok: true, envios: [] as AvanceDeFlujo[] };

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const userId = session.user.id;
  const access = await getClientWorkspaceAccessForUserCached(userId);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }
  const workspaceId = access.workspaceId;

  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim() || "";
  if (!conversationId || conversationId.length > 100) {
    return NextResponse.json({ ok: false, error: "Chat invalido" }, { status: 400 });
  }

  const ahora = Date.now();
  const filas = await prisma.envioDeFlujo.findMany({
    where: {
      workspaceId,
      conversationId,
      estado: { in: ["EN_CURSO", "CON_FALLAS"] },
      startedAt: { gte: new Date(ahora - MOSTRAR_EN_CURSO_POR_MS) },
    },
    orderBy: { startedAt: "desc" },
    take: MAXIMO_DE_ENVIOS,
    select: { id: true, source: true, flowId: true, estado: true, pasos: true, startedAt: true, finishedAt: true },
  });
  const visibles = filas.filter((fila) => debeMostrarse(fila, ahora));
  if (visibles.length === 0) {
    return NextResponse.json(SIN_ENVIOS);
  }

  // Quien pregunta tiene que poder abrir ese chat (mismas reglas que la bandeja y /live).
  const [canalesMonitoreados, esJefe, canalesVisibles] = await Promise.all([
    canalesQueMonitorea({ workspaceId, userId }),
    esJefeDelNegocio(access) ? Promise.resolve(true) : esSupervisora(workspaceId, userId),
    getVisibleChannelIds({ workspaceId, userId, esJefe: access.isOwner || access.role === "ADMIN" }),
  ]);
  const permitido = await puedeAbrirChatPorClave({
    workspaceId,
    userId,
    fuente: visibles[0].source === "official" ? "official" : "agent",
    conversationId,
    esJefe,
    canalesVisibles,
    canalesMonitoreados,
  });
  if (!permitido) {
    return NextResponse.json(SIN_ENVIOS);
  }

  const titulos = await titulosDeFlujos(workspaceId);
  const envios: AvanceDeFlujo[] = [];
  for (const fila of visibles) {
    const pasos = leerPasosGuardados(fila.pasos);
    if (!pasos) continue;
    envios.push(armarAvance(fila, pasos, titulos.get(fila.flowId) ?? "Flujo"));
  }
  return NextResponse.json({ ok: true, envios }, { headers: { "Cache-Control": "no-store" } });
}
