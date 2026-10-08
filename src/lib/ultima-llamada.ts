import { getCallResultLabel, isPendingCallResult } from "@/features/crm/domain/crm-config";
import { prisma } from "@/lib/prisma";

export type UltimaLlamada = {
  id: string;
  etiqueta: string;
  /** Se hablo pero nadie dijo todavia como quedo: el aviso ofrece clasificarla. */
  pendiente: boolean;
  noContesto: boolean;
  resumen: string | null;
  calledAt: string;
  intento: number;
};

/**
 * La ultima llamada de un contacto, para el aviso de arriba del chat.
 *
 * Una sola consulta (findFirst por workspace + contacto, la mas nueva). La usan la server action
 * del aviso (cuando llega un aviso de llamada nueva) y /api/cliente/chats/live, que la manda
 * junto con los mensajes al abrir el chat: asi el aviso entra en el mismo cuadro que los mensajes,
 * sin una server action aparte en fila (sesion + acceso + esta misma consulta) ni salto.
 *
 * Quien llama decide el permiso (modulo "llamadas"): aca no se revisa.
 */
export async function leerUltimaLlamada(workspaceId: string, contactId: string): Promise<UltimaLlamada | null> {
  const intento = await prisma.callAttempt.findFirst({
    where: { workspaceId, contactId },
    orderBy: { calledAt: "desc" },
    select: { id: true, result: true, summary: true, calledAt: true, attemptNumber: true },
  });
  if (!intento) {
    return null;
  }

  return {
    id: intento.id,
    etiqueta: getCallResultLabel(intento.result) ?? intento.result,
    pendiente: isPendingCallResult(intento.result),
    noContesto: intento.result === "no_contesto",
    resumen: intento.summary?.trim() || null,
    calledAt: intento.calledAt.toISOString(),
    intento: intento.attemptNumber,
  };
}
