// Pruebas de las reglas del mapa de Colombia de la pauta (src/features/pauta/dominio/departamentos.ts
// y src/features/pauta/dominio/mapa.ts), y de la lectura del mapa (src/features/pauta/servicios/leer-mapa.ts y
// numeros_de_marketing con por_departamento). Con datos de prueba, sin red ni base. Correr: npm run test:mapa-colombia
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const d = cargar("src/features/pauta/dominio/departamentos.ts");
const m = cargar("src/features/pauta/dominio/mapa.ts");
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("lista fija: 32 departamentos más Bogotá, con claves únicas", () => {
  assert.equal(d.DEPARTAMENTOS.length, 33);
  assert.equal(new Set(d.DEPARTAMENTOS.map((x) => x.clave)).size, 33);
  for (const clave of ["valle-del-cauca", "choco", "bogota", "san-andres", "narino"]) assert.ok(d.esClaveDepartamento(clave), clave);
  assert.equal(d.nombreDelDepartamento("choco"), "Chocó");
});

await prueba("limpiar texto: sin tildes, en minúsculas y sin 'departamento' ni 'department'", () => {
  assert.equal(d.limpiarTexto("Chocó Department"), "choco");
  assert.equal(d.limpiarTexto("Departamento de NARIÑO"), "de narino");
  assert.equal(d.limpiarTexto("  Valle   del Cauca "), "valle del cauca");
  assert.equal(d.limpiarTexto(null), "");
});

await prueba("ciudades: cada una lleva a su departamento", () => {
  assert.equal(d.departamentoDeCiudad("Cali"), "valle-del-cauca");
  assert.equal(d.departamentoDeCiudad("Quibdó"), "choco");
  assert.equal(d.departamentoDeCiudad("quibdo"), "choco");
  assert.equal(d.departamentoDeCiudad("Istmina"), "choco");
  assert.equal(d.departamentoDeCiudad("Tadó"), "choco");
  assert.equal(d.departamentoDeCiudad("Bogotá D.C."), "bogota");
  assert.equal(d.departamentoDeCiudad("bogota"), "bogota");
  assert.equal(d.departamentoDeCiudad("Medellín"), "antioquia");
  assert.equal(d.departamentoDeCiudad("Soacha"), "cundinamarca");
  assert.equal(d.departamentoDeCiudad("Cúcuta"), "norte-de-santander");
  assert.equal(d.departamentoDeCiudad("Pasto"), "narino");
  assert.equal(d.departamentoDeCiudad("Cali, Valle"), "valle-del-cauca", "ciudad con departamento");
  assert.equal(d.departamentoDeCiudad("Valle"), "valle-del-cauca", "nombre del departamento");
  assert.equal(d.departamentoDeCiudad("Ciudad que no existe"), null);
  assert.equal(d.departamentoDeCiudad(""), null);
  assert.equal(d.departamentoDeCiudad(null), null);
});

await prueba("todas las capitales llevan a su departamento", () => {
  const capitales = {
    Leticia: "amazonas", Medellín: "antioquia", Arauca: "arauca", Barranquilla: "atlantico", Bogotá: "bogota",
    Cartagena: "bolivar", Tunja: "boyaca", Manizales: "caldas", Florencia: "caqueta", Yopal: "casanare",
    Popayán: "cauca", Valledupar: "cesar", Quibdó: "choco", Montería: "cordoba", Inírida: "guainia",
    "San José del Guaviare": "guaviare", Neiva: "huila", Riohacha: "la-guajira", "Santa Marta": "magdalena",
    Villavicencio: "meta", Pasto: "narino", Cúcuta: "norte-de-santander", Mocoa: "putumayo", Armenia: "quindio",
    Pereira: "risaralda", "San Andrés": "san-andres", Bucaramanga: "santander", Sincelejo: "sucre", Ibagué: "tolima",
    Cali: "valle-del-cauca", Mitú: "vaupes", "Puerto Carreño": "vichada",
  };
  for (const [ciudad, clave] of Object.entries(capitales)) assert.equal(d.departamentoDeCiudad(ciudad), clave, ciudad);
  // Cundinamarca no tiene capital propia (es Bogotá): se prueba con una ciudad grande.
  assert.equal(d.departamentoDeCiudad("Zipaquirá"), "cundinamarca");
});

