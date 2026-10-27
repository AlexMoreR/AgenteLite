import { diaDeBogota } from "@/features/supervisor-reasignacion/dominio/reglas";
import { leerConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { leerRegistroDelDia } from "@/features/supervisor-reasignacion/servicios/registro";
import { nombresDeAsesoras } from "@/features/supervisor/servicios/datos";

/*
  AVISOS Y REASIGNACIONES por el MCP (solo lectura): lo que hizo el vigilante del Supervisor en un día,
  con el conteo por asesora. Pensada para el resumen de las 7:30 (leer el conteo de AYER).
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_AVISOS_Y_REASIGNACIONES = [
  {
    name: "avisos_y_reasignaciones",
    title: "Avisos y reasignaciones del Supervisor",
    description:
      "Lo que hizo el vigilante del Supervisor en un día (hora de Bogotá): avisos por WhatsApp a las asesoras (chat sin respuesta, bot pidió asesora, Caliente sin mensaje), chats reasignados de una asesora a otra y casos que llegaron al dueño, con el conteo del día por asesora. Solo lectura. Para el resumen de las 7:30 usa dia = ayer. Incluye si los avisos y la reasignación están prendidos y con cuántos minutos.",
    inputSchema: {
      type: "object",
      properties: {
        dia: { type: "string", description: "Día en formato AAAA-MM-DD (hora de Bogotá). Por defecto, hoy." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_AVISOS_Y_REASIGNACIONES.map((herramienta) => herramienta.name));

export const esHerramientaDeAvisosYReasignaciones = (nombre: string) => NOMBRES.has(nombre);

export async function ejecutarHerramientaMcpAvisosYReasignaciones(_nombre: string, args: Argumentos, contexto: Contexto): Promise<unknown> {
  const pedido = typeof args.dia === "string" ? args.dia.trim() : "";
  if (pedido && !/^\d{4}-\d{2}-\d{2}$/.test(pedido)) return { error: "El día va como AAAA-MM-DD (por ejemplo 2026-10-27)." };
  const dia = pedido || diaDeBogota(new Date());
  const [config, registro, nombres] = await Promise.all([
    leerConfigReasignacion(contexto.workspaceId),
    leerRegistroDelDia(contexto.workspaceId, dia),
    nombresDeAsesoras(contexto.workspaceId).catch(() => ({}) as Record<string, string>),
  ]);
  const nombre = (id: string | null) => (id ? (nombres[id] ?? id) : null);
  return {
    dia,
    ajustes: {
      avisos_prendidos: config.avisosActivo,
      reasignacion_prendida: config.reasignacionActiva,
      minutos_para_avisar: config.avisoMin,
      minutos_para_reasignar: config.reasignarMin,
      horas_caliente_sin_mensaje: config.calienteHoras,
      horario: config.horario,
    },
    total_de_registros: registro.total,
    por_asesora: registro.conteo.map((c) => ({
      asesora: nombre(c.asesoraId),
      asesora_id: c.asesoraId,
      avisos_por_chat_sin_respuesta: c.avisos,
      calientes_sin_mensaje_24h: c.calientes24h,
      chats_que_perdio_por_reasignacion: c.reasignadosDeEllaA,
      chats_que_recibio: c.recibidos,
      whatsapp_que_no_salieron: c.whatsappFallidos,
    })),
    registros: registro.avisos.map((a) => ({
      tipo: a.tipo,
      hora: a.creadoEn.toISOString(),
      chat_id: a.conversationId,
      asesora: nombre(a.asesoraId),
      asesora_nueva: nombre(a.asesoraNuevaId),
      minutos_esperando: a.minutosEsperando,
      whatsapp_enviado: a.whatsappEnviado,
      ...(a.error ? { nota: a.error } : {}),
    })),
    ...(registro.total > registro.avisos.length ? { aviso: `Hay ${registro.total} registros; aquí van los ${registro.avisos.length} más recientes (el conteo por asesora cuenta todos).` } : {}),
  };
}
