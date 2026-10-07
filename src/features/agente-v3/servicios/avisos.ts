import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { autoAssignConversationToCollaborator, avisarAsignacionPorPush } from "@/lib/reparto-de-leads";
import { prisma } from "@/lib/prisma";

/**
 * AVISARLE A LA ASESORA POR WHATSAPP cuando el agente levanta la mano.
 *
 * Antes esto era una notificación push del navegador. Alex la quitó (25-09-2026) porque depende
 * de que cada persona le haya dado permiso al navegador, y si no lo dio —que es lo normal— el
 * aviso no le llega a nadie y el lead se enfría esperando. Un WhatsApp sí llega siempre.
 *
 * Cada número recibe SOLO lo suyo: el de una asesora, los chats que tiene asignados; el de un
 * administrador, todos. Así nadie vive con el teléfono sonando por conversaciones que no atiende.
 *
 * Sale por la MISMA línea del chat (Ventas 1, Ventas 2, Admin), desde el 05-10-2026 a pedido de
 * Alex. Antes salía siempre por Admin. Los números de cada persona se editan en Mi empresa → Equipo.
 */

const CLAVE = "agente-v3:avisos:";

/** No se le manda el mismo chat dos veces seguidas: el teléfono de una asesora no es un log. */
const ESPERA_ENTRE_AVISOS_MS = 10 * 60_000;

export type DestinoDeAviso = {
  numero: string;
  /** Nombre de quien lo recibe, para poder leer la configuración sin adivinar. */
  nombre?: string;
  /**
   * Id del usuario cuyos chats le interesan. `null` = administrador: recibe todos.
   */
  soloDe: string | null;
  /** De quien es el numero, cuando se cargo desde Mi empresa → Equipo (sirve para editarlo). */
  userId?: string;
};

/**
 * Un numero de WhatsApp como lo escribe la gente ("+58 416-9102943", "300 265 6414") a solo
 * digitos con codigo de pais. Diez digitos que empiezan en 3 son un celular de Colombia: se les
 * pone el 57. Devuelve null si no parece un numero.
 */
export function normalizarNumeroDeAviso(valor: string): string | null {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length === 10 && digitos.startsWith("3")) {
    return `57${digitos}`;
  }
  return digitos.length >= 11 && digitos.length <= 15 ? digitos : null;
}

/** El numero de avisos de una persona del equipo, si lo tiene. */
export function numeroDeAvisosDe(config: ConfigDeAvisos | null, userId: string): string {
  return (
    config?.destinos.find((destino) => destino.userId === userId || destino.soloDe === userId)?.numero ?? ""
  );
}

export type ConfigDeAvisos = {
  /** Canal por el que salen los avisos. Vacío = no se manda nada. */
  canalId: string;
  destinos: DestinoDeAviso[];
  activo: boolean;
};

