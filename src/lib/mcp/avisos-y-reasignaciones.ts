import { fechaDeBogota } from "@/features/supervisor-reasignacion/dominio/reglas";
import { leerConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { leerRegistroDelDia } from "@/features/supervisor-reasignacion/servicios/registro";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  AVISOS Y REASIGNACIONES DEL SUPERVISOR (solo lectura).

  Entrega el registro de un día (por defecto AYER, hora de Colombia): cada aviso por WhatsApp y cada
  reasignación de chat, y el conteo por asesora. Es lo que lee el resumen de las 7:30. No escribe
  nada ni manda mensajes. Lo pueden usar quienes ven la pantalla del Supervisor.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const DIA = 86_400_000;

export const HERRAMIENTAS_MCP_AVISOS_Y_REASIGNACIONES = [
  {
    name: "avisos_y_reasignaciones",
    title: "Avisos y reasignaciones del Supervisor",
    description:
      "El registro de un dia (por defecto AYER, hora de Colombia) de los avisos por WhatsApp a las asesoras y de las reasignaciones automaticas de chats: cada fila con tipo (AVISO, REASIGNACION, CALIENTE_24H, BOT_PIDIO_ASESORA, SIN_CANDIDATA), asesora, a quien se le paso, minutos esperando, hora y si el WhatsApp salio; mas el conteo del dia por asesora (avisos, calientes 24 h, chats que dejo vencer, chats que recibio) y la configuracion vigente (interruptores y tiempos). Pensada para el resumen de las 7:30. Solo lectura: no manda mensajes ni cambia nada.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Sin fecha, ayer." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_AVISOS_Y_REASIGNACIONES.map((h) => h.name));

export function esHerramientaDeAvisosYReasignaciones(nombre: string) {
  return NOMBRES.has(nombre);
}

export async function ejecutarHerramientaMcpAvisosYReasignaciones(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  if (nombre !== "avisos_y_reasignaciones") throw new Error(`No existe la herramienta "${nombre}".`);
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver el Supervisor: es solo del dueño, los administradores y la supervisora.");
  }
  const pedida = typeof argumentos.fecha === "string" ? argumentos.fecha.trim() : "";
  const fecha = pedida || fechaDeBogota(new Date(Date.now() - DIA));
  const [config, registro] = await Promise.all([leerConfigReasignacion(contexto.workspaceId), leerRegistroDelDia(contexto.workspaceId, fecha).catch(() => null)]);
  if (!registro) {
    throw new Error(`No se pudo leer el registro del ${fecha}: la fecha tiene que ser AAAA-MM-DD, o todavia no existe la tabla (falta la migracion).`);
  }
  return {
    fecha: registro.fecha,
    configuracion: {
      avisos_prendidos: config.avisosActivo,
      reasignacion_prendida: config.reasignacionActiva,
      minutos_aviso: config.minutosAviso,
      minutos_reasignacion: config.minutosReasignacion,
      horas_caliente: config.horasCaliente,
      horario: config.horario,
    },
    totales: registro.totales,
    por_asesora: registro.conteo.map((c) => ({
      asesora: c.asesora,
      id: c.asesoraId,
      avisos_sin_respuesta: c.avisos,
      avisos_bot_pidio_asesora: c.botPidioAsesora,
      avisos_caliente_24h: c.caliente24h,
      chats_que_dejo_vencer: c.reasignadosDeEllas,
      chats_que_recibio: c.recibidos,
    })),
    filas: registro.filas.map((f) => ({
      hora: f.creadoEn.toISOString(),
      tipo: f.tipo,
      asesora: f.asesora,
      paso_a: f.asesoraNueva,
      chat: f.numero,
      conversation_id: f.conversationId,
      minutos_esperando: f.minutosEsperando,
      whatsapp_enviado: f.whatsappEnviado,
      error: f.error,
    })),
  };
}
