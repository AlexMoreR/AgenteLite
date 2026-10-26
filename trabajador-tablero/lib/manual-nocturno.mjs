// El manual de la noche (26-oct-2026, tarjeta "Coordinador: que el manual no bloquee tareas").
//
// Las tareas ya no editan docs/que-es-esta-aplicacion.md (todas lo tocaban y eso las ponía en fila, de a una): cada una
// deja una nota en docs/cambios-pendientes/<id>.md. Una vez al día, pasada la hora de la noche, el Coordinador junta esas
// notas en el manual y sube el cambio a main. Es un trabajo interno del Coordinador, no una tarjeta del tablero.
//
// Solo hace algo si: ya pasó la hora (Bogotá), hoy todavía no se hizo, y ninguna tarea está subiendo a main. Mientras
// trabaja el bucle no toma tareas nuevas (lo llama el bucle principal y espera su resultado), así que no puede empezar
// ninguna subida a la vez. Antes de subir revisa el resultado; si algo no cuadra, no sube nada y avisa. Sube sin forzar:
// si main cambió, reintenta en una vuelta siguiente (hasta 3 veces por noche). Las notas no se pierden: siguen en main.
import fs from "node:fs";
import path from "node:path";

import { crearWorktree, git, pushARamaBase, quitarWorktree } from "./git.mjs";
import { modeloDelPaso } from "./modelos.mjs";
import { fechaBogota } from "./motores.mjs";
import { correr, ultimasLineas } from "./procesos.mjs";

export const MANUAL = "docs/que-es-esta-aplicacion.md";
export const CARPETA_DE_NOTAS = "docs/cambios-pendientes";
export const INTENTOS_POR_NOCHE = 3;
const CLAUDE_MINUTOS = 15;

export const rutaDelEstadoDelManual = (carpetaTrabajo) => path.join(carpetaTrabajo, "manual-nocturno.json");

