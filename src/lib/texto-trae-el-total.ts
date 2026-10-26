/**
 * ¿El texto que se va a enviar todavía trae el total del panel de envío?
 *
 * Va en su propio archivo, sin base de datos, porque lo usa el navegador (al enviar) y la prueba.
 * Se compara sin espacios (el formato de pesos puede usar espacios duros). Si la asesora borró el
 * total antes de enviar, no cuenta: el cliente nunca lo recibió.
 */
export function textoTraeElTotal(texto: string | null | undefined, total: string | null | undefined): boolean {
  const limpio = (valor: string) => valor.replace(/\s+/g, "");
  const buscado = limpio(total ?? "");
  if (!buscado) return false;
  return limpio(texto ?? "").includes(buscado);
}
