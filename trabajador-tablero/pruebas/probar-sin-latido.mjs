// Pruebas de las TARJETAS SIN LATIDO (lib/sin-latido.mjs y su lugar en el planificador), sin red, sin CRM y sin WhatsApp:
//   node trabajador-tablero/pruebas/probar-sin-latido.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Un crm simulado anota lo que se le pide; el reloj se adelanta a mano.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { crearPlanificador } from "../lib/bucle.mjs";
import { completarConfig } from "../lib/config.mjs";
import { ErrorDelCrm } from "../lib/crm.mjs";
import { crearEstadoDeMotores } from "../lib/motores.mjs";
import { decidirRecogida } from "../lib/recoger-errores.mjs";
import { MARCA_SIN_LATIDO, crearGuardiaSinLatido, leerSinLatido, motivoDeDosVeces, rutaDeSinLatido } from "../lib/sin-latido.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "sin-latido-"));
let numero = 0;
const HORA = 3_600_000;
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};
const nuevaConfig = () =>
  completarConfig({
    urlCrm: "https://crm.ejemplo.com",
    claveTrabajador: "aizen_trab_x",
    carpetaTrabajo: path.join(T, `trabajo${numero++}`),
    repos: { aizencrm: { ruta: T, subirSolo: false, ramaBase: "main", remoto: "origin", verificar: [["true"]] } },
  });

/** Un crm que solo anota. `fallar[accion]` = un ErrorDelCrm para esa acción. */
function crmFalso({ fallar = {}, sueltasAlArrancar = [] } = {}) {
  const pedidos = [];
  const anotar = (accion, ...datos) => {
    pedidos.push({ accion, datos });
    if (fallar[accion]) throw fallar[accion];
    return { ok: true };
  };
  return {
    pedidos,
    soltar: async (id, motivo, extra) => anotar("soltar", id, motivo, extra),
    error: async (id, motivo, zonas, reversion, extra) => anotar("error", id, motivo, extra),
    aviso: async (texto, tipo, tarjetaId) => anotar("aviso", texto, tipo, tarjetaId),
    arranque: async () => {
      anotar("arranque");
      return { ok: true, sueltas: sueltasAlArrancar };
    },
  };
}

/** Un reloj que se adelanta: `reloj.pasar(horas)`. */
function crearReloj(inicio = Date.parse("2026-11-18T12:00:00Z")) {
  let ahora = inicio;
  return { ahora: () => ahora, pasar: (horas) => (ahora += horas * HORA) };
}

const tarjeta = (id, extra = {}) => ({ id, titulo: `Tarjeta ${id}`, repo: "aizencrm", ultimosIntentos: [], ...extra });

await prueba("latido de hace 3 h y nadie la trabaja: se suelta sola (1 de 2), sin ERROR ni WhatsApp", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const guardia = crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora });
  guardia.tomada(tarjeta("a"), "construir");
  reloj.pasar(3);
  const hechas = await guardia.revisar();
  assert.deepEqual(hechas, { sueltas: ["a"], errores: [] });
  assert.deepEqual(crm.pedidos.map((p) => p.accion), ["soltar"]);
  const [id, motivo, extra] = crm.pedidos[0].datos;
  assert.equal(id, "a");
  assert.match(motivo, /lleva 3 h/);
  assert.equal(extra.categoria, "coordinador_cortado");
  assert.equal(extra.etapa, "construir");
  assert.ok(extra.causa.includes(MARCA_SIN_LATIDO), "la causa lleva la marca: el contador también queda en los intentos del CRM");
  assert.deepEqual(leerSinLatido(config.carpetaTrabajo).tarjetas.a.veces, 1);
  // Revisar otra vez no la vuelve a soltar (ya no está en las manos).
  await guardia.revisar();
  assert.equal(crm.pedidos.length, 1);
});

