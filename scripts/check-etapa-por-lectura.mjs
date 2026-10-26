// Pruebas de la etapa por lectura (src/features/crm/domain/intencion-del-cliente.ts y
// src/features/crm/services/etapa-por-lectura.ts) con un prisma FALSO en memoria.
// Correr: npm run test:etapa-por-lectura
//
// 1. Frases reales de cada etapa (Caliente, Tibio, Descartado) y "voy en noviembre" -> Tibio con fecha.
// 2. Ante la duda, Tibio; nunca Descartado ("ahorita no puedo", "ya compré, ¿tienen otro?").
// 3. Protecciones: Ganado/Perdido no cambian, nunca baja, fuera del CRM, línea Admin, 24 horas de respeto.
// 4. Interruptores: general apagado no mueve nada; descarte apagado no descarta pero sí sube a Caliente.
// 5. IA: sin frase clara se usa su respuesta y queda contada como "ia"; falla o "ok" no la llaman; nunca descarta.
// 6. Nota del chat, historial, motivo y frase exacta del descarte, fecha de recontacto.
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const estado = {
  contacto: { crmStage: "NUEVO", excludedFromCrm: false, metadata: null },
  proposito: "SALES",
  interruptores: {},
  personaMovioHace: null, // horas
  moverAntesDeGuardar: null,
  fallar: false,
  historial: [],
  notasViejas: [],
  notasOficiales: [],
  follows: [],
  actualizado: null,
};

function reiniciar(parcial = {}) {
  Object.assign(estado, {
    contacto: { crmStage: "NUEVO", excludedFromCrm: false, metadata: null },
    proposito: "SALES",
    interruptores: {},
    personaMovioHace: null,
    moverAntesDeGuardar: null,
    fallar: false,
    historial: [],
    notasViejas: [],
    notasOficiales: [],
    follows: [],
    actualizado: null,
    ...parcial,
  });
}

const AHORA = new Date("2026-10-26T15:00:00Z");

const prismaFalso = {
  prisma: {
    appSetting: {
      findUnique: async ({ where }) => (estado.interruptores[where.key] ? { value: estado.interruptores[where.key] } : null),
    },
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
        if (where.crmStage && estado.contacto.crmStage !== where.crmStage) return { count: 0 };
        Object.assign(estado.contacto, data);
        estado.actualizado = data;
        return { count: 1 };
      },
    },
    historialEtapa: {
      findFirst: async ({ where }) => {
        if (estado.personaMovioHace === null) return null;
        const hace = AHORA.getTime() - estado.personaMovioHace * 3_600_000;
        return hace >= where.creadoEn.gte.getTime() ? { id: "h1" } : null;
      },
      createMany: async ({ data }) => void estado.historial.push(...data),
    },
  },
};
const mocks = {
  "@/lib/prisma": prismaFalso,
  "@/lib/conversation-activity": { recordConversationActivity: async (a) => void estado.notasViejas.push(a) },
  "@/lib/official-api-crm-stage": { recordOfficialApiStageActivity: async (a) => void estado.notasOficiales.push(a) },
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async (a) => void estado.follows.push(a) },
};
const dominio = cargar("src/features/crm/domain/intencion-del-cliente.ts", mocks);
const { aplicarEtapaPorLectura } = cargar("src/features/crm/services/etapa-por-lectura.ts", mocks);
const { clasificarPorFrases, decidirEtapaPorLectura, descarteClaro, interpretarRespuestaDeLaIa, leerRecontacto, metadataConRecontacto, fechaDeRecontacto } = dominio;

const base = { workspaceId: "ws", conversationId: "cv1", linea: "agent", cuando: AHORA };
const leer = (texto, extra = {}) => aplicarEtapaPorLectura({ ...base, texto, preguntarALaIa: async () => null, ...extra });

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("frases de Caliente", () => {
  const frases = [
    "¿cómo te pago?",
    "¿tienen nequi?",
    "¿cuáles son los medios de pago?",
    "soy de Cali",
    "estoy en Medellín, ¿hacen envío?",
    "¿cuánto es el total con envío?",
    "lo quiero en gris",
    "pásame la cuenta para consignar",
    "a qué cuenta consigno?",
    "me lo llevo",
    "Mi nombre es Ana Pérez, cédula 1090123456, dirección calle 5 # 3-21 barrio Centro",
    "ya hice la transferencia",
  ];
  for (const f of frases) {
    const r = clasificarPorFrases(f, AHORA);
    assert.equal(r?.etapa, "NEGOCIACION", f);
    assert.equal(r.metodo, "frase");
  }
  assert.equal(clasificarPorFrases("¿cómo te pago?", AHORA).razon, "el cliente preguntó cómo pagar");
});

