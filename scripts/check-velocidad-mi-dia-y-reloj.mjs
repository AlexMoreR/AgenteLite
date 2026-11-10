/**
 * Prueba, sin base y sin mandar nada, de lo que se aceleró en Mi día y en el reloj (/api/cron/follows):
 *   node scripts/check-velocidad-mi-dia-y-reloj.mjs
 *
 * 1. Leads nuevos del día: la cuenta de la empresa y la de la asesora salen de UNA lectura y son idénticas a
 *    las de dos lecturas separadas (el código real, con una base falsa que cuenta las consultas).
 * 2. El informe del día del jefe (getResumenDiaData) hace la mitad de consultas y devuelve lo mismo.
 * 3. Mi día: el usuario se lee una vez, y los pasos que no dependen de nada van juntos.
 * 4. El reloj: solo cambiaron los minutos de la bajada por inactividad, el descarte tras seguimientos, el
 *    barrido de etapas y la limpieza de webhooks; lo que manda mensajes o asigna chats sigue igual.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const leer = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ── Base falsa: cuenta las consultas y devuelve los clientes del día ── */
const Prisma = {
  sql: (partes, ...valores) => ({ texto: partes.join("?"), valores }),
  empty: { texto: "", valores: [] },
  join: (lista) => ({ texto: lista.map(() => "?").join(", "), valores: lista }),
};
const reglasDelDia = cargar("src/features/agentes-de-area/dominio/reglas.ts");
const HORA = 3_600_000;
const rangoDelDia = (fecha) => {
  const desde = new Date(new Date(`${fecha}T00:00:00Z`).getTime() + 5 * HORA);
  return { desde, hasta: new Date(desde.getTime() + 24 * HORA) };
};
const HOY = reglasDelDia.hoyEnBogota(new Date());
const { desde: INICIO } = rangoDelDia(HOY);
const a = (horas) => new Date(INICIO.getTime() + horas * HORA);

const fila = (datos) => ({
  telefono: "573000000000",
  metadataContacto: {},
  canalId: "ch-v1",
  linea: "Ventas 1",
  proposito: "SALES",
  metadataLinea: {},
  asesoraId: null,
  asesora: null,
  primero: a(1),
  texto: "Hola",
  anuncioEnEmbudo: false,
  etiquetaMarketplace: false,
  ...datos,
});
const CHATS = [
  fila({ telefono: "573001110001", asesoraId: "u1", asesora: "Ana" }),
  fila({ telefono: "573001110002", asesoraId: "u2", asesora: "Bea", anuncioEnEmbudo: true }),
  fila({ telefono: "573001110003", asesoraId: null, texto: "Vi esto en Marketplace" }),
  // Escribe por dos líneas: cuenta una vez, en la primera; la dueña es la del chat con dueña.
  fila({ telefono: "573001110004", asesoraId: null, primero: a(2) }),
  fila({ telefono: "573001110004", canalId: "ch-v2", linea: "Ventas 2", asesoraId: "u1", asesora: "Ana", primero: a(3) }),
  // Su primer mensaje de la vida es de ayer: no es nuevo.
  fila({ telefono: "573001110005", asesoraId: "u1", asesora: "Ana", primero: a(-3) }),
  fila({ telefono: "573001110006", asesoraId: "u1", asesora: "Ana  ", primero: a(5) }),
];
let consultas = 0;
const prisma = {
  $queryRaw: async (sql) => {
    consultas += 1;
    if (sql.texto.includes("SELECT DISTINCT")) return CHATS.map((_, i) => ({ contactId: `ct${i}` }));
    return CHATS.map((c) => ({ ...c }));
  },
  callAttempt: { findMany: async () => [] },
  contact: { findMany: async () => [] },
};
const numeros = { rangoDelDia };
const mocks = {
  "@/lib/prisma": { prisma },
  "@prisma/client": { Prisma },
  "@/lib/origen-de-venta-crm": { leerMapaDeLineas: async () => ({}) },
  "../../agentes-de-area/servicios/numeros": numeros,
  "@/features/agentes-de-area/servicios/numeros": numeros,
  "@/features/crm/domain/crm-config": { getCallResultLabel: (r) => r, getCrmLostReasonLabel: (r) => r },
};

const servicio = cargar("src/features/leads-nuevos/servicios/leads-nuevos-del-dia.ts", mocks);
const reglas = cargar("src/features/leads-nuevos/dominio/reglas.ts", mocks);

