// RESCATAR LO QUE ESPERA EL SÍ DEL DUEÑO SIN NECESITARLO (27-oct-2026). Decisión del dueño: Sistemas no le pide el "sí final" salvo
// por dinero o gasto en Meta Ads. Una tarjeta que pasó build y pruebas puede quedar POR_REVISAR solo porque la sesión que construyó no
// escribió la frase de la prueba extra ("✔ chats: sin mensajes nuevos a clientes"), o porque se reconstruyó después de que el dueño ya
// la había aprobado. Esta pasada la revisa de nuevo con el diff REAL de su rama (no con lo que diga el constructor):
//   - sin envíos nuevos de mensajes: el Coordinador escribe la confirmación y la tarjeta pasa a SUBIENDO (con la vigilancia de 30 min);
//   - con un envío nuevo en chats o en el bot: sigue esperando el sí del dueño, y el motivo queda en la tarjeta.
// El CRM vuelve a comprobar lo suyo (dinero, Meta Ads, migración destructiva) al recibir /:id/rescatar.
import { git } from "./git.mjs";
import { pruebaExtraDeLasZonas, zonasTocadas } from "./zonas.mjs";

/** Cada cuánto se mira (ms): es una llamada barata al CRM; el diff solo se lee si hay tarjetas candidatas. */
const CADA_MS = 3 * 60_000;

/** El diff de la rama de la tarjeta contra su base, leído del remoto sin tocar ninguna carpeta de trabajo. */
export async function diffDeLaRamaDeLaTarjeta(repo, tarjeta) {
  if (!tarjeta.rama || !tarjeta.base) return null;
  const traida = await git(repo.ruta, ["fetch", "--quiet", repo.remoto, tarjeta.rama], { permitirFallo: true, timeoutMs: 2 * 60_000 });
  if (traida.codigo !== undefined && traida.codigo !== 0) return null;
  const cabeza = (await git(repo.ruta, ["rev-parse", "FETCH_HEAD"])).salida.trim();
  // Si la rama ya no es el commit que probó el Coordinador, no se confía en este diff.
  if (tarjeta.commit && cabeza !== tarjeta.commit) return null;
  const nombres = (await git(repo.ruta, ["diff", "--name-only", "--no-renames", `${tarjeta.base}...${cabeza}`])).salida.split(/\r?\n/).map((linea) => linea.trim()).filter(Boolean);
  const diffDe = async (archivos) => (archivos.length ? (await git(repo.ruta, ["diff", "--unified=0", "--no-renames", `${tarjeta.base}...${cabeza}`, "--", ...archivos])).salida : "");
  return { archivos: nombres, diffDe };
}

/**
 * La decisión de una tarjeta: { accion: "subir", confirmacion } | { accion: "esperar", motivo } | { accion: "saltar", motivo }.
 * Pura salvo por `diff` ({ archivos, diffDe(archivos) } ya leído de la rama).
 */
export async function decidirRescate(tarjeta, repo, diff) {
  const zonasSolas = repo.zonasQueSubenSolas ?? [];
  const tocadas = zonasTocadas(diff.archivos, repo.zonasProtegidas);
  const zonas = [...new Set([...Object.keys(tocadas), ...(tarjeta.zonaProtegida ?? [])])];
  const queNoSuben = zonas.filter((zona) => !zonasSolas.includes(zona));
  if (queNoSuben.length) return { accion: "saltar", motivo: `la zona ${queNoSuben.join(", ")} espera el sí del dueño` };
  const diffs = { todo: await diff.diffDe(diff.archivos) };
  for (const zona of zonas) if (tocadas[zona]) diffs[zona] = await diff.diffDe(tocadas[zona]);
  const prueba = pruebaExtraDeLasZonas({ zonas, zonasQueSubenSolas: zonasSolas, diffs, plan: tarjeta.plan, texto: "" });
  if (prueba.esperaPor) {
    // El libro V3 necesita la simulación del que construyó: no se puede comprobar con el diff, se deja como está.
    if (/^falta (la simulaci[oó]n V3|el n[uú]mero de la versi[oó]n)/i.test(prueba.esperaPor)) return { accion: "saltar", motivo: prueba.esperaPor };
    return { accion: "esperar", motivo: prueba.esperaPor };
  }
  const confirmacion = prueba.confirmaciones.join(" · ") || "✔ revisado de nuevo por el Coordinador: sin pruebas extra pendientes y con el sí del dueño ya dado";
  return { accion: "subir", confirmacion };
}

/**
 * El rescatador. `diffDeLaRama(repo, tarjeta)` se inyecta para probar sin git ni red. Devuelve en revisar():
 *   { hizo, rescatadas: [{ id, titulo, accion, motivo }] }
 */
export function crearRescatador({ crm, config, registro, diffDeLaRama = diffDeLaRamaDeLaTarjeta, ahora = () => Date.now() }) {
  let ultima = 0;
  // Lo que ya se decidió en este arranque (tarjeta + commit): no se repite el mismo "sigue esperando" cada vuelta.
  const vistas = new Set();
  return {
    async revisar({ forzar = false } = {}) {
      if (!forzar && ahora() - ultima < CADA_MS) return { hizo: false, rescatadas: [] };
      ultima = ahora();
      const { tarjetas } = await crm.porRevisar();
      const rescatadas = [];
      for (const tarjeta of tarjetas ?? []) {
        const clave = `${tarjeta.id}:${tarjeta.commit ?? ""}:${tarjeta.esperaPor ?? ""}`;
        if (vistas.has(clave)) continue;
        const repo = config.repos?.[tarjeta.repo];
        if (!repo || repo.subirSolo !== true) {
          vistas.add(clave);
          continue;
        }
        try {
          const diff = await diffDeLaRama(repo, tarjeta);
          if (!diff) {
            registro.info(`rescate: "${tarjeta.titulo}": no pude leer el diff de su rama; sigue como está`);
            continue;
          }
          const decision = await decidirRescate(tarjeta, repo, diff);
          if (decision.accion === "saltar") {
            registro.info(`rescate: "${tarjeta.titulo}": ${decision.motivo}`);
            vistas.add(clave);
            continue;
          }
          if (decision.accion === "subir") await crm.rescatar(tarjeta.id, { sube: true, confirmacion: decision.confirmacion });
          else await crm.rescatar(tarjeta.id, { sube: false, motivo: decision.motivo });
          vistas.add(clave);
          registro.info(`rescate: "${tarjeta.titulo}": ${decision.accion === "subir" ? "sube sola" : `sigue esperando tu sí (${decision.motivo})`}`);
          rescatadas.push({ id: tarjeta.id, titulo: tarjeta.titulo, accion: decision.accion, motivo: decision.motivo ?? decision.confirmacion });
        } catch (error) {
          // El CRM puede decir que espera el sí del dueño (409): se deja así y no se vuelve a preguntar hasta que cambie.
          if (error?.status === 409) vistas.add(clave);
          registro.aviso(`rescate: no se pudo revisar "${tarjeta.titulo}": ${String(error?.message ?? error).split("\n")[0]}`);
        }
      }
      return { hizo: true, rescatadas };
    },
  };
}
