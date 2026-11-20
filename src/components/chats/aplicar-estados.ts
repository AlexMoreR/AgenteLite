/*
  Los chulos que trae /estados, puestos sobre los mensajes del chat abierto (velocidad de Chats,
  paso 3, 19-nov-2026). Ver src/app/api/cliente/chats/estados/route.ts.

  Solo toca mensajes SALIENTES cuyo id coincide: el estado (enviado, entregado, leido) y la marca
  de audio escuchado del rawPayload. Si nada cambia devuelve la MISMA lista, para que React no
  vuelva a dibujar el chat. Nunca agrega ni quita mensajes: eso sigue llegando por /live.

  Sin imports: se prueba con Node solo (aplicar-estados.test.ts).
*/

export type EstadoSaliente = { id: string; estado: string; reproducidoAt: string | null };

type MensajeConEstado = {
  id: string;
  direction: string;
  outboundStatusLabel?: string | null;
  rawPayload?: unknown;
};

function reproducidoDe(rawPayload: unknown): string | null {
  const valor =
    rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      ? (rawPayload as { reproducidoAt?: unknown }).reproducidoAt
      : null;
  return typeof valor === "string" && valor ? valor : null;
}

export function aplicarEstados<T extends MensajeConEstado>(mensajes: T[], estados: EstadoSaliente[]): T[] {
  if (estados.length === 0 || mensajes.length === 0) {
    return mensajes;
  }
  const porId = new Map(estados.map((estado) => [estado.id, estado]));
  let cambio = false;
  const siguientes = mensajes.map((mensaje) => {
    const estado = porId.get(mensaje.id);
    if (!estado || mensaje.direction !== "OUTBOUND") {
      return mensaje;
    }
    const cambiaEstado = Boolean(estado.estado) && mensaje.outboundStatusLabel !== estado.estado;
    // La marca de escuchado solo se agrega (el servidor nunca la quita).
    const cambiaEscuchado = Boolean(estado.reproducidoAt) && !reproducidoDe(mensaje.rawPayload);
    if (!cambiaEstado && !cambiaEscuchado) {
      return mensaje;
    }
    cambio = true;
    const base =
      mensaje.rawPayload && typeof mensaje.rawPayload === "object" && !Array.isArray(mensaje.rawPayload)
        ? (mensaje.rawPayload as Record<string, unknown>)
        : {};
    return {
      ...mensaje,
      ...(cambiaEstado ? { outboundStatusLabel: estado.estado } : {}),
      ...(cambiaEscuchado ? { rawPayload: { ...base, reproducidoAt: estado.reproducidoAt } } : {}),
    };
  });
  return cambio ? siguientes : mensajes;
}
