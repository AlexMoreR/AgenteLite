// Pruebas rápidas de CÓMO ESCOGE, PARTE Y SUBE el Coordinador (25-oct-2026), sin CRM ni Claude:
//   node trabajador-tablero/pruebas/probar-reparto.mjs   (va dentro de npm run test:trabajador-tablero)
//
// - choques: los .md (docs/que-es-esta-aplicacion.md) y los globs de repos.<x>.sinChoque no hacen chocar; la parte
//   "5. Archivos" se encuentra por su encabezado aunque la parte 1 tenga una lista numerada;
// - cola de pasos pesados: de a `maximo`, primero subir, después verificar, después preparar; se cancela con la señal;
// - reparto: el orden de las candidatas, cuándo se parte antes de construir y que las partes no agreguen alcance;
// - subir: rebaseSobre junta solo los dos lados de un .md y deja el worktree limpio si choca código;
// - el planificador manda en `excluir` todas menos la elegida;
// - configuración: los valores por defecto nuevos.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { crearPlanificador } from "../lib/bucle.mjs";
import { archivosDelPlan, huellaDeTarjeta, motivoDeChoque, noChoca } from "../lib/choques.mjs";
import { COLA_LIBRE, PRIORIDAD, crearColaPesada } from "../lib/cola.mjs";
import { completarConfig } from "../lib/config.mjs";
import { crearEstadoDeMotores } from "../lib/motores.mjs";
import { rebaseSobre } from "../lib/git.mjs";
import { debePartirAntes, ordenarCandidatas, partesSinAlcanceNuevo, tamanoDelPlan } from "../lib/reparto.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const planCon = (...archivos) => ["1. Qué se cambia", "5. Archivos que se tocan", ...archivos.map((a) => `- ${a}`), "6. Cómo se va a probar: npm test"].join("\n");

await prueba("choques: docs/que-es-esta-aplicacion.md (y cualquier .md) no hace chocar; sinChoque se configura por repo", async () => {
  const repo = { zonasProtegidas: {} };
  const h = (id, plan, repoConfig = repo) => huellaDeTarjeta({ id, titulo: id, repo: "aizencrm", plan }, "construir", repoConfig);
  const a = h("a", planCon("src/features/coach/a.ts", "docs/que-es-esta-aplicacion.md"));
  const b = h("b", planCon("src/features/ventas/b.ts", "docs/que-es-esta-aplicacion.md", "trabajador-tablero/README.md"));
  assert.equal(motivoDeChoque(a, b), null, "las dos tocan el manual, pero eso no es choque");
  // Una que SOLO toca documentos no choca con nadie (y no es "el plan no dice archivos").
  const soloDocs = h("c", planCon("docs/que-es-esta-aplicacion.md"));
  assert.deepEqual([...soloDocs.modulos], []);
  assert.equal(motivoDeChoque(a, soloDocs), null);
  // Configurable: un archivo de solo agregar que no es .md.
  const conLista = { zonasProtegidas: {}, sinChoque: ["**/*.md", "src/lib/mcp/registro-de-herramientas.ts"] };
  const x = h("x", planCon("src/lib/mcp/registro-de-herramientas.ts", "src/features/uno/a.ts"), conLista);
  const y = h("y", planCon("src/lib/mcp/registro-de-herramientas.ts", "src/features/dos/b.ts"), conLista);
  assert.equal(motivoDeChoque(x, y), null);
  assert.match(motivoDeChoque(h("x2", planCon("src/lib/mcp/registro-de-herramientas.ts")), h("y2", planCon("src/lib/mcp/registro-de-herramientas.ts"))), /módulo/, "sin la lista, sí chocan");
  assert.equal(noChoca("docs/que-es-esta-aplicacion.md"), true);
  assert.equal(noChoca("src/a.ts"), false);
  // El mismo archivo de código sigue chocando.
  assert.match(motivoDeChoque(h("p", planCon("src/features/coach/a.ts")), h("q", planCon("src/features/coach/b.ts"))), /features\/coach/);
});

