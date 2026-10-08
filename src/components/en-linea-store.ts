"use client";

/**
 * El estado "Recibiendo clientes" del lado del navegador.
 *
 * Lo escribe el latido (que ya trae el estado en su respuesta) y el interruptor de la barra; lo
 * lee el interruptor. Así el interruptor no hace pedidos propios para saber cómo está.
 */

export type EstadoEnLineaCliente = { recibiendo: boolean; pausaManual: boolean };

let estado: EstadoEnLineaCliente | null = null;
const oyentes = new Set<() => void>();

export function leerEstadoEnLineaCliente(): EstadoEnLineaCliente | null {
  return estado;
}

export function guardarEstadoEnLineaCliente(nuevo: EstadoEnLineaCliente | null | undefined) {
  if (!nuevo || typeof nuevo.recibiendo !== "boolean") {
    return;
  }
  if (estado && estado.recibiendo === nuevo.recibiendo && estado.pausaManual === nuevo.pausaManual) {
    return;
  }
  estado = { recibiendo: nuevo.recibiendo, pausaManual: Boolean(nuevo.pausaManual) };
  oyentes.forEach((oyente) => oyente());
}

export function suscribirEstadoEnLinea(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}
