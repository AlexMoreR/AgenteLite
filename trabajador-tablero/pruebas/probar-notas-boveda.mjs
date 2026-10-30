// Pruebas de las notas NUEVAS del cerebro en la bóveda (lib/notas-boveda.mjs), con un CRM falso y una carpeta temporal
// como bóveda. No toca el CRM real ni D:/Magilus.
//   node trabajador-tablero/pruebas/probar-notas-boveda.mjs   (también corre dentro de npm run test:trabajador-tablero)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { completarConfig } from "../lib/config.mjs";
import { crearCrm } from "../lib/crm.mjs";
import { REGISTRO_DEL_COORDINADOR, anotarAvisoAlCto, crearNotasDeBoveda, destinoEnLaBoveda, escribirNotaEnLaBoveda, fechaDelRegistro, problemaDeRuta, rutaDelEstadoDeNotas } from "../lib/notas-boveda.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "notas-boveda-"));
const registro = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(m), aviso: (m) => lineas.push(m), error: (m) => lineas.push(m) };
};

/** Un CRM falso: entrega `notas` mientras sigan PENDIENTES y anota cada marca. `fallarMarca` hace fallar los avisos. */
function crmFalso(notas, { fallarMarca = 0 } = {}) {
  const estado = new Map(notas.map((nota) => [nota.id, "PENDIENTE"]));
  const marcas = [];
  let fallas = fallarMarca;
  return {
    marcas,
    estado,
    async notasPorCrear() {
      return { ok: true, notas: notas.filter((nota) => estado.get(nota.id) === "PENDIENTE") };
    },
    async marcarNota(id, nuevo, motivo) {
      if (fallas > 0) {
        fallas -= 1;
        throw new Error("No se pudo hablar con el CRM (falso).");
      }
      marcas.push({ id, estado: nuevo, motivo });
      estado.set(id, nuevo);
      return { ok: true };
    },
  };
}

function armar(nombre) {
  const boveda = path.join(T, nombre, "Magilus");
  const trabajo = path.join(T, nombre, "trabajo");
  fs.mkdirSync(boveda, { recursive: true });
  const config = completarConfig(
    { urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } }, carpetaTrabajo: trabajo, boveda: { ruta: boveda } },
    T,
  );
  return { boveda, trabajo, config };
}