await prueba("la segunda vez sin latido más de 2 h: ERROR con el motivo claro y WhatsApp al dueño (necesita, con la tarjeta)", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const guardia = crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora });
  guardia.tomada(tarjeta("b"), "planear");
  reloj.pasar(2.5);
  await guardia.revisar();
  // Vuelve a la fila y se toma otra vez: el contador sigue en 1.
  reloj.pasar(0.1);
  guardia.tomada(tarjeta("b"), "planear");
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.b.veces, 1);
  reloj.pasar(2.5);
  const hechas = await guardia.revisar();
  assert.deepEqual(hechas, { sueltas: [], errores: ["b"] });
  assert.deepEqual(crm.pedidos.map((p) => p.accion), ["soltar", "error", "aviso"]);
  const [id, motivo, extra] = crm.pedidos[1].datos;
  assert.equal(id, "b");
  assert.match(motivo, /sin latido más de 2 h, dos veces/);
  assert.equal(extra.etapa, "planear");
  const [texto, tipo, tarjetaId] = crm.pedidos[2].datos;
  assert.equal(tipo, "necesita");
  assert.equal(tarjetaId, "b");
  assert.match(texto, /Tarjeta b/);
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.b, undefined, "en ERROR sale del archivo");
  // El recogedor diario no la reintenta sola: la deja al dueño.
  assert.equal(decidirRecogida({ motivo, ultimosIntentos: [{ etapa: "planear", categoria: "coordinador_cortado" }] }).accion, "dueno");
});

await prueba("latido de hace 1 h: no se toca", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const guardia = crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora });
  guardia.tomada(tarjeta("c"), "subir");
  reloj.pasar(1);
  assert.deepEqual(await guardia.revisar(), { sueltas: [], errores: [] });
  // Justo en 2 h tampoco: tiene que pasar de 2 h.
  reloj.pasar(1);
  await guardia.revisar();
  assert.equal(crm.pedidos.length, 0);
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.c.enLasManos, true);
});

await prueba("una sesión viva la tiene: nunca se suelta; el reloj corre desde el último latido, no desde que se tomó", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const vivas = new Set(["d"]);
  const guardia = crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora, vivas: () => vivas });
  guardia.tomada(tarjeta("d"), "construir");
  guardia.tomada(tarjeta("e"), "subir");
  // "d": una sesión viva sin latido 5 h (el CRM no contesta, por ejemplo): no se toca.
  reloj.pasar(5);
  await guardia.revisar();
  assert.ok(!crm.pedidos.some((p) => p.datos[0] === "d"), "la viva no se toca");
  // Una construcción de 180 min en la nube que late cada minuto: nunca pasa de 2 h sin latido.
  const config2 = nuevaConfig();
  const crm2 = crmFalso();
  const guardia2 = crearGuardiaSinLatido({ crm: crm2, config: config2, registro: registroFalso(), ahora: reloj.ahora });
  guardia2.tomada(tarjeta("f"), "construir");
  for (let minuto = 0; minuto < 180; minuto += 1) {
    reloj.pasar(1 / 60);
    guardia2.latio("f");
  }
  // Luego la vigilancia de 30 min de la subida, también con latido.
  for (let minuto = 0; minuto < 30; minuto += 1) {
    reloj.pasar(1 / 60);
    guardia2.latio("f");
  }
  reloj.pasar(1.5);
  await guardia2.revisar();
  assert.equal(crm2.pedidos.length, 0, "3,5 h desde que se tomó pero 1,5 h desde el último latido: no se toca");
  // Terminó bien: sale del archivo.
  guardia2.termino("f", { ok: true });
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.f, undefined);
});

