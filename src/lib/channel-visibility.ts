import { prisma } from "@/lib/prisma";

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
 */

function leerColaboradores(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  const valor = (metadata as Record<string, unknown>).collaboratorIds;
  return Array.isArray(valor) ? valor.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Devuelve los ids de canal visibles, o `null` cuando la persona ve TODO (jefe). El null es a
 * proposito: obliga a distinguir "ve todo" de "no ve ninguno", que con una lista vacia se
 * confunden y terminan dejando a alguien sin bandeja.
 */
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
