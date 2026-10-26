// Pruebas de la etapa automática del CRM (src/lib/etapa-automatica-crm.ts) con un prisma FALSO en memoria.
// Correr: npm run test:etapa-automatica
//
// 1. Asignar: NUEVO -> Frío; no mueve a uno que ya está en Tibio o más arriba.
// 2. Cotizar o enviar el total: NUEVO / Frío / Tibio -> Caliente.
// 3. Nunca Ganado ni Perdido, nunca baja, no toca cerrados, fuera del CRM ni la línea administrativa.
// 4. Interruptor en `off`: no hace nada. Si el lead cambió en el medio, no guarda nada.
// 5. Deja la nota en el chat (las dos líneas) y la fila de historial (AUTOMATICO, "etapa automática").
// 6. Un error de base no lanza.
// 7. textoTraeElTotal acierta con el texto intacto, editado alrededor y con el total borrado.
// 8. Los enganches están en su lugar (reparto, claim, asignación a mano, campaña, envío, cotización).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const estado = {
  etapa: "NUEVO",
  excluido: false,
  proposito: "SALES",
  apagado: false,
  fallar: false,
  // Simula que una persona movió el lead entre la lectura y el guardado.
  cambiarEnElMedio: null,
};
const historial = [];
const notasViejo = [];
const notasOficial = [];

const prismaFalso = {
  prisma: {
    appSetting: {
      findUnique: async () => {
        if (estado.fallar) throw new Error("base caída");
        return estado.apagado ? { value: "off" } : null;
      },
    },
    conversation: {
      findFirst: async () => ({ channelId: "ch1", contactId: "ct1", channel: { purpose: estado.proposito } }),
    },
    officialApiConversation: {
      findFirst: async () => ({ configId: "cfg1", contact: { crmContactId: "ct1" } }),
    },
    contact: {
      findFirst: async () => {
        const lectura = { crmStage: estado.etapa, excludedFromCrm: estado.excluido };
        if (estado.cambiarEnElMedio) estado.etapa = estado.cambiarEnElMedio;
        return lectura;
      },
      updateMany: async ({ where, data }) => {
        if (where.crmStage !== estado.etapa) return { count: 0 };
        estado.etapa = data.crmStage;
        return { count: 1 };
      },
    },
    user: { findUnique: async () => ({ name: "Laura", email: "laura@x.co" }) },
    historialEtapa: {
      createMany: async ({ data }) => {
        historial.push(...data);
        return { count: data.length };
      },
    },
    $executeRaw: async (_trozos, ...valores) => {
      notasOficial.push(valores);
    },
  },
};
const mocks = {
  "@/lib/prisma": prismaFalso,
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async () => {} },
  "@/lib/conversation-activity": {
    recordConversationActivity: async (datos) => {
      notasViejo.push(datos);
    },
  },
  "@/features/crm/domain/crm-config": { CRM_STAGE_META: {} },
};
const motor = cargar("src/lib/etapa-automatica-crm.ts", mocks);
const { moverEtapaAutomatica, decidirEtapaAutomatica, textoTraeElTotal } = motor;

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
function reiniciar() {
  Object.assign(estado, { etapa: "NUEVO", excluido: false, proposito: "SALES", apagado: false, fallar: false, cambiarEnElMedio: null });
  historial.length = 0;
  notasViejo.length = 0;
  notasOficial.length = 0;
}
const mover = (motivo, source = "agent") =>
  moverEtapaAutomatica({ workspaceId: "ws", source, conversationId: "cv1", motivo });
const asignar = { tipo: "asignacion", asesoraId: "u1" };
const cotizar = { tipo: "cotizacion", codigo: "COT-123" };
const panel = { tipo: "panel-envio" };

await prueba("asignar: NUEVO pasa a Frío", async () => {
  assert.equal(await mover(asignar), "CALIFICADO");
  assert.equal(estado.etapa, "CALIFICADO");
});

await prueba("asignar no mueve a uno que ya está en Frío, Tibio o más arriba", async () => {
  for (const etapa of ["CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"]) {
    estado.etapa = etapa;
    assert.equal(await mover(asignar), null, etapa);
    assert.equal(estado.etapa, etapa);
  }
  assert.equal(historial.length, 0);
});

await prueba("cotizar o enviar el total lleva a Caliente desde NUEVO, Frío o Tibio", async () => {
  for (const motivo of [cotizar, panel]) {
    for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA"]) {
      estado.etapa = etapa;
      assert.equal(await mover(motivo), "NEGOCIACION", `${motivo.tipo} desde ${etapa}`);
      assert.equal(estado.etapa, "NEGOCIACION");
    }
  }
});