await prueba("choques: la parte 5 se busca por su encabezado 'Archivos' (una lista numerada en la parte 1 no la tapa)", async () => {
  const plan = [
    "## 1. Qué se cambia",
    "1. **Pantalla** nueva",
    "5. **Vigilancia** cada hora (src/features/otra/nada.ts no es de la parte 5)",
    "## 5. Archivos que se tocan",
    "- `src/features/coach/a.ts`",
    "- docs/que-es-esta-aplicacion.md",
    "## 6. Cómo se va a probar",
    "- scripts/check-tableros-reglas.mjs",
  ].join("\n");
  assert.deepEqual(archivosDelPlan(plan).sort(), ["docs/que-es-esta-aplicacion.md", "src/features/coach/a.ts"]);
  // Sin archivos en la parte 5, se buscan en todo el plan (no queda "el plan no dice archivos").
  assert.deepEqual(archivosDelPlan("## 5. Archivos que se tocan\nlos de siempre\n## 6. Pruebas\nsrc/x/a.ts"), ["src/x/a.ts"]);
});

await prueba("cola de pasos pesados: de a uno, primero subir, después verificar, después preparar; se cancela con la señal", async () => {
  const cola = crearColaPesada({ maximo: 1 });
  const orden = [];
  const primero = await cola.tomar({ prioridad: PRIORIDAD.preparar, que: "npm ci A" });
  assert.equal(cola.estado().ocupados, 1);
  const esperas = [
    cola.tomar({ prioridad: PRIORIDAD.preparar, que: "npm ci B" }).then((liberar) => (orden.push("preparar B"), liberar)),
    cola.tomar({ prioridad: PRIORIDAD.verificar, que: "build C" }).then((liberar) => (orden.push("verificar C"), liberar)),
    cola.tomar({ prioridad: PRIORIDAD.subir, que: "build D" }).then((liberar) => (orden.push("subir D"), liberar)),
  ];
  const control = new AbortController();
  const cancelada = cola.tomar({ prioridad: PRIORIDAD.subir, senal: control.signal, que: "cancelada" });
  assert.equal(cola.estado().esperando, 4);
  control.abort();
  await assert.rejects(cancelada, (error) => error.cancelado === true);
  assert.deepEqual(cola.estado().enFila, ["build D", "build C", "npm ci B"]);
  primero();
  primero(); // liberar dos veces no suelta dos puestos
  const liberarD = await esperas[2];
  assert.deepEqual(orden, ["subir D"]);
  assert.equal(cola.estado().ocupados, 1, "nunca dos a la vez");
  liberarD();
  const liberarC = await esperas[1];
  assert.deepEqual(orden, ["subir D", "verificar C"]);
  assert.equal(cola.estado().ocupados, 1);
  liberarC();
  const liberarB = await esperas[0];
  liberarB();
  assert.deepEqual(orden, ["subir D", "verificar C", "preparar B"]);
  assert.equal(cola.estado().ocupados, 0);
  const liberarLibre = await COLA_LIBRE.tomar();
  liberarLibre();
});

await prueba("reparto: subir > construir > planear; la que desbloquea; la más chica; un plan sin archivos al final", async () => {
  const candidatas = [
    { id: "grande", hacer: "construir", plan: planCon(...Array.from({ length: 12 }, (_, i) => `src/features/g/${i}.ts`)) },
    { id: "plan", hacer: "planear", plan: null },
    { id: "chica", hacer: "construir", plan: planCon("src/features/c/a.ts", "docs/que-es-esta-aplicacion.md") },
    { id: "sinArchivos", hacer: "construir", plan: "Cambiar el color del botón." },
    { id: "desbloquea", hacer: "construir", plan: planCon(...Array.from({ length: 6 }, (_, i) => `src/features/d/${i}.ts`)), desbloquea: 2 },
    { id: "subir", hacer: "subir", plan: planCon("src/features/s/a.ts") },
  ];
  assert.deepEqual(
    ordenarCandidatas(candidatas).map((c) => c.id),
    ["subir", "desbloquea", "chica", "grande", "sinArchivos", "plan"],
  );
  assert.equal(tamanoDelPlan(planCon("src/a/x.ts", "docs/que-es-esta-aplicacion.md")), 1, "los .md no cuentan");
  assert.equal(candidatas[0].id, "grande", "no cambia la lista que recibe");
});