await prueba("nombres de región de Meta llevan al departamento", () => {
  assert.equal(d.departamentoDeRegionMeta("Valle del Cauca Department"), "valle-del-cauca");
  assert.equal(d.departamentoDeRegionMeta("Bogota"), "bogota");
  assert.equal(d.departamentoDeRegionMeta("Bogotá, D.C."), "bogota");
  assert.equal(d.departamentoDeRegionMeta("Chocó Department"), "choco");
  assert.equal(d.departamentoDeRegionMeta("Archipiélago de San Andrés, Providencia y Santa Catalina"), "san-andres");
  assert.equal(d.departamentoDeRegionMeta("Nariño Department"), "narino");
  assert.equal(d.departamentoDeRegionMeta("Meta Department"), "meta");
  assert.equal(d.departamentoDeRegionMeta("Antioquia"), "antioquia");
  for (const dep of d.DEPARTAMENTOS) assert.equal(d.departamentoDeRegionMeta(`${dep.nombre} Department`), dep.clave, dep.nombre);
  // Meta llama a Bogotá "Distrito Especial": antes su gasto caía en "Otras regiones".
  assert.equal(d.departamentoDeRegionMeta("Distrito Especial"), "bogota");
  assert.equal(d.departamentoDeRegionMeta("Distrito Especial Department"), "bogota");
  assert.equal(d.departamentoDeRegionMeta("Valle del Cauca"), "valle-del-cauca");
  assert.equal(d.departamentoDeRegionMeta("Unknown"), null);
  assert.equal(d.departamentoDeRegionMeta("Florida"), null);
  assert.equal(d.departamentoDeRegionMeta(""), null);
});

await prueba("teléfono: solo el fijo 601 dice el departamento; celulares y otros, null", () => {
  assert.equal(d.departamentoDeTelefono("6012345678"), "bogota");
  assert.equal(d.departamentoDeTelefono("+57 601 234 5678"), "bogota");
  assert.equal(d.departamentoDeTelefono("6018512345"), "cundinamarca");
  assert.equal(d.departamentoDeTelefono("573001112233"), null, "celular");
  assert.equal(d.departamentoDeTelefono("6024441122"), null, "602 cubre varios departamentos");
  assert.equal(d.departamentoDeTelefono("123"), null);
  assert.equal(d.departamentoDeTelefono(null), null);
});

await prueba("sumas por departamento: cuadran con el total, contando 'sin-ubicar' y 'otras-regiones'", () => {
  const filas = [
    { regionMeta: "Valle del Cauca Department", gasto: 120_000.5 },
    { regionMeta: "Chocó Department", gasto: 80_000 },
    { regionMeta: "Florida", gasto: 5_000 },
    { departamento: "valle-del-cauca", chats: 3, ventas: 1, valorVendido: 989_000 },
    { departamento: "choco", chats: 2 },
    { departamento: null, chats: 4, ventas: 1, valorVendido: 1_200_000 },
    { departamento: "no-es-clave", chats: 1 },
    { departamento: "bogota", ventas: null, valorVendido: undefined },
  ];
  const r = m.sumarPorDepartamento(filas);
  assert.equal(r.departamentos.length, 33, "aparecen todos, aunque estén en 0");
  const valle = r.departamentos.find((x) => x.clave === "valle-del-cauca");
  assert.deepEqual({ ...valle }, { clave: "valle-del-cauca", nombre: "Valle del Cauca", gasto: 120_000.5, chats: 3, ventas: 1, valorVendido: 989_000 });
  const choco = r.departamentos.find((x) => x.clave === "choco");
  assert.equal(choco.gasto, 80_000);
  assert.equal(choco.chats, 2);
  assert.equal(r.otrasRegiones.gasto, 5_000, "región rara de Meta");
  assert.equal(r.sinUbicar.chats, 5, "sin departamento o con una clave que no existe");
  assert.equal(r.sinUbicar.ventas, 1);
  for (const campo of ["gasto", "chats", "ventas", "valorVendido"]) {
    const suma = [...r.departamentos, r.sinUbicar, r.otrasRegiones].reduce((s, x) => s + x[campo], 0);
    assert.equal(Math.round(suma * 100) / 100, r.total[campo], campo);
  }
  assert.deepEqual({ ...r.total }, { gasto: 205_000.5, chats: 10, ventas: 2, valorVendido: 2_189_000 });
  const vacio = m.sumarPorDepartamento([]);
  assert.deepEqual({ ...vacio.total }, { gasto: 0, chats: 0, ventas: 0, valorVendido: 0 });
});

