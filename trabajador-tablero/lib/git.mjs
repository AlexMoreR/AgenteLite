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

/**
 * Rebase de la rama de la tarjeta sobre `base` (25-oct-2026). Los documentos .md se juntan con merge=union (las
 * líneas de los dos lados quedan): casi todas las tareas agregan una línea al manual (docs/que-es-esta-aplicacion.md)
 * y eso solo no puede tumbar una subida. Va con un archivo de atributos propio (core.attributesFile, solo para este
 * comando): no cambia el repo ni la configuración de git del PC. Si choca, deja el worktree como estaba (rebase --abort).
 * -> { ok, conflicto: [archivos], detalle }
 */
export async function rebaseSobre(cwd, base, { identidad, carpetaTrabajo, sinChoque = ["**/*.md"], nombre = "repo" } = {}) {
  // Los globs de repos.<x>.sinChoque (choques.mjs: noChoca) son los que se juntan solos. Un archivo por repo.
  const atributos = path.join(carpetaTrabajo ?? path.dirname(cwd), "cache", `atributos-de-subida-${String(nombre).replace(/[^\w-]/g, "")}`);
  const globs = (sinChoque ?? []).filter((glob) => typeof glob === "string" && /^[^\s#]+$/.test(glob));
  try {
    fs.mkdirSync(path.dirname(atributos), { recursive: true });
    fs.writeFileSync(atributos, globs.map((glob) => `${glob} merge=union\n`).join(""));
  } catch {
    // Sin el archivo el rebase es el de siempre.
  }
  const extra = globs.length && fs.existsSync(atributos) ? ["-c", `core.attributesFile=${atributos.replace(/\\/g, "/")}`] : [];
  const rebase = await git(cwd, [...extra, "rebase", base], { identidad, permitirFallo: true });
  if (rebase.codigo === 0) return { ok: true, conflicto: [], detalle: "" };
  const conflicto = lineas((await git(cwd, ["diff", "--name-only", "--diff-filter=U"], { permitirFallo: true })).salida);
  await git(cwd, ["rebase", "--abort"], { permitirFallo: true });
  return { ok: false, conflicto, detalle: ultimasLineas(`${rebase.errores}\n${rebase.salida}`, 15) };
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
