/**
 * El motivo de una tarea de asesora (EmbudoLead.accionDatos.motivo) dicho en palabras. Lo usan la
 * lista de tareas (Mi día, Supervisor) y la lista "Tareas vencidas" de Recuperación.
 */
export const MOTIVOS_DE_TAREA: Record<string, string> = {
  caliente_esperando: "Caliente esperando respuesta",
  tibio_esperando: "Preguntó algo concreto y espera",
  esperando_con_bot_pausado: "Espera respuesta (bot en pausa)",
  caliente_sin_asesora: "Caliente: nadie le ha escrito",
  tibio_sin_asesora: "Pregunta concreta: escríbele tú",
  cotizacion_sin_respuesta: "Cotización sin respuesta",
  formulario_sin_respuesta: "Le pediste los datos y no los ha mandado",
  fecha_futura_cerca: "Se acerca la fecha que dijo",
  cadencia_sin_respuesta: "Seguimiento después de tu mensaje",
  cadencia_tope_de_automaticos: "Seguimiento después de tu mensaje",
  recuperacion_72h: "Recuperación 72 h · último intento",
  compromiso_pendiente: "Quedó en algo para esta hora",
};

export function nombreDelMotivo(motivo: string | null | undefined): string {
  if (!motivo) return "Tarea";
  return MOTIVOS_DE_TAREA[motivo] ?? motivo.replace(/_/g, " ");
}
