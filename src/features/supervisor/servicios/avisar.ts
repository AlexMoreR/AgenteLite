import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";

import { textoDelAviso, type Incidente } from "../dominio/alertas";

/**
 * EL AVISO AL DUEÑO: una notificación push (la misma infraestructura que ya avisa al dueño cuando
 * el reparto cae al respaldo). Solo a OWNER/ADMIN activos. Nunca escribe al cliente ni a WhatsApp.
 *
 * El `tag` es la clave del incidente: si llega otra actualización, reemplaza a la anterior en el
 * teléfono en vez de apilarse.
 */
export async function avisarAlDueno(input: {
  workspaceId: string;
  avisos: Array<{ incidente: Incidente; motivo: "nuevo" | "sube" | "recordatorio" }>;
}): Promise<number> {
  if (input.avisos.length === 0) return 0;
  const jefes = await prisma.workspaceMember.findMany({
    where: { workspaceId: input.workspaceId, isActive: true, role: { in: ["OWNER", "ADMIN"] } },
    select: { userId: true },
  });
  let enviados = 0;
  for (const aviso of input.avisos) {
    const { title, body } = textoDelAviso(aviso.incidente, aviso.motivo);
    for (const jefe of jefes) {
      enviados += await sendPushToUser({
        userId: jefe.userId,
        payload: { title, body, tag: `supervisor:${aviso.incidente.clave}`, url: "/cliente/crm/supervisor" },
      }).catch(() => 0);
    }
  }
  return enviados;
}
