// Choques entre tarjetas (22-oct-2026, tarjeta "Trabajador: varias tarjetas en paralelo"): el trabajador
// corre varias a la vez, pero NO junta dos que se pisarían. Esas esperan en fila (van en `excluir` a /tomar).
//
// Chocan dos tarjetas del MISMO repo si:
//   - las dos van a SUBIR (la cola de subida a main: de a una por repo, con rebase y compilación de nuevo);
//   - las dos van a construir o subir (planear solo lee: nunca choca) y tocan la misma zona protegida
//     (chats, bot de ventas, libro V3, Meta Ads) o el mismo módulo (src/features/<x>, src/app/<...>,
//     src/lib/<x>, prisma, package.json...), según los archivos que dice el plan;
//   - el plan de alguna no dice ningún archivo: no se sabe qué toca, mejor en fila.
// Tarjetas de repos distintos nunca chocan.
import { zonasTocadas } from "./zonas.mjs";

/** Carpetas de arriba que cuentan como ruta aunque el archivo no tenga extensión. */
const RAICES = new Set(["src", "prisma", "scripts", "trabajador-tablero", "public", "app", "lib", "components", "features", "tests", "docs", "pruebas"]);
const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs|json|prisma|sql|css|scss|md|yml|yaml|html|ps1|sh|env|txt)$/i;

/**
 * La parte "5. Archivos que se tocan" del plan (hasta la 6), si la tiene; si no, todo el plan. Así un
 * archivo que solo se nombra en "6. Cómo se va a probar" (un script de pruebas común) no hace chocar.
 */
function parteDeArchivos(plan) {
  const texto = String(plan ?? "");
  const inicio = texto.search(/^[\s#*>-]*5\s*[.)-]/m);
  if (inicio < 0) return texto;
  const resto = texto.slice(inicio);
  const fin = resto.slice(1).search(/^[\s#*>-]*6\s*[.)-]/m);
  return fin < 0 ? resto : resto.slice(0, fin + 1);
}

/** Las rutas de archivos o carpetas que nombra un plan (en su parte 5, si la tiene). */
export function archivosDelPlan(plan) {
  const encontrados = new Set();
  for (const crudo of parteDeArchivos(plan).split(/[\s`'"“”‘’(),;<>|*]+/)) {
    if (!crudo || /^[a-z]+:\/\//i.test(crudo) || crudo.includes("://")) continue;
    // Sin puntuación al final ("src/a.ts." o "src/a/:") ni ":12" de línea.
    const limpio = crudo.replace(/\\/g, "/").replace(/^\.\//, "").replace(/:\d+(:\d+)?$/, "").replace(/[.:!?]+$/, "");
    if (!limpio || limpio.startsWith("/") || limpio.includes("..")) continue;
    const partes = limpio.split("/").filter(Boolean);
    if (!partes.length || !/^[\w.@[\]-]+$/.test(partes.join(""))) continue;
    const esRuta = partes.length > 1 ? EXTENSIONES.test(limpio) || RAICES.has(partes[0]) : EXTENSIONES.test(limpio) && /^[\w.-]+$/.test(limpio);
    if (esRuta) encontrados.add(partes.join("/"));
  }
  return [...encontrados];
}

const sinExtension = (texto) => texto.replace(/\.[^.]+$/, "");
const esArchivo = (parte) => EXTENSIONES.test(parte);
/** "(grupo)" y "[id]" de Next no son módulos. */
const segmentoUtil = (parte) => !/^\(.*\)$/.test(parte) && !/^\[.*\]$/.test(parte);

/** El módulo de una ruta: dos archivos del mismo módulo no se construyen a la vez. */
export function moduloDe(ruta) {
  const partes = String(ruta).replace(/\\/g, "/").split("/").filter(Boolean);
  if (partes[0] === "src") partes.shift();
  if (!partes.length) return null;
  if (partes[0] === "prisma") return "prisma";
  if (partes.length === 1) return /^package(-lock)?\.json$/.test(partes[0]) ? "package" : sinExtension(partes[0]);
  if (partes[0] === "app") {
    // app/api/trabajador/tablero/tomar/route.ts -> app/api/trabajador/tablero; app/cliente/chats/page.tsx -> app/cliente/chats.
    const carpetas = (esArchivo(partes.at(-1)) ? partes.slice(1, -1) : partes.slice(1)).filter(segmentoUtil);
    return ["app", ...carpetas.slice(0, 3)].join("/");
  }
  // features/coach/..., lib/mcp/..., lib/agent.ts -> lib/agent, scripts/x.mjs -> scripts/x.
  return `${partes[0]}/${esArchivo(partes[1]) ? sinExtension(partes[1]) : partes[1]}`;
}

/**
 * Lo que importa de una tarjeta para saber si choca: repo, etapa, zonas (las que ya tiene + las que
 * tocan los archivos del plan) y módulos (null = el plan no dice archivos).
 */
export function huellaDeTarjeta(tarjeta, hacer, repoConfig) {
  const archivos = archivosDelPlan(tarjeta.plan);
  const zonas = new Set([
    ...(tarjeta.zonaProtegida ?? tarjeta.zonasAprobadas ?? []),
    ...Object.keys(zonasTocadas(archivos, repoConfig?.zonasProtegidas ?? {})),
  ]);
  const modulos = archivos.length ? new Set(archivos.map(moduloDe).filter(Boolean)) : null;
  return { id: tarjeta.id, titulo: tarjeta.titulo, repo: tarjeta.repo, hacer, zonas, modulos };
}

/** ¿Chocan? Devuelve el motivo en palabras sencillas, o null si pueden ir a la vez. */
export function motivoDeChoque(a, b) {
  if (a.repo !== b.repo) return null;
  if (a.hacer === "subir" && b.hacer === "subir") return `las dos suben a main de ${a.repo} (de a una)`;
  if (a.hacer === "planear" || b.hacer === "planear") return null;
  const zona = [...a.zonas].find((una) => b.zonas.has(una));
  if (zona) return `las dos tocan la zona ${zona}`;
  if (!a.modulos || !b.modulos) return `el plan de "${(!a.modulos ? a : b).titulo}" no dice qué archivos toca`;
  const modulo = [...a.modulos].find((uno) => b.modulos.has(uno));
  if (modulo) return `las dos tocan el módulo ${modulo}`;
  return null;
}

/**
 * De las candidatas (lo que /candidatas dice que se podría tomar), las que chocan con alguna de las
 * que ya corren: { id: motivo }. `repos` = config.repos (para las zonas por ruta).
 */
export function candidatasQueChocan(candidatas, corriendo, repos) {
  const chocan = {};
  for (const candidata of candidatas ?? []) {
    if (!candidata?.hacer) continue;
    const huella = huellaDeTarjeta(candidata, candidata.hacer, repos[candidata.repo]);
    for (const otra of corriendo) {
      const motivo = motivoDeChoque(huella, otra);
      if (motivo) {
        chocan[candidata.id] = `choca con "${otra.titulo}": ${motivo}`;
        break;
      }
    }
  }
  return chocan;
}
