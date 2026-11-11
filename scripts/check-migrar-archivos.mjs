/**
 * Prueba scripts/migrar-archivos-de-mensajes.mjs contra un servidor FALSO local (http.createServer):
 * que simule por defecto, que mande el secreto y el ultimo id, la pausa entre tandas, los topes por
 * minuto, el freno por carga (a la 3.a seguida termina), que corte con un error y el reporte final.
 * No toca ninguna app ni base real.
 *
 *   node scripts/check-migrar-archivos.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

const SCRIPT = path.resolve("scripts/migrar-archivos-de-mensajes.mjs");
const SECRETO = "secreto-de-prueba";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** Un servidor que contesta en orden las respuestas dadas y anota cada pedido. */
async function servidor(respuestas) {
  const pedidos = [];
  const server = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (pedazo) => (cuerpo += pedazo));
    req.on("end", () => {
      pedidos.push({ en: Date.now(), url: req.url, metodo: req.method, auth: req.headers.authorization, cuerpo: JSON.parse(cuerpo || "{}") });
      const siguiente = respuestas[Math.min(pedidos.length - 1, respuestas.length - 1)];
      const { estado = 200, ...json } = siguiente;
      res.writeHead(estado, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { pedidos, url: `http://127.0.0.1:${server.address().port}`, cerrar: () => new Promise((r) => server.close(r)) };
}

function correr(args, env = { MIGRACION_SECRETO: SECRETO }) {
  return new Promise((resolve) => {
    const base = { ...process.env };
    delete base.MIGRACION_SECRETO;
    delete base.DAILY_REPORT_CRON_SECRET;
    const hijo = spawn(process.execPath, [SCRIPT, ...args], { env: { ...base, ...env } });
    let salida = "";
    hijo.stdout.on("data", (d) => (salida += d));
    hijo.stderr.on("data", (d) => (salida += d));
    hijo.on("close", (codigo) => resolve({ codigo, salida }));
  });
}

const tanda = (extra) => ({
  ok: true,
  simulacion: true,
  procesados: 2,
  migrados: 2,
  saltados: [],
  mbAArchivo: 1.5,
  mbNuevosEnDisco: 1,
  mbLiberadosEnBase: 1.4,
  casosDeMediaUrl: { externo_con_clave: 1, se_queda_local: 1 },
  terminado: false,
  ...extra,
});

await prueba("simula por defecto, manda secreto y ultimo id, respeta la pausa y arma el reporte", async () => {
  const s = await servidor([
    tanda({ ultimoId: "m02" }),
    tanda({ ultimoId: "m04", saltados: [{ id: "m03", motivo: "base64 roto en evolution.data.base64" }] }),
    tanda({ ultimoId: "m05", procesados: 1, migrados: 1, terminado: true }),
  ]);
  const { codigo, salida } = await correr([`--url=${s.url}`, "--pausa=0.3"]);
  await s.cerrar();
  assert.equal(codigo, 0, salida);
  assert.equal(s.pedidos.length, 3);
  for (const pedido of s.pedidos) {
    assert.equal(pedido.metodo, "POST");
    assert.equal(pedido.url, "/api/interno/archivos-de-mensajes");
    assert.equal(pedido.auth, `Bearer ${SECRETO}`);
    assert.equal(pedido.cuerpo.simulacion, true);
    assert.equal(pedido.cuerpo.tanda, 20);
  }
  assert.equal(s.pedidos[0].cuerpo.desdeId, undefined);
  assert.equal(s.pedidos[1].cuerpo.desdeId, "m02");
  assert.equal(s.pedidos[2].cuerpo.desdeId, "m04");
  assert.ok(s.pedidos[1].en - s.pedidos[0].en >= 280, "pausa entre tandas");
  assert.match(salida, /SIMULACION \(no escribe nada\)/);
  assert.match(salida, /Fin: terminado: no quedan mensajes/);
  assert.match(salida, /Tandas: 3 · mensajes vistos: 5 · migrables: 5/);
  assert.match(salida, /MB pasados a archivos: 4\.5 · MB nuevos en disco \(sin repetidos\): 3 · MB liberados de la base: 4\.2/);
  assert.match(salida, /"externo_con_clave":3/);
  assert.match(salida, /1 × base64 roto en evolution\.data\.base64/);
  assert.match(salida, /Ultimo id: m05/);
});

await prueba("--de-verdad manda simulacion:false; --desde y --tanda llegan a la ruta; --maximo-de-tandas corta", async () => {
  const s = await servidor([tanda({ ultimoId: "x9" })]);
  const { codigo, salida } = await correr([`--url=${s.url}`, "--de-verdad", "--desde=x1", "--tanda=7", "--pausa=0", "--maximo-de-tandas=2"]);
  await s.cerrar();
  assert.equal(codigo, 0, salida);
  assert.equal(s.pedidos.length, 2);
  assert.equal(s.pedidos[0].cuerpo.simulacion, false);
  assert.equal(s.pedidos[0].cuerpo.desdeId, "x1");
  assert.equal(s.pedidos[0].cuerpo.tanda, 7);
  assert.match(salida, /MIGRACION DE VERDAD/);
  assert.match(salida, /maximo de 2 tandas/);
});

await prueba("--dry-run es lo mismo que --simular", async () => {
  const s = await servidor([tanda({ ultimoId: "a", terminado: true })]);
  const { codigo } = await correr([`--url=${s.url}`, "--dry-run", "--de-verdad", "--dry-run", "--pausa=0"]);
  await s.cerrar();
  assert.equal(codigo, 0);
  assert.equal(s.pedidos[0].cuerpo.simulacion, true, "la ultima opcion manda");
});

await prueba("topes por minuto: espera a que se libere la ventana", async () => {
  const s = await servidor([tanda({ ultimoId: "a" }), tanda({ ultimoId: "b" }), tanda({ ultimoId: "c", terminado: true })]);
  const { codigo, salida } = await correr([`--url=${s.url}`, "--pausa=0", "--mensajes-por-minuto=3", "--ventana=0.6"]);
  await s.cerrar();
  assert.equal(codigo, 0, salida);
  assert.equal(s.pedidos.length, 3);
  assert.ok(s.pedidos[1].en - s.pedidos[0].en < 400, "2 < 3: sigue enseguida");
  assert.ok(s.pedidos[2].en - s.pedidos[1].en >= 150, "4 >= 3: espera a que salga la primera tanda de la ventana");

  const t = await servidor([tanda({ ultimoId: "a", mbAArchivo: 70 }), tanda({ ultimoId: "b", terminado: true })]);
  await correr([`--url=${t.url}`, "--pausa=0", "--ventana=0.5"]);
  await t.cerrar();
  assert.ok(t.pedidos[1].en - t.pedidos[0].en >= 400, "70 MB >= 60 MB por minuto: espera");
});

await prueba("freno por carga: espera, sigue si se libera; a la 3.a seguida termina", async () => {
  const s = await servidor([{ ok: true, parado: "carga: cpu 0.9" }, tanda({ ultimoId: "a", terminado: true })]);
  const r1 = await correr([`--url=${s.url}`, "--pausa=0", "--espera-por-carga=0.3"]);
  await s.cerrar();
  assert.equal(r1.codigo, 0, r1.salida);
  assert.equal(s.pedidos.length, 2);
  assert.ok(s.pedidos[1].en - s.pedidos[0].en >= 280, "espero antes de reintentar");

  const t = await servidor([{ ok: true, parado: "carga: cpu 0.9" }]);
  const r2 = await correr([`--url=${t.url}`, "--pausa=0", "--espera-por-carga=0"]);
  await t.cerrar();
  assert.equal(r2.codigo, 0);
  assert.equal(t.pedidos.length, 3);
  assert.match(r2.salida, /cargada 3 veces seguidas/);
});

await prueba("un error de la ruta termina con codigo 1 y lo dice", async () => {
  const s = await servidor([tanda({ ultimoId: "a" }), { estado: 500, ok: false, error: "se cayo la base" }]);
  const { codigo, salida } = await correr([`--url=${s.url}`, "--pausa=0"]);
  await s.cerrar();
  assert.equal(codigo, 1);
  assert.match(salida, /la ruta respondio 500: se cayo la base/);
  assert.match(salida, /=== REPORTE/);

  const sinRespuesta = await correr(["--url=http://127.0.0.1:1", "--pausa=0"]);
  assert.equal(sinRespuesta.codigo, 1);
  assert.match(sinRespuesta.salida, /no se pudo llamar a la ruta/);
});

await prueba("una tanda que tarda mas del tope termina", async () => {
  const lento = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(tanda({ ultimoId: "a" })));
    }, 400));
  });
  await new Promise((resolve) => lento.listen(0, "127.0.0.1", resolve));
  const { codigo, salida } = await correr([`--url=http://127.0.0.1:${lento.address().port}`, "--pausa=0", "--tope-por-tanda=0.2"]);
  await new Promise((r) => lento.close(r));
  assert.equal(codigo, 0, salida);
  assert.match(salida, /una tanda tardo .* \(tope 0\.2s\)/);
});

await prueba("sin secreto no llama a nada; opcion desconocida falla", async () => {
  const sinSecreto = await correr(["--pausa=0"], {});
  assert.equal(sinSecreto.codigo, 2);
  assert.match(sinSecreto.salida, /Falta MIGRACION_SECRETO/);
  const rara = await correr(["--borrar-todo"]);
  assert.equal(rara.codigo, 1);
  assert.match(rara.salida, /opcion desconocida/);
});

console.log(`\n${pruebas} pruebas OK`);