await prueba("nunca da Ganado ni Perdido y nunca baja", async () => {
  for (const motivo of [asignar, cotizar, panel]) {
    assert.ok(!["GANADO", "PERDIDO"].includes(decidirEtapaAutomatica(motivo.tipo, "NUEVO")));
  }
  estado.etapa = "NEGOCIACION";
  assert.equal(await mover(asignar), null);
  assert.equal(await mover(cotizar), null);
  assert.equal(estado.etapa, "NEGOCIACION");
  for (const etapa of ["GANADO", "PERDIDO"]) {
    estado.etapa = etapa;
    assert.equal(await mover(cotizar), null);
    assert.equal(estado.etapa, etapa);
  }
});

await prueba("fuera del CRM o línea administrativa no se mueve", async () => {
  estado.excluido = true;
  assert.equal(await mover(asignar), null);
  estado.excluido = false;
  estado.proposito = "ADMIN";
  assert.equal(await mover(asignar), null);
  assert.equal(estado.etapa, "NUEVO");
});

await prueba("con el interruptor en off no hace nada", async () => {
  estado.apagado = true;
  assert.equal(await mover(asignar), null);
  assert.equal(estado.etapa, "NUEVO");
  assert.equal(historial.length, 0);
});

await prueba("si el lead cambió en el medio, no se guarda nada y gana la persona", async () => {
  estado.cambiarEnElMedio = "PROPUESTA";
  assert.equal(await mover(asignar), null);
  assert.equal(estado.etapa, "PROPUESTA");
  assert.equal(historial.length, 0);
  assert.equal(notasViejo.length, 0);
});

await prueba("deja la nota en el chat y la fila de historial", async () => {
  await mover(asignar);
  assert.equal(notasViejo.length, 1);
  assert.equal(notasViejo[0].text, "Etapa movida por el sistema: Frío (se asignó a Laura)");
  assert.equal(notasViejo[0].kind, "stage_changed");
  assert.equal(historial.length, 1);
  assert.equal(historial[0].origen, "AUTOMATICO");
  assert.equal(historial[0].etapaAnterior, "NUEVO");
  assert.equal(historial[0].etapaNueva, "CALIFICADO");
  assert.ok(historial[0].nota.startsWith("etapa automática"));

  notasViejo.length = 0;
  await mover(cotizar);
  assert.equal(notasViejo[0].text, "Etapa movida por el sistema: Caliente (se creó la cotización COT-123)");
  reiniciar();
  await mover(panel);
  assert.equal(notasViejo[0].text, "Etapa movida por el sistema: Caliente (se envió el panel de envío con el total)");
});

await prueba("en la API oficial la nota va a la tabla del canal oficial", async () => {
  assert.equal(await mover(asignar, "official"), "CALIFICADO");
  assert.equal(notasViejo.length, 0);
  assert.equal(notasOficial.length, 1);
  assert.ok(notasOficial[0].some((valor) => typeof valor === "string" && valor.startsWith("Etapa movida por el sistema: Frío")));
  assert.equal(historial.length, 1);
});

await prueba("un error de base no lanza", async () => {
  estado.fallar = true;
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await mover(asignar), null);
  } finally {
    console.error = original;
  }
});

await prueba("textoTraeElTotal: intacto, editado alrededor y con el total borrado", async () => {
  const total = "$1.250.000";
  const texto = "Hola Ana, el total con envío incluido es $1.250.000 y separas con la mitad.";
  assert.equal(textoTraeElTotal(texto, total), true);
  assert.equal(textoTraeElTotal(`Buenas tardes!\n${texto}\nQuedo atenta.`, total), true);
  assert.equal(textoTraeElTotal("Hola Ana, el total es $ 1.250.000", total), true);
  assert.equal(textoTraeElTotal("Hola Ana, te cotizo en un momento.", total), false);
  assert.equal(textoTraeElTotal(texto, null), false);
  assert.equal(textoTraeElTotal("", total), false);
});

/* ---- los enganches están en su lugar ---- */
const leer = (archivo) => fs.readFileSync(path.join(RAIZ, archivo), "utf8");

await prueba("los enganches de asignación, cotización y envío existen", async () => {
  assert.ok(/moverEtapaAutomatica\(/.test(leer("src/lib/reparto-de-leads.ts")), "reparto");
  assert.equal((leer("src/lib/conversation-claim.ts").match(/moverEtapaAutomatica\(/g) ?? []).length, 2, "claim en las dos líneas");
  assert.equal((leer("src/app/actions/chats-actions.ts").match(/moverEtapaAutomatica\(/g) ?? []).length, 4, "asignación a mano x2 y envío x2");
  assert.ok(/moverEtapaAutomatica\(/.test(leer("src/app/api/webhooks/evolution/route.ts")), "regla por campaña");
  assert.ok(/tipo: "cotizacion"/.test(leer("src/app/actions/generar-cotizacion-actions.ts")), "cotización");
  // Caliente por el panel SOLO al enviar: el envío lee la marca, insertar no mueve nada.
  assert.ok(leer("src/app/actions/chats-actions.ts").includes('trajoTotalEnvio === "1"'));
  assert.ok(leer("src/components/chats/chat-conversation-panel.tsx").includes('formData.set("trajoTotalEnvio", "1")'));
});

console.log(`\n${pruebas} pruebas pasaron`);
