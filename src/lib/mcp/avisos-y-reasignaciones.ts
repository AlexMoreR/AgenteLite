import { fechaBogota } from "@/features/supervisor-reasignacion/dominio/reglas";
import { leerConfigReasignacion } from "@/features/supervisor-reasignacion/servicios/config";
import { leerRegistroDelDia } from "@/features/supervisor-reasignacion/servicios/registro";

/**
 * `avisos_y_reasignaciones` (solo lectura): el registro de los avisos por WhatsApp a las asesoras y de
 * las reasignaciones automáticas del Supervisor, con el conteo del día por asesora. Por defecto AYER
 * (Bogotá): es lo que lee el resumen de las 7:30. Ver src/features/supervisor-reasignacion.
 */

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_AVISOS = [
  {
    name: "avisos_y_reasignaciones",
    title: "Avisos y reasignaciones del Supervisor",
    description:
      "Registro de un dia (por defecto AYER, hora de Bogota) de los avisos por WhatsApp a las asesoras (chat sin respuesta a los 5 min, Caliente 24 h sin mensaje, el bot pidio asesora) y de las reasignaciones automaticas a los 30 min, con el conteo por asesora: avisos, chats que le quitaron, chats que recibio, escaladas al dueno y WhatsApp fallidos. Sirve para el resumen de las 7:30. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "Dia en formato AAAA-MM-DD (Bogota). Sin fecha: ayer." },
        incluir_lista: { type: "boolean", description: "Incluir cada aviso y reasignacion (por defecto si, hasta 300)." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
];

const NOMBRES = new Set(HERRAMIENTAS_MCP_AVISOS.map((herramienta) => herramienta.name));

export function esHerramientaDeAvisos(nombre: string) {
  return NOMBRES.has(nombre);
}

export async function ejecutarHerramientaMcpAvisos(nombre: string, args: Argumentos, contexto: Contexto): Promise<unknown> {
  if (nombre !== "avisos_y_reasignaciones") throw new Error(`No existe la herramienta "${nombre}".`);
  const fecha = typeof args.fecha === "string" && args.fecha.trim() ? args.fecha.trim() : fechaBogota(new Date(Date.now() - 86_400_000));
  const [registro, config] = await Promise.all([leerRegistroDelDia(contexto.workspaceId, fecha), leerConfigReasignacion(contexto.workspaceId)]);
  if (!registro) throw new Error("La fecha tiene que venir como AAAA-MM-DD.");
  const conLista = args.incluir_lista !== false;
  return {
    fecha: registro.fecha,
    ajustes: {
      avisos: config.avisosActivos ? "prendidos" : "apagados",
      reasignacion: config.reasignacionActiva ? "prendida" : "apagada",
      aviso_min: config.avisoMin,
      reasignar_min: config.reasignarMin,
      caliente_horas: config.calienteHoras,
      horario: `${config.horario.desde}:00 a ${config.horario.hasta}:00, dias ${config.horario.dias.join(",")} (0 = domingo)`,
    },
    total: registro.filas.length,
    conteo_por_asesora: registro.conteo.map((c) => ({
      asesora: c.asesora,
      avisos_sin_respuesta: c.avisos,
      bot_pidio_asesora: c.botPidioAsesora,
      caliente_24h: c.caliente24h,
      chats_que_le_quitaron: c.reasignadosLeQuitaron,
      chats_que_recibio: c.reasignadosRecibio,
      escaladas_al_dueno: c.sinCandidata,
      whatsapp_fallidos: c.whatsappFallidos,
    })),
    ...(conLista
      ? {
          lista: registro.filas.slice(0, 300).map((f) => ({
            hora: f.creadoEn.toISOString(),
            tipo: f.tipo,
            chat: f.numeroDelChat ?? f.conversationId,
            asesora: f.asesora,
            paso_a: f.asesoraNueva,
            minutos_esperando: f.minutosEsperando,
            whatsapp_enviado: f.whatsappEnviado,
            error: f.error,
          })),
        }
      : {}),
  };
}
