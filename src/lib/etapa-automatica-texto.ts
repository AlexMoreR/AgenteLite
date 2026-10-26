// Parte de la etapa automatica que corre tambien en el navegador (sin base de datos).

/**
 * ¿El texto que de verdad se envió todavía trae el total que insertó el panel de envío?
 * Compara sin espacios (el navegador puede cambiar saltos y espacios). Si la asesora borró el
 * total, o lo pegó a mano (botón Copiar) y no vino del panel, el llamador no manda la marca.
 */
export function textoEnviadoTraeElTotal(textoEnviado: string, totalInsertado: string | null | undefined): boolean {
  const total = (totalInsertado ?? "").replace(/\s+/g, "");
  if (!total) return false;
  return textoEnviado.replace(/\s+/g, "").includes(total);
}
