// Pruebas de la etapa automática del CRM (src/lib/etapa-automatica-crm.ts) con un prisma FALSO en memoria.
// Correr: npm run test:etapa-automatica
//
// 1. NUEVO -> Frío al asignar; asignar no mueve a uno que ya está en Tibio o más arriba.
// 2. Cotizar o enviar el total lleva a Caliente desde NUEVO, Frío o Tibio.
// 3. Nunca da Ganado ni Perdido y nunca baja; un lead cerrado, fuera del CRM o de la línea administrativa no se mueve.
// 4. Con el interruptor en "off" no hace nada.
// 5. Si el lead cambió en el medio no se guarda nada.
// 6. Deja la nota en el chat (las dos líneas) y la fila de historial (AUTOMATICO, "etapa automática").
// 7. Un error de base no lanza.
// 8. "El texto enviado todavía trae el total" acierta con texto intacto, editado alrededor y con el total borrado.
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const estado = {
  contacto: { crmStage: "NUEVO", excludedFromCrm: false },
  proposito: "SALES",
  interruptor: null,
  moverAntesDeGuardar: null,
  fallar: false,
  historial: [],
  notasViejas: [],
  notasOficiales: [],
  follows: [],
};

function reiniciar(parcial = {}) {
  Object.assign(estado, {
    contacto: { crmStage: "NUEVO", excludedFromCrm: false },
    proposito: "SALES",
    interruptor: null,
    moverAntesDeGuardar: null,
    fallar: false,
    historial: [],
    notasViejas: [],
    notasOficiales: [],
    follows: [],
    ...parcial,
  });
}

const prismaFalso = {
  prisma: {
    appSetting: { findUnique: async () => (estado.interruptor ? { value: estado.interruptor } : null) },
    user: { findUnique: async () => ({ name: "Laura", email: "laura@x.co" }) },
    conversation: {
      findFirst: async () => {
        if (estado.fallar) throw new Error("base caída");
        return { contactId: "ct1", channelId: "ch1", channel: { purpose: estado.proposito } };
      },
    },
    $queryRaw: async () => [{ configId: "cfg1", crmContactId: "ct1" }],
    contact: {
      findFirst: async () => ({ ...estado.contacto }),
      updateMany: async ({ where, data }) => {
        if (estado.moverAntesDeGuardar) {
          estado.contacto.crmStage = estado.moverAntesDeGuardar;
          estado.moverAntesDeGuardar = null;
        }
        if (estado.contacto.crmStage !== where.crmStage) return { count: 0 };
        estado.contacto.crmStage = data.crmStage;
        return { count: 1 };
      },
    },
    historialEtapa: { createMany: async ({ data }) => void estado.historial.push(...data) },
  },
};
const mocks = {
  "@/lib/prisma": prismaFalso,
  "@/lib/conversation-activity": { recordConversationActivity: async (a) => void estado.notasViejas.push(a) },
  "@/lib/official-api-crm-stage": { recordOfficialApiStageActivity: async (a) => void estado.notasOficiales.push(a) },
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async (a) => void estado.follows.push(a) },
};
const { aplicarEtapaAutomatica, decidirEtapaAutomatica, textoEnviadoTraeElTotal } = cargar("src/lib/etapa-automatica-crm.ts", mocks);

const base = { workspaceId: "ws", conversationId: "cv1", linea: "agent" };
const asignar = { tipo: "asignacion", asesoraId: "u1" };
const cotizar = { tipo: "cotizacion", numero: "COT-123" };
const panel = { tipo: "panel-de-envio" };

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("asignar mueve NUEVO a Frío y deja nota e historial", async () => {
  const etapa = await aplicarEtapaAutomatica({ ...base, motivo: asignar });
  assert.equal(etapa, "CALIFICADO");
  assert.equal(estado.contacto.crmStage, "CALIFICADO");
  assert.equal(estado.notasViejas.length, 1);
  assert.equal(estado.notasViejas[0].text, "Etapa movida por el sistema: Frío (se asignó a Laura)");
  assert.equal(estado.notasViejas[0].kind, "stage_changed");
  assert.equal(estado.historial.length, 1);
  assert.equal(estado.historial[0].origen, "AUTOMATICO");
  assert.equal(estado.historial[0].etapaAnterior, "NUEVO");
  assert.equal(estado.historial[0].etapaNueva, "CALIFICADO");
  assert.ok(estado.historial[0].nota.startsWith("etapa automática"));
  assert.equal(estado.follows.length, 1);
});

await prueba("asignar no mueve a uno que ya está en Frío, Tibio, Caliente", async () => {
  for (const etapa of ["CALIFICADO", "PROPUESTA", "NEGOCIACION"]) {
    reiniciar({ contacto: { crmStage: etapa, excludedFromCrm: false } });
    assert.equal(await aplicarEtapaAutomatica({ ...base, motivo: asignar }), null, etapa);
    assert.equal(estado.contacto.crmStage, etapa);
    assert.equal(estado.historial.length, 0);
  }
});

