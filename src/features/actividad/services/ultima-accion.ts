/**
 * La última acción de cada persona, sin base de datos: aquí solo se decide cuál gana.
 *
 * Está aparte de `actividad.ts` para poder probarla con filas armadas a mano (ese archivo importa
 * Prisma). Las consultas viven allá, en `ultimaAccionPorPersona`.
 */

export type TipoDeUltimaAccion = "mensaje" | "etapa" | "asignacion" | "llamada";

export type UltimaAccion = {
  tipo: TipoDeUltimaAccion;
  /** La acción en palabras, lista para mostrar: "Envió un mensaje", "Cambió una etapa"... */
  texto: string;
  /** Nombre del cliente o, si no tiene, su teléfono. Null si la acción no tiene cliente. */
  cliente: string | null;
  cuando: Date;
};

export const TEXTO_DE_ULTIMA_ACCION: Record<TipoDeUltimaAccion, string> = {
  mensaje: "Envió un mensaje",
  etapa: "Cambió una etapa",
  asignacion: "Asignó un chat",
  llamada: "Llamó",
};

export type CandidataDeUltimaAccion = {
  userId: string | null;
  tipo: TipoDeUltimaAccion;
  cliente: string | null;
  cuando: Date;
};

/** De todas las fuentes juntas, por persona, la acción más reciente. */
export function quedarseConLaMasReciente(candidatas: CandidataDeUltimaAccion[]): Map<string, UltimaAccion> {
  const salida = new Map<string, UltimaAccion>();
  for (const candidata of candidatas) {
    if (!candidata.userId || Number.isNaN(candidata.cuando.getTime())) continue;
    const actual = salida.get(candidata.userId);
    if (actual && actual.cuando.getTime() >= candidata.cuando.getTime()) continue;
    salida.set(candidata.userId, {
      tipo: candidata.tipo,
      texto: TEXTO_DE_ULTIMA_ACCION[candidata.tipo],
      cliente: candidata.cliente?.trim() || null,
      cuando: candidata.cuando,
    });
  }
  return salida;
}
