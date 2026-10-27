// Pruebas de la ETAPA AUTOMÁTICA del CRM (src/lib/etapa-automatica-crm.ts) con un prisma FALSO.
// Correr: npm run test:etapa-automatica
//
// 1. NUEVO -> Frío al asignar; asignar no mueve a uno que ya está en Tibio o más arriba.
// 2. Cotizar o enviar el total lleva a Caliente desde NUEVO, Frío o Tibio.
// 3. Nunca da Ganado ni Perdido y nunca baja; cerrado, fuera del CRM o línea administrativa: no se mueve.
// 4. Con el interruptor en off no hace nada; si el lead cambió en el medio, no se guarda nada.
// 5. Deja la nota en el chat y la fila de historial (AUTOMATICO, "etapa automática").
// 6. Un error de base no lanza. 7. "El texto enviado todavía trae el total".
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const estado = { etapa: "NUEVO", excluido: false, proposito: "SALES", interruptor: null, cambiarAntesDeGuardar: null, fallar: false };
const historial = [];
const notas = [];
let seguimientos = 0;

const prismaFalso = {
  prisma: {
    appSetting: { findUnique: async () => (estado.interruptor ? { value: estado.interruptor } : null) },
    conversation: {
      findFirst: async () => ({ contactId: "ct", channelId: "ch", channel: { purpose: estado.proposito } }),
    },
    officialApiConversation: {
      findFirst: async () => ({ configId: "cfg", contact: { crmContactId: "ct" } }),
    },
    contact: {
      findFirst: async () => {
        if (estado.fallar) throw new Error("base caída");
        return { crmStage: estado.etapa, excludedFromCrm: estado.excluido };
      },
    },
    $executeRaw: async (strings, ...valores) => {
      const texto = strings.join("?");
      if (texto.includes('UPDATE "Contact"')) {
        if (estado.cambiarAntesDeGuardar) estado.etapa = estado.cambiarAntesDeGuardar;
        const [nueva, , anterior] = [valores[0], valores[1], valores[2]];
        if (estado.etapa !== anterior) return 0;
        estado.etapa = nueva;
        return 1;
      }
      notas.push({ fuente: "official", texto: valores[3] });
      return 1;
    },
  },
};
const mocks = {
  "@/lib/prisma": prismaFalso,
  "@/lib/historial-etapa": { registrarCambioDeEtapa: async (c) => void historial.push(c) },
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async () => void (seguimientos += 1) },
  "@/lib/conversation-activity": { recordConversationActivity: async (c) => void notas.push({ fuente: "agent", texto: c.text }) },
};
// crm-stage-sync también importa lo mismo: se le dan los mismos mocks.
const motor = cargar("src/lib/etapa-automatica-crm.ts", mocks);
const reglas = cargar("src/lib/etapa-automatica-reglas.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  Object.assign(estado, { etapa: "NUEVO", excluido: false, proposito: "SALES", interruptor: null, cambiarAntesDeGuardar: null, fallar: false });
  historial.length = 0;
  notas.length = 0;
  seguimientos = 0;
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const asignar = (fuente = "agent") =>
  motor.etapaAlAsignarChat({ fuente, workspaceId: "ws", conversationId: "cv", nombreAsesora: "Laura" });
const cotizar = (fuente = "agent") =>
  motor.etapaAlCotizar({ fuente, workspaceId: "ws", conversationId: "cv", numeroCotizacion: "COT-123" });
const enviarPanel = (fuente = "agent") => motor.etapaAlEnviarPanel({ fuente, workspaceId: "ws", conversationId: "cv" });

await prueba("asignar: NUEVO pasa a Frío y deja nota e historial", async () => {
  const r = await asignar();
  assert.equal(r.etapa, "CALIFICADO");
  assert.equal(estado.etapa, "CALIFICADO");
  assert.equal(historial.length, 1);
  assert.equal(historial[0].origen, "AUTOMATICO");
  assert.equal(historial[0].etapaAnterior, "NUEVO");
  assert.ok(historial[0].nota.startsWith("etapa automática"));
  assert.equal(notas[0].texto, "Etapa movida por el sistema: Frio (se asignó a Laura)");
  assert.equal(seguimientos, 1);
});

await prueba("asignar en la API oficial también deja la nota", async () => {
  const r = await asignar("official");
  assert.equal(r.etapa, "CALIFICADO");
  assert.match(notas[0].texto, /Etapa movida por el sistema: Frio/);
  assert.equal(notas[0].fuente, "official");
});

for (const etapa of ["CALIFICADO", "PROPUESTA", "NEGOCIACION"]) {
  await prueba(`asignar no mueve a uno que ya está en ${etapa}`, async () => {
    estado.etapa = etapa;
    assert.equal((await asignar()).etapa, null);
    assert.equal(estado.etapa, etapa);
    assert.equal(historial.length, 0);
  });
}

for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA"]) {
  await prueba(`cotizar y enviar el total llevan a Caliente desde ${etapa}`, async () => {
    estado.etapa = etapa;
    assert.equal((await cotizar()).etapa, "NEGOCIACION");
    assert.match(notas[0].texto, /Caliente \(se creó la cotización COT-123\)/);
    estado.etapa = etapa;
    assert.equal((await enviarPanel()).etapa, "NEGOCIACION");
    assert.match(notas[1].texto, /se envió el panel de envío con el total/);
  });
}

