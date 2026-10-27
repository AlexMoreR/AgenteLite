// Pruebas de "el Coordinador no se cuelga" (27-oct-2026), sin tocar nada real:
//   node trabajador-tablero/pruebas/probar-no-colgarse.mjs   (también corre dentro de npm run test:trabajador-tablero)
//
//   - un CRM FALSO que acepta la conexión y nunca contesta: el cliente falla a tiempo (no se queda esperando);
//   - un fetch que ignora la señal: el tope duro de crm.mjs igual corta;
//   - los trabajos de la vuelta con tope (lib/vuelta.mjs): uno colgado no frena la vuelta ni se lanza dos veces;
//   - el perro guardián del lanzador: marca de vida vieja -> mata y relanza; marca fresca o sin marca -> no toca.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { completarConfig } from "../lib/config.mjs";
import { crearCrm, ErrorDelCrm } from "../lib/crm.mjs";
import { crearMarcaDeVida, crearTareasConTope, rutaDeVivo } from "../lib/vuelta.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const COORDINADOR = path.resolve(AQUI, "..");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "no-colgarse-"));

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const registroDePrueba = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};

// Un CRM que acepta la conexión y nunca contesta (como el 27-oct: "fetch failed" y después silencio).
const colgados = [];
const crmMudo = http.createServer((pedido) => {
  colgados.push(pedido);
});
await new Promise((resolver) => crmMudo.listen(0, "127.0.0.1", resolver));
const urlMuda = `http://127.0.0.1:${crmMudo.address().port}`;

