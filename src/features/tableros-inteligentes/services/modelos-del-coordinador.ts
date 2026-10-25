/*
  QUÉ MODELO USÓ CADA PASO del Coordinador (23-oct-2026, pedido de Alexander). El Coordinador elige el
  modelo con reglas fijas (trabajador-tablero/lib/modelos.mjs) y lo manda en el resultado
  (resultado.modelo) y en la firma del plan ("Plan escrito con: Claude Code (Opus)").

  Función pura, sin base ni Next (pruebas: npm run test:tableros). Texto para la tarjeta, por ejemplo:
  "Planeado con Opus · Construido con Sonnet".
*/

export type ModelosDelResultado = Partial<Record<"plan" | "construir" | "revisar" | "subagentes", string>>;

/** Los pasos que se muestran, en orden, con cómo se dice cada uno. Los subagentes no se muestran. */
const PASOS_VISIBLES = [
  ["plan", "Planeado"],
  ["construir", "Construido"],
  ["revisar", "Revisado"],
] as const;

/** Un nombre de modelo limpio: solo letras, números y . _ : - (máximo 60). Lo demás se descarta. */
export function modeloDeEntrada(valor: unknown): string | null {
  const texto = typeof valor === "string" ? valor.trim().slice(0, 60) : "";
  return /^[\w.: -]+$/.test(texto) ? texto : null;
}

/** Los modelos que manda el Coordinador, limpios: solo pasos conocidos. */
export function modelosDeEntrada(valor: unknown): ModelosDelResultado | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const modelos: ModelosDelResultado = {};
  for (const paso of ["plan", "construir", "revisar", "subagentes"] as const) {
    const modelo = modeloDeEntrada((valor as Record<string, unknown>)[paso]);
    if (modelo) modelos[paso] = modelo;
  }
  return Object.keys(modelos).length ? modelos : null;
}

/** "opus" / "claude-sonnet-4-5" -> "Opus" / "Sonnet"; un nombre raro se deja como viene. */
export function nombreDelModelo(modelo: string): string {
  const familia = modelo.match(/opus|sonnet|haiku/i)?.[0]?.toLowerCase();
  return familia ? familia[0].toUpperCase() + familia.slice(1) : modelo;
}

/** El modelo del plan según su firma ("Plan escrito con: Claude Code (Opus)"), o null (planes viejos, Codex). */
export function modeloDeLaFirmaDelPlan(plan: string | null | undefined): string | null {
  return String(plan ?? "").match(/^Plan escrito con: Claude Code \(([^)\n]+)\)\s*$/im)?.[1]?.trim() ?? null;
}

/* ───────────────────────────────────────────────────────── dónde se construyó (25-oct-2026) ── */

/** Un link de sesión de Claude en la nube: solo https://claude.ai/code/session_… (sin parámetros ni otros sitios). */
export function esLinkDeSesion(valor: unknown): valor is string {
  return typeof valor === "string" && /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]{1,200}$/.test(valor);
}

type ConstruccionVista = {
  construidoEn?: "aizen1" | "nube";
  linkSesion?: string | null;
  construccion?: { lugar?: "aizen1" | "nube"; linkSesion?: string | null };
} | null;

/**
 * Lo que la tarjeta dice de dónde se construyó, o null si no se sabe (una tarjeta de antes) o no aplica:
 *  - EN_CURSO en la nube: "La está construyendo Claude en la nube…" + el link de la sesión (si ya lo hay);
 *  - ya construida: "Construida en: aizen1" o "Construida en: la nube" + el link de la sesión.
 * El link solo sale si es de claude.ai/code/session_…: cualquier otro se descarta.
 */
export function dondeSeConstruyo(
  estado: string,
  resultado: ConstruccionVista | undefined,
): { lugar: "aizen1" | "nube"; texto: string; link: string | null } | null {
  if (!resultado) return null;
  if (estado === "EN_CURSO") {
    if (resultado.construccion?.lugar !== "nube") return null;
    return { lugar: "nube", texto: "La está construyendo Claude en la nube…", link: esLinkDeSesion(resultado.construccion.linkSesion) ? resultado.construccion.linkSesion : null };
  }
  // Una tarjeta que se cayó en la nube (ERROR) no tiene construidoEn: se sabe por lo que avisó el latido.
  const lugar = resultado.construidoEn ?? (estado === "ERROR" ? resultado.construccion?.lugar : undefined);
  if (lugar !== "nube" && lugar !== "aizen1") return null;
  if (lugar === "aizen1") return { lugar, texto: "Construida en: aizen1", link: null };
  const enlace = resultado.linkSesion ?? resultado.construccion?.linkSesion;
  return { lugar, texto: "Construida en: la nube", link: esLinkDeSesion(enlace) ? enlace : null };
}

/** "Planeado con Opus · Construido con Sonnet", o "" si no se sabe ningún modelo. */
export function textoDeModelos(plan: string | null | undefined, modelos: ModelosDelResultado | null | undefined): string {
  const por = { ...(modelos ?? {}) };
  if (!por.plan) {
    const delPlan = modeloDeLaFirmaDelPlan(plan);
    if (delPlan) por.plan = delPlan;
  }
  return PASOS_VISIBLES.filter(([paso]) => por[paso])
    .map(([paso, verbo]) => `${verbo} con ${nombreDelModelo(por[paso] as string)}`)
    .join(" · ");
}