await prueba("nunca da Ganado ni Perdido y nunca baja", async () => {
  estado.etapa = "NEGOCIACION";
  assert.equal((await cotizar()).etapa, null);
  assert.equal((await enviarPanel()).etapa, null);
  assert.equal((await asignar()).etapa, null);
  assert.equal(estado.etapa, "NEGOCIACION");
  for (const etapa of ["GANADO", "PERDIDO"]) {
    estado.etapa = etapa;
    assert.equal((await cotizar()).etapa, null);
    assert.equal((await asignar()).etapa, null);
    assert.equal(estado.etapa, etapa);
  }
  assert.ok(historial.every((c) => c.etapaNueva !== "GANADO" && c.etapaNueva !== "PERDIDO"));
});

await prueba("fuera del CRM no se mueve", async () => {
  estado.excluido = true;
  assert.equal((await asignar()).etapa, null);
  assert.equal(estado.etapa, "NUEVO");
});

await prueba("la línea administrativa no se mueve", async () => {
  estado.proposito = "ADMIN";
  assert.equal((await asignar()).etapa, null);
  assert.equal(estado.etapa, "NUEVO");
});

await prueba("con el interruptor en off no hace nada", async () => {
  estado.interruptor = "off";
  assert.equal((await asignar()).etapa, null);
  assert.equal((await cotizar()).etapa, null);
  assert.equal(estado.etapa, "NUEVO");
  assert.equal(historial.length, 0);
});

await prueba("si el lead cambió en el medio, no se guarda nada", async () => {
  estado.cambiarAntesDeGuardar = "PROPUESTA";
  assert.equal((await asignar()).etapa, null);
  assert.equal(estado.etapa, "PROPUESTA");
  assert.equal(historial.length, 0);
  assert.equal(notas.length, 0);
});

await prueba("un error de base no lanza", async () => {
  estado.fallar = true;
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await asignar()).etapa, null);
  } finally {
    console.error = original;
  }
});

await prueba("el texto enviado todavía trae el total", async () => {
  const total = "$1.500.000";
  assert.equal(reglas.textoEnviadoTraeElTotal(`Tu camilla queda en *${total}* en total.`, total), true);
  assert.equal(reglas.textoEnviadoTraeElTotal(`Hola María 👋\n\nTu camilla queda en *${total}*  en total. Gracias`, total), true);
  assert.equal(reglas.textoEnviadoTraeElTotal("Tu camilla queda en otro valor", total), false);
  assert.equal(reglas.textoEnviadoTraeElTotal("cualquier cosa", ""), false);
});

console.log(`\n${pruebas} pruebas ok`);
