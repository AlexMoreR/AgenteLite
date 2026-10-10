/**
 * TAREAS DEL SEGUIMIENTO INTELIGENTE SIN DUEÑA (código puro).
 *
 * El motor deja una tarea (Tibio, Caliente, cotización, fecha cercana, toque de la cadencia) y el
 * chat no tiene asesora. El Supervisor NO reasigna: la marca como prioridad para asignar y alerta,
 * con las de prioridad A primero.
 */

import type { Hallazgo } from "./tipos";

export type TareaSinDuena = {
  conversationId: string;
  prioridad: string;
  vence: Date | null;
  motivo: string;
  nombre: string;
};

export function hallazgosDeTareasSinDuena(tareas: TareaSinDuena[], ahora: Date): Hallazgo[] {
  if (!tareas.length) return [];
  const orden = [...tareas].sort((a, b) => a.prioridad.localeCompare(b.prioridad) || (a.vence?.getTime() ?? 0) - (b.vence?.getTime() ?? 0));
  const deA = orden.filter((t) => t.prioridad === "A").length;
  const desde = orden.map((t) => t.vence ?? ahora).sort((a, b) => a.getTime() - b.getTime())[0];
  return [
    {
      clave: "ATENCION:tareas-sin-duena",
      familia: "ATENCION",
      severidad: deA ? "IMPORTANTE" : "OBSERVACION",
      titulo: `${tareas.length} tarea(s) de seguimiento sin asesora${deA ? ` (${deA} de prioridad A)` : ""}`,
      que: "El seguimiento inteligente dejó tareas para una persona en chats que no tienen dueña. Hay que asignarlas.",
      desde,
      producto: null,
      leadsAfectados: tareas.length,
      evidencia: { chats: orden.slice(0, 15).map((t) => t.conversationId), reglas: [], versiones: [] },
      metrica: "Tareas vencidas sin dueña",
      esperado: "0",
      observado: String(tareas.length),
      hechos: orden.slice(0, 5).map((t) => `Chat ${t.conversationId}: prioridad ${t.prioridad}, ${t.motivo.replace(/_/g, " ")}.`),
      hipotesis: [],
      causaPosible: "El chat no pasó por el reparto (el cliente no respondió con contenido) o quedó sin asesora.",
      impacto: "Un lead con intención que nadie tiene asignado no recibe el seguimiento humano.",
      recomendacion: "Asignarlas a mano desde la bandeja, empezando por las de prioridad A (el Supervisor NO reasigna).",
      queCambiar: "Nada en el sistema: es asignación del equipo.",
      riesgo: "Ninguno: es un aviso.",
      comoMedir: "Tareas sin dueña = 0.",
      tocaProduccion: false,
    },
  ];
}
