import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";
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
 * Sale por la línea que diga la configuración —la de Admin, no la de ventas— a propósito: si
 * WhatsApp llegara a restringir algo por el volumen de avisos, que sea la línea administrativa y
 * no la que está vendiendo.
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
};

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
  try {
    const config = await leerConfigDeAvisos(input.workspaceId);
    if (!config?.activo || config.destinos.length === 0) {
      return 0;
    }

    const canal = await prisma.whatsAppChannel.findFirst({
      where: { id: config.canalId, workspaceId: input.workspaceId },
      select: { evolutionInstanceName: true },
    });
    if (!canal?.evolutionInstanceName) {
      console.warn("[avisos] el canal configurado no sirve para enviar", { canalId: config.canalId });
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
      select: { assignedToUserId: true, channelId: true },
    });

    if (conversacion && !conversacion.assignedToUserId && conversacion.channelId) {
      await autoAssignConversationToCollaborator({
        conversationId: input.conversationId,
        channelId: conversacion.channelId,
        workspaceId: input.workspaceId,
      }).catch(() => {});
      conversacion = await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { assignedToUserId: true, channelId: true },
      });
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

    const enlace = `https://app.aizenbot.com/cliente/chats?chatKey=agent:${input.conversationId}&assigned=all`;
    const texto = [
      "🔔 *Un cliente necesita atención*",
      "",
      `👤 ${input.cliente}`,
      `📱 ${input.telefonoDelCliente}`,
      `📌 ${input.motivo}`,
      "",
      enlace,
    ].join("\n");

    let enviados = 0;
    for (const destino of destinos) {
      try {
        await sendEvolutionTextMessageWithReconnect({
          instanceName: canal.evolutionInstanceName,
          phoneNumber: destino.numero,
          text: texto,
        });
        enviados += 1;
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
  }
}