await prueba("leads nuevos: la de la empresa y la de la asesora salen de una lectura e iguales a dos lecturas", async () => {
  consultas = 0;
  const empresa = await servicio.leadsNuevosDelDia("ws1", HOY);
  const deAna = await servicio.leadsNuevosDelDia("ws1", HOY, { asesoraId: "u1" });
  assert.equal(consultas, 4);
  consultas = 0;
  const juntas = await servicio.leadsNuevosDelDiaConLosDeLaAsesora("ws1", HOY, "u1");
  assert.equal(consultas, 2, "una sola lectura (2 consultas) para las dos cuentas");
  assert.deepEqual(juntas.empresa, empresa);
  assert.deepEqual(juntas.deLaAsesora, deAna);
  assert.equal(empresa.total, 5);
  assert.equal(deAna.total, 3);
});

await prueba("leads nuevos: el filtro por asesora es la regla de antes (la dueña del lead)", () => {
  const filas = CHATS.map((c) => ({
    telefono: c.telefono,
    primerMensajeEn: c.primero,
    primerTexto: c.texto,
    canalId: c.canalId,
    linea: c.linea,
    proposito: c.proposito,
    metadataLinea: c.metadataLinea,
    metadataContacto: c.metadataContacto,
    anuncioEnEmbudo: c.anuncioEnEmbudo,
    etiquetaMarketplace: c.etiquetaMarketplace,
    asesoraId: c.asesoraId,
    asesora: c.asesora,
  }));
  const leads = reglas.leadsNuevosDeLasFilas(filas, HOY, {});
  for (const asesora of ["u1", "u2", "nadie", null, undefined, ""]) {
    const antes = asesora ? leads.filter((l) => l.asesoraId === asesora) : leads;
    assert.deepEqual(reglas.leadsDeLaAsesora(leads, asesora), antes, String(asesora));
  }
});

await prueba("informe del día del jefe: la mitad de consultas y el mismo resultado; el de la asesora, igual que antes", async () => {
  const { getResumenDiaData } = cargar("src/features/llamadas/services/getResumenDia.ts", mocks);
  consultas = 0;
  const jefe = await getResumenDiaData({ workspaceId: "ws1", userId: "u1", advisorName: "Ana", esJefe: true });
  assert.equal(consultas, 2, "antes eran 4: leadsNuevosDelDia dos veces");
  consultas = 0;
  const asesora = await getResumenDiaData({ workspaceId: "ws1", userId: "u1", advisorName: "Ana", esJefe: false });
  assert.equal(consultas, 2);
  assert.equal(asesora.empresa, null);
  assert.deepEqual(jefe.newLeads, asesora.newLeads);
  const deAna = await servicio.leadsNuevosDelDia("ws1", HOY, { asesoraId: "u1" });
  assert.deepEqual(jefe.newLeads, { total: deAna.total, porOrigen: deAna.por_origen });
  assert.deepEqual(jefe.empresa, await servicio.leadsNuevosDelDia("ws1", HOY));
});

await prueba("informe del día: si la lectura falla, sale vacío como antes (no rompe Mi día)", async () => {
  const { getResumenDiaData } = cargar("src/features/llamadas/services/getResumenDia.ts", mocks);
  const original = prisma.$queryRaw;
  prisma.$queryRaw = async () => {
    throw new Error("base caída");
  };
  const errorOriginal = console.error;
  console.error = () => undefined;
  try {
    const jefe = await getResumenDiaData({ workspaceId: "ws1", userId: "u1", advisorName: "Ana", esJefe: true });
    assert.equal(jefe.empresa, null);
    assert.equal(jefe.newLeads.total, 0);
  } finally {
    prisma.$queryRaw = original;
    console.error = errorOriginal;
  }
});