await prueba("frases de Tibio, con la fecha que dijo o a 3 días", () => {
  for (const f of ["lo pienso", "más adelante", "me organizo y te confirmo", "te confirmo mañana", "ahorita no puedo", "lo voy a pensar", "voy en noviembre"]) {
    assert.equal(clasificarPorFrases(f, AHORA)?.etapa, "PROPUESTA", f);
  }
  const noviembre = clasificarPorFrases("Voy a Bogotá en noviembre", AHORA);
  assert.equal(noviembre.etapa, "PROPUESTA");
  assert.equal(noviembre.recontacto.explicito, true);
  assert.equal(noviembre.recontacto.fecha.toISOString().slice(0, 7), "2026-11");
  const sinFecha = clasificarPorFrases("lo pienso", AHORA);
  assert.equal(sinFecha.recontacto.explicito, false);
  assert.equal(sinFecha.recontacto.fecha.toISOString().slice(0, 10), "2026-10-29");
  assert.equal(fechaDeRecontacto("te escribo el lunes", AHORA).fecha.toISOString().slice(0, 10), "2026-11-02");
  assert.equal(fechaDeRecontacto("te confirmo mañana", AHORA).fecha.toISOString().slice(0, 10), "2026-10-27");
});

await prueba("Descartado solo con frase clara y guarda la frase exacta", () => {
  for (const f of ["no gracias, ya compré", "me equivoqué de número", "no me interesa", "ya compré en otro lado", "no me escriban más", "dejen de escribirme"]) {
    const r = clasificarPorFrases(f, AHORA);
    assert.equal(r?.etapa, "PERDIDO", f);
    assert.equal(r.frase, f);
    assert.ok(r.razon.includes(`«${f}»`));
  }
  assert.equal(clasificarPorFrases("no gracias, ya compré", AHORA).motivoDePerdida, "compro_competencia");
  assert.equal(clasificarPorFrases("me equivoqué de número", AHORA).motivoDePerdida, "numero_equivocado");
  assert.equal(clasificarPorFrases("no me escriban más", AHORA).motivoDePerdida, "no_quiere_mensajes");
});

await prueba("ante la duda, Tibio y nunca Descartado", () => {
  assert.equal(clasificarPorFrases("ahorita no puedo", AHORA).etapa, "PROPUESTA");
  assert.equal(clasificarPorFrases("voy a Bogotá en noviembre", AHORA).etapa, "PROPUESTA");
  assert.equal(descarteClaro("no me interesa por ahora, más adelante te escribo"), null);
  assert.equal(descarteClaro("ya compré uno pero quiero otro, ¿cuánto vale?"), null);
  assert.equal(descarteClaro("no gracias"), null);
  assert.equal(descarteClaro("no sé, no estoy segura"), null);
  assert.equal(clasificarPorFrases("hola buenas tardes", AHORA), null);
  assert.equal(clasificarPorFrases("estoy en duda", AHORA), null);
});

await prueba("la respuesta de la IA nunca descarta", () => {
  assert.equal(interpretarRespuestaDeLaIa("caliente"), "NEGOCIACION");
  assert.equal(interpretarRespuestaDeLaIa("Tibio."), "PROPUESTA");
  assert.equal(interpretarRespuestaDeLaIa("descartado"), "PROPUESTA");
  assert.equal(interpretarRespuestaDeLaIa("nada"), null);
  assert.equal(interpretarRespuestaDeLaIa(""), null);
});

await prueba("decidir: nunca baja, nunca toca cerrados, fuera del CRM no se mueve", () => {
  const cal = { etapa: "NEGOCIACION", metodo: "frase", razon: "x" };
  const tib = { etapa: "PROPUESTA", metodo: "frase", razon: "x" };
  const des = { etapa: "PERDIDO", metodo: "frase", razon: "x" };
  assert.equal(decidirEtapaPorLectura({ etapaActual: "NUEVO", intencion: cal }), "NEGOCIACION");
  assert.equal(decidirEtapaPorLectura({ etapaActual: "CALIFICADO", intencion: tib }), "PROPUESTA");
  assert.equal(decidirEtapaPorLectura({ etapaActual: "NEGOCIACION", intencion: tib }), null);
  assert.equal(decidirEtapaPorLectura({ etapaActual: "PROPUESTA", intencion: tib }), null);
  assert.equal(decidirEtapaPorLectura({ etapaActual: "GANADO", intencion: des }), null);
  assert.equal(decidirEtapaPorLectura({ etapaActual: "PERDIDO", intencion: cal }), null);
  assert.equal(decidirEtapaPorLectura({ etapaActual: "NEGOCIACION", intencion: des }), "PERDIDO");
  assert.equal(decidirEtapaPorLectura({ etapaActual: "NEGOCIACION", intencion: des, descarteActivo: false }), null);
  assert.equal(decidirEtapaPorLectura({ etapaActual: "NUEVO", intencion: cal, fueraDelCrm: true }), null);
});