export async function leerConfigDeAvisos(workspaceId: string): Promise<ConfigDeAvisos | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${workspaceId}` } });
  if (!fila?.value) {
    return null;
  }
  try {
    const guardado = JSON.parse(fila.value) as Partial<ConfigDeAvisos>;
    if (!guardado.canalId || !Array.isArray(guardado.destinos)) {
      return null;
    }
    return {
      canalId: guardado.canalId,
      activo: guardado.activo !== false,
      destinos: guardado.destinos
        .filter((destino): destino is DestinoDeAviso => typeof destino?.numero === "string")
        .map((destino) => ({
          numero: destino.numero.replace(/\D/g, ""),
          nombre: destino.nombre,
          soloDe: typeof destino.soloDe === "string" ? destino.soloDe : null,
          ...(typeof destino.userId === "string" ? { userId: destino.userId } : {}),
        }))
        .filter((destino) => destino.numero.length >= 10),
    };
  } catch {
    return null;
  }
}

export async function guardarConfigDeAvisos(workspaceId: string, config: ConfigDeAvisos): Promise<void> {
  const key = `${CLAVE}${workspaceId}`;
  const value = JSON.stringify(config);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  numerosDelEquipoCache.delete(workspaceId);
}

/*
  ¿Este telefono es de alguien del equipo (esta en la lista de avisos)?

  Desde el 05-10-2026 el aviso sale por la MISMA linea del chat (Ventas 1, Ventas 2...), no por
  Admin. Eso deja el chat con la asesora dentro de una linea de ventas, donde atiende el agente: si
  ella contestaba "ok" al aviso, el agente le respondia como a una clienta. El webhook pregunta esto
  para no atender ni repartir esos chats. Se cachea un minuto: se consulta en cada mensaje entrante.
*/
const numerosDelEquipoCache = new Map<string, { numeros: Set<string>; vence: number }>();

export async function esNumeroDelEquipo(workspaceId: string, telefono: string | null | undefined): Promise<boolean> {
  const limpio = (telefono ?? "").replace(/\D/g, "");
  if (limpio.length < 10) {
    return false;
  }
  let guardado = numerosDelEquipoCache.get(workspaceId);
  if (!guardado || guardado.vence < Date.now()) {
    const config = await leerConfigDeAvisos(workspaceId).catch(() => null);
    guardado = {
      numeros: new Set((config?.destinos ?? []).map((destino) => destino.numero)),
      vence: Date.now() + 60_000,
    };
    numerosDelEquipoCache.set(workspaceId, guardado);
  }
  return guardado.numeros.has(limpio);
}

/**
 * Manda el aviso a quien corresponda. Nunca lanza: un aviso que falla no puede tumbar la
 * conversación con el cliente, que es lo que de verdad importa.
 */
export async function avisarAsesorPorWhatsApp(input: {
  workspaceId: string;
  conversationId: string;
  motivo: string;
  /** Cómo se llama el cliente, o su número si no tiene nombre. */
  cliente: string;
  telefonoDelCliente: string;
}): Promise<number> {
  // A quién se le repartió el chat en ESTE aviso, y si le llegó su WhatsApp (ver el `finally`).
  let asignadaAhoraA: string | null = null;
  let llegoALaAsesora = false;
  try {
    const config = await leerConfigDeAvisos(input.workspaceId);
    if (!config?.activo || config.destinos.length === 0) {
      return 0;
    }

    /*
      Si el chat no tiene dueño, se reparte AHORA.

      Este es el momento que Alex eligio para el reparto (25-09-2026): cuando el agente levanta la
      mano, no cuando entra el lead. Y tiene que pasar ANTES de mirar a quien avisar, porque el
      aviso va justamente a la asesora que acaba de recibirlo.
    */
    let conversacion = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { assignedToUserId: true, channelId: true, numero: true },
    });

    if (conversacion && !conversacion.assignedToUserId && conversacion.channelId) {
      /*
        Sin push del reparto: este aviso ya le manda WhatsApp a la asesora. Si ese WhatsApp no le
        llega (no tiene número cargado, la línea no envía, antirrepetición), el `finally` de abajo
        le manda el push "Nuevo chat asignado" para que no se entere horas después.
      */
      asignadaAhoraA = await autoAssignConversationToCollaborator({
        conversationId: input.conversationId,
        channelId: conversacion.channelId,
        workspaceId: input.workspaceId,
        avisarPorPush: false,
      }).catch(() => null);
      conversacion = await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { assignedToUserId: true, channelId: true, numero: true },
      });
    }

    /*
      Sale por la MISMA linea del chat (Alex, 05-10-2026): un chat de Ventas 1 avisa desde Ventas
      1, uno de Admin desde Admin. Asi la asesora ve de que numero viene el cliente. La linea de la
      configuracion queda solo de respaldo, si la del chat no puede enviar.
    */
    const lineasPosibles = [conversacion?.channelId, config.canalId].filter(
      (id): id is string => Boolean(id),
    );
    const lineas = await prisma.whatsAppChannel.findMany({
      where: { id: { in: lineasPosibles }, workspaceId: input.workspaceId },
      select: { id: true, evolutionInstanceName: true },
    });
    const canal =
      lineas.find((linea) => linea.id === conversacion?.channelId && linea.evolutionInstanceName) ??
      lineas.find((linea) => linea.id === config.canalId && linea.evolutionInstanceName) ??
      null;
    if (!canal?.evolutionInstanceName) {
      console.warn("[avisos] ninguna linea sirve para enviar", { lineasPosibles });
      return 0;
    }

    /*
      El aviso va SOLO a quien le toca: la asesora que tiene ese chat, y los administradores.
      Si el chat no está asignado, lo reciben únicamente los administradores — no tiene sentido
      despertarle el teléfono a una asesora por un lead que no es suyo.
    */
    const duenoDelChat = conversacion?.assignedToUserId ?? null;
    const destinos = config.destinos.filter(
      (destino) => destino.soloDe === null || (duenoDelChat !== null && destino.soloDe === duenoDelChat),
    );
    if (destinos.length === 0) {
      return 0;
    }

    /*
      Antirrepetición: el mismo chat no vuelve a avisar hasta que pase el rato.

      Va en su propia fila y no en el estado del agente a propósito: el estado lo reescribe el
      motor al terminar el turno, y pisaría esta marca sin enterarse.
    */
    const claveDelUltimo = `agente-v3:ultimo-aviso:${input.conversationId}`;
    const filaDelUltimo = await prisma.appSetting.findUnique({ where: { key: claveDelUltimo } });
    const ultimo = filaDelUltimo?.value ? Date.parse(filaDelUltimo.value) : 0;
    if (ultimo && Date.now() - ultimo < ESPERA_ENTRE_AVISOS_MS) {
      return 0;
    }

    /*
      Link corto con el numero del chat (Alex, 03-10-2026): el largo -con la clave entera del chat-
      ocupaba dos renglones del aviso. /c/1234 abre el mismo chat. Si el chat todavia no tiene
      numero (no deberia pasar: la base lo pone al crearlo), va el link largo de siempre.
    */
    const enlace = conversacion?.numero
      ? `https://app.aizenbot.com/c/${conversacion.numero}`
      : `https://app.aizenbot.com/cliente/chats?chatKey=agent:${input.conversationId}&assigned=all`;
    /*
      Al ADMINISTRADOR se le dice a quien le toco; a la asesora no hace falta.

      Un administrador ve todos los avisos y lo primero que quiere saber es quien lo esta
      atendiendo, para no ir a preguntar ni terminar atendiendolo el (Alex, 26-09-2026). La
      asesora que lo recibe ya sabe que es suyo: leer su propio nombre ahi solo estorba.
    */
    const asesora = duenoDelChat
      ? await prisma.user
          .findUnique({ where: { id: duenoDelChat }, select: { name: true, email: true } })
          .catch(() => null)
      : null;
    const nombreDeLaAsesora = asesora?.name?.trim() || asesora?.email || null;

    const encabezado = [
      "🔔 *Necesita atención*",
      "",
      `👤 ${input.cliente}`,
      `📱 ${input.telefonoDelCliente}`,
      `📌 ${input.motivo}`,
    ];
    const textoParaAsesora = [...encabezado, "", enlace].join("\n");
    const textoParaAdministrador = [
      ...encabezado,
      `*Asignado a:* ${nombreDeLaAsesora ?? "nadie todavia"}`,
      "",
      enlace,
    ].join("\n");

    let enviados = 0;
    for (const destino of destinos) {
      try {
        await sendEvolutionTextMessageWithReconnect({
          instanceName: canal.evolutionInstanceName,
          phoneNumber: destino.numero,
          text: destino.soloDe === null ? textoParaAdministrador : textoParaAsesora,
        });
        enviados += 1;
        if (destino.soloDe !== null && destino.soloDe === asignadaAhoraA) {
          llegoALaAsesora = true;
        }
      } catch (error) {
        console.warn("[avisos] no se pudo avisar", {
          numero: destino.numero,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (enviados > 0) {
      const ahora = new Date().toISOString();
      await prisma.appSetting
        .upsert({ where: { key: claveDelUltimo }, create: { key: claveDelUltimo, value: ahora }, update: { value: ahora } })
        .catch(() => {});
    }

    return enviados;
  } catch (error) {
    console.error("[avisos] fallo el aviso al asesor", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  } finally {
    // El chat se le acaba de repartir y su WhatsApp no le llegó: que se entere por push.
    if (asignadaAhoraA && !llegoALaAsesora) {
      void avisarAsignacionPorPush({ conversationId: input.conversationId, userId: asignadaAhoraA });
    }
  }
}
