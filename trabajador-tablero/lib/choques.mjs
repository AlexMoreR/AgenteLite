// Choques entre tarjetas (22-oct-2026, tarjeta "Trabajador: varias tarjetas en paralelo"): el trabajador
// corre varias a la vez, pero NO junta dos que se pisarían. Esas esperan en fila (van en `excluir` a /tomar).
//
// Chocan dos tarjetas del MISMO repo si:
//   - las dos van a SUBIR (la cola de subida a main: de a una por repo, con rebase y compilación de nuevo);
//   - las dos van a construir o subir (planear solo lee: nunca choca) y tocan la misma zona protegida
//     (chats, bot de ventas, libro V3, Meta Ads) o el mismo módulo (src/features/<x>, src/app/<...>,
//     src/lib/<x>, prisma, package.json...), según los archivos que dice el plan;
//   - una carpeta o un glob del plan ("src/features/coach/", "src/lib/**") contiene un archivo de la otra (rutasChocan);
//   - el plan de alguna no dice ningún archivo: no se sabe qué toca, mejor en fila.
// Tarjetas de repos distintos nunca chocan.
//   (Los archivos "sin choque" —por defecto los .md, como docs/que-es-esta-aplicacion.md— no cuentan: ver noChoca.)
import { globARegex, zonasTocadas } from "./zonas.mjs";

/** Carpetas de arriba que cuentan como ruta aunque el archivo no tenga extensión. */
const RAICES = new Set(["src", "prisma", "scripts", "trabajador-tablero", "public", "app", "lib", "components", "features", "tests", "docs", "pruebas"]);
const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs|json|prisma|sql|css|scss|md|yml|yaml|html|ps1|sh|env|txt)$/i;

