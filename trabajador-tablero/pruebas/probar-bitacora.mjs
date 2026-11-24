// Pruebas de la bitácora de incidentes (lib/bitacora.mjs), con una carpeta temporal como carpeta de trabajo y como bóveda.
// No toca el CRM real ni D:/Magilus.
//   node trabajador-tablero/pruebas/probar-bitacora.mjs   (también corre dentro de npm run test:trabajador-tablero)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BITACORA_POR_DEFECTO,
  INCIDENTES_CONOCIDOS,
  RUTA_EN_BOVEDA_POR_DEFECTO,
  SIN_CAUSA,
  anotarIncidente,
  armarEntrada,
  bloqueDeIncidentes,
  fechaDeLaBitacora,
  incidentesParaElPrompt,
  reglaPara,
  resumenDeUnaLinea,
  rutaDeIncidentes,
} from "../lib/bitacora.mjs";
import { completarConfig } from "../lib/config.mjs";
import { promptDeConstruir, promptDelPlan } from "../lib/etapas.mjs";

const RAIZ_DEL_REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "bitacora-"));
const registro = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`info: ${m}`), aviso: (m) => lineas.push(`aviso: ${m}`), error: (m) => lineas.push(`error: ${m}`) };
};
const tarjeta = { id: "cmwbcu28700b732qmru2nd890", titulo: "Editar compra que rompe" };
const base = {
  fecha: "2026-11-24 14:05",
  tarjeta,
  repo: "aizencrm",
  queFallo: "no_arranco",
  causa: "El cambio tiene un error en el programa y la versión nueva falló al usarse.",
  lineasDelError: ["TypeError: Cannot read properties of undefined (reading 'compra')", "at editar (a.ts:1)"],
  comoSeResolvio: "arreglo",
  clase: "codigo",
};

