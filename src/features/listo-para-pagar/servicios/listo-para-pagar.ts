import { leerEstado } from "@/features/agente-v3/motor/estado";
import {
  leerConfigDeAvisos,
  normalizarNumeroDeAviso,
  numeroDeAvisosDe,
} from "@/features/agente-v3/servicios/avisos";
import {
  TITULO_PARA_EL_LIDER,
  VIDA_DE_LA_MARCA_MS,
  armarAvisoParaElLider,
  decidirMarca,
  mensajeDeCierre,
  type EstadoDeLaMarca,
} from "@/features/listo-para-pagar/dominio/senal";
import { enHorario } from "@/features/supervisor/dominio/detectores-atencion";
import { decidirViaDeAvisos } from "@/lib/anti-bloqueo/reglas";
import { leerConfigAntiBloqueo } from "@/lib/anti-bloqueo/servicio";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { resolverLiderDeVentas } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";
import { ORIGENES_HUMANOS } from "@/lib/turno-de-la-conversacion";
import { sendPushToUser } from "@/lib/web-push";

/**
 * El mensaje de cierre con el 50 % del producto que el cliente está mirando (el `productoActivo`
 * del estado del V3). Si no hay producto o algo falla, sale el mensaje sin cifra. Nunca lanza.
 */
export async function leerMensajeDeCierre(workspaceId: string, conversationId: string): Promise<string> {
  try {
    const estado = await leerEstado(conversationId);
    if (!estado.productoActivo) {
      return mensajeDeCierre(null);
    }
    const producto = await prisma.product.findFirst({
      where: { id: estado.productoActivo, workspaceId },
      select: { price: true },
    });
    return mensajeDeCierre(producto ? Number(producto.price) : null);
  } catch {
    return mensajeDeCierre(null);
  }
}

/* ------------------------------------------------------------------------------------------------
   PARTE 3: si nadie del equipo escribe en el chat en 5 minutos (en horario de trabajo), el aviso
   "Listo para pagar" le llega al líder de ventas.

   Cuando sale el aviso a la asesora queda una marca en su propia fila de AppSetting
   (`listo-para-pagar:<chat>`). El reloj (cron/follows) la revisa cada minuto: si alguien del equipo
   escribió, queda "atendido"; a las 24 h se cierra; si no, a los 5 minutos se escala. Al cliente no
   se le manda nada: todo va al equipo.
------------------------------------------------------------------------------------------------ */

const PREFIJO = "listo-para-pagar:";
/** Máximo de escalados por vuelta: el resto queda para la siguiente (sin ráfaga al abrir el horario). */
const MAXIMO_DE_ESCALADOS_POR_VUELTA = 5;

type Marca = {
  workspaceId: string;
  conversationId: string;
  asesoraId: string | null;
  avisadoEn: string;
  estado: EstadoDeLaMarca;
};

function leerMarca(valor: string | null | undefined): Marca | null {
  if (!valor) {
    return null;
  }
  try {
    const marca = JSON.parse(valor) as Partial<Marca>;
    if (
      typeof marca.workspaceId !== "string" ||
      typeof marca.conversationId !== "string" ||
      typeof marca.avisadoEn !== "string" ||
      typeof marca.estado !== "string"
    ) {
      return null;
    }
    return {
      workspaceId: marca.workspaceId,
      conversationId: marca.conversationId,
      asesoraId: typeof marca.asesoraId === "string" ? marca.asesoraId : null,
      avisadoEn: marca.avisadoEn,
      estado: marca.estado,
    };
  } catch {
    return null;
  }
}

async function escribirMarca(marca: Marca): Promise<void> {
  const key = `${PREFIJO}${marca.conversationId}`;
  const value = JSON.stringify(marca);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Deja la marca "pendiente" cuando sale (o se intenta) el aviso "Listo para pagar" a la asesora.
 * No pisa una marca "pendiente" ni una "escalado" de menos de 24 h: una repetición no reinicia el
 * reloj ni le vuelve a avisar al líder.
 */
export async function guardarMarcaListoParaPagar(input: {
  workspaceId: string;
  conversationId: string;
  asesoraId: string | null;
  ahora?: Date;
}): Promise<void> {
  const ahora = input.ahora ?? new Date();
  const fila = await prisma.appSetting.findUnique({ where: { key: `${PREFIJO}${input.conversationId}` } });
  const previa = leerMarca(fila?.value);
  if (previa && (previa.estado === "pendiente" || previa.estado === "escalado")) {
    const desde = Date.parse(previa.avisadoEn);
    if (Number.isFinite(desde) && ahora.getTime() - desde < VIDA_DE_LA_MARCA_MS) {
      return;
    }
  }
  await escribirMarca({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    asesoraId: input.asesoraId,
    avisadoEn: ahora.toISOString(),
    estado: "pendiente",
  });
}

/** ¿Alguien del equipo (CRM o teléfono) escribió en el chat después del aviso? */
async function huboRespuestaHumana(conversationId: string, desde: Date): Promise<boolean> {
  const mensaje = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      type: { not: "SYSTEM" },
      createdAt: { gt: desde },
      OR: ORIGENES_HUMANOS.map((origen) => ({ rawPayload: { path: ["source"], equals: origen } })),
    },
    select: { id: true },
  });
  return Boolean(mensaje);
}

