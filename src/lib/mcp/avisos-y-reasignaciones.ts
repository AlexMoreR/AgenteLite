import { fechaDeBogota, rangoDelDiaBogota } from "@/features/supervisor-reasignacion/dominio/reglas";
import { leerConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { leerRegistroDelDia } from "@/features/supervisor-reasignacion/servicios/registro";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  AVISOS Y REASIGNACIONES DEL SUPERVISOR (solo lectura).

  Lo que el Supervisor de reasignación avisó y movió en un día (hora de Colombia): cada aviso y cada
  reasignación con quién, cuándo y qué chat, y el conteo por asesora. Es lo que lee el resumen de las
  7:30 (por defecto, el de ayer). No escribe nada ni manda mensajes.

  Lo pueden usar las mismas personas que ven la pantalla del Supervisor.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_AVISOS_Y_REASIGNACIONES = [
  {
    name: "avisos_y_reasignaciones",
    title: "Avisos y reasignaciones del Supervisor",
    description:
      "Los avisos por WhatsApp a las asesoras y los chats que el Supervisor reasignó en un día (hora de Colombia): quién, cuándo, qué chat, si el WhatsApp salió, y el conteo por asesora. Sin fecha trae AYER (para el resumen de las 7:30). Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Sin fecha: ayer." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_AVISOS_Y_REASIGNACIONES.map((herramienta) => herramienta.name));

export function esHerramientaDeAvisosYReasignaciones(nombre: string) {
  return NOMBRES.has(nombre);
}

export async function ejecutarHerramientaMcpAvisosYReasignaciones(nombre: string, args: Argumentos, contexto: Contexto): Promise<unknown> {
  if (nombre !== "avisos_y_reasignaciones") throw new Error(`No existe la herramienta "${nombre}".`);
  if (!(await puedeVerElSupervisor(contexto))) throw new Error("No tienes permiso para ver el Supervisor.");
  const ayer = fechaDeBogota(new Date(Date.now() - 86_400_000));
  const fecha = typeof args.fecha === "string" && args.fecha.trim() ? args.fecha.trim() : ayer;
  if (!rangoDelDiaBogota(fecha)) throw new Error("La fecha tiene que ser AAAA-MM-DD.");
  const [config, registro] = await Promise.all([leerConfigReasignacion(contexto.workspaceId), leerRegistroDelDia(contexto.workspaceId, fecha)]);
  return {
    fecha,
    avisos_prendidos: config.avisosActivo,
    reasignacion_prendida: config.reasignacionActiva,
    total: registro?.total ?? 0,
    conteo_por_asesora: (registro?.conteo ?? []).map((c) => ({
      asesora: c.asesora,
      avisos_sin_respuesta: c.avisos,
      avisos_caliente_24h: c.calientes,
      avisos_bot_pidio_asesora: c.botPidioAsesora,
      chats_que_perdio: c.chatsPerdidos,
      chats_que_recibio: c.chatsRecibidos,
      chats_sin_quien_reciba: c.sinCandidata,
    })),
    registro: (registro?.filas ?? []).map((f) => ({
      hora: f.creadoEn.toISOString(),
      tipo: f.tipo,
      chat: f.conversationId,
      asesora: f.asesora,
      asesora_nueva: f.asesoraNueva,
      minutos_esperando: f.minutosEsperando,
      whatsapp_enviado: f.whatsappEnviado,
      error: f.error,
    })),
    ...(registro && registro.total > registro.filas.length ? { advertencia: `Se muestran las ${registro.filas.length} más recientes de ${registro.total}; el conteo es del día completo.` } : {}),
  };
}
