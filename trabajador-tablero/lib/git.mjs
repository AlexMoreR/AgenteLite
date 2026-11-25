// Git para el trabajador: worktrees temporales (nunca toca la copia de trabajo del repo), ramas
// tablero/<id>-<slug> y el link de GitHub. Los ÚNICOS push a la rama base (main) están en `pushARamaBase`
// y `revertirEnRamaBase`, y solo los llama la etapa de subir (sube sola si todo pasó, o con el sí final
// del dueño si toca una zona protegida). Nunca con --force.
import fs from "node:fs";
import path from "node:path";

import { correr, ultimasLineas } from "./procesos.mjs";

export class ErrorDeGit extends Error {}

/*
  Con varias tarjetas a la vez (22-oct-2026), dos sesiones podrían correr git al mismo tiempo sobre el
  mismo repo (fetch, worktree add/remove, push) y chocar con los candados de git ("cannot lock ref",
  index.lock). Los comandos git del Coordinador van de a uno: son cortos, lo largo (Claude, el build,
  las pruebas) sí corre en paralelo.
*/
let fila = Promise.resolve();
function deAUno(tarea) {
  const turno = fila.then(tarea, tarea);
  fila = turno.catch(() => undefined);
  return turno;
}

/** git con identidad del Coordinador; lanza si falla (con las últimas líneas de la salida). */
export async function git(cwd, argumentos, { identidad, timeoutMs = 10 * 60_000, permitirFallo = false, entrada } = {}) {
  const id = identidad ? ["-c", `user.name=${identidad.nombre}`, "-c", `user.email=${identidad.correo}`] : [];
  const resultado = await deAUno(() => correr(["git", ...id, ...argumentos], { cwd, timeoutMs, entrada }));
  if (resultado.codigo !== 0 && !permitirFallo) {
    throw new ErrorDeGit(
      `git ${argumentos.join(" ")} falló${resultado.vencido ? " (se pasó del tiempo)" : ""}: ${ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 15)}`,
    );
  }
  return resultado;
}

/** "Agregar el envío gratis 50/50" -> "agregar-el-envio-gratis-50-50" (máx. 40). */
export function slug(texto) {
  return (
    String(texto ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "tarea"
  );
}

export const idCorto = (id) => String(id).replace(/[^A-Za-z0-9]/g, "").slice(-8);

export function nombreDeRama(tarjeta) {
  return `tablero/${idCorto(tarjeta.id)}-${slug(tarjeta.titulo)}`;
}

/** Una rama del Coordinador SIEMPRE empieza con "tablero/" (así nunca se empuja otra cosa con --force). */
export function esRamaDelTrabajador(rama) {
  return typeof rama === "string" && /^tablero\/[A-Za-z0-9._/-]+$/.test(rama) && !rama.includes("..");
}

/** https://github.com/<dueño>/<repo> a partir del remoto (https o ssh), o null si no es de GitHub. */
export function webDeGithub(urlRemoto) {
  const texto = String(urlRemoto ?? "").trim();
  const coincide =
    texto.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ?? texto.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  return coincide ? `https://github.com/${coincide[1]}/${coincide[2]}` : null;
}

export async function urlDelRemoto(repo) {
  const resultado = await git(repo.ruta, ["remote", "get-url", repo.remoto], { permitirFallo: true });
  return resultado.codigo === 0 ? resultado.salida.trim() : "";
}

/** Crea un worktree en `carpeta` desde `desde`, con rama nueva (o desacoplado si rama = null). */
export async function crearWorktree(repo, carpeta, desde, rama) {
  await quitarWorktree(repo, carpeta);
  fs.mkdirSync(path.dirname(carpeta), { recursive: true });
  const argumentos = rama ? ["worktree", "add", "-B", rama, carpeta, desde] : ["worktree", "add", "--detach", carpeta, desde];
  await git(repo.ruta, argumentos);
}

/** Saca el worktree (si existe) y borra la rama local (la del remoto queda). Nunca lanza. */
export async function quitarWorktree(repo, carpeta, ramaLocal) {
  if (fs.existsSync(carpeta)) {
    await git(repo.ruta, ["worktree", "remove", "--force", carpeta], { permitirFallo: true });
    try {
      fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows a veces tiene un archivo abierto; el prune de abajo lo limpia la próxima vez.
    }
  }
  await git(repo.ruta, ["worktree", "prune"], { permitirFallo: true });
  if (ramaLocal) await git(repo.ruta, ["branch", "-D", ramaLocal], { permitirFallo: true });
}

/** El diff (sin contexto) de `base` a HEAD, de todos los archivos o solo de `archivos`. */
export async function diffDeArchivos(cwd, base, archivos = null) {
  const resto = archivos?.length ? ["--", ...archivos] : [];
  return (await git(cwd, ["diff", "--unified=0", "--no-renames", `${base}...HEAD`, ...resto])).salida;
}

/** Los archivos que cambian de `base` a HEAD, con su letra (A agregado, M, D, R...). */
export async function archivosCambiados(cwd, base) {
  const resultado = await git(cwd, ["diff", "--name-status", "--no-renames", `${base}...HEAD`]);
  return resultado.salida
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const [letra, ...resto] = linea.split(/\t/);
      return { letra: letra.trim(), archivo: resto.join("\t").trim() };
    });
}

