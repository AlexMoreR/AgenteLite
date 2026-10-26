// Pruebas de la etapa automática del CRM (src/lib/etapa-automatica-crm.ts) con un prisma FALSO en memoria.
// Correr: npm run test:etapa-automatica
//
// 1. NUEVO -> Frío al asignar; asignar no mueve a uno que ya está en Tibio o más arriba.
// 2. Cotizar o enviar el total lleva a Caliente desde NUEVO, Frío o Tibio.
// 3. Nunca Ganado ni Perdido, nunca baja; leads cerrados, fuera del CRM o de la línea administrativa no se mueven.
// 4. Interruptor en off: no hace nada. Si el lead cambió en el medio, no se guarda nada.
// 5. Deja la nota en el chat y la fila de historial (AUTOMATICO, "etapa automática").
// 6. Un error de base no lanza. La función "el texto trae el total" acierta.
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

let contacto;
let canalProposito;
let interruptor;
let guardadosSimultaneos;
const filasHistorial = [];
const notas = [];
const seguimientos = [];
let fallaLaBase = false;

const prismaFalso = {
  prisma: {
    appSetting: {
      findUnique: async () => {
        if (fallaLaBase) throw new Error("base caída");
        return interruptor === undefined ? null : { value: interruptor };
      },
    },
    conversation: {
      findFirst: async () => ({ contactId: "ct", channelId: "ch", channel: { purpose: canalProposito } }),
    },
    contact: {
      findFirst: async () => contacto,
      updateMany: async ({ where, data }) => {
        // Si el lead ya no está en la etapa leída (cambio en el medio), no actualiza nada.
        if (guardadosSimultaneos || contacto.crmStage !== where.crmStage) return { count: 0 };
        contacto = { ...contacto, crmStage: data.crmStage };
        return { count: 1 };
      },
    },
    $queryRaw: async () => [{ crmContactId: "ct", configId: "cfg" }],
    $executeRaw: async (_trozos, ...valores) => {
      notas.push({ canal: "official", texto: valores.find((v) => typeof v === "string" && v.startsWith("Etapa movida")) });
    },
    historialEtapa: {
      createMany: async ({ data }) => {
        filasHistorial.push(...data);
      },
    },
  },
};
const mocks = {
  "@/lib/prisma": prismaFalso,
  "@/features/seguimientos/services/follows": {
    createFollowsFromRulesForSource: async (datos) => {
      seguimientos.push(datos);
    },
  },
  "@/lib/conversation-activity": {
    recordConversationActivity: async (datos) => {
      notas.push({ canal: "agent", texto: datos.text, kind: datos.kind, origen: datos.origen });
    },
  },
};
const { moverEtapaAutomatica } = cargar("src/lib/etapa-automatica-crm.ts", mocks);
const { textoConservaElTotal, notaDelChat, notaDelHistorial } = cargar("src/lib/etapa-automatica-reglas.ts");

function reiniciar(etapa, extra = {}) {
  contacto = { crmStage: etapa, excludedFromCrm: false, ...extra };
  canalProposito = "SALES";
  interruptor = undefined;
  guardadosSimultaneos = false;
  fallaLaBase = false;
  filasHistorial.length = 0;
  notas.length = 0;
  seguimientos.length = 0;
}
const asignar = (canal = "agent") =>
  moverEtapaAutomatica({
    workspaceId: "ws",
    conversationId: "cv",
    canal,
    motivo: { tipo: "asignacion", asesora: "Laura" },
  });
const cotizar = () =>
  moverEtapaAutomatica({
    workspaceId: "ws",
    conversationId: "cv",
    canal: "agent",
    motivo: { tipo: "cotizacion", codigo: "COT-123" },
  });
const enviarPanel = () =>
  moverEtapaAutomatica({ workspaceId: "ws", conversationId: "cv", canal: "agent", motivo: { tipo: "panel-envio" } });

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("NUEVO pasa a Frío al asignar, con nota en el chat y fila de historial", async () => {
  reiniciar("NUEVO");
  const r = await asignar();
  assert.equal(r.etapa, "CALIFICADO");
  assert.equal(contacto.crmStage, "CALIFICADO");
  assert.equal(notas.length, 1);
  assert.equal(notas[0].texto, "Etapa movida por el sistema: Frio (se asignó a Laura)");
  assert.equal(notas[0].kind, "stage_changed");
  assert.equal(filasHistorial.length, 1);
  assert.equal(filasHistorial[0].origen, "AUTOMATICO");
  assert.equal(filasHistorial[0].etapaAnterior, "NUEVO");
  assert.equal(filasHistorial[0].etapaNueva, "CALIFICADO");
  assert.ok(filasHistorial[0].nota.startsWith("etapa automática"));
  assert.equal(seguimientos.length, 1);
});

await prueba("asignar no mueve a uno que ya está en Frío, Tibio, Caliente", async () => {
  for (const etapa of ["CALIFICADO", "PROPUESTA", "NEGOCIACION"]) {
    reiniciar(etapa);
    const r = await asignar();
    assert.equal(r.etapa, null, etapa);
    assert.equal(contacto.crmStage, etapa);
    assert.equal(notas.length, 0);
    assert.equal(filasHistorial.length, 0);
  }
});

