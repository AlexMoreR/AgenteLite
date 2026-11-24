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
  fechaDeLaBitacora,
  reglaPara,
  resumenDeUnaLinea,
  rutaDeIncidentes,
} from "../lib/bitacora.mjs";
import { completarConfig } from "../lib/config.mjs";

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
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

console.log(`\n${pruebas} pruebas pasaron`);