await prueba("cotizar o enviar el total lleva a Caliente desde NUEVO, Frío o Tibio", async () => {
  for (const motivo of [cotizar, panel]) {
    for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA"]) {
      reiniciar({ contacto: { crmStage: etapa, excludedFromCrm: false } });
      assert.equal(await aplicarEtapaAutomatica({ ...base, motivo }), "NEGOCIACION", `${motivo.tipo} ${etapa}`);
      assert.equal(estado.contacto.crmStage, "NEGOCIACION");
    }
  }
  reiniciar();
  await aplicarEtapaAutomatica({ ...base, motivo: cotizar });
  assert.equal(estado.notasViejas[0].text, "Etapa movida por el sistema: Caliente (se creó la cotización COT-123)");
  reiniciar();
  await aplicarEtapaAutomatica({ ...base, motivo: panel });
  assert.equal(estado.notasViejas[0].text, "Etapa movida por el sistema: Caliente (se envió el panel de envío con el total)");
});

await prueba("nunca da Ganado ni Perdido y nunca baja", async () => {
  for (const etapa of ["GANADO", "PERDIDO"]) {
    for (const motivo of [asignar, cotizar, panel]) {
      reiniciar({ contacto: { crmStage: etapa, excludedFromCrm: false } });
      assert.equal(await aplicarEtapaAutomatica({ ...base, motivo }), null);
      assert.equal(estado.contacto.crmStage, etapa);
    }
  }
  reiniciar({ contacto: { crmStage: "NEGOCIACION", excludedFromCrm: false } });
  assert.equal(await aplicarEtapaAutomatica({ ...base, motivo: cotizar }), null);
  for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"]) {
    for (const tipo of ["asignacion", "cotizacion", "panel-de-envio"]) {
      const destino = decidirEtapaAutomatica({ tipo, etapaActual: etapa });
      assert.ok(destino !== "GANADO" && destino !== "PERDIDO");
    }
  }
});

await prueba("fuera del CRM o línea administrativa: no se mueve", async () => {
  reiniciar({ contacto: { crmStage: "NUEVO", excludedFromCrm: true } });
  assert.equal(await aplicarEtapaAutomatica({ ...base, motivo: asignar }), null);
  reiniciar({ proposito: "ADMIN" });
  assert.equal(await aplicarEtapaAutomatica({ ...base, motivo: asignar }), null);
  assert.equal(estado.contacto.crmStage, "NUEVO");
});

await prueba("con el interruptor en off no hace nada (y 'on' o vacío sí)", async () => {
  reiniciar({ interruptor: "off" });
  assert.equal(await aplicarEtapaAutomatica({ ...base, motivo: asignar }), null);
  assert.equal(estado.contacto.crmStage, "NUEVO");
  assert.equal(estado.historial.length, 0);
  reiniciar({ interruptor: "on" });
  assert.equal(await aplicarEtapaAutomatica({ ...base, motivo: asignar }), "CALIFICADO");
});

await prueba("si el lead cambió en el medio no se guarda nada", async () => {
  reiniciar({ moverAntesDeGuardar: "PROPUESTA" });
  assert.equal(await aplicarEtapaAutomatica({ ...base, motivo: asignar }), null);
  assert.equal(estado.contacto.crmStage, "PROPUESTA");
  assert.equal(estado.historial.length, 0);
  assert.equal(estado.notasViejas.length, 0);
});

await prueba("línea oficial: la nota va a la tabla del canal oficial", async () => {
  const etapa = await aplicarEtapaAutomatica({ ...base, linea: "official", motivo: asignar });
  assert.equal(etapa, "CALIFICADO");
  assert.equal(estado.notasViejas.length, 0);
  assert.equal(estado.notasOficiales.length, 1);
  assert.equal(estado.notasOficiales[0].configId, "cfg1");
  assert.equal(estado.notasOficiales[0].texto, "Etapa movida por el sistema: Frío (se asignó a Laura)");
});

await prueba("un error de base no lanza", async () => {
  reiniciar({ fallar: true });
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await aplicarEtapaAutomatica({ ...base, motivo: asignar }), null);
  } finally {
    console.warn = original;
  }
});

await prueba("textoEnviadoTraeElTotal: intacto, editado alrededor y con el total borrado", async () => {
  const total = "$1.250.000";
  const texto = `¡Perfecto! Tu camilla queda en *${total}* en total y el envío va incluido.`;
  assert.equal(textoEnviadoTraeElTotal(texto, total), true);
  assert.equal(textoEnviadoTraeElTotal(`Hola Ana 😊\n\n${texto}\nQuedo atenta.`, total), true);
  assert.equal(textoEnviadoTraeElTotal("¡Perfecto! Tu camilla queda en total y el envío va incluido.", total), false);
  assert.equal(textoEnviadoTraeElTotal(texto, ""), false);
  assert.equal(textoEnviadoTraeElTotal(texto, undefined), false);
  assert.equal(textoEnviadoTraeElTotal(texto, "$1.300.000"), false);
});

console.log(`\n${pruebas} pruebas pasaron`);
