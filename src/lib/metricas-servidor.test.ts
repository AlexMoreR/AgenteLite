import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { puedeVerDireccion } from "./permisos-del-crm";
import {
  FOTOS_PARA_ALERTA_CONSULTAS,
  SEGUNDOS_CONSULTA_LENTA,
  TITULO_AVISO_CONSULTAS_LENTAS,
  estadoTarjetaConsultas,
  evaluarConsultasLentas,
  resumirConsulta,
  resumirConsultas,
  textoDeAlertaConsultas,
} from "./metricas-servidor";
import {
  CAMPOS_PANEL,
  agruparContenedores,
  armarPanelServidor,
  inicioDelPanel,
  leerContenedores,
  ordenarContenedoresPorCpu,
  seriePanelServidor,
  colorCpu,
  colorDisco,
  colorMemoria,
  cpuDeLaBase,
  cpuEfectivo,
  evaluarAlerta,
  MUESTRAS_PARA_ALERTA_BASE,
  UMBRAL_CPU_BASE_ALERTA,
  grupoDelContenedor,
  textoDeAlerta,
  textoDeAlertaBase,
  validarMuestra,
  type ContenedorMuestra,
  type EstadoAlertaCpu,
  type FotoPanel,
  type MuestraServidor,
} from "./metricas-servidor";

const INICIO = new Date("2026-11-11T12:00:00.000Z");

function minutosDespues(minutos: number): Date {
  return new Date(INICIO.getTime() + minutos * 60_000);
}

function muestra(cambios: Partial<MuestraServidor> = {}): MuestraServidor {
  return {
    cpuTotal: 92,
    load1: 3,
    nucleos: 4,
    memUsadaMb: 12_595,
    memTotalMb: 16_384,
    swapUsadoMb: 0,
    discoUsadoGb: 150,
    discoTotalGb: 193,
    contenedores: [],
    ...cambios,
  };
}

test("colorCpu: verde < 60, amarillo 60–85, rojo > 85", () => {
  assert.equal(colorCpu(0), "verde");
  assert.equal(colorCpu(59.9), "verde");
  assert.equal(colorCpu(60), "amarillo");
  assert.equal(colorCpu(85), "amarillo");
  assert.equal(colorCpu(85.1), "rojo");
});

test("colorMemoria y colorDisco: verde < 75, amarillo 75–90, rojo > 90", () => {
  for (const color of [colorMemoria, colorDisco]) {
    assert.equal(color(74.9), "verde");
    assert.equal(color(75), "amarillo");
    assert.equal(color(90), "amarillo");
    assert.equal(color(90.1), "rojo");
  }
});

test("grupoDelContenedor: cada nombre de ejemplo cae en su grupo", () => {
  const casos: Array<[string, string]> = [
    ["crm-aizenbot_app", "CRM"],
    ["crm-aizenbot_app.1.k3j2h1", "CRM"],
    ["crm-realtime", "CRM"],
    ["aizen-files", "CRM"],
    ["crm-crons", "CRM"],
    ["mf7", "Marketplace"],
    ["mf10-web", "Marketplace"],
    ["tienda_mf12_app", "Marketplace"],
    ["mf1", "Otros"],
    ["mf13", "Otros"],
    ["mf70", "Otros"],
    ["crm-postgres", "Base"],
    ["crm-postgres-1", "Base"],
    ["crm-waha", "WAHA"],
    ["crm-waha-2", "WAHA"],
    ["waha2", "WAHA"],
    ["waha", "Otros"],
    ["traefik", "Otros"],
    ["", "Otros"],
  ];
  for (const [nombre, grupo] of casos) {
    assert.equal(grupoDelContenedor(nombre), grupo, nombre);
  }
});

test("cpuEfectivo: el mayor entre CPU total y load1/nucleos×100", () => {
  assert.equal(cpuEfectivo({ cpuTotal: 40, load1: 6, nucleos: 4 }), 150);
  assert.equal(cpuEfectivo({ cpuTotal: 70, load1: 1, nucleos: 4 }), 70);
  assert.equal(cpuEfectivo({ cpuTotal: 70, load1: 9, nucleos: null }), 70);
});

const SIN_ALERTA: EstadoAlertaCpu = { activa: false, ultimoEnvio: null };

