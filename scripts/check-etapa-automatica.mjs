// Pruebas de la etapa automática del CRM (src/lib/etapa-automatica-crm.ts) con un prisma FALSO.
// Correr: npm run test:etapa-automatica
//
// 1. NUEVO -> Frío al asignar; asignar no mueve a uno en Tibio o más arriba.
// 2. Cotizar o enviar el total lleva a Caliente desde NUEVO, Frío o Tibio.
// 3. Nunca da Ganado ni Perdido y nunca baja; cerrado, fuera del CRM o línea administrativa no se mueven.
// 4. Con el interruptor en off no hace nada; si el lead cambió en el medio no se guarda nada.
// 5. Deja la nota en el chat y la fila de historial (AUTOMATICO, "etapa automática").
// 6. Un error de base no lanza. 7. La función "el texto trae el total". 8. Los enganches existen.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const db = { settings: new Map(), contacto: null, canal: "SALES", historial: [], notas: [], oficial: [], seguimientos: 0, falla: false, carrera: false };

const prisma = {
  appSetting: { findUnique: async ({ where }) => (db.settings.has(where.key) ? { value: db.settings.get(where.key) } : null) },
  conversation: {
    findFirst: async () => (db.falla ? Promise.reject(new Error("base caída")) : { contactId: "ct", channelId: "ch", channel: { purpose: db.canal } }),
  },
  officialApiConversation: { findUnique: async () => ({ configId: "cfg", contact: { crmContactId: "ct" } }) },
  contact: {
    findFirst: async () => (db.contacto ? { ...db.contacto } : null),
    updateMany: async ({ where }) => {
      if (db.carrera) db.contacto.crmStage = "PROPUESTA"; // alguien lo movió en el medio
      if (db.contacto.crmStage !== where.crmStage) return { count: 0 };
      db.contacto.crmStage = "__guardada__";
      db.guardado = true;
      return { count: 1 };
    },
  },
  $executeRaw: async (_s, ...valores) => {
    db.oficial.push(valores);
    return 1;
  },
};
const guardadas = [];
prisma.contact.updateMany = ((original) => async (args) => {
  const r = await original(args);
  if (r.count) guardadas.push(args.data.crmStage);
  return r;
})(prisma.contact.updateMany);

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/historial-etapa": { registrarCambioDeEtapa: async (c) => void db.historial.push(c) },
  "@/lib/conversation-activity": { recordConversationActivity: async (c) => void db.notas.push(c) },
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async () => void (db.seguimientos += 1) },
  "node:crypto": { randomUUID: () => "uuid" },
};
const motor = cargar("src/lib/etapa-automatica-crm.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
function reiniciar() {
  db.settings.clear();
  db.contacto = { crmStage: "NUEVO", excludedFromCrm: false };
  db.canal = "SALES";
  db.historial.length = 0;
  db.notas.length = 0;
  db.oficial.length = 0;
  db.seguimientos = 0;
  db.falla = false;
  db.carrera = false;
  guardadas.length = 0;
}
const asignar = (extra = {}) => motor.etapaAlAsignar({ workspaceId: "ws", source: "agent", conversationId: "cv", asesora: "Laura", ...extra });
const caliente = (motivo = { tipo: "panel-de-envio" }, extra = {}) =>
  motor.etapaCaliente({ workspaceId: "ws", source: "agent", conversationId: "cv", motivo, ...extra });

await prueba("NUEVO pasa a Frío al asignar y deja nota e historial", async () => {
  assert.equal(await asignar(), "CALIFICADO");
  assert.deepEqual(guardadas, ["CALIFICADO"]);
  assert.equal(db.historial.length, 1);
  assert.equal(db.historial[0].origen, "AUTOMATICO");
  assert.equal(db.historial[0].etapaAnterior, "NUEVO");
  assert.equal(db.historial[0].etapaNueva, "CALIFICADO");
  assert.ok(db.historial[0].nota.startsWith("etapa automática"));
  assert.equal(db.notas.length, 1);
  assert.equal(db.notas[0].text, "Etapa movida por el sistema: Frío (se asignó a Laura)");
  assert.equal(db.notas[0].kind, "stage_changed");
});

await prueba("asignar no mueve a uno que ya está en Tibio o más arriba", async () => {
  for (const etapa of ["CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"]) {
    db.contacto.crmStage = etapa;
    assert.equal(await asignar(), null, etapa);
  }
  assert.equal(guardadas.length, 0);
  assert.equal(db.historial.length, 0);
});

await prueba("cotizar o enviar el total lleva a Caliente desde NUEVO, Frío o Tibio", async () => {
  for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA"]) {
    reiniciar();
    db.contacto.crmStage = etapa;
    assert.equal(await caliente({ tipo: "cotizacion", referencia: "COT-123" }), "NEGOCIACION", etapa);
    assert.equal(db.notas[0].text, "Etapa movida por el sistema: Caliente (se creó la cotización COT-123)");
  }
  reiniciar();
  assert.equal(await caliente(), "NEGOCIACION");
  assert.equal(db.notas[0].text, "Etapa movida por el sistema: Caliente (se envió el panel de envío con el total)");
});

