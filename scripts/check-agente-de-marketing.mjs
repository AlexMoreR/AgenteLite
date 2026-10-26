// Pruebas del AGENTE DE MARKETING en el CRM, con una base FALSA (sin red ni Postgres):
//  - los números por anuncio de origen (nuevas, Tibio/Caliente, ventas, sin respuesta, sin origen y su %);
//  - el resumen de marketing: uno por día, sin pisar el de Ventas, máximo 1 recomendación, nunca "pausar para reaprender";
//  - marketing nunca pide un WhatsApp y la línea de las 7:30 se arma con el dato que la sustenta.
// Correr: npm run test:agente-de-marketing
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const WS = "ws1";
const t = (hhmm) => new Date(`2026-10-26T${hhmm}:00Z`);

// ── La base falsa ───────────────────────────────────────────────────────────────────────────────
const ajustes = new Map();
const dias = [];
let embudo = [];
let conversaciones = [];
let mensajes = [];
let contador = 0;
const coincide = (fila, donde = {}) => Object.entries(donde).every(([k, v]) => fila[k] === v);

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { key: where.key, value: ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value);
    },
  },
  agenteDeAreaDia: {
    findUnique: async ({ where }) => dias.find((d) => coincide(d, where.workspaceId_area_fecha)) ?? null,
    upsert: async ({ where, create, update }) => {
      const previo = dias.find((d) => coincide(d, where.workspaceId_area_fecha));
      if (previo) Object.assign(previo, update);
      else dias.push({ id: `d${++contador}`, ...create });
    },
  },
  embudoLead: { findMany: async () => embudo },
  conversation: { findMany: async () => conversaciones },
  message: { findMany: async () => mensajes },
};
const mocks = { "@/lib/prisma": { prisma } };

const reglas = cargar("src/features/agentes-de-area/dominio/reglas.ts", mocks);
const marketing = cargar("src/features/agentes-de-area/dominio/marketing.ts", mocks);
const resumenes = cargar("src/features/agentes-de-area/servicios/resumenes.ts", mocks);
const numeros = cargar("src/features/agentes-de-area/servicios/numeros-de-marketing.ts", mocks);

function reiniciar({ activo = false } = {}) {
  ajustes.clear();
  dias.length = 0;
  embudo = [];
  conversaciones = [];
  mensajes = [];
  if (activo) ajustes.set(`agente-area:marketing:${WS}`, JSON.stringify({ activo: true }));
}

function lead(id, { anuncioId = "ad1", titulo = "Diván 1", temperatura = null, etapa = "NUEVO", cotizacion = null, respuesta = "14:10" } = {}) {
  embudo.push({
    conversationId: id,
    anuncioId,
    anuncioTitulo: anuncioId ? titulo : null,
    temperatura,
    primeraRespuestaAsesoraEn: respuesta ? t(respuesta) : null,
    entradaEn: t("14:00"),
  });
  conversaciones.push({ id, contact: { crmStage: etapa, wonQuoteRef: cotizacion } });
}

// ── Los números por anuncio ─────────────────────────────────────────────────────────────────────
await prueba("agrupa por anuncio: nuevas, Tibio/Caliente (asesora y sistema), ventas con cotización, sin respuesta y sin origen", async () => {
  reiniciar();
  lead("c1", { temperatura: "CALIENTE" });
  lead("c2", { temperatura: "TIBIO", etapa: "PROPUESTA" });
  lead("c3", { etapa: "GANADO", cotizacion: "COT-00123", respuesta: "14:30" });
  lead("c4", { temperatura: "FRIO", respuesta: null });
  lead("c5", { anuncioId: "ad2", titulo: "Camillas Cali", respuesta: null });
  lead("c6", { anuncioId: null, respuesta: null });
  lead("c7", { anuncioId: null });
  const r = await numeros.numerosDeMarketing(WS, "2026-10-26", 7);
  const diván = r.anuncios.find((a) => a.anuncio_id === "ad1");
  assert.equal(diván.conversaciones_nuevas, 4);
  assert.equal(diván.tibio_o_caliente_sistema, 2);
  assert.equal(diván.tibio_o_caliente_asesora, 2, "Propuesta y Ganado cuentan como etapa avanzada de la asesora");
  assert.equal(diván.tibio_o_caliente, 3, "no se cuenta dos veces al que cumple las dos");
  assert.equal(diván.ventas, 1);
  assert.deepEqual(diván.cotizaciones, ["COT-00123"]);
  assert.equal(diván.sin_respuesta, 1);
  assert.equal(diván.primera_respuesta_min_mediana, 10);
  assert.equal(r.anuncios.find((a) => a.anuncio_id === "ad2").sin_respuesta, 1);
  assert.equal(r.conversaciones_nuevas, 7);
  assert.equal(r.sin_anuncio_de_origen, 2);
  assert.equal(r.sin_anuncio_de_origen_pct, 28.6);
  assert.equal(r.anuncios.find((a) => a.anuncio === marketing.SIN_ANUNCIO).conversaciones_nuevas, 2);
  assert.equal(r.anuncios[0].conversaciones_nuevas, 4, "ordenados por conversaciones");
});