try {
  await prueba("config: boveda.ruta es opcional (apagado por defecto) y se resuelve a una ruta absoluta", () => {
    const sin = completarConfig({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } } });
    assert.deepEqual(sin.boveda, { ruta: null, cadaSegundos: 60 });
    const con = completarConfig({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } }, boveda: { ruta: "D:/Magilus" } }, T);
    assert.equal(con.boveda.ruta, path.resolve(T, "D:/Magilus"));
    assert.throws(() => completarConfig({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } }, boveda: { ruta: 3 } }), /boveda\.ruta/);
  });

  await prueba("rutas: se aceptan las de adentro; se rechazan .., absolutas, de unidad, raras y que no son .md/.txt", () => {
    for (const buena of ["Decisiones de Magilus.md", "Ventas/2026-10-26-x.md", "Ventas\\notas.txt"]) assert.equal(problemaDeRuta(buena), null, buena);
    for (const mala of ["", "../fuera.md", "Ventas/../../fuera.md", "/etc/x.md", "\\\\servidor\\x.md", "C:/Windows/x.md", "c:x.md", "a//b.md", "./a.md", "a/./b.md", "nota.exe", "nota.md.ps1", "nota", "a<b.md", "a|b.md", "Ventas./x.md", "x\u0000.md"]) {
      assert.ok(problemaDeRuta(mala), `debía rechazar ${JSON.stringify(mala)}`);
    }
  });

  await prueba("crea la nota nueva con sus carpetas y la marca CREADA", async () => {
    const { boveda, config } = armar("crear");
    const crm = crmFalso([
      { id: "n1", ruta: "Decisiones de Magilus.md", contenido: "### 2026-10-26\nSe quita la frase." },
      { id: "n2", ruta: "Ventas/Nuevas/2026-10-26-guion.md", contenido: "Guion nuevo" },
    ]);
    const cuenta = await crearNotasDeBoveda({ crm, config, registro: registro() }).vuelta();
    assert.deepEqual(cuenta, { creadas: 2, agregadas: 0, errores: 0, avisadas: 0 });
    assert.equal(fs.readFileSync(path.join(boveda, "Decisiones de Magilus.md"), "utf8"), "### 2026-10-26\nSe quita la frase.\n");
    assert.equal(fs.readFileSync(path.join(boveda, "Ventas", "Nuevas", "2026-10-26-guion.md"), "utf8"), "Guion nuevo\n");
    assert.deepEqual(crm.marcas.map((m) => [m.id, m.estado]), [["n1", "CREADA"], ["n2", "CREADA"]]);
  });

  await prueba("NUNCA sobrescribe: si ya existe, agrega al final con una línea separadora", async () => {
    const { boveda, config } = armar("agregar");
    const archivo = path.join(boveda, "Decisiones de Magilus.md");
    fs.writeFileSync(archivo, "# Decisiones\nLo de antes, que escribió el dueño.\n");
    const crm = crmFalso([
      { id: "a1", ruta: "Decisiones de Magilus.md", contenido: "### 2026-10-26\nPrimera" },
      { id: "a2", ruta: "Decisiones de Magilus.md", contenido: "### 2026-10-26\nSegunda" },
    ]);
    const cuenta = await crearNotasDeBoveda({ crm, config, registro: registro() }).vuelta();
    assert.equal(cuenta.agregadas, 2);
    assert.equal(
      fs.readFileSync(archivo, "utf8"),
      "# Decisiones\nLo de antes, que escribió el dueño.\n\n---\n\n### 2026-10-26\nPrimera\n\n---\n\n### 2026-10-26\nSegunda\n",
    );
    // Y sin salto final, lo mismo.
    fs.writeFileSync(path.join(boveda, "sin-salto.md"), "texto");
    escribirNotaEnLaBoveda(boveda, "sin-salto.md", "nuevo");
    assert.equal(fs.readFileSync(path.join(boveda, "sin-salto.md"), "utf8"), "texto\n\n---\n\nnuevo\n");
  });

  await prueba("una ruta maliciosa no escribe nada fuera de la bóveda y queda ERROR con su motivo", async () => {
    const { boveda, config } = armar("maliciosa");
    const fuera = path.join(path.dirname(boveda), "fuera.md");
    const crm = crmFalso([
      { id: "m1", ruta: "../fuera.md", contenido: "x" },
      { id: "m2", ruta: path.join(path.dirname(boveda), "absoluta.md"), contenido: "x" },
      { id: "m3", ruta: "script.ps1", contenido: "x" },
      { id: "m4", ruta: "bien.md", contenido: "ok" },
    ]);
    const cuenta = await crearNotasDeBoveda({ crm, config, registro: registro() }).vuelta();
    assert.deepEqual(cuenta, { creadas: 1, agregadas: 0, errores: 3, avisadas: 0 });
    assert.ok(!fs.existsSync(fuera));
    assert.ok(!fs.existsSync(path.join(path.dirname(boveda), "absoluta.md")));
    assert.deepEqual(fs.readdirSync(boveda), ["bien.md"]);
    const errores = crm.marcas.filter((m) => m.estado === "ERROR");
    assert.deepEqual(errores.map((m) => m.id), ["m1", "m2", "m3"]);
    assert.ok(errores.every((m) => m.motivo && m.motivo.length > 5));
  });

  await prueba("una unión o enlace dentro de la bóveda que apunta afuera tampoco sirve para salirse", () => {
    const { boveda } = armar("enlace");
    const afuera = path.join(T, "enlace", "afuera");
    fs.mkdirSync(afuera, { recursive: true });
    try {
      fs.symlinkSync(afuera, path.join(boveda, "puente"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // sin permiso para enlaces: no se puede probar aquí
    }
    assert.throws(() => destinoEnLaBoveda(boveda, "puente/x.md"), /se sale de la bóveda/);
    assert.ok(!fs.existsSync(path.join(afuera, "x.md")));
  });

  await prueba("si el aviso CREADA falla, la vuelta siguiente solo avisa: no escribe dos veces", async () => {
    const { boveda, config, trabajo } = armar("reintento");
    const crm = crmFalso([{ id: "r1", ruta: "Ventas/r.md", contenido: "una vez" }], { fallarMarca: 1 });
    const notas = crearNotasDeBoveda({ crm, config, registro: registro() });
    await assert.rejects(() => notas.vuelta(), /No se pudo hablar/);
    assert.ok(fs.existsSync(rutaDelEstadoDeNotas(trabajo)));
    const segunda = await notas.vuelta();
    assert.deepEqual(segunda, { creadas: 0, agregadas: 0, errores: 0, avisadas: 1 });
    assert.equal(fs.readFileSync(path.join(boveda, "Ventas", "r.md"), "utf8"), "una vez\n");
    assert.deepEqual(crm.marcas, [{ id: "r1", estado: "CREADA", motivo: undefined }]);
  });

  await prueba("sin boveda.ruta no pide nada; con la carpeta ausente no marca nada; revisar corre como mucho cada minuto", async () => {
    let pedidos = 0;
    const crm = { async notasPorCrear() { pedidos += 1; return { notas: [] }; }, async marcarNota() { throw new Error("no"); } };
    const apagado = completarConfig({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } } });
    assert.equal(await crearNotasDeBoveda({ crm, config: apagado, registro: registro() }).revisar(), null);
    assert.equal(pedidos, 0);

    const ausente = { ...apagado, boveda: { ruta: path.join(T, "no-existe"), cadaSegundos: 60 } };
    const r = registro();
    await crearNotasDeBoveda({ crm, config: ausente, registro: r }).vuelta();
    assert.equal(pedidos, 0);
    assert.ok(r.lineas.some((l) => /no existe la carpeta/.test(l)));

    const { config } = armar("reloj");
    let reloj = 0;
    const notas = crearNotasDeBoveda({ crm, config, registro: registro(), ahora: () => reloj });
    await notas.revisar();
    reloj = 30_000;
    assert.equal(await notas.revisar(), null);
    reloj = 61_000;
    await notas.revisar();
    assert.equal(pedidos, 2);
  });

  await prueba("cliente HTTP: GET para pedir las pendientes y POST para marcar, con la clave en Bearer", async () => {
    const llamadas = [];
    const fetchFalso = async (url, init) => {
      llamadas.push({ url, init });
      return new Response(JSON.stringify({ ok: true, notas: [] }), { status: 200 });
    };
    const crm = crearCrm({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x" }, { fetch: fetchFalso });
    await crm.notasPorCrear();
    await crm.marcarNota("n1", "ERROR", "ruta mala");
    assert.equal(llamadas[0].url, "https://crm.test/api/trabajador/cerebro/notas-por-crear");
    assert.equal(llamadas[0].init.method, "GET");
    assert.equal(llamadas[0].init.body, undefined);
    assert.equal(llamadas[0].init.headers.Authorization, "Bearer aizen_trab_x");
    assert.equal(llamadas[1].init.method, "POST");
    assert.deepEqual(JSON.parse(llamadas[1].init.body), { id: "n1", estado: "ERROR", motivo: "ruta mala" });
  });

  await prueba("aviso al CTO: agrega UNA fila fechada al final del registro del Coordinador, sin sobrescribir y sin repetirla", async () => {
    const boveda = path.join(T, "boveda-cto");
    fs.mkdirSync(path.join(boveda, "CRM-Gestion"), { recursive: true });
    const archivo = path.join(boveda, ...REGISTRO_DEL_COORDINADOR.split("/"));
    assert.equal(REGISTRO_DEL_COORDINADOR, "CRM-Gestion/2026-10-25-coordinador-registro.md");
    fs.writeFileSync(archivo, "# Coordinador — registro horario\n| 30-oct 09:00 | abcd1234 | coordinador | revisé |");
    // 30-oct-2026 19:05 UTC = 14:05 en Bogotá.
    const ahora = Date.UTC(2026, 9, 30, 19, 5);
    const tarjeta = { id: "cmvt24l7900hz2wmnykpl83z3", titulo: "Coordinador | parte 3" };
    const primera = anotarAvisoAlCto(boveda, { tarjeta, causas: ["no_compila: error TS2322", "lint: regla | x", "fallan_pruebas: not ok 3"], ahora });
    assert.equal(primera.accion, "agregada");
    assert.equal(
      fs.readFileSync(archivo, "utf8"),
      "# Coordinador — registro horario\n| 30-oct 09:00 | abcd1234 | coordinador | revisé |\n| 30-oct 14:05 | ykpl83z3 | coordinador | AVISO AL CTO: «Coordinador / parte 3» — causas: no_compila: error TS2322, lint: regla / x, fallan_pruebas: not ok 3 |\n",
    );
    // Otra vez con la misma tarjeta: no se repite.
    assert.equal(anotarAvisoAlCto(boveda, { tarjeta, causas: ["a", "b", "c"], ahora }).accion, "ya_estaba");
    assert.equal(fs.readFileSync(archivo, "utf8").split("\n").filter((linea) => linea.includes("AVISO AL CTO")).length, 1);
    // Otra tarjeta sí agrega su fila.
    assert.equal(anotarAvisoAlCto(boveda, { tarjeta: { id: "otra00000001", titulo: "Otra" }, causas: ["a", "b", "c"], ahora }).accion, "agregada");
    assert.equal(fs.readFileSync(archivo, "utf8").split("\n").filter((linea) => linea.includes("AVISO AL CTO")).length, 2);
  });

  await prueba("aviso al CTO: si el registro no existe lo crea con la fila; la fecha va en la hora de Bogotá", async () => {
    const boveda = path.join(T, "boveda-cto-vacia");
    fs.mkdirSync(boveda, { recursive: true });
    const hecho = anotarAvisoAlCto(boveda, { tarjeta: { id: "t1", titulo: "X" }, causas: ["a", "b", "c"], ahora: Date.UTC(2026, 10, 1, 3, 7) });
    assert.equal(hecho.accion, "agregada");
    assert.equal(fs.readFileSync(path.join(boveda, "CRM-Gestion", "2026-10-25-coordinador-registro.md"), "utf8"), "| 31-oct 22:07 | t1 | coordinador | AVISO AL CTO: «X» — causas: a, b, c |\n");
    assert.equal(fechaDelRegistro(new Date(Date.UTC(2026, 0, 5, 14, 0))), "5-ene 09:00");
  });

  await prueba("aviso al CTO: no escribe fuera de la bóveda aunque CRM-Gestion sea un enlace que sale", async () => {
    const boveda = path.join(T, "boveda-cto-enlace");
    const afuera = path.join(T, "afuera-cto");
    fs.mkdirSync(boveda, { recursive: true });
    fs.mkdirSync(afuera, { recursive: true });
    try {
      fs.symlinkSync(afuera, path.join(boveda, "CRM-Gestion"), "junction");
    } catch {
      return; // Sin permiso para enlaces: no se puede probar aquí.
    }
    assert.throws(() => anotarAvisoAlCto(boveda, { tarjeta: { id: "t1", titulo: "X" }, causas: ["a"] }), /se sale de la bóveda/);
    assert.deepEqual(fs.readdirSync(afuera), []);
  });
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

console.log(`\n${pruebas} pruebas pasaron`);
