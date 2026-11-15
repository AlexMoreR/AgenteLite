import { test } from "node:test";
import assert from "node:assert/strict";

import {
  esCortePasajeroDeRed,
  lineaDeFalloDeEnvioDeMedio,
  registrarFalloDeEnvioDeMedio,
} from "@/lib/registro-de-envio-de-medio";
// El mismo criterio que usa la vigilancia de 30 min para decidir si una línea del log es una falla.
import { esLineaDeErrorReal } from "../../trabajador-tablero/lib/zonas.mjs";

const DATOS = {
  resultado: "fallo",
  canal: "evolution",
  tipo: "DOCUMENT",
  conversationId: "cv8273ff183c29151fd15ad09e",
  pesoKb: 14416,
  gatewayMs: 5199,
  totalMs: 5645,
};

function timeoutError() {
  const falla = new Error("The operation was aborted due to timeout");
  falla.name = "TimeoutError";
  return falla;
}

/** Corre `registrarFalloDeEnvioDeMedio` y junta lo que escribe en console.error y console.info. */
function capturar(falla: unknown) {
  const errores: string[] = [];
  const infos: string[] = [];
  const error = console.error;
  const info = console.info;
  console.error = (...partes: unknown[]) => void errores.push(partes.map(String).join(" "));
  console.info = (...partes: unknown[]) => void infos.push(partes.map(String).join(" "));
  try {
    const esError = registrarFalloDeEnvioDeMedio(DATOS, falla);
    return { esError, errores, infos };
  } finally {
    console.error = error;
    console.info = info;
  }
}

test("fetch failed: una sola línea [envio-medio] informativa con causa sin-conexion", () => {
  const { esError, errores, infos } = capturar(new TypeError("fetch failed"));
  assert.equal(esError, false);
  assert.equal(errores.length, 0);
  assert.equal(infos.length, 1);
  const [linea] = infos;
  assert.ok(linea.startsWith("[envio-medio] "), linea);
  assert.ok(!linea.includes("\n"), "una sola línea");
  assert.ok(linea.includes('"causa":"sin-conexion"'), linea);
  assert.ok(!linea.includes("fetch failed"), linea);
  assert.ok(linea.includes('"pesoKb":14416'), linea);
  assert.equal(esLineaDeErrorReal(linea), false);
});

test("new Error('fetch failed') también cuenta como corte de red", () => {
  const { linea, esError } = lineaDeFalloDeEnvioDeMedio(DATOS, new Error("fetch failed"));
  assert.equal(esError, false);
  assert.ok(linea.includes('"causa":"sin-conexion"'), linea);
  assert.equal(esLineaDeErrorReal(linea), false);
});

test("conexión rechazada (ECONNREFUSED) no deja la palabra en la línea", () => {
  const falla = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:8080"), { code: "ECONNREFUSED" });
  const { linea, esError } = lineaDeFalloDeEnvioDeMedio(DATOS, falla);
  assert.equal(esError, false);
  assert.ok(linea.includes('"causa":"sin-conexion"'), linea);
  assert.equal(esLineaDeErrorReal(linea), false);
});

test("TimeoutError: causa tardo-demasiado y la línea no cuenta como error", () => {
  const { esError, errores, infos } = capturar(timeoutError());
  assert.equal(esError, false);
  assert.equal(errores.length, 0);
  assert.equal(infos.length, 1);
  assert.ok(infos[0].includes('"causa":"tardo-demasiado"'), infos[0]);
  assert.equal(esLineaDeErrorReal(infos[0]), false);
  assert.equal(esCortePasajeroDeRed(timeoutError()), true);
});

test("Evolution respondió 500: la línea sí cuenta como error", () => {
  const { esError, errores, infos } = capturar(new Error("Evolution respondió 500"));
  assert.equal(esError, true);
  assert.equal(infos.length, 0);
  assert.equal(errores.length, 1);
  const [linea] = errores;
  assert.ok(linea.startsWith("[envio-medio] "), linea);
  assert.ok(linea.includes('"error":"Evolution respondió 500"'), linea);
  assert.equal(esLineaDeErrorReal(linea), true);
  assert.equal(esCortePasajeroDeRed(new Error("Evolution respondió 500")), false);
});

test("falla sin mensaje: sigue como error con 'sin detalle'", () => {
  const { linea, esError } = lineaDeFalloDeEnvioDeMedio(DATOS, "algo raro");
  assert.equal(esError, true);
  assert.ok(linea.includes('"error":"sin detalle"'), linea);
  assert.equal(esLineaDeErrorReal(linea), true);
});
