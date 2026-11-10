import {
  PREFIJO_CONFIG_DEMORA,
  leerConfigDemoraDeTexto,
  type ConfigDemora,
} from "@/features/chats/domain/demora-de-asesora";

/**
 * EL BOTÓN DE LA REGLA DE DEMORA DE ASESORA (Mi empresa → Equipo), sin base de datos (para poder
 * probarlo solo).
 *
 * Lee y escribe LA MISMA fila que usa la regla (`chats:demora-asesora:config:<negocio>`), con la misma
 * lectura (`leerConfigDemoraDeTexto`). No hay otra configuración. Al guardar se mantiene lo demás que
 * tenga la fila (por ejemplo `minutosActiva`). La regla en sí no se toca.
 *
 * Cada cambio queda en un historial aparte (`chats:demora-asesora:historial:<negocio>`, los últimos 50).
 * Su clave no empieza por PREFIJO_CONFIG_DEMORA, así que la regla no lo confunde con un negocio.
 */

export const claveConfigDemora = (workspaceId: string) => `${PREFIJO_CONFIG_DEMORA}${workspaceId}`;

export const PREFIJO_HISTORIAL_DEMORA = "chats:demora-asesora:historial:";
export const claveHistorialDemora = (workspaceId: string) => `${PREFIJO_HISTORIAL_DEMORA}${workspaceId}`;

/** Cambios que se guardan en el historial. */
export const MAXIMO_CAMBIOS_EN_HISTORIAL = 50;

/** Rango que acepta el botón para los minutos (el servidor rechaza lo demás). */
export const MINUTOS_MINIMOS = 1;
export const MINUTOS_MAXIMOS = 120;

/** Lo que se ve y se cambia desde el botón. */
export type EstadoDelBoton = Pick<ConfigDemora, "activo" | "minutosAviso" | "minutosReasignar">;

export type CambioDeDemora = {
  en: string;
  quienId: string;
  quienNombre: string;
  antes: EstadoDelBoton;
  despues: EstadoDelBoton;
};

function comoEntero(valor: unknown): number | null {
  const numero = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
  return typeof numero === "number" && Number.isInteger(numero) ? numero : null;
}

/**
 * Valida lo que manda el formulario. Minutos enteros de 1 a 120 y la reasignación mayor que el aviso;
 * si no, devuelve el error y no se guarda nada.
 */
export function validarPedidoDeDemora(
  pedido: { activo: unknown; minutosAviso: unknown; minutosReasignar: unknown },
): { ok: true; estado: EstadoDelBoton } | { error: string } {
  if (typeof pedido.activo !== "boolean") {
    return { error: "Elige Prendida o Apagada." };
  }
  const minutosAviso = comoEntero(pedido.minutosAviso);
  const minutosReasignar = comoEntero(pedido.minutosReasignar);
  const enRango = (n: number | null): n is number => n !== null && n >= MINUTOS_MINIMOS && n <= MINUTOS_MAXIMOS;
  if (!enRango(minutosAviso) || !enRango(minutosReasignar)) {
    return { error: `Los minutos deben ser números enteros de ${MINUTOS_MINIMOS} a ${MINUTOS_MAXIMOS}.` };
  }
  if (minutosReasignar <= minutosAviso) {
    return { error: "Los minutos para pasar el chat deben ser más que los del aviso." };
  }
  return { ok: true, estado: { activo: pedido.activo, minutosAviso, minutosReasignar } };
}

/** El estado del botón, leído como lo lee la regla. Sin fila o con JSON roto = Apagada, 5 y 10. */
export function estadoDelBotonDeTexto(texto: string | null | undefined): EstadoDelBoton {
  const config = leerConfigDemoraDeTexto(texto);
  return { activo: config.activo, minutosAviso: config.minutosAviso, minutosReasignar: config.minutosReasignar };
}

/**
 * El texto nuevo de la fila: lo que ya tenía (minutosActiva y cualquier otra clave) más lo pedido. Si la
 * fila estaba rota o no era un objeto, queda bien escrita solo con lo pedido.
 */
export function textoDeConfigNueva(textoActual: string | null | undefined, estado: EstadoDelBoton): string {
  let base: Record<string, unknown> = {};
  try {
    const v = textoActual ? JSON.parse(textoActual) : null;
    base = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    base = {};
  }
  return JSON.stringify({
    ...base,
    activo: estado.activo,
    minutosAviso: estado.minutosAviso,
    minutosReasignar: estado.minutosReasignar,
  });
}

function esEstado(v: unknown): v is EstadoDelBoton {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.activo === "boolean" && typeof e.minutosAviso === "number" && typeof e.minutosReasignar === "number";
}

/** Lee el historial guardado, del más nuevo al más viejo. JSON roto = vacío; entradas raras se saltan. */
export function leerHistorialDemoraDeTexto(texto: string | null | undefined): CambioDeDemora[] {
  let crudo: unknown;
  try {
    crudo = texto ? JSON.parse(texto) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(crudo)) return [];
  return crudo.filter((v): v is CambioDeDemora => {
    if (!v || typeof v !== "object") return false;
    const c = v as Record<string, unknown>;
    return (
      typeof c.en === "string" &&
      typeof c.quienId === "string" &&
      typeof c.quienNombre === "string" &&
      esEstado(c.antes) &&
      esEstado(c.despues)
    );
  });
}

/** El historial con el cambio nuevo primero y como máximo MAXIMO_CAMBIOS_EN_HISTORIAL. */
export function agregarAlHistorial(historial: readonly CambioDeDemora[], cambio: CambioDeDemora): CambioDeDemora[] {
  return [cambio, ...historial].slice(0, MAXIMO_CAMBIOS_EN_HISTORIAL);
}