await prueba("la fecha de recontacto de 3 días no adelanta una que ya estaba a futuro", () => {
  const futura = { recontactoEn: "2026-11-15T14:00:00.000Z" };
  assert.equal(metadataConRecontacto(futura, { fecha: new Date("2026-10-29T14:00:00Z"), explicito: false }, AHORA), null);
  const nueva = metadataConRecontacto(futura, { fecha: new Date("2026-10-29T14:00:00Z"), explicito: true }, AHORA);
  assert.equal(leerRecontacto(nueva).toISOString(), "2026-10-29T14:00:00.000Z");
  assert.equal(leerRecontacto({ otro: 1 }), null);
});

await prueba("Caliente: sube, deja la nota exacta, el historial y las consecuencias", async () => {
  const r = await leer("¿cómo te pago?");
  assert.equal(r.etapa, "NEGOCIACION");
  assert.equal(r.metodo, "frase");
  assert.equal(estado.contacto.crmStage, "NEGOCIACION");
  assert.equal(estado.notasViejas[0].text, "Etapa movida por el sistema: Caliente (el cliente preguntó cómo pagar)");
  assert.equal(estado.notasViejas[0].kind, "stage_changed");
  assert.equal(estado.historial[0].origen, "AUTOMATICO");
  assert.equal(estado.historial[0].nota, "lectura:frase: el cliente preguntó cómo pagar");
  assert.equal(estado.follows.length, 1);
});

await prueba("Tibio: sube y deja fecha de recontacto en la ficha; sin fecha, a 3 días", async () => {
  const r = await leer("voy en noviembre");
  assert.equal(r.etapa, "PROPUESTA");
  assert.equal(r.recontacto, true);
  assert.equal(leerRecontacto(estado.contacto.metadata).toISOString().slice(0, 7), "2026-11");
  assert.ok(estado.notasViejas[0].text.startsWith("Etapa movida por el sistema: Tibio ("));
  reiniciar();
  await leer("lo pienso");
  assert.equal(leerRecontacto(estado.contacto.metadata).toISOString().slice(0, 10), "2026-10-29");
});

await prueba("Caliente que dice 'lo pienso' sigue Caliente, solo se anota la fecha", async () => {
  reiniciar({ contacto: { crmStage: "NEGOCIACION", excludedFromCrm: false, metadata: null } });
  const r = await leer("lo pienso");
  assert.equal(r.etapa, null);
  assert.equal(r.recontacto, true);
  assert.equal(estado.contacto.crmStage, "NEGOCIACION");
  assert.equal(estado.historial.length, 0);
  assert.equal(estado.notasViejas.length, 0);
  assert.ok(leerRecontacto(estado.contacto.metadata));
});

await prueba("Descartado: 'no gracias, ya compré' guarda motivo y frase exacta", async () => {
  const r = await leer("no gracias, ya compré");
  assert.equal(r.etapa, "PERDIDO");
  assert.equal(estado.contacto.crmStage, "PERDIDO");
  assert.equal(estado.contacto.lostReason, "compro_competencia");
  assert.equal(estado.contacto.metadata.descarteAutomatico.frase, "no gracias, ya compré");
  assert.equal(estado.notasViejas[0].text, "Etapa movida por el sistema: Descartado (el cliente dijo: «no gracias, ya compré»)");
  assert.equal(estado.historial[0].nota, "lectura:frase: el cliente dijo: «no gracias, ya compré»");
});

await prueba("'ahorita no puedo' va a Tibio, no a Descartado", async () => {
  const r = await leer("ahorita no puedo");
  assert.equal(r.etapa, "PROPUESTA");
  assert.notEqual(estado.contacto.crmStage, "PERDIDO");
});

await prueba("un Ganado nunca cambia, ni con frase de descarte; un Perdido tampoco", async () => {
  for (const etapa of ["GANADO", "PERDIDO"]) {
    for (const f of ["no me interesa", "¿cómo te pago?", "lo pienso"]) {
      reiniciar({ contacto: { crmStage: etapa, excludedFromCrm: false, metadata: null } });
      const r = await leer(f);
      assert.equal(r.etapa, null, `${etapa} ${f}`);
      assert.equal(estado.contacto.crmStage, etapa);
      assert.equal(estado.historial.length, 0);
    }
  }
});

