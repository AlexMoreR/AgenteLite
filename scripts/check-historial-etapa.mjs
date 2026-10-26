/**
 * Prueba del historial de etapas del CRM, sin base de datos real:
 *   npm run test:historial-etapa
 *
 * 1. registrarCambioDeEtapa deja una fila con quién (origen y usuaria) y cuándo, para cada origen.
 * 2. Si la etapa no cambia no escribe fila; si la base falla no lanza (no bloquea el cambio).
 * 3. Varios cambios se escriben en UNA sola instrucción.
 * 4. listar_conversaciones usa la fecha real cuando hay fila y la aproximada cuando no.
 * 5. Cobertura: todo archivo que escribe crmStage llama a registrarCambioDeEtapa(s) (salvo excepciones).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const filas = [];
let llamadas = 0;
let fallar = false;
const prismaFalso = {
  prisma: {
    historialEtapa: {
      createMany: async ({ data }) => {
        llamadas += 1;
        if (fallar) throw new Error("base caída");
        const creadoEn = new Date();
        filas.push(...data.map((d) => ({ ...d, creadoEn })));
        return { count: data.length };
      },
    },
  },
};
const { registrarCambioDeEtapa, registrarCambiosDeEtapa } = cargar("src/lib/historial-etapa.ts", { "@/lib/prisma": prismaFalso });

const base = { workspaceId: "ws1", contactId: "ct1", etapaAnterior: "NUEVO", etapaNueva: "CALIFICADO" };

await prueba("cada origen (asesora, bot, automático, MCP, sistema) deja una fila con quién y cuándo", async () => {
  const antes = Date.now();
  const origenes = [
    ["ASESORA", "u-ana"],
    ["BOT", null],
    ["AUTOMATICO", null],
    ["MCP", null],
    ["SISTEMA", "u-dueno"],
  ];
  for (const [origen, quien] of origenes) {
    assert.equal(await registrarCambioDeEtapa({ ...base, origen, quien, nota: `prueba ${origen}` }), true);
  }
  assert.equal(filas.length, 5);
  filas.forEach((fila, i) => {
    assert.equal(fila.origen, origenes[i][0]);
    assert.equal(fila.quien, origenes[i][1]);
    assert.equal(fila.etapaAnterior, "NUEVO");
    assert.equal(fila.etapaNueva, "CALIFICADO");
    assert.ok(fila.creadoEn.getTime() >= antes, "tiene fecha y hora");
  });
});

await prueba("si la etapa no cambia, no se escribe fila", async () => {
  const antes = filas.length;
  assert.equal(await registrarCambioDeEtapa({ ...base, etapaAnterior: "PROPUESTA", etapaNueva: "PROPUESTA", origen: "ASESORA" }), false);
  assert.equal(filas.length, antes);
});

await prueba("si la base falla no lanza ni bloquea", async () => {
  fallar = true;
  const silencio = console.error;
  console.error = () => {};
  try {
    assert.equal(await registrarCambioDeEtapa({ ...base, origen: "BOT" }), false);
  } finally {
    console.error = silencio;
    fallar = false;
  }
});

await prueba("varios cambios van en una sola instrucción de base", async () => {
  const antes = filas.length;
  llamadas = 0;
  const cambios = Array.from({ length: 50 }, (_, i) => ({ ...base, contactId: `c${i}`, etapaNueva: "NUEVO", etapaAnterior: "GANADO", origen: "SISTEMA" }));
  assert.equal(await registrarCambiosDeEtapa(cambios), 50);
  assert.equal(llamadas, 1);
  assert.equal(filas.length, antes + 50);
});

await prueba("listar_conversaciones usa la fecha real si hay fila y la aproximada si no", async () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
  assert.ok(fuente.includes("prisma.historialEtapa.findMany"), "lee el historial");
  assert.ok(/etapa_desde_tipo: "real"/.test(fuente) && /etapa_desde_tipo: "aproximada"/.test(fuente), "marca real y aproximada");
  assert.ok(/real\s*\?[\s\S]{0,120}"real"[\s\S]{0,160}"aproximada"/.test(fuente), "real primero, aproximada si no hay fila");
  assert.ok(fuente.includes("etapa_desde"), "la fila trae la fecha");
});

await prueba("cobertura: todo archivo que escribe crmStage registra el cambio", async () => {
  // Excepciones a propósito: la fusión de chats solo copia la etapa entre dos fichas (y vive en un archivo
  // protegido); la creación de clientes nuevos entra en NUEVO por defecto.
  const EXCEPCIONES = new Set(["src/lib/fusionar-chat-duplicado.ts", "src/lib/historial-etapa.ts"]);
  const ESCRIBE = /SET\s+"crmStage"|data:\s*\{\s*crmStage|\{\s*crmStage:\s*"[A-Z]+"\s+as\s+CrmStage/;
  const sinRegistrar = [];
  let revisados = 0;
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const rel = path.relative(RAIZ, ruta).split(path.sep).join("/");
        const texto = fs.readFileSync(ruta, "utf8");
        if (!ESCRIBE.test(texto) || EXCEPCIONES.has(rel)) continue;
        revisados += 1;
        if (!/registrarCambios?DeEtapa\(/.test(texto)) sinRegistrar.push(rel);
      }
    }
  };
  recorrer(path.join(RAIZ, "src"));
  assert.ok(revisados >= 9, `se esperaban al menos 9 archivos que escriben la etapa, hay ${revisados}`);
  assert.deepEqual(sinRegistrar, [], `escriben crmStage sin registrar: ${sinRegistrar.join(", ")}`);
});

console.log(`\n${pruebas} pruebas pasaron`);