/** Le pasa el aviso al líder: push siempre y WhatsApp si hay número y línea. Nunca lanza. */
async function avisarAlLider(marca: Marca): Promise<"escalado" | "sin_destino"> {
  const liderId = await resolverLiderDeVentas(marca.workspaceId).catch(() => null);
  if (!liderId) {
    console.warn("[listo-para-pagar] no hay lider de ventas para escalar", {
      workspaceId: marca.workspaceId,
      conversationId: marca.conversationId,
    });
    return "sin_destino";
  }

  // Primero queda escalado: así, pase lo que pase con el envío, nunca se repite.
  await escribirMarca({ ...marca, estado: "escalado" });

  try {
    const [conversacion, asesora, cierre] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: marca.conversationId },
        select: { numero: true, channelId: true, contact: { select: { name: true, phoneNumber: true } } },
      }),
      marca.asesoraId
        ? prisma.user.findUnique({ where: { id: marca.asesoraId }, select: { name: true, email: true } })
        : Promise.resolve(null),
      leerMensajeDeCierre(marca.workspaceId, marca.conversationId),
    ]);
    const cliente = conversacion?.contact?.name?.trim() || conversacion?.contact?.phoneNumber?.trim() || "Cliente";
    const nombreDeLaAsesora = asesora?.name?.trim() || asesora?.email || null;
    // Link corto con el número del chat, como en avisos.ts.
    const enlace = conversacion?.numero
      ? `https://app.aizenbot.com/c/${conversacion.numero}`
      : `https://app.aizenbot.com/cliente/chats?chatKey=agent:${marca.conversationId}&assigned=all`;

    await sendPushToUser({
      userId: liderId,
      payload: {
        title: TITULO_PARA_EL_LIDER,
        body: [`${cliente}: ${cierre}`, `Asesora: ${nombreDeLaAsesora ?? "nadie todavía"}`].join("\n").slice(0, 300),
        tag: `listo-para-pagar:${marca.conversationId}`,
        url: `/cliente/chats?chatKey=agent:${marca.conversationId}&assigned=all`,
      },
    }).catch(() => 0);

    // WhatsApp por la línea interna del equipo (nunca la de ventas del chat). Con via "push", solo push.
    const [config, antiBloqueo] = await Promise.all([
      leerConfigDeAvisos(marca.workspaceId).catch(() => null),
      leerConfigAntiBloqueo(marca.workspaceId),
    ]);
    const via = decidirViaDeAvisos({
      avisos: { ...antiBloqueo.avisos, via: antiBloqueo.avisos.via === "push" ? "push" : "linea_interna" },
      canalDelChat: conversacion?.channelId ?? null,
      canalDeLaConfig: config?.canalId || null,
    });
    const numero = normalizarNumeroDeAviso(numeroDeAvisosDe(config, liderId));
    if (via.tipo !== "whatsapp" || !numero || via.canales.length === 0) {
      return "escalado";
    }
    const linea = await prisma.whatsAppChannel.findFirst({
      where: { id: via.canales[0], workspaceId: marca.workspaceId },
      select: { evolutionInstanceName: true },
    });
    if (!linea?.evolutionInstanceName) {
      return "escalado";
    }
    await sendEvolutionTextMessageWithReconnect({
      instanceName: linea.evolutionInstanceName,
      phoneNumber: numero,
      text: armarAvisoParaElLider({ cliente, asesora: nombreDeLaAsesora, enlace, cierre }),
    });
  } catch (error) {
    console.warn("[listo-para-pagar] no se pudo avisar al lider", {
      conversationId: marca.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return "escalado";
}

/**
 * La vuelta del reloj: revisa las marcas pendientes y escala las que llevan 5 minutos sin respuesta
 * del equipo, en horario de trabajo. Máximo 5 escalados por vuelta.
 */
export async function revisarListoParaPagar(
  ahora: Date = new Date(),
): Promise<{ revisadas: number; escalados: number; atendidos: number; cerrados: number }> {
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: PREFIJO }, value: { contains: '"estado":"pendiente"' } },
    select: { key: true, value: true },
    orderBy: { updatedAt: "asc" },
  });
  const resultado = { revisadas: filas.length, escalados: 0, atendidos: 0, cerrados: 0 };
  const horario = enHorario(ahora);

  for (const fila of filas) {
    const marca = leerMarca(fila.value);
    if (!marca) {
      continue;
    }
    try {
      const avisadoEn = new Date(marca.avisadoEn);
      // Solo se consulta la base si podría cambiar algo (pendiente y no vencida).
      const respondio =
        marca.estado === "pendiente" && Number.isFinite(avisadoEn.getTime())
          ? await huboRespuestaHumana(marca.conversationId, avisadoEn)
          : false;
      const decision = decidirMarca({
        estado: marca.estado,
        avisadoEn,
        ahora,
        huboRespuestaHumana: respondio,
        enHorario: horario,
      });
      if (decision === "atendido") {
        await escribirMarca({ ...marca, estado: "atendido" });
        resultado.atendidos += 1;
      } else if (decision === "cerrar") {
        await escribirMarca({ ...marca, estado: "cerrado" });
        resultado.cerrados += 1;
      } else if (decision === "escalar") {
        if (resultado.escalados >= MAXIMO_DE_ESCALADOS_POR_VUELTA) {
          continue;
        }
        const final = await avisarAlLider(marca);
        if (final === "sin_destino") {
          await escribirMarca({ ...marca, estado: "sin_destino" });
        } else {
          resultado.escalados += 1;
        }
      }
    } catch (error) {
      console.warn("[listo-para-pagar] no se pudo revisar la marca", {
        conversationId: marca.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return resultado;
}