await prueba("de un solo día trae los primeros mensajes cortos del cliente; de 7 días no", async () => {
  reiniciar();
  lead("c1");
  mensajes = [
    { conversationId: "c1", content: "Hola, ¿cuánto vale el divan?" },
    { conversationId: "c1", content: "x".repeat(400) },
    { conversationId: "c1", content: "¿envían a Cali?" },
    { conversationId: "c1", content: "tres" },
    { conversationId: "c1", content: "cuatro" },
    { conversationId: "c1", content: "cinco" },
  ];
  const uno = await numeros.numerosDeMarketing(WS, "2026-10-26", 1);
  const msgs = uno.anuncios[0].conversaciones[0].mensajes_del_cliente;
  assert.equal(msgs.length, 4);
  assert.ok(msgs[1].length <= 161 && msgs[1].endsWith("…"));
  const siete = await numeros.numerosDeMarketing(WS, "2026-10-26", 7);
  assert.equal(siete.anuncios[0].conversaciones, undefined);
});

await prueba("sin conversaciones no inventa nada (0 % sin origen, lista vacía)", async () => {
  reiniciar();
  const r = await numeros.numerosDeMarketing(WS, "2026-10-26", 1);
  assert.deepEqual([r.anuncios.length, r.sin_anuncio_de_origen_pct], [0, 0]);
});

// ── El resumen ──────────────────────────────────────────────────────────────────────────────────
const meta = (extra = {}) => ({
  linea: "Marketing: Combo Diván gastó 100.000 y no vendió.",
  recomendaciones: [{ accion: "bajar", anuncio: "Diván 1", texto: "Bajar el anuncio Diván 1", dato: "0 ventas en 7 días con 100.000 de gasto" }],
  ...extra,
});

await prueba("guardar el resumen de marketing dos veces el mismo día deja UNO, y no pisa el de Ventas", async () => {
  reiniciar();
  await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "ventas", args: { fecha: "2026-10-26", texto_alexander: "ventas" }, hoy: "2026-10-26" });
  const a = await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "marketing", args: { meta: meta(), texto_alexander: "uno" }, hoy: "2026-10-26" });
  const b = await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "marketing", args: { meta: meta(), texto_alexander: "dos", salio_tarde: true }, hoy: "2026-10-26" });
  assert.equal(a.reemplazo, false);
  assert.equal(b.reemplazo, true);
  assert.equal(dias.length, 2);
  assert.equal(dias.find((d) => d.area === "ventas").textoAlexander, "ventas");
  const m = dias.find((d) => d.area === "marketing");
  assert.equal(m.textoAlexander, "dos");
  assert.equal(m.salioTarde, true);
  assert.equal(m.meta.recomendacion.accion, "bajar");
  assert.equal(m.meta.linea.startsWith("Marketing:"), true);
});

await prueba("el interruptor de marketing empieza apagado (prueba) y es independiente del de Ventas", async () => {
  reiniciar();
  assert.equal((await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "marketing", args: {}, hoy: "2026-10-26" })).esPrueba, true);
  ajustes.set(`agente-area:ventas:${WS}`, JSON.stringify({ activo: true }));
  assert.equal((await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "marketing", args: {}, hoy: "2026-10-26" })).esPrueba, true);
  reiniciar({ activo: true });
  assert.equal((await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "marketing", args: {}, hoy: "2026-10-26" })).esPrueba, false);
});

