// Pruebas del historial de etapas del CRM (src/lib/historial-etapa.ts) con un prisma FALSO en memoria.
// Correr: npm run test:historial-etapa
//
// 1. Cada tipo de origen (asesora, bot, automático, MCP, sistema) deja una fila con quién y cuándo.
// 2. Si la etapa no cambia no se escribe fila; varios cambios van en una sola instrucción.
// 3. Si la base falla, no se lanza error (no bloquea el cambio de etapa).
// 4. Cobertura: todo archivo que escribe `crmStage` llama a registrarCambioDeEtapa (salvo excepciones a propósito).
// 5. listar_conversaciones usa el historial para la fecha real.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const filas = [];
let llamadas = 0;
let fallar = false;
const prismaFalso = {
  prisma: {
    historialEtapa: {
      createMany: async ({ data }) => {
        llamadas += 1;
        if (fallar) throw new Error("base caída");
        for (const d of data) filas.push({ ...d, creadoEn: new Date() });
        return { count: data.length };
      },
    },
  },
};
const { registrarCambioDeEtapa, registrarCambiosDeEtapa } = cargar("src/lib/historial-etapa.ts", { "@/lib/prisma": prismaFalso });

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("cada origen deja una fila con quién y cuándo", async () => {
  const casos = [
    { origen: "ASESORA", quien: "u1" },
    { origen: "BOT", quien: null },
    { origen: "AUTOMATICO", quien: null },
    { origen: "MCP", quien: null },
    { origen: "SISTEMA", quien: null },
  ];
  for (const caso of casos) {
    filas.length = 0;
    const antes = Date.now();
    await registrarCambioDeEtapa({ workspaceId: "ws", contactId: "ct", conversationId: "cv", etapaAnterior: "NUEVO", etapaNueva: "CALIFICADO", ...caso });
    assert.equal(filas.length, 1, caso.origen);
    assert.equal(filas[0].origen, caso.origen);
    assert.equal(filas[0].quien, caso.quien);
    assert.equal(filas[0].etapaAnterior, "NUEVO");
    assert.equal(filas[0].etapaNueva, "CALIFICADO");
    assert.ok(filas[0].creadoEn.getTime() >= antes);
  }
});

await prueba("si la etapa no cambia no se escribe fila", async () => {
  filas.length = 0;
  await registrarCambioDeEtapa({ workspaceId: "ws", contactId: "ct", etapaAnterior: "NUEVO", etapaNueva: "NUEVO", origen: "ASESORA" });
  assert.equal(filas.length, 0);
});

await prueba("varios cambios van en una sola instrucción y saltan los que no cambian", async () => {
  filas.length = 0;
  llamadas = 0;
  await registrarCambiosDeEtapa([
    { workspaceId: "ws", contactId: "a", etapaAnterior: "GANADO", etapaNueva: "NUEVO", origen: "SISTEMA", nota: "vaciar CRM" },
    { workspaceId: "ws", contactId: "b", etapaAnterior: "PERDIDO", etapaNueva: "NUEVO", origen: "SISTEMA", nota: "vaciar CRM" },
    { workspaceId: "ws", contactId: "c", etapaAnterior: "NUEVO", etapaNueva: "NUEVO", origen: "SISTEMA" },
  ]);
  assert.equal(llamadas, 1);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].nota, "vaciar CRM");
});

await prueba("si la base falla no lanza error", async () => {
  fallar = true;
  const original = console.error;
  console.error = () => {};
  try {
    await registrarCambioDeEtapa({ workspaceId: "ws", contactId: "ct", etapaAnterior: "NUEVO", etapaNueva: "GANADO", origen: "BOT" });
  } finally {
    console.error = original;
    fallar = false;
  }
});

/* ---- cobertura: ningún archivo escribe crmStage sin registrar ---- */

// Excepciones a propósito: la fusión solo copia la etapa entre dos fichas del mismo cliente (y vive
// en un archivo de chats protegido); los clientes nuevos entran en NUEVO por defecto.
// Las campañas guardan `crmStage` como filtro del público, no como la etapa de un cliente.
const EXCEPCIONES = new Set(["src/lib/fusionar-chat-duplicado.ts", "src/app/actions/campaign-actions.ts"]);

function archivos(carpeta) {
  const salida = [];
  for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivos(ruta));
    else if (/\.(ts|tsx)$/.test(entrada.name)) salida.push(ruta);
  }
  return salida;
}

function escribeCrmStage(texto) {
  if (/SET\s+"crmStage"\s*=/.test(texto)) return true;
  // update/updateMany/create con `crmStage:` dentro de `data: { ... }`.
  return /data:\s*\{[^{}]*?\bcrmStage\s*:/.test(texto) || /data:\s*\{[\s\S]{0,200}?\.\.\.\([^)]*\?\s*\{\}\s*:\s*\{\s*crmStage:/.test(texto);
}

await prueba("todo archivo que escribe crmStage llama a registrarCambioDeEtapa", async () => {
  const sinRegistrar = [];
  let escriben = 0;
  for (const archivo of archivos(path.join(RAIZ, "src"))) {
    const relativo = path.relative(RAIZ, archivo).split(path.sep).join("/");
    const texto = fs.readFileSync(archivo, "utf8");
    if (!escribeCrmStage(texto)) continue;
    escriben += 1;
    if (EXCEPCIONES.has(relativo)) continue;
    if (!/registrarCambios?DeEtapa\(/.test(texto)) sinRegistrar.push(relativo);
  }
  assert.ok(escriben >= 10, `se esperaban al menos 10 archivos que escriben la etapa, hay ${escriben}`);
  assert.deepEqual(sinRegistrar, [], `escriben crmStage sin registrar: ${sinRegistrar.join(", ")}`);
});

await prueba("cada lugar registra con el origen correcto", async () => {
  const origenDe = (archivo) => {
    const texto = fs.readFileSync(path.join(RAIZ, archivo), "utf8");
    return [...texto.matchAll(/origen:\s*(?:[^"]*\?\s*)?"([A-Z]+)"/g)].map((m) => m[1]);
  };
  assert.ok(origenDe("src/app/actions/crm-actions.ts").includes("ASESORA"));
  assert.ok(origenDe("src/lib/crm-stage-sync.ts").every((o) => o === "BOT"));
  assert.ok(origenDe("src/app/actions/workspace-actions.ts").includes("SISTEMA"));
  for (const archivo of [
    "src/features/crm/services/lead-temperature.ts",
    "src/features/crm/services/descarte-automatico.ts",
    "src/features/llamadas/services/lead-cooldown.ts",
    "src/features/automatizaciones/servicio.ts",
    "src/features/seguimiento-inteligente/servicios/motor.ts",
  ]) {
    assert.ok(origenDe(archivo).includes("AUTOMATICO"), archivo);
  }
});

/* ---- listar_conversaciones ---- */

await prueba("listar_conversaciones usa la fecha real del historial y marca la aproximada", async () => {
  const texto = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
  assert.ok(texto.includes("prisma.historialEtapa.findMany"), "lee el historial");
  assert.ok(/etapa_desde_tipo:\s*"real"/.test(texto) && /etapa_desde_tipo:\s*"aproximada"/.test(texto), "marca real y aproximada");
  assert.ok(!texto.includes("no hay fecha de cambio de etapa"), "el texto viejo ya no está");
  assert.ok(/\.\.\.etapaDesde\(ultimoCambioA\(fila\.contactId, fila\.contact\.crmStage\)\)/.test(texto), "cada conversación trae la fecha");
});

console.log(`\n${pruebas} pruebas pasaron`);
