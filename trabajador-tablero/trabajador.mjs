#!/usr/bin/env node
// EL TRABAJADOR DEL TABLERO IA (fase 2). Corre en el PC "aizen1" (nunca en el servidor de producción).
// Cada minuto pregunta al CRM (solo HTTPS saliente) si hay tarjetas aprobadas que hacer, y las hace:
// hasta `maxParalelo` a la vez (config.local.json), cada una en su sesión de Claude Code, su worktree y
// su rama. Ver README.md.
//
//   node trabajador-tablero/trabajador.mjs              -> el bucle (cada 60 s, o antes si se libera un cupo)
//   node trabajador-tablero/trabajador.mjs --una-vez    -> una sola tarjeta (para probar)
//   node trabajador-tablero/trabajador.mjs --config otra/ruta.json
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crearPlanificador, unaVuelta } from "./lib/bucle.mjs";
import { leerConfig } from "./lib/config.mjs";
import { crearCrm } from "./lib/crm.mjs";
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

const planificador = crearPlanificador({ crm, config, registro });
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
    `hasta ${config.maxParalelo} tarjetas al tiempo (no abre otra con CPU > ${limites.cpuPorciento} % o memoria > ${limites.memoriaPorciento} %); ` +
    `motores: planear ${motores.planear}, construir ${motores.construir}, revisar ${motores.revisar ?? "ninguno"}` +
    `${motores.respaldoClaude ? " (respaldo Claude)" : ""}; todo con Codex si Claude pasa el ${config.umbralClaude} % de uso`,
);

while (!parar) {
  try {
    await planificador.llenar();
  } catch (error) {
    avisarFallo(error);
  }
  if (parar) break;
  // Se despierta antes si termina una sesión (una que quedó SUBIENDO se sube enseguida).
  await planificador.esperar(config.tiempos.intervaloSegundos * 1000);
}
await planificador.esperarTodas();
planificador.parar();
registro.info("Coordinador detenido");
