// Pruebas de APAGAR LOS MOTORES VIEJOS (24-nov-2026): pausar el agente V2 sin borrarlo y que no salgan sus
// seguimientos viejos ("Sin responder …" y reglas AGENT_NODE). Los "Etapa …" siguen saliendo.
// Sin base real: todo con una base de mentira. Correr: npm run test:motores-viejos
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar, RAIZ } from "./supervisor-cargar.mjs";
import { correr } from "./apagar-motores-viejos.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ---------------------------------------------------------------------------------------------- */
// La base de mentira.

function nuevaBase() {
  return {
    escrituras: 0,
    agentes: [
      // Atiende solo líneas con V3: se puede pausar.
      { id: "ag-v2", workspaceId: "ws-1", name: "Agente V2", agentType: "V2", status: "ACTIVE", isActive: true, createdAt: 1 },
      // Atiende una línea sin V3: no se pausa.
      { id: "ag-mixto", workspaceId: "ws-1", name: "Agente mixto", agentType: "V1", status: "ACTIVE", isActive: true, createdAt: 2 },
      // Ya estaba en pausa: no se toca.
      { id: "ag-pausado", workspaceId: "ws-1", name: "Agente pausado", agentType: "V2", status: "PAUSED", isActive: false, createdAt: 3 },
    ],
    lineas: [
      { id: "linea-v3", workspaceId: "ws-1", name: "Ventas 1", agentId: "ag-v2", metadata: { agenteV3: true } },
      { id: "linea-v3b", workspaceId: "ws-1", name: "Ventas 2", agentId: "ag-mixto", metadata: { agenteV3: true } },
      { id: "linea-sin-v3", workspaceId: "ws-1", name: "Administrativa", agentId: "ag-mixto", metadata: {} },
      { id: "linea-pausada", workspaceId: "ws-1", name: "Vieja", agentId: "ag-pausado", metadata: null },
    ],
    reglas: [
      { id: "regla-v2", sourceType: "AGENT_NODE" },
      { id: "regla-producto", sourceType: "PRODUCT" },
    ],
    follows: [
      { id: "f-sin-responder", workspaceId: "ws-1", channelId: "linea-v3", name: "Sin responder 1", followRuleId: null, status: "PENDING", cancelledAt: null, executionError: null },
      { id: "f-nodo", workspaceId: "ws-1", channelId: "linea-v3", name: "Seguimiento del nodo", followRuleId: "regla-v2", status: "PENDING", cancelledAt: null, executionError: null },
      { id: "f-etapa", workspaceId: "ws-1", channelId: "linea-v3", name: "Etapa Producto · 1", followRuleId: null, status: "PENDING", cancelledAt: null, executionError: null },
      { id: "f-inteligente", workspaceId: "ws-1", channelId: "linea-v3", name: "Inteligente: precio", followRuleId: null, status: "PENDING", cancelledAt: null, executionError: null },
      { id: "f-asesora", workspaceId: "ws-1", channelId: "linea-v3", name: "Llamar mañana", followRuleId: "regla-producto", status: "PENDING", cancelledAt: null, executionError: null },
      { id: "f-otra-linea", workspaceId: "ws-1", channelId: "linea-sin-v3", name: "Sin responder 2", followRuleId: null, status: "PENDING", cancelledAt: null, executionError: null },
    ],
    ajustes: new Map(),
  };
}

