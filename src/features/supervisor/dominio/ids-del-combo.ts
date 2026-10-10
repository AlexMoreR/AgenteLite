import type { LibroDeReglas } from "../../agente-v3/domain/reglas";

/** El producto del combo y su flujo de fotos, sacados del libro (para los escenarios dorados). */
export function idsDelComboEnElLibro(libro: LibroDeReglas): { productoComboId: string | null; flujoFotosCombo: string | null } {
  const conteo = new Map<string, number>();
  let flujoFotosCombo: string | null = null;
  for (const regla of libro.reglas) {
    const producto = regla.soloSi?.productoActivo;
    if (producto && producto !== "ninguno" && producto !== "cualquiera") conteo.set(producto, (conteo.get(producto) ?? 0) + 1);
    for (const accion of regla.entonces) {
      if (accion.tipo === "flujo" && /foto.*combo|combo.*foto/i.test(accion.titulo ?? "")) flujoFotosCombo ??= accion.flujoId;
    }
  }
  const productoComboId = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { productoComboId, flujoFotosCombo };
}