try {
  await prueba("(a) la entrada trae fecha, tarjeta, repo, qué falló, Causa, Cómo se resolvió, Regla y su clave estable", () => {
    const entrada = armarEntrada(base);
    const lineas = entrada.split("\n");
    assert.equal(lineas[0], "### 2026-11-24 14:05 · ru2nd890 Editar compra que rompe", "el id en corto, como las ramas");
    assert.equal(lineas[1], "<!-- incidente:ru2nd890:2026-11-24 14:05 -->");
    assert.match(entrada, /^- Repo: aizencrm$/m);
    assert.match(entrada, /^- Qué falló: no arrancó$/m);
    assert.match(entrada, /^- Causa: El cambio tiene un error en el programa/m);
    assert.match(entrada, /^- Cómo se resolvió: tarjeta 'Arreglo de subida'$/m);
    assert.match(entrada, /^- Regla: .+/m);
    assert.match(entrada, /```\nTypeError: Cannot read[^\n]*\nat editar \(a\.ts:1\)\n```/);
    // Los tres "Qué falló" y las tres decisiones.
    assert.match(armarEntrada({ ...base, queFallo: "vigilancia" }), /^- Qué falló: la vigilancia de 30 min la deshizo$/m);
    assert.match(armarEntrada({ ...base, queFallo: "ensayo" }), /^- Qué falló: falló el ensayo de migraciones$/m);
    assert.match(armarEntrada({ ...base, comoSeResolvio: "reintento" }), /^- Cómo se resolvió: reintento por falla pasajera$/m);
    assert.match(armarEntrada({ ...base, comoSeResolvio: "alertas" }), /^- Cómo se resolvió: aviso en Alertas a la 3\.ª vez$/m);
    // Sin causa no se inventa una; un ``` del log no cierra el bloque.
    const sinCausa = armarEntrada({ ...base, causa: "", lineasDelError: ["a ``` b"] });
    assert.match(sinCausa, new RegExp(`^- Causa: ${SIN_CAUSA}$`, "m"));
    assert.equal(sinCausa.match(/```/g).length, 2);
    // La copia corta para el cerebro: una sola línea con lo mismo.
    const resumen = resumenDeUnaLinea(armarEntrada(base));
    assert.ok(!resumen.includes("\n"), resumen);
    assert.match(resumen, /^- 2026-11-24 14:05 · ru2nd890 Editar compra que rompe · repo aizencrm · qué falló: no arrancó · causa: El cambio[^·]+· cómo se resolvió: tarjeta 'Arreglo de subida' · regla: /);
    assert.match(fechaDeLaBitacora(new Date("2026-11-24T19:05:00Z")), /^2026-11-24 14:05$/, "la hora de Bogotá");
  });

  await prueba("(b) una causa con pg_input_is_valid da una regla que nombra Postgres 16", () => {
    assert.match(reglaPara('ERROR: function pg_input_is_valid(text, unknown) does not exist', "codigo"), /Postgres 16/);
    // También si está en las líneas del error y no en la causa.
    const entrada = armarEntrada({ ...base, queFallo: "ensayo", causa: "El ensayo de la migración falló", lineasDelError: ["psql: ERROR:  function pg_input_is_valid(text, unknown) does not exist"] });
    assert.match(entrada, /^- Regla: No usar funciones de Postgres 16 que producción no tiene\.$/m);
  });

  await prueba("(c) un corte de red da 'pasajera'; un error de Prisma de varias líneas pide leer el error completo; sin patrón, la regla de la clase", () => {
    for (const causa of ["read ECONNRESET", "connect ETIMEDOUT 10.0.0.1:443", "corte de red al subir", "tiempo agotado esperando al servidor"]) {
      assert.match(reglaPara(causa, "desconocida"), /pasajera/, causa);
    }
    assert.equal(reglaPara("Error: P3009 migrate found failed migrations\nThe `20261120_x` migration started at … failed", "arranque"), "Leer el error completo, no solo la primera línea.");
    assert.match(reglaPara("algo raro", "codigo"), /build y pruebas/);
    assert.match(reglaPara("algo raro", "arranque"), /arranque/);
    assert.match(reglaPara("algo raro", "pasajera"), /pasajera/);
    assert.match(reglaPara("algo raro", "desconocida"), /registros completos/);
    assert.match(reglaPara("algo raro", undefined), /registros completos/);
  });

  await prueba("(d) anotarIncidente con una bóveda que no existe no lanza: lo local queda y la bóveda va al aviso", () => {
    const log = registro();
    const config = { carpetaTrabajo: path.join(T, "trabajo-d"), boveda: { ruta: path.join(T, "no-existe") }, bitacora: BITACORA_POR_DEFECTO };
    const salida = anotarIncidente({ config, registro: log, ...base });
    assert.equal(salida.boveda, null);
    assert.equal(salida.local, rutaDeIncidentes(config.carpetaTrabajo, "aizencrm"));
    assert.match(fs.readFileSync(salida.local, "utf8"), /^# Bitácora de incidentes: aizencrm\n\n### 2026-11-24 14:05/);
    assert.ok(log.lineas.some((linea) => /^aviso: bitácora: no se pudo escribir en la bóveda/.test(linea)), log.lineas.join("\n"));
    // Ni con una carpeta de trabajo imposible ni sin registro lanza.
    const archivo = path.join(T, "un-archivo");
    fs.writeFileSync(archivo, "x");
    assert.doesNotThrow(() => anotarIncidente({ config: { carpetaTrabajo: archivo, boveda: { ruta: path.join(T, "no-existe") } }, registro: log, ...base }));
    assert.doesNotThrow(() => anotarIncidente({ config: {}, ...base }));
  });

  await prueba("anotarIncidente con bóveda: agrega al final del archivo del repo y la línea en la bóveda, sin repetir la misma entrada", () => {
    const boveda = fs.mkdtempSync(path.join(T, "boveda-"));
    const config = { carpetaTrabajo: path.join(T, "trabajo-e"), boveda: { ruta: boveda }, bitacora: BITACORA_POR_DEFECTO };
    const log = registro();
    const primera = anotarIncidente({ config, registro: log, ...base });
    anotarIncidente({ config, registro: log, ...base, fecha: "2026-11-24 15:00", queFallo: "vigilancia", comoSeResolvio: "reintento" });
    anotarIncidente({ config, registro: log, ...base }); // la misma: no se repite en lo local
    const local = fs.readFileSync(primera.local, "utf8");
    assert.equal(local.match(/^### /gm).length, 2, local);
    assert.ok(local.indexOf("14:05") < local.indexOf("15:00"), "en orden: se agrega al final");
    const enBoveda = path.join(boveda, ...RUTA_EN_BOVEDA_POR_DEFECTO.split("/"));
    assert.equal(primera.boveda, enBoveda);
    const texto = fs.readFileSync(enBoveda, "utf8");
    assert.match(texto, /^- 2026-11-24 14:05 · ru2nd890 Editar compra que rompe · repo aizencrm/);
    assert.match(texto, /- 2026-11-24 15:00 [^\n]*la vigilancia de 30 min la deshizo/);
    // El nombre del repo no saca el archivo de la carpeta.
    assert.equal(path.dirname(rutaDeIncidentes(config.carpetaTrabajo, "../../afuera")), path.join(config.carpetaTrabajo, "incidentes"));
  });

  await prueba("config: bitacora es opcional (valores por defecto) y se valida", () => {
    const minima = { urlCrm: "http://127.0.0.1:1", claveTrabajador: "aizen_trab_prueba", carpetaTrabajo: path.join(T, "c"), repos: { aizencrm: { ruta: T, subirSolo: false } } };
    assert.deepEqual(completarConfig(minima, T).bitacora, { rutaEnBoveda: "06 Tecnología/Bitácora de incidentes.md", entradasEnPrompt: 15 });
    assert.deepEqual(completarConfig({ ...minima, bitacora: { entradasEnPrompt: 3 } }, T).bitacora, { rutaEnBoveda: RUTA_EN_BOVEDA_POR_DEFECTO, entradasEnPrompt: 3 });
    assert.throws(() => completarConfig({ ...minima, bitacora: { rutaEnBoveda: "../afuera.md" } }, T), /bitacora\.rutaEnBoveda/);
    assert.throws(() => completarConfig({ ...minima, bitacora: { entradasEnPrompt: -1 } }, T), /bitacora\.entradasEnPrompt/);
  });

  await prueba("INCIDENTES_CONOCIDOS: T-875 de Gestión (no arrancó, commit c42a476), sin causa inventada", () => {
    assert.equal(INCIDENTES_CONOCIDOS.length, 1);
    const [t875] = INCIDENTES_CONOCIDOS;
    assert.equal(t875.tarjeta.id, "T-875");
    assert.equal(t875.repo, "gestion");
    assert.equal(t875.commit, "c42a476");
    assert.equal(t875.causa, SIN_CAUSA);
    const entrada = armarEntrada(t875);
    assert.match(entrada, /^### fecha no registrada · T-875 Gestión no arrancó$/m);
    assert.match(entrada, /^<!-- incidente:T-875:fecha no registrada -->$/m);
    assert.match(entrada, /^- Repo: gestion \(commit c42a476\)$/m);
    assert.match(entrada, /^- Qué falló: no arrancó$/m);
    assert.match(entrada, /^- Causa: causa no registrada$/m);
  });

  // Parte 2: el plan y la construcción leen los incidentes ya vistos.
  const tarjetaDePrompt = { titulo: "Algo", tablero: "T", detalle: "d", intentos: 1 };
  const repoDePrompt = { clave: "aizencrm", ruta: "/r/crm" };
  const conLosIncidentes = (incidentes) => [promptDelPlan(tarjetaDePrompt, repoDePrompt, "claude", { incidentes }), promptDeConstruir(tarjetaDePrompt, repoDePrompt, "tablero/x", "claude", { incidentes })];

  await prueba("con una entrada anotada, el plan y construir traen 'Incidentes ya vistos' y la regla de esa entrada", () => {
    const carpetaTrabajo = path.join(T, "trabajo-p2a");
    anotarIncidente({ config: { carpetaTrabajo }, ...base, causa: "ERROR: function pg_input_is_valid(text, unknown) does not exist" });
    const incidentes = incidentesParaElPrompt({ raizDelRepo: path.join(T, "sin-repo"), carpetaTrabajo, repo: "aizencrm" });
    assert.equal(incidentes.split("\n").length, 1, incidentes);
    assert.match(incidentes, /^- No usar funciones de Postgres 16 que producción no tiene\. — ERROR: function pg_input_is_valid/);
    for (const prompt of conLosIncidentes(incidentes)) {
      assert.ok(prompt.includes("Incidentes ya vistos en este repo: no los repitas."), prompt);
      assert.ok(prompt.includes("No usar funciones de Postgres 16 que producción no tiene."), prompt);
      // Va justo después de las lecciones (o del contexto, si no hay lecciones) y antes de las instrucciones del plan.
      assert.ok(prompt.indexOf("Incidentes ya vistos") > prompt.indexOf("Algo"));
    }
  });

  await prueba("sin bitácora, ni el plan ni construir traen el bloque; incidentesParaElPrompt no lanza", () => {
    const incidentes = incidentesParaElPrompt({ raizDelRepo: path.join(T, "no-existe"), carpetaTrabajo: path.join(T, "no-existe"), repo: "aizencrm" });
    assert.equal(incidentes, "");
    assert.equal(bloqueDeIncidentes(""), "");
    assert.equal(bloqueDeIncidentes("  \n"), "");
    for (const prompt of [...conLosIncidentes(incidentes), promptDelPlan(tarjetaDePrompt, repoDePrompt), promptDeConstruir(tarjetaDePrompt, repoDePrompt, "tablero/x")]) {
      assert.ok(!prompt.includes("Incidentes ya vistos"), prompt);
    }
    assert.doesNotThrow(() => incidentesParaElPrompt());
    assert.equal(incidentesParaElPrompt({ carpetaTrabajo: {}, raizDelRepo: 3, repo: null }), "");
  });

  await prueba("entran solo las últimas 15 líneas (o las de config.bitacora.entradasEnPrompt)", () => {
    const carpetaTrabajo = path.join(T, "trabajo-p2c");
    for (let i = 1; i <= 20; i += 1) {
      anotarIncidente({ config: { carpetaTrabajo }, ...base, fecha: `2026-11-24 10:${String(i).padStart(2, "0")}`, causa: `causa número ${i}` });
    }
    const quince = incidentesParaElPrompt({ carpetaTrabajo, repo: "aizencrm" }).split("\n");
    assert.equal(quince.length, 15);
    assert.match(quince[0], /causa número 6$/, "las últimas: de la 6 a la 20");
    assert.match(quince[14], /causa número 20$/);
    assert.equal(incidentesParaElPrompt({ carpetaTrabajo, repo: "aizencrm", config: { bitacora: { entradasEnPrompt: 3 } } }).split("\n").length, 3);
    assert.equal(incidentesParaElPrompt({ carpetaTrabajo, repo: "aizencrm", cuantas: 0 }), "");
  });

  await prueba("una entrada que está en docs/incidentes.md y en la carpeta local sale una sola vez", () => {
    const raizDelRepo = path.join(T, "repo-p2d");
    const carpetaTrabajo = path.join(T, "trabajo-p2d");
    fs.mkdirSync(path.join(raizDelRepo, "docs"), { recursive: true });
    fs.writeFileSync(path.join(raizDelRepo, "docs", "incidentes.md"), `# Bitácora de incidentes: aizencrm\n\n${armarEntrada({ ...base, causa: "la causa compartida" })}`);
    anotarIncidente({ config: { carpetaTrabajo }, ...base, causa: "la causa compartida" });
    anotarIncidente({ config: { carpetaTrabajo }, ...base, fecha: "2026-11-24 16:00", causa: "solo en la carpeta local" });
    const lineas = incidentesParaElPrompt({ raizDelRepo, carpetaTrabajo, repo: "aizencrm" }).split("\n");
    assert.equal(lineas.length, 2, lineas.join("\n"));
    assert.equal(lineas.filter((texto) => texto.includes("la causa compartida")).length, 1);
    assert.match(lineas[1], /solo en la carpeta local$/, "primero las del repo, después las locales nuevas");
  });

  await prueba("docs/incidentes.md del repo: T-819 y T-872 con Causa, Cómo se resolvió y Regla; una menciona pg_input_is_valid", () => {
    const texto = fs.readFileSync(path.join(RAIZ_DEL_REPO, "docs", "incidentes.md"), "utf8");
    const bloques = texto.split(/^(?=### )/m).filter((bloque) => bloque.startsWith("### "));
    const de = (id) => bloques.filter((bloque) => new RegExp(`^### [^\\n]*· ${id} `).test(bloque));
    for (const id of ["T-819", "T-872"]) {
      assert.equal(de(id).length, 1, `una entrada de ${id}`);
      const [bloque] = de(id);
      assert.match(bloque, new RegExp(`^<!-- incidente:${id}:[^\\n]+ -->$`, "m"), `${id}: su clave estable`);
      for (const campo of ["Repo", "Qué falló", "Causa", "Cómo se resolvió", "Regla"]) assert.match(bloque, new RegExp(`^- ${campo}: .+$`, "m"), `${id}: ${campo}`);
    }
    assert.ok([...de("T-819"), ...de("T-872")].some((bloque) => bloque.includes("pg_input_is_valid")));
    // Las reversiones del 15, 19 y 24 de noviembre.
    for (const commit of ["04411e38", "0879c1f3", "a682f50d", "e617aabf"]) assert.ok(texto.includes(`(commit ${commit})`), commit);
    // Todo el archivo se lee: cada entrada sale en el prompt.
    const lineas = incidentesParaElPrompt({ raizDelRepo: RAIZ_DEL_REPO, carpetaTrabajo: path.join(T, "no-existe"), repo: "aizencrm" }).split("\n");
    assert.equal(lineas.length, bloques.length);
  });
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

console.log(`\n${pruebas} pruebas pasaron`);
