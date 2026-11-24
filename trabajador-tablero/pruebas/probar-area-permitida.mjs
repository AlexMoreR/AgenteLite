// Pruebas de SOLO EL ÁREA PERMITIDA (10-nov-2026, T-737), sin CRM ni Claude:
//   node trabajador-tablero/pruebas/probar-area-permitida.mjs   (va dentro de npm run test:trabajador-tablero)
//
// - con `areaPermitidaId` (y `tableroId`): una aprobada fuera del área no se toma; una dentro y una en una sub-área, sí;
// - las listas de errores y de por revisar (recoger, rescatar, revisar de nuevo) salen sin las de fuera;
// - una que llega de fuera igual (entre /candidatas y /tomar) se suelta sin trabajarla; un CRM viejo sin `ancestros` no da nada;
// - sin la clave nada cambia: el mismo cliente del CRM, toma la primera de todo el tablero;
// - configuración: las claves se leen, se validan y vienen en config.example.json.
// Parte 2 de «tomar todo lo de Features» (24-nov-2026), con un CRM falso por HTTP que anota cada petición:
// - el id de Features va en /candidatas (query), en /tomar (cuerpo) y en el latido;
// - una de fuera ya empezada (intentos > 0: PLAN_APROBADO o SUBIENDO) no se suelta; una de fuera con intentos = 0 sí se descarta;
// - sin `areaPermitidaId` no se manda nada nuevo y todo sigue igual.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { areaPermitidaIdDe, crmDelArea, empezadaAntesDeTomar, filtroDeArea, yaEmpezada } from "../lib/area-permitida.mjs";
import { completarConfig } from "../lib/config.mjs";
import { crearCrm } from "../lib/crm.mjs";
import { crearLatido } from "../lib/latido.mjs";

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

// ── Parte 2: el id de Features viaja al CRM, y las de fuera ya empezadas se terminan ──

/**
 * Un CRM falso por HTTP (un `fetch` de mentira) que anota cada petición: { metodo, ruta, query, cuerpo }. Hace lo que hace el CRM:
 * /candidatas da la fila (sin `intentos`, como SQL_CANDIDATAS); /tomar da la primera que no esté en `excluir` y le SUMA 1 a
 * `intentos` (SQL_TOMAR_UNA); /soltar le resta 1 y la devuelve a la fila; /latido contesta ok.
 */
function crmPorHttp(tarjetas) {
  const fila = tarjetas.map((tarjeta) => ({ ...tarjeta }));
  const peticiones = [];
  const estadoAlTomar = { APROBADO: ["PLANEANDO", "planear"], PLAN_APROBADO: ["EN_CURSO", "construir"], SUBIENDO: ["SUBIENDO", "subir"] };
  const fetch = async (url, opciones = {}) => {
    const direccion = new URL(url);
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
    peticiones.push({ metodo: opciones.method, ruta: direccion.pathname, query: Object.fromEntries(direccion.searchParams), cuerpo });
    const contestar = (datos) => ({ ok: true, status: 200, json: async () => ({ ok: true, ...datos }) });
    if (direccion.pathname.endsWith("/tablero/candidatas")) {
      return contestar({ candidatas: fila.map((tarjeta) => {
        const sinIntentos = { ...tarjeta, hacer: estadoAlTomar[tarjeta.estado]?.[1] ?? null };
        delete sinIntentos.intentos;
        return sinIntentos;
      }) });
    }
    if (direccion.pathname.endsWith("/tablero/tomar")) {
      const indice = fila.findIndex((tarjeta) => !(cuerpo?.excluir ?? []).includes(tarjeta.id));
      if (indice < 0) return contestar({ tarjeta: null, motivo: "nada" });
      const [tomada] = fila.splice(indice, 1);
      const [estado, hacer] = estadoAlTomar[tomada.estado];
      return contestar({ tarjeta: { ...tomada, antes: tomada.estado, estado, intentos: (tomada.intentos ?? 0) + 1 }, hacer });
    }
    const soltar = direccion.pathname.match(/\/tablero\/([^/]+)\/soltar$/);
    if (soltar) {
      const original = tarjetas.find((tarjeta) => tarjeta.id === decodeURIComponent(soltar[1]));
      if (original) fila.push({ ...original });
      return contestar({});
    }
    if (direccion.pathname === "/api/trabajador/latido") return contestar({});
    return { ok: false, status: 404, json: async () => ({ ok: false, error: "no existe" }) };
  };
  return { fetch, peticiones, fila };
}