await prueba("nunca da Ganado ni Perdido y nunca baja", async () => {
  for (const etapa of ["NEGOCIACION", "GANADO", "PERDIDO"]) {
    reiniciar();
    db.contacto.crmStage = etapa;
    assert.equal(await caliente(), null, etapa);
    assert.equal(guardadas.length, 0);
  }
  const codigo = fs.readFileSync(path.join(RAIZ, "src/lib/etapa-automatica-crm.ts"), "utf8");
  assert.ok(!/destino:\s*"(GANADO|PERDIDO)"/.test(codigo));
});

await prueba("fuera del CRM o línea administrativa no se mueve", async () => {
  db.contacto.excludedFromCrm = true;
  assert.equal(await asignar(), null);
  reiniciar();
  db.canal = "ADMIN";
  assert.equal(await asignar(), null);
  assert.equal(guardadas.length, 0);
});

await prueba("con el interruptor en off no hace nada; prendido por defecto", async () => {
  db.settings.set("crm:etapa-automatica:ws", "off");
  assert.equal(await asignar(), null);
  assert.equal(guardadas.length, 0);
  db.settings.set("crm:etapa-automatica:ws", "on");
  assert.equal(await asignar(), "CALIFICADO");
});

await prueba("si el lead cambió en el medio, no se guarda nada (gana la persona)", async () => {
  db.carrera = true;
  assert.equal(await asignar(), null);
  assert.equal(guardadas.length, 0);
  assert.equal(db.historial.length, 0);
  assert.equal(db.notas.length, 0);
});

await prueba("API oficial: deja la nota como mensaje del chat oficial", async () => {
  assert.equal(await motor.etapaAlAsignar({ workspaceId: "ws", source: "official", conversationId: "ov", asesora: "Ana" }), "CALIFICADO");
  assert.equal(db.oficial.length, 1);
  assert.ok(db.oficial[0].includes("Etapa movida por el sistema: Frío (se asignó a Ana)"));
  assert.equal(db.notas.length, 0);
});

await prueba("un error de base no lanza", async () => {
  db.falla = true;
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await asignar(), null);
  } finally {
    console.warn = original;
  }
});

await prueba("el texto enviado todavía trae el total: intacto, editado alrededor y borrado", async () => {
  const { textoTraeElTotal } = cargar("src/lib/etapa-automatica-crm-texto.ts");
  const texto = "Hola Ana, el total con envío es $1.250.000 y separas con $625.000.";
  assert.equal(textoTraeElTotal(texto, "$1.250.000"), true);
  assert.equal(textoTraeElTotal(`Buenas tardes!\n${texto}\nQuedo atenta`, "$1.250.000"), true);
  assert.equal(textoTraeElTotal(texto.replace("$1.250.000", ""), "$1.250.000"), false);
  assert.equal(textoTraeElTotal("Hola", ""), false);
});

await prueba("los enganches están en reparto, claim, asignación, campaña, cotización y envío", async () => {
  const leer = (a) => fs.readFileSync(path.join(RAIZ, a), "utf8");
  assert.ok(leer("src/lib/reparto-de-leads.ts").includes("etapaAlAsignar("));
  assert.ok((leer("src/lib/conversation-claim.ts").match(/etapaAlAsignar\(/g) ?? []).length >= 2);
  const acciones = leer("src/app/actions/chats-actions.ts");
  assert.ok((acciones.match(/etapaAlAsignar\(/g) ?? []).length >= 2);
  assert.ok((acciones.match(/etapaCaliente\(/g) ?? []).length >= 2);
  assert.ok(leer("src/app/api/webhooks/evolution/route.ts").includes("etapaAlAsignar("));
  assert.ok(leer("src/app/actions/generar-cotizacion-actions.ts").includes("etapaCaliente("));
  // Insertar en la caja no mueve nada: solo la marca del formulario al enviar.
  assert.ok(leer("src/components/chats/chat-conversation-panel.tsx").includes('formData.set("conTotalDePanel", "1")'));
});

console.log(`\n${pruebas} pruebas ok`);