await prueba("reparto: se parte ANTES de construir solo una tarea muy grande que no es parte, ni está partida, ni viene de una reparación", async () => {
  const muchos = planCon(...Array.from({ length: 26 }, (_, i) => `src/features/m${i % 4}/${i}.ts`), "docs/que-es-esta-aplicacion.md");
  assert.equal(debePartirAntes({ plan: muchos }).partir, true);
  assert.equal(debePartirAntes({ plan: muchos, esParte: true }).partir, false);
  assert.equal(debePartirAntes({ plan: muchos, resultado: { partida: { hijas: ["a", "b"] } } }).partir, false);
  assert.equal(debePartirAntes({ plan: muchos, reparaciones: 1 }).partir, false);
  assert.equal(debePartirAntes({ plan: muchos }, { partir: { archivosAntes: 0 } }).partir, false, "0 = apagado");
  assert.equal(debePartirAntes({ plan: planCon("src/features/a/x.ts") }).partir, false);
  assert.equal(debePartirAntes({ plan: "sin archivos" }).partir, false);
  // Migración + pantalla con más de 15 archivos de código.
  const mixto = planCon("prisma/schema.prisma", "prisma/migrations/2026_x/migration.sql", "src/app/cliente/x/page.tsx", ...Array.from({ length: 14 }, (_, i) => `src/lib/y${i}.ts`));
  assert.equal(debePartirAntes({ plan: mixto }).partir, true);
  assert.match(debePartirAntes({ plan: mixto }).motivo, /migración y pantalla/);
});

await prueba("reparto: las partes heredan la aprobación solo si no agregan alcance (módulos que el plan no nombra)", async () => {
  const madre = planCon("src/features/coach/a.ts", "src/features/coach/b.ts", "src/app/actions/coach-actions.ts", "prisma/schema.prisma");
  const dentro = [
    { titulo: "Base", detalle: planCon("prisma/schema.prisma", "prisma/migrations/2026_y/migration.sql", "src/features/coach/a.ts") },
    { titulo: "Pantalla", detalle: planCon("src/features/coach/c.ts", "src/app/actions/otra-accion.ts", "docs/que-es-esta-aplicacion.md", "scripts/check-coach.mjs") },
  ];
  assert.deepEqual(partesSinAlcanceNuevo(madre, dentro), { ok: true, fuera: [] });
  const fuera = [...dentro, { titulo: "Extra", detalle: planCon("src/features/ventas/nuevo.ts") }];
  assert.deepEqual(partesSinAlcanceNuevo(madre, fuera), { ok: false, fuera: ["features/ventas"] });
});

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

