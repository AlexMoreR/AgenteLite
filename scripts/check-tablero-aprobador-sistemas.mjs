// Pruebas del aprobador de Sistemas (Emanuel, periodo de prueba hasta el 29-nov-2026): aprueba la tarea, el plan y la
// subida de tarjetas de Tecnología; no aprueba lo que toca dinero o Meta Ads; vence solo; una asesora o un aprobador
// DESARROLLO siguen sin dar el sí final. Y los avisos técnicos van al WhatsApp de Emanuel (con respaldo al dueño).
// Con un prisma y una línea de WhatsApp FALSOS. No necesita base ni red.
// Correr: node scripts/check-tablero-aprobador-sistemas.mjs
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const alertas = cargar("src/features/alertas/dominio/reglas.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const ANTES = new Date("2026-11-10T15:00:00Z");
const ULTIMO_DIA = new Date("2026-11-30T03:00:00Z"); // 29-nov 10:00 p. m. de Bogotá: todavía vale
const VENCIDO = new Date("2026-11-30T06:00:00Z"); // 30-nov 1:00 a. m. de Bogotá: ya no
const emanuel = { esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "SISTEMAS", puedeSubir: true } };
const dueno = { esDueno: true, esAdminPlataforma: false, aprobador: null };
const asesora = { esDueno: false, esAdminPlataforma: false, aprobador: null };
const desarrollo = { esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "DESARROLLO", puedeSubir: true } };
const tecnica = { titulo: "Arreglar el botón de enviar en el chat", detalle: "No responde en el celular.", plan: "Cambiar el handler del botón.", area: "CRM Ventas" };
const puede = (persona, momento, tarjeta = tecnica, { zonas = [], repo = "aizencrm", ahora = ANTES, via = "pantalla" } = {}) =>
  trabajo.personaPuedeAprobarMomento(persona, momento, via, repo, zonas, tarjeta, ahora);

await prueba("Emanuel aprueba la tarea, el plan y la subida de una tarjeta de Tecnología", () => {
  for (const momento of ["tarea", "plan", "subir"]) assert.equal(puede(emanuel, momento), null, momento);
  for (const area of ["CRM Ventas", "Gestión", "CRM Marketplace", "Coordinador", "General"]) {
    assert.equal(puede(emanuel, "subir", { ...tecnica, area }), null, area);
  }
});

await prueba("Emanuel no aprueba lo que toca dinero o Meta Ads (en español, varias formas)", () => {
  const casos = [
    { titulo: "Calcular las comisiones del mes" },
    { titulo: "Mostrar el saldo pendiente de cada abono" },
    { detalle: "Arreglar la nómina de noviembre" },
    { titulo: "Facturación electrónica de los pedidos" },
    { plan: "Subir el presupuesto de la campaña" },
    { titulo: "Crear una campaña nueva en Meta Ads" },
    { detalle: "Cambiar los anuncios del embudo" },
    { plan: "Registrar los pagos de contraentrega" },
  ];
  for (const caso of casos) {
    for (const momento of ["tarea", "plan", "subir"]) {
      assert.match(puede(emanuel, momento, { ...tecnica, ...caso }) ?? "", /toca dinero o Meta Ads: la aprueba Alexander/, `${momento}: ${JSON.stringify(caso)}`);
    }
  }
  assert.match(puede(emanuel, "tarea", tecnica, { zonas: ["META_ADS"] }) ?? "", /zona protegida/);
  // El dueño sí aprueba esas mismas tarjetas.
  assert.equal(puede(dueno, "tarea", { ...tecnica, titulo: "Calcular las comisiones" }), null);
  // Una tarjeta técnica normal no se bloquea por palabras sueltas como permisos o clave.
  assert.equal(puede(emanuel, "tarea", { ...tecnica, titulo: "Cambiar los permisos del tablero y la clave del Coordinador" }), null);
});

await prueba("Emanuel no aprueba tarjetas de otra área ni con zona protegida", () => {
  assert.match(puede(emanuel, "tarea", { ...tecnica, area: "Ventas" }) ?? "", /solo tarjetas de Tecnología/);
  assert.match(puede(emanuel, "plan", { ...tecnica, area: "Marketing" }) ?? "", /solo tarjetas de Tecnología/);
  assert.match(puede(emanuel, "subir", { ...tecnica, area: "Ventas" }) ?? "", /solo tarjetas de Tecnología/);
  assert.match(puede(emanuel, "tarea", tecnica, { zonas: ["BOT_VENTAS"] }) ?? "", /zona protegida/);
  assert.match(puede(emanuel, "subir", tecnica, { zonas: ["CHATS"] }) ?? "", /zona protegida/);
  // Sin área conocida: solo si es un repo de desarrollo; sin repo, no.
  assert.equal(puede(emanuel, "tarea", { ...tecnica, area: null }), null);
  assert.match(puede(emanuel, "tarea", { ...tecnica, area: null }, { repo: null }) ?? "", /Tecnología/);
  // Sin saber la tarjeta no aprueba.
  assert.match(puede(emanuel, "tarea", null) ?? "", /dueño/);
});

