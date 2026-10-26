/** El sitio desde donde entra el dueño (para la dirección de regreso de Google), sin barra final. */
export function origenDelPedido(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const protocolo = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${protocolo.split(",")[0].trim()}://${host}`;
  }
  return new URL(request.url).origin;
}
