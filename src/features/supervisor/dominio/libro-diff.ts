/**
 * QUÉ CAMBIÓ ENTRE DOS VERSIONES DEL LIBRO V3 (código puro).
 *
 * Reglas agregadas, borradas, editadas (y en qué: disparador, condiciones, acciones, activa,
 * nombre) y reordenadas. El orden importa: dos reglas de frase con el mismo peso se desempatan
 * por su lugar en el libro (ver agente-v3/domain/reglas.ts → pesoDeLaRegla), y fue justo un
 * cambio de orden lo que rompió la bienvenida del combo el 7-oct-2026.
 */

import { pesoDeLaRegla, type LibroDeReglas, type ReglaV3 } from "../../agente-v3/domain/reglas";

export type CambioDeRegla = { id: string; nombre: string; campos?: string[]; desde?: number; hasta?: number };

export type DiffDelLibro = {
  versionAnterior: number;
  versionNueva: number;
  agregadas: CambioDeRegla[];
  borradas: CambioDeRegla[];
  editadas: CambioDeRegla[];
  /** Reglas que cambiaron de lugar RELATIVO frente a las demás que siguen (desde → hasta). */
  reordenadas: CambioDeRegla[];
  /** Reordenadas que comparten peso con otra regla de frase: el desempate puede haber cambiado. */
  reordenadasConEmpate: CambioDeRegla[];
  /** Borradas y vueltas a crear con el mismo nombre: quedan en otro lugar del libro. */
  recreadas: CambioDeRegla[];
  cambioComoHablamos: boolean;
  resumen: string;
};

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function corto(nombre: string): string {
  return nombre.length > 70 ? `${nombre.slice(0, 67)}…` : nombre;
}

export function diffDelLibro(anterior: LibroDeReglas, nuevo: LibroDeReglas): DiffDelLibro {
  const idsAntes = new Map(anterior.reglas.map((regla, i) => [regla.id, { regla, i }]));
  const idsDespues = new Map(nuevo.reglas.map((regla, i) => [regla.id, { regla, i }]));

  const agregadas = nuevo.reglas.filter((r) => !idsAntes.has(r.id)).map((r) => ({ id: r.id, nombre: r.nombre }));
  const borradas = anterior.reglas.filter((r) => !idsDespues.has(r.id)).map((r) => ({ id: r.id, nombre: r.nombre }));

  const editadas: CambioDeRegla[] = [];
  for (const regla of nuevo.reglas) {
    const antes = idsAntes.get(regla.id)?.regla;
    if (!antes) continue;
    const campos: string[] = [];
    if (!igual(antes.cuando, regla.cuando)) campos.push("disparador");
    if (!igual(antes.soloSi, regla.soloSi)) campos.push("condiciones");
    if (!igual(antes.entonces, regla.entonces)) campos.push("acciones");
    if (antes.activa !== regla.activa) campos.push(regla.activa ? "activada" : "desactivada");
    if (antes.nombre !== regla.nombre) campos.push("nombre");
    if (campos.length) editadas.push({ id: regla.id, nombre: regla.nombre, campos });
  }

  // Orden relativo entre las reglas que están en las dos versiones.
  const comunesAntes = anterior.reglas.filter((r) => idsDespues.has(r.id)).map((r) => r.id);
  const comunesDespues = nuevo.reglas.filter((r) => idsAntes.has(r.id)).map((r) => r.id);
  const posAntes = new Map(comunesAntes.map((id, i) => [id, i]));
  const posDespues = new Map(comunesDespues.map((id, i) => [id, i]));
  /*
    Una regla "se movió" si cambió su orden contra alguna otra. Para no listar a todas las que se
    corren un lugar cuando una sola salta al final, se marca la que más se movió primero y se
    repite hasta que el orden quede igual (como un "deshacer" de a una).
  */
  const reordenadas: CambioDeRegla[] = [];
  let orden = [...comunesAntes];
  const objetivo = comunesDespues;
  for (let vuelta = 0; vuelta < objetivo.length && orden.join() !== objetivo.join(); vuelta += 1) {
    let peor: string | null = null;
    let distancia = 0;
    orden.forEach((id, i) => {
      const d = Math.abs(i - (posDespues.get(id) ?? i));
      if (d > distancia) {
        distancia = d;
        peor = id;
      }
    });
    if (!peor) break;
    const id: string = peor;
    const regla = idsDespues.get(id)!.regla;
    reordenadas.push({
      id,
      nombre: regla.nombre,
      desde: idsAntes.get(id)!.i,
      hasta: idsDespues.get(id)!.i,
    });
    orden = orden.filter((x) => x !== id);
    orden.splice(posDespues.get(id) ?? orden.length, 0, id);
  }
  void posAntes;

  const reglaDe = (id: string): ReglaV3 | undefined => idsDespues.get(id)?.regla;
  const reordenadasConEmpate = reordenadas.filter((cambio) => {
    const regla = reglaDe(cambio.id);
    if (!regla || regla.cuando.tipo !== "frase") return false;
    const peso = pesoDeLaRegla(regla);
    return nuevo.reglas.some((otra) => otra.id !== regla.id && otra.activa && otra.cuando.tipo === "frase" && pesoDeLaRegla(otra) === peso);
  });

  /*
    Recreada: se borró y se volvió a crear con el MISMO nombre (otro id). Para el motor es una
    regla nueva que entra al FINAL del libro y pierde su lugar en el desempate. Es lo que pasó con
    "Pide el combo de camillas" en las versiones 179–181 (7-oct-2026).
  */
  const recreadas: CambioDeRegla[] = agregadas
    .filter((nueva) => borradas.some((vieja) => vieja.nombre.trim() === nueva.nombre.trim()))
    .map((nueva) => {
      const vieja = borradas.find((b) => b.nombre.trim() === nueva.nombre.trim())!;
      return { id: nueva.id, nombre: nueva.nombre, desde: idsAntes.get(vieja.id)?.i, hasta: idsDespues.get(nueva.id)?.i };
    });

  const cambioComoHablamos = (anterior.comoHablamos ?? "") !== (nuevo.comoHablamos ?? "");
  const partes: string[] = [];
  if (recreadas.length)
    partes.push(
      `${recreadas.length} RECREADA(S) (borrada y vuelta a crear: pierde su lugar en el desempate): ${recreadas
        .map((c) => `"${corto(c.nombre)}" (lugar ${c.desde} → ${c.hasta})`)
        .join(", ")}`,
    );
  if (agregadas.length) partes.push(`${agregadas.length} agregada(s): ${agregadas.map((c) => `"${corto(c.nombre)}"`).join(", ")}`);
  if (borradas.length) partes.push(`${borradas.length} borrada(s): ${borradas.map((c) => `"${corto(c.nombre)}"`).join(", ")}`);
  if (editadas.length) partes.push(`${editadas.length} editada(s): ${editadas.map((c) => `"${corto(c.nombre)}" (${c.campos?.join(", ")})`).join(", ")}`);
  if (reordenadas.length)
    partes.push(`${reordenadas.length} reordenada(s): ${reordenadas.map((c) => `"${corto(c.nombre)}" (lugar ${c.desde} → ${c.hasta})`).join(", ")}`);
  if (cambioComoHablamos) partes.push(`cambió "cómo habla el negocio"`);

  return {
    versionAnterior: anterior.version,
    versionNueva: nuevo.version,
    agregadas,
    borradas,
    editadas,
    reordenadas,
    reordenadasConEmpate,
    recreadas,
    cambioComoHablamos,
    resumen: partes.length ? partes.join("; ") : "sin cambios en las reglas",
  };
}
