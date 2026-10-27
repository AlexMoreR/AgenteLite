/**
 * Parte PURA de la etapa automática (sin base ni servidor), para que el navegador también la use.
 * El motor que toca la base vive en etapa-automatica-crm.ts.
 */

/** Prefijo de la nota del historial: así la lista de Llamadas reconoce lo que puso el sistema. */
export const NOTA_ETAPA_AUTOMATICA = "etapa automática";

/** Campo del formulario de envío que lleva el total del panel de envío ("$1.500.000"). */
export const CAMPO_TOTAL_PANEL_ENVIO = "totalPanelEnvio";

/**
 * ¿El texto que se envió todavía trae el total del panel de envío?
 *
 * Si la asesora borró el total antes de enviar, no se mueve nada. Se compara sin importar saltos
 * de línea ni espacios repetidos, para que no cuenten como "editado".
 */
export function textoEnviadoTraeElTotal(textoEnviado: string, totalInsertado: string): boolean {
  const normalizar = (valor: string) => valor.replace(/\s+/g, " ").trim();
  const total = normalizar(totalInsertado);
  if (!total) {
    return false;
  }
  return normalizar(textoEnviado).includes(total);
}