await prueba("regla del rojo: gasto sin ventas con datos suficientes", () => {
  assert.equal(m.DIAS_ROJO, 60);
  assert.equal(m.esRojo({ gasto60d: 150_000, ventas60d: 0, datosSuficientes: true }), true, "gasta y no vende");
  assert.equal(m.esRojo({ gasto60d: 0, ventas60d: 0, datosSuficientes: true }), false, "sin gasto");
  assert.equal(m.esRojo({ gasto60d: null, ventas60d: 0, datosSuficientes: true }), false, "gasto desconocido");
  assert.equal(m.esRojo({ gasto60d: 150_000, ventas60d: 1, datosSuficientes: true }), false, "con una venta");
  assert.equal(m.esRojo({ gasto60d: 150_000, ventas60d: 0, datosSuficientes: false }), false, "sin datos suficientes");
});

await prueba("venta: manda Gestión; si falta, la ciudad del chat; por último el teléfono", () => {
  assert.equal(m.departamentoDeVenta({ departamentoGestion: "Chocó", ciudadGestion: "Cali", ciudadChat: "Medellín", telefono: "6012345678" }), "choco");
  assert.equal(m.departamentoDeVenta({ departamentoGestion: "valle-del-cauca", ciudadChat: "Quibdó" }), "valle-del-cauca", "la clave también sirve");
  assert.equal(m.departamentoDeVenta({ departamentoGestion: null, ciudadGestion: "Istmina", ciudadChat: "Cali" }), "choco", "ciudad de Gestión");
  assert.equal(m.departamentoDeVenta({ departamentoGestion: "", ciudadGestion: null, ciudadChat: "Cali", telefono: "6012345678" }), "valle-del-cauca", "ciudad del chat");
  assert.equal(m.departamentoDeVenta({ departamentoGestion: "No sé", ciudadChat: "Quibdó" }), "choco", "Gestión trae algo que no se reconoce");
  assert.equal(m.departamentoDeVenta({ ciudadChat: null, telefono: "+57 601 234 5678" }), "bogota", "teléfono fijo");
  assert.equal(m.departamentoDeVenta({ telefono: "3001112233" }), null, "celular: sin ubicar");
  assert.equal(m.departamentoDeVenta({}), null);
});

await prueba("rango del mes en hora de Colombia", () => {
  const oct = m.rangoDelMes("2026-10");
  assert.equal(oct.desde, "2026-10-01");
  assert.equal(oct.hasta, "2026-10-31");
  assert.equal(oct.desdeFecha.toISOString(), "2026-10-01T05:00:00.000Z");
  assert.equal(oct.hastaFecha.toISOString(), "2026-11-01T05:00:00.000Z");
  const dic = m.rangoDelMes("2026-12");
  assert.equal(dic.hasta, "2026-12-31");
  assert.equal(dic.hastaFecha.toISOString(), "2027-01-01T05:00:00.000Z");
  assert.equal(m.rangoDelMes("2028-02").hasta, "2028-02-29", "año bisiesto");
  assert.equal(m.rangoDelMes("2026-13"), null);
  assert.equal(m.rangoDelMes("octubre"), null);
});

