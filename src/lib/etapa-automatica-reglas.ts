/**
 * Las partes PURAS de la etapa automática del CRM (sin base de datos).
 *
 * Van separadas del motor (etapa-automatica-crm.ts) por dos razones: el panel de envío es un
 * componente de navegador y no puede traer Prisma, y así la regla se prueba sin tocar nada.
 */

/** AppSetting que apaga el motor para un negocio: `crm:etapa-automatica:<negocio>` = `off`. */
export const CLAVE_ETAPA_AUTOMATICA = "crm:etapa-automatica:";

/** Por qué se mueve la etapa. Cada motivo lleva a una etapa fija. */
export type MotivoEtapaAutomatica =
  | { tipo: "asignacion"; asesora: string }
  | { tipo: "cotizacion"; codigo: string }
  | { tipo: "panel-envio" };

/**
 * La etapa que pide cada motivo, en las palabras del negocio (las que entiende
 * `decidirEtapaDeAgente`, el mismo candado del bot): asignar = Frío; cotizar o mandar el total
 * = Caliente. Nunca Ganado ni Perdido.
 */
export function etapaPedidaPorMotivo(motivo: MotivoEtapaAutomatica): "Frío" | "Caliente" {
  return motivo.tipo === "asignacion" ? "Frío" : "Caliente";
}

/** La razón entre paréntesis de la nota del chat: "se asignó a Laura", "se creó la cotización COT-1". */
export function razonDelMotivo(motivo: MotivoEtapaAutomatica): string {
  if (motivo.tipo === "asignacion") return `se asignó a ${motivo.asesora}`;
  if (motivo.tipo === "cotizacion") return `se creó la cotización ${motivo.codigo}`;
  return "se envió el panel de envío con el total";
}

/** El texto de la nota que se deja en el chat. */
export function notaDelChat(etiquetaDeEtapa: string, motivo: MotivoEtapaAutomatica): string {
  return `Etapa movida por el sistema: ${etiquetaDeEtapa} (${razonDelMotivo(motivo)})`;
}

/** La nota del historial de etapas: siempre empieza con "etapa automática" (la lista de Llamadas la reconoce). */
export const PREFIJO_NOTA_HISTORIAL = "etapa automática";
export function notaDelHistorial(motivo: MotivoEtapaAutomatica): string {
  return `${PREFIJO_NOTA_HISTORIAL}: ${razonDelMotivo(motivo)}`;
}

/**
 * ¿El texto que se va a enviar todavía trae el total del panel de envío?
 *
 * Si la asesora lo borró o lo cambió antes de enviar, lo que sale al cliente ya no es el total y
 * el lead no debe pasar a Caliente. Se compara solo por las cifras, porque alrededor puede haber
 * editado lo que quiera (y la firma se agrega después).
 */
export function textoConservaElTotal(textoEnviado: string, totalTexto: string | null | undefined): boolean {
  const total = (totalTexto ?? "").trim();
  if (!total) return false;
  const digitos = (valor: string) => valor.replace(/\D/g, "");
  const buscado = digitos(total);
  if (!buscado) return false;
  // Se busca el monto con su "$" delante, tal como lo escribe el panel: así "$150.000" no se
  // confunde con "$1.150.000" ni con un teléfono.
  const montos = textoEnviado.match(/\$\s?\d[\d.,]*/g) ?? [];
  return montos.some((monto) => digitos(monto) === buscado);
}
