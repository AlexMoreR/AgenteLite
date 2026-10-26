// EL MANUAL AL DÍA, UNA VEZ CADA NOCHE (25-oct-2026, tarjeta "Coordinador: que el manual no bloquee tareas").
// Las tareas ya no editan docs/que-es-esta-aplicacion.md (por eso todas chocaban entre sí y corrían de a una): cada una
// deja una nota en docs/cambios-pendientes/<id>.md. Pasada la hora de la noche (por defecto 23:00 de Bogotá), UNA vez
// al día, el Coordinador:
//   1. trae lo último de main y abre una copia aparte (worktree desacoplado);
//   2. si no hay notas, marca el día como hecho y termina;
//   3. abre una sesión de Claude (modelo de construir) que pasa las notas al manual y borra las que pasó;
//   4. revisa el resultado ANTES de subir: solo cambiaron el manual y las notas, siguen todos los títulos `## ...` y
//      se borraron justo las notas que se pasaron;
//   5. hace un commit y lo sube a main con pushARamaBase (sin forzar);
//   6. avisa en el panel del Coordinador (crm.aviso).
// Solo arranca si ninguna tarea está subiendo a main; mientras trabaja, el bucle no toma tareas nuevas (lo llama el bucle
// principal y espera). Si algo falla no sube nada: reintenta en una vuelta siguiente, hasta 3 veces por noche. El día
// hecho queda en <carpetaTrabajo>/manual-nocturno.json (un reinicio no lo repite). No es una tarjeta del tablero.
import fs from "node:fs";
import path from "node:path";

import { correrMotor } from "./etapas.mjs";
import { crearWorktree, git, pushARamaBase, quitarWorktree } from "./git.mjs";
import { fechaBogota } from "./motores.mjs";

export const RUTA_DEL_MANUAL = "docs/que-es-esta-aplicacion.md";
export const CARPETA_DE_NOTAS = "docs/cambios-pendientes";
export const INTENTOS_POR_NOCHE = 3;
/** Entre un intento fallido y el siguiente pasa al menos esto (las vueltas del bucle son de un minuto). */
export const ESPERA_ENTRE_INTENTOS_MS = 10 * 60_000;
const MINUTO = 60_000;
const SESION_MINUTOS = 20;

export const rutaDelEstadoNocturno = (carpetaTrabajo) => path.join(carpetaTrabajo, "manual-nocturno.json");

