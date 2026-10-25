#!/usr/bin/env node
// EL LANZADOR del Coordinador (25-oct-2026). Es lo que la tarea de Windows "Trabajador Tablero IA" ejecuta en vez de
// `node trabajador.mjs` directo. Es pequeño y estable a propósito: NO importa nada del resto de trabajador-tablero/
// (solo node:*), así sirve aunque el código nuevo del Coordinador ni siquiera cargue.
//
//   node trabajador-tablero/lanzador.mjs [--config ruta.json]
//
// Qué hace:
//   - corre `node trabajador.mjs` y espera;
//   - si el Coordinador salió con 0 para actualizarse (actualizacion.json: estado "probando" y salioParaReiniciar),
//     lo relanza ya, sin esperar los 5 min de la tarea;
//   - si el Coordinador recién actualizado se cae en los primeros `VENTANA_MINUTOS` (estado "probando" y ya lanzado):
//     `git reset --hard <anterior>` en esta copia, estado "revertida", aviso por WhatsApp (fetch directo al CRM con la
//     clave del config) y vuelve a correr la versión anterior;
//   - en cualquier otro caso sale con el mismo código del Coordinador (la tarea lo relanza en ≤5 min, como antes).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VENTANA_MINUTOS = Number(process.env.LANZADOR_VENTANA_MINUTOS) || 3;
const argumentos = process.argv.slice(2);
const indiceConfig = argumentos.indexOf("--config");
const rutaConfig = indiceConfig >= 0 ? path.resolve(argumentos[indiceConfig + 1]) : path.join(AQUI, "config.local.json");
const script = process.env.LANZADOR_SCRIPT || path.join(AQUI, "trabajador.mjs");
const repo = process.env.LANZADOR_REPO || path.resolve(AQUI, "..");

const leerJson = (ruta) => {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};

const config = leerJson(rutaConfig);
if (!config) {
  console.error(`lanzador: no pude leer ${rutaConfig}`);
  process.exit(1);
}
const carpetaTrabajo = path.resolve(path.dirname(rutaConfig), config.carpetaTrabajo ?? "../../trabajador-tablero-trabajo");
const rutaEstado = path.join(carpetaTrabajo, "actualizacion.json");

function anotar(mensaje) {
  const linea = `${new Date().toISOString()} [LANZADOR] ${mensaje}`;
  console.log(linea);
  try {
    fs.mkdirSync(path.join(carpetaTrabajo, "logs"), { recursive: true });
    fs.appendFileSync(path.join(carpetaTrabajo, "logs", "lanzador.log"), `${linea}\n`);
  } catch {
    // Un disco lleno no tumba el lanzador.
  }
}

const leerEstado = () => leerJson(rutaEstado);
function guardarEstado(estado) {
  try {
    fs.mkdirSync(carpetaTrabajo, { recursive: true });
    fs.writeFileSync(`${rutaEstado}.tmp`, `${JSON.stringify(estado, null, 2)}\n`);
    fs.renameSync(`${rutaEstado}.tmp`, rutaEstado);
  } catch (error) {
    anotar(`no pude guardar actualizacion.json: ${error.message}`);
  }
}

/** WhatsApp al dueño por el endpoint del CRM, sin importar nada del Coordinador. Nunca lanza. */
async function avisar(texto) {
  try {
    const url = String(config.urlCrm ?? "").replace(/\/+$/, "");
    const respuesta = await fetch(`${url}/api/trabajador/aviso`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.claveTrabajador}`, "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!respuesta.ok) anotar(`el aviso por WhatsApp no salió (el CRM contestó ${respuesta.status}): ${texto}`);
    else anotar(`aviso por WhatsApp enviado: ${texto}`);
  } catch (error) {
    anotar(`el aviso por WhatsApp no salió (${error.message}): ${texto}`);
  }
}

function git(...args) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
}

function correrCoordinador() {
  return new Promise((resolver) => {
    const hijo = spawn(process.execPath, [script, ...argumentos], {
      cwd: repo,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, TRABAJADOR_LANZADOR: "1" },
    });
    hijo.on("error", (error) => {
      anotar(`no pude arrancar node: ${error.message}`);
      resolver(1);
    });
    hijo.on("exit", (codigo, senal) => resolver(codigo ?? (senal ? 1 : 0)));
  });
}

for (const senal of ["SIGINT", "SIGTERM"]) process.on(senal, () => process.exit(0));

for (;;) {
  const inicio = Date.now();
  const codigo = await correrCoordinador();
  const minutos = (Date.now() - inicio) / 60_000;
  const estado = leerEstado();

  // 1. Salió con 0 para actualizarse: se relanza ya con el código nuevo.
  if (codigo === 0 && estado?.estado === "probando" && estado.salioParaReiniciar === true) {
    guardarEstado({ ...estado, salioParaReiniciar: false, lanzado: true, lanzadoEn: new Date().toISOString() });
    anotar(`el Coordinador salió para actualizarse a ${String(estado.nueva).slice(0, 8)}: lo arranco de nuevo`);
    continue;
  }

  // 2. El Coordinador recién actualizado se cayó al arrancar: se vuelve a la versión anterior.
  if (estado?.estado === "probando" && estado.lanzado === true && estado.anterior && minutos < VENTANA_MINUTOS) {
    anotar(`la versión ${String(estado.nueva).slice(0, 8)} se cayó a los ${minutos.toFixed(1)} min (código ${codigo}): vuelvo a ${String(estado.anterior).slice(0, 8)}`);
    const reset = git("reset", "--hard", estado.anterior);
    if (reset.status !== 0) {
      anotar(`git reset --hard falló: ${String(reset.stderr || reset.stdout).trim()}`);
      guardarEstado({ ...estado, estado: "revertida-fallida", motivo: "git reset --hard falló", cuando: new Date().toISOString() });
      await avisar(`Coordinador: la versión ${String(estado.nueva).slice(0, 8)} se cayó al arrancar y NO pude volver a la anterior. Hay que revisarlo a mano.`);
      process.exit(codigo || 1);
    }
    guardarEstado({
      ...estado,
      estado: "revertida",
      lanzado: false,
      rechazada: estado.nueva,
      motivo: `se cayó al arrancar (código ${codigo}, ${minutos.toFixed(1)} min)`,
      cuando: new Date().toISOString(),
    });
    await avisar(`Coordinador: la versión ${String(estado.nueva).slice(0, 8)} se cayó al arrancar y volví a la ${String(estado.anterior).slice(0, 8)}.`);
    continue;
  }

  // 3. Cualquier otra salida: igual que antes, la tarea de Windows lo relanza en ≤5 min.
  anotar(`el Coordinador salió con código ${codigo}`);
  process.exit(codigo);
}