await prueba("El permiso vence el 29-nov (día de Bogotá) y se puede prorrogar con un ajuste", () => {
  assert.equal(puede(emanuel, "subir", tecnica, { ahora: ULTIMO_DIA }), null);
  for (const momento of ["tarea", "plan", "subir"]) {
    assert.match(puede(emanuel, momento, tecnica, { ahora: VENCIDO }) ?? "", /venció/, momento);
  }
  assert.equal(puede({ ...emanuel, sistemasHasta: "2026-12-29" }, "subir", tecnica, { ahora: VENCIDO }), null);
  assert.equal(trabajo.permisoDeSistemasVigente(ANTES, "no es fecha"), false);
  assert.equal(puede(dueno, "subir", tecnica, { ahora: VENCIDO }), null);
});

await prueba("Una asesora o un aprobador DESARROLLO siguen sin dar el sí final", () => {
  for (const persona of [asesora, desarrollo]) {
    assert.match(puede(persona, "subir") ?? "", /solo el dueño/);
  }
  assert.equal(puede(desarrollo, "tarea"), null);
  assert.match(puede(asesora, "tarea") ?? "", /No puedes aprobar/);
});

await prueba("puedeAprobarMomento: la subida de Emanuel pasa por la misma regla completa (pantalla y voz)", () => {
  const pedido = (extra) => ({
    momento: "subir", via: "pantalla", origen: "PANTALLA", estado: "POR_REVISAR", requiereAprobacion: true, usaEstados: true,
    repo: "aizencrm", zonaProtegida: [], tienePlan: true, resultadoPaso: true, persona: emanuel, tarjeta: tecnica, ahora: ANTES, ...extra,
  });
  assert.deepEqual(trabajo.puedeAprobarMomento(pedido({})), { a: "SUBIENDO", momento: "subir" });
  assert.match(trabajo.puedeAprobarMomento(pedido({ tarjeta: { ...tecnica, titulo: "Pagar la nómina" } })).error, /Alexander/);
  assert.match(trabajo.puedeAprobarMomento(pedido({ persona: asesora })).error, /solo el dueño/);
  assert.match(trabajo.puedeAprobarMomento(pedido({ ahora: VENCIDO })).error, /venció/);
  const voz = trabajo.puedeAprobarMomento(pedido({ via: "voz", origen: "MCP", textoConfirmacion: "sí, apruebo subir" }));
  assert.deepEqual(voz, { a: "SUBIENDO", momento: "subir" });
  const vozDinero = trabajo.puedeAprobarMomento(pedido({ via: "voz", origen: "MCP", textoConfirmacion: "sí, apruebo subir", tarjeta: { ...tecnica, detalle: "campañas de Meta Ads" } }));
  assert.match(vozDinero.error, /Alexander/);
});

await prueba("el historial marca la aprobación de Emanuel como periodo de prueba", () => {
  const registro = trabajo.registroDeAprobacion({ estado: "APROBADO", momento: "tarea", via: "pantalla", quienNombre: "Emanuel Díaz", userId: "u1", textoConfirmacion: null, periodoDePrueba: true });
  assert.equal(registro.periodoDePrueba, true);
  assert.match(registro.como, /periodo de prueba/);
  assert.equal(trabajo.registroDeAprobacion({ estado: "APROBADO", momento: "tarea", via: "pantalla", quienNombre: "A", userId: "u", textoConfirmacion: null }).como, "aprobado en pantalla");
});

await prueba("la lista de dinero y Meta Ads: ejemplos reales", () => {
  for (const si of ["abonos de clientes", "saldo de la tarjeta", "nómina", "comisiones", "facturación", "campañas de Meta Ads", "gasto en anuncios", "Presupuesto"]) {
    assert.equal(alertas.tocaDineroOMetaAds(si), true, si);
    assert.equal(alertas.esDeDineroMetaOClave(si), true, si);
  }
  for (const no of ["cambiar el color del botón", "arreglar el chat en el celular", "agregar una columna a la tabla"]) {
    assert.equal(alertas.tocaDineroOMetaAds(no), false, no);
  }
});

/* ------------------------------------------------------------------ avisos técnicos a Emanuel */

