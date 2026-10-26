#!/usr/bin/env node
// EL TRABAJADOR DEL TABLERO IA (fase 2). Corre en el PC "aizen1" (nunca en el servidor de producción).
// Cada minuto pregunta al CRM (solo HTTPS saliente) si hay tarjetas aprobadas que hacer, y las hace:
// hasta `maxParalelo` a la vez (config.local.json), cada una en su sesión de Claude Code, su worktree y
// su rama. Ver README.md.
//
//   node trabajador-tablero/trabajador.mjs              -> el bucle (cada 60 s, o antes si se libera un cupo)
//   node trabajador-tablero/trabajador.mjs --una-vez    -> una sola tarjeta (para probar)
//   node trabajador-tablero/trabajador.mjs --config otra/ruta.json
//   node trabajador-tablero/trabajador.mjs --probar-arranque -> carga la config e importa todos los módulos; sale 0 sin tomar tarjetas
//
// Se actualiza solo: cada config.autoactualizar.cadaMinutos mira si main trae código nuevo del Coordinador, espera a que
// terminen las tarjetas, se actualiza, prueba el arranque y sale con 0 para que lo relancen (lib/autoactualizar.mjs, lanzador.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { actualizarCuandoSeaPosible, crearVigilanteDeVersion, marcarActualizacionOk, raizDelRepo } from "./lib/autoactualizar.mjs";
import { crearPlanificador, unaVuelta } from "./lib/bucle.mjs";
import { leerConfig } from "./lib/config.mjs";
import { crearCrm } from "./lib/crm.mjs";
import { manualNocturno } from "./lib/manual-nocturno.mjs";
import { crearLatido } from "./lib/latido.mjs";
import { crearMedidor } from "./lib/recursos.mjs";
import { git } from "./lib/git.mjs";
import { crearRegistro } from "./lib/registro.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const argumentos = process.argv.slice(2);
const indiceConfig = argumentos.indexOf("--config");
const rutaConfig = indiceConfig >= 0 ? path.resolve(argumentos[indiceConfig + 1]) : path.join(AQUI, "config.local.json");
const unaSola = argumentos.includes("--una-vez");

let config;
try {
  config = leerConfig(rutaConfig);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (argumentos.includes("--probar-arranque")) {
  // La prueba de la autoactualización: el código nuevo carga la config y TODOS sus módulos (no solo los de arriba).
  // No toma tarjetas ni habla con el CRM.
  try {
    const carpetaLib = path.join(AQUI, "lib");
    for (const archivo of fs.readdirSync(carpetaLib).filter((nombre) => nombre.endsWith(".mjs"))) {
      await import(pathToFileURL(path.join(carpetaLib, archivo)).href);
    }
    crearCrm(config);
    console.log("arranque probado: config y módulos bien");
    process.exit(0);
  } catch (error) {
    console.error(`el arranque falla: ${error?.stack ?? error}`);
    process.exit(1);
  }
}

const registro = crearRegistro(config.carpetaTrabajo, { ocultar: [config.claveTrabajador] });
const crm = crearCrm(config);

const avisarFallo = (error) => {
  // Sin red o el CRM caído: se reintenta en la próxima vuelta.
  registro.error(`vuelta fallida: ${error.message}`);
  if (error.status === 401) registro.error("la clave del Coordinador es inválida o fue revocada: crea otra en el panel Coordinador.");
};

if (unaSola) {
  try {
    const vuelta = await unaVuelta({ crm, config, registro });
    if (!vuelta.hizo) registro.info(`nada que hacer (${vuelta.motivo})`);
  } catch (error) {
    avisarFallo(error);
  }
  process.exit(0);
}

// Un solo medidor de CPU y memoria: lo usa el planificador para decidir y el latido para contárselo al panel.
const medidor = crearMedidor();
const planificador = crearPlanificador({ crm, config, registro, medidor });
let parar = false;
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    registro.info(`recibí ${senal}: no tomo más tarjetas, termino las que corren (${planificador.corriendo()}) y salgo`);
    parar = true;
  });
}