test("alerta: 4 fotos altas no mandan y 5 sí", () => {
  const cuatro = evaluarAlerta({ ultimasCpu: [90, 90, 90, 90], estado: SIN_ALERTA, ahora: INICIO });
  assert.equal(cuatro.mandar, false);
  assert.deepEqual(cuatro.estadoNuevo, SIN_ALERTA);

  // 4 altas y la 5.ª (más vieja) en 85 exacto: no cuenta como alta.
  const conBorde = evaluarAlerta({ ultimasCpu: [90, 90, 90, 90, 85], estado: SIN_ALERTA, ahora: INICIO });
  assert.equal(conBorde.mandar, false);

  const cinco = evaluarAlerta({ ultimasCpu: [90, 90, 90, 90, 90], estado: SIN_ALERTA, ahora: INICIO });
  assert.equal(cinco.mandar, true);
  assert.deepEqual(cinco.estadoNuevo, { activa: true, ultimoEnvio: INICIO.toISOString() });
});

test("alerta: enfriamiento, la 6.ª foto alta a los 10 min no manda y a los 61 min sí", () => {
  const primera = evaluarAlerta({ ultimasCpu: [90, 90, 90, 90, 90], estado: SIN_ALERTA, ahora: INICIO });
  assert.equal(primera.mandar, true);

  const seis = [90, 90, 90, 90, 90, 90];
  const a10 = evaluarAlerta({ ultimasCpu: seis, estado: primera.estadoNuevo, ahora: minutosDespues(10) });
  assert.equal(a10.mandar, false);
  assert.deepEqual(a10.estadoNuevo, primera.estadoNuevo);

  const a61 = evaluarAlerta({ ultimasCpu: seis, estado: a10.estadoNuevo, ahora: minutosDespues(61) });
  assert.equal(a61.mandar, true);
  assert.deepEqual(a61.estadoNuevo, { activa: true, ultimoEnvio: minutosDespues(61).toISOString() });
});

test("alerta: si baja de 85 % se recupera y otras 5 altas vuelven a mandar", () => {
  const primera = evaluarAlerta({ ultimasCpu: [90, 90, 90, 90, 90], estado: SIN_ALERTA, ahora: INICIO });
  assert.equal(primera.mandar, true);

  const baja = evaluarAlerta({
    ultimasCpu: [50, 90, 90, 90, 90, 90],
    estado: primera.estadoNuevo,
    ahora: minutosDespues(5),
  });
  assert.equal(baja.mandar, false);
  assert.equal(baja.estadoNuevo.activa, false);

  // Antes de las 5 nuevas no manda.
  const tres = evaluarAlerta({ ultimasCpu: [95, 95, 95, 50, 90], estado: baja.estadoNuevo, ahora: minutosDespues(8) });
  assert.equal(tres.mandar, false);

  // Otras 5 altas, a los 15 min (menos de 60): vuelve a mandar porque la alerta estaba inactiva.
  const otraVez = evaluarAlerta({
    ultimasCpu: [95, 95, 95, 95, 95, 50],
    estado: tres.estadoNuevo,
    ahora: minutosDespues(15),
  });
  assert.equal(otraVez.mandar, true);
  assert.equal(otraVez.estadoNuevo.activa, true);
});

test("textoDeAlerta: top 3 por CPU ordenado, con grupo, memoria y disco", () => {
  const texto = textoDeAlerta(
    muestra({
      contenedores: [
        { nombre: "traefik", grupo: "Otros", cpu: 2, memMb: 40, memLimiteMb: null },
        { nombre: "crm-postgres", grupo: "Base", cpu: 55.4, memMb: 2000, memLimiteMb: 4096 },
        { nombre: "crm-aizenbot_app", grupo: "CRM", cpu: 140.2, memMb: 1500, memLimiteMb: null },
        { nombre: "mf8", grupo: "Marketplace", cpu: 30, memMb: 300, memLimiteMb: null },
      ],
    }),
  );
  const lineas = texto.split("\n");
  assert.match(lineas[0], /CPU alta: 92 %/);
  assert.equal(lineas[2], "1. crm-aizenbot_app: 140 % (CRM)");
  assert.equal(lineas[3], "2. crm-postgres: 55 % (Base)");
  assert.equal(lineas[4], "3. mf8: 30 % (Marketplace)");
  assert.ok(!texto.includes("traefik"), "solo el top 3");
  assert.ok(texto.includes("Memoria: 12,3 de 16,0 GB"), texto);
  assert.ok(texto.includes("Disco: 150 de 193 GB"), texto);
});

