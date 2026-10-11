import { enrutarAlertasDelSupervisor, leerConfigGravedad } from "@/features/avisos-gravedad/servicios/enrutador";
import { manejaElAccionable, vaALaSupervisora } from "@/features/supervisor-accionable/dominio/reglas";
import { leerConfigAccionable, textoCriticoDeIncidente } from "@/features/supervisor-accionable/servicios/accionable";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";

import { textoDelAviso, type Incidente } from "../dominio/alertas";

/**
 * EL AVISO AL DUEÑO: una notificación push (la misma infraestructura que ya avisa al dueño cuando
 * el reparto cae al respaldo). Solo a OWNER/ADMIN activos. Nunca escribe al cliente ni a WhatsApp.
 *
 * El `tag` es la clave del incidente: si llega otra actualización, reemplaza a la anterior en el
 * teléfono en vez de apilarse.
 *
 * AVISOS POR GRAVEDAD (10-10-2026): con el interruptor `avisos:gravedad:<workspaceId>` encendido,
 * cada alerta sale por el canal de su gravedad (asesora / push a Alexander / push + WhatsApp a
 * Alexander / resumen). Apagado = exactamente lo de antes (ver features/avisos-gravedad).
 */
export async function avisarAlDueno(input: {
  workspaceId: string;
  avisos: Array<{ incidente: Incidente; motivo: "nuevo" | "sube" | "recordatorio" }>;
  /** Los incidentes de la vuelta: con el enrutador por gravedad se reevalúan los de atención abiertos. */
  incidentes?: Incidente[];
  ahora?: Date;
}): Promise<number> {
  /*
    SUPERVISOR ACCIONABLE (11-10-2026): con su interruptor, las alertas de atención de un chat
    (caliente, asignado sin respuesta, "ya pagué", sin dueña) NO salen por aquí: las maneja
    supervisor-accionable (aviso a la asesora → verificación → escala a Alexander solo si hace falta).
    Todo lo demás sigue exactamente igual. Apagado = sin filtro.
  */
  const accionable = await leerConfigAccionable(input.workspaceId).catch(() => null);
  const filtrar = Boolean(accionable?.activo);
  // Las tareas de seguimiento sin asesora tampoco: van a la supervisora (avisarTareasSinDuena).
  const sale = (clave: string) => manejaElAccionable(clave) || vaALaSupervisora(clave);
  const avisosPropios = filtrar ? input.avisos.filter((aviso) => !sale(aviso.incidente.clave)) : input.avisos;
  const incidentesPropios = filtrar ? input.incidentes?.filter((inc) => !sale(inc.clave)) : input.incidentes;
  input = { ...input, avisos: avisosPropios, incidentes: incidentesPropios };

  const gravedad = await leerConfigGravedad(input.workspaceId).catch(() => null);
  if (gravedad?.activo) {
    const resultado = await enrutarAlertasDelSupervisor({
      workspaceId: input.workspaceId,
      config: gravedad,
      avisos: input.avisos,
      incidentes: input.incidentes,
      ahora: input.ahora ?? new Date(),
      textoCritico: filtrar ? (inc) => textoCriticoDeIncidente(inc) : undefined,
    }).catch((error) => {
      console.error("[supervisor] enrutador de avisos", error instanceof Error ? error.message : error);
      return { enviados: 0 };
    });
    return resultado.enviados;
  }
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