const CONFIG_HTTP = { urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_prueba" };
// De fuera de Features: una aprobada que nunca se empezó, y dos ya empezadas (con plan aprobado y subiendo).
const FUERA_SIN_EMPEZAR = { ...FUERA, intentos: 0 };
const FUERA_CON_PLAN = { id: "t-fuera-plan", tableroId: TABLERO, titulo: "Ventas: plan aprobado", estado: "PLAN_APROBADO", repo: "aizencrm", ancestros: ["area-ventas"], intentos: 1 };
const FUERA_SUBIENDO = { id: "t-fuera-sube", tableroId: TABLERO, titulo: "Ventas: subiendo", estado: "SUBIENDO", repo: "aizencrm", ancestros: ["area-ventas"], intentos: 2 };

await prueba("parte 2: el id de Features va en /candidatas (query), en /tomar (cuerpo) y en el latido", async () => {
  const falso = crmPorHttp([{ ...DENTRO, intentos: 0 }]);
  const config = { ...CONFIG_HTTP, ...CON_AREA };
  const crm = crmDelArea(crearCrm(config, { fetch: falso.fetch }), config, registroMudo());
  await crm.candidatas();
  const tomada = await crm.tomar({ maxParalelo: 2, excluir: [] });
  assert.equal(tomada.tarjeta.id, "t-dentro");
  const latido = crearLatido({
    crm,
    config,
    registro: registroMudo(),
    planificador: { estado: () => ({ tareas: [], uso: null }) },
    medidor: null,
    cadaSegundos: 3600,
    leer: () => null,
  });
  await latido.latirYa();
  latido.parar();
  const candidatas = falso.peticiones.filter((p) => p.ruta === "/api/trabajador/tablero/candidatas");
  assert.ok(candidatas.length >= 2, "candidatas desde la lista y desde tomar");
  for (const peticion of candidatas) {
    assert.equal(peticion.metodo, "POST", "/candidatas es POST: el CRM contesta 405 a GET");
    assert.equal(peticion.query.areaPermitidaId, FEATURES);
  }
  const [tomar] = falso.peticiones.filter((p) => p.ruta === "/api/trabajador/tablero/tomar");
  assert.equal(tomar.cuerpo.areaPermitidaId, FEATURES);
  assert.equal(tomar.cuerpo.maxParalelo, 2);
  const latidos = falso.peticiones.filter((p) => p.ruta === "/api/trabajador/latido");
  assert.ok(latidos.length >= 1);
  assert.equal(latidos.at(-1).cuerpo.areaPermitidaId, FEATURES);
  assert.equal(areaPermitidaIdDe(config), FEATURES);
});

await prueba("parte 2: una de fuera ya empezada (PLAN_APROBADO o SUBIENDO, intentos > 0) se toma y NO se suelta", async () => {
  const falso = crmPorHttp([FUERA_SUBIENDO, FUERA_CON_PLAN]);
  const config = { ...CONFIG_HTTP, ...CON_AREA };
  const registro = registroMudo();
  const crm = crmDelArea(crearCrm(config, { fetch: falso.fetch }), config, registro);
  // /candidatas no trae `intentos`: las dos cuentan como empezadas por su estado y no se descartan.
  assert.deepEqual((await crm.candidatas()).candidatas.map((t) => t.id), ["t-fuera-sube", "t-fuera-plan"]);
  const primera = await crm.tomar({ maxParalelo: 3 });
  assert.equal(primera.tarjeta.id, "t-fuera-sube");
  assert.equal(primera.hacer, "subir");
  const segunda = await crm.tomar({ maxParalelo: 3 });
  assert.equal(segunda.tarjeta.id, "t-fuera-plan");
  assert.equal(segunda.hacer, "construir");
  assert.equal(falso.peticiones.filter((p) => p.ruta.endsWith("/soltar")).length, 0, "ninguna se suelta");
  assert.equal(registro.avisos.length, 0);
  // Las de errores y por revisar de fuera, con intentos > 0, también se terminan (recoger y rescatar).
  const crmListas = crmDelArea(crmFalso([FUERA_CON_PLAN, FUERA_SIN_EMPEZAR]), CON_AREA, registroMudo());
  assert.deepEqual((await crmListas.errores()).tarjetas.map((t) => t.id), ["t-fuera-plan"]);
  assert.deepEqual((await crmListas.porRevisar()).tarjetas.map((t) => t.id), ["t-fuera-plan"]);
});

await prueba("parte 2: una de fuera con intentos = 0 se descarta (y si un CRM viejo la da igual, se suelta una sola vez)", async () => {
  const falso = crmPorHttp([FUERA_SIN_EMPEZAR, { ...DENTRO, intentos: 0 }]);
  const config = { ...CONFIG_HTTP, ...CON_AREA };
  const crm = crmDelArea(crearCrm(config, { fetch: falso.fetch }), config, registroMudo());
  assert.deepEqual((await crm.candidatas()).candidatas.map((t) => t.id), ["t-dentro"]);
  const tomada = await crm.tomar({});
  assert.equal(tomada.tarjeta.id, "t-dentro");
  const tomar = falso.peticiones.find((p) => p.ruta.endsWith("/tablero/tomar"));
  assert.ok(tomar.cuerpo.excluir.includes("t-fuera"), "la de fuera sin empezar va en excluir");
  assert.equal(falso.peticiones.filter((p) => p.ruta.endsWith("/soltar")).length, 0);

  // Un CRM viejo que ignora el filtro: una de fuera con plan aprobado a mano (intentos = 0) llega de /tomar con intentos = 1.
  const aMano = { ...FUERA_CON_PLAN, id: "t-plan-a-mano", intentos: 0 };
  const viejo = crmPorHttp([aMano, { ...DENTRO, intentos: 0 }]);
  const registro = registroMudo();
  const crmViejo = crmDelArea(crearCrm(config, { fetch: viejo.fetch }), config, registro);
  const respuesta = await crmViejo.tomar({});
  assert.equal(respuesta.tarjeta, null);
  assert.equal(respuesta.motivo, "fuera_del_area");
  assert.deepEqual(viejo.peticiones.filter((p) => p.ruta.endsWith("/soltar")).map((p) => p.ruta), ["/api/trabajador/tablero/t-plan-a-mano/soltar"]);
  // En la vuelta siguiente ya va en excluir: se toma la de dentro y no se vuelve a soltar.
  const otra = await crmViejo.tomar({});
  assert.equal(otra.tarjeta.id, "t-dentro");
  assert.ok(viejo.peticiones.filter((p) => p.ruta.endsWith("/tablero/tomar")).at(-1).cuerpo.excluir.includes("t-plan-a-mano"));
  assert.equal(viejo.peticiones.filter((p) => p.ruta.endsWith("/soltar")).length, 1);

  // Las reglas sueltas.
  assert.equal(yaEmpezada({ estado: "APROBADO", intentos: 0 }), false);
  assert.equal(yaEmpezada({ estado: "PLAN_APROBADO", intentos: 0 }), false);
  assert.equal(yaEmpezada({ estado: "APROBADO", intentos: 2 }), true);
  assert.equal(yaEmpezada({ estado: "SUBIENDO" }), true);
  assert.equal(yaEmpezada({ estado: "APROBADO" }), false);
  assert.equal(empezadaAntesDeTomar({ tarjeta: { intentos: 1 }, hacer: "construir" }), false);
  assert.equal(empezadaAntesDeTomar({ tarjeta: { intentos: 2 }, hacer: "planear" }), true);
  assert.equal(empezadaAntesDeTomar({ tarjeta: {}, hacer: "subir" }), true);
  // De otro tablero, aunque esté empezada, no.
  assert.equal(filtroDeArea(CON_AREA).permite({ ...FUERA_SUBIENDO, tableroId: "otro-tablero" }), false);
});

await prueba("parte 2: sin areaPermitidaId no se manda nada nuevo y todo sigue igual", async () => {
  const falso = crmPorHttp([FUERA_SIN_EMPEZAR, FUERA_CON_PLAN, { ...DENTRO, intentos: 0 }]);
  const cliente = crearCrm(CONFIG_HTTP, { fetch: falso.fetch });
  const crm = crmDelArea(cliente, CONFIG_HTTP, registroMudo());
  assert.equal(crm, cliente, "sin el área, el mismo cliente del CRM");
  assert.equal((await crm.candidatas()).candidatas.length, 3);
  const tomada = await crm.tomar({ maxParalelo: 1 });
  assert.equal(tomada.tarjeta.id, "t-fuera", "toma la primera de todo el tablero");
  const latido = crearLatido({
    crm,
    config: CONFIG_HTTP,
    registro: registroMudo(),
    planificador: { estado: () => ({ tareas: [], uso: null }) },
    medidor: null,
    cadaSegundos: 3600,
    leer: () => null,
  });
  await latido.latirYa();
  latido.parar();
  for (const peticion of falso.peticiones) {
    assert.deepEqual(peticion.query, {}, `${peticion.ruta} sin query`);
    assert.equal(peticion.cuerpo && "areaPermitidaId" in peticion.cuerpo, false, `${peticion.ruta} sin areaPermitidaId`);
  }
  assert.deepEqual(falso.peticiones.find((p) => p.ruta.endsWith("/tablero/tomar")).cuerpo, { maxParalelo: 1 });
  assert.equal(areaPermitidaIdDe({}), null);
  assert.equal(areaPermitidaIdDe({ areaPermitidaId: null }), null);
});

console.log(`\n${pruebas} pruebas del área permitida, todas bien`);