const LINEA_ADMIN = "cmt06kiob00lw2hk2mgllstsb";
const estado = {};
const reiniciar = () =>
  Object.assign(estado, {
    ajustes: new Map(),
    lineas: [
      { id: LINEA_ADMIN, workspaceId: "ws1", name: "Admin", phoneNumber: "573009990000", isActive: true, evolutionInstanceName: "admin-inst" },
      { id: "ventas1", workspaceId: "ws1", name: "Ventas", phoneNumber: "573008880000", isActive: true, evolutionInstanceName: "ventas-inst" },
    ],
    miembros: [],
    esperando: [],
    enviados: [],
    alertas: [],
  });
reiniciar();
const falso = {
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  whatsAppChannel: {
    findMany: async ({ where }) => estado.lineas.filter((l) => l.workspaceId === where.workspaceId),
    findFirst: async ({ where }) => estado.lineas.find((l) => l.workspaceId === where.workspaceId && (where.id === undefined || l.id === where.id)) ?? null,
  },
  workspaceMember: { findMany: async () => estado.miembros },
  tarjetaTablero: { findMany: async () => [], count: async () => 0 },
  historialTarjeta: { groupBy: async () => [] },
  $queryRawUnsafe: async () => [],
  alertaInterna: {
    findFirst: async ({ where }) => estado.alertas.find((a) => a.clave === where.clave && (a.destinatarioId ?? null) === (where.destinatarioId ?? null) && ["NUEVA", "VISTA"].includes(a.estado)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `al${estado.alertas.length + 1}`, estado: "NUEVA", salioPorWhatsApp: false, veces: 1, ...data };
      estado.alertas.push(fila);
      return { id: fila.id };
    },
    update: async ({ where, data }) => Object.assign(estado.alertas.find((a) => a.id === where.id), data),
    updateMany: async ({ where, data }) => {
      for (const a of estado.alertas.filter((x) => x.clave === where.clave)) Object.assign(a, data);
    },
  },
};
const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async (datos) => void estado.enviados.push(datos) },
  "./coordinador-en-vivo": { ultimoLatido: async () => null },
  "./tableros": {
    pendientesDelDueno: async () => estado.esperando,
    todoElNegocio: (workspaceId) => ({ workspaceId, soloDe: null }),
    linkDeHoy: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=hoy",
    linkDelCoordinador: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=coordinador",
    linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}`,
  },
};
const avisos = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts", mocks);
const DIA = new Date("2026-11-02T15:00:00Z"); // 10:00 a. m. de Bogotá
const NOCHE = new Date("2026-11-03T04:00:00Z"); // 11:00 p. m.
const NUMERO_EMANUEL = "573115550000";
const NUMERO_DUENO = "573001112233";
const configurar = ({ emanuel = true, responsable = true } = {}) => {
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", NUMERO_DUENO);
  if (emanuel) estado.ajustes.set("tablero:avisos-sistemas:telefono:ws1", NUMERO_EMANUEL);
  if (responsable) estado.ajustes.set("alertas:responsable-sistemas:ws1", "u-emanuel");
};
const aviso = (tipo, clave, extra = {}) => ({ clave, tipo, lineas: [`aviso ${tipo}`], link: "https://x/y", prioridad: "ALTA", titulo: `titulo ${tipo}`, ...extra });
const numeroDeLosEnviados = () => estado.enviados.map((e) => e.phoneNumber);

await prueba("el teléfono de Sistemas se valida en el servidor (no puede ser una línea del negocio)", async () => {
  reiniciar();
  assert.equal((await avisos.guardarConfigDeSistemas("ws1", { telefono: "573008880000" })).ok, false);
  assert.equal((await avisos.guardarConfigDeSistemas("ws1", { telefono: "no es un número" })).ok, false);
  assert.deepEqual(await avisos.guardarConfigDeSistemas("ws1", { telefono: "311 555 0000", activo: true }), { ok: true });
  assert.equal(estado.ajustes.get("tablero:avisos-sistemas:telefono:ws1"), NUMERO_EMANUEL);
});

await prueba("tipos: los técnicos son de Emanuel; dinero, Meta Ads o clave y aprobar en pantalla siguen siendo de Alexander", () => {
  for (const tipo of ["caido", "sin_trabajo", "trabado", "limite"]) assert.equal(avisos.esAvisoTecnico(tipo), true, tipo);
  for (const tipo of ["necesita", "aprobar_en_pantalla"]) assert.equal(avisos.esAvisoTecnico(tipo), false, tipo);
});

await prueba("una tarjeta en ERROR sale al WhatsApp de Emanuel (no al de Alexander) y la alerta queda a su nombre", async () => {
  reiniciar();
  configurar();
  const situacion = {
    latidoEn: DIA.toISOString(), enCurso: [{ id: "x", titulo: "X", estado: "EN_CURSO", desde: DIA }], enFila: 0, fueraPorLaVia: [],
    esperando: [{ id: "t1", titulo: "Arreglar el chat", detalle: "", estado: "ERROR", plan: null, zonaProtegida: [], error: "Falló el build" }],
  };
  const calculados = avisos.calcularAvisos(situacion, DIA);
  assert.deepEqual(calculados.map((a) => a.tipo), ["trabado"]);
  // La vuelta completa necesita lo que lee de la base: se prueba el destino y el envío con las piezas públicas.
  const destino = await avisos.destinoDeSistemas("ws1");
  assert.deepEqual(destino, { numero: NUMERO_EMANUEL, responsableId: "u-emanuel" });
});

await prueba("la vuelta completa: tarjeta en ERROR → WhatsApp de Emanuel, alerta a su nombre, una sola vez; de noche espera", async () => {
  reiniciar();
  configurar();
  estado.esperando = [{ id: "t1", titulo: "Arreglar el chat", detalle: "", estado: "ERROR", plan: null, zonaProtegida: [], resultado: { error: "Falló el build" } }];
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", NUMERO_DUENO);
  assert.deepEqual(await avisos.revisarNegocio("ws1", NOCHE), { enviados: 0 }, "de noche (11 p. m.) solo sale el Coordinador caído");
  assert.equal(estado.enviados.length, 0);
  assert.deepEqual(await avisos.revisarNegocio("ws1", DIA), { enviados: 0 }, "'enviados' cuenta lo que salió al dueño: nada");
  assert.deepEqual(numeroDeLosEnviados(), [NUMERO_EMANUEL], "salió a Emanuel, no a Alexander");
  assert.match(estado.enviados[0].text, /quedó en error/);
  const alerta = estado.alertas.find((a) => a.clave.startsWith("auto:trabado:t1"));
  assert.equal(alerta.destinatarioId, "u-emanuel");
  await avisos.revisarNegocio("ws1", new Date(DIA.getTime() + 60_000));
  assert.equal(estado.enviados.length, 1, "no se repite antes de 3 horas");
});

await prueba("la vuelta completa con una tarjeta que pide una clave: sigue yendo a Alexander", async () => {
  reiniciar();
  configurar();
  estado.esperando = [{ id: "t2", titulo: "Conectar Meta", detalle: "", estado: "ERROR", plan: null, zonaProtegida: [], resultado: { error: "Falta la clave de la API: 403 sin permiso" } }];
  await avisos.revisarNegocio("ws1", DIA);
  assert.deepEqual(numeroDeLosEnviados(), [NUMERO_DUENO]);
  assert.equal(estado.alertas[0].destinatarioId ?? null, null);
});

await prueba("respaldo: sin teléfono válido o con el interruptor apagado, no hay destino de Sistemas y todo sigue al dueño", async () => {
  reiniciar();
  configurar({ emanuel: false });
  assert.equal(await avisos.destinoDeSistemas("ws1"), null);
  reiniciar();
  configurar();
  estado.ajustes.set("tablero:avisos-sistemas:activo:ws1", "false");
  assert.equal(await avisos.destinoDeSistemas("ws1"), null);
  reiniciar();
  configurar();
  estado.ajustes.set("tablero:avisos-sistemas:telefono:ws1", "573008880000"); // quedó el de una línea: no sirve
  assert.equal(await avisos.destinoDeSistemas("ws1"), null);
});

await prueba("registrarAvisoDelCoordinador: el límite de Claude va a Emanuel; 'necesita' por dinero sigue yendo a Alexander", async () => {
  reiniciar();
  configurar();
  const limite = await avisos.registrarAvisoDelCoordinador("ws1", "limite", "⛔ Claude llegó a su límite de uso.\nVuelve a las 3:20 p. m.", DIA);
  assert.equal(limite.salio, true);
  assert.deepEqual(numeroDeLosEnviados(), [NUMERO_EMANUEL]);
  assert.equal(estado.alertas[0].destinatarioId, "u-emanuel");
  const dinero = await avisos.registrarAvisoDelCoordinador("ws1", "necesita", "Hay que subir el presupuesto de Meta Ads: necesita tu sí.", DIA);
  assert.equal(dinero.salio, true);
  assert.deepEqual(numeroDeLosEnviados(), [NUMERO_EMANUEL, NUMERO_DUENO]);
  assert.equal(estado.alertas[1].destinatarioId ?? null, null, "la de dinero no es personal de Emanuel");
});

await prueba("registrarAvisoDelCoordinador: sin teléfono de Sistemas, el límite sale al dueño como antes", async () => {
  reiniciar();
  configurar({ emanuel: false });
  const limite = await avisos.registrarAvisoDelCoordinador("ws1", "limite", "⛔ Claude llegó a su límite de uso.", DIA);
  assert.equal(limite.salio, true);
  assert.deepEqual(numeroDeLosEnviados(), [NUMERO_DUENO]);
  assert.equal(estado.alertas[0].destinatarioId ?? null, null);
});

console.log(`\n${pruebas} pruebas, todas bien`);
