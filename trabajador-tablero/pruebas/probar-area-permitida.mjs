// Pruebas de SOLO EL ÁREA PERMITIDA (10-nov-2026, T-737), sin CRM ni Claude:
//   node trabajador-tablero/pruebas/probar-area-permitida.mjs   (va dentro de npm run test:trabajador-tablero)
//
// - con `areaPermitidaId` (y `tableroId`): una aprobada fuera del área no se toma; una dentro y una en una sub-área, sí;
// - las listas de errores y de por revisar (recoger, rescatar, revisar de nuevo) salen sin las de fuera;
// - una que llega de fuera igual (entre /candidatas y /tomar) se suelta sin trabajarla; un CRM viejo sin `ancestros` no da nada;
// - sin la clave nada cambia: el mismo cliente del CRM, toma la primera de todo el tablero;
// - configuración: las claves se leen, se validan y vienen en config.example.json.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crmDelArea, filtroDeArea } from "../lib/area-permitida.mjs";
import { completarConfig } from "../lib/config.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FEATURES = "cmwbcu28700b732qmru2nd890";
const TABLERO = "cmvg35cqq001i2io6q1hfwvio";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// El tablero de mentira: Features > Sub-área > tarjeta, y otra Área ("Ventas") con su tarjeta aprobada.
const FUERA = { id: "t-fuera", tableroId: TABLERO, titulo: "Aprobada en Ventas", estado: "APROBADO", repo: "aizencrm", ancestros: ["area-ventas"] };
const DENTRO = { id: "t-dentro", tableroId: TABLERO, titulo: "Aprobada en Features", estado: "APROBADO", repo: "aizencrm", ancestros: [FEATURES] };
const SUB = { id: "t-sub", tableroId: TABLERO, titulo: "Aprobada en una sub-área de Features", estado: "PLAN_APROBADO", repo: "aizencrm", ancestros: ["sub-area", FEATURES] };
const OTRO_TABLERO = { id: "t-otro", tableroId: "otro-tablero", titulo: "De otro tablero", estado: "APROBADO", repo: "aizencrm", ancestros: [FEATURES] };

/** Un CRM de mentira: /tomar da la primera candidata que no esté en `excluir` (como SQL_TOMAR_UNA) y la quita de la fila. */
function crmFalso(tarjetas) {
  const fila = [...tarjetas];
  const llamadas = { tomar: [], soltar: [] };
  return {
    llamadas,
    fila,
    candidatas: async () => ({ candidatas: fila.map((tarjeta) => ({ ...tarjeta, hacer: tarjeta.estado === "APROBADO" ? "planear" : "construir" })) }),
    tomar: async (opciones = {}) => {
      llamadas.tomar.push(opciones);
      const indice = fila.findIndex((tarjeta) => !(opciones.excluir ?? []).includes(tarjeta.id));
      if (indice < 0) return { tarjeta: null, motivo: "nada" };
      const [tarjeta] = fila.splice(indice, 1);
      return { tarjeta, hacer: tarjeta.estado === "APROBADO" ? "planear" : "construir" };
    },
    soltar: async (id, motivo) => {
      llamadas.soltar.push({ id, motivo });
      return { ok: true };
    },
    errores: async () => ({ tarjetas: tarjetas.map((tarjeta) => ({ ...tarjeta, estado: "ERROR" })) }),
    porRevisar: async () => ({ tarjetas: tarjetas.map((tarjeta) => ({ ...tarjeta })), paraRevisarDeNuevo: tarjetas.map((tarjeta) => ({ ...tarjeta, paso: true })) }),
    aviso: async () => ({ ok: true }),
  };
}

const registroMudo = () => {
  const avisos = [];
  return { avisos, info: () => undefined, aviso: (texto) => avisos.push(texto), error: () => undefined };
};

const CON_AREA = { areaPermitidaId: FEATURES, tableroId: TABLERO };

await prueba("con el área: la aprobada fuera de Features no se toma; la de dentro y la de la sub-área, sí", async () => {
  const falso = crmFalso([FUERA, DENTRO, SUB]);
  const crm = crmDelArea(falso, CON_AREA, registroMudo());
  const { candidatas } = await crm.candidatas();
  assert.deepEqual(candidatas.map((c) => c.id), ["t-dentro", "t-sub"]);
  const primera = await crm.tomar({ maxParalelo: 3 });
  assert.equal(primera.tarjeta.id, "t-dentro");
  assert.ok(falso.llamadas.tomar[0].excluir.includes("t-fuera"), "la de fuera va en excluir: el CRM no la toma");
  const segunda = await crm.tomar({ maxParalelo: 3 });
  assert.equal(segunda.tarjeta.id, "t-sub");
  // Solo queda la de fuera: no se llama a /tomar y la tarjeta sigue en la fila, sin tocar.
  const tercera = await crm.tomar({ maxParalelo: 3 });
  assert.equal(tercera.tarjeta, null);
  assert.equal(tercera.motivo, "fuera_del_area");
  assert.equal(falso.llamadas.tomar.length, 2);
  assert.deepEqual(falso.fila.map((t) => t.id), ["t-fuera"]);
  assert.deepEqual(falso.llamadas.soltar, []);
});