test("validarMuestra: normaliza y le pone grupo al contenedor que no lo trae", () => {
  const resultado = validarMuestra({
    cpuTotal: 40.5,
    load1: 1.2,
    nucleos: 4,
    memUsadaMb: 1000.6,
    memTotalMb: 16384,
    swapUsadoMb: 0,
    discoUsadoGb: 100,
    discoTotalGb: 193,
    extra: "se descarta",
    contenedores: [
      { nombre: " crm-waha ", cpu: 3, memMb: 200.4 },
      { nombre: "otro", grupo: "CRM", cpu: 1, memMb: 10, memLimiteMb: 512 },
      { nombre: "mf9", grupo: "Inventado", cpu: 1, memMb: 10 },
    ],
  });
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.muestra.memUsadaMb, 1001);
  assert.equal("extra" in resultado.muestra, false);
  assert.deepEqual(resultado.muestra.contenedores, [
    { nombre: "crm-waha", grupo: "WAHA", cpu: 3, memMb: 200, memLimiteMb: null },
    { nombre: "otro", grupo: "CRM", cpu: 1, memMb: 10, memLimiteMb: 512 },
    { nombre: "mf9", grupo: "Marketplace", cpu: 1, memMb: 10, memLimiteMb: null },
  ]);
});

test("validarMuestra: rechaza un cuerpo roto", () => {
  const bueno = {
    cpuTotal: 10,
    load1: 0.5,
    memUsadaMb: 100,
    memTotalMb: 1000,
    swapUsadoMb: 0,
    discoUsadoGb: 1,
    discoTotalGb: 10,
    contenedores: [],
  };
  assert.equal(validarMuestra(bueno).ok, true);

  const rotos: unknown[] = [
    null,
    "texto",
    [],
    { ...bueno, cpuTotal: -1 },
    { ...bueno, cpuTotal: "10" },
    { ...bueno, memTotalMb: undefined },
    { ...bueno, discoUsadoGb: Number.NaN },
    { ...bueno, memTotalMb: 3_000_000_000 },
    { ...bueno, nucleos: 0 },
    { ...bueno, nucleos: 2.5 },
    { ...bueno, contenedores: "no" },
    { ...bueno, contenedores: undefined },
    { ...bueno, contenedores: [null] },
    { ...bueno, contenedores: [{ nombre: "", cpu: 1, memMb: 1 }] },
    { ...bueno, contenedores: [{ nombre: "x", cpu: -3, memMb: 1 }] },
    { ...bueno, contenedores: [{ nombre: "x", cpu: 1, memMb: 1, memLimiteMb: -1 }] },
    { ...bueno, contenedores: Array.from({ length: 201 }, () => ({ nombre: "x", cpu: 1, memMb: 1 })) },
  ];
  for (const roto of rotos) {
    const resultado = validarMuestra(roto);
    assert.equal(resultado.ok, false, JSON.stringify(roto));
    if (!resultado.ok) assert.ok(resultado.error.length > 0);
  }
});

test("la migración de MetricaServidor solo tiene CREATE TABLE y CREATE INDEX", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20261117000000_metrica_servidor/migration.sql"),
    "utf8",
  );
  const sentencias = sql
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  assert.ok(sentencias.some((s) => /^CREATE TABLE IF NOT EXISTS "MetricaServidor"/.test(s)));
  assert.ok(sentencias.some((s) => /^CREATE INDEX IF NOT EXISTS "MetricaServidor_tomadaEn_idx"/.test(s)));
  for (const s of sentencias) {
    assert.match(s, /^(BEGIN|COMMIT|CREATE TABLE|CREATE INDEX)\b/, s);
  }
  assert.doesNotMatch(sql, /\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\b/i);
});

// ---- Parte 3: pantalla Dirección → Servidor ----

const cuenta = (isOwner: boolean, role: string, membershipRole: string) => ({ isOwner, role, membershipRole });

