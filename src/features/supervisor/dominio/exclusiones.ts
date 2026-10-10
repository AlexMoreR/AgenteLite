/**
 * QUÉ CHATS NO SON TAREA DEL SUPERVISOR (código puro).
 *
 * Alexander recibió "chat con señal de compra sin asesora" de un lead de Brasil que ya estaba en
 * PERDIDO (cv9b8466b04a55168797bdd5d9, 10-oct). Las alertas de atención son TAREAS: no pueden
 * hacerle perder tiempo con chats que ya no se trabajan. Quedan fuera:
 *  - etapa PERDIDO o GANADO;
 *  - cliente fuera de Colombia: marcado por el seguimiento inteligente o, sin marca, teléfono con
 *    indicativo distinto de 57 (un LID sin teléfono real NO se decide);
 *  - lead dormido por una fecha futura de compra ("finales de noviembre");
 *  - la asesora ya respondió después del último mensaje del cliente.
 *
 * Si una alerta ABIERTA tiene chats que pasan a estar excluidos, al recalcular salen de la alerta, y
 * la alerta se cierra si queda vacía (ver purgarChatsExcluidos).
 */

import { esDelExterior } from "../../seguimiento-inteligente/dominio/exterior";
import type { Incidente } from "./alertas";

export type MotivoDeExclusion = "etapa_cerrada" | "fuera_de_colombia" | "dormido" | "ya_respondio";

export type DatosDeExclusion = {
  etapa: string | null;
  telefono?: string | null;
  esLid?: boolean;
  telefonoDescubierto?: string | null;
  metadata?: unknown;
  dormidoHasta?: Date | null;
  ultimoClienteEn?: Date | null;
  ultimaRespuestaHumanaEn?: Date | null;
  /** Lo que escribió el cliente: si nombra un lugar de Colombia no se excluye por el teléfono. */
  textos?: Array<string | null | undefined>;
};

export function motivoDeExclusion(d: DatosDeExclusion, ahora: Date): MotivoDeExclusion | null {
  if (d.etapa === "PERDIDO" || d.etapa === "GANADO") return "etapa_cerrada";
  if (esDelExterior({ metadata: d.metadata, telefono: d.telefono, esLid: d.esLid, telefonoDescubierto: d.telefonoDescubierto, textos: d.textos })) {
    return "fuera_de_colombia";
  }
  // El motor del seguimiento inteligente borra `dormidoHasta` apenas el cliente vuelve a escribir.
  if (d.dormidoHasta && d.dormidoHasta.getTime() > ahora.getTime()) return "dormido";
  if (d.ultimaRespuestaHumanaEn && (!d.ultimoClienteEn || d.ultimaRespuestaHumanaEn.getTime() >= d.ultimoClienteEn.getTime())) {
    return "ya_respondio";
  }
  return null;
}

/** "Chat <id>…" en los hechos: se quitan las líneas de los chats que salen. */
function lineaDeChat(texto: string, excluidos: Set<string>): boolean {
  for (const id of excluidos) if (texto.includes(id)) return true;
  return false;
}

/**
 * Saca de las alertas de ATENCIÓN abiertas los chats excluidos. Un hallazgo que queda sin chats se
 * quita; una alerta que queda sin hallazgos se CIERRA ya (no espera los 15 min de "dejó de verse").
 * Las alertas de bot, embudo y cambio no se tocan: sus chats son ejemplos del incidente.
 */
export function purgarChatsExcluidos(abiertos: Incidente[], excluidos: Set<string>, ahora: Date): { incidentes: Incidente[]; cambiados: number } {
  if (excluidos.size === 0) return { incidentes: abiertos, cambiados: 0 };
  let cambiados = 0;
  const incidentes = abiertos.map((inc) => {
    if (inc.familia !== "ATENCION" || inc.estado !== "ABIERTA") return inc;
    let cambio = false;
    const hallazgos = inc.hallazgos.flatMap((h) => {
      const quedan = h.evidencia.chats.filter((id) => !excluidos.has(id));
      if (quedan.length === h.evidencia.chats.length) return [h];
      cambio = true;
      if (quedan.length === 0) return [];
      const quitados = h.evidencia.chats.length - quedan.length;
      return [
        {
          ...h,
          leadsAfectados: Math.max(quedan.length, h.leadsAfectados - quitados),
          evidencia: { ...h.evidencia, chats: quedan },
          hechos: h.hechos.filter((linea) => !lineaDeChat(linea, excluidos)),
        },
      ];
    });
    if (!cambio) return inc;
    cambiados += 1;
    if (hallazgos.length === 0) {
      // Queda de historial, pero sin los chats excluidos (no se muestran como pendientes).
      const limpios = inc.hallazgos.map((h) => ({
        ...h,
        evidencia: { ...h.evidencia, chats: h.evidencia.chats.filter((id) => !excluidos.has(id)) },
        hechos: h.hechos.filter((linea) => !lineaDeChat(linea, excluidos)),
      }));
      return { ...inc, hallazgos: limpios, estado: "RESUELTA" as const, resueltaEn: ahora };
    }
    return { ...inc, hallazgos };
  });
  return { incidentes, cambiados };
}
