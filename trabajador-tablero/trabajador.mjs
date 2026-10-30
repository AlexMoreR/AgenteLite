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

import { aplicarVersion, crearVigilanteDeVersion, marcarActualizacionOk, raizDelRepo } from "./lib/autoactualizar.mjs";
import { crearPlanificador, crearRevisorDeNuevo, unaVuelta } from "./lib/bucle.mjs";
import { entornoSeguro, partirTarea } from "./lib/etapas.mjs";
import { leerConfig } from "./lib/config.mjs";
import { crearCrm } from "./lib/crm.mjs";
import { crearLatido } from "./lib/latido.mjs";
import { crearManualNocturno } from "./lib/manual-nocturno.mjs";
import { crearNotasDeBoveda } from "./lib/notas-boveda.mjs";
import { crearRecogedor } from "./lib/recoger-errores.mjs";
import { crearRescatador } from "./lib/rescate-por-revisar.mjs";
import { crearMedidor } from "./lib/recursos.mjs";
import { git } from "./lib/git.mjs";
import { crearRegistro } from "./lib/registro.mjs";
import { crearMarcaDeVida, crearTareasConTope } from "./lib/vuelta.mjs";

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
// El manual de la noche: junta las notas de docs/cambios-pendientes/ en el manual una vez al día (lib/manual-nocturno.mjs).
const manualNocturno = crearManualNocturno({ config, registro, avisar: (texto) => crm.aviso(texto), entorno: entornoSeguro() });
// Los errores viejos (26-oct-2026): una vez al día, y la primera vez que arranca, se recogen las tarjetas en ERROR (lib/recoger-errores.mjs).
const recogedor = crearRecogedor({
  crm,
  config,
  registro,
  partir: (tarjeta, causa, error) => partirTarea({ config, registro, motorDe: null }, tarjeta, { causa, error }),
});
// Lo que espera el sí del dueño sin necesitarlo (27-oct-2026, lib/rescate-por-revisar.mjs): se revisa de nuevo con el diff real y sube sola.
const rescatador = crearRescatador({ crm, config, registro });
// Las tarjetas de chats y del bot que quedaron en Por revisar (30-oct-2026, lib/bucle.mjs): de a una, rebase, build, pruebas y envíos; suben solas o ERROR.
const revisorDeNuevo = crearRevisorDeNuevo({ crm, config, registro, colaPesada: planificador.colaPesada() });
// Las notas NUEVAS del cerebro (lib/notas-boveda.mjs): si boveda.ruta está, cada minuto se crean en la bóveda local.
const notasDeBoveda = crearNotasDeBoveda({ crm, config, registro });
if (config.boveda.ruta) registro.info(`notas de la bóveda: creo las notas nuevas del cerebro en ${config.boveda.ruta}`);
let primeraVueltaBien = false;
let reiniciar = false;

// La vuelta que no se cuelga (27-oct-2026, lib/vuelta.mjs): cada trabajo tiene tope y la marca de vida (vivo.json)
// le dice al lanzador hasta cuándo puede tardar; si no se mueve más de perroGuardianMinutos, el lanzador me reinicia.
const MINUTO = 60_000;
const TOPES = {
  llenar: 15 * MINUTO,
  "manual de la noche": 30 * MINUTO,
  "recoger errores": 30 * MINUTO,
  "rescate de tarjetas por revisar": 10 * MINUTO,
  // Lleva build y pruebas: pasado el tope sigue por su cuenta (en vuelo, no se lanza otra) y la vuelta no lo espera.
  "revisar de nuevo por revisar": 2 * MINUTO,
  "notas de la bóveda": 5 * MINUTO,
  autoactualizar: 10 * MINUTO,
  "aplicar la versión nueva": 10 * MINUTO,
};
const marca = crearMarcaDeVida(config.carpetaTrabajo);
marca.ocupado("arrancando", 5 * MINUTO);
const tareas = crearTareasConTope({ registro, antes: (nombre, topeMs) => marca.ocupado(nombre, topeMs) });
const conTope = (nombre, fn) => tareas.correr(nombre, fn, { topeMs: TOPES[nombre] });
const primeraLinea = (error) => String(error?.message ?? error).split("\n")[0];
/** Mientras corre el trabajo de noche o el recogedor no se toman tarjetas (ninguna subida empieza a la vez). */
const trabajoLargoEnVuelo = () => tareas.algunaEnVuelo("manual de la noche", "recoger errores");

// Versión nueva del Coordinador (antes: `await actualizarCuandoSeaPosible`, que dejaba el bucle mudo hasta que
// terminaran TODAS, también las de la nube): ahora la vuelta sigue (rescate, notas, marca de vida) sin tomar tarjetas
// nuevas, y cuando no queda ninguna corriendo se aplica.
let pendiente = null;
let pendienteDesde = 0;
let ultimoAvisoDeEspera = 0;