await prueba("reinicio entre el primer y el segundo intento: el contador se conserva (archivo, y si se perdió, los intentos del CRM)", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const primera = crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora });
  primera.tomada(tarjeta("g"), "construir");
  reloj.pasar(3);
  await primera.revisar();
  // El Coordinador se reinicia: otra guardia, la misma carpeta.
  const segunda = crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora });
  segunda.tomada(tarjeta("g"), "construir");
  reloj.pasar(3);
  // Otro reinicio (el corte de luz otra vez) antes de revisar.
  const tercera = crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora });
  assert.deepEqual(await tercera.revisar(), { sueltas: [], errores: ["g"] });
  assert.deepEqual(crm.pedidos.map((p) => p.accion), ["soltar", "error", "aviso"]);

  // Sin archivo (se borró la carpeta de trabajo): el contador sale de los intentos que trae /tomar.
  const config2 = nuevaConfig();
  const crm2 = crmFalso();
  const sinArchivo = crearGuardiaSinLatido({ crm: crm2, config: config2, registro: registroFalso(), ahora: reloj.ahora });
  const intentos = [{ numero: 4, etapa: "construir", categoria: "coordinador_cortado", causa: `${MARCA_SIN_LATIDO} y nadie la trabajaba (1 de 2).`, accion: "esperar", cuentaComoIntento: false }];
  sinArchivo.tomada(tarjeta("h", { ultimosIntentos: intentos }), "construir");
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.h.veces, 1);
  // La marca de OTRA etapa no cuenta.
  fs.rmSync(rutaDeSinLatido(config2.carpetaTrabajo));
  sinArchivo.tomada(tarjeta("i", { ultimosIntentos: intentos }), "subir");
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.i.veces, 0);
});

await prueba("el CRM ya la movió (409) se olvida; sin red se reintenta en la próxima vuelta", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso({ fallar: { soltar: new ErrorDelCrm("Esa acción no se puede desde APROBADO.", 409) } });
  const guardia = crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora });
  guardia.tomada(tarjeta("j"), "planear");
  reloj.pasar(3);
  await guardia.revisar();
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.j, undefined);

  const config2 = nuevaConfig();
  const sinRed = crmFalso({ fallar: { soltar: new ErrorDelCrm("No se pudo hablar con el CRM.", 0) } });
  const guardia2 = crearGuardiaSinLatido({ crm: sinRed, config: config2, registro: registroFalso(), ahora: reloj.ahora });
  guardia2.tomada(tarjeta("k"), "planear");
  reloj.pasar(3);
  await guardia2.revisar();
  await guardia2.revisar();
  assert.equal(sinRed.pedidos.length, 2, "lo intenta otra vez");
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.k.enLasManos, true);
});

await prueba("el planificador: al arrancar suelta las de más de 2 h ANTES de /arranque; un reinicio corto no cuenta", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  // El proceso anterior dejó dos: "vieja" (9 días sin latido) y "corta" (10 min).
  const antes = crearGuardiaSinLatido({ crm: crmFalso(), config, registro: registroFalso(), ahora: reloj.ahora });
  antes.tomada(tarjeta("vieja"), "construir");
  reloj.pasar(9 * 24 - 0.2);
  antes.tomada(tarjeta("corta"), "planear");
  reloj.pasar(0.2);
  const crm = crmFalso({ sueltasAlArrancar: ["corta"] });
  const planificador = crearPlanificador({
    crm,
    config,
    registro: registroFalso(),
    medidor: { medir: () => ({ cpu: 10, memoria: 20 }), parar: () => undefined },
    motores: crearEstadoDeMotores(config),
    vigilante: null,
    ahora: reloj.ahora,
  });
  await planificador.iniciar();
  assert.deepEqual(crm.pedidos.map((p) => `${p.accion}${p.datos[0] ? ` ${p.datos[0]}` : ""}`), ["soltar vieja", "arranque"]);
  const guardado = leerSinLatido(config.carpetaTrabajo).tarjetas;
  assert.equal(guardado.vieja.veces, 1);
  assert.equal(guardado.corta, undefined, "la soltó /arranque tras 10 min: no cuenta como intento");
  planificador.parar();
});

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de las tarjetas sin latido: todas bien`);
