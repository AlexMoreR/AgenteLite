/**
 * Las condiciones de una automatización contra UN lead (código puro).
 *
 * La consulta de la base (servicio.ts) hace el mismo filtro en SQL para contar rápido; esto lo
 * vuelve a mirar lead por lead justo antes de actuar: entre la vista previa y el clic un lead pudo
 * cambiar de etapa o de dueña, y lo que decide si se le escribe tiene que ser lo de AHORA.
 */

import {
  ETAPAS_CERRADAS,
  PASOS_GUARDADOS_ALTOS,
  RESPONDIO,
  SIN_ASIGNAR,
  loQuePideYaPaso,
  type Accion,
  type Automatizacion,
  type Condicion,
  type Etapa,
} from "./modelo";

const DIA = 86_400_000;

/** La foto de un lead (un chat) con lo que miran las condiciones. */
export type FotoDelLead = {
  conversationId: string;
  contactId: string;
  channelId: string | null;
  etapa: Etapa;
  asignadoA: string | null;
  etiquetas: string[];
  /** status OPEN o PENDING. */
  abierta: boolean;
  /** Contacto oculto del CRM. */
  excluido: boolean;
  ultimoMensajeEn: Date | null;
  /** Último mensaje del cliente (no SYSTEM). */
  ultimoClienteEn: Date | null;
  recuperacionVencida: boolean;
  /** EmbudoLead.pasoActual / pasoMaximo (null = sin fila en el embudo o sin paso). */
  pasoActual: string | null;
  pasoMaximo: string | null;
  /**
   * La clienta escribió después de nuestro primer mensaje (notas del sistema y borrados no cuentan).
   * Misma regla que `respondioLaBienvenida` (src/lib/turno-con-contenido.ts); en SQL, servicio.ts.
   */
  respondio: boolean;
};

const esPasoAlto = (paso: string | null): paso is string => paso !== null && (PASOS_GUARDADOS_ALTOS as readonly string[]).includes(paso);

/** El paso de hoy para "es": en Bienvenida (o sin paso) cuenta como Respondió si ya respondió. */
export function pasoDeHoy(foto: Pick<FotoDelLead, "pasoActual" | "respondio">): string {
  if (esPasoAlto(foto.pasoActual)) return foto.pasoActual;
  return foto.respondio ? RESPONDIO : "PRESENTACION";
}

/** "ya pasó": respondió y su paso más alto va después del más bajo de los elegidos. */
function yaPaso(foto: Pick<FotoDelLead, "pasoActual" | "pasoMaximo" | "respondio">, valores: ReadonlyArray<string>): boolean {
  const pide = loQuePideYaPaso(valores);
  if (pide.nunca || !foto.respondio) return false;
  if (pide.bastaResponder) return true;
  const alcanzados = [foto.pasoMaximo, foto.pasoActual].filter(esPasoAlto);
  return alcanzados.some((paso) => pide.guardados.includes(paso));
}

export function cumpleCondicion(foto: FotoDelLead, condicion: Condicion, ahora: Date): boolean {
  switch (condicion.campo) {
    case "etapa": {
      const esta = condicion.valores.includes(foto.etapa);
      return condicion.operador === "es" ? esta : !esta;
    }
    case "asignado": {
      const clave = foto.asignadoA ?? SIN_ASIGNAR;
      const esta = condicion.valores.includes(clave);
      return condicion.operador === "es" ? esta : !esta;
    }
    case "etiquetas": {
      const alguna = condicion.valores.some((id) => foto.etiquetas.includes(id));
      return condicion.operador === "tiene" ? alguna : !alguna;
    }
    case "canal": {
      const esta = foto.channelId !== null && condicion.valores.includes(foto.channelId);
      return condicion.operador === "es" ? esta : !esta;
    }
    case "dias_sin_responder":
      return foto.ultimoClienteEn !== null && ahora.getTime() - foto.ultimoClienteEn.getTime() >= condicion.dias * DIA;
    case "dias_sin_mensajes":
      // Igual que antes (lastMessageAt < corte): un chat sin ningún mensaje no entra.
      return foto.ultimoMensajeEn === null ? false : ahora.getTime() - foto.ultimoMensajeEn.getTime() >= condicion.dias * DIA;
    case "recuperacion_vencida":
      return condicion.operador === "si" ? foto.recuperacionVencida : !foto.recuperacionVencida;
    case "paso_embudo":
      return condicion.operador === "es" ? (condicion.valores as readonly string[]).includes(pasoDeHoy(foto)) : yaPaso(foto, condicion.valores);
  }
}

/** A quién asigna (si tiene la acción Asignar). Nunca toma los que ya son de esa persona. */
export function destinoDeAsignacion(acciones: ReadonlyArray<Accion>): string | null {
  const asignar = acciones.find((a): a is Extract<Accion, { tipo: "asignar" }> => a.tipo === "asignar");
  return asignar?.usuarioId ?? null;
}

/**
 * ¿El lead entra en la automatización? Todas las condiciones (Y), más:
 *  - "Solo chats abiertos";
 *  - con la acción Asignar, no los que ya son de esa persona ("asignarle 20" son 20 NUEVOS) ni los
 *    que nunca respondieron la bienvenida (regla vigente: nunca asignar chats que nunca respondieron);
 *  - con envíos, nunca Ganado / Descartado ni contactos ocultos del CRM.
 */
export function cumpleCondiciones(
  foto: FotoDelLead,
  automatizacion: Pick<Automatizacion, "condiciones" | "soloAbiertas" | "acciones">,
  ahora: Date,
): boolean {
  if (automatizacion.soloAbiertas && !foto.abierta) return false;
  const destino = destinoDeAsignacion(automatizacion.acciones);
  if (destino && (foto.asignadoA === destino || !foto.respondio)) return false;
  if (automatizacion.acciones.some((a) => a.tipo === "enviar_flujo" || a.tipo === "enviar_texto") && motivoParaNoEnviar(foto)) {
    return false;
  }
  return automatizacion.condiciones.every((condicion) => cumpleCondicion(foto, condicion, ahora));
}

/** Por qué a este lead no se le puede escribir (null = se puede). */
export function motivoParaNoEnviar(foto: Pick<FotoDelLead, "etapa" | "excluido">): string | null {
  if (ETAPAS_CERRADAS.includes(foto.etapa)) return foto.etapa === "GANADO" ? "es Ganado" : "es Descartado";
  if (foto.excluido) return "está oculto del CRM";
  return null;
}