await prueba("fuera del CRM y línea Admin no se tocan", async () => {
  reiniciar({ contacto: { crmStage: "NUEVO", excludedFromCrm: true, metadata: null } });
  assert.equal((await leer("¿cómo te pago?")).etapa, null);
  reiniciar({ proposito: "ADMIN" });
  assert.equal((await leer("¿cómo te pago?")).etapa, null);
  assert.equal(estado.contacto.crmStage, "NUEVO");
});

await prueba("si una persona movió la etapa hace 2 horas no cambia; hace 2 días sí", async () => {
  reiniciar({ personaMovioHace: 2 });
  assert.equal((await leer("¿cómo te pago?")).etapa, null);
  assert.equal(estado.contacto.crmStage, "NUEVO");
  reiniciar({ personaMovioHace: 48 });
  assert.equal((await leer("¿cómo te pago?")).etapa, "NEGOCIACION");
});

await prueba("si alguien cambió la etapa en el medio, no se pisa", async () => {
  reiniciar({ moverAntesDeGuardar: "PROPUESTA" });
  assert.equal((await leer("¿cómo te pago?")).etapa, null);
  assert.equal(estado.contacto.crmStage, "PROPUESTA");
  assert.equal(estado.historial.length, 0);
});

await prueba("interruptor general apagado: no mueve nada (ni el de lectura)", async () => {
  reiniciar({ interruptores: { "crm:etapa-automatica:ws": "off" } });
  assert.equal((await leer("¿cómo te pago?")).etapa, null);
  reiniciar({ interruptores: { "crm:etapa-por-lectura:ws": "off" } });
  assert.equal((await leer("¿cómo te pago?")).etapa, null);
  assert.equal((await leer("no me interesa")).etapa, null);
  assert.equal(estado.contacto.crmStage, "NUEVO");
  assert.equal(estado.historial.length, 0);
});

await prueba("solo el descarte apagado: 'ya compré' no hace nada pero 'cómo pago' sube a Caliente", async () => {
  reiniciar({ interruptores: { "crm:etapa-por-lectura-descarte:ws": "off" } });
  let ia = 0;
  const r = await leer("no gracias, ya compré", { preguntarALaIa: async () => { ia += 1; return "tibio"; } });
  assert.equal(r.etapa, null);
  assert.equal(ia, 0, "ni siquiera va a la IA");
  assert.equal(estado.contacto.crmStage, "NUEVO");
  assert.equal((await leer("¿cómo te pago?")).etapa, "NEGOCIACION");
});

await prueba("IA: sin frase clara se usa su respuesta y queda contada como ia", async () => {
  const r = await leer("buenas, estoy mirando para armar mi salón nuevo", { preguntarALaIa: async () => "caliente" });
  assert.equal(r.etapa, "NEGOCIACION");
  assert.equal(r.metodo, "ia");
  assert.ok(estado.historial[0].nota.startsWith("lectura:ia:"));
});

await prueba("IA: nunca descarta; falla o 'nada' no mueven; 'ok' no llama a la IA", async () => {
  let llamadas = 0;
  const ia = (respuesta) => async () => { llamadas += 1; return respuesta; };
  const r = await leer("la verdad no creo que me sirva ese modelo", { preguntarALaIa: ia("descartado") });
  assert.equal(r.etapa, "PROPUESTA");
  reiniciar();
  assert.equal((await leer("estoy viendo varias opciones por ahí", { preguntarALaIa: ia("nada") })).etapa, null);
  assert.equal((await leer("estoy viendo varias opciones por ahí", { preguntarALaIa: async () => { throw new Error("sin red"); } })).etapa, null);
  const antes = llamadas;
  for (const corto of ["ok", "gracias", "👍", "listo", "hola"]) await leer(corto, { preguntarALaIa: ia("caliente") });
  assert.equal(llamadas, antes);
  assert.equal(estado.contacto.crmStage, "NUEVO");
});

await prueba("un error de base no lanza", async () => {
  reiniciar({ fallar: true });
  assert.equal((await leer("¿cómo te pago?")).etapa, null);
});

await prueba("la línea oficial deja la nota en su propia tabla", async () => {
  const r = await leer("¿cómo te pago?", { linea: "official" });
  assert.equal(r.etapa, "NEGOCIACION");
  assert.equal(estado.notasViejas.length, 0);
  assert.equal(estado.notasOficiales[0].texto, "Etapa movida por el sistema: Caliente (el cliente preguntó cómo pagar)");
});

console.log(`\n${pruebas} pruebas ok`);