await prueba("con el área: errores, por revisar y revisar de nuevo salen sin las de fuera ni las de otro tablero", async () => {
  const crm = crmDelArea(crmFalso([FUERA, DENTRO, SUB, OTRO_TABLERO]), CON_AREA, registroMudo());
  assert.deepEqual((await crm.errores()).tarjetas.map((t) => t.id), ["t-dentro", "t-sub"]);
  const porRevisar = await crm.porRevisar();
  assert.deepEqual(porRevisar.tarjetas.map((t) => t.id), ["t-dentro", "t-sub"]);
  assert.deepEqual(porRevisar.paraRevisarDeNuevo.map((t) => t.id), ["t-dentro", "t-sub"]);
  // La tarjeta Área misma cuenta como del área; una sin madre no.
  const filtro = filtroDeArea(CON_AREA);
  assert.equal(filtro.permite({ id: FEATURES, tableroId: TABLERO, ancestros: [] }), true);
  assert.equal(filtro.permite({ id: "suelta", tableroId: TABLERO, ancestros: [] }), false);
});

await prueba("con el área: una de fuera que llega igual de /tomar se suelta sin trabajarla", async () => {
  const falso = crmFalso([DENTRO]);
  // Entre /candidatas y /tomar apareció una de fuera que va primero en la fila.
  falso.tomar = async (opciones) => {
    falso.llamadas.tomar.push(opciones);
    return { tarjeta: FUERA, hacer: "planear" };
  };
  const registro = registroMudo();
  const respuesta = await crmDelArea(falso, CON_AREA, registro).tomar({});
  assert.equal(respuesta.tarjeta, null);
  assert.equal(respuesta.motivo, "fuera_del_area");
  assert.deepEqual(falso.llamadas.soltar.map((s) => s.id), ["t-fuera"]);
  assert.match(registro.avisos.join("\n"), /no cuelga de/);
});

await prueba("con el área y un CRM viejo (sin ancestros): no se toma nada y se avisa una vez", async () => {
  const sinAncestros = [FUERA, DENTRO].map(({ ancestros: _ancestros, ...tarjeta }) => tarjeta);
  const falso = crmFalso(sinAncestros);
  const registro = registroMudo();
  const crm = crmDelArea(falso, CON_AREA, registro);
  assert.equal((await crm.tomar({})).tarjeta, null);
  assert.equal((await crm.tomar({})).tarjeta, null);
  assert.equal(falso.llamadas.tomar.length, 0);
  assert.equal(registro.avisos.filter((a) => /ancestros/.test(a)).length, 1);
});

await prueba("sin la clave nada cambia: el mismo cliente, toma de todo el tablero", async () => {
  const falso = crmFalso([FUERA, DENTRO, SUB]);
  assert.equal(crmDelArea(falso, {}, registroMudo()), falso);
  assert.equal(crmDelArea(falso, { areaPermitidaId: null, tableroId: null }), falso);
  assert.equal((await falso.tomar({})).tarjeta.id, "t-fuera");
  assert.equal(filtroDeArea({}).activo, false);
  assert.equal(filtroDeArea({}).permite(FUERA), true);
});

await prueba("configuración: areaPermitidaId y tableroId se leen; sin ellas, null; un valor raro es un error", async () => {
  const base = { urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: ".", subirSolo: false } } };
  const sin = completarConfig(base);
  assert.equal(sin.areaPermitidaId, null);
  assert.equal(sin.tableroId, null);
  const con = completarConfig({ ...base, areaPermitidaId: ` ${FEATURES} `, tableroId: TABLERO });
  assert.equal(con.areaPermitidaId, FEATURES);
  assert.equal(con.tableroId, TABLERO);
  assert.throws(() => completarConfig({ ...base, areaPermitidaId: "Features" }), /areaPermitidaId/);
  assert.throws(() => completarConfig({ ...base, tableroId: 42 }), /tableroId/);
  const ejemplo = JSON.parse(fs.readFileSync(path.join(AQUI, "..", "config.example.json"), "utf8"));
  assert.equal(ejemplo.areaPermitidaId, FEATURES);
  assert.equal(ejemplo.tableroId, TABLERO);
});

console.log(`\n${pruebas} pruebas del área permitida, todas bien`);
