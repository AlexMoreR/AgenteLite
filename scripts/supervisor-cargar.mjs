// Carga módulos .ts del repo transpilados (sin Next ni base), resolviendo imports relativos y el
// alias "@/". Lo usan las pruebas y herramientas del Supervisor (scripts/check-supervisor.mjs,
// scripts/supervisor-guardian.mjs, scripts/supervisor-simulacion.mjs).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireNativo = createRequire(path.join(RAIZ, "package.json"));
const ts = requireNativo("typescript");

const cache = new Map();

export function cargar(archivo, mocks = {}) {
  const absoluto = path.isAbsolute(archivo) ? archivo : path.resolve(RAIZ, archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (mocks[pedido]) return mocks[pedido];
    let base = null;
    if (pedido.startsWith("@/")) base = path.join(RAIZ, "src", pedido.slice(2));
    else if (pedido.startsWith(".")) base = path.resolve(path.dirname(absoluto), pedido);
    if (base) {
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato, mocks);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    requerir,
    mod,
    absoluto,
    path.dirname(absoluto),
  );
  return mod.exports;
}

export function leerJson(archivo) {
  return JSON.parse(fs.readFileSync(archivo, "utf8").replace(/^﻿/, ""));
}

export { RAIZ };