function prismaDe(base) {
  const escribe = () => {
    base.escrituras += 1;
  };
  const regla = (id) => base.reglas.find((fila) => fila.id === id) ?? null;
  const prisma = {
    agent: {
      findMany: async ({ where }) =>
        base.agentes
          .filter((a) => where.agentType.in.includes(a.agentType) && (!where.workspaceId || a.workspaceId === where.workspaceId))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((a) => ({
            ...a,
            channels: base.lineas.filter((l) => l.agentId === a.id).map(({ id, name, metadata }) => ({ id, name, metadata })),
          })),
      update: async ({ where, data }) => {
        escribe();
        const fila = base.agentes.find((a) => a.id === where.id);
        Object.assign(fila, data);
        return fila;
      },
    },
    whatsAppChannel: {
      findUnique: async ({ where }) => {
        const linea = base.lineas.find((l) => l.id === where.id);
        if (!linea) return null;
        const agente = base.agentes.find((a) => a.id === linea.agentId);
        return { agent: agente ? { status: agente.status, isActive: agente.isActive } : null };
      },
    },
    followRule: {
      findUnique: async ({ where }) => {
        const fila = regla(where.id);
        return fila ? { sourceType: fila.sourceType } : null;
      },
    },
    follow: {
      findMany: async ({ where }) =>
        base.follows
          .filter(
            (f) =>
              f.workspaceId === where.workspaceId &&
              f.status === where.status &&
              where.channelId.in.includes(f.channelId) &&
              ((f.name ?? "").startsWith(where.OR[0].name.startsWith) ||
                regla(f.followRuleId)?.sourceType === where.OR[1].followRule.is.sourceType),
          )
          .map((f) => ({ ...f, followRule: f.followRuleId ? { sourceType: regla(f.followRuleId)?.sourceType } : null })),
      updateMany: async ({ where, data }) => {
        escribe();
        const ids = typeof where.id === "string" ? [where.id] : where.id.in;
        let count = 0;
        for (const f of base.follows) {
          if (!ids.includes(f.id) || f.status !== where.status) continue;
          if (where.executionError !== undefined && f.executionError !== where.executionError) continue;
          Object.assign(f, data);
          count += 1;
        }
        return { count };
      },
    },
    appSetting: {
      findUnique: async ({ where }) => (base.ajustes.has(where.key) ? { key: where.key, value: base.ajustes.get(where.key) } : null),
      findMany: async ({ where }) =>
        [...base.ajustes.entries()]
          .filter(([key]) => (typeof where.key === "string" ? key === where.key : key.startsWith(where.key.startsWith)))
          .map(([key, value]) => ({ key, value })),
      upsert: async ({ where, create, update }) => {
        escribe();
        base.ajustes.set(where.key, base.ajustes.has(where.key) ? update.value : create.value);
        return { key: where.key };
      },
      delete: async ({ where }) => {
        escribe();
        base.ajustes.delete(where.key);
        return { key: where.key };
      },
    },
    $transaction: async (fn) => fn(prisma),
  };
  return prisma;
}

const silencio = () => {};
const estadoDe = (base, id) => {
  const fila = base.agentes.find((a) => a.id === id);
  return { status: fila.status, isActive: fila.isActive };
};
const followDe = (base, id) => base.follows.find((f) => f.id === id);

/* ---------------------------------------------------------------------------------------------- */

