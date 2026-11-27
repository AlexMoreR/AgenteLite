// Repo correcto ANTES de planear (27-nov-2026, caso T-940): una tarjeta creada en el repo equivocado gastaba una sesión de plan allá.
// Antes de planear, el Coordinador mira en qué repo (gestion o aizencrm) están los archivos que nombra la tarjeta; si están solo
// en el otro, le cambia el repo a la tarjeta y sigue planeando ahí, sin preguntarle a nadie (etapas.mjs: planear).
//   rutasDeLaTarjeta(tarjeta)       -> las rutas que nombran el título y el detalle (función pura).
//   repoCorrecto(contexto, tarjeta) -> { repo, motivo } o null. Nunca lanza.
import { archivosDelPlan, noChoca } from "./choques.mjs";
import { git } from "./git.mjs";

/** Tope de rutas que se comparan (una tarjeta normal nombra menos de 30). */
const MAX_RUTAS = 80;

/**
 * Las rutas de archivo que nombran el título y el detalle de la tarjeta, con el mismo patrón que archivosDelPlan (choques.mjs).
 * Sin comodines ("*"), sin el manual ni las notas de cambios pendientes (noChoca), sin repetidas y sin la "/" del final.
 */
export function rutasDeLaTarjeta(tarjeta) {
  const texto = `${tarjeta?.titulo ?? ""}\n${tarjeta?.detalle ?? ""}`;
  const rutas = archivosDelPlan(texto)
    .map((ruta) => ruta.replace(/\/+$/, ""))
    .filter((ruta) => ruta && !ruta.includes("*") && !noChoca(ruta, []));
  return [...new Set(rutas)].slice(0, MAX_RUTAS);
}

/** ¿La ruta está entre estos archivos? Con carpeta, completa (o como carpeta); un nombre suelto, por el final de la ruta. */
function estaEn(archivos, ruta) {
  if (ruta.includes("/")) return archivos.some((archivo) => archivo === ruta || archivo.startsWith(`${ruta}/`));
  return archivos.some((archivo) => archivo === ruta || archivo.endsWith(`/${ruta}`));
}

/** Los archivos de la rama base de un repo (git ls-tree), o null si no se pudo leer. */
async function archivosDelRepo(repo) {
  try {
    const respuesta = await git(repo.ruta, ["ls-tree", "-r", "--name-only", `${repo.remoto ?? "origin"}/${repo.ramaBase ?? "main"}`], { permitirFallo: true, timeoutMs: 60_000 });
    if (respuesta.codigo !== 0) return null;
    return respuesta.salida.split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * ¿La tarjeta está en el repo equivocado? Por cada repo de config.repos, git ls-tree -r --name-only <remoto>/<ramaBase>.
 * Devuelve { repo, motivo } solo si NINGUNA ruta de la tarjeta está en su repo y alguna está en otro; si no (están en los dos, en
 * ninguno, la tarjeta no nombra rutas o un nombre suelto como route.ts existe en ambos), null: ante la duda, el repo se queda.
 * Nunca lanza: si git falla (en el repo de la tarjeta o en todos los demás), null.
 */
export async function repoCorrecto(contexto, tarjeta) {
  try {
    const repos = contexto?.config?.repos ?? {};
    const propio = repos[tarjeta?.repo];
    if (!propio) return null;
    const rutas = rutasDeLaTarjeta(tarjeta);
    if (!rutas.length) return null;
    const archivosPropios = await archivosDelRepo(propio);
    if (!archivosPropios) return null;
    if (rutas.some((ruta) => estaEn(archivosPropios, ruta))) return null;
    let mejor = null;
    for (const [clave, repo] of Object.entries(repos)) {
      if (clave === tarjeta.repo || !repo?.ruta) continue;
      const archivos = await archivosDelRepo(repo);
      if (!archivos) continue;
      const aca = rutas.filter((ruta) => estaEn(archivos, ruta));
      if (aca.length && (!mejor || aca.length > mejor.rutas.length)) mejor = { repo: clave, rutas: aca };
    }
    if (!mejor) return null;
    const cuales = mejor.rutas.slice(0, 3).join(", ") + (mejor.rutas.length > 3 ? ` y ${mejor.rutas.length - 3} más` : "");
    return { repo: mejor.repo, motivo: `La tarjeta nombra archivos que están en ${mejor.repo} y no en ${tarjeta.repo}: ${cuales}` };
  } catch {
    return null;
  }
}