/** El encabezado de la parte 5 ("## 5. Archivos que se tocan", "**5. Archivos**", "5) Archivos…"). */
const ENCABEZADO_DE_ARCHIVOS = /^[\s#*>-]*5\s*[.)-]\s*\**\s*Archivos/im;
/** El encabezado de la parte 6. */
const ENCABEZADO_DE_LA_6 = /^[\s#*>-]*6\s*[.)-]/m;

/**
 * La parte "5. Archivos que se tocan" del plan (hasta la 6), si la tiene; si no, todo el plan. Así un
 * archivo que solo se nombra en "6. Cómo se va a probar" (un script de pruebas común) no hace chocar.
 * 25-oct-2026: se busca el ENCABEZADO "5. Archivos…". Antes se tomaba la primera línea que empezaba con "5." y
 * muchos planes tienen una lista numerada en la parte 1 ("5. **Vigilancia…**"): se leía ese punto, no salía ningún
 * archivo y la tarjeta quedaba "el plan no dice qué archivos toca" -> en fila detrás de todas (46 esperas el 24-25-oct).
 */
function parteDeArchivos(plan) {
  const texto = String(plan ?? "");
  const encabezado = texto.search(ENCABEZADO_DE_ARCHIVOS);
  const inicio = encabezado >= 0 ? encabezado : texto.search(/^[\s#*>-]*5\s*[.)-]/m);
  if (inicio < 0) return texto;
  const resto = texto.slice(inicio);
  // El fin se busca desde la línea siguiente al encabezado: la parte 6, o un encabezado markdown del mismo nivel o más alto.
  const saltoDeLinea = resto.indexOf("\n");
  if (saltoDeLinea < 0) return resto;
  const nivel = resto.match(/^\s*(#{1,6})\s/)?.[1].length ?? 0;
  const siguiente = nivel ? new RegExp(`${ENCABEZADO_DE_LA_6.source}|^#{1,${nivel}}\\s`, "m") : ENCABEZADO_DE_LA_6;
  const fin = resto.slice(saltoDeLinea + 1).search(siguiente);
  return fin < 0 ? resto : resto.slice(0, saltoDeLinea + 1 + fin);
}

/**
 * Los documentos (.md) no hacen chocar a dos tarjetas (25-oct-2026): casi todas las tareas tocan el manual
 * docs/que-es-esta-aplicacion.md y eso ponía en fila a todas detrás de una. Al subir, el rebase junta los dos lados
 * de un .md (merge=union, ver git.mjs: rebaseSobre), así que dos que tocan el mismo documento no chocan en main.
 */
export const esDocumento = (ruta) => /\.md$/i.test(String(ruta));

/**
 * Los archivos "de solo agregar" que NO hacen chocar (configurable por repo: repos.<x>.sinChoque, globs). Por defecto
 * todos los .md. Los mismos globs van con merge=union al subir (git.mjs: rebaseSobre): si dos tareas agregan líneas
 * al mismo archivo, quedan las dos. Solo poner ahí archivos donde juntar las dos versiones es seguro (no código).
 */
export const SIN_CHOQUE_POR_DEFECTO = ["**/*.md"];

/**
 * El manual y las notas de cambios pendientes NUNCA hacen chocar (26-oct-2026), diga lo que diga repos.<x>.sinChoque:
 * las tareas ya no editan el manual (dejan una nota en docs/cambios-pendientes/<id>.md) y el Coordinador lo pone
 * al día una vez por noche (manual-nocturno.mjs). Si no se ignoraran, todas las tareas caerían en el mismo módulo "docs".
 */
export const SIN_CHOQUE_SIEMPRE = ["docs/que-es-esta-aplicacion.md", "docs/cambios-pendientes/**"];

/** ¿Este archivo no cuenta para chocar? `globs` = repoConfig.sinChoque (o el defecto). */
export function noChoca(ruta, globs = SIN_CHOQUE_POR_DEFECTO) {
  const limpia = String(ruta).replace(/\\/g, "/");
  if (SIN_CHOQUE_SIEMPRE.some((glob) => globARegex(glob).test(limpia))) return true;
  return (globs ?? SIN_CHOQUE_POR_DEFECTO).some((glob) => globARegex(glob).test(limpia));
}

/** Las rutas de archivos o carpetas que nombra un plan (en su parte 5, si la tiene; si ahí no hay ninguna, en todo el plan). */
export function archivosDelPlan(plan) {
  const parte = archivosDeTexto(parteDeArchivos(plan));
  return parte.length ? parte : archivosDeTexto(String(plan ?? ""));
}

/**
 * Los "*" de markdown (negrita, viñetas) se quitan; los de un glob se quedan (31-oct-2026): antes se cortaba la ruta en
 * cada "*" y "src/lib/**" quedaba "src/lib". Un "*" pegado al principio sale si no sigue "/" ("**src/a.ts**", "*"); uno
 * pegado al final sale si no viene justo después de "/" ("src/a.ts**" sí, "src/lib/**" no).
 */
const sinNegrita = (texto) => texto.replace(/^\*+(?![/*])/, "").replace(/([^/*])\*+$/, "$1");

function archivosDeTexto(texto) {
  const encontrados = new Set();
  for (const crudo of texto.split(/[\s`'"“”‘’(),;<>|]+/)) {
    if (!crudo || /^[a-z]+:\/\//i.test(crudo) || crudo.includes("://")) continue;
    // Sin puntuación al final ("src/a.ts." o "src/a/:") ni ":12" de línea.
    const limpio = sinNegrita(sinNegrita(crudo.replace(/\\/g, "/")).replace(/^\.\//, "").replace(/:\d+(:\d+)?$/, "").replace(/[.:!?]+$/, ""));
    if (!limpio || limpio.startsWith("/") || limpio.includes("..")) continue;
    const partes = limpio.split("/").filter(Boolean);
    if (!partes.length || !/^[\w.@[\]*-]+$/.test(partes.join(""))) continue;
    const esRuta = partes.length > 1 ? EXTENSIONES.test(limpio) || RAICES.has(partes[0]) : EXTENSIONES.test(limpio) && /^[\w.-]+$/.test(limpio);
    if (!esRuta) continue;
    const ruta = partes.join("/");
    // Tope (31-oct-2026): el glob viene del texto del plan y se vuelve regex (rutasChocan). Con muchos "*" la regex
    // puede tardar minutos y colgar la vuelta; ahí vale su parte fija, que choca con todo lo de adentro (en fila, seguro).
    if (ruta.length > LARGO_MAXIMO) continue;
    const comodines = ruta.match(/\*+/g)?.length ?? 0;
    const segura = comodines > COMODINES_MAXIMOS ? baseFija(ruta) : ruta;
    if (segura) encontrados.add(segura);
  }
  return [...encontrados];
}

/** Una ruta más larga no es de verdad (y no se compara); un glob con más grupos de "*" se toma por su parte fija. */
const LARGO_MAXIMO = 200;
const COMODINES_MAXIMOS = 3;

const sinExtension = (texto) => texto.replace(/\.[^.]+$/, "");
const esArchivo = (parte) => EXTENSIONES.test(parte);
/** "(grupo)" y "[id]" de Next no son módulos. */
const segmentoUtil = (parte) => !/^\(.*\)$/.test(parte) && !/^\[.*\]$/.test(parte);

/**
 * Carpetas COMUNES (25-oct-2026): muchas tareas sin relación agregan su propio archivo ahí (una acción en
 * src/app/actions, una herramienta en src/lib/mcp, un cron en src/app/api/cron/follows). Ahí choca el mismo ARCHIVO,
 * no la carpeta entera: dos tareas que tocan archivos distintos de src/app/actions se construyen a la vez (git junta
 * archivos distintos sin conflicto, y al subir se verifica otra vez sobre lo nuevo de main).
 */
export const CARPETAS_COMUNES = ["app/actions", "lib/mcp", "app/api/mcp", "app/api/cron", "components", "hooks", "types"];

/** El módulo de una ruta: dos archivos del mismo módulo no se construyen a la vez. */
export function moduloDe(ruta) {
  const partes = String(ruta).replace(/\\/g, "/").split("/").filter(Boolean);
  if (partes[0] === "src") partes.shift();
  if (!partes.length) return null;
  if (partes[0] === "prisma") return "prisma";
  if (partes.length === 1) return /^package(-lock)?\.json$/.test(partes[0]) ? "package" : sinExtension(partes[0]);
  const ruta2 = partes.join("/");
  const comun = CARPETAS_COMUNES.find((carpeta) => ruta2.startsWith(`${carpeta}/`));
  // En una carpeta común, el módulo es el archivo (o la subcarpeta de primer nivel, si se nombra una carpeta).
  if (comun) return esArchivo(partes.at(-1)) ? sinExtension(ruta2) : ruta2;
  if (partes[0] === "app") {
    // app/api/trabajador/tablero/tomar/route.ts -> app/api/trabajador/tablero; app/cliente/chats/page.tsx -> app/cliente/chats.
    const carpetas = (esArchivo(partes.at(-1)) ? partes.slice(1, -1) : partes.slice(1)).filter(segmentoUtil);
    return ["app", ...carpetas.slice(0, 3)].join("/");
  }
  // features/coach/..., lib/mcp/..., lib/agent.ts -> lib/agent, scripts/x.mjs -> scripts/x.
  return `${partes[0]}/${esArchivo(partes[1]) ? sinExtension(partes[1]) : partes[1]}`;
}

/*
 * Ruta contra ruta (31-oct-2026): el módulo no alcanza cuando el plan nombra una CARPETA o un GLOB. "src/features/**"
 * da el módulo "features" y "src/features/coach/x.ts" da "features/coach": no chocaban, y las dos tocaban lo mismo.
 * Una carpeta (sin extensión) choca con todo lo que tiene adentro; un glob, con lo que calza.
 */
const esGlob = (ruta) => ruta.includes("*");
const esCarpeta = (ruta) => !esGlob(ruta) && !esArchivo(ruta.split("/").at(-1));
/** Lo fijo de un glob, antes del primer "*" ("src/lib/**" -> "src/lib", "**\/*.ts" -> ""); una ruta sin "*" es ella misma. */
export function baseFija(ruta) {
  const partes = String(ruta).split("/");
  const primera = partes.findIndex((parte) => parte.includes("*"));
  return primera < 0 ? String(ruta) : partes.slice(0, primera).join("/");
}
/** ¿`ruta` está en `carpeta` (o es ella)? La carpeta "" es todo el repo. */
const dentro = (ruta, carpeta) => carpeta === "" || ruta === carpeta || ruta.startsWith(`${carpeta}/`);

/** ¿Dos rutas del plan (archivo, carpeta o glob) pueden tocar el mismo archivo? Ante la duda (glob contra carpeta), sí. */
export function rutasChocan(a, b) {
  if (a === b) return true;
  // Un glob contra un archivo: el archivo calza o no.
  if (esGlob(a) && !esGlob(b) && !esCarpeta(b)) return globARegex(a).test(b);
  if (esGlob(b) && !esGlob(a) && !esCarpeta(a)) return globARegex(b).test(a);
  // Dos archivos distintos no chocan (eso lo ve el módulo). Si hay una carpeta o un glob: una base dentro de la otra.
  if (!esGlob(a) && !esCarpeta(a) && !esGlob(b) && !esCarpeta(b)) return false;
  const [x, y] = [baseFija(a), baseFija(b)];
  return dentro(x, y) || dentro(y, x);
}

/**
 * Lo que importa de una tarjeta para saber si choca: repo, etapa, zonas (las que ya tiene + las que
 * tocan los archivos del plan), módulos y rutas (null = el plan no dice archivos).
 */
export function huellaDeTarjeta(tarjeta, hacer, repoConfig) {
  const archivos = archivosDelPlan(tarjeta.plan);
  const zonas = new Set([
    ...(tarjeta.zonaProtegida ?? tarjeta.zonasAprobadas ?? []),
    ...Object.keys(zonasTocadas(archivos, repoConfig?.zonasProtegidas ?? {})),
  ]);
  // null = el plan no dice archivos (no se sabe qué toca: en fila). Si solo nombra archivos sin choque (.md), no choca con nadie.
  const sinChoque = repoConfig?.sinChoque ?? SIN_CHOQUE_POR_DEFECTO;
  const rutas = archivos.length ? archivos.filter((archivo) => !noChoca(archivo, sinChoque)) : null;
  // El módulo de un glob es el de su parte fija ("src/lib/**" -> "lib"), como antes de guardar los "*".
  const modulos = rutas ? new Set(rutas.map((ruta) => moduloDe(baseFija(ruta))).filter(Boolean)) : null;
  return { id: tarjeta.id, titulo: tarjeta.titulo, repo: tarjeta.repo, hacer, zonas, modulos, rutas };
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
  for (const ruta of a.rutas ?? []) {
    const otra = (b.rutas ?? []).find((una) => rutasChocan(ruta, una));
    if (otra) return ruta === otra ? `las dos tocan ${ruta}` : `"${ruta}" y "${otra}" se pisan (una está dentro de la otra)`;
  }
  return null;
}

/**
 * De las candidatas (lo que /candidatas dice que se podría tomar), las que chocan con alguna de las
 * que ya corren: { id: motivo }. `repos` = config.repos (para las zonas por ruta). `contraQuien` (opcional) se llena con { id: id de la
 * tarjeta contraria }.
 */
export function candidatasQueChocan(candidatas, corriendo, repos, contraQuien = null) {
  const chocan = {};
  for (const candidata of candidatas ?? []) {
    if (!candidata?.hacer) continue;
    const huella = huellaDeTarjeta(candidata, candidata.hacer, repos[candidata.repo]);
    for (const otra of corriendo) {
      const motivo = motivoDeChoque(huella, otra);
      if (motivo) {
        chocan[candidata.id] = `choca con "${otra.titulo}": ${motivo}`;
        // Con quién choca (27-oct-2026): la espera se suelta sola cuando esa tarjeta deja de correr.
        if (contraQuien) contraQuien[candidata.id] = otra.id;
        break;
      }
    }
  }
  return chocan;
}