await prueba("con el agente PAUSED, un 'Sin responder 1' de su línea no se envía y un 'Etapa Producto · 1' sí", async () => {
  const base = nuevaBase();
  base.agentes[0].status = "PAUSED";
  base.agentes[0].isActive = false;
  const { seguimientoDelV2EnPausa } = cargar("src/features/seguimientos/services/motores-viejos.ts", {
    "@/lib/prisma": { prisma: prismaDe(base) },
  });
  const de = (follow) => ({ name: follow.name, followRuleId: follow.followRuleId, channelId: follow.channelId });
  assert.equal(await seguimientoDelV2EnPausa(de(followDe(base, "f-sin-responder"))), true, "el 'Sin responder 1' se frena");
  assert.equal(await seguimientoDelV2EnPausa(de(followDe(base, "f-nodo"))), true, "el de una regla AGENT_NODE se frena");
  assert.equal(await seguimientoDelV2EnPausa(de(followDe(base, "f-etapa"))), false, "el 'Etapa Producto · 1' sale");
  assert.equal(await seguimientoDelV2EnPausa(de(followDe(base, "f-inteligente"))), false, "el del V3 sale");
  assert.equal(await seguimientoDelV2EnPausa(de(followDe(base, "f-asesora"))), false, "el de una regla que no es del V2 sale");
  // Con el agente prendido, el 'Sin responder' sale como siempre.
  base.agentes[0].status = "ACTIVE";
  base.agentes[0].isActive = true;
  assert.equal(await seguimientoDelV2EnPausa(de(followDe(base, "f-sin-responder"))), false);
  // isActive=false solo también cuenta como pausa.
  base.agentes[0].isActive = false;
  assert.equal(await seguimientoDelV2EnPausa(de(followDe(base, "f-sin-responder"))), true);

  // Y el envío de follows.ts lo usa: en definicionVigenteDelFollow y también con la medida 4 apagada.
  const fuente = fs.readFileSync(`${RAIZ}/src/features/seguimientos/services/follows.ts`, "utf8");
  const definicion = fuente.slice(fuente.indexOf("async function definicionVigenteDelFollow"));
  assert.match(definicion.slice(0, 800), /if \(await seguimientoDelV2EnPausa\(follow\)\) \{\s*return null;/);
  assert.match(fuente, /\} else if \(esAutomatico && \(await seguimientoDelV2EnPausa\(follow\)\)\) \{[\s\S]{0,200}"seguimiento_apagado"/);
});

await prueba("sin --aplicar (revisar) el script no escribe nada", async () => {
  const base = nuevaBase();
  const lineas = [];
  const { planes } = await correr({ prisma: prismaDe(base), argumentos: [], log: (l) => lineas.push(l) });
  await correr({ prisma: prismaDe(base), argumentos: ["--revisar"], log: silencio });
  assert.equal(base.escrituras, 0);
  assert.equal(base.ajustes.size, 0);
  assert.deepEqual(estadoDe(base, "ag-v2"), { status: "ACTIVE", isActive: true });
  assert.equal(followDe(base, "f-sin-responder").status, "PENDING");
  assert.deepEqual(planes[0].pausar.map((a) => a.id), ["ag-v2"]);
  assert.deepEqual(planes[0].follows.map((f) => f.id).sort(), ["f-nodo", "f-sin-responder"]);
  assert.ok(lineas.some((l) => l.includes("no se escribió nada")));
});

await prueba("--aplicar pausa y cancela; con --volver status, isActive y los seguimientos quedan como estaban", async () => {
  const base = nuevaBase();
  const prisma = prismaDe(base);
  const antes = base.agentes.map((a) => ({ id: a.id, ...estadoDe(base, a.id) }));
  const comoEstan = () => base.follows.map(({ id, status, cancelledAt, executionError }) => ({ id, status, cancelledAt, executionError }));
  const followsAntes = comoEstan();

  await correr({ prisma, argumentos: ["--aplicar"], log: silencio });
  assert.deepEqual(estadoDe(base, "ag-v2"), { status: "PAUSED", isActive: false });
  assert.equal(followDe(base, "f-sin-responder").status, "CANCELLED");
  assert.equal(followDe(base, "f-nodo").status, "CANCELLED");
  // Lo que no es del V2, o de una línea sin pausar, sigue pendiente.
  for (const id of ["f-etapa", "f-inteligente", "f-asesora", "f-otra-linea"]) assert.equal(followDe(base, id).status, "PENDING", id);
  const respaldo = JSON.parse(base.ajustes.get("motores-viejos:respaldo:ws-1"));
  assert.deepEqual(respaldo.agentes, [{ id: "ag-v2", status: "ACTIVE", isActive: true }]);
  assert.equal(respaldo.follows.length, 2);

  // Un segundo --aplicar no pisa el respaldo con lo ya pausado.
  await correr({ prisma, argumentos: ["--aplicar"], log: silencio });
  assert.deepEqual(JSON.parse(base.ajustes.get("motores-viejos:respaldo:ws-1")).agentes, respaldo.agentes);

  await correr({ prisma, argumentos: ["--volver"], log: silencio });
  assert.deepEqual(base.agentes.map((a) => ({ id: a.id, ...estadoDe(base, a.id) })), antes);
  assert.deepEqual(comoEstan(), followsAntes);
  assert.equal(base.ajustes.has("motores-viejos:respaldo:ws-1"), false);
});

await prueba("el script se niega a pausar un agente que atiende una línea sin V3", async () => {
  const base = nuevaBase();
  const lineas = [];
  await correr({ prisma: prismaDe(base), argumentos: ["--aplicar"], log: (l) => lineas.push(l) });
  assert.deepEqual(estadoDe(base, "ag-mixto"), { status: "ACTIVE", isActive: true });
  assert.equal(followDe(base, "f-otra-linea").status, "PENDING");
  assert.ok(lineas.some((l) => l.includes('NO se pausa "Agente mixto"') && l.includes("Administrativa")), lineas.join("\n"));
  // Y el que ya estaba en pausa no entra al respaldo (no se toca).
  assert.ok(!JSON.parse(base.ajustes.get("motores-viejos:respaldo:ws-1")).agentes.some((a) => a.id === "ag-pausado"));
});

console.log(`\n${pruebas} pruebas ok`);
