/*
  EL SERVIDOR MANDA EL FLUJO SOLO (parte 2 de «Flujos: que se envíen completos aunque la asesora
  cambie de chat, y al instante»).

  Antes el flujo salía DENTRO del pedido de la asesora: si cambiaba de chat o cerraba la pestaña a la
  mitad, los pasos que faltaban no salían, y ella esperaba todas las pausas mirando la pantalla. Ahora
  «Enviar flujo» solo guarda una fila EnvioDeFlujo y contesta al instante; esta función la manda paso
  por paso desde el servidor (en after() de la acción, o en el cron si el proceso se cayó).

  - Candado: dos procesos nunca mandan el mismo envío. Se toma con un updateMany condicional y se
    renueva mientras se manda; si nadie lo renueva en VENCIMIENTO_DEL_CANDADO_MS, el cron lo retoma.
  - La sesión guardada (el userId de la fila), el permiso a Chats, el chat y el modo monitoreo se
    revisan UNA vez, al empezar. Después se manda con el permiso interno (permiso-de-envio-interno.ts).
  - Cada paso se marca «enviando» y se guarda ANTES de mandarlo, y «enviado» o «fallido» cuando el
    gateway contesta. Si el servidor se cae en el medio, `retomar` deja ese paso «fallido» con «no se
    sabe si salió»: nunca se reenvía solo (mandarle dos veces el catálogo es peor que no mandarlo).
  - Ningún mensaje nuevo ni distinto: salen los pasos del flujo tal cual, por los mismos caminos del
    compositor (texto sin firma; archivo por su dirección).
*/
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { AVISO_MODO_MONITOREO, estaEnModoMonitoreo } from "@/lib/modo-monitoreo";
import { emitirPermisoDeEnvioInterno, type PermisoDeEnvioInterno } from "@/lib/chats/permiso-de-envio-interno";
import { enviarArchivoAlChatSinPermisos } from "@/app/actions/agent-actions";
import { enviarTextoAlChatSinPermisos } from "@/app/actions/chats-actions";
import { describirArchivo } from "@/lib/flujos/describir-archivo";
import {
  calcularAvance,
  estadoFinal,
  lineaDeMedicion,
  marcarEnviado,
  marcarEnviando,
  marcarFallido,
  pausaTras,
  retomar,
  siguientePaso,
  type EstadoDePaso,
  type MedicionDePaso,
  type PasoDeEnvio,
} from "@/lib/flujos/envio-de-flujo";

/** Si el candado no se renueva en este tiempo, el proceso que lo tenía se dio por caído. */
export const VENCIMIENTO_DEL_CANDADO_MS = 2 * 60_000;
/** Cada cuánto renueva el candado el proceso que está mandando (bien por debajo del vencimiento). */
const RENOVAR_CANDADO_MS = 30_000;
/**
 * El cron solo retoma envíos de la última media hora: un catálogo que le llega a la clienta horas
 * después, sin que nadie lo vea salir, confunde más de lo que ayuda. Los más viejos quedan cerrados
 * con sus pasos pendientes como fallidos, para que la asesora los vea y decida.
 */
export const RETOMAR_HASTA_MS = 30 * 60_000;
const ERROR_SIN_PERMISO = "La asesora ya no tiene permiso para mandar en Chats";
const ERROR_CHAT_NO_ENCONTRADO = "No se encontró el chat";
const ERROR_MUY_VIEJO = "Se quedó sin enviar: vuelve a mandar el flujo";

const ESTADOS: ReadonlySet<EstadoDePaso> = new Set(["pendiente", "enviando", "enviado", "fallido", "omitido"]);

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lee la lista de pasos guardada; null si no tiene la forma esperada (nunca se manda algo raro). */
export function leerPasosGuardados(valor: unknown): PasoDeEnvio[] | null {
  if (!Array.isArray(valor)) return null;
  for (const paso of valor) {
    if (
      typeof paso !== "object" ||
      paso === null ||
      typeof paso.indice !== "number" ||
      !ESTADOS.has(paso.estado) ||
      typeof paso.contenido !== "object" ||
      paso.contenido === null ||
      paso.contenido.kind !== paso.tipo
    ) {
      return null;
    }
  }
  return [...(valor as PasoDeEnvio[])].sort((a, b) => a.indice - b.indice);
}

/** Todo lo que quedó sin mandar pasa a fallido con ese motivo (cuando no se puede seguir). */
function cerrarPendientes(pasos: PasoDeEnvio[], motivo: string): PasoDeEnvio[] {
  return retomar(pasos).map((paso) => (paso.estado === "pendiente" ? { ...paso, estado: "fallido", error: motivo } : paso));
}

