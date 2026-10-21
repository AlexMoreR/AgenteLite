#!/usr/bin/env node
// EL TRABAJADOR DEL TABLERO IA (fase 2). Corre en el PC "aizen1" (nunca en el servidor de producción).
// Cada minuto pregunta al CRM (solo HTTPS saliente) si hay una tarjeta aprobada que hacer, y la hace.
// Ver README.md.
//
//   node trabajador-tablero/trabajador.mjs              -> el bucle (cada 60 s)
//   node trabajador-tablero/trabajador.mjs --una-vez    -> una sola vuelta (para probar)
//   node trabajador-tablero/trabajador.mjs --config otra/ruta.json
import path from "node:path";
import { fileURLToPath } from "node:url";

import { unaVuelta } from "./lib/bucle.mjs";
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
const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

let parar = false;
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    registro.info(`recibí ${senal}: termino la vuelta y salgo`);
    parar = true;
  });
}

registro.info(`trabajador arrancó: CRM ${config.urlCrm}, repos ${Object.keys(config.repos).join(", ")}, carpeta ${config.carpetaTrabajo}`);

do {
  let enseguida = false;
  try {
    const vuelta = await unaVuelta({ crm, config, registro });
    if (!vuelta.hizo && unaSola) registro.info(`nada que hacer (${vuelta.motivo})`);
    // Construida y sube sola (quedó SUBIENDO): la subida se toma ya, sin esperar el minuto.
    enseguida = vuelta.hizo === "construir" && vuelta.estado === "SUBIENDO";
    if (enseguida) registro.info("construida y sube sola: la subo enseguida");
  } catch (error) {
    // Sin red o el CRM caído: se reintenta en la próxima vuelta.
    registro.error(`vuelta fallida: ${error.message}`);
    if (error.status === 401) registro.error("la clave del trabajador es inválida o fue revocada: crea otra en el panel Trabajador.");
  }
  if (unaSola || parar) break;
  if (!enseguida) await dormir(config.tiempos.intervaloSegundos * 1000);
} while (!parar);
