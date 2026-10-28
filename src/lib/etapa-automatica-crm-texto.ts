/**
 * La parte de la etapa automática que también corre en el navegador (sin base de datos).
 * Va en su propio archivo porque `etapa-automatica-crm.ts` importa prisma.
 */

/**
 * ¿El texto que se envía todavía trae el total que insertó el panel de envío? Si la asesora lo
 * borró o lo cambió, el total no salió al cliente y no se pasa a Caliente. Se compara sin espacios.
 */
export function textoTraeElTotal(textoEnviado: string, total: string): boolean {
  const sinEspacios = (valor: string) => valor.replace(/\s+/g, "");
  const buscado = sinEspacios(total);
  if (!buscado) return false;
  return sinEspacios(textoEnviado).includes(buscado);
}