try {
  await prueba("config: perroGuardianMinutos es 10 por defecto y se puede cambiar", async () => {
    const base = { urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } } };
    assert.equal(completarConfig(base).perroGuardianMinutos, 10);
    assert.equal(completarConfig({ ...base, perroGuardianMinutos: 3 }).perroGuardianMinutos, 3);
    assert.throws(() => completarConfig({ ...base, perroGuardianMinutos: "mucho" }), /perroGuardianMinutos/);
  });

  await prueba("CRM falso que no responde: el pedido falla a tiempo con status 0 (no cuelga)", async () => {
    const crm = crearCrm({ urlCrm: urlMuda, claveTrabajador: "x" }, { timeoutMs: 300 });
    const inicio = Date.now();
    await assert.rejects(crm.tomar({ maxParalelo: 1 }), (error) => error instanceof ErrorDelCrm && error.status === 0 && /CRM/.test(error.message));
    await assert.rejects(crm.latidoDelCoordinador({}), (error) => error instanceof ErrorDelCrm && error.status === 0);
    assert.ok(Date.now() - inicio < 5000, `tardó ${Date.now() - inicio} ms`);
  });

  await prueba("un fetch que ignora la señal: el tope duro de crm.mjs igual corta", async () => {
    const crm = crearCrm({ urlCrm: "https://crm.test", claveTrabajador: "x" }, { fetch: () => new Promise(() => undefined), timeoutMs: 200 });
    const inicio = Date.now();
    await assert.rejects(crm.arranque(), (error) => error instanceof ErrorDelCrm && error.status === 0 && /no contestó/.test(error.message));
    assert.ok(Date.now() - inicio < 2000, `tardó ${Date.now() - inicio} ms`);
  });

  await prueba("tareas con tope: la colgada no frena la vuelta, no se lanza dos veces y las demás siguen", async () => {
    const registro = registroDePrueba();
    const marcas = [];
    const tareas = crearTareasConTope({ registro, antes: (nombre, ms) => marcas.push([nombre, ms]) });
    let soltar;
    let lanzadas = 0;
    const colgada = () => {
      lanzadas += 1;
      return new Promise((resolver) => {
        soltar = resolver;
      });
    };
    const inicio = Date.now();
    assert.equal((await tareas.correr("llenar", colgada, { topeMs: 100 })).estado, "tope");
    assert.ok(Date.now() - inicio < 1000);
    assert.ok(tareas.enVuelo("llenar"));
    assert.equal((await tareas.correr("llenar", colgada, { topeMs: 100 })).estado, "ocupada");
    assert.equal(lanzadas, 1, "no hay dos llenar a la vez");
    const otra = await tareas.correr("notas de la bóveda", async () => 7, { topeMs: 100 });
    assert.deepEqual(otra, { estado: "hecha", valor: 7 });
    const falla = await tareas.correr("rescate", async () => {
      throw new Error("sin red");
    }, { topeMs: 100 });
    assert.equal(falla.estado, "hecha");
    assert.equal(falla.error.message, "sin red");
    assert.deepEqual(marcas.map(([nombre]) => nombre), ["llenar", "notas de la bóveda", "rescate"]);
    assert.ok(registro.lineas.some((linea) => /llenar: lleva más de/.test(linea)));
    // Cuando por fin termina, se puede lanzar otra vez.
    soltar("listo");
    await new Promise((resolver) => setTimeout(resolver, 20));
    assert.ok(!tareas.enVuelo("llenar"));
    assert.ok(registro.lineas.some((linea) => /llenar: terminó tarde/.test(linea)));
    assert.equal((await tareas.correr("llenar", async () => 1, { topeMs: 100 })).estado, "hecha");
  });

  await prueba("la vuelta con el CRM falso que no responde sigue y deja la marca de vida", async () => {
    const carpeta = path.join(T, "vuelta");
    const crm = crearCrm({ urlCrm: urlMuda, claveTrabajador: "x" }, { timeoutMs: 1000 });
    const marca = crearMarcaDeVida(carpeta);
    const tareas = crearTareasConTope({ registro: registroDePrueba(), antes: (nombre, ms) => marca.ocupado(nombre, ms) });
    for (let vuelta = 0; vuelta < 3; vuelta += 1) {
      await tareas.correr("llenar", () => crm.tomar({}), { topeMs: 100 });
      marca.vueltaCompleta();
    }
    const vivo = JSON.parse(fs.readFileSync(rutaDeVivo(carpeta), "utf8"));
    assert.equal(vivo.pid, process.pid);
    assert.ok(Date.now() - Date.parse(vivo.ultimaVuelta) < 5000);
    assert.equal(vivo.ocupadoHasta, null);
    marca.ocupado("esperando la próxima vuelta", 60_000);
    const ocupado = JSON.parse(fs.readFileSync(rutaDeVivo(carpeta), "utf8"));
    assert.equal(ocupado.ocupadoEn, "esperando la próxima vuelta");
    assert.ok(Date.parse(ocupado.ocupadoHasta) > Date.now() + 50_000);
    assert.equal(ocupado.ultimaVuelta, vivo.ultimaVuelta);
  });

  // ── el perro guardián del lanzador (con un Coordinador falso) ─────────────────────────
  function armarLanzador(nombre, guion, { perroGuardianMinutos = 0.01 } = {}) {
    const base = path.join(T, nombre);
    const trabajo = path.join(base, "trabajo");
    fs.mkdirSync(trabajo, { recursive: true });
    const rutaConfig = path.join(base, "config.json");
    fs.writeFileSync(rutaConfig, JSON.stringify({ urlCrm: "http://127.0.0.1:1", claveTrabajador: "aizen_trab_x", carpetaTrabajo: trabajo, perroGuardianMinutos }));
    const script = path.join(base, "coordinador-falso.mjs");
    fs.writeFileSync(script, guion({ vivo: path.join(trabajo, "vivo.json"), marca: path.join(base, "ya-corri") }));
    const correr = () =>
      spawnSync(process.execPath, [path.join(COORDINADOR, "lanzador.mjs"), "--config", rutaConfig], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, LANZADOR_REPO: base, LANZADOR_SCRIPT: script, LANZADOR_PERRO_CADA_MS: "100" },
      });
    const leer = (archivo) => {
      try {
        return fs.readFileSync(path.join(trabajo, "logs", archivo), "utf8");
      } catch {
        return "";
      }
    };
    return { base, trabajo, correr, lanzadorLog: () => leer("lanzador.log"), logDelDia: () => leer(`trabajador-${new Date().toISOString().slice(0, 10)}.log`) };
  }

  await prueba("perro guardián: marca de vida vieja -> el lanzador mata al Coordinador colgado y lo relanza", async () => {
    // 1.ª corrida: deja una marca de hace 1 h y se cuelga (vivo, sin hacer nada). 2.ª corrida: sale con 7.
    const r = armarLanzador(
      "perro-reinicia",
      ({ vivo, marca }) => `import fs from "node:fs";
if (fs.existsSync(${JSON.stringify(marca)})) process.exit(7);
fs.writeFileSync(${JSON.stringify(marca)}, "1");
const hace = new Date(Date.now() - 3_600_000).toISOString();
fs.writeFileSync(${JSON.stringify(vivo)}, JSON.stringify({ pid: process.pid, en: hace, ultimaVuelta: hace, ocupadoEn: "llenar", ocupadoHasta: hace }));
setInterval(() => undefined, 1000);
`,
    );
    const inicio = Date.now();
    const resultado = r.correr();
    assert.equal(resultado.status, 7, resultado.stdout + resultado.stderr);
    assert.ok(Date.now() - inicio < 30_000);
    assert.match(r.lanzadorLog(), /perro guardián: el Coordinador \(pid \d+\) lleva .* min sin marca de vida \(lo último que hacía: llenar\); está colgado/);
    assert.match(r.lanzadorLog(), /el Coordinador colgado terminó .*: lo arranco de nuevo/);
    assert.match(r.logDelDia(), /\[ERROR\] \[LANZADOR\] perro guardián/);
    assert.match(r.lanzadorLog(), /el Coordinador salió con código 7/);
  });

  await prueba("perro guardián: con la marca al día (o ocupadoHasta en el futuro) no reinicia", async () => {
    const r = armarLanzador(
      "perro-fresco",
      ({ vivo }) => `import fs from "node:fs";
const marcar = (extra) => fs.writeFileSync(${JSON.stringify(vivo)}, JSON.stringify({ pid: process.pid, en: new Date().toISOString(), ultimaVuelta: new Date().toISOString(), ...extra }));
marcar({});
const reloj = setInterval(() => marcar({}), 100);
// Después una espera larga declarada: ocupadoHasta en el futuro, sin marcar más.
setTimeout(() => { clearInterval(reloj); const viejo = new Date(Date.now() - 3_600_000).toISOString(); fs.writeFileSync(${JSON.stringify(vivo)}, JSON.stringify({ pid: process.pid, en: viejo, ultimaVuelta: viejo, ocupadoEn: "manual de la noche", ocupadoHasta: new Date(Date.now() + 60_000).toISOString() })); }, 1500);
setTimeout(() => process.exit(5), 3000);
`,
    );
    const resultado = r.correr();
    assert.equal(resultado.status, 5, resultado.stdout + resultado.stderr);
    assert.doesNotMatch(r.lanzadorLog(), /perro guardián/);
  });

  await prueba("perro guardián: un Coordinador viejo que no escribe vivo.json (o la de otro pid) no se reinicia", async () => {
    const r = armarLanzador(
      "perro-sin-marca",
      ({ vivo }) => `import fs from "node:fs";
const hace = new Date(Date.now() - 3_600_000).toISOString();
fs.writeFileSync(${JSON.stringify(vivo)}, JSON.stringify({ pid: 1, en: hace, ultimaVuelta: hace }));
setTimeout(() => process.exit(4), 1500);
`,
    );
    const resultado = r.correr();
    assert.equal(resultado.status, 4, resultado.stdout + resultado.stderr);
    assert.doesNotMatch(r.lanzadorLog(), /perro guardián/);
  });

  await prueba("perro guardián: perroGuardianMinutos 0 lo apaga", async () => {
    const r = armarLanzador(
      "perro-apagado",
      ({ vivo }) => `import fs from "node:fs";
const hace = new Date(Date.now() - 3_600_000).toISOString();
fs.writeFileSync(${JSON.stringify(vivo)}, JSON.stringify({ pid: process.pid, en: hace, ultimaVuelta: hace }));
setTimeout(() => process.exit(6), 1000);
`,
      { perroGuardianMinutos: 0 },
    );
    const resultado = r.correr();
    assert.equal(resultado.status, 6, resultado.stdout + resultado.stderr);
    assert.doesNotMatch(r.lanzadorLog(), /perro guardián/);
  });
} finally {
  for (const pedido of colgados) pedido.socket?.destroy();
  crmMudo.close();
  try {
    fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows a veces tiene un archivo abierto un instante: queda en la carpeta temporal.
  }
}

console.log(`\n${pruebas} pruebas de no colgarse, todas bien`);