export function leerEstadoDelManual(carpetaTrabajo) {
  try {
    return JSON.parse(fs.readFileSync(rutaDelEstadoDelManual(carpetaTrabajo), "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function guardarEstadoDelManual(carpetaTrabajo, estado) {
  fs.mkdirSync(carpetaTrabajo, { recursive: true });
  const ruta = rutaDelEstadoDelManual(carpetaTrabajo);
  fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify(estado, null, 2)}\n`);
  fs.renameSync(`${ruta}.tmp`, ruta);
  return estado;
}

/** La hora (0 a 23) en Bogotá. */
export const horaEnBogota = (fecha = new Date()) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", hourCycle: "h23" }).format(fecha));

/** Las notas de cambios pendientes de una carpeta (sin el README), ordenadas. */
export function notasPendientes(raiz) {
  try {
    return fs
      .readdirSync(path.join(raiz, CARPETA_DE_NOTAS))
      .filter((nombre) => /\.md$/i.test(nombre) && nombre.toLowerCase() !== "readme.md")
      .sort();
  } catch {
    return [];
  }
}

/** Los títulos "## ..." del manual: ninguno puede desaparecer. */
export const titulosDelManual = (texto) => String(texto ?? "").split(/\r?\n/).filter((linea) => /^##\s/.test(linea)).map((linea) => linea.trim());

export function promptDelManual(notas) {
  return [
    "MANUAL DE LA NOCHE. Eres el Coordinador del Tablero IA de Magilus y vas a poner al día el manual del sistema.",
    `Pasa las notas de ${CARPETA_DE_NOTAS}/ al manual ${MANUAL}, cada una en su sección (el formato está en ${CARPETA_DE_NOTAS}/README.md). Las notas son:`,
    ...notas.map((nota) => `- ${CARPETA_DE_NOTAS}/${nota}`),
    "Reglas:",
    `- Solo edita ${MANUAL}. No toques ningún otro archivo ni las notas: el Coordinador borra las notas que pasaste.`,
    "- No cambies ni borres los títulos `## ...` del manual. Agrega las líneas `- \\`clave\\`: descripción` dentro de la sección que corresponda; si ya hay una línea con la misma clave, actualízala.",
    "- Si una nota no se entiende y no la puedes pasar, no la pases y escribe como última línea: NO_PASE: <archivo.md>, <otro.md>",
    "- Termina con un RESUMEN de una frase en español sencillo.",
  ].join("\n");
}

/** Cómo corre Claude de verdad: `claude -p` con Sonnet, solo para leer y editar archivos del worktree. */
function claudeDeVerdad({ config, entorno }) {
  return async (prompt, { cwd, timeoutMs }) => {
    const argumentos = [
      "-p",
      "--model",
      modeloDelPaso(config, "construir"),
      "--permission-mode",
      "acceptEdits",
      "--output-format",
      "text",
      "--allowedTools",
      "Read",
      "Edit",
      "Write",
      "Glob",
      "Grep",
      "--disallowedTools",
      ...new Set([...config.herramientasProhibidas, "Agent", "Task"]),
    ];
    const resultado = await correr([...config.comandoClaude, ...argumentos], { cwd, entrada: prompt, timeoutMs, env: entorno });
    if (resultado.vencido) throw new Error(`Claude tardó más de ${Math.round(timeoutMs / 60_000)} min: se cortó.`);
    if (resultado.codigo !== 0) throw new Error(`Claude falló (código ${resultado.codigo}): ${ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 10)}`);
    return resultado.salida;
  };
}

/**
 * crearManualNocturno({ config, registro, avisar, entorno, correrClaude?, ahora? }) -> { revisar(planificador) }
 *   revisar() mira si toca hacer el manual y, si toca, lo hace. Devuelve { hizo, motivo }.
 *   `correrClaude(prompt, { cwd, timeoutMs })` -> texto: se puede cambiar (las pruebas).
 */
export function crearManualNocturno({ config, registro, avisar = async () => undefined, entorno = process.env, correrClaude, ahora = () => new Date() }) {
  const claude = correrClaude ?? claudeDeVerdad({ config, entorno });
  const aviso = async (texto) => {
    try {
      await avisar(texto);
    } catch (error) {
      registro.aviso(`manual de la noche: no se pudo avisar (${String(error.message).split("\n")[0]})`);
    }
  };

  async function hacerElManual(repo) {
    const carpeta = path.join(config.carpetaTrabajo, "wt", "manual-nocturno");
    const base = `${repo.remoto}/${repo.ramaBase}`;
    try {
      await git(repo.ruta, ["fetch", repo.remoto]);
      await crearWorktree(repo, carpeta, base, null);
      const notas = notasPendientes(carpeta);
      if (!notas.length) return { notas: 0, pasadas: 0, subio: false };

      const rutaManual = path.join(carpeta, MANUAL);
      if (!fs.existsSync(rutaManual)) throw new Error(`no existe ${MANUAL} en ${base}`);
      const titulosAntes = titulosDelManual(fs.readFileSync(rutaManual, "utf8"));

      const texto = await claude(promptDelManual(notas), { cwd: carpeta, timeoutMs: CLAUDE_MINUTOS * 60_000 });
      const sinPasar = new Set(
        [...String(texto ?? "").matchAll(/^NO_PASE:\s*(.+)$/gim)].flatMap((linea) => linea[1].split(",")).map((nombre) => path.basename(nombre.trim())),
      );
      const pasadas = notas.filter((nota) => !sinPasar.has(nota));
      if (!pasadas.length) return { notas: notas.length, pasadas: 0, subio: false, sinPasar: [...sinPasar] };

      // Las notas pasadas las borra el Coordinador (Claude no tiene permiso para borrar archivos); las demás quedan igual.
      for (const nota of pasadas) fs.rmSync(path.join(carpeta, CARPETA_DE_NOTAS, nota), { force: true });
      for (const nota of sinPasar) await git(carpeta, ["checkout", "--", `${CARPETA_DE_NOTAS}/${nota}`], { permitirFallo: true });
      await git(carpeta, ["add", "-A"]);

      // Revisión antes de subir: solo el manual y las notas, todos los títulos, y justo las notas pasadas borradas.
      const cambios = (await git(carpeta, ["diff", "--cached", "--name-status", "--no-renames"])).salida
        .split(/\r?\n/)
        .filter(Boolean)
        .map((linea) => ({ letra: linea[0], archivo: linea.slice(1).trim().replace(/\\/g, "/") }));
      const ajenos = cambios.filter((cambio) => cambio.archivo !== MANUAL && !(cambio.archivo.startsWith(`${CARPETA_DE_NOTAS}/`) && cambio.letra === "D"));
      if (ajenos.length) throw new Error(`la sesión cambió archivos que no son el manual ni las notas: ${ajenos.map((c) => c.archivo).join(", ")}`);
      const borradas = cambios.filter((cambio) => cambio.letra === "D").map((cambio) => path.posix.basename(cambio.archivo)).sort();
      if (JSON.stringify(borradas) !== JSON.stringify([...pasadas].sort())) throw new Error(`las notas borradas (${borradas.join(", ") || "ninguna"}) no son justo las que se pasaron (${pasadas.join(", ")})`);
      if (!cambios.some((cambio) => cambio.archivo === MANUAL)) throw new Error("la sesión no cambió el manual");
      const titulosDespues = new Set(titulosDelManual(fs.readFileSync(rutaManual, "utf8")));
      const perdidos = titulosAntes.filter((titulo) => !titulosDespues.has(titulo));
      if (perdidos.length) throw new Error(`faltan títulos del manual: ${perdidos.join(" | ")}`);

      await git(carpeta, ["commit", "-m", `manual: junta ${pasadas.length} notas de cambios pendientes`], { identidad: config.git });
      await pushARamaBase(carpeta, repo.remoto, repo.ramaBase);
      return { notas: notas.length, pasadas: pasadas.length, subio: true, sinPasar: [...sinPasar] };
    } finally {
      await quitarWorktree(repo, carpeta);
    }
  }

  return {
    async revisar(planificador) {
      const manual = config.manual;
      if (!manual?.activo) return { hizo: false, motivo: "apagado" };
      const repo = config.repos?.[manual.repo];
      if (!repo) return { hizo: false, motivo: "sin_repo" };
      const fecha = ahora();
      if (horaEnBogota(fecha) < manual.hora) return { hizo: false, motivo: "antes_de_la_hora" };
      const hoy = fechaBogota(fecha);
      const estado = leerEstadoDelManual(config.carpetaTrabajo);
      const deHoy = estado?.dia === hoy ? estado : { dia: hoy, hecho: false, intentos: 0 };
      if (deHoy.hecho || deHoy.intentos >= INTENTOS_POR_NOCHE) return { hizo: false, motivo: deHoy.hecho ? "ya_hecho" : "sin_intentos" };
      if (planificador?.subiendo?.()) return { hizo: false, motivo: "subiendo" };

      registro.info(`manual de la noche: junto las notas de ${CARPETA_DE_NOTAS}/ en ${MANUAL} (intento ${deHoy.intentos + 1} de ${INTENTOS_POR_NOCHE})`);
      try {
        const resultado = await hacerElManual(repo);
        guardarEstadoDelManual(config.carpetaTrabajo, { dia: hoy, hecho: true, intentos: deHoy.intentos + 1, ...resultado });
        if (resultado.subio) {
          const dejadas = resultado.sinPasar?.length ? ` Quedaron sin pasar (no se entendían): ${resultado.sinPasar.join(", ")}.` : "";
          registro.info(`manual de la noche: pasé ${resultado.pasadas} nota(s) y subí el manual a ${repo.ramaBase}`);
          await aviso(`Manual de la noche: pasé ${resultado.pasadas} nota(s) de cambios pendientes al manual y lo subí a ${repo.ramaBase}.${dejadas}`);
        } else if (resultado.notas) {
          registro.aviso(`manual de la noche: ninguna de las ${resultado.notas} nota(s) se pudo pasar`);
          await aviso(`Manual de la noche: había ${resultado.notas} nota(s) de cambios pendientes y ninguna se pudo pasar al manual (siguen en ${repo.ramaBase}).`);
        } else {
          registro.info("manual de la noche: no hay notas pendientes");
        }
        return { hizo: true, ...resultado };
      } catch (error) {
        const intentos = deHoy.intentos + 1;
        guardarEstadoDelManual(config.carpetaTrabajo, { dia: hoy, hecho: false, intentos, error: String(error.message).split("\n")[0] });
        const motivo = String(error.message).split("\n")[0];
        registro.aviso(`manual de la noche: no se subió nada (intento ${intentos} de ${INTENTOS_POR_NOCHE}): ${motivo}`);
        await aviso(
          `Manual de la noche: no se pudo (${motivo}). No se subió nada y las notas siguen en ${repo.ramaBase}.${intentos < INTENTOS_POR_NOCHE ? " Lo intento otra vez." : " Se acabaron los intentos de esta noche."}`,
        );
        return { hizo: false, motivo: "fallo", error: motivo };
      }
    },
  };
}
