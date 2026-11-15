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

/**
 * La causa de una falla en UNA palabra corta y sin el mensaje completo, para el registro.
 *
 * 30-oct-2026: el registro anterior dejaba `error: 'fetch failed'` y el mensaje entero de Prisma (varias
 * líneas que empiezan con `error: '\n' +`) cada vez que la IA o la base no contestaban. Esas líneas
 * cuentan como falla nueva en la vigilancia de 30 minutos después de subir, y la subida se deshizo. Lo
 * que no se pudo hacer acá no rompe nada (se intenta con el próximo mensaje): basta una línea informativa.
 */
export function causaCorta(falla: unknown): string {
  const codigo = (falla as { code?: unknown } | null)?.code;
  // Solo códigos de Prisma (P2024) o de Postgres (57P03): los de red (ECONNREFUSED) son palabras de
  // falla para la vigilancia y van como "sin-conexion".
  if (typeof codigo === "string" && /^(P\d{4}|[0-9][0-9A-Z]{4})$/.test(codigo)) return `base-${codigo}`;
  const nombre = falla instanceof Error ? falla.name : "";
  const mensaje = falla instanceof Error ? falla.message : String(falla ?? "");
  if (nombre === "AbortError" || nombre === "TimeoutError") return "tardo-demasiado";
  if (typeof codigo === "string" && /^E[A-Z]+$/.test(codigo)) return "sin-conexion";
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket/i.test(mensaje)) return "sin-conexion";
  if (/prisma/i.test(mensaje)) return "base";
  const http = mensaje.match(/\b(\d{3})\b/);
  return http ? `http-${http[1]}` : "otra";
}
