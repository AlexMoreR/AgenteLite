// Pruebas del MAPA DEL LEAD (transformación pura datos → nodos/aristas). Sin base ni red.
// Correr: npm run test:mapa-lead
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

const m = cargar("src/features/mapa-del-lead/dominio/mapa.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const AHORA = new Date("2026-10-13T15:00:00Z");
const H = 3_600_000;
const hace = (h) => new Date(AHORA.getTime() - h * H).toISOString();
const en = (h) => new Date(AHORA.getTime() + h * H).toISOString();

function chat(id, extra = {}) {
  return {
    id,
    chatKey: `agent:${id}`,
    canal: "agent",
    canalId: `canal-${id}`,
    linea: "Ventas 1",
    estado: "OPEN",
    ultimoMensajeEn: hace(1),
    ultimoClienteEn: hace(2),
    asesora: "Ingrid",
    productoActivo: null,
    embudo: null,
    ...extra,
  };
}

function seg(id, extra = {}) {
  return {
    id,
    nombre: "Tras asesora: 1 h",
    estado: "EXECUTED",
    canalId: "canal-c1",
    programadoPara: hace(5),
    ejecutadoEn: hace(5),
    canceladoEn: null,
    error: null,
    contenido: "Hola, ¿seguimos?",
    ...extra,
  };
}

function base(extra = {}) {
  return {
    contacto: {
      id: "k1",
      nombre: null,
      telefono4: "4567",
      etapa: "PROPUESTA",
      motivoDescarte: null,
      ganadoEn: null,
      cotizacionGanada: null,
      creadoEn: hace(100),
    },
    conversaciones: [chat("c1")],
    cambiosDeEtapa: [],
    notasDeAutomatizacion: [],
    seguimientos: [],
    recordatoriosBot: [],
    llamadas: [],
    ...extra,
  };
}

const porId = (mapa, id) => mapa.nodos.find((n) => n.id === id);
const delTipo = (mapa, tipo) => mapa.nodos.filter((n) => n.tipo === tipo);

prueba("el cliente va al centro, con el teléfono enmascarado si no hay nombre", () => {
  const mapa = m.armarMapaDelLead(base(), { ahora: AHORA });
  const c = porId(mapa, "cliente");
  assert.equal(c.x, 0);
  assert.equal(c.y, 0);
  assert.equal(c.titulo, "•••• 4567");
  assert.match(c.subtitulo, /Tibio/);
  assert.match(c.subtitulo, /Ingrid/);
});

prueba("cadena de etapas: hecho / actual / pendiente según el orden del CRM", () => {
  const mapa = m.armarMapaDelLead(base(), { ahora: AHORA });
  assert.equal(porId(mapa, "etapa:NUEVO").estado, "hecho");
  assert.equal(porId(mapa, "etapa:CALIFICADO").estado, "hecho");
  assert.equal(porId(mapa, "etapa:PROPUESTA").estado, "actual");
  assert.equal(porId(mapa, "etapa:NEGOCIACION").estado, "pendiente");
  assert.equal(porId(mapa, "etapa:GANADO").estado, "pendiente");
  assert.equal(porId(mapa, "etapa:PERDIDO").estado, "pendiente");
  assert.equal(porId(mapa, "etapa:CALIFICADO").titulo, "Frio");
  assert.equal(porId(mapa, "etapa:PERDIDO").titulo, "Descartado");
  assert.ok(mapa.aristas.some((a) => a.desde === "cliente" && a.hasta === "etapa:PROPUESTA"));
});

prueba("descartado: solo cuentan como hechas las etapas por las que pasó (según las notas)", () => {
  const mapa = m.armarMapaDelLead(
    base({
      contacto: { ...base().contacto, etapa: "PERDIDO" },
      cambiosDeEtapa: [
        { conversationId: "c1", en: hace(50), texto: 'Ingrid cambió la etapa a "Frío"' },
        { conversationId: "c1", en: hace(10), texto: 'Ingrid cambió la etapa a "Descartado" (motivo: precio)' },
      ],
    }),
    { ahora: AHORA },
  );
  assert.equal(porId(mapa, "etapa:CALIFICADO").estado, "hecho");
  assert.equal(porId(mapa, "etapa:PROPUESTA").estado, "pendiente");
  assert.equal(porId(mapa, "etapa:PERDIDO").estado, "actual");
  assert.equal(porId(mapa, "etapa:GANADO").estado, "pendiente");
});

prueba("lee la etapa de las notas (con o sin tilde, label o valor crudo)", () => {
  assert.equal(m.etapaDeLaNota('El agente movió la etapa a "Caliente"'), "NEGOCIACION");
  assert.equal(m.etapaDeLaNota('Ana cambió la etapa a "Frio"'), "CALIFICADO");
  assert.equal(m.etapaDeLaNota('Auto cambió la etapa a "GANADO" (cotización COT-1)'), "GANADO");
  assert.equal(m.etapaDeLaNota("asignó a María"), null);
});

prueba("clases de seguimiento por el prefijo del nombre", () => {
  assert.equal(m.claseDelFollow("Tras asesora: 24 h"), "tras_asesora");
  assert.equal(m.claseDelFollow("Etapa Tibio · 2"), "etapa");
  assert.equal(m.claseDelFollow("Inteligente: camillas"), "inteligente");
  assert.equal(m.claseDelFollow("Campaña: Octubre"), "campana");
  assert.equal(m.claseDelFollow("Automatización: Reactivar #ab12cd"), "automatizacion");
  assert.equal(m.claseDelFollow("Lo que sea"), "otro");
  assert.equal(m.nombreDeAutomatizacion("Automatización: Reactivar tibios #ab12cd"), "Reactivar tibios");
});

prueba("seguimientos: enviado con 'respondió', pendiente programado, cancelado con motivo", () => {
  const mapa = m.armarMapaDelLead(
    base({
      seguimientos: [
        seg("s1", { ejecutadoEn: hace(5) }), // el cliente escribió hace 2 h → respondió
        seg("s2", { estado: "PENDING", ejecutadoEn: null, programadoPara: en(3) }),
        seg("s3", { estado: "CANCELLED", ejecutadoEn: null, canceladoEn: hace(8), error: "El cliente escribió" }),
        seg("s4", { ejecutadoEn: hace(1) }), // después del último mensaje del cliente → no respondió
      ],
    }),
    { ahora: AHORA },
  );
  assert.equal(porId(mapa, "seguimiento:s1").insignia, "respondió");
  assert.equal(porId(mapa, "seguimiento:s4").insignia, null);
  assert.equal(porId(mapa, "seguimiento:s2").estado, "programado");
  const s3 = porId(mapa, "seguimiento:s3");
  assert.equal(s3.estado, "cancelado");
  assert.ok(s3.detalle.filas.some((f) => f.etiqueta === "Motivo" && f.valor === "El cliente escribió"));
  // Cuelgan del chat de su línea.
  assert.ok(mapa.aristas.some((a) => a.desde === "c1" && a.hasta === "seguimiento:s1"));
});

prueba("los seguimientos viejos (más de 30 días) no salen; los pendientes sí", () => {
  const mapa = m.armarMapaDelLead(
    base({
      seguimientos: [
        seg("viejo", { ejecutadoEn: hace(24 * 40), programadoPara: hace(24 * 40) }),
        seg("pend", { estado: "PENDING", ejecutadoEn: null, programadoPara: hace(24 * 40) }),
      ],
    }),
    { ahora: AHORA },
  );
  assert.equal(porId(mapa, "seguimiento:viejo"), undefined);
  assert.ok(porId(mapa, "seguimiento:pend"));
});

prueba("los Follow de automatización van como nodo de automatización, con su nombre", () => {
  const mapa = m.armarMapaDelLead(
    base({
      seguimientos: [seg("a1", { nombre: "Automatización: Reactivar tibios #ab12cd" })],
      notasDeAutomatizacion: [{ conversationId: "c1", en: hace(3), texto: "⚙️ Automatización «Asignar Bogotá» (Ana): asignar" }],
    }),
    { ahora: AHORA },
  );
  const a1 = porId(mapa, "seguimiento:a1");
  assert.equal(a1.tipo, "automatizacion");
  assert.equal(a1.titulo, "Reactivar tibios");
  const notas = delTipo(mapa, "automatizacion").filter((n) => n.titulo === "Asignar Bogotá");
  assert.equal(notas.length, 1);
  assert.equal(mapa.conteos.automatizacion, 2);
});

prueba("recordatorios del bot V3: cuentan como seguimiento y marcan respondió", () => {
  const mapa = m.armarMapaDelLead(
    base({ recordatoriosBot: [{ conversationId: "c1", en: hace(3), texto: "¿Te quedó alguna duda?" }] }),
    { ahora: AHORA },
  );
  const r = delTipo(mapa, "seguimiento")[0];
  assert.equal(r.titulo, "Recordatorio del bot");
  assert.equal(r.insignia, "respondió");
});

prueba("bot V3, tarea vencida y cotización salen del EmbudoLead del chat", () => {
  const mapa = m.armarMapaDelLead(
    base({
      conversaciones: [
        chat("c1", {
          embudo: {
            pasoActual: "OBJECIONES",
            pasoMaximo: "CIERRE",
            producto: "combo-camilla",
            temperatura: "CALIENTE",
            accion: "tarea_asesora",
            motivo: "caliente_esperando",
            tareaVence: hace(1),
            tareaPrioridad: "A",
            cotizacionRef: "COT-00123",
            cotizacionEn: hace(20),
            ventaEn: null,
          },
        }),
      ],
    }),
    { ahora: AHORA },
  );
  assert.equal(porId(mapa, "bot:c1").titulo, "Bot: Dudas y objeciones");
  assert.equal(porId(mapa, "bot:c1").subtitulo, "combo-camilla");
  const t = porId(mapa, "tarea:c1");
  assert.equal(t.titulo, "Caliente esperando respuesta");
  assert.equal(t.estado, "vencida");
  assert.equal(porId(mapa, "cotizacion:c1").titulo, "COT-00123");
  assert.match(porId(mapa, "cliente").subtitulo, /Caliente/);
});

prueba("llamadas a la izquierda del cliente", () => {
  const mapa = m.armarMapaDelLead(
    base({ llamadas: [{ id: "l1", intento: 1, en: hace(4), resultado: "No contestó", resumen: null, quien: "Ingrid", proximoContactoEn: null }] }),
    { ahora: AHORA },
  );
  const l = porId(mapa, "llamada:l1");
  assert.ok(l.x < 0);
  assert.ok(mapa.aristas.some((a) => a.desde === "cliente" && a.hasta === "llamada:l1"));
});

prueba("más de N en un grupo: se recortan con '+N más' y se abren con expandidos", () => {
  const muchos = Array.from({ length: 9 }, (_, i) => seg(`s${i}`, { ejecutadoEn: hace(10 + i) }));
  const cerrado = m.armarMapaDelLead(base({ seguimientos: muchos }), { ahora: AHORA, limitePorGrupo: 4 });
  const visibles = delTipo(cerrado, "seguimiento");
  assert.equal(visibles.length, 4);
  const mas = delTipo(cerrado, "mas");
  assert.equal(mas.length, 1);
  assert.equal(mas[0].restantes, 5);
  assert.equal(mas[0].titulo, "+5 más");
  // Lo más reciente primero.
  assert.equal(visibles[0].id, "seguimiento:s0");
  assert.equal(cerrado.conteos.seguimiento, 9);

  const abierto = m.armarMapaDelLead(base({ seguimientos: muchos }), { ahora: AHORA, limitePorGrupo: 4, expandidos: new Set([mas[0].grupo]) });
  assert.equal(delTipo(abierto, "seguimiento").length, 9);
  assert.equal(delTipo(abierto, "mas").length, 0);
});

prueba("los pendientes van antes que los enviados en su grupo", () => {
  const mapa = m.armarMapaDelLead(
    base({ seguimientos: [seg("env", { ejecutadoEn: hace(1) }), seg("pend", { estado: "PENDING", ejecutadoEn: null, programadoPara: en(5) })] }),
    { ahora: AHORA },
  );
  const lista = delTipo(mapa, "seguimiento");
  assert.equal(lista[0].id, "seguimiento:pend");
});

prueba("filtros: ocultar un tipo quita sus nodos pero no su conteo", () => {
  const datos = base({ seguimientos: [seg("s1")], llamadas: [{ id: "l1", intento: 1, en: hace(4), resultado: "Contestó", resumen: null, quien: null, proximoContactoEn: null }] });
  const mapa = m.armarMapaDelLead(datos, { ahora: AHORA, ocultos: new Set(["seguimiento", "etapa"]) });
  assert.equal(delTipo(mapa, "seguimiento").length, 0);
  assert.equal(delTipo(mapa, "etapa").length, 0);
  assert.ok(porId(mapa, "llamada:l1"));
  assert.equal(mapa.conteos.seguimiento, 1);
});

prueba("ocultar conversaciones: lo del chat cuelga del cliente", () => {
  const mapa = m.armarMapaDelLead(base({ seguimientos: [seg("s1")] }), { ahora: AHORA, ocultos: new Set(["conversacion"]) });
  assert.equal(porId(mapa, "c1"), undefined);
  assert.ok(mapa.aristas.some((a) => a.desde === "cliente" && a.hasta === "seguimiento:s1"));
});

prueba("conversación con chatKey para 'Abrir chat'", () => {
  const mapa = m.armarMapaDelLead(base(), { ahora: AHORA });
  assert.equal(porId(mapa, "c1").detalle.chatKey, "agent:c1");
});

prueba("determinista y sin nodos encimados con ~50 nodos", () => {
  const datos = base({
    conversaciones: [chat("c1"), chat("c2", { canalId: "canal-c2", linea: "Ventas 2", ultimoMensajeEn: hace(30) })],
    seguimientos: [
      ...Array.from({ length: 12 }, (_, i) => seg(`a${i}`, { ejecutadoEn: hace(i + 3) })),
      ...Array.from({ length: 6 }, (_, i) => seg(`b${i}`, { nombre: "Etapa Tibio · 1", canalId: "canal-c2", ejecutadoEn: hace(i + 3) })),
      ...Array.from({ length: 6 }, (_, i) => seg(`c${i}`, { nombre: "Inteligente: x", ejecutadoEn: hace(i + 3) })),
    ],
    recordatoriosBot: Array.from({ length: 8 }, (_, i) => ({ conversationId: "c2", en: hace(i + 1), texto: "hola" })),
    llamadas: Array.from({ length: 7 }, (_, i) => ({ id: `l${i}`, intento: i + 1, en: hace(i), resultado: "Contestó", resumen: null, quien: null, proximoContactoEn: null })),
  });
  const a = m.armarMapaDelLead(datos, { ahora: AHORA });
  const b = m.armarMapaDelLead(datos, { ahora: AHORA });
  assert.deepEqual(a, b);
  const posiciones = new Set(a.nodos.map((n) => `${n.x},${n.y}`));
  assert.equal(posiciones.size, a.nodos.length, "dos nodos en el mismo lugar");
  // Toda arista apunta a nodos que existen.
  const ids = new Set(a.nodos.map((n) => n.id));
  for (const e of a.aristas) assert.ok(ids.has(e.desde) && ids.has(e.hasta), e.id);
  // Ids únicos.
  assert.equal(ids.size, a.nodos.length);
  assert.ok(a.nodos.length <= 50, `demasiados nodos visibles: ${a.nodos.length}`);
});

console.log(`\n${pruebas} pruebas ok`);
