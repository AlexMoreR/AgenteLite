// AUTOACTUALIZACIÓN del Coordinador (25-oct-2026). Cuando se sube código nuevo a main, el Coordinador no
// puede seguir con el viejo hasta que alguien lo reinicie. Cada `cadaMinutos`:
//   1. hace `git fetch` en SU copia y mira si origin/main trae commits nuevos que toquen trabajador-tablero/;
//   2. si sí: deja de tomar tarjetas, espera a que terminen las que corren, guarda la versión anterior en
//      <carpetaTrabajo>/actualizacion.json, hace `git pull --ff-only`, prueba que el código nuevo arranca
//      (`trabajador.mjs --probar-arranque` en un proceso hijo) y sale con 0 para que se relance;
//   3. si el código nuevo no arranca: `git reset --hard <anterior>` (solo en esa copia) y aviso por WhatsApp.
// Si el código nuevo pasa la prueba pero se cae al arrancar, lo deshace lanzador.mjs (no depende de este archivo).
// Si la copia tiene cambios locales o no es fast-forward, no se actualiza: se anota y se avisa.
import fs from "node:fs";
import path from "node:path";

import { git } from "./git.mjs";
import { correr, ultimasLineas } from "./procesos.mjs";

export const CARPETA_DEL_COORDINADOR = "trabajador-tablero";

export const rutaDelEstado = (carpetaTrabajo) => path.join(carpetaTrabajo, "actualizacion.json");