async function chatDelNegocio(input: { source: string; conversationId: string; workspaceId: string }) {
  if (input.source === "official") {
    const conversacion = await prisma.officialApiConversation.findFirst({
      where: { id: input.conversationId, config: { workspaceId: input.workspaceId } },
      select: { id: true },
    });
    return Boolean(conversacion);
  }
  const conversacion = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  return Boolean(conversacion);
}

/** Revisa UNA vez la sesión guardada: el rol, el negocio, el permiso a Chats y el modo monitoreo. */
async function revisarPermiso(envio: {
  userId: string;
  workspaceId: string;
  source: string;
  conversationId: string;
}): Promise<{ ok: true; permiso: PermisoDeEnvioInterno } | { ok: false; error: string }> {
  const acceso = await getClientWorkspaceAccessForUser(envio.userId);
  if (
    !acceso ||
    !["ADMIN", "CLIENTE", "EMPLEADO"].includes(acceso.role) ||
    acceso.workspaceId !== envio.workspaceId ||
    !canAccessClientModule(acceso, "chats")
  ) {
    return { ok: false, error: ERROR_SIN_PERMISO };
  }
  if (await estaEnModoMonitoreo({ workspaceId: envio.workspaceId, userId: envio.userId })) {
    return { ok: false, error: AVISO_MODO_MONITOREO };
  }
  if (!(await chatDelNegocio(envio))) {
    return { ok: false, error: ERROR_CHAT_NO_ENCONTRADO };
  }
  return { ok: true, permiso: emitirPermisoDeEnvioInterno({ userId: envio.userId, workspaceId: envio.workspaceId }) };
}

