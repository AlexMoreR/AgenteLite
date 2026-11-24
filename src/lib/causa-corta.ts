/*
  causaCorta vive aca (y no en etapa-automatica-crm.ts) desde el 24-nov-2026 para que la pueda usar
  src/lib/prisma.ts sin formar un circulo: etapa-automatica-crm.ts importa prisma. Ese archivo la
  sigue exportando, asi que quien ya la usaba no nota nada. Este archivo no importa nada.
*/

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