function leerEstado(carpetaTrabajo) {
  try {
    return JSON.parse(fs.readFileSync(rutaDelEstadoNocturno(carpetaTrabajo), "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function guardarEstado(carpetaTrabajo, estado) {
  fs.mkdirSync(carpetaTrabajo, { recursive: true });
  const ruta = rutaDelEstadoNocturno(carpetaTrabajo);
  fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify(estado, null, 2)}\n`);
  fs.renameSync(`${ruta}.tmp`, ruta);
}

/** La hora (0-23) en Bogotá. */
export function horaEnBogota(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", hourCycle: "h23" }).formatToParts(fecha);
  return Number(partes.find((parte) => parte.type === "hour")?.value ?? 0) % 24;
}

/** Los títulos `## ...` de un texto en markdown. */
export const titulosDelManual = (texto) => String(texto).split(/\r?\n/).filter((linea) => /^##\s/.test(linea)).map((linea) => linea.trim());

/** Los archivos de notas (sin el README) de la carpeta de notas de `carpeta`. */
export function notasPendientes(carpeta) {
  const dir = path.join(carpeta, CARPETA_DE_NOTAS);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((nombre) => /\.md$/i.test(nombre) && nombre.toLowerCase() !== "readme.md")
    .sort();
}

/** Las líneas `SIN_PASAR: <archivo>.md` que dejó la sesión (notas que no entendió y no borró). */
export function notasSinPasar(texto) {
  return [...String(texto).matchAll(/^\s*SIN_PASAR:\s*(?:docs\/cambios-pendientes\/)?([^\s`'",;]+\.md)/gim)].map((m) => m[1]);
}

export function promptDelManual(notas) {
  return [
    "Eres el Coordinador del Tablero IA de Magilus. JUNTAR NOTAS DEL MANUAL: pasa las notas de cambios pendientes al manual del sistema.",
    `El manual es ${RUTA_DEL_MANUAL}. Las notas están en ${CARPETA_DE_NOTAS}/ (una por tarea). Notas de hoy:\n${notas.map((nota) => `- ${CARPETA_DE_NOTAS}/${nota}`).join("\n")}`,
    [
      "Reglas:",
      "- Lee cada nota y pásala al manual, en la sección que dice la nota (o la que corresponda), con el formato de las líneas de esa sección (`- \\`clave\\`: descripción`). Si la clave ya existe, actualiza su línea en vez de repetirla.",
      "- No cambies los títulos `## ...` del manual ni los borres. No toques ningún otro archivo, y no toques el README de la carpeta de notas.",
      `- Borra cada nota que pasaste (rm ${CARPETA_DE_NOTAS}/<archivo>.md). Si una nota no se entiende, déjala sin borrar y escribe al final una línea por nota: SIN_PASAR: <archivo>.md`,
      "- No hagas git commit ni push, no cambies de rama ni corras nada en segundo plano: el Coordinador revisa y sube.",
      "- Termina con un RESUMEN de una o dos líneas en español sencillo.",
    ].join("\n"),
  ].join("\n\n");
}

/**
 * Revisa el resultado de la sesión ANTES de subir. `cambios` = [{ letra, archivo }] de `git status`.
 * -> { ok, motivo, borradas }
 */
export function revisarResultado({ cambios, notas, sinPasar = [], titulosAntes, manualDespues }) {
  const permitido = (archivo) => archivo === RUTA_DEL_MANUAL || archivo.startsWith(`${CARPETA_DE_NOTAS}/`);
  const ajenos = cambios.filter((cambio) => !permitido(cambio.archivo));
  if (ajenos.length) return { ok: false, motivo: `la sesión cambió archivos que no son el manual ni las notas: ${ajenos.map((c) => c.archivo).join(", ")}` };
  const deLasNotas = cambios.filter((cambio) => cambio.archivo !== RUTA_DEL_MANUAL);
  const noBorradas = deLasNotas.filter((cambio) => !/D/.test(cambio.letra));
  if (noBorradas.length) return { ok: false, motivo: `la sesión modificó o agregó archivos en ${CARPETA_DE_NOTAS}: ${noBorradas.map((c) => c.archivo).join(", ")}` };
  const borradas = deLasNotas.map((cambio) => cambio.archivo.slice(CARPETA_DE_NOTAS.length + 1)).sort();
  const esperadas = notas.filter((nota) => !sinPasar.includes(nota)).sort();
  if (!borradas.length) return { ok: false, motivo: "la sesión no pasó ninguna nota (no borró ninguna)" };
  if (JSON.stringify(borradas) !== JSON.stringify(esperadas)) {
    return { ok: false, motivo: `las notas borradas (${borradas.join(", ")}) no son justo las que se pasaron (${esperadas.join(", ") || "ninguna"})` };
  }
  if (!cambios.some((cambio) => cambio.archivo === RUTA_DEL_MANUAL)) return { ok: false, motivo: "borró notas pero el manual no cambió" };
  const despues = new Set(titulosDelManual(manualDespues));
  const faltan = titulosAntes.filter((titulo) => !despues.has(titulo));
  if (faltan.length) return { ok: false, motivo: `al manual le faltan títulos que tenía: ${faltan.join(" | ")}` };
  return { ok: true, motivo: "", borradas };
}

function cambiosDeGit(texto) {
  return String(texto)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((linea) => ({ letra: linea.slice(0, 2).trim() || "?", archivo: linea.slice(3).trim().replace(/^"|"$/g, "") }));
}

/**
 * Una vuelta del trabajo de noche. -> { hizo: boolean, motivo, ... }. Nunca lanza por un fallo del trabajo (lo avisa).
 * `avisar(texto)` = crm.aviso; `ahora()` y `esperaEntreIntentosMs` existen para las pruebas.
 */
export async function manualNocturno({ config, registro, planificador, avisar, ahora = () => new Date(), esperaEntreIntentosMs = ESPERA_ENTRE_INTENTOS_MS }) {
  const manual = config.manual;
  if (!manual?.activo) return { hizo: false, motivo: "apagado" };
  const repo = config.repos[manual.repo];
  if (!repo) return { hizo: false, motivo: `el repo ${manual.repo} no está en la configuración` };
  const ahoraFecha = ahora();
  const hoy = fechaBogota(ahoraFecha);
  if (horaEnBogota(ahoraFecha) < manual.hora) return { hizo: false, motivo: "todavía no es la hora" };
  const estado = leerEstado(config.carpetaTrabajo);
  const deHoy = estado?.dia === hoy ? estado : { dia: hoy, hecho: false, intentos: 0, ultimoIntento: 0 };
  if (deHoy.hecho) return { hizo: false, motivo: "ya se hizo hoy" };
  if (deHoy.intentos >= INTENTOS_POR_NOCHE) return { hizo: false, motivo: "ya se intentó 3 veces hoy" };
  if (deHoy.intentos > 0 && ahoraFecha.getTime() - deHoy.ultimoIntento < esperaEntreIntentosMs) return { hizo: false, motivo: "espera para reintentar" };
  if ((planificador?.subiendo?.() ?? 0) > 0) return { hizo: false, motivo: "hay una tarea subiendo a main" };

  // Un aviso que no llega (el CRM caído) no tumba el trabajo.
  const decir = async (texto) => {
    try {
      await avisar?.(texto);
    } catch (error) {
      registro.aviso(`manual de la noche: no se pudo avisar al panel (${error.message})`);
    }
  };
  const contarIntento = () => guardarEstado(config.carpetaTrabajo, { ...deHoy, intentos: deHoy.intentos + 1, ultimoIntento: ahoraFecha.getTime() });
  const fallar = async (motivo) => {
    contarIntento();
    const quedan = INTENTOS_POR_NOCHE - (deHoy.intentos + 1);
    registro.error(`manual de la noche: ${motivo}`);
    await decir(`Manual de la noche: no se pudo juntar las notas (${motivo}). No se subió nada${quedan > 0 ? `; se reintenta (quedan ${quedan})` : "; no se reintenta más hoy"}.`);
    return { hizo: false, motivo, fallo: true };
  };

  const carpeta = path.join(config.carpetaTrabajo, "manual-nocturno");
  try {
    await git(repo.ruta, ["fetch", repo.remoto]);
    await crearWorktree(repo, carpeta, `${repo.remoto}/${repo.ramaBase}`, null);
    const notas = notasPendientes(carpeta);
    if (!notas.length) {
      guardarEstado(config.carpetaTrabajo, { ...deHoy, hecho: true, notas: 0 });
      registro.info("manual de la noche: no hay notas de cambios pendientes; listo por hoy");
      return { hizo: false, motivo: "sin notas", marcado: true };
    }
    const rutaManual = path.join(carpeta, RUTA_DEL_MANUAL);
    if (!fs.existsSync(rutaManual)) return await fallar(`no existe ${RUTA_DEL_MANUAL} en ${repo.ramaBase}`);
    const titulosAntes = titulosDelManual(fs.readFileSync(rutaManual, "utf8"));
    registro.info(`manual de la noche: junto ${notas.length} nota(s): ${notas.join(", ")}`);

    let respuesta;
    try {
      respuesta = await correrMotor({ config, registro }, "claude", "construir", promptDelManual(notas), {
        cwd: carpeta,
        timeoutMs: SESION_MINUTOS * MINUTO,
        que: "juntar las notas del manual",
      });
    } catch (error) {
      return await fallar(`la sesión de Claude falló: ${String(error.message).split("\n")[0]}`);
    }

    const cambios = cambiosDeGit((await git(carpeta, ["status", "--porcelain", "--untracked-files=all"])).salida);
    const sinPasar = notasSinPasar(respuesta);
    const revision = revisarResultado({
      cambios,
      notas,
      sinPasar,
      titulosAntes,
      manualDespues: fs.existsSync(rutaManual) ? fs.readFileSync(rutaManual, "utf8") : "",
    });
    if (!revision.ok) return await fallar(revision.motivo);

    await git(carpeta, ["add", "-A", "--", RUTA_DEL_MANUAL, CARPETA_DE_NOTAS]);
    await git(carpeta, ["commit", "-m", `manual: junta ${revision.borradas.length} notas de cambios pendientes`], { identidad: config.git });
    try {
      await pushARamaBase(carpeta, repo.remoto, repo.ramaBase);
    } catch (error) {
      return await fallar(`no se pudo subir a ${repo.ramaBase} (¿cambió mientras tanto?): ${String(error.message).split("\n")[0]}`);
    }
    guardarEstado(config.carpetaTrabajo, { ...deHoy, hecho: true, intentos: deHoy.intentos + 1, ultimoIntento: ahoraFecha.getTime(), notas: revision.borradas.length });
    registro.info(`manual de la noche: subido a ${repo.ramaBase} (${revision.borradas.length} notas)`);
    await decir(
      `Manual de la noche: pasé ${revision.borradas.length} nota(s) de cambios pendientes a docs/que-es-esta-aplicacion.md y lo subí a ${repo.ramaBase}.${sinPasar.length ? ` Quedaron sin pasar: ${sinPasar.join(", ")}.` : ""}`,
    );
    return { hizo: true, motivo: "ok", notas: revision.borradas.length, sinPasar };
  } catch (error) {
    return await fallar(String(error?.message ?? error).split("\n")[0]);
  } finally {
    await quitarWorktree(repo, carpeta);
  }
}