await prueba("ventas de Gestión: lee ciudad y departamento opcionales y no agrega otro método HTTP", () => {
  const fuente = fs.readFileSync(`${RAIZ}/src/features/pauta/servicios/ventas-de-gestion.ts`, "utf8");
  assert.match(fuente, /ciudad\?: string \| null;/);
  assert.match(fuente, /departamento\?: string \| null;/);
  assert.match(fuente, /typeof v\.ciudad === "string"/);
  assert.match(fuente, /typeof v\.departamento === "string"/);
  const metodos = [...fuente.matchAll(/method:\s*"([A-Z]+)"/g)].map((x) => x[1]);
  assert.deepEqual(metodos, ["GET"], "solo lee de Gestión");
  for (const archivo of ["departamentos.ts", "mapa.ts"]) {
    const codigo = fs.readFileSync(`${RAIZ}/src/features/pauta/dominio/${archivo}`, "utf8");
    assert.doesNotMatch(codigo, /@\/lib\/prisma|fetch\(/, `${archivo} es puro`);
  }
});

/* ------------------------------------------------------------------ la lectura del mapa (parte 2) */

const sinComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

await prueba("meta-ads-lectura.ts solo usa GET y lee el gasto por región con breakdowns=region", () => {
  const fuente = sinComentarios(fs.readFileSync(`${RAIZ}/src/features/pauta/servicios/meta-ads-lectura.ts`, "utf8"));
  const metodos = [...fuente.matchAll(/method:\s*["']([A-Za-z]+)["']/g)].map((x) => x[1]);
  assert.deepEqual(metodos, ["GET"], "un solo fetch y es GET");
  assert.doesNotMatch(fuente, /\b(POST|PUT|PATCH|DELETE)\b/);
  assert.match(fuente, /export async function leerGastoPorRegion\(desde: string, hasta: string\)/);
  assert.match(fuente, /breakdowns: "region"/);
  assert.match(fuente, /fields: "spend"/);
});

await prueba("leer-mapa.ts no escribe en Prisma", () => {
  const fuente = sinComentarios(fs.readFileSync(`${RAIZ}/src/features/pauta/servicios/leer-mapa.ts`, "utf8"));
  assert.doesNotMatch(fuente, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
  assert.doesNotMatch(fuente, /\$executeRaw|\$queryRaw|\$transaction/);
  assert.doesNotMatch(fuente, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
});

await prueba("numeros_de_marketing declara por_departamento y mes", () => {
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/agentes-de-area.ts`, "utf8");
  const inicio = fuente.indexOf('name: "numeros_de_marketing"');
  const bloque = fuente.slice(inicio, fuente.indexOf('name: "agente_de_marketing"'));
  assert.ok(inicio > 0);
  assert.match(bloque, /por_departamento: \{ type: "boolean"/);
  assert.match(bloque, /mes: \{ type: "string"/);
  assert.match(bloque, /resumen_para_decir/, "la descripción dice que trae la frase");
});

// Base de mentira: solo lee. Cualquier otro método rompe la prueba.
const db = { origenes: [], ventas: [], contactos: [], gestion: null, falla: new Set() };
const leerDe = (tabla, filas) => ({
  findMany: async ({ where }) => {
    if (db.falla.has(tabla)) throw new Error(`base caída (${tabla})`);
    return filas(where);
  },
});
const enRango = (fecha, rango) => fecha >= rango.gte && fecha < rango.lt;
const prisma = {
  origenDePauta: leerDe("origenes", (where) => db.origenes.filter((o) => enRango(o.llegoEn, where.llegoEn))),
  ventaDePauta: leerDe("ventas", (where) => db.ventas.filter((v) => enRango(v.pagadaEn, where.pagadaEn))),
  contact: leerDe("contactos", (where) => {
    const ids = new Set(where.id?.in ?? where.OR?.[0]?.id?.in ?? []);
    const telefonos = new Set(where.OR?.[1]?.phoneNumber?.in ?? []);
    return db.contactos.filter((c) => ids.has(c.id) || telefonos.has(c.phoneNumber));
  }),
};
const lm = cargar("src/features/pauta/servicios/leer-mapa.ts", {
  "@/lib/prisma": { prisma },
  "@/lib/sincronizacion-gestion": { leerConexionConGestion: async () => null },
});

await prueba("armarMapa: porcentaje del gasto, rojo de 60 días y fuentes no disponibles en null", () => {
  const r = lm.armarMapa({
    mes: "2026-10", desde: "2026-10-01", hasta: "2026-10-31", rojoDesde: "2026-09-02", rojoHasta: "2026-10-31",
    gasto: [{ regionMeta: "Valle del Cauca Department", gasto: 750 }, { regionMeta: "Chocó Department", gasto: 250 }],
    chats: null,
    ventas: [{ departamento: "valle-del-cauca", ventas: 1, valorVendido: 989_000 }],
    gasto60d: [{ regionMeta: "Valle del Cauca Department", gasto: 2_000 }, { regionMeta: "Chocó Department", gasto: 900 }, { regionMeta: "Texas", gasto: 10 }],
    ventas60d: [{ departamento: "valle-del-cauca", ventas: 2 }],
  });
  assert.equal(r.departamentos.length, 33);
  const valle = r.departamentos.find((x) => x.clave === "valle-del-cauca");
  const choco = r.departamentos.find((x) => x.clave === "choco");
  assert.equal(valle.porcentajeDelGasto, 75);
  assert.equal(choco.porcentajeDelGasto, 25);
  assert.equal(valle.chats, null, "chats no disponible: null, no 0");
  assert.equal(r.totales.chats, null);
  assert.equal(choco.rojo, true, "gastó en 60 días y no vendió");
  assert.equal(valle.rojo, false);
  assert.equal(r.otrasRegiones.rojo, false, "otras regiones nunca es rojo");
  assert.equal(r.departamentos.find((x) => x.clave === "bogota").rojo, false, "sin gasto no es rojo");
  assert.deepEqual({ ...r.fuentes }, { gasto: "ok", chats: "no disponible", ventas: "ok", gasto60d: "ok", ventas60d: "ok" });
  const sinGasto60 = lm.armarMapa({ mes: "2026-10", desde: "2026-10-01", hasta: "2026-10-31", rojoDesde: "x", rojoHasta: "y", gasto: null, chats: [], ventas: [], gasto60d: null, ventas60d: [] });
  assert.equal(sinGasto60.departamentos.some((x) => x.rojo), false, "sin datos suficientes no hay rojo");
  assert.equal(sinGasto60.rojo.datosSuficientes, false);
});

await prueba("armarMapa: avisa si quedaron muchas ventas sin ubicar", () => {
  const base = { mes: "2026-10", desde: "2026-10-01", hasta: "2026-10-31", rojoDesde: "x", rojoHasta: "y", gasto: [], chats: [], gasto60d: [], ventas60d: [] };
  const muchas = lm.armarMapa({ ...base, ventas: [{ departamento: "choco", ventas: 1 }, { departamento: null, ventas: 1 }] });
  assert.equal(muchas.sinUbicar.ventas, 1);
  assert.match(muchas.aviso, /^1 de 2 ventas sin ubicar \(50 %\)/);
  assert.equal(lm.PORCIENTO_AVISO_SIN_UBICAR, 20, "la meta es menos de 2 de cada 10");
  const justo = lm.armarMapa({ ...base, ventas: [{ departamento: "choco", ventas: 4 }, { departamento: null, ventas: 1 }] });
  assert.match(justo.aviso, /^1 de 5 ventas sin ubicar \(20 %\)/, "desde 2 de cada 10 se avisa");
  const pocas = lm.armarMapa({ ...base, ventas: [{ departamento: "choco", ventas: 5 }, { departamento: null, ventas: 1 }] });
  assert.equal(pocas.aviso, null, "16,7 % no alcanza el aviso");
});

await prueba("resumenParaDecir: los 3 departamentos con más ventas, el % del gasto de Valle y los rojos", () => {
  const r = lm.armarMapa({
    mes: "2026-10", desde: "2026-10-01", hasta: "2026-10-31", rojoDesde: "x", rojoHasta: "y",
    gasto: [{ regionMeta: "Valle del Cauca Department", gasto: 600 }, { regionMeta: "Chocó Department", gasto: 400 }],
    chats: [],
    ventas: [
      { departamento: "valle-del-cauca", ventas: 3 }, { departamento: "bogota", ventas: 2 }, { departamento: "antioquia", ventas: 1 },
      { departamento: "cauca", ventas: 1, valorVendido: 1 }, { departamento: null, ventas: 1 },
    ],
    gasto60d: [{ regionMeta: "Chocó Department", gasto: 400 }],
    ventas60d: [],
  });
  const frase = lm.resumenParaDecir(r);
  assert.match(frase, /^En octubre de 2026 hubo 8 ventas; vienen sobre todo de Valle del Cauca \(3\), Bogotá D\.C\. \(2\) y Cauca \(1\)\./);
  assert.match(frase, /1 sin ubicar\./);
  assert.match(frase, /Valle del Cauca se lleva el 60 % del gasto de Meta\./);
  assert.match(frase, /En rojo \(gastan y no venden en 60 días\): Chocó\./);
  const vacio = lm.armarMapa({ mes: "2026-11", desde: "", hasta: "", rojoDesde: "", rojoHasta: "", gasto: null, chats: null, ventas: null, gasto60d: null, ventas60d: null });
  assert.equal(lm.resumenParaDecir(vacio), "En noviembre de 2026 no se pudieron leer las ventas. El gasto de Meta no está disponible.");
});

await prueba("leerMapa: sin llave de Meta el gasto sale 'no disponible'; chats y ventas se ubican por ciudad y teléfono", async () => {
  delete process.env.META_ADS_ACCESS_TOKEN;
  const mes = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 7);
  const dentro = new Date(`${mes}-01T12:00:00-05:00`);
  db.origenes = [
    { contactId: "c1", llegoEn: dentro },
    { contactId: "c2", llegoEn: dentro },
    { contactId: "c3", llegoEn: dentro },
    { contactId: "c4", llegoEn: new Date("2020-01-05T12:00:00-05:00") },
  ];
  db.contactos = [
    { id: "c1", phoneNumber: "573001112233", metadata: { city: "Quibdó" } },
    { id: "c2", phoneNumber: "6012345678", metadata: {} },
    { id: "c3", phoneNumber: "573009998877", metadata: null },
    { id: "c5", phoneNumber: "573105554433", metadata: { city: "Cali" } },
  ];
  db.ventas = [
    { ventaGestionId: "V1", telefono: "3001112233", monto: 989_000, contactId: null, pagadaEn: dentro },
    { ventaGestionId: "V2", telefono: "+57 310 555 4433", monto: 500_000, contactId: null, pagadaEn: dentro },
    { ventaGestionId: "V3", telefono: "3200000000", monto: null, contactId: null, pagadaEn: dentro },
  ];
  const r = await lm.leerMapa("ws1", { mes });
  assert.equal(r.mes, mes);
  assert.equal(r.fuentes.gasto, "no disponible");
  assert.equal(r.motivoSinGasto, "sin llave", "sin llave no culpa a Meta");
  assert.equal(r.fuentes.gasto60d, "no disponible");
  assert.equal(r.totales.gasto, null);
  assert.equal(r.fuentes.chats, "ok");
  assert.equal(r.totales.chats, 3, "solo los chats del mes");
  const por = (clave) => r.departamentos.find((x) => x.clave === clave);
  assert.equal(por("choco").chats, 1, "por la ciudad");
  assert.equal(por("bogota").chats, 1, "sin ciudad: por el teléfono fijo");
  assert.equal(r.sinUbicar.chats, 1);
  assert.equal(por("choco").ventas, 1, "venta cruzada por teléfono con la ciudad del chat");
  assert.equal(por("choco").valorVendido, 989_000);
  assert.equal(por("valle-del-cauca").ventas, 1);
  assert.equal(r.sinUbicar.ventas, 1);
  assert.equal(r.totales.ventas, 3);
  assert.equal(r.departamentos.some((x) => x.rojo), false, "sin gasto de Meta no se marca rojo");
  await assert.rejects(lm.leerMapa("ws1", { mes: "octubre" }), /AAAA-MM/);
  await assert.rejects(lm.leerMapa("ws1", { mes: "2999-01" }), /todavía no empieza/);
});

await prueba("leerMapa: si la base falla, esa fuente sale 'no disponible' y el resto sale igual", async () => {
  db.falla = new Set(["origenes"]);
  const r = await lm.leerMapa("ws1", {});
  assert.equal(r.fuentes.chats, "no disponible");
  assert.equal(r.fuentes.ventas, "ok");
  assert.equal(r.totales.ventas, 3);
  db.falla = new Set(["origenes", "ventas", "contactos"]);
  const nada = await lm.leerMapa("ws1", {});
  assert.deepEqual({ ...nada.fuentes }, { gasto: "no disponible", chats: "no disponible", ventas: "no disponible", gasto60d: "no disponible", ventas60d: "no disponible" });
  assert.equal(nada.departamentos.length, 33);
  db.falla = new Set();
});

/* ------------------------------------------------------------------ Meta Ads: motivo y Meta falso */

const meta = cargar("src/features/pauta/servicios/meta-ads-lectura.ts");
const fetchReal = globalThis.fetch;
const warnReal = console.warn;
const LLAVE = "llave-de-prueba-123";
const llamadasAMeta = [];
let respuestaDeMeta = () => new Response("{}", { status: 200 });
const fetchFalso = async (url, opciones) => {
  llamadasAMeta.push({ url: String(url), metodo: opciones?.method, auth: opciones?.headers?.Authorization });
  return respuestaDeMeta(new URL(String(url)));
};
const conMetaFalso = async (fn) => {
  process.env.META_ADS_ACCESS_TOKEN = LLAVE;
  process.env.META_ADS_ACCOUNT_ID = "392437484223294";
  globalThis.fetch = fetchFalso;
  const avisos = [];
  console.warn = (...args) => avisos.push(args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try {
    await fn(avisos);
  } finally {
    globalThis.fetch = fetchReal;
    console.warn = warnReal;
    delete process.env.META_ADS_ACCESS_TOKEN;
    delete process.env.META_ADS_ACCOUNT_ID;
  }
};

await prueba("Meta Ads: sin llave el motivo es 'sin llave' y no se llama a Meta", async () => {
  delete process.env.META_ADS_ACCESS_TOKEN;
  delete process.env.META_ADS_ACCOUNT_ID;
  globalThis.fetch = fetchFalso;
  llamadasAMeta.length = 0;
  try {
    assert.deepEqual({ ...(await meta.leerGastoPorRegion("2026-10-01", "2026-10-30")) }, { estado: "no disponible", motivo: "sin llave" });
    assert.equal(llamadasAMeta.length, 0);
  } finally {
    globalThis.fetch = fetchReal;
  }
});

await prueba("Meta Ads: si Meta contesta 400, el motivo es 'meta fallo', no lanza y el log trae el mensaje de Meta sin la llave", async () => {
  await conMetaFalso(async (avisos) => {
    llamadasAMeta.length = 0;
    respuestaDeMeta = () =>
      new Response(JSON.stringify({ error: { message: "(#100) Invalid parameter", type: "OAuthException", code: 100 } }), { status: 400 });
    const r = await meta.leerGastoPorRegion("2026-10-01", "2026-10-30");
    assert.deepEqual({ ...r }, { estado: "no disponible", motivo: "meta fallo" });
    assert.equal(llamadasAMeta.length, 1);
    assert.ok(avisos.some((a) => a.includes("400") && a.includes("(#100) Invalid parameter") && a.includes("OAuthException")), avisos.join("\n"));
    assert.ok(avisos.every((a) => !a.includes(LLAVE)), "la llave no va al log");
    // Meta que no contesta (red caída): mismo motivo, tampoco lanza.
    respuestaDeMeta = () => {
      throw new TypeError("fetch failed");
    };
    assert.deepEqual({ ...(await meta.leerGastoPorRegion("2026-10-01", "2026-10-30")) }, { estado: "no disponible", motivo: "meta fallo" });
    const mapa = await lm.leerMapa("ws1", { mes: "2026-10" });
    assert.equal(mapa.fuentes.gasto, "no disponible");
    assert.equal(mapa.motivoSinGasto, "meta fallo");
  });
});

await prueba("Meta Ads: octubre de 2026 con Meta falso: Valle del Cauca y 'Distrito Especial' quedan en Valle y Bogotá, solo con GET", async () => {
  await conMetaFalso(async () => {
    llamadasAMeta.length = 0;
    respuestaDeMeta = (url) => {
      assert.equal(url.pathname, "/v21.0/act_392437484223294/insights");
      assert.equal(url.searchParams.get("breakdowns"), "region");
      return new Response(
        JSON.stringify({
          data: [
            { region: "Valle del Cauca", spend: "381596" },
            { region: "Antioquia", spend: "81896" },
            { region: "Distrito Especial", spend: "51519" },
            { region: "Unknown", spend: "1000" },
          ],
        }),
        { status: 200 },
      );
    };
    const r = await lm.leerMapa("ws1", { mes: "2026-10" });
    assert.ok(llamadasAMeta.length >= 2, "el mes y los 60 días del rojo");
    assert.ok(llamadasAMeta.every((l) => l.metodo === "GET"), "a Meta solo se le hacen GET");
    assert.ok(llamadasAMeta.every((l) => l.auth === `Bearer ${LLAVE}` && !l.url.includes(LLAVE)), "la llave va en la cabecera, no en la URL");
    const mesPedido = new URL(llamadasAMeta[0].url).searchParams.get("time_range");
    assert.deepEqual(JSON.parse(mesPedido), { since: "2026-10-01", until: "2026-10-31" });
    assert.equal(r.fuentes.gasto, "ok");
    assert.equal(r.motivoSinGasto, null);
    const por = (clave) => r.departamentos.find((x) => x.clave === clave);
    assert.equal(por("valle-del-cauca").gasto, 381_596);
    assert.equal(por("bogota").gasto, 51_519, "Distrito Especial es Bogotá");
    assert.equal(por("antioquia").gasto, 81_896);
    assert.equal(r.otrasRegiones.gasto, 1_000, "solo lo que no es un departamento");
    assert.equal(Math.max(...r.departamentos.map((x) => x.gasto ?? 0)), por("valle-del-cauca").gasto, "Valle es el más oscuro");
    assert.ok(por("valle-del-cauca").porcentajeDelGasto > 70);
  });
  respuestaDeMeta = () => new Response("{}", { status: 200 });
});

await prueba("pantalla: título, una línea, mes en palabras, avisos abajo y leyenda de una línea", () => {
  const ui = { Button: () => null, Card: () => null, CardContent: () => null, CardHeader: () => null, CardTitle: () => null, NativeSelect: () => null, NativeSelectOption: () => null };
  const c = cargar("src/features/pauta/components/mapa-colombia.tsx", {
    "next/navigation": { usePathname: () => "/", useRouter: () => ({}) },
    "@/components/ui/button": ui,
    "@/components/ui/card": ui,
    "@/components/ui/native-select": ui,
  });
  assert.equal(c.mesEnPalabras("2026-10"), "octubre de 2026");
  assert.equal(c.mesEnPalabras("2027-01"), "enero de 2027");
  assert.equal(c.mesEnPalabras("raro"), "raro");
  const componente = fs.readFileSync(`${RAIZ}/src/features/pauta/components/mapa-colombia.tsx`, "utf8");
  assert.ok(componente.includes("Más oscuro = más gasto. Rojo = gastó y no vendió. Toca un departamento."));
  assert.ok(componente.includes('<h1 className="text-lg font-semibold">Mapa de Colombia</h1>'));
  assert.ok(!componente.includes("Meta Ads no respondió"), "ya no culpa a Meta sin razón");
  assert.ok(componente.includes("Falta la llave de Meta Ads") && componente.includes("Meta Ads no contestó"));
  assert.ok(!/mapa\.(desde|hasta)|mapa\.rojo\.(desde|hasta)/.test(componente), "ninguna fecha AAAA-MM-DD en pantalla");
  assert.ok(componente.includes("{mesEnPalabras(mes)}"), "el selector dice el mes en palabras");
  assert.ok(componente.includes("Sin gasto") && componente.includes("Más gasto") && componente.includes("Rojo: gastó y no vendió"), "leyenda");
  // Los avisos van después del mapa, no encima.
  assert.ok(componente.indexOf("avisos.map(") > componente.indexOf("<svg viewBox={VIEWBOX}"));
});

await prueba("pantalla: un contorno por departamento (mismas claves), dentro del dibujo y San Andrés en su recuadro", () => {
  const f = cargar("src/features/pauta/components/mapa-colombia-formas.ts");
  assert.deepEqual(Object.keys(f.FORMAS_DE_DEPARTAMENTOS).sort(), d.DEPARTAMENTOS.map((x) => x.clave).sort());
  const [, , ancho, alto] = f.VIEWBOX.split(" ").map(Number);
  for (const [clave, camino] of Object.entries(f.FORMAS_DE_DEPARTAMENTOS)) {
    assert.match(camino, /^M[\d LMZ]+Z$/, clave);
    const numeros = camino.match(/\d+/g).map(Number);
    for (let i = 0; i < numeros.length; i += 2) {
      assert.ok(numeros[i] >= 0 && numeros[i] <= ancho && numeros[i + 1] >= 0 && numeros[i + 1] <= alto, `${clave} se sale del dibujo`);
    }
  }
  const r = f.RECUADRO_SAN_ANDRES;
  const sanAndres = f.FORMAS_DE_DEPARTAMENTOS["san-andres"].match(/\d+/g).map(Number);
  for (let i = 0; i < sanAndres.length; i += 2) {
    assert.ok(sanAndres[i] > r.x && sanAndres[i] < r.x + r.ancho && sanAndres[i + 1] > r.y && sanAndres[i + 1] < r.y + r.alto, "San Andrés va dentro del recuadro");
  }
});

await prueba("pantalla: solo jefes, lee ?mes= con leerMapa y queda en el menú de Dirección después de Pauta", () => {
  const pagina = fs.readFileSync(`${RAIZ}/src/app/cliente/direccion/mapa-colombia/page.tsx`, "utf8");
  assert.ok(pagina.includes("esJefeDelNegocio(access)") && pagina.includes("redirect("), "misma protección que Pauta");
  assert.ok(pagina.includes("leerMapa(access.workspaceId, { mes: texto(params.mes) })"));
  const componente = fs.readFileSync(`${RAIZ}/src/features/pauta/components/mapa-colombia.tsx`, "utf8");
  assert.ok(componente.startsWith('"use client";'));
  assert.ok(componente.includes("?mes=") && componente.includes("fill-destructive"));
  const nav = fs.readFileSync(`${RAIZ}/src/components/nav-direccion.tsx`, "utf8");
  assert.ok(nav.includes('{ title: "Mapa de Colombia", view: "mapa-colombia", icon: MapIcon }'));
  assert.ok(nav.indexOf('view: "pauta"') < nav.indexOf('view: "mapa-colombia"') && nav.indexOf('view: "mapa-colombia"') < nav.indexOf('view: "recuperacion"'));
});

console.log(`\n${pruebas} pruebas del mapa de Colombia OK`);