/**
 * Empuja SOLO una rama del Coordinador (tablero/...). Con --force: cada intento la rehace desde main.
 * `forzar: false` (las ramas que vienen de la nube, 25-oct-2026): sin --force, encima de lo que dejó la sesión.
 */
export async function pushDeRama(cwd, remoto, rama, { forzar = true } = {}) {
  if (!esRamaDelTrabajador(rama)) throw new ErrorDeGit(`"${rama}" no es una rama del Coordinador (tablero/...): no se empuja.`);
  await git(cwd, ["push", ...(forzar ? ["--force"] : []), remoto, `HEAD:refs/heads/${rama}`]);
}

/** ¿Existe `rama` en el remoto? (git ls-remote; si no se puede consultar, se supone que no.) */
export async function ramaExisteEnElRemoto(cwd, remoto, rama) {
  const resultado = await git(cwd, ["ls-remote", "--heads", remoto, `refs/heads/${rama}`], { permitirFallo: true });
  return resultado.codigo === 0 && resultado.salida.trim().length > 0;
}

/** El `-c core.attributesFile=...` del rebase: los globs de repos.<x>.sinChoque se juntan solos (merge=union). Un archivo por repo. */
function atributosDeSubida({ carpetaTrabajo, sinChoque = ["**/*.md"], nombre = "repo" } = {}, cwd) {
  const atributos = path.join(carpetaTrabajo ?? path.dirname(cwd), "cache", `atributos-de-subida-${String(nombre).replace(/[^\w-]/g, "")}`);
  const globs = (sinChoque ?? []).filter((glob) => typeof glob === "string" && /^[^\s#]+$/.test(glob));
  try {
    fs.mkdirSync(path.dirname(atributos), { recursive: true });
    fs.writeFileSync(atributos, globs.map((glob) => `${glob} merge=union\n`).join(""));
  } catch {
    // Sin el archivo el rebase es el de siempre.
  }
  return globs.length && fs.existsSync(atributos) ? ["-c", `core.attributesFile=${atributos.replace(/\\/g, "/")}`] : [];
}

/** Los archivos en conflicto (sin juntar) del rebase en curso. */
async function archivosEnConflicto(cwd) {
  return lineas((await git(cwd, ["diff", "--name-only", "--diff-filter=U"], { permitirFallo: true })).salida);
}

/**
 * Rebase de la rama de la tarjeta sobre `base` (25-oct-2026). Los documentos .md se juntan con merge=union (las
 * líneas de los dos lados quedan): casi todas las tareas agregan una línea al manual (docs/que-es-esta-aplicacion.md)
 * y eso solo no puede tumbar una subida. Va con un archivo de atributos propio (core.attributesFile, solo para este
 * comando): no cambia el repo ni la configuración de git del PC. Si choca, deja el worktree como estaba (rebase --abort).
 * `dejarAbierto` (31-oct-2026, resolver-choque.mjs): si choca NO cancela; el rebase queda a medias con los archivos en
 * conflicto para resolverlos y seguir (seguirRebase) o cancelar (cancelarRebase).
 * -> { ok, conflicto: [archivos], detalle, abierto }
 */
export async function rebaseSobre(cwd, base, { identidad, carpetaTrabajo, sinChoque = ["**/*.md"], nombre = "repo", dejarAbierto = false } = {}) {
  const extra = atributosDeSubida({ carpetaTrabajo, sinChoque, nombre }, cwd);
  const rebase = await git(cwd, [...extra, "rebase", base], { identidad, permitirFallo: true });
  if (rebase.codigo === 0) return { ok: true, conflicto: [], detalle: "", abierto: false };
  const conflicto = await archivosEnConflicto(cwd);
  const detalle = ultimasLineas(`${rebase.errores}\n${rebase.salida}`, 15);
  if (dejarAbierto && conflicto.length) return { ok: false, conflicto, detalle, abierto: true };
  await cancelarRebase(cwd);
  return { ok: false, conflicto, detalle, abierto: false };
}

/**
 * Sigue el rebase a medias después de resolver `archivos`: git add de esos archivos y rebase --continue (sin abrir editor).
 * Si el commit quedó vacío (lo de main ya lo traía) lo salta. Si el commit siguiente también choca, queda abierto otra vez.
 * -> { ok, conflicto: [archivos], detalle, abierto } (como rebaseSobre con dejarAbierto). Nunca empuja nada.
 */
export async function seguirRebase(cwd, archivos, { identidad, carpetaTrabajo, sinChoque = ["**/*.md"], nombre = "repo" } = {}) {
  if (archivos?.length) await git(cwd, ["add", "--", ...archivos]);
  const extra = atributosDeSubida({ carpetaTrabajo, sinChoque, nombre }, cwd);
  let paso = await git(cwd, [...extra, "-c", "core.editor=true", "rebase", "--continue"], { identidad, permitirFallo: true });
  // Sin nada que agregar (la resolución dejó el commit igual que main): se salta ese commit.
  if (paso.codigo !== 0 && !(await archivosEnConflicto(cwd)).length) {
    const sinCambios = (await git(cwd, ["diff", "--cached", "--quiet"], { permitirFallo: true })).codigo === 0;
    if (sinCambios && (await enRebase(cwd))) paso = await git(cwd, [...extra, "-c", "core.editor=true", "rebase", "--skip"], { identidad, permitirFallo: true });
  }
  if (paso.codigo === 0 && !(await enRebase(cwd))) return { ok: true, conflicto: [], detalle: "", abierto: false };
  const conflicto = await archivosEnConflicto(cwd);
  return { ok: false, conflicto, detalle: ultimasLineas(`${paso.errores}\n${paso.salida}`, 15), abierto: await enRebase(cwd) };
}

/** Cancela el rebase a medias (si hay uno): el worktree vuelve a como estaba antes del rebase. Nunca lanza. */
export async function cancelarRebase(cwd) {
  await git(cwd, ["rebase", "--abort"], { permitirFallo: true });
}

/** ¿Hay un rebase a medias en `cwd`? (las carpetas rebase-merge / rebase-apply de git). */
export async function enRebase(cwd) {
  const resultado = await git(cwd, ["rev-parse", "--git-path", "rebase-merge", "--git-path", "rebase-apply"], { permitirFallo: true });
  if (resultado.codigo !== 0) return false;
  return lineas(resultado.salida).some((ruta) => fs.existsSync(path.resolve(cwd, ruta)));
}

/** Los archivos de `archivos` (rutas relativas a `cwd`) que todavía tienen marcas de conflicto ('<<<<<<<' o '>>>>>>>' al empezar la línea). */
export function archivosConMarcas(cwd, archivos) {
  return (archivos ?? []).filter((archivo) => {
    try {
      return /^(?:<{7}|>{7})(?: |$)/m.test(fs.readFileSync(path.join(cwd, archivo), "utf8"));
    } catch {
      // Borrado o ilegible: no tiene marcas.
      return false;
    }
  });
}

/** El push a la rama base (main): SOLO desde la etapa de subir (sube sola o con el sí final). Sin --force. */
export async function pushARamaBase(cwd, remoto, ramaBase) {
  await git(cwd, ["push", remoto, `HEAD:refs/heads/${ramaBase}`]);
}

const lineas = (texto) =>
  texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);

/**
 * Deshace en la rama base lo que subió la etapa de subir (los commits `antes..commit`) cuando el
 * despliegue falló: `git revert` encima de lo último de la rama base y push SIN --force (si alguien
 * subió algo mientras tanto, el revert va encima y no se pisa nada). Las carpetas de migración que
 * agregó el commit se conservan: la migración ya pudo correr en la base (es aditiva) y Prisma tiene
 * que seguir encontrándola. Reintenta el push hasta 3 veces si la rama base se movió. Devuelve el
 * commit del revert; lanza ErrorDeGit si no pudo.
 */
export async function revertirEnRamaBase(cwd, { remoto, ramaBase, antes, commit, carpetaMigraciones, identidad, razon = "el despliegue falló" }) {
  let ultimo = "";
  for (let intento = 1; intento <= 3; intento += 1) {
    await git(cwd, ["fetch", remoto]);
    await git(cwd, ["reset", "--hard", `${remoto}/${ramaBase}`]);
    const revert = await git(cwd, ["revert", "--no-commit", `${antes}..${commit}`], { identidad, permitirFallo: true });
    if (revert.codigo !== 0) {
      await git(cwd, ["revert", "--abort"], { permitirFallo: true });
      throw new ErrorDeGit(`git revert ${antes.slice(0, 10)}..${commit.slice(0, 10)} chocó: ${ultimasLineas(`${revert.errores}\n${revert.salida}`, 15)}`);
    }
    if (carpetaMigraciones) {
      const agregadas = lineas((await git(cwd, ["diff", "--name-only", "--diff-filter=A", antes, commit, "--", carpetaMigraciones])).salida);
      if (agregadas.length) await git(cwd, ["checkout", commit, "--", ...agregadas]);
    }
    const mensaje = [`revert: deshacer ${commit.slice(0, 10)} (${razon})`, "Lo deshizo solo el Coordinador del Tablero IA. Las migraciones nuevas se conservan."];
    await git(cwd, ["commit", "--allow-empty", "-m", mensaje[0], "-m", mensaje[1]], { identidad });
    const push = await git(cwd, ["push", remoto, `HEAD:refs/heads/${ramaBase}`], { permitirFallo: true });
    if (push.codigo === 0) return (await git(cwd, ["rev-parse", "HEAD"])).salida.trim();
    ultimo = ultimasLineas(`${push.errores}\n${push.salida}`, 10);
  }
  throw new ErrorDeGit(`No se pudo empujar el revert a ${ramaBase} (3 intentos): ${ultimo}`);
}

/*
  ¿YA ESTÁ EN MAIN? (25-nov-2026, parte 3 de «las 4 fallas repetidas»). Cuando Claude terminó sin cambiar ningún archivo
  (`no_cambio_nada`), antes de reparar se busca en `git log <remoto>/<ramaBase>` si lo pedido ya quedó subido (así pasó T-625,
  que ya estaba en b52c1b45). Se da por encontrado SOLO si:
    - un commit trae el id corto de la tarjeta («tablero: … (<idCorto>)», el que deja la etapa de construir), o
    - la mayoría de las palabras del título están en el asunto del commit Y el commit toca al menos un archivo que nombra el plan.
  Los commits vacíos de las sesiones (inicio:, revision:, resultado:, pregunta:) y los revert no cuentan, y un commit que ya se
  deshizo (hay un «revert: deshacer <commit>» en main) tampoco.
*/

/** Hasta cuántos commits de main se miran (los más nuevos). */
export const COMMITS_PARA_BUSCAR_EN_MAIN = 400;

const SEPARADOR_DE_COMMIT = "\u001e";
const SEPARADOR_DE_CAMPO = "\u001f";
const COMMIT_DE_SENAL = /^(inicio|revision|resultado|pregunta|revert):/i;
const PALABRAS_QUE_NO_CUENTAN = new Set(["parte", "para", "como", "cuando", "donde", "desde", "hasta", "solo", "tablero"]);

/** Las palabras de un título que cuentan para comparar: sin tildes, en minúscula, de 4 letras o más. */
export function palabrasDelTitulo(texto) {
  const palabras = String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((palabra) => palabra.length >= 4 && !PALABRAS_QUE_NO_CUENTAN.has(palabra));
  return [...new Set(palabras)];
}

/** ¿El archivo que tocó el commit es (o está dentro de) uno que nombra el plan? */
function tocaArchivoDelPlan(archivo, archivosDelPlan) {
  return archivosDelPlan.some((delPlan) => {
    const limpio = delPlan.replace(/\/\*\*?$/, "").replace(/\/+$/, "");
    return Boolean(limpio) && (archivo === limpio || archivo.startsWith(`${limpio}/`));
  });
}

/**
 * Busca en main un commit que ya haga lo de la tarjeta. `repo`: { ruta, remoto, ramaBase }. `archivosDelPlan`: las rutas que
 * nombra el plan (choques.mjs: archivosDelPlan, sin el manual ni las notas de cambios pendientes). Devuelve
 * { commit, asunto, por: "id" | "titulo", archivo? } o null. Nunca lanza: si git falla, devuelve null (y se repara como siempre).
 */
export async function buscarEnMain(repo, tarjeta, archivosDelPlan = []) {
  const remoto = repo?.remoto ?? "origin";
  const ramaBase = repo?.ramaBase ?? "main";
  if (!repo?.ruta || !tarjeta?.id) return null;
  await git(repo.ruta, ["fetch", remoto, ramaBase], { permitirFallo: true, timeoutMs: 2 * 60_000 });
  const log = await git(
    repo.ruta,
    ["log", `${remoto}/${ramaBase}`, "-n", String(COMMITS_PARA_BUSCAR_EN_MAIN), "--no-merges", `--format=${SEPARADOR_DE_COMMIT}%H${SEPARADOR_DE_CAMPO}%s`, "--name-only"],
    { permitirFallo: true, timeoutMs: 2 * 60_000 },
  );
  if (log.codigo !== 0) return null;
  const commits = String(log.salida)
    .split(SEPARADOR_DE_COMMIT)
    .map((bloque) => {
      const [cabeza, ...archivos] = bloque.split(/\r?\n/);
      const [commit, asunto = ""] = String(cabeza).split(SEPARADOR_DE_CAMPO);
      return { commit: String(commit).trim(), asunto: asunto.trim(), archivos: archivos.map((archivo) => archivo.trim()).filter(Boolean) };
    })
    .filter(({ commit }) => /^[0-9a-f]{40}$/.test(commit));
  // Lo que ya se deshizo en main no vale como hecho.
  const deshechos = commits.map(({ asunto }) => asunto.match(/^revert: deshacer ([0-9a-f]{7,40})\b/)?.[1]).filter(Boolean);
  const vale = ({ commit, asunto, archivos }) => archivos.length > 0 && !COMMIT_DE_SENAL.test(asunto) && !deshechos.some((corto) => commit.startsWith(corto));
  const candidatos = commits.filter(vale);

  // 1) El commit de la tarjeta: «tablero: … (<idCorto>)».
  const id = idCorto(tarjeta.id);
  const conId = candidatos.find(({ asunto }) => asunto.startsWith("tablero: ") && asunto.endsWith(`(${id})`));
  if (conId) return { commit: conId.commit, asunto: conId.asunto, por: "id" };

  // 2) La mayoría de las palabras del título y al menos un archivo del plan.
  const delTitulo = palabrasDelTitulo(tarjeta.titulo);
  const rutas = (archivosDelPlan ?? []).map((ruta) => String(ruta).replace(/\\/g, "/")).filter(Boolean);
  if (delTitulo.length < 2 || !rutas.length) return null;
  for (const candidato of candidatos) {
    const enElAsunto = new Set(palabrasDelTitulo(candidato.asunto));
    const coinciden = delTitulo.filter((palabra) => enElAsunto.has(palabra)).length;
    if (coinciden * 2 <= delTitulo.length) continue;
    const archivo = candidato.archivos.find((tocado) => tocaArchivoDelPlan(tocado, rutas));
    if (archivo) return { commit: candidato.commit, asunto: candidato.asunto, por: "titulo", archivo };
  }
  return null;
}