test("Servidor: el dueño y los administradores entran; EMPLEADO, MEMBER y SUPERVISORA no", () => {
  assert.equal(puedeVerDireccion(cuenta(true, "CLIENTE", "MEMBER")), true);
  assert.equal(puedeVerDireccion(cuenta(false, "ADMIN", "MEMBER")), true);
  assert.equal(puedeVerDireccion(cuenta(false, "CLIENTE", "OWNER")), true);
  assert.equal(puedeVerDireccion(cuenta(false, "CLIENTE", "ADMIN")), true);
  assert.equal(puedeVerDireccion(cuenta(false, "EMPLEADO", "MEMBER")), false);
  assert.equal(puedeVerDireccion(cuenta(false, "CLIENTE", "MEMBER")), false);
  assert.equal(puedeVerDireccion(cuenta(false, "CLIENTE", "SUPERVISORA")), false);
});

test("la ruta GET y la página exigen la regla de Dirección (401/403 y /unauthorized)", () => {
  const raiz = process.cwd();
  const ruta = readFileSync(path.join(raiz, "src/app/api/admin/metricas-servidor/route.ts"), "utf8");
  assert.match(ruta, /export const dynamic = "force-dynamic"/);
  assert.match(ruta, /export async function GET/);
  assert.match(ruta, /status: 401/);
  assert.match(ruta, /puedeVerDireccion\(access\)[\s\S]*status: 403/);
  const pagina = readFileSync(path.join(raiz, "src/app/cliente/direccion/servidor/page.tsx"), "utf8");
  assert.match(pagina, /if \(!puedeVerDireccion\(access\)\) \{\s*redirect\("\/unauthorized"\)/);
  const lectura = readFileSync(path.join(raiz, "src/lib/metricas-servidor-lectura.ts"), "utf8");
  assert.match(lectura, /tomadaEn: \{ gte: desde \}/);
  assert.match(lectura, /orderBy: \{ tomadaEn: "asc" \}/);
  assert.match(lectura, /select: CAMPOS_PANEL/);
  assert.equal("contenedores" in CAMPOS_PANEL, false);
});

test("inicioDelPanel: 24 h antes", () => {
  assert.equal(inicioDelPanel(INICIO).toISOString(), "2026-11-10T12:00:00.000Z");
});

const c = (nombre: string, cpu: number, memMb = 100): ContenedorMuestra => ({
  nombre,
  grupo: grupoDelContenedor(nombre),
  cpu,
  memMb,
  memLimiteMb: null,
});

test("ordenarContenedoresPorCpu: de mayor a menor, empates por nombre, sin cambiar la original", () => {
  const lista = [c("b", 10), c("a", 50), c("d", 10), c("c", 80)];
  const copia = [...lista];
  assert.deepEqual(
    ordenarContenedoresPorCpu(lista).map((x) => x.nombre),
    ["c", "a", "b", "d"],
  );
  assert.deepEqual(lista, copia);
});

test("agruparContenedores: grupos en orden, sin grupos vacíos y con sumas", () => {
  const grupos = agruparContenedores([
    c("waha2", 5, 300),
    c("otro-cosa", 1, 50),
    c("crm-aizenbot_app.1", 20, 1000),
    c("crm-realtime.1", 30, 200),
  ]);
  assert.deepEqual(
    grupos.map((g) => g.grupo),
    ["CRM", "WAHA", "Otros"],
  );
  assert.equal(grupos[0].cpu, 50);
  assert.equal(grupos[0].memMb, 1200);
  assert.deepEqual(
    grupos[0].contenedores.map((x) => x.nombre),
    ["crm-realtime.1", "crm-aizenbot_app.1"],
  );
  assert.deepEqual(agruparContenedores([]), []);
});

test("leerContenedores: JSON roto da lista vacía y salta entradas rotas", () => {
  assert.deepEqual(leerContenedores(null), []);
  assert.deepEqual(leerContenedores("roto"), []);
  assert.deepEqual(leerContenedores({ nombre: "x" }), []);
  const lista = leerContenedores([
    { nombre: "crm-postgres.1", cpu: 3, memMb: 500 },
    { nombre: "", cpu: 1, memMb: 1 },
    { nombre: "sin-cpu", memMb: 1 },
    null,
    { nombre: "mf8_app", grupo: "Inventado", cpu: 2, memMb: 10, memLimiteMb: 512 },
  ]);
  assert.deepEqual(lista, [
    { nombre: "crm-postgres.1", grupo: "Base", cpu: 3, memMb: 500, memLimiteMb: null },
    { nombre: "mf8_app", grupo: "Marketplace", cpu: 2, memMb: 10, memLimiteMb: 512 },
  ]);
});

test("armarPanelServidor: fechas en ISO y contenedores solo en la última foto", () => {
  const fila = { cpuTotal: 10, load1: 0.5, nucleos: 4, memUsadaMb: 100, memTotalMb: 200, discoUsadoGb: 50, discoTotalGb: 100 };
  const fotos = armarPanelServidor(
    [
      { ...fila, tomadaEn: INICIO },
      { ...fila, tomadaEn: minutosDespues(1) },
    ],
    [{ nombre: "waha2", cpu: 1, memMb: 2 }],
  );
  assert.equal(fotos[0].tomadaEn, INICIO.toISOString());
  assert.equal(fotos[0].contenedores, undefined);
  assert.equal(fotos[1].contenedores?.length, 1);
  assert.deepEqual(armarPanelServidor([], null), []);
});

test("seriePanelServidor: % de CPU efectiva, memoria y disco; total en 0 da 0 %", () => {
  const foto: FotoPanel = {
    tomadaEn: INICIO.toISOString(),
    cpuTotal: 20,
    load1: 2,
    nucleos: 4,
    memUsadaMb: 750,
    memTotalMb: 1000,
    discoUsadoGb: 90,
    discoTotalGb: 100,
  };
  assert.deepEqual(seriePanelServidor([foto]), [{ tomadaEn: foto.tomadaEn, cpu: 50, memoria: 75, disco: 90 }]);
  const sinTotales = seriePanelServidor([{ ...foto, memTotalMb: 0, discoTotalGb: 0 }])[0];
  assert.equal(sinTotales.memoria, 0);
  assert.equal(sinTotales.disco, 0);
});

// ---------------------------------------------------------------------------------------------------------
// Aviso "Base de datos saturada": CPU del contenedor de la base > 200 % en 3 fotos seguidas.
// ---------------------------------------------------------------------------------------------------------

const BASE = { umbral: UMBRAL_CPU_BASE_ALERTA, muestras: MUESTRAS_PARA_ALERTA_BASE };

test("alerta de la base: los valores son 200 % y 3 fotos", () => {
  assert.equal(UMBRAL_CPU_BASE_ALERTA, 200);
  assert.equal(MUESTRAS_PARA_ALERTA_BASE, 3);
});

test("alerta de la base: 200 % exacto no cuenta", () => {
  const r = evaluarAlerta({ ultimasCpu: [200, 200, 200], estado: SIN_ALERTA, ahora: INICIO, ...BASE });
  assert.equal(r.mandar, false);
  assert.equal(r.estadoNuevo.activa, false);
  const conBorde = evaluarAlerta({ ultimasCpu: [250, 250, 200], estado: SIN_ALERTA, ahora: INICIO, ...BASE });
  assert.equal(conBorde.mandar, false);
});

test("alerta de la base: 2 fotos altas no avisan y 3 sí; repite a los 60 min", () => {
  const dos = evaluarAlerta({ ultimasCpu: [250, 250], estado: SIN_ALERTA, ahora: INICIO, ...BASE });
  assert.equal(dos.mandar, false);
  const tres = evaluarAlerta({ ultimasCpu: [250, 250, 201], estado: SIN_ALERTA, ahora: INICIO, ...BASE });
  assert.equal(tres.mandar, true);
  assert.deepEqual(tres.estadoNuevo, { activa: true, ultimoEnvio: INICIO.toISOString() });
  const a30 = evaluarAlerta({ ultimasCpu: [250, 250, 250], estado: tres.estadoNuevo, ahora: minutosDespues(30), ...BASE });
  assert.equal(a30.mandar, false);
  const a60 = evaluarAlerta({ ultimasCpu: [250, 250, 250], estado: a30.estadoNuevo, ahora: minutosDespues(60), ...BASE });
  assert.equal(a60.mandar, true);
  const baja = evaluarAlerta({ ultimasCpu: [150, 250, 250], estado: a60.estadoNuevo, ahora: minutosDespues(61), ...BASE });
  assert.equal(baja.estadoNuevo.activa, false);
});

test("alerta de la base: 3 fotos sobre 85 % no tocan la alerta normal, que sigue pidiendo 5", () => {
  const r = evaluarAlerta({ ultimasCpu: [90, 90, 90], estado: SIN_ALERTA, ahora: INICIO });
  assert.equal(r.mandar, false);
});

test("cpuDeLaBase: el contenedor de la base que más usa (no la suma); sin grupo Base da null", () => {
  const c = (nombre: string, grupo: ContenedorMuestra["grupo"], cpu: number): ContenedorMuestra => ({
    nombre,
    grupo,
    cpu,
    memMb: 100,
    memLimiteMb: null,
  });
  assert.equal(cpuDeLaBase([c("crm-postgres", "Base", 120), c("crm-postgres-2", "Base", 180), c("app", "CRM", 400)]), 180);
  assert.equal(cpuDeLaBase([c("app", "CRM", 400), c("mf8", "Marketplace", 300)]), null);
  assert.equal(cpuDeLaBase([]), null);
});

test("textoDeAlertaBase: título, CPU y memoria de la base y CPU del servidor", () => {
  const texto = textoDeAlertaBase(
    muestra({
      contenedores: [
        { nombre: "crm-postgres", grupo: "Base", cpu: 251.6, memMb: 2048, memLimiteMb: 4096 },
        { nombre: "crm-aizenbot_app", grupo: "CRM", cpu: 40, memMb: 900, memLimiteMb: null },
      ],
    }),
  );
  const lineas = texto.split("\n");
  assert.equal(lineas[0], "⚠️ Base de datos saturada: crm-postgres usa 252 % de CPU");
  assert.ok(texto.includes("3 fotos seguidas por encima de 200 %"), texto);
  assert.ok(texto.includes("Memoria de la base: 2,0 de 4,0 GB"), texto);
  assert.ok(texto.includes("CPU del servidor: 92 %"), texto);
});

// ---------------------------------------------------------------------------------------------------------
// Consultas lentas de la base
// ---------------------------------------------------------------------------------------------------------

test("consultas lentas: los valores son 10 s y 2 fotos", () => {
  assert.equal(SEGUNDOS_CONSULTA_LENTA, 10);
  assert.equal(FOTOS_PARA_ALERTA_CONSULTAS, 2);
  assert.equal(TITULO_AVISO_CONSULTAS_LENTAS, "Base de datos con consultas lentas");
});

test("resumirConsulta: dice la tabla y nunca copia el teléfono", () => {
  const r = resumirConsulta(`SELECT * FROM "Message" WHERE phone = '573001234567'`, "aizen_crm", 23);
  assert.match(r, /Message/);
  assert.doesNotMatch(r, /573001234567/);
  assert.equal(r, "Leyendo la tabla Message, hace 23 s (base aizen_crm)");
});

test("resumirConsulta: nunca copia textos, números ni valores de $$", () => {
  const r = resumirConsulta(
    `SELECT "id" FROM "public"."Contact" WHERE "name" = 'Ana Pérez' AND "total" > 989000 AND nota = $$secreto$$ -- 3001112233`,
    "crm",
    12,
  );
  for (const valor of ["Ana", "Pérez", "989000", "secreto", "3001112233"]) assert.doesNotMatch(r, new RegExp(valor));
  assert.match(r, /Contact/);
});

test("resumirConsulta: las comillas raras no dejan pasar valores", () => {
  const casos: Array<[string, string]> = [
    [String.raw`UPDATE "Contact" SET name = E'Ana\' JOIN mariagomez' WHERE id = $1`, "mariagomez"],
    [`SELECT "it's" FROM t WHERE a = 'x FROM juanperez'`, "juanperez"],
    [`SELECT 1 FROM t WHERE a = 'x''s FROM juan'`, "juan"],
    [String.raw`SELECT 1 FROM t WHERE a = U&'d\0061t FROM pepito'`, "pepito"],
    [`SELECT 1 FROM t WHERE a = $tag$ FROM luisa $tag$`, "luisa"],
    [`SELECT 1 FROM t /* FROM carlos */ WHERE b = 2`, "carlos"],
  ];
  for (const [sql, valor] of casos) {
    const r = resumirConsulta(sql, "crm", 12);
    assert.doesNotMatch(r, new RegExp(valor), sql);
  }
  assert.match(resumirConsulta(String.raw`UPDATE "Contact" SET name = E'Ana\' JOIN mariagomez' WHERE id = $1`, "crm", 12), /^Cambiando la tabla Contact,/);
});

test("resumirConsulta: leer con JOIN junta las tablas sin comillas ni esquema", () => {
  const r = resumirConsulta(
    `SELECT m.id FROM "public"."Message" m JOIN "public"."Conversation" c ON c.id = m."conversationId" WHERE m.id = $1`,
    "aizen_crm",
    23.4,
  );
  assert.equal(r, "Leyendo las tablas Message y Conversation, hace 23 s (base aizen_crm)");
  assert.doesNotMatch(r, /"/);
});

test("resumirConsulta: cada tipo de acción", () => {
  assert.match(resumirConsulta(`INSERT INTO "public"."Message" ("id","body") VALUES ($1,'hola')`, "crm", 11), /^Guardando en la tabla Message,/);
  assert.match(resumirConsulta(`UPDATE "Conversation" SET "estado" = 'x' WHERE id = 5`, "crm", 11), /^Cambiando la tabla Conversation,/);
  assert.match(resumirConsulta(`DELETE FROM "MetricaServidor" WHERE "tomadaEn" < '2026-01-01'`, "crm", 11), /^Borrando de la tabla MetricaServidor,/);
  assert.match(resumirConsulta(`VACUUM (VERBOSE, ANALYZE) "Message"`, "crm", 11), /^Mantenimiento de la tabla Message,/);
  assert.match(resumirConsulta(`ANALYZE "Contact"`, "crm", 11), /^Mantenimiento de la tabla Contact,/);
  assert.match(resumirConsulta(`CREATE INDEX CONCURRENTLY "idx" ON "public"."Message" ("phone")`, "crm", 11), /^Mantenimiento de la tabla Message,/);
  assert.match(resumirConsulta(`REINDEX TABLE "Message"`, "crm", 11), /^Mantenimiento de la tabla Message,/);
  assert.match(resumirConsulta(`SELECT pg_sleep(30)`, "crm", 11), /^Leyendo datos, hace 11 s \(base crm\)$/);
});

test("resumirConsulta: sin texto o <insufficient privilege> dice que es de otro usuario, con la duración", () => {
  for (const texto of [null, "", "   ", "<insufficient privilege>"]) {
    assert.equal(resumirConsulta(texto, "gestion", 42.6), "Consulta de otro usuario de la base, hace 43 s (base gestion)");
  }
});

test("resumirConsultas: máximo 5, con base y segundos redondeados", () => {
  const lista = Array.from({ length: 7 }, (_, i) => ({ base: "crm", segundos: 10.6 + i, texto: `SELECT 1 FROM "T${i}"` }));
  const r = resumirConsultas(lista);
  assert.equal(r.length, 5);
  assert.deepEqual({ base: r[0].base, segundos: r[0].segundos }, { base: "crm", segundos: 11 });
  assert.match(r[0].resumen, /T0/);
});

test("evaluarConsultasLentas: avisa a la 2ª foto seguida, repite cada 60 min y la racha vuelve a 0", () => {
  const inicio = new Date("2026-11-11T15:00:00Z");
  const despues = (min: number) => new Date(inicio.getTime() + min * 60_000);
  const una = [{}];
  const primera = evaluarConsultasLentas({ consultas: una, estado: { rachaDeFotos: 0, ultimoAvisoEn: null }, ahora: inicio });
  assert.deepEqual(primera, { mandar: false, estadoNuevo: { rachaDeFotos: 1, ultimoAvisoEn: null } });
  const segunda = evaluarConsultasLentas({ consultas: una, estado: primera.estadoNuevo, ahora: despues(1) });
  assert.equal(segunda.mandar, true);
  assert.deepEqual(segunda.estadoNuevo, { rachaDeFotos: 2, ultimoAvisoEn: despues(1).toISOString() });
  const a30 = evaluarConsultasLentas({ consultas: una, estado: segunda.estadoNuevo, ahora: despues(31) });
  assert.equal(a30.mandar, false);
  assert.equal(a30.estadoNuevo.rachaDeFotos, 3);
  const a60 = evaluarConsultasLentas({ consultas: una, estado: a30.estadoNuevo, ahora: despues(61) });
  assert.equal(a60.mandar, true);
  const sinConsultas = evaluarConsultasLentas({ consultas: [], estado: a60.estadoNuevo, ahora: despues(62) });
  assert.deepEqual(sinConsultas, { mandar: false, estadoNuevo: { rachaDeFotos: 0, ultimoAvisoEn: despues(61).toISOString() } });
  // Una fecha rota no deja la alerta callada para siempre.
  const rota = evaluarConsultasLentas({ consultas: una, estado: { rachaDeFotos: 1, ultimoAvisoEn: "no-es-fecha" }, ahora: inicio });
  assert.equal(rota.mandar, true);
});

test("textoDeAlertaConsultas: título exacto y las consultas resumidas", () => {
  const texto = textoDeAlertaConsultas(
    resumirConsultas([{ base: "crm", segundos: 15, texto: `SELECT * FROM "Message" WHERE phone = '573001234567'` }]),
  );
  assert.match(texto, /Base de datos con consultas lentas/);
  assert.match(texto, /1\. Leyendo la tabla Message, hace 15 s \(base crm\)/);
  assert.doesNotMatch(texto, /573001234567/);
});

test("estadoTarjetaConsultas: roja con la lista, verde 'Ninguna' y gris 'Sin dato reciente' (borde de 5 min)", () => {
  const ahora = new Date("2026-11-25T15:00:00Z");
  const haceMin = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();
  const valor = (leidaEn: unknown, consultas: unknown) => JSON.stringify({ leidaEn, consultas, rachaDeFotos: 1, ultimoAvisoEn: null });
  const una = { base: "crm", segundos: 23, resumen: "Leyendo la tabla Message, hace 23 s (base crm)" };

  // Roja: hay consultas.
  assert.deepEqual(estadoTarjetaConsultas(valor(haceMin(1), [una]), ahora), { tono: "rojo", consultas: [una] });
  // Verde: la lista está vacía.
  assert.deepEqual(estadoTarjetaConsultas(valor(haceMin(1), []), ahora), { tono: "verde", texto: "Ninguna" });
  // Borde: 5 min justos todavía cuentan; un poco más ya es gris.
  assert.equal(estadoTarjetaConsultas(valor(haceMin(5), []), ahora).tono, "verde");
  assert.equal(estadoTarjetaConsultas(valor(haceMin(5), [una]), ahora).tono, "rojo");
  const gris = { tono: "gris", texto: "Sin dato reciente" };
  assert.deepEqual(estadoTarjetaConsultas(valor(new Date(ahora.getTime() - 5 * 60_000 - 1).toISOString(), [una]), ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas(valor(haceMin(30), []), ahora), gris);
  // Gris: sin valor, valor roto, sin leidaEn o con fecha rota.
  assert.deepEqual(estadoTarjetaConsultas(null, ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas(undefined, ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas("", ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas("{no es json", ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas("[]", ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas(valor(null, []), ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas(valor("no-es-fecha", []), ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas(JSON.stringify({ leidaEn: haceMin(1) }), ahora), gris);
  // Filas rotas se saltan; si todas están rotas no se dice "Ninguna".
  assert.deepEqual(estadoTarjetaConsultas(valor(haceMin(1), [{ base: "crm" }]), ahora), gris);
  assert.deepEqual(estadoTarjetaConsultas(valor(haceMin(1), [{ base: "crm" }, una]), ahora), { tono: "rojo", consultas: [una] });
  // Máximo 5 en la tarjeta.
  const siete = Array.from({ length: 7 }, () => una);
  const roja = estadoTarjetaConsultas(valor(haceMin(0), siete), ahora);
  assert.equal(roja.tono === "rojo" && roja.consultas.length, 5);
});
