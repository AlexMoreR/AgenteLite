// Pruebas del historial de etapas del CRM (src/lib/historial-etapa.ts).
// Correr: npm run test:historial-etapa
//
// 1. registrarCambioDeEtapa deja una fila con quién y cuándo para cada tipo de origen.
// 2. Si la etapa no cambia, no escribe nada. Si la base falla, no lanza.
// 3. Cobertura: falla si un archivo escribe Contact.crmStage sin llamar a registrarCambioDeEtapa.
// 4. listar_conversaciones usa la fecha real cuando hay fila y la aproximada cuando no.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
let pruebas = 0;
function prueba(nombre, fn) {
  return Promise.resolve(fn()).then(() => {
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  });
}

const filasEscritas = [];
let fallarAlEscribir = false;
const prismaFalso = {
  historialEtapa: {
    createMany: async ({ data }) => {
      if (fallarAlEscribir) throw new Error("base caída");
      for (const fila of data) filasEscritas.push({ ...fila, creadoEn: new Date() });
      return { count: data.length };
    },
  },
};

function cargar(relativo) {
  const sourcePath = path.resolve(relativo);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  const requerir = (nombre) => (nombre === "@/lib/prisma" ? { prisma: prismaFalso } : nodeRequire(nombre));
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    requerir,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

const { registrarCambioDeEtapa, registrarCambiosDeEtapa } = cargar("src/lib/historial-etapa.ts");
const base = { workspaceId: "ws1", contactId: "k1", etapaAnterior: "NUEVO", etapaNueva: "CALIFICADO" };

await prueba("un cambio por cada origen deja una fila con quién y cuándo", async () => {
  filasEscritas.length = 0;
  await registrarCambioDeEtapa({ ...base, origen: "ASESORA", quien: "user1", conversationId: "c1" });
  await registrarCambioDeEtapa({ ...base, origen: "BOT", conversationId: "c1" });
  await registrarCambioDeEtapa({ ...base, origen: "AUTOMATICO", nota: "descarte automático" });
  await registrarCambioDeEtapa({ ...base, origen: "SISTEMA", nota: "vaciar CRM" });
  await registrarCambioDeEtapa({ ...base, origen: "MCP", quien: "claude" });
  assert.deepEqual(filasEscritas.map((f) => f.origen), ["ASESORA", "BOT", "AUTOMATICO", "SISTEMA", "MCP"]);
  assert.equal(filasEscritas[0].quien, "user1");
  assert.equal(filasEscritas[0].conversationId, "c1");
  assert.equal(filasEscritas[2].nota, "descarte automático");
  assert.equal(filasEscritas[1].quien, null);
  for (const f of filasEscritas) assert.ok(f.creadoEn instanceof Date);
});

await prueba("si la etapa no cambia, no se escribe fila", async () => {
  filasEscritas.length = 0;
  await registrarCambioDeEtapa({ ...base, etapaAnterior: "GANADO", etapaNueva: "GANADO", origen: "ASESORA" });
  assert.equal(filasEscritas.length, 0);
});

await prueba("varios cambios se escriben juntos y se saltan los que no cambiaron", async () => {
  filasEscritas.length = 0;
  await registrarCambiosDeEtapa([
    { ...base, contactId: "a", origen: "SISTEMA" },
    { ...base, contactId: "b", etapaAnterior: "NUEVO", etapaNueva: "NUEVO", origen: "SISTEMA" },
    { ...base, contactId: "c", origen: "SISTEMA" },
  ]);
  assert.deepEqual(filasEscritas.map((f) => f.contactId), ["a", "c"]);
});

await prueba("si la base falla, no lanza (no bloquea el cambio de etapa)", async () => {
  fallarAlEscribir = true;
  const original = console.error;
  console.error = () => {};
  try {
    await registrarCambioDeEtapa({ ...base, origen: "BOT" });
  } finally {
    console.error = original;
    fallarAlEscribir = false;
  }
});

await prueba("cobertura: todo archivo que escribe Contact.crmStage registra el cambio", async () => {
  // Excepciones a propósito: clientes nuevos (entran en Nuevo por defecto) y la fusión de chats duplicados
  // (copia la etapa entre dos fichas, no la cambia).
  // Campañas: ahí `crmStage` es el filtro de audiencia de la campaña, no la etapa de un cliente.
  const EXCEPCIONES = new Set(["src/lib/fusionar-chat-duplicado.ts", "src/app/actions/campaign-actions.ts"]);
  const escrituras = [
    /SET\s+"crmStage"\s*=/,
    /data:\s*\{[^}]*\bcrmStage\s*:/,
    /\{\s*crmStage:\s*"[A-Z]+"\s+as\s+CrmStage\s*\}/,
    /\.\.\.\([^)]*\?\s*\{\s*\}\s*:\s*\{\s*crmStage:/,
  ];
  const sinRegistrar = [];
  const recorrer = (carpeta) => {
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (/\.(ts|tsx)$/.test(entrada.name)) {
        const rel = ruta.split(path.sep).join("/");
        const texto = fs.readFileSync(ruta, "utf8");
        if (EXCEPCIONES.has(rel) || rel === "src/lib/historial-etapa.ts") continue;
        if (escrituras.some((r) => r.test(texto)) && !texto.includes("registrarCambioDeEtapa") && !texto.includes("registrarCambiosDeEtapa")) {
          sinRegistrar.push(rel);
        }
      }
    }
  };
  recorrer("src");
  assert.deepEqual(sinRegistrar, [], `escriben crmStage sin registrar: ${sinRegistrar.join(", ")}`);
});

await prueba("listar_conversaciones usa la fecha real cuando hay fila y la aproximada cuando no", async () => {
  const texto = fs.readFileSync("src/lib/mcp/herramientas.ts", "utf8");
  assert.match(texto, /prisma\.historialEtapa\.findMany/);
  assert.match(texto, /etapa_fecha: "real"/);
  assert.match(texto, /etapa_fecha: "aproximada"/);
  assert.match(texto, /etapa_desde: null/);
});

console.log(`\n${pruebas} pruebas, todas bien`);
