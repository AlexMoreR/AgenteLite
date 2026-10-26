// Pruebas del embudo por paso (src/features/embudo/dominio/por-paso.ts y la foto del lead en
// dominio/eventos.ts): historial corto y paso anterior, "se quedó aquí" (más de 24 h), tasas de paso
// a paso, mayor caída, grupo aparte para los chats con asesora y avisos del V2. No necesita base ni red.
// Correr: npm run test:embudo-por-paso
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const p = cargar("src/features/embudo/dominio/por-paso.ts");
const e = cargar("src/features/embudo/dominio/eventos.ts");

let pruebas = 0;
const fallas = [];
function prueba(nombre, fn) {
  try {
    fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

const CTX = { conversationId: "c1", contactId: "k1", workspaceId: "ws1", channelId: "l1", inicioDeLaCharla: new Date("2026-10-01T10:00:00Z") };
const hora = (n) => new Date(Date.parse("2026-10-01T10:00:00Z") + n * 3_600_000);
const paso = (paso, n, extra = {}) => ({ tipo: "PASO_ENTRA", origen: "motor", paso, producto: "combo-camilla", createdAt: hora(n), ...extra });

prueba("el paso anterior, desde cuándo y el historial se llenan al cambiar de paso", () => {
  let foto = null;
  foto = e.aplicarEvento(foto, paso("PRESENTACION", 0), CTX);
  assert.equal(foto.pasoActual, "PRESENTACION");
  assert.equal(foto.pasoAnterior, null);
  foto = e.aplicarEvento(foto, paso("PRODUCTO", 2), CTX);
  assert.equal(foto.pasoActual, "PRODUCTO");
  assert.equal(foto.pasoAnterior, "PRESENTACION");
  assert.equal(foto.pasoDesde.getTime(), hora(2).getTime());
  assert.deepEqual(foto.pasoHistorial.map((c) => c.paso), ["PRESENTACION", "PRODUCTO"]);
  assert.equal(foto.pasoHistorial[1].producto, "combo-camilla");
  assert.equal(foto.pasoHistorial[1].por, "v3");
});

prueba("un evento que no cambia el paso no mueve pasoDesde ni el historial", () => {
  let foto = e.aplicarEvento(null, paso("PRODUCTO", 2), CTX);
  foto = e.aplicarEvento(foto, { tipo: "TURNO_V3", origen: "motor", paso: "PRODUCTO", producto: "combo-camilla", createdAt: hora(5), datos: { mensajes: 1 } }, CTX);
  foto = e.aplicarEvento(foto, { tipo: "CLIENTE_RESPONDIO", origen: "motor", paso: "PRESENTACION", createdAt: hora(6) }, CTX);
  assert.equal(foto.pasoDesde.getTime(), hora(2).getTime());
  assert.equal(foto.pasoHistorial.length, 1);
});

prueba("el historial guarda solo los últimos 10 cambios", () => {
  let foto = null;
  const camino = ["PRESENTACION", "PRODUCTO", "OBJECIONES", "CIERRE"];
  for (let i = 0; i < 15; i += 1) foto = e.aplicarEvento(foto, paso(camino[i % 4], i), CTX);
  assert.equal(foto.pasoHistorial.length, 10);
  assert.equal(foto.pasoHistorial[9].en, hora(14).toISOString());
  assert.equal(foto.pasoHistorial[0].en, hora(5).toISOString());
  assert.equal(e.MAXIMO_DE_PASOS_EN_HISTORIAL, 10);
});

prueba("volver a un paso anterior queda en el historial pero no baja el paso más alto", () => {
  let foto = e.aplicarEvento(null, paso("OBJECIONES", 0), CTX);
  foto = e.aplicarEvento(foto, paso("PRODUCTO", 1), CTX);
  assert.equal(foto.pasoActual, "PRODUCTO");
  assert.equal(foto.pasoMaximo, "OBJECIONES");
  assert.equal(foto.pasoAnterior, "OBJECIONES");
  assert.equal(foto.pasoHistorial.length, 2);
});

prueba("los avisos del V2 quedan marcados como del V2", () => {
  const foto = e.aplicarEvento(null, paso("PRODUCTO", 0, { producto: null, datos: { desde: null, motor: "v2" } }), CTX);
  assert.equal(foto.pasoHistorial[0].por, "v2");
  const v3 = e.eventosDelTurno({
    conversationId: "c1",
    traza: {
      libroVersion: 3, antes: { pasoActual: "PRESENTACION", producto: "p1", esPrimerMensaje: false },
      despues: { pasoActual: "PRODUCTO", producto: "p1" }, intenciones: [], tiposDeAccion: [], conSaludo: false,
      envioFlujo: false, mensajesEnviados: 1, reglaId: null, reglaNombre: null, cuando: hora(1).toISOString(),
    },
    atendido: true, mensajeCliente: "hola", claveProducto: () => "combo-camilla",
  });
  assert.equal(v3.find((ev) => ev.tipo === "PASO_ENTRA").datos.motor, "v3");
});

prueba("el paso antes del primero queda en null y reaplicar sobre una foto vieja (sin campos) funciona", () => {
  const vieja = { ...e.leadVacio(CTX) };
  delete vieja.pasoAnterior; delete vieja.pasoDesde; delete vieja.pasoHistorial;
  const foto = e.aplicarEvento(vieja, paso("PRESENTACION", 0), CTX);
  assert.equal(foto.pasoAnterior, null);
  assert.equal(foto.pasoHistorial.length, 1);
});

const AHORA = new Date("2026-10-23T12:00:00Z");
const haceHoras = (h) => new Date(AHORA.getTime() - h * 3_600_000);

prueba("se quedó aquí: 25 horas sí, 23 horas no, 24 justas no, sin dato no, comprador no", () => {
  assert.equal(p.seQuedoAqui({ ultimoClienteEn: haceHoras(25), ahora: AHORA }), true);
  assert.equal(p.seQuedoAqui({ ultimoClienteEn: haceHoras(23), ahora: AHORA }), false);
  assert.equal(p.seQuedoAqui({ ultimoClienteEn: haceHoras(24), ahora: AHORA }), false);
  assert.equal(p.seQuedoAqui({ ultimoClienteEn: null, ahora: AHORA }), false);
  assert.equal(p.seQuedoAqui({ ultimoClienteEn: haceHoras(100), ahora: AHORA, compro: true }), false);
});

function lead(id, actual, maximo, horasSinEscribir, extra = {}) {
  return { conversationId: id, pasoActual: actual, pasoMaximo: maximo, ultimoClienteEn: haceHoras(horasSinEscribir), compro: false, tomadaPorAsesora: false, ...extra };
}

prueba("llegaron, se quedaron y tasas de paso a paso", () => {
  const leads = [];
  // 10 clientes: 10 llegaron a Presentación, 6 a Producto, 3 a Objeciones, 1 a Cierre.
  for (let i = 0; i < 4; i += 1) leads.push(lead(`a${i}`, "PRESENTACION", "PRESENTACION", 30)); // se quedan en Presentación
  for (let i = 0; i < 3; i += 1) leads.push(lead(`b${i}`, "PRODUCTO", "PRODUCTO", i === 0 ? 5 : 40)); // 2 se quedan, 1 sigue activo
  for (let i = 0; i < 2; i += 1) leads.push(lead(`c${i}`, "OBJECIONES", "OBJECIONES", 50));
  leads.push(lead("d0", "CIERRE", "CIERRE", 60));
  const g = p.armarEmbudoPorPaso(leads, AHORA).soloBot;
  assert.equal(g.total, 10);
  assert.deepEqual(g.pasos.map((x) => x.llegaron), [10, 6, 3, 1]);
  assert.deepEqual(g.pasos.map((x) => x.seQuedaron), [4, 2, 2, 1]);
  assert.equal(g.pasos[0].tasaAlSiguiente, 60);
  assert.equal(g.pasos[1].tasaAlSiguiente, 50);
  assert.equal(g.pasos[2].tasaAlSiguiente, 33.3);
  assert.equal(g.pasos[3].tasaAlSiguiente, null);
  assert.equal(g.pasos[0].pctDelTotal, 100);
  assert.equal(g.pasos[0].pocosDatos, true);
  assert.equal(g.mayorCaida.desde, "OBJECIONES");
  assert.equal(g.mayorCaida.hacia, "CIERRE");
  assert.equal(g.mayorCaida.quedaron, 2);
  assert.equal(g.mayorCaida.pctQueNoPaso, 66.7);
});

prueba("un cliente que volvió a un paso anterior cuenta una sola vez por paso", () => {
  const g = p.armarEmbudoPorPaso([lead("x", "PRODUCTO", "OBJECIONES", 30)], AHORA).soloBot;
  assert.deepEqual(g.pasos.map((x) => x.llegaron), [1, 1, 1, 0]);
  assert.deepEqual(g.pasos.map((x) => x.seQuedaron), [0, 1, 0, 0]);
});

prueba("Identificación (V2) cuenta dentro de Presentación", () => {
  const g = p.armarEmbudoPorPaso([lead("x", "IDENTIFICACION", "IDENTIFICACION", 30)], AHORA).soloBot;
  assert.deepEqual(g.pasos.map((x) => x.llegaron), [1, 0, 0, 0]);
  assert.equal(g.pasos[0].seQuedaron, 1);
});

prueba("los chats con asesora van en un grupo aparte", () => {
  const e1 = p.armarEmbudoPorPaso(
    [lead("a", "PRODUCTO", "PRODUCTO", 30), lead("b", "CIERRE", "CIERRE", 30, { tomadaPorAsesora: true }), lead("c", "OBJECIONES", "OBJECIONES", 1, { tomadaPorAsesora: true })],
    AHORA,
  );
  assert.equal(e1.soloBot.total, 1);
  assert.equal(e1.conAsesora.total, 2);
  assert.deepEqual(e1.soloBot.pasos.map((x) => x.llegaron), [1, 1, 0, 0]);
  assert.deepEqual(e1.conAsesora.pasos.map((x) => x.llegaron), [2, 2, 2, 1]);
  assert.deepEqual(e1.conAsesora.pasos.map((x) => x.seQuedaron), [0, 0, 0, 1]);
});

prueba("el tiempo promedio por paso sale del historial", () => {
  const historial = [
    { paso: "PRESENTACION", producto: null, en: hora(0).toISOString(), por: "v3" },
    { paso: "PRODUCTO", producto: null, en: hora(2).toISOString(), por: "v3" },
    { paso: "OBJECIONES", producto: null, en: hora(6).toISOString(), por: "v3" },
  ];
  const g = p.armarEmbudoPorPaso([lead("x", "OBJECIONES", "OBJECIONES", 30, { pasoHistorial: historial })], AHORA).soloBot;
  assert.deepEqual(g.pasos.map((x) => x.horasPromedio), [2, 4, null, null]);
  assert.equal(p.textoDeHoras(2), "2 h");
  assert.equal(p.textoDeHoras(72), "3 días");
  assert.equal(p.textoDeHoras(null), "Sin dato");
});

prueba("sin clientes no hay caída ni errores", () => {
  const g = p.armarEmbudoPorPaso([], AHORA).soloBot;
  assert.equal(g.total, 0);
  assert.equal(g.mayorCaida, null);
  assert.ok(p.textoDelEmbudoPorPaso({ producto: "Combo camilla", desde: "2026-10-01", hasta: "2026-10-23", grupo: g }).includes("no hay clientes"));
});

prueba("el texto para decir menciona la mayor caída y el aviso de pocos datos", () => {
  const leads = [lead("a", "PRESENTACION", "PRESENTACION", 30), lead("b", "PRODUCTO", "PRODUCTO", 30)];
  const g = p.armarEmbudoPorPaso(leads, AHORA).soloBot;
  const t = p.textoDelEmbudoPorPaso({ producto: "Combo camilla", desde: "2026-10-01", hasta: "2026-10-23", grupo: g });
  assert.ok(t.includes("2 a Presentación, 1 a Producto"));
  assert.ok(t.includes("entre Producto y Objeciones"));
  assert.ok(t.includes("pocos datos"));
});

prueba("el V2 anota su paso con un aviso en segundo plano (funnel-stage-sync)", () => {
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/funnel-stage-sync.ts`, "utf8");
  assert.ok(fuente.includes("registrarEnSegundoPlano"));
  assert.ok(fuente.includes('motor: "v2"'));
  assert.ok(/if \(cambio\) \{\s*try \{/.test(fuente), "solo cuando cambia de paso y protegido con try");
});

prueba("la migración es solo aditiva y se puede correr dos veces", () => {
  const sql = fs.readFileSync(`${RAIZ}/prisma/migrations/20261026120000_embudo_paso_detalle/migration.sql`, "utf8");
  assert.ok(/^BEGIN;/m.test(sql) && /^COMMIT;/m.test(sql));
  assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, 3);
  assert.ok(sql.includes("CREATE INDEX IF NOT EXISTS"));
  assert.ok(!/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME|ALTER COLUMN|SET NOT NULL)\b/i.test(sql));
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}