while (!parar) {
  if (!pendiente && !trabajoLargoEnVuelo()) {
    const r = await conTope("llenar", () => planificador.llenar());
    if (r.error) avisarFallo(r.error);
    else if (r.estado === "hecha" && !primeraVueltaBien && versionActual) {
      primeraVueltaBien = true;
      marcarActualizacionOk({ carpetaTrabajo: config.carpetaTrabajo, versionActual, registro });
    }
  }
  if (parar) break;
  // Pausado por uso de Claude (26-oct-2026): el trabajo de noche usa Claude, así que no corre mientras dure la pausa.
  if (!pendiente && !planificador.pausadoPorUso() && !tareas.enVuelo("llenar") && !trabajoLargoEnVuelo()) {
    const r = await conTope("manual de la noche", () => manualNocturno.revisar(planificador));
    if (r.error) registro.aviso(`manual de la noche: ${primeraLinea(r.error)}`);
  }
  if (parar) break;
  if (!pendiente && !planificador.pausadoPorUso() && !tareas.enVuelo("llenar") && !trabajoLargoEnVuelo()) {
    const r = await conTope("recoger errores", () => recogedor.revisar());
    if (r.error) registro.aviso(`recoger errores: ${primeraLinea(r.error)}`);
  }
  if (parar) break;
  {
    // No usa Claude: solo lee git y habla con el CRM, corre también en la pausa por uso.
    const r = await conTope("rescate de tarjetas por revisar", () => rescatador.revisar());
    if (r.error) registro.aviso(`rescate de tarjetas por revisar: ${primeraLinea(r.error)}`);
  }
  if (parar) break;
  if (!pendiente && !trabajoLargoEnVuelo()) {
    // No usa Claude: git, build y pruebas en la cola de pasos pesados. Corre también en la pausa por uso.
    const r = await conTope("revisar de nuevo por revisar", () => revisorDeNuevo.revisar());
    if (r.error) registro.aviso(`revisar de nuevo por revisar: ${primeraLinea(r.error)}`);
  }
  if (parar) break;
  {
    // No usa Claude ni el PC: corre también en la pausa por uso.
    const r = await conTope("notas de la bóveda", () => notasDeBoveda.revisar());
    if (r.error) registro.aviso(`notas de la bóveda: ${primeraLinea(r.error)}`);
  }
  if (parar) break;
  if (!pendiente && vigilante) {
    const r = await conTope("autoactualizar", () => vigilante.revisar());
    if (r.error) registro.aviso(`autoactualizar: ${primeraLinea(r.error)}`);
    else if (r.valor) {
      pendiente = r.valor;
      pendienteDesde = Date.now();
      ultimoAvisoDeEspera = Date.now();
      registro.info(`versión nueva ${String(pendiente.nueva).slice(0, 8)}: no tomo más tarjetas; espero a que terminen ${planificador.corriendo()} (la vuelta sigue)`);
    }
  }
  if (pendiente) {
    const ocupado = planificador.corriendo() > 0 || tareas.algunaEnVuelo("llenar", "manual de la noche", "recoger errores", "revisar de nuevo por revisar");
    if (!ocupado) {
      const r = await conTope("aplicar la versión nueva", () =>
        aplicarVersion({
          repo: repoPropio,
          carpetaTrabajo: config.carpetaTrabajo,
          config,
          nueva: pendiente.nueva,
          registro,
          avisar: (texto) => crm.aviso(texto),
          argumentosDePrueba: indiceConfig >= 0 ? ["--config", rutaConfig] : [],
        }),
      );
      if (r.estado === "hecha" && r.valor?.resultado === "reiniciar") {
        reiniciar = true;
        break;
      }
      if (r.error) registro.error(`autoactualizar: no pude aplicar ${String(pendiente.nueva).slice(0, 8)}: ${primeraLinea(r.error)}`);
      // revertida / no-actualiza / error: sigo con mi código y vuelvo a tomar tarjetas. Con "tope" sigue en vuelo.
      if (r.estado !== "tope" && r.estado !== "ocupada") pendiente = null;
    } else if (Date.now() - ultimoAvisoDeEspera >= 5 * MINUTO) {
      ultimoAvisoDeEspera = Date.now();
      const minutos = Math.round((Date.now() - pendienteDesde) / MINUTO);
      registro.info(`autoactualizar: sigo esperando ${planificador.corriendo()} tarjeta(s) para pasar a ${String(pendiente.nueva).slice(0, 8)} (llevo ${minutos} min; no tomo nuevas)`);
    }
  }
  marca.vueltaCompleta();
  if (parar) break;
  // Se despierta antes si termina una sesión (una que quedó SUBIENDO se sube enseguida).
  const dormir = (pendiente ? Math.min(config.tiempos.intervaloSegundos, 15) : config.tiempos.intervaloSegundos) * 1000;
  marca.ocupado("esperando la próxima vuelta", dormir);
  await planificador.esperar(dormir);
}
// Al salir se esperan las que corren (las de la nube pueden tardar): el perro guardián del lanzador no me corta.
marca.ocupado("terminando las tarjetas que corren para salir", 4 * 60 * MINUTO);
await planificador.esperarTodas();
latido.parar();
planificador.parar();
registro.info(reiniciar ? "Coordinador detenido para arrancar con la versión nueva" : "Coordinador detenido");
if (reiniciar) process.exit(0);
