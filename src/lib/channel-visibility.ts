import { prisma } from "@/lib/prisma";
import { leerColaboradores } from "@/lib/channel-collaborators";

/**
 * Que canales puede VER cada persona.
 *
 * Nace de un caso concreto: la linea administrativa (proveedores, logistica, temas de plata). Esa
 * conexion no la tiene que ver ninguna asesora, ni sus chats ni sus leads en el CRM.
 *
 * La lista de Colaboradores de cada canal pasa a significar "quien trabaja este canal": quien no
 * este ahi, no lo ve. Antes solo servia para repartir los leads nuevos por turno; ahora tambien
 * decide la visibilidad, que es lo que uno espera al sacar a alguien de la lista.
 *
 * Dos reglas para que nadie quede afuera por accidente:
 *  - Canal SIN colaboradores: lo ven todos. Es como funciono siempre, asi que los canales que ya
 *    existen no cambian de comportamiento hasta que alguien los configure a proposito.
 *  - El dueño y los administradores ven todo, esten o no en la lista. Si no, alcanzaria con
 *    olvidarse de agregarse para perder el acceso a la propia empresa.
 *
 * Estar EN PAUSA de reparto no afecta la visibilidad: quien esta pausada sigue viendo el canal y
 * atendiendo sus chats, solo deja de recibir leads nuevos (ver channel-collaborators).
 */

/**
 * Devuelve los ids de canal visibles, o `null` cuando la persona ve TODO (jefe). El null es a
 * proposito: obliga a distinguir "ve todo" de "no ve ninguno", que con una lista vacia se
 * confunden y terminan dejando a alguien sin bandeja.
 */
/**
 * Valida la conexión elegida en la bandeja y descarta la que no corresponde.
 *
 * La conexión seleccionada sobrevive entre visitas (queda en la URL / en lo último usado). Si
 * apunta a un canal de OTRO negocio —pasa con cuentas que estuvieron en más de uno—, el filtro se
 * aplica igual y la bandeja queda vacía: cero chats, cero explicación, con la pinta exacta de que
 * el CRM se rompió. Le pasó al dueño con un canal de un workspace viejo homónimo.
 *
 * Ante una conexión que no existe, no es de este negocio o no es visible para esta persona, se
 * cae a "todas las conexiones", que es lo que alguien espera al abrir los chats.
 */
export async function resolverConexionElegida(input: {
  workspaceId: string;
  connectionKey: string;
  visibleChannelIds: string[] | null;
}): Promise<string> {
  const clave = input.connectionKey.trim();
  if (!clave.startsWith("channel:")) {
    return clave;
  }

  const channelId = clave.slice("channel:".length);
  if (!channelId) {
    return "";
  }
  if (input.visibleChannelIds && !input.visibleChannelIds.includes(channelId)) {
    return "";
  }

  const canal = await prisma.whatsAppChannel.findFirst({
    where: { id: channelId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  return canal ? clave : "";
}

export async function getVisibleChannelIds(input: {
  workspaceId: string;
  userId: string;
  esJefe: boolean;
}): Promise<string[] | null> {
  if (input.esJefe) {
    return null;
  }

  const canales = await prisma.whatsAppChannel.findMany({
    where: { workspaceId: input.workspaceId },
    select: { id: true, metadata: true },
  });

  return canales
    .filter((canal) => {
      const colaboradores = leerColaboradores(canal.metadata);
      return colaboradores.length === 0 || colaboradores.includes(input.userId);
    })
    .map((canal) => canal.id);
}