export function leerEstado(carpetaTrabajo) {
  try {
    return JSON.parse(fs.readFileSync(rutaDelEstado(carpetaTrabajo), "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

export function guardarEstado(carpetaTrabajo, estado) {
  fs.mkdirSync(carpetaTrabajo, { recursive: true });
  const ruta = rutaDelEstado(carpetaTrabajo);
  fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify(estado, null, 2)}\n`);
  fs.renameSync(`${ruta}.tmp`, ruta);
  return estado;
}

const corto = (hash) => String(hash ?? "").slice(0, 8);

/** La carpeta raíz del repo donde vive este código (la copia desde la que corre el Coordinador). */
export async function raizDelRepo(desde) {
  const r = await git(desde, ["rev-parse", "--show-toplevel"]);
  return path.resolve(r.salida.trim());
}

/**
 * fetch + comparación. -> { hayNueva, toca, anterior, nueva, ramaActual }
 * hayNueva: origin/<rama> tiene commits que HEAD no tiene. toca: alguno cambió trabajador-tablero/.
 */
export async function buscarVersionNueva({ repo, remoto = "origin", rama = "main" }) {
  await git(repo, ["fetch", "--quiet", remoto, rama], { timeoutMs: 120_000 });
  const ramaActual = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).salida.trim();
  const anterior = (await git(repo, ["rev-parse", "HEAD"])).salida.trim();
  const nueva = (await git(repo, ["rev-parse", `${remoto}/${rama}`])).salida.trim();
  const base = { ramaActual, anterior, nueva, hayNueva: false, toca: false };
  if (anterior === nueva) return base;
  // Si origin/main ya está dentro de HEAD (la copia va adelante), no hay nada que traer.
  const adelante = await git(repo, ["merge-base", "--is-ancestor", nueva, "HEAD"], { permitirFallo: true });
  if (adelante.codigo === 0) return base;
  const cambios = await git(repo, ["diff", "--name-only", "HEAD", nueva, "--", `${CARPETA_DEL_COORDINADOR}/`]);
  return { ...base, hayNueva: true, toca: cambios.salida.trim().length > 0 };
}

/** Cambios locales en archivos versionados (lo sin versionar, como config.local.json, no cuenta). */
export async function copiaLimpia(repo) {
  const r = await git(repo, ["status", "--porcelain", "--untracked-files=no"]);
  return r.salida.trim() === "";
}

/** Prueba que el código de la copia arranca: `node trabajador.mjs --probar-arranque`. -> { ok, detalle } */
export async function probarArranque({ repo, nodo = process.execPath, argumentos = [], timeoutMs = 120_000 }) {
  const r = await correr([nodo, path.join(repo, CARPETA_DEL_COORDINADOR, "trabajador.mjs"), "--probar-arranque", ...argumentos], {
    cwd: repo,
    timeoutMs,
    env: { ...process.env, TRABAJADOR_PROBANDO: "1" },
  });
  return { ok: r.codigo === 0 && !r.vencido, detalle: ultimasLineas(`${r.errores}\n${r.salida}`, 12) };
}

/**
 * Con 0 tarjetas corriendo: guarda el estado, `pull --ff-only`, prueba el arranque.
 * -> { resultado: "reiniciar" | "revertida" | "no-actualiza", estado }
 *   reiniciar: el código nuevo arranca; el que llama debe salir con 0.
 *   revertida: no arrancó; la copia volvió a la versión anterior y se avisó; el proceso sigue con su código.
 *   no-actualiza: copia sucia, sin fast-forward o rama equivocada; se avisó; todo sigue igual.
 */
export async function aplicarVersion({ repo, carpetaTrabajo, config, nueva, registro, avisar, probar = probarArranque, argumentosDePrueba = [] }) {
  const { remoto, rama } = config.autoactualizar;
  const anterior = (await git(repo, ["rev-parse", "HEAD"])).salida.trim();
  const decir = async (texto) => {
    try {
      await avisar(texto);
    } catch (error) {
      registro.aviso(`no se pudo avisar por WhatsApp (${error.message}): ${texto}`);
    }
  };
  const rechazar = async (motivo) => {
    registro.error(`autoactualizar: ${motivo}`);
    const estado = guardarEstado(carpetaTrabajo, {
      anterior,
      nueva,
      cuando: new Date().toISOString(),
      estado: "no-actualizada",
      rechazada: nueva,
      motivo,
    });
    await decir(`Coordinador: no pude actualizarme a ${corto(nueva)} (${motivo}). Sigo con ${corto(anterior)}.`);
    return { resultado: "no-actualiza", estado };
  };

  const ramaActual = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).salida.trim();
  if (ramaActual !== rama) return rechazar(`la copia está en la rama ${ramaActual}, no en ${rama}`);
  if (!(await copiaLimpia(repo))) return rechazar("la copia tiene cambios locales");

  guardarEstado(carpetaTrabajo, { anterior, nueva, cuando: new Date().toISOString(), estado: "probando" });
  const pull = await git(repo, ["pull", "--ff-only", "--quiet", remoto, rama], { permitirFallo: true, timeoutMs: 180_000 });
  if (pull.codigo !== 0) return rechazar(`git pull --ff-only falló: ${ultimasLineas(`${pull.errores}\n${pull.salida}`, 3).replace(/\s+/g, " ")}`);
  const ahora = (await git(repo, ["rev-parse", "HEAD"])).salida.trim();

  const prueba = await probar({ repo, argumentos: argumentosDePrueba });
  if (!prueba.ok) {
    await git(repo, ["reset", "--hard", anterior]);
    registro.error(`autoactualizar: la versión ${corto(ahora)} no arranca; vuelvo a ${corto(anterior)}`, prueba.detalle);
    const estado = guardarEstado(carpetaTrabajo, {
      anterior,
      nueva: ahora,
      cuando: new Date().toISOString(),
      estado: "revertida",
      rechazada: ahora,
      motivo: "no pasó --probar-arranque",
      detalle: prueba.detalle,
    });
    await decir(`Coordinador: la versión ${corto(ahora)} no arrancó y volví a la ${corto(anterior)}. Revisa el código de trabajador-tablero.`);
    return { resultado: "revertida", estado };
  }
  // salioParaReiniciar: el lanzador sabe que esta salida (código 0) es para relanzar, no una caída.
  const estado = guardarEstado(carpetaTrabajo, { anterior, nueva: ahora, cuando: new Date().toISOString(), estado: "probando", salioParaReiniciar: true });
  registro.info(`autoactualizar: ${corto(ahora)} arranca bien; salgo para que me relancen (anterior ${corto(anterior)})`);
  return { resultado: "reiniciar", estado };
}

/**
 * Hay versión nueva: no se toman más tarjetas (quien llama ya no llama a llenar), se espera a que terminen las que
 * corren y recién con 0 corriendo se aplica. -> lo mismo que aplicarVersion.
 */
export async function actualizarCuandoSeaPosible({ planificador, nueva, registro, ...resto }) {
  registro.info(`versión nueva ${corto(nueva)}: espero a que terminen ${planificador.corriendo()} tarjetas`);
  await planificador.esperarTodas();
  return aplicarVersion({ planificador, nueva, registro, ...resto });
}

/**
 * El proceso nuevo completó su primera vuelta bien: "probando" -> "ok". No hace nada si no hay una prueba en curso
 * (o si el estado es de otra versión).
 */
export function marcarActualizacionOk({ carpetaTrabajo, versionActual, registro }) {
  const estado = leerEstado(carpetaTrabajo);
  if (!estado || estado.estado !== "probando" || estado.nueva !== versionActual) return false;
  guardarEstado(carpetaTrabajo, { ...estado, estado: "ok", salioParaReiniciar: false, listoEn: new Date().toISOString() });
  registro.info(`actualizado a ${corto(versionActual)}`);
  return true;
}

/**
 * El vigilante del bucle. `revisar()` se llama en cada vuelta y solo hace algo cada `cadaMinutos`:
 * -> null (nada) | { nueva, anterior } (hay versión nueva que toca el Coordinador: parar y actualizar).
 * Si la nueva no toca trabajador-tablero/, hace `pull --ff-only` (si la copia está limpia) sin reiniciar.
 */
export function crearVigilanteDeVersion({ repo, config, carpetaTrabajo, registro, ahora = () => Date.now() }) {
  const { activo, cadaMinutos, remoto, rama } = config.autoactualizar;
  let ultima = ahora();
  let ocupado = false;
  return {
    async revisar({ forzar = false } = {}) {
      if (!activo || ocupado) return null;
      if (!forzar && ahora() - ultima < cadaMinutos * 60_000) return null;
      ultima = ahora();
      ocupado = true;
      try {
        const v = await buscarVersionNueva({ repo, remoto, rama });
        if (!v.hayNueva) return null;
        if (v.ramaActual !== rama) return null;
        if (leerEstado(carpetaTrabajo)?.rechazada === v.nueva) return null;
        if (!v.toca) {
          if (await copiaLimpia(repo)) {
            const r = await git(repo, ["pull", "--ff-only", "--quiet", remoto, rama], { permitirFallo: true, timeoutMs: 180_000 });
            if (r.codigo === 0) registro.info(`autoactualizar: copia al día con ${corto(v.nueva)} (no toca trabajador-tablero: sigo sin reiniciar)`);
            else registro.aviso(`autoactualizar: no se pudo traer ${corto(v.nueva)} (git pull --ff-only falló); sigo sin reiniciar`);
          }
          return null;
        }
        return { nueva: v.nueva, anterior: v.anterior };
      } catch (error) {
        registro.aviso(`autoactualizar: no se pudo mirar si hay versión nueva (${String(error.message).split("\n")[0]})`);
        return null;
      } finally {
        ocupado = false;
      }
    },
  };
}