await prueba("subir: rebaseSobre junta solo los dos lados de un .md; si choca código, aborta y deja el worktree limpio", async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "reparto-"));
  try {
    const repo = path.join(T, "repo");
    fs.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    fs.mkdirSync(path.join(repo, "docs"));
    fs.writeFileSync(path.join(repo, "docs", "que-es-esta-aplicacion.md"), "# Manual\n\n- base\n");
    fs.writeFileSync(path.join(repo, "codigo.ts"), "export const a = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");
    git(repo, "checkout", "-q", "-b", "tarea");
    fs.appendFileSync(path.join(repo, "docs", "que-es-esta-aplicacion.md"), "- lo de la tarea\n");
    git(repo, "commit", "-q", "-am", "tarea");
    git(repo, "checkout", "-q", "main");
    fs.appendFileSync(path.join(repo, "docs", "que-es-esta-aplicacion.md"), "- lo de main\n");
    git(repo, "commit", "-q", "-am", "main");
    git(repo, "checkout", "-q", "tarea");
    const identidad = { nombre: "Prueba", correo: "prueba@x.co" };
    const ok = await rebaseSobre(repo, "main", { identidad, carpetaTrabajo: T, nombre: "prueba" });
    assert.equal(ok.ok, true, ok.detalle);
    const manual = fs.readFileSync(path.join(repo, "docs", "que-es-esta-aplicacion.md"), "utf8");
    assert.match(manual, /lo de main/);
    assert.match(manual, /lo de la tarea/);
    assert.doesNotMatch(manual, /<<<<<<<|>>>>>>>/);

    // Código: choca de verdad, se aborta y se avisa el archivo.
    git(repo, "checkout", "-q", "-b", "tarea2", "main");
    fs.writeFileSync(path.join(repo, "codigo.ts"), "export const a = 2;\n");
    git(repo, "commit", "-q", "-am", "tarea2");
    git(repo, "checkout", "-q", "main");
    fs.writeFileSync(path.join(repo, "codigo.ts"), "export const a = 3;\n");
    git(repo, "commit", "-q", "-am", "main2");
    git(repo, "checkout", "-q", "tarea2");
    const choca = await rebaseSobre(repo, "main", { identidad, carpetaTrabajo: T, nombre: "prueba" });
    assert.equal(choca.ok, false);
    assert.deepEqual(choca.conflicto, ["codigo.ts"]);
    assert.equal(git(repo, "status", "--porcelain"), "", "worktree limpio después del abort");
    assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD"), "tarea2");
  } finally {
    fs.rmSync(T, { recursive: true, force: true });
  }
});

await prueba("escoger: el planificador manda en `excluir` todas las libres menos la elegida (la más cerca de HECHO y más chica)", async () => {
  const config = completarConfig({ urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: "." } }, maxParalelo: 2 });
  const pedidos = [];
  const crm = {
    candidatas: async () => ({
      candidatas: [
        { id: "vieja-grande", titulo: "vieja", repo: "aizencrm", hacer: "construir", plan: planCon(...Array.from({ length: 10 }, (_, i) => `src/features/g/${i}.ts`)) },
        { id: "planear", titulo: "planear", repo: "aizencrm", hacer: "planear", plan: null },
        { id: "chica", titulo: "chica", repo: "aizencrm", hacer: "construir", plan: planCon("src/features/c/a.ts") },
      ],
    }),
    tomar: async (datos) => {
      pedidos.push(datos);
      return { tarjeta: null, motivo: "prueba" };
    },
  };
  const planificador = crearPlanificador({
    crm,
    config,
    registro: { info: () => undefined, aviso: () => undefined, error: () => undefined },
    medidor: { medir: () => ({ cpu: 10, memoria: 20 }), parar: () => undefined },
    motores: crearEstadoDeMotores(config),
    vigilante: null,
  });
  await planificador.llenar();
  assert.equal(pedidos.length, 1);
  assert.deepEqual([...pedidos[0].excluir].sort(), ["planear", "vieja-grande"]);
  planificador.parar();
});

await prueba("configuración: cola de pasos pesados de 1, CPU promedio de 3 min, partir antes con 25 archivos, .md sin choque", async () => {
  const base = { urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: "." } } };
  const config = completarConfig(base);
  assert.deepEqual(config.colaPesada, { maximo: 1 });
  assert.equal(config.limites.cpuPromedioMinutos, 3);
  assert.deepEqual(config.partir, { archivosMinimos: 8, archivosAntes: 25, archivosConMigracion: 15 });
  assert.deepEqual(config.repos.aizencrm.sinChoque, ["**/*.md"]);
  assert.deepEqual(completarConfig({ ...base, repos: { aizencrm: { ruta: ".", sinChoque: ["**/*.md", "CHANGELOG.txt"] } } }).repos.aizencrm.sinChoque, ["**/*.md", "CHANGELOG.txt"]);
  assert.equal(completarConfig({ ...base, colaPesada: { maximo: 0 } }).colaPesada.maximo, 0, "0 = sin cola");
  assert.throws(() => completarConfig({ ...base, colaPesada: { maximo: 9 } }), /colaPesada/);
  assert.throws(() => completarConfig({ ...base, limites: { cpuPromedioMinutos: 0 } }), /cpuPromedioMinutos/);
});

console.log(`\n${pruebas} pruebas de reparto, todas bien`);