/** Manda UN paso y espera la respuesta del gateway. Nunca lanza: devuelve el resultado. */
async function mandarPaso(
  paso: PasoDeEnvio,
  envio: { source: string; conversationId: string; agentId: string | null },
  permiso: PermisoDeEnvioInterno,
): Promise<{ ok: true; mensajeId: string | null } | { ok: false; error: string }> {
  let mensajeId: string | null = null;
  const anotar = (id: string | null) => {
    mensajeId = id;
  };
  const source = envio.source === "official" ? "official" : "agent";
  const contenido = paso.contenido;
  try {
    if (contenido.kind === "text") {
      const resultado = await enviarTextoAlChatSinPermisos(
        permiso,
        { source, conversationId: envio.conversationId, message: contenido.content, agentId: envio.agentId },
        anotar,
      );
      return resultado.ok ? { ok: true, mensajeId } : { ok: false, error: resultado.error };
    }
    if (contenido.kind === "audio") {
      // armarPasos ya lo deja omitido; esto es solo por si llega uno así.
      return { ok: false, error: "El audio no se manda desde el chat" };
    }
    const tipo = contenido.kind === "image" ? "IMAGE" : contenido.kind === "video" ? "VIDEO" : "DOCUMENT";
    // Solo el documento trae nombre propio; la foto y el video lo sacan de la direccion.
    const archivo = describirArchivo(
      contenido.kind,
      contenido.url,
      contenido.kind === "document" ? contenido.fileName : null,
    );
    const resultado = await enviarArchivoAlChatSinPermisos(
      permiso,
      {
        source,
        conversationId: envio.conversationId,
        agentId: envio.agentId ?? undefined,
        mediaUrl: contenido.url,
        mediaType: tipo,
        fileName: archivo.nombre,
        mimeType: archivo.mime,
        caption: contenido.caption?.trim() || undefined,
      },
      anotar,
    );
    return "ok" in resultado ? { ok: true, mensajeId } : { ok: false, error: resultado.error };
  } catch (error) {
    console.error("[flujo] fallo un paso al enviar el flujo", {
      conversationId: envio.conversationId,
      paso: paso.indice,
      tipo: paso.tipo,
      detalle: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "No se pudo enviar" };
  }
}

/**
 * Manda el envío `envioId` paso por paso. Si otro proceso ya lo tiene (candado vigente) o ya terminó,
 * no hace nada. Nunca lanza: un fallo de la base deja el candado vencerse y el cron lo retoma.
 */
export async function procesarEnvioDeFlujo(envioId: string): Promise<void> {
  const quien = `${process.pid}:${randomUUID()}`;
  const inicioTotal = Date.now();
  let renovar: ReturnType<typeof setInterval> | null = null;

  try {
    const tomado = await prisma.envioDeFlujo.updateMany({
      where: {
        id: envioId,
        estado: "EN_CURSO",
        OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - VENCIMIENTO_DEL_CANDADO_MS) } }],
      },
      data: { lockedAt: new Date(), lockedBy: quien },
    });
    if (tomado.count === 0) {
      return;
    }

    renovar = setInterval(() => {
      prisma.envioDeFlujo
        .updateMany({ where: { id: envioId, lockedBy: quien }, data: { lockedAt: new Date() } })
        .catch(() => undefined);
    }, RENOVAR_CANDADO_MS);

    const envio = await prisma.envioDeFlujo.findUnique({ where: { id: envioId } });
    if (!envio) {
      return;
    }

    /** Guarda solo si el candado sigue siendo de este proceso; si no, false y se deja de mandar. */
    const guardar = async (data: Prisma.EnvioDeFlujoUpdateManyMutationInput) => {
      const resultado = await prisma.envioDeFlujo.updateMany({
        where: { id: envioId, lockedBy: quien },
        data: { ...data, lockedAt: new Date() },
      });
      return resultado.count === 1;
    };
    const comoJson = (lista: PasoDeEnvio[]) => lista as unknown as Prisma.InputJsonValue;

    const leidos = leerPasosGuardados(envio.pasos);
    if (!leidos) {
      console.error("[flujo] envio con pasos ilegibles: se cierra sin mandar", { envioId });
      await guardar({ estado: "CON_FALLAS", finishedAt: new Date(), lockedAt: null, lockedBy: null });
      return;
    }

    // Lo que quedó «enviando» de un proceso que se cayó pasa a fallido: nunca se reenvía solo.
    let pasos = retomar(leidos);

    const cerrar = async (lista: PasoDeEnvio[]) => {
      await guardar({
        pasos: comoJson(lista),
        enviados: calcularAvance(lista).enviados,
        estado: estadoFinal(lista),
        finishedAt: new Date(),
      });
      await prisma.envioDeFlujo.updateMany({
        where: { id: envioId, lockedBy: quien },
        data: { lockedAt: null, lockedBy: null },
      });
    };

    if (Date.now() - envio.createdAt.getTime() > RETOMAR_HASTA_MS) {
      await cerrar(cerrarPendientes(pasos, ERROR_MUY_VIEJO));
      return;
    }

    const revision = await revisarPermiso(envio);
    if (!revision.ok) {
      await cerrar(cerrarPendientes(pasos, revision.error));
      return;
    }

    const msPorPaso = new Map<number, number>();
    let anterior: PasoDeEnvio | null = null;

    for (let paso = siguientePaso(pasos); paso; paso = siguientePaso(pasos)) {
      // La pausa corta de la parte 1, entre un paso y el siguiente: WhatsApp entrega mal varias
      // cosas seguidas, y a la clienta le llega más natural que caiga de a poco.
      if (anterior) {
        await esperar(pausaTras(anterior.tipo));
      }

      pasos = marcarEnviando(pasos, paso.indice);
      if (!(await guardar({ pasos: comoJson(pasos) }))) {
        // Otro proceso se quedó con el envío: este no manda nada más.
        return;
      }

      const inicioPaso = Date.now();
      const resultado = await mandarPaso(paso, envio, revision.permiso);
      msPorPaso.set(paso.indice, Date.now() - inicioPaso);

      pasos = resultado.ok
        ? marcarEnviado(pasos, paso.indice, resultado.mensajeId)
        : marcarFallido(pasos, paso.indice, resultado.error);
      if (!(await guardar({ pasos: comoJson(pasos), enviados: calcularAvance(pasos).enviados }))) {
        return;
      }
      anterior = paso;
    }

    await cerrar(pasos);

    const medicion: MedicionDePaso[] = pasos.map((paso) => ({
      tipo: paso.tipo,
      resultado: paso.estado === "enviado" ? "enviado" : paso.estado === "omitido" ? "omitido" : "fallido",
      ms: msPorPaso.get(paso.indice) ?? 0,
    }));
    console.info(
      "[flujo] medicion",
      lineaDeMedicion({
        conversationId: envio.conversationId,
        flowId: envio.flowId,
        pasos: medicion,
        msTotal: Date.now() - inicioTotal,
      }),
    );
  } catch (error) {
    // Sin soltar el candado: se vence solo y el cron lo retoma (lo que quedó «enviando» pasa a fallido).
    console.error("[flujo] el envio se corto", {
      envioId,
      detalle: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (renovar) clearInterval(renovar);
  }
}

/**
 * Para el cron: los envíos EN_CURSO que nadie está mandando (candado vencido, o que nunca arrancaron)
 * se retoman. Lo que estaba «enviando» pasa a fallido (`retomar`) y se sigue con lo pendiente.
 * Uno por uno, en el orden en que se pidieron.
 */
export async function retomarEnviosQuedados(): Promise<{ retomados: number }> {
  const vencido = new Date(Date.now() - VENCIMIENTO_DEL_CANDADO_MS);
  const quedados = await prisma.envioDeFlujo.findMany({
    where: {
      estado: "EN_CURSO",
      OR: [{ lockedAt: { lt: vencido } }, { lockedAt: null, createdAt: { lt: vencido } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take: 20,
  });
  for (const { id } of quedados) {
    await procesarEnvioDeFlujo(id);
  }
  return { retomados: quedados.length };
}
