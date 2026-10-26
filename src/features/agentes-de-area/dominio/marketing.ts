/**
 * AGENTE DE MARKETING: la cuenta pura (sin base ni red) de los números por anuncio de origen.
 * La prueba scripts/check-agente-de-marketing.mjs la corre con datos falsos.
 *
 * El CRM guarda el ANUNCIO de origen de cada lead (id y título), no la campaña: el agente une anuncio con campaña
 * leyendo Meta. Aquí solo se agrupa por anuncio y se dice cuántas conversaciones no tienen anuncio de origen.
 */

export const SIN_ANUNCIO = "sin anuncio de origen";
/** Cuántos mensajes cortos del cliente se entregan por conversación (para ver si preguntó precio, ciudad o envío). */
export const MAX_MENSAJES_DEL_CLIENTE = 4;
export const MAX_LARGO_MENSAJE = 160;

export type LeadDeMarketing = {
  conversacionId: string;
  anuncioId: string | null;
  anuncioTitulo: string | null;
  /** CALIENTE | TIBIO | FRIO… tal como lo calcula el sistema (EmbudoLead.temperatura). */
  temperatura: string | null;
  /** Etapa que pone la asesora en el CRM. */
  crmStage: string;
  cotizacion: string | null;
  primeraRespuestaAsesoraEn: Date | null;
  entradaEn: Date;
  mensajesDelCliente: string[];
};

export type FilaPorAnuncio = {
  anuncio_id: string | null;
  anuncio: string;
  conversaciones_nuevas: number;
  tibio_o_caliente_sistema: number;
  tibio_o_caliente_asesora: number;
  tibio_o_caliente: number;
  ventas: number;
  cotizaciones: string[];
  sin_respuesta: number;
  primera_respuesta_min_mediana: number | null;
  conversaciones?: { conversacion_id: string; mensajes_del_cliente: string[] }[];
};

const esCalienteOTibio = (t: string | null) => t === "CALIENTE" || t === "TIBIO";
const esEtapaCalienteOTibia = (etapa: string) => etapa === "PROPUESTA" || etapa === "NEGOCIACION" || etapa === "GANADO";

function medianaDe(valores: number[]): number | null {
  if (!valores.length) return null;
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
}

/** Corta y limpia un mensaje del cliente para que el subagente lo lea sin gastar de más. */
export function mensajeCorto(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > MAX_LARGO_MENSAJE ? `${limpio.slice(0, MAX_LARGO_MENSAJE)}…` : limpio;
}

/**
 * Agrupa los leads por anuncio de origen. `incluirConversaciones` (solo para un día) trae los primeros mensajes del
 * cliente de cada conversación para el subagente de Calidad del Lead.
 */
export function agruparPorAnuncio(leads: LeadDeMarketing[], incluirConversaciones: boolean) {
  const grupos = new Map<string, { fila: FilaPorAnuncio; tiempos: number[] }>();
  for (const lead of leads) {
    const clave = lead.anuncioId ?? lead.anuncioTitulo ?? SIN_ANUNCIO;
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = {
        tiempos: [],
        fila: {
          anuncio_id: lead.anuncioId,
          anuncio: lead.anuncioTitulo ?? (lead.anuncioId ? `anuncio ${lead.anuncioId}` : SIN_ANUNCIO),
          conversaciones_nuevas: 0,
          tibio_o_caliente_sistema: 0,
          tibio_o_caliente_asesora: 0,
          tibio_o_caliente: 0,
          ventas: 0,
          cotizaciones: [],
          sin_respuesta: 0,
          primera_respuesta_min_mediana: null,
          ...(incluirConversaciones ? { conversaciones: [] } : {}),
        },
      };
      grupos.set(clave, grupo);
    }
    const { fila } = grupo;
    fila.conversaciones_nuevas += 1;
    const porSistema = esCalienteOTibio(lead.temperatura);
    const porAsesora = esEtapaCalienteOTibia(lead.crmStage);
    if (porSistema) fila.tibio_o_caliente_sistema += 1;
    if (porAsesora) fila.tibio_o_caliente_asesora += 1;
    if (porSistema || porAsesora) fila.tibio_o_caliente += 1;
    if (lead.crmStage === "GANADO") {
      fila.ventas += 1;
      if (lead.cotizacion) fila.cotizaciones.push(lead.cotizacion);
    }
    if (!lead.primeraRespuestaAsesoraEn) fila.sin_respuesta += 1;
    else grupo.tiempos.push(Math.max(0, Math.round((lead.primeraRespuestaAsesoraEn.getTime() - lead.entradaEn.getTime()) / 60_000)));
    if (incluirConversaciones) {
      fila.conversaciones!.push({
        conversacion_id: lead.conversacionId,
        mensajes_del_cliente: lead.mensajesDelCliente.slice(0, MAX_MENSAJES_DEL_CLIENTE).map(mensajeCorto).filter(Boolean),
      });
    }
  }
  const anuncios = [...grupos.values()].map(({ fila, tiempos }) => ({ ...fila, primera_respuesta_min_mediana: medianaDe(tiempos) }));
  anuncios.sort((a, b) => b.conversaciones_nuevas - a.conversaciones_nuevas);
  const sinOrigen = leads.filter((l) => !l.anuncioId && !l.anuncioTitulo).length;
  return {
    anuncios,
    conversaciones_nuevas: leads.length,
    sin_anuncio_de_origen: sinOrigen,
    sin_anuncio_de_origen_pct: leads.length ? Math.round((sinOrigen / leads.length) * 1000) / 10 : 0,
  };
}