await prueba("máximo 1 recomendación; con dato; solo subir/bajar/cambiar; 'pausar para reaprender' se rechaza", async () => {
  const dos = [meta().recomendaciones[0], meta().recomendaciones[0]];
  assert.throws(() => reglas.leerResumenDelAgente({ meta: meta({ recomendaciones: dos }) }, "2026-10-26", "marketing"), /MÁXIMO 1/);
  const una = (r) => ({ meta: meta({ recomendaciones: [{ ...meta().recomendaciones[0], ...r }] }) });
  assert.throws(() => reglas.leerResumenDelAgente(una({ accion: "pausar", texto: "Pausar la campaña" }), "2026-10-26", "marketing"), /subir, bajar o cambiar/);
  assert.throws(() => reglas.leerResumenDelAgente(una({ dato: "" }), "2026-10-26", "marketing"), /dato que la sustenta/);
  assert.throws(() => reglas.leerResumenDelAgente(una({ accion: "bajar", texto: "Pausar la campaña unos días para que reaprenda" }), "2026-10-26", "marketing"), /reaprenda/);
  assert.throws(() => reglas.leerResumenDelAgente(una({ accion: "cambiar", texto: "Para que el algoritmo reaprenda, apaga el anuncio" }), "2026-10-26", "marketing"), /reaprenda/);
  assert.equal(reglas.leerResumenDelAgente({ meta: meta({ recomendaciones: [] }) }, "2026-10-26", "marketing").meta.recomendacion, null);
  const ok = reglas.leerResumenDelAgente(una({ accion: "subir", texto: "Subir 20 % el presupuesto del anuncio Camillas Cali", dato: "3 ventas, costo por venta 40.000" }), "2026-10-26", "marketing");
  assert.equal(ok.meta.recomendacion.accion, "subir");
  // Ventas no se toca: su meta pasa tal cual.
  assert.deepEqual(reglas.leerResumenDelAgente({ meta: { ventas_hoy: 1 } }, "2026-10-26").meta, { ventas_hoy: 1 });
});

await prueba("la línea de las 7:30 lleva la recomendación con su dato (una sola línea de marketing)", async () => {
  const texto = reglas.lineaDeMarketingParaAlexander(reglas.leerMetaDeMarketing(meta()));
  assert.match(texto, /^Marketing: Combo Diván gastó 100\.000 y no vendió\./);
  assert.match(texto, /Recomendación: Bajar el anuncio Diván 1 \(0 ventas en 7 días con 100\.000 de gasto\)/);
  assert.equal(reglas.lineaDeMarketingParaAlexander(null), null);
  assert.equal(reglas.lineaDeMarketingParaAlexander(reglas.leerMetaDeMarketing({ linea: "Marketing: todo normal." })), "Marketing: todo normal.");
});

// ── Está conectado al MCP, y marketing no escribe ───────────────────────────────────────────────
await prueba("marketing no manda WhatsApp: el servidor solo deja mandar a Ventas", async () => {
  assert.ok(reglas.AREAS.includes("marketing"));
  assert.deepEqual([...reglas.AREAS_QUE_MANDAN], ["ventas"]);
  const mcp = fs.readFileSync(`${RAIZ}/src/lib/mcp/agentes-de-area.ts`, "utf8");
  for (const nombre of ["numeros_de_marketing", "agente_de_marketing"]) assert.ok(mcp.includes(`name: "${nombre}"`), nombre);
  assert.ok(mcp.includes("const area = areaQueManda(args)"), "mandar_whatsapp_al_equipo exige un área que mande");
  const tablas = fs.readFileSync(`${RAIZ}/src/features/agentes-de-area/servicios/numeros-de-marketing.ts`, "utf8");
  assert.ok(!/\.(create|update|upsert|delete)\w*\(/.test(tablas), "numeros-de-marketing solo lee");
  const pantalla = fs.readFileSync(`${RAIZ}/src/app/cliente/crm/agente-de-marketing/page.tsx`, "utf8");
  assert.ok(pantalla.includes("puedeSupervisar"), "mismos permisos que la pantalla de Ventas");
  assert.ok(fs.readFileSync(`${RAIZ}/src/components/nav-crm.tsx`, "utf8").includes('view: "agente-de-marketing"'));
});

console.log(`\n${pruebas} pruebas pasaron`);
