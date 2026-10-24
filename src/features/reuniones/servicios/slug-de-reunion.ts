/*
  El link de una reunión sale de su título: "Reunión de ventas" -> /reunion/reunion-de-ventas.
  Los links viejos (códigos al azar) siguen valiendo porque el campo `codigo` es el mismo texto único.
  La sala de LiveKit NO sale del slug (es `reunion_<hex>` aparte).
*/

const MAXIMO = 60;

/** Minúsculas, sin tildes ni ñ, signos y espacios a guiones, sin guiones dobles ni en los bordes. */
export function slugDeTitulo(titulo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAXIMO)
    .replace(/-+$/g, "");
  return base || "reunion";
}

/** El slug libre: el base y, si ya existe, base-2, base-3, … (`existe` mira todas las reuniones). */
export async function slugLibre(titulo: string, existe: (codigo: string) => Promise<boolean>): Promise<string> {
  const base = slugDeTitulo(titulo);
  if (!(await existe(base))) {
    return base;
  }
  for (let n = 2; n < 10000; n += 1) {
    const candidato = `${base}-${n}`;
    if (!(await existe(candidato))) {
      return candidato;
    }
  }
  throw new Error("No se pudo armar un link libre.");
}