const { limites, motores } = config;
registro.info(
  `Coordinador arrancó: CRM ${config.urlCrm}, repos ${Object.keys(config.repos).join(", ")}, carpeta ${config.carpetaTrabajo}; ` +
    `hasta ${config.maxParalelo} tarjetas al tiempo en aizen1 (las grandes y el desborde se construyen en la nube con claude --cloud: ${config.nube.activa ? `hasta ${config.nube.maxTareas} a la vez` : "APAGADO"}) (no abre otra con CPU > ${limites.cpuPorciento} % o memoria > ${limites.memoriaPorciento} %; con el PC lleno espera hasta ${limites.esperaMaximaMinutos} min antes de tomar); ` +
    `repara solo hasta 3 veces (parte la tarea desde ${config.partir.archivosMinimos} archivos a medias); ` +
    `motores: planear ${motores.planear}, construir ${motores.construir}, revisar ${motores.revisar ?? "ninguno"}` +
    `${motores.respaldoClaude ? " (respaldo Claude)" : ""}; todo con Codex si Claude pasa el ${config.umbralClaude} % de uso`,
);

// Lo que el proceso anterior dejó con candado (murió o se reinició) vuelve a la fila sin ERROR.
await planificador.iniciar();

// El latido cada 15 s para la pestaña "Coordinador en vivo". Si el CRM no contesta, no frena nada.
const latido = crearLatido({ crm, config, registro, planificador, medidor });

// Autoactualización: la copia desde la que corre este código (si no es un repo git, queda apagada).
let repoPropio = null;
let versionActual = null;
let vigilante = null;
if (config.autoactualizar.activo) {
  try {
    repoPropio = await raizDelRepo(AQUI);
    versionActual = (await git(repoPropio, ["rev-parse", "HEAD"])).salida.trim();
    vigilante = crearVigilanteDeVersion({ repo: repoPropio, config, carpetaTrabajo: config.carpetaTrabajo, registro });
    registro.info(`autoactualizar: miro cada ${config.autoactualizar.cadaMinutos} min si ${config.autoactualizar.remoto}/${config.autoactualizar.rama} trae código nuevo (versión ${versionActual.slice(0, 8)})`);
  } catch (error) {
    registro.aviso(`autoactualizar apagada: ${String(error.message).split("\n")[0]}`);
  }
}
let primeraVueltaBien = false;
let reiniciar = false;

while (!parar) {
  try {
    await planificador.llenar();
    if (!primeraVueltaBien && versionActual) {
      primeraVueltaBien = true;
      marcarActualizacionOk({ carpetaTrabajo: config.carpetaTrabajo, versionActual, registro });
    }
  } catch (error) {
    avisarFallo(error);
  }
  if (parar) break;
  // El manual al día, una vez cada noche (lib/manual-nocturno.mjs). Mientras trabaja no se toman tarjetas nuevas.
  try {
    await manualNocturno({ config, registro, planificador, avisar: (texto) => crm.aviso(texto) });
  } catch (error) {
    registro.error(`manual de la noche: ${error.message}`);
  }
  if (parar) break;
  const nueva = vigilante ? await vigilante.revisar() : null;
  if (nueva) {
    // Versión nueva del Coordinador: no tomo más tarjetas (no llamo a llenar), espero las que corren y me actualizo.
    const resultado = await actualizarCuandoSeaPosible({
      planificador,
      repo: repoPropio,
      carpetaTrabajo: config.carpetaTrabajo,
      config,
      nueva: nueva.nueva,
      registro,
      avisar: (texto) => crm.aviso(texto),
      argumentosDePrueba: indiceConfig >= 0 ? ["--config", rutaConfig] : [],
    });
    if (resultado.resultado === "reiniciar") {
      reiniciar = true;
      break;
    }
    continue;
  }
  // Se despierta antes si termina una sesión (una que quedó SUBIENDO se sube enseguida).
  await planificador.esperar(config.tiempos.intervaloSegundos * 1000);
}
await planificador.esperarTodas();
latido.parar();
planificador.parar();
registro.info(reiniciar ? "Coordinador detenido para arrancar con la versión nueva" : "Coordinador detenido");
if (reiniciar) process.exit(0);
