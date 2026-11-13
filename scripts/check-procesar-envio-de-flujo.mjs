// Pruebas de src/lib/flujos/procesar-envio-de-flujo.ts (parte 2 de «Flujos: que se envíen completos
// aunque la asesora cambie de chat, y al instante»): el candado, el orden, que cada paso quede
// «enviando» en la base ANTES de mandarlo, que un paso que quedó «enviando» no se reenvíe al retomar,
// que la sesión guardada se revise UNA vez y la línea [flujo] medicion.
// La base y los gateways son falsos: no hay red, ni base, ni sale ningún mensaje.
// Correr: node scripts/check-procesar-envio-de-flujo.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(relativo, falsos = {}) {
  const sourcePath = path.resolve(relativo);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  const requerir = (nombre) => {
    if (nombre in falsos) return falsos[nombre];
    if (nombre.startsWith("@/")) throw new Error(`modulo sin falso en la prueba: ${nombre}`);
    return require(nombre);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    requerir,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

const REGLAS = cargar("src/lib/flujos/envio-de-flujo.ts");
const PERMISO = cargar("src/lib/chats/permiso-de-envio-interno.ts");
const DESCRIBIR = cargar("src/lib/flujos/describir-archivo.ts");

/** Una base falsa con UNA tabla EnvioDeFlujo que entiende los filtros que usa el procesador. */
function baseFalsa(filas) {
  const tabla = new Map(filas.map((f) => [f.id, structuredClone(f)]));
  const fotos = []; // cada escritura de pasos, para ver el orden «enviando» -> envío -> «enviado»
  const cumple = (fila, where) => {
    for (const [clave, valor] of Object.entries(where)) {
      if (clave === "OR") {
        if (!valor.some((w) => cumple(fila, w))) return false;
        continue;
      }
      const actual = fila[clave];
      if (valor && typeof valor === "object" && !(valor instanceof Date)) {
        if ("lt" in valor && !(actual instanceof Date && actual < valor.lt)) return false;
        continue;
      }
      if (valor === null ? actual !== null && actual !== undefined : actual !== valor) return false;
    }
    return true;
  };
  return {
    tabla,
    fotos,
    prisma: {
      envioDeFlujo: {
        async updateMany({ where, data }) {
          let count = 0;
          for (const fila of tabla.values()) {
            if (!cumple(fila, where)) continue;
            Object.assign(fila, structuredClone(data));
            if (data.pasos) fotos.push(data.pasos.map((p) => p.estado).join(","));
            count += 1;
          }
          return { count };
        },
        async findUnique({ where }) {
          const fila = tabla.get(where.id);
          return fila ? structuredClone(fila) : null;
        },
        async findMany({ where }) {
          return [...tabla.values()].filter((f) => cumple(f, where)).map((f) => ({ id: f.id }));
        },
      },
      conversation: { async findFirst({ where }) { return where.workspaceId === "w1" ? { id: where.id } : null; } },
      officialApiConversation: { async findFirst() { return { id: "o1" }; } },
    },
  };
}

function preparar({ filas, acceso, monitoreo = false, fallaElPaso = null }) {
  const base = baseFalsa(filas);
  const mandados = [];
  let revisionesDeAcceso = 0;
  const alMandar = (tipo, detalle, permiso, anotar) => {
    assert.equal(PERMISO.esPermisoDeEnvioInterno(permiso), true, "se mandó sin el permiso interno");
    // En la base, este paso YA está «enviando» antes de que salga.
    const fila = base.tabla.get("e1");
    const indice = mandados.length;
    mandados.push({ tipo, ...detalle, estadoEnLaBase: fila?.pasos?.find((p) => p.estado === "enviando")?.indice ?? null });
    if (fallaElPaso === indice) return null;
    anotar(`m${indice}`);
    return true;
  };
  const M = cargar("src/lib/flujos/procesar-envio-de-flujo.ts", {
    "@/lib/prisma": { prisma: base.prisma },
    "@/lib/client-workspace-access": {
      async getClientWorkspaceAccessForUser(userId) {
        revisionesDeAcceso += 1;
        return acceso === undefined ? { userId, role: "EMPLEADO", workspaceId: "w1", moduleAccess: ["chats"], isOwner: false } : acceso;
      },
      canAccessClientModule: (a, m) => a.isOwner || a.role === "ADMIN" || a.moduleAccess.includes(m),
    },
    "@/lib/modo-monitoreo": { AVISO_MODO_MONITOREO: "Solo monitoreo", async estaEnModoMonitoreo() { return monitoreo; } },
    "@/lib/chats/permiso-de-envio-interno": PERMISO,
    "@/app/actions/agent-actions": {
      async enviarArchivoAlChatSinPermisos(permiso, input, anotar) {
        const ok = alMandar(input.mediaType, { url: input.mediaUrl, nombre: input.fileName, mime: input.mimeType }, permiso, anotar);
        return ok ? { ok: true } : { error: "No se pudo enviar el archivo: 500" };
      },
    },
    "@/app/actions/chats-actions": {
      async enviarTextoAlChatSinPermisos(permiso, input, anotar) {
        const ok = alMandar("TEXT", { texto: input.message }, permiso, anotar);
        return ok ? { ok: true } : { ok: false, error: "No se pudo enviar el mensaje" };
      },
    },
    "@/lib/flujos/describir-archivo": DESCRIBIR,
    "@/lib/flujos/envio-de-flujo": REGLAS,
  });
  return { M, base, mandados, revisiones: () => revisionesDeAcceso };
}

const PASOS = [
  { kind: "text", content: "Hola, te comparto el catálogo" },
  { kind: "document", url: "/uploads/flows/catalogo%202026.pdf", caption: null, fileName: "Catálogo.pdf" },
  { kind: "audio", url: "/uploads/a.ogg", caption: null },
  { kind: "image", url: "/uploads/flows/foto.png", caption: "Modelo nuevo" },
];

function filaNueva(extra = {}) {
  return {
    id: "e1",
    workspaceId: "w1",
    conversationId: "c1",
    source: "agent",
    flowId: "f1",
    agentId: null,
    userId: "u1",
    pasos: REGLAS.armarPasos(PASOS),
    total: 3,
    enviados: 0,
    estado: "EN_CURSO",
    lockedAt: null,
    lockedBy: null,
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    ...extra,
  };
}

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const lineas = [];
const infoOriginal = console.info;
const errorOriginal = console.error;
console.info = (...args) => (args[0] === "[flujo] medicion" ? lineas.push(args[1]) : infoOriginal(...args));
console.error = () => {};

await prueba("manda los pasos en orden, tal cual, y cada uno queda «enviando» en la base antes de salir", async () => {
  const { M, base, mandados, revisiones } = preparar({ filas: [filaNueva()] });
  await M.procesarEnvioDeFlujo("e1");
  assert.deepStrictEqual(mandados.map((m) => m.tipo), ["TEXT", "DOCUMENT", "IMAGE"]);
  assert.equal(mandados[0].texto, "Hola, te comparto el catálogo", "el texto tiene que ser el del flujo");
  assert.deepStrictEqual(mandados.map((m) => m.estadoEnLaBase), [0, 1, 3]);
  assert.equal(mandados[1].nombre, "Catálogo.pdf");
  assert.equal(mandados[1].mime, "application/pdf");
  assert.equal(mandados[2].mime, "image/png");
  assert.equal(revisiones(), 1, "la sesión guardada se revisa UNA vez");
  const fila = base.tabla.get("e1");
  assert.equal(fila.estado, "TERMINADO");
  assert.equal(fila.enviados, 3);
  assert.ok(fila.finishedAt instanceof Date);
  assert.equal(fila.lockedBy, null, "al terminar suelta el candado");
  assert.deepStrictEqual(fila.pasos.map((p) => p.mensajeId), ["m0", "m1", null, "m2"]);
  assert.equal(fila.pasos[2].estado, "omitido");
  assert.deepStrictEqual(base.fotos.slice(0, 2), ["enviando,pendiente,omitido,pendiente", "enviado,pendiente,omitido,pendiente"]);
  const linea = lineas.at(-1);
  assert.equal(linea.enviados, 3);
  assert.equal(linea.omitidos, 1);
  assert.equal(linea.pasos, 4);
});

await prueba("un paso que falla queda fallido con su error y los demás siguen: CON_FALLAS", async () => {
  const { M, base, mandados } = preparar({ filas: [filaNueva()], fallaElPaso: 1 });
  await M.procesarEnvioDeFlujo("e1");
  assert.equal(mandados.length, 3);
  const fila = base.tabla.get("e1");
  assert.equal(fila.estado, "CON_FALLAS");
  assert.equal(fila.enviados, 2);
  assert.equal(fila.pasos[1].estado, "fallido");
  assert.equal(fila.pasos[1].error, "No se pudo enviar el archivo: 500");
});

await prueba("candado vigente de otro proceso: no manda nada", async () => {
  const { M, mandados } = preparar({ filas: [filaNueva({ lockedAt: new Date(), lockedBy: "otro" })] });
  await M.procesarEnvioDeFlujo("e1");
  assert.equal(mandados.length, 0);
});

await prueba("ya terminado: no manda nada", async () => {
  const { M, mandados } = preparar({ filas: [filaNueva({ estado: "TERMINADO" })] });
  await M.procesarEnvioDeFlujo("e1");
  assert.equal(mandados.length, 0);
});

await prueba("retomar: lo que quedó «enviando» pasa a fallido y NO se reenvía; sigue con lo pendiente", async () => {
  let pasos = REGLAS.armarPasos(PASOS);
  pasos = REGLAS.marcarEnviado(REGLAS.marcarEnviando(pasos, 0), 0, "m-viejo");
  pasos = REGLAS.marcarEnviando(pasos, 1);
  const vencido = new Date(Date.now() - 3 * 60_000);
  const { M, base, mandados } = preparar({
    filas: [filaNueva({ pasos, enviados: 1, lockedAt: vencido, lockedBy: "caido", createdAt: vencido })],
  });
  const { retomados } = await M.retomarEnviosQuedados();
  assert.equal(retomados, 1);
  assert.deepStrictEqual(mandados.map((m) => m.tipo), ["IMAGE"], "solo sale lo pendiente");
  const fila = base.tabla.get("e1");
  assert.equal(fila.pasos[0].mensajeId, "m-viejo");
  assert.equal(fila.pasos[1].estado, "fallido");
  assert.equal(fila.pasos[1].error, REGLAS.ERROR_NO_SE_SABE_SI_SALIO);
  assert.equal(fila.estado, "CON_FALLAS");
});

await prueba("el cron no toca los que están en curso con candado vigente ni los recién creados", async () => {
  const { M, mandados } = preparar({
    filas: [filaNueva({ lockedAt: new Date(), lockedBy: "vivo" }), filaNueva({ id: "e2" })],
  });
  const { retomados } = await M.retomarEnviosQuedados();
  assert.equal(retomados, 0);
  assert.equal(mandados.length, 0);
});

await prueba("sin permiso a Chats, de otro negocio o en monitoreo: no sale nada y queda cerrado con el motivo", async () => {
  for (const caso of [
    { acceso: null, motivo: "La asesora ya no tiene permiso para mandar en Chats" },
    { acceso: { userId: "u1", role: "EMPLEADO", workspaceId: "w1", moduleAccess: [], isOwner: false }, motivo: "La asesora ya no tiene permiso para mandar en Chats" },
    { acceso: { userId: "u1", role: "ADMIN", workspaceId: "otro", moduleAccess: [], isOwner: false }, motivo: "La asesora ya no tiene permiso para mandar en Chats" },
    { monitoreo: true, motivo: "Solo monitoreo" },
  ]) {
    const { M, base, mandados } = preparar({ filas: [filaNueva()], ...caso });
    await M.procesarEnvioDeFlujo("e1");
    assert.equal(mandados.length, 0);
    const fila = base.tabla.get("e1");
    assert.equal(fila.estado, "CON_FALLAS");
    assert.deepStrictEqual(fila.pasos.map((p) => p.estado), ["fallido", "fallido", "omitido", "fallido"]);
    assert.equal(fila.pasos[0].error, caso.motivo);
  }
});

await prueba("un envío de hace más de media hora no se manda tarde: se cierra con sus pendientes fallidos", async () => {
  const viejo = new Date(Date.now() - 31 * 60_000);
  const { M, base, mandados } = preparar({ filas: [filaNueva({ createdAt: viejo })] });
  await M.retomarEnviosQuedados();
  assert.equal(mandados.length, 0);
  assert.equal(base.tabla.get("e1").estado, "CON_FALLAS");
});

await prueba("pasos guardados con forma rara: no se manda nada", async () => {
  const { M, base, mandados } = preparar({ filas: [filaNueva({ pasos: [{ indice: 0, estado: "pendiente", tipo: "text" }] })] });
  await M.procesarEnvioDeFlujo("e1");
  assert.equal(mandados.length, 0);
  assert.equal(base.tabla.get("e1").estado, "CON_FALLAS");
});

console.info = infoOriginal;
console.error = errorOriginal;
console.log(`\n${pruebas} pruebas ok`);