await prueba("cotizar y enviar el total llevan a Caliente desde NUEVO, Frío y Tibio", async () => {
  for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA"]) {
    reiniciar(etapa);
    assert.equal((await cotizar()).etapa, "NEGOCIACION", etapa);
    assert.match(notas[0].texto, /Caliente \(se creó la cotización COT-123\)/);
    reiniciar(etapa);
    assert.equal((await enviarPanel()).etapa, "NEGOCIACION", etapa);
    assert.match(notas[0].texto, /Caliente \(se envió el panel de envío con el total\)/);
  }
});

await prueba("nunca Ganado ni Perdido y nunca baja", async () => {
  reiniciar("NEGOCIACION");
  assert.equal((await cotizar()).etapa, null);
  assert.equal(contacto.crmStage, "NEGOCIACION");
  for (const etapa of ["GANADO", "PERDIDO"]) {
    reiniciar(etapa);
    assert.equal((await cotizar()).etapa, null);
    assert.equal((await asignar()).etapa, null);
    assert.equal(contacto.crmStage, etapa);
  }
  for (const motivo of [
    { tipo: "asignacion", asesora: "x" },
    { tipo: "cotizacion", codigo: "c" },
    { tipo: "panel-envio" },
  ]) {
    reiniciar("NUEVO");
    await moverEtapaAutomatica({ workspaceId: "ws", conversationId: "cv", canal: "agent", motivo });
    assert.ok(!["GANADO", "PERDIDO"].includes(contacto.crmStage));
  }
});

await prueba("fuera del CRM y línea administrativa no se mueven", async () => {
  reiniciar("NUEVO", { excludedFromCrm: true });
  assert.equal((await asignar()).etapa, null);
  assert.equal(contacto.crmStage, "NUEVO");
  reiniciar("NUEVO");
  canalProposito = "ADMIN";
  const r = await asignar();
  assert.equal(r.etapa, null);
  assert.equal(r.motivo, "linea-administrativa");
  assert.equal(contacto.crmStage, "NUEVO");
});

await prueba("con el interruptor en off no hace nada; en on o sin fila, sí", async () => {
  reiniciar("NUEVO");
  interruptor = "off";
  const r = await asignar();
  assert.equal(r.etapa, null);
  assert.equal(r.motivo, "apagada");
  assert.equal(contacto.crmStage, "NUEVO");
  assert.equal(notas.length, 0);
  reiniciar("NUEVO");
  interruptor = "on";
  assert.equal((await asignar()).etapa, "CALIFICADO");
});

await prueba("si el lead cambió en el medio no se guarda nada (gana la persona)", async () => {
  reiniciar("NUEVO");
  guardadosSimultaneos = true;
  const r = await asignar();
  assert.equal(r.etapa, null);
  assert.equal(r.motivo, "cambio-en-el-medio");
  assert.equal(notas.length, 0);
  assert.equal(filasHistorial.length, 0);
});

await prueba("en la API oficial deja la nota en su propia tabla", async () => {
  reiniciar("NUEVO");
  const r = await asignar("official");
  assert.equal(r.etapa, "CALIFICADO");
  assert.equal(notas.length, 1);
  assert.equal(notas[0].canal, "official");
  assert.match(notas[0].texto, /^Etapa movida por el sistema: Frio/);
});

await prueba("un error de base no lanza", async () => {
  reiniciar("NUEVO");
  fallaLaBase = true;
  const original = console.warn;
  console.warn = () => {};
  try {
    const r = await asignar();
    assert.equal(r.etapa, null);
  } finally {
    console.warn = original;
  }
});

await prueba("textoConservaElTotal: intacto, editado alrededor y con el total borrado", async () => {
  const total = "$1.250.000";
  const texto = "¡Perfecto! Tu *Combo* queda en *$1.250.000* en total y el envío va incluido.";
  assert.equal(textoConservaElTotal(texto, total), true);
  assert.equal(textoConservaElTotal(`Hola Ana 😊\n${texto}\nCualquier duda me dices`, total), true);
  assert.equal(textoConservaElTotal("¡Perfecto! Tu *Combo* queda en el total que hablamos.", total), false);
  assert.equal(textoConservaElTotal("Queda en $1.150.000 en total", total), false);
  assert.equal(textoConservaElTotal("Llámame al 1250000", total), false);
  assert.equal(textoConservaElTotal(texto, null), false);
  assert.equal(textoConservaElTotal(texto, ""), false);
});

await prueba("las notas tienen el formato pedido", async () => {
  assert.equal(
    notaDelChat("Caliente", { tipo: "cotizacion", codigo: "COT-9" }),
    "Etapa movida por el sistema: Caliente (se creó la cotización COT-9)",
  );
  assert.ok(notaDelHistorial({ tipo: "panel-envio" }).startsWith("etapa automática: "));
});

console.log(`\n${pruebas} pruebas pasaron`);
