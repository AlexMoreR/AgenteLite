// Pruebas de la bitácora de incidentes (lib/bitacora.mjs), con una carpeta temporal como carpeta de trabajo y como bóveda.
// No toca el CRM real ni D:/Magilus.
//   node trabajador-tablero/pruebas/probar-bitacora.mjs   (también corre dentro de npm run test:trabajador-tablero)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  crearBitacoraNocturna,
  fechaDeLaBitacora,
  incidentesParaElPrompt,
  leerEstadoDeLaBitacora,
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

  await prueba("(a2) 25-nov: la entrada trae la línea «- Qué se intentó:» y las claves nuevas de qué falló y cómo se resolvió", () => {
    const entrada = armarEntrada({ ...base, queFallo: "nube_sin_senal", comoSeResolvio: "sesion_nueva", clase: "nube", queSeIntento: { numero: 2, de: 3, detalle: "nube_sin_resultado; sesión nueva" } });
    const lineas = entrada.split("\n");
    assert.match(entrada, /^- Qué se intentó: intento 2 de 3 \(nube_sin_resultado; sesión nueva\)$/m);
    // Va entre la causa y cómo se resolvió.
    assert.ok(lineas.findIndex((l) => l.startsWith("- Causa:")) < lineas.findIndex((l) => l.startsWith("- Qué se intentó:")));
    assert.ok(lineas.findIndex((l) => l.startsWith("- Qué se intentó:")) < lineas.findIndex((l) => l.startsWith("- Cómo se resolvió:")));
    assert.match(entrada, /^- Qué falló: la sesión de la nube no dio señal ni dejó su resultado$/m);
    assert.match(entrada, /^- Cómo se resolvió: reintento en una sesión nueva de la nube/m);
    assert.match(entrada, /^- Regla: Si la nube no da señal, se reintenta en una sesión nueva/m);
    assert.match(resumenDeUnaLinea(entrada), / · qué se intentó: intento 2 de 3 \(nube_sin_resultado; sesión nueva\) · cómo se resolvió: /);
    // Sin el dato, la línea igual está y no inventa un número.
    assert.match(armarEntrada(base), /^- Qué se intentó: no registrado$/m);
    assert.match(armarEntrada({ ...base, queSeIntento: { numero: 1 } }), /^- Qué se intentó: intento 1 de 3$/m);
    const nuevas = { no_cambio_nada: "Claude terminó sin cambiar ningún archivo", fallan_pruebas: "fallaron las pruebas", reversion_falsa: "se deshizo antes de que el servidor bajara la versión nueva (reversión falsa)" };
    for (const [clave, texto] of Object.entries(nuevas)) assert.ok(armarEntrada({ ...base, queFallo: clave }).includes(`- Qué falló: ${texto}\n`), clave);
    const resueltas = { plan_nuevo: "se vuelve a planear la tarea", ya_en_main: "ya estaba hecho en main", resubir: "se vuelve a subir el mismo commit" };
    for (const [clave, texto] of Object.entries(resueltas)) assert.ok(armarEntrada({ ...base, comoSeResolvio: clave }).includes(`- Cómo se resolvió: ${texto}\n`), clave);
  });

  await prueba("(a3) 27-nov: la línea de una reparación trae causa, qué cambia y por qué es distinto (y el corte por misma causa)", () => {
    const porQue = {
      causa: "otra: La parte N no está en main",
      queCambia: "no se repara: se espera a la tarjeta de la que depende",
      porQueEsDistinto: "no se repara igual: la causa es la misma que la del intento anterior y no es del código",
    };
    const entrada = armarEntrada({ ...base, causa: "La parte 1 no está en main (commit 1a2b3c4d5e)", queFallo: "misma_causa", comoSeResolvio: "esperar_dependencia", clase: "misma_causa", porQue });
    const lineas = entrada.split("\n");
    assert.match(entrada, /^- Causa: otra: La parte N no está en main$/m, "la causa en una frase");
    assert.match(entrada, /^- Qué cambia: no se repara: se espera a la tarjeta de la que depende$/m);
    assert.match(entrada, /^- Por qué es distinto: no se repara igual: la causa es la misma/m);
    // Las tres van juntas, en ese orden, antes de qué se intentó.
    const donde = (inicio) => lineas.findIndex((l) => l.startsWith(inicio));
    assert.ok(donde("- Causa:") + 1 === donde("- Qué cambia:") && donde("- Qué cambia:") + 1 === donde("- Por qué es distinto:"));
    assert.ok(donde("- Por qué es distinto:") < donde("- Qué se intentó:"));
    assert.match(entrada, /^- Qué falló: se cortó: misma causa que el intento anterior$/m);
    assert.match(entrada, /^- Cómo se resolvió: se espera a la tarjeta de la que depende, sin reparar ni gastar intento$/m);
    assert.match(entrada, /^- Regla: Si la falla repite la causa del intento anterior, no se repara igual/m);
    // La copia de una línea para el cerebro también las trae.
    const resumen = resumenDeUnaLinea(entrada);
    assert.match(resumen, / · causa: otra: La parte N no está en main · qué cambia: no se repara: se espera a la tarjeta de la que depende · por qué es distinto: no se repara igual/);
    // La regla sigue mirando la causa completa (la frase corta cambia los números por N).
    assert.match(armarEntrada({ ...base, causa: "falla con postgres 16", clase: "codigo", porQue: { ...porQue, causa: "otra: falla con postgres N" } }), /^- Regla: .*Postgres 16/m);
    // Sin porQue (o vacío), la entrada es la de siempre: sin las dos líneas nuevas.
    for (const sin of [null, {}, { causa: "", queCambia: " " }]) {
      const vieja = armarEntrada({ ...base, porQue: sin });
      assert.doesNotMatch(vieja, /^- (?:Qué cambia|Por qué es distinto):/m);
      assert.doesNotMatch(resumenDeUnaLinea(vieja), /qué cambia|por qué es distinto/);
    }
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

  // Parte 3: el paso de la noche pasa la bitácora a docs/incidentes.md de cada repo (un repo git de prueba con un remoto bare local).
  await prueba("bitácora de la noche: crea docs/incidentes.md, no duplica, entra T-875 en gestion y no corre con una subida en curso", async () => {
    const N = fs.mkdtempSync(path.join(T, "noche-"));
    const gn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const crearRepo = (nombre) => {
      const remoto = path.join(N, `${nombre}.git`);
      const ruta = path.join(N, nombre);
      execFileSync("git", ["init", "--bare", "-b", "main", remoto], { stdio: "ignore" });
      fs.mkdirSync(path.join(ruta, "src"), { recursive: true });
      gn(ruta, "init", "-b", "main");
      fs.writeFileSync(path.join(ruta, "src", "a.ts"), "// a\n");
      gn(ruta, "add", "-A");
      gn(ruta, "commit", "-m", "base");
      gn(ruta, "remote", "add", "origin", remoto);
      gn(ruta, "push", "-q", "-u", "origin", "main");
      return { remoto, ruta };
    };
    const crm = crearRepo("aizencrm");
    const ges = crearRepo("gestion");
    const enRemoto = (remoto, archivo) => execFileSync("git", ["--git-dir", remoto, "show", `main:${archivo}`], { encoding: "utf8" });
    const commits = (remoto) => execFileSync("git", ["--git-dir", remoto, "rev-list", "--count", "main"], { encoding: "utf8" }).trim();
    const ultimoMensaje = (remoto) => execFileSync("git", ["--git-dir", remoto, "log", "-1", "--format=%s", "main"], { encoding: "utf8" }).trim();
    const veces = (texto, parte) => texto.split(parte).length - 1;

    const config = completarConfig(
      {
        urlCrm: "http://127.0.0.1:1",
        claveTrabajador: "aizen_trab_prueba",
        carpetaTrabajo: path.join(N, "trabajo"),
        git: { nombre: "Trabajador de prueba", correo: "trabajador@x.co" },
        repos: {
          aizencrm: { subirSolo: false, ruta: crm.ruta, ramaBase: "main", remoto: "origin" },
          gestion: { subirSolo: false, ruta: ges.ruta, ramaBase: "main", remoto: "origin" },
        },
      },
      N,
    );
    const log = registro();
    anotarIncidente({ config, registro: log, ...base });
    anotarIncidente({ config, registro: log, ...base, fecha: "2026-11-24 15:00", causa: "segunda causa" });
    const avisos = [];
    let ahora = new Date("2026-11-25T03:00:00Z"); // 22:00 en Bogotá: antes de la hora del manual (23)
    const noche = crearBitacoraNocturna({ config, registro: log, avisar: async (texto) => avisos.push(texto), entorno: process.env, ahora: () => ahora });
    const libre = { corriendo: () => 0 };

    assert.equal((await noche.revisar(libre)).motivo, "antes_de_la_hora");
    ahora = new Date("2026-11-25T04:30:00Z"); // 23:30 en Bogotá
    // Con una subida en curso no corre: no sube nada ni guarda estado.
    assert.equal((await noche.revisar({ corriendo: () => 1 })).motivo, "subiendo");
    assert.equal(commits(crm.remoto), "1");
    assert.equal(commits(ges.remoto), "1");
    assert.equal(leerEstadoDeLaBitacora(config.carpetaTrabajo), null);

    // Primera corrida: crea docs/incidentes.md en los dos repos y agrega las entradas nuevas.
    let resultado = await noche.revisar(libre);
    assert.equal(resultado.hizo, true, JSON.stringify(resultado));
    assert.equal(commits(crm.remoto), "2");
    assert.match(ultimoMensaje(crm.remoto), /^docs\(incidentes\): /);
    const textoCrm = enRemoto(crm.remoto, "docs/incidentes.md");
    assert.match(textoCrm, /^# Bitácora de incidentes: aizencrm\n/);
    assert.equal(veces(textoCrm, "<!-- incidente:ru2nd890:2026-11-24 14:05 -->"), 1);
    assert.equal(veces(textoCrm, "<!-- incidente:ru2nd890:2026-11-24 15:00 -->"), 1);
    assert.ok(textoCrm.indexOf("14:05") < textoCrm.indexOf("15:00"), "en el orden en que se anotaron");
    assert.ok(!textoCrm.includes("T-875"), "T-875 es de gestion, no de aizencrm");
    // gestion: sin entradas locales, entra T-875 (commit c42a476).
    assert.equal(commits(ges.remoto), "2");
    assert.match(ultimoMensaje(ges.remoto), /^docs\(incidentes\): /);
    const textoGes = enRemoto(ges.remoto, "docs/incidentes.md");
    assert.match(textoGes, /^# Bitácora de incidentes: gestion\n/);
    assert.equal(veces(textoGes, "<!-- incidente:T-875:fecha no registrada -->"), 1);
    assert.match(textoGes, /^- Repo: gestion \(commit c42a476\)$/m);
    assert.match(avisos.at(-1), /Bitácora de la noche: pasé 2 entrada\(s\) a aizencrm y 1 entrada\(s\) a gestion/);
    assert.equal(leerEstadoDeLaBitacora(config.carpetaTrabajo).hecho, true);
    assert.equal(fs.existsSync(path.join(config.carpetaTrabajo, "wt", "bitacora-nocturna-aizencrm")), false, "no deja la copia aparte");
    // El mismo día no se repite.
    assert.equal((await noche.revisar(libre)).motivo, "ya_hecho");

    // Segunda corrida (otro día), sin nada nuevo: no duplica ni hace commit.
    ahora = new Date("2026-11-26T04:30:00Z");
    resultado = await noche.revisar(libre);
    assert.equal(resultado.hizo, true, JSON.stringify(resultado));
    assert.equal(commits(crm.remoto), "2", "sin commit nuevo en aizencrm");
    assert.equal(commits(ges.remoto), "2", "sin commit nuevo en gestion");
    assert.equal(enRemoto(crm.remoto, "docs/incidentes.md"), textoCrm);
    assert.equal(enRemoto(ges.remoto, "docs/incidentes.md"), textoGes);

    // Otro día con una entrada nueva: solo entra esa, debajo de lo que ya estaba.
    anotarIncidente({ config, registro: log, ...base, fecha: "2026-11-26 09:00", causa: "tercera causa" });
    ahora = new Date("2026-11-27T04:30:00Z");
    resultado = await noche.revisar(libre);
    assert.equal(resultado.repos.aizencrm.nuevas, 1);
    assert.equal(commits(crm.remoto), "3");
    assert.equal(commits(ges.remoto), "2");
    const textoCrm2 = enRemoto(crm.remoto, "docs/incidentes.md");
    assert.ok(textoCrm2.startsWith(textoCrm.trimEnd()), "lo de antes queda igual");
    assert.equal(veces(textoCrm2, "<!-- incidente:"), 3);

    // Si git falla (el remoto desaparece), no lanza: avisa, cuenta el intento y para a los 3 intentos de la noche.
    anotarIncidente({ config, registro: log, ...base, fecha: "2026-11-27 09:00", causa: "cuarta causa" });
    fs.rmSync(crm.remoto, { recursive: true, force: true });
    ahora = new Date("2026-11-28T04:30:00Z");
    for (let i = 1; i <= 3; i += 1) {
      resultado = await noche.revisar(libre);
      assert.equal(resultado.motivo, "fallo", JSON.stringify(resultado));
      assert.equal(leerEstadoDeLaBitacora(config.carpetaTrabajo).intentos, i);
    }
    assert.equal((await noche.revisar(libre)).motivo, "sin_intentos");
    assert.ok(log.lineas.some((linea) => /^aviso: bitácora de la noche: no se subió nada a aizencrm/.test(linea)), log.lineas.join("\n"));
    assert.deepEqual(leerEstadoDeLaBitacora(config.carpetaTrabajo).listos, ["gestion"], "gestion quedó lista y no se reintenta");
  });
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

console.log(`\n${pruebas} pruebas pasaron`);
