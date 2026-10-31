// Choques entre tarjetas (22-oct-2026, tarjeta "Trabajador: varias tarjetas en paralelo"): el trabajador
// corre varias a la vez, pero NO junta dos que se pisarían. Esas esperan en fila (van en `excluir` a /tomar).
//
// Chocan dos tarjetas del MISMO repo si:
//   - las dos van a SUBIR (la cola de subida a main: de a una por repo, con rebase y compilación de nuevo);
//   - las dos van a construir o subir (planear solo lee: nunca choca) y tocan la misma zona protegida
//     (chats, bot de ventas, libro V3, Meta Ads) o el mismo módulo (src/features/<x>, src/app/<...>,
//     src/lib/<x>, prisma, package.json...), según los archivos que dice el plan;
//   - una toca una carpeta o un glob ("src/features/coach/", "src/lib/**") y la otra un archivo de adentro (rutasChocan);
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

function archivosDeTexto(texto) {
  const encontrados = new Set();
  // 31-oct-2026: el "*" ya no corta la palabra: los globs de la parte 5 ("src/lib/**", "src/features/*/page.tsx") se
  // conservan. Solo se quitan los "*" del markdown que envuelven la ruta ("**src/a.ts**", "*src/a.ts*").
  for (const crudo of texto.split(/[\s`'"“”‘’(),;<>|]+/)) {
    if (!crudo || /^[a-z]+:\/\//i.test(crudo) || crudo.includes("://")) continue;
    // Sin puntuación al final ("src/a.ts." o "src/a/:") ni ":12" de línea.
    const limpio = sinMarkdown(crudo.replace(/\\/g, "/"))
      .replace(/^\.\//, "")
      .replace(/:\d+(:\d+)?$/, "")
      .replace(/[.:!?]+$/, "");
    if (!limpio || limpio.startsWith("/") || limpio.includes("..")) continue;
    const partes = limpio.split("/").filter(Boolean);
    if (!partes.length || !/^[\w.@[\]*-]+$/.test(partes.join("")) || partes.every((parte) => /^\*+$/.test(parte))) continue;
    const esRuta = partes.length > 1 ? EXTENSIONES.test(limpio) || RAICES.has(partes[0]) : EXTENSIONES.test(limpio) && /^[\w.*-]+$/.test(limpio);
    if (esRuta) encontrados.add(partes.join("/"));
  }
  return [...encontrados];
}

/** Quita los "*" de negrita o cursiva que envuelven una palabra, sin tocar los del glob ("**\/x", "src/**", "src/*"). */
function sinMarkdown(palabra) {
  let limpia = palabra.replace(/^\*+(?=[\w@[])/, "");
  // Al final: "src/a.ts**" o "src/a.ts**." son negrita; "src/lib/**" (después de "/") es glob.
  limpia = limpia.replace(/([^/*])\*+([.:!?]*)$/, "$1$2");
  return limpia;
}

/** ¿Este pedazo de ruta es un comodín ("*", "**", "*.ts")? */
const esGlob = (parte) => parte.includes("*");

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
  const todas = String(ruta).replace(/\\/g, "/").split("/").filter(Boolean);
  // Un glob cuenta por su carpeta fija: "src/lib/**" -> "lib"; "src/features/coach/*.ts" -> "features/coach".
  const comodin = todas.findIndex(esGlob);
  const partes = comodin >= 0 ? todas.slice(0, comodin) : todas;
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
  // null = el plan no dice archivos (no se sabe qué toca: en fila). Si solo nombra archivos sin choque (.md), no choca con nadie.
  const sinChoque = repoConfig?.sinChoque ?? SIN_CHOQUE_POR_DEFECTO;
  const deCodigo = archivos.filter((archivo) => !noChoca(archivo, sinChoque));
  const modulos = archivos.length ? new Set(deCodigo.map(moduloDe).filter(Boolean)) : null;
  // Las rutas tal cual (carpetas y globs incluidos) para la comparación ruta-contra-ruta (rutasQueChocan).
  const rutas = archivos.length ? deCodigo : null;
  return { id: tarjeta.id, titulo: tarjeta.titulo, repo: tarjeta.repo, hacer, zonas, modulos, rutas };
}

/** La ruta sin "src/" adelante, sin "./" ni "/" al final: así "src/lib/a.ts" y "lib/a.ts" son lo mismo. */
const rutaComparable = (ruta) => String(ruta).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").replace(/^src\//, "");

/** La parte fija de un glob, hasta el primer comodín: "lib/**" -> "lib"; "**\/*.ts" -> "" (cualquier carpeta). */
const carpetaFija = (glob) => {
  const partes = glob.split("/");
  return partes.slice(0, partes.findIndex(esGlob)).join("/");
};

/** ¿`ruta` está dentro de `carpeta` (o es ella)? "" es la raíz: todo está dentro. */
const dentroDe = (ruta, carpeta) => !carpeta || ruta === carpeta || ruta.startsWith(`${carpeta}/`);

/**
 * ¿Estas dos rutas del plan se pisan? (31-oct-2026) Además del módulo (moduloDe), una CARPETA declarada
 * ("src/features/coach/", sin extensión) choca con cualquier archivo que esté dentro de ella, y un GLOB
 * ("src/lib/**", "src/features/*\/page.tsx") con cualquier archivo que calce. Dos globs (o un glob y una carpeta)
 * chocan si una carpeta fija está dentro de la otra: no se sabe qué archivos calzan, mejor en fila.
 */
export function rutasChocan(a, b) {
  const x = rutaComparable(a);
  const y = rutaComparable(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const globX = x.split("/").some(esGlob);
  const globY = y.split("/").some(esGlob);
  if (globX && globY) return dentroDe(carpetaFija(x), carpetaFija(y)) || dentroDe(carpetaFija(y), carpetaFija(x));
  if (globX || globY) {
    const [glob, otra] = globX ? [x, y] : [y, x];
    if (globARegex(glob).test(otra)) return true;
    // Contra una carpeta: chocan si una contiene a la otra.
    return !esArchivo(otra.split("/").at(-1)) && (dentroDe(carpetaFija(glob), otra) || dentroDe(otra, carpetaFija(glob)));
  }
  const carpetaX = !esArchivo(x.split("/").at(-1));
  const carpetaY = !esArchivo(y.split("/").at(-1));
  return (carpetaX && dentroDe(y, x)) || (carpetaY && dentroDe(x, y));
}

/** El primer par de rutas que se pisan entre dos tarjetas ("src/lib/** y src/lib/a.ts"), o null. */
export function rutasQueChocan(rutasA, rutasB) {
  for (const a of rutasA ?? []) {
    const b = (rutasB ?? []).find((otra) => rutasChocan(a, otra));
    if (b) return a === b ? a : `${a} y ${b}`;
  }
  return null;
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
  const rutas = rutasQueChocan(a.rutas, b.rutas);
  if (rutas) return `las dos tocan ${rutas}`;
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