/* ── Mi día ── */
await prueba("Mi día: el usuario se lee una vez y lo independiente va en la primera espera", () => {
  const pagina = leer("src/app/cliente/crm/mi-dia/page.tsx");
  assert.equal(pagina.match(/prisma\.user\.findUnique\(/g)?.length, 1, "el usuario se lee UNA vez");
  const esperas = [...pagina.matchAll(/await Promise\.all\(\[([\s\S]*?)\n  \]\);/g)].map((m) => m[1]);
  assert.equal(esperas.length, 2, "dos esperas en paralelo");
  const [primera, segunda] = esperas;
  for (const llamada of ["getVisibleChannelIds(", "prisma.user.findUnique(", "leerConfigSeguimiento("]) {
    assert.ok(primera.includes(llamada), `${llamada} va en la primera espera`);
  }
  for (const llamada of [
    "getMiDiaData(",
    "getLlamadasVendedoraData(",
    "getResumenDiaData(",
    "leerPendientesDelCoach(",
    "leerTareasDeAsesora(",
    "leerPedidosDelSupervisor(",
    "leerRecuperacionesDeAsesora(",
    "leerAprobacionesPendientes(",
  ]) {
    assert.ok(segunda.includes(llamada), `${llamada} va en la segunda espera`);
  }
  // Ninguna lectura suelta en fila fuera de las dos esperas (salvo el acceso, que va primero).
  const sueltas = pagina.match(/= await (?!Promise\.all|requireClientWorkspaceAccess)/g) ?? [];
  assert.deepEqual(sueltas, []);
  // Lo que se muestra sigue igual.
  assert.match(pagina, /advisorName: yo\?\.name\?\.trim\(\) \|\| yo\?\.email \|\| "Asesora"/);
  assert.match(pagina, /nombreAsesora=\{yo\?\.name\?\.trim\(\)\.split\(" "\)\[0\] \|\| "\[tu nombre\]"\}/);
  assert.match(pagina, /aprobadora && aprobadora === access\.userId \? leerAprobacionesPendientes\(access\.workspaceId\)\.catch\(\(\) => \[\]\) : \[\]/);
});

/* ── El reloj ── */
await prueba("reloj: bajada cada 15 min, descarte tras seguimientos y barrido cada 30, limpieza de webhooks a las 3 a. m.", () => {
  const reloj = leer("src/app/api/cron/follows/route.ts");
  assert.match(reloj, /if \(new Date\(\)\.getMinutes\(\) % 15 === 1\) \{\s*try \{\s*cooldown = await demoteUnresponsiveStaleLeads\(\);/);
  assert.match(reloj, /if \(new Date\(\)\.getMinutes\(\) % 15 === 8\) \{\s*try \{\s*temperatura = await enfriarLeadsSinRespuesta\(\);/);
  assert.match(reloj, /if \(new Date\(\)\.getMinutes\(\) % 30 === 12\) \{\s*try \{\s*await ejecutarDescarteTrasSeguimientos\(\);/);
  assert.match(reloj, /if \(minuto % 30 === 6\) \{\s*after\(async \(\) => \{\s*try \{\s*await barrerEtapasDeTodos\(\);/);
  assert.match(
    reloj,
    /if \(new Date\(\)\.getMinutes\(\) % 10 === 7 && new Date\(Date\.now\(\) - 5 \* 3_600_000\)\.getUTCHours\(\) === 3\) \{\s*try \{\s*webhookLogs = await purgeOldWebhookEventLogs\(\);/,
  );
});

await prueba("reloj: la limpieza de webhooks corre 6 veces, solo entre las 3:00 y las 3:59 de Colombia", () => {
  const toca = (fecha) => fecha.getMinutes() % 10 === 7 && new Date(fecha.getTime() - 5 * HORA).getUTCHours() === 3;
  const veces = [];
  for (let minuto = 0; minuto < 24 * 60; minuto += 1) {
    const fecha = new Date(Date.UTC(2026, 10, 10, 0, minuto));
    if (toca(fecha)) veces.push(new Date(fecha.getTime() - 5 * HORA).toISOString().slice(11, 16));
  }
  assert.deepEqual(veces, ["03:07", "03:17", "03:27", "03:37", "03:47", "03:57"]);
});

await prueba("reloj: lo que manda mensajes, asigna chats o avisa no cambió de frecuencia", () => {
  const reloj = leer("src/app/api/cron/follows/route.ts");
  // Siguen en cada vuelta (sin condición de minuto delante).
  for (const llamada of ["procesarTandasDeCampanas()", "barrerSeguimientoInteligente()", "correrAutomatizacionesDelReloj()", "transcribirAudiosPendientes()"]) {
    const antes = reloj.slice(Math.max(0, reloj.indexOf(llamada) - 160), reloj.indexOf(llamada));
    assert.ok(reloj.includes(llamada), llamada);
    assert.doesNotMatch(antes, /getMinutes\(\)|minuto [%=]/, `${llamada} sigue en cada vuelta`);
  }
  // Los de siempre, con su minuto de siempre.
  assert.match(reloj, /if \(new Date\(\)\.getMinutes\(\) % 10 === 0\) \{\s*try \{\s*descartados = await ejecutarDescarteAutomatico\(\);/);
  assert.match(reloj, /if \(minuto % 5 === 3\) \{/);
  assert.match(reloj, /if \(minuto === 41\) \{/);
  assert.match(reloj, /if \(minuto === 23\) \{/);
  assert.equal(reloj.match(/new Date\(\)\.getMinutes\(\) === 17/g)?.length, 2);
});

console.log(`\n${pruebas} pruebas de Mi día y el reloj: todas pasaron.`);
