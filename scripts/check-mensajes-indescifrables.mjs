// Pruebas de la red de mensajes indescifrables de WAHA (src/features/mensajes-indescifrables y
// docker/vigilante-indescifrables), sin base real ni red:
//   npm run test:mensajes-indescifrables
// 1. Las reglas puras (modos, decisión, lote, texto del aviso).
// 2. El vigilante: lee las líneas del log y corre con --desde-archivo --simular.
// 3. El registro y la revisión a los 2 min con un prisma FALSO: APAGADO no guarda, idempotente, falso
//    positivo (Message o evento del webhook), SOMBRA no toca nada, PRUEBA, ACTIVO en ventas y en ADMIN,
//    la propia línea, la nota OUTBOUND/SYSTEM (nunca INBOUND) y el WhatsApp agrupado cada 15 min.
// 4. La migración: solo CREATE TABLE/INDEX, coherente con schema.prisma, y aplicada en PGlite.
// 5. El cableado: el webhook de Evolution importa la conversación del lib, el de WAHA marca los tres puntos
//    y el reloj llama una vez.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const leer = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), "utf8");

/* ───────────────────────── prisma falso ───────────────────────── */

const tablas = { appSetting: [], whatsAppChannel: [], mensajeIndescifrable: [], message: [], contact: [], conversation: [] };
let secuencia = 0;
const nuevoId = (prefijo) => `${prefijo}${++secuencia}`;

function cumple(valor, condicion) {
  if (condicion === null) return valor === null || valor === undefined;
  if (condicion instanceof Date) return valor instanceof Date && valor.getTime() === condicion.getTime();
  if (condicion && typeof condicion === "object") {
    if ("path" in condicion) {
      const leido = condicion.path.reduce((nodo, clave) => (nodo && typeof nodo === "object" ? nodo[clave] : undefined), valor);
      return leido === condicion.equals;
    }
    return Object.entries(condicion).every(([op, esperado]) => {
      if (op === "in") return esperado.includes(valor);
      if (op === "lte") return valor != null && valor <= esperado;
      if (op === "gte") return valor != null && valor >= esperado;
      if (op === "contains") return typeof valor === "string" && valor.includes(esperado);
      if (op === "not") return valor !== esperado;
      throw new Error(`operador no soportado en el prisma falso: ${op}`);
    });
  }
  return valor === condicion;
}
function coincide(fila, where = {}) {
  return Object.entries(where).every(([campo, condicion]) => {
    if (campo === "OR") return condicion.some((opcion) => coincide(fila, opcion));
    if (campo === "workspaceId_phoneNumber") return fila.workspaceId === condicion.workspaceId && fila.phoneNumber === condicion.phoneNumber;
    return cumple(fila[campo], condicion);
  });
}
function aplicar(fila, data) {
  for (const [campo, valor] of Object.entries(data)) {
    fila[campo] = valor && typeof valor === "object" && "increment" in valor ? (fila[campo] ?? 0) + valor.increment : valor;
  }
  return fila;
}
const recortar = (fila, select) => (fila && select ? Object.fromEntries(Object.keys(select).map((k) => [k, fila[k] ?? null])) : fila ?? null);

function modelo(nombre, porDefecto = () => ({})) {
  const t = tablas[nombre];
  return {
    findUnique: async ({ where, select }) => recortar(t.find((f) => coincide(f, where)), select),
    findFirst: async ({ where, select }) => recortar(t.find((f) => coincide(f, where)), select),
    findMany: async ({ where, select, take } = {}) => t.filter((f) => coincide(f, where)).slice(0, take ?? Infinity).map((f) => recortar(f, select)),
    create: async ({ data, select }) => {
      if (nombre === "appSetting" && t.some((f) => f.key === data.key)) throw new ErrorDePrisma("P2002");
      const fila = { id: nuevoId(nombre.slice(0, 3)), ...porDefecto(), ...data };
      t.push(fila);
      return recortar(fila, select);
    },
    createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const fila of data) {
        if (skipDuplicates && t.some((f) => f.channelId === fila.channelId && f.idCrudo === fila.idCrudo)) continue;
        t.push({ id: nuevoId("mi"), estado: "PENDIENTE", intentos: 0, reclamadoEn: null, avisadoEn: null, lid: "", ...fila });
        count += 1;
      }
      return { count };
    },
    update: async ({ where, data }) => aplicar(t.find((f) => coincide(f, where)), data),
    updateMany: async ({ where, data }) => {
      const filas = t.filter((f) => coincide(f, where));
      for (const fila of filas) aplicar(fila, data);
      return { count: filas.length };
    },
    upsert: async ({ where, create, update, select }) => {
      const fila = t.find((f) => coincide(f, where));
      if (fila) return recortar(aplicar(fila, update), select);
      const nueva = { id: nuevoId(nombre.slice(0, 3)), ...porDefecto(), ...create };
      t.push(nueva);
      return recortar(nueva, select);
    },
  };
}

class ErrorDePrisma extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const falso = {
  appSetting: modelo("appSetting"),
  whatsAppChannel: modelo("whatsAppChannel"),
  mensajeIndescifrable: modelo("mensajeIndescifrable"),
  message: modelo("message", () => ({ createdAt: new Date() })),
  contact: modelo("contact", () => ({ name: null, bloqueadoEn: null, createdAt: new Date() })),
  conversation: modelo("conversation", () => ({ assignedToUserId: null, updatedAt: new Date() })),
};

const espias = { alertas: [], whatsapps: [], repartos: [], pushes: [], whatsappSale: true };
const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: { PrismaClientKnownRequestError: ErrorDePrisma } },
  "@/features/alertas/servicios/alertas": {
    registrarAlerta: async (pedido) => {
      espias.alertas.push(pedido);
      return { id: "al", creada: true, salioPorWhatsApp: false };
    },
  },
  "@/features/avisos-gravedad/servicios/enrutador": {
    leerConfigGravedad: async () => ({ whatsapp: { activo: true } }),
    intentarWhatsAppAAlexander: async (input) => {
      espias.whatsapps.push(input);
      return espias.whatsappSale ? { ok: true } : { ok: false, motivo: "falla de prueba" };
    },
  },
  "@/features/embudo/servicios/eventos": { registrarDesdeActividad: () => undefined },
  "@/lib/evolution": { readGatewayConnection: () => ({ baseUrl: "http://waha", apiToken: "t" }) },
  "@/lib/waha": { telefonoDeUnLid: async ({ lid }) => ({ "111111111111111": "573001112233", "999999999999999": "573000000001" })[lid] ?? null },
  "@/lib/reparto-de-leads": {
    autoAssignConversationToCollaborator: async (args) => {
      espias.repartos.push(args);
      await falso.conversation.updateMany({ where: { id: args.conversationId, assignedToUserId: null }, data: { assignedToUserId: "asesora1" } });
      return "asesora1";
    },
  },
  "@/lib/web-push": {
    sendPushToUser: async (input) => {
      espias.pushes.push(input);
      return 1;
    },
  },
};

const reglas = cargar("src/features/mensajes-indescifrables/dominio/reglas.ts", mocks);
const registro = cargar("src/features/mensajes-indescifrables/servicios/registro.ts", mocks);
const revision = cargar("src/features/mensajes-indescifrables/servicios/revision.ts", mocks);

/* ───────────────────────── 1. reglas puras ───────────────────────── */

await prueba("sin fila o con texto raro el modo es APAGADO; los cuatro modos se leen", () => {
  assert.equal(reglas.leerModo(null), "APAGADO");
  assert.equal(reglas.leerModo("prendido"), "APAGADO");
  for (const modo of ["APAGADO", "SOMBRA", "PRUEBA", "ACTIVO"]) assert.equal(reglas.leerModo(` ${modo.toLowerCase()} `), modo);
  assert.deepEqual([...reglas.leerLidsDePrueba("111@lid, 222\n333;")], ["111", "222", "333"]);
});

await prueba("la decisión: apagado descarta, llegó gana, la propia línea se ignora, PRUEBA solo con su LID", () => {
  const base = { modo: "ACTIVO", lid: "1", lidsDePrueba: new Set(["9"]), llego: false, esLaPropiaLinea: false };
  assert.equal(reglas.decidirRevision({ ...base, modo: "APAGADO", llego: true }), "DESCARTAR");
  assert.equal(reglas.decidirRevision({ ...base, llego: true }), "LLEGO");
  assert.equal(reglas.decidirRevision({ ...base, esLaPropiaLinea: true }), "IGNORAR");
  assert.equal(reglas.decidirRevision(base), "ACTUAR");
  assert.equal(reglas.decidirRevision({ ...base, modo: "SOMBRA" }), "SOMBRA");
  assert.equal(reglas.decidirRevision({ ...base, modo: "PRUEBA" }), "SOMBRA");
  assert.equal(reglas.decidirRevision({ ...base, modo: "PRUEBA", lid: "9" }), "ACTUAR");
  assert.ok(reglas.mismoNumero("+57 300 111 2233", "3001112233"));
  assert.ok(!reglas.mismoNumero("3001112233", null));
  assert.equal(reglas.repartePorLinea("SALES"), true);
  assert.equal(reglas.repartePorLinea("ADMIN"), false);
});

await prueba("el lote: máximo 100, id solo letras y números, LID en dígitos, fechas de hace más de 24 h fuera", () => {
  const evento = { sesion: "ventas1", idCrudo: "3EB0AABBCCDD1122", lid: "111111111111111", ocurridoEn: "2026-11-09T12:00:00.000Z" };
  assert.ok(reglas.esquemaDelLote.safeParse({ eventos: [evento] }).success);
  assert.ok(reglas.esquemaDelLote.safeParse({ latido: true }).success);
  assert.ok(!reglas.esquemaDelLote.safeParse({ eventos: Array(101).fill(evento) }).success);
  assert.ok(!reglas.esquemaDelLote.safeParse({ eventos: [{ ...evento, idCrudo: "3EB0%_AABBCC" }] }).success);
  assert.ok(!reglas.esquemaDelLote.safeParse({ eventos: [{ ...evento, lid: "abc@lid" }] }).success);
  assert.ok(!reglas.esquemaDelLote.safeParse({ eventos: [{ ...evento, ocurridoEn: "ayer" }] }).success);
  const ahora = new Date("2026-11-09T12:00:00Z");
  assert.ok(reglas.fechaAceptable(new Date("2026-11-08T12:30:00Z"), ahora));
  assert.ok(!reglas.fechaAceptable(new Date("2026-11-08T11:59:00Z"), ahora));
  assert.ok(!reglas.fechaAceptable(new Date("2026-11-09T12:06:00Z"), ahora));
  assert.equal(reglas.revisarEnDe(ahora).getTime() - ahora.getTime(), 120_000);
});

await prueba("el WhatsApp agrupado: uno cada 15 min, cuenta, hasta 8 nombres y el link", () => {
  const ahora = new Date("2026-11-09T12:00:00Z");
  assert.ok(reglas.tocaAvisar(null, ahora));
  assert.ok(!reglas.tocaAvisar("2026-11-09T11:50:00Z", ahora));
  assert.ok(reglas.tocaAvisar("2026-11-09T11:45:00Z", ahora));
  const texto = reglas.textoDelAviso(Array.from({ length: 10 }, (_, i) => `Cliente ${i} (Ventas 1)`));
  assert.match(texto, /10 mensajes perdidos/);
  assert.match(texto, /y 2 más/);
  assert.match(texto, /cliente\/alertas/);
  assert.match(reglas.textoDelAviso(["Ana (Ventas 1)"]), /^⚠️ Mensaje perdido/);
});

/* ───────────────────────── 2. vigilante ───────────────────────── */

const archivoDelVigilante = path.join(RAIZ, "docker", "vigilante-indescifrables", "vigilante.mjs");
const vigilante = await import(pathToFileURL(archivoDelVigilante).href);

await prueba("el vigilante lee la línea del log (texto y JSON) y descarta grupos, estados y lo que no es LID", () => {
  const texto = vigilante.leerLinea("2026-11-09T12:00:01.123456789Z [ventas1] WARN Undecryptable message 3EB0AABBCCDD1122 from 111111111111111@lid");
  assert.deepEqual(texto, { ocurridoEn: "2026-11-09T12:00:01.123Z", sesion: "ventas1", idCrudo: "3EB0AABBCCDD1122", lid: "111111111111111", cursor: "2026-11-09T12:00:01.123456789Z" });
  const json = vigilante.leerLinea('2026-11-09T12:00:02.000Z {"level":"warn","session":"admin","msg":"Undecryptable message","id":"false_222222222222222@lid_AC1234567890ABCDEF","from":"222222222222222@lid"}');
  assert.equal(json.sesion, "admin");
  assert.equal(json.idCrudo, "AC1234567890ABCDEF");
  assert.equal(json.lid, "222222222222222");
  assert.equal(vigilante.leerLinea("2026-11-09T12:00:03Z [ventas1] Undecryptable message 3EB0AABBCCDD1122 from 111111111111111@lid in 120363424456736422@g.us"), null);
  assert.equal(vigilante.leerLinea("2026-11-09T12:00:03Z [ventas1] Undecryptable message 3EB0AABBCCDD1122 from 573001112233@s.whatsapp.net"), null);
  assert.equal(vigilante.leerLinea("2026-11-09T12:00:03Z [ventas1] message 3EB0AABBCCDD1122 from 111111111111111@lid"), null);
  assert.equal(vigilante.leerLinea("Undecryptable message 3EB0AABBCCDD1122 from 111111111111111@lid", { sesionPorDefecto: "ventas1" }).sesion, "ventas1");
});

await prueba("el cursor se guarda en disco y se vuelve a leer", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "vigilante-"));
  const archivo = path.join(carpeta, "sub", "cursor");
  assert.equal(vigilante.leerCursor(archivo), null);
  vigilante.guardarCursor(archivo, "2026-11-09T12:00:01.123456789Z");
  assert.equal(vigilante.leerCursor(archivo), "2026-11-09T12:00:01.123456789Z");
});

await prueba("node vigilante.mjs --desde-archivo --simular imprime un lote por cada indescifrable de cliente", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "vigilante-"));
  const muestra = path.join(carpeta, "muestra.log");
  fs.writeFileSync(
    muestra,
    [
      "2026-11-09T12:00:00.000Z [ventas1] INFO conectado",
      "2026-11-09T12:00:01.000Z [ventas1] WARN Undecryptable message 3EB0AABBCCDD1122 from 111111111111111@lid",
      "2026-11-09T12:00:02.000Z [ventas1] WARN Undecryptable message 3EB0AABBCCDD3344 from 111111111111111@lid in 1203634@g.us",
      "2026-11-09T12:00:03.000Z [ventas1] WARN Undecryptable message 3EB0AABBCCDD5566 from 333333333333333@lid",
    ].join("\n"),
  );
  const salida = spawnSync(process.execPath, [archivoDelVigilante, "--desde-archivo", muestra, "--simular"], { encoding: "utf8", env: { ...process.env, INDESCIFRABLES_SECRET: "" } });
  assert.equal(salida.status, 0, salida.stderr);
  const lotes = salida.stdout.trim().split("\n").map((linea) => JSON.parse(linea));
  assert.equal(lotes.length, 1);
  assert.deepEqual(lotes[0].eventos.map((evento) => evento.idCrudo), ["3EB0AABBCCDD1122", "3EB0AABBCCDD5566"]);
  assert.ok(lotes[0].eventos.every((evento) => !("cursor" in evento)));
  assert.match(salida.stderr, /2 indescifrables/);
});

/* ───────────────────────── 3. registro y revisión ───────────────────────── */

const linea = (id, workspaceId, purpose, extra = {}) =>
  tablas.whatsAppChannel.push({ id, workspaceId, name: id, purpose, phoneNumber: "573000000001", agentId: null, evolutionInstanceName: `ses-${id}`, metadata: {}, ...extra });
linea("ventas", "ws-activo", "SALES");
linea("admin", "ws-activo", "ADMIN");
linea("sombra", "ws-sombra", "SALES");
linea("prueba", "ws-prueba", "SALES");
linea("apagada", "ws-apagado", "SALES");
tablas.appSetting.push(
  { key: "mensajes-indescifrables:modo:ws-activo", value: "ACTIVO" },
  { key: "mensajes-indescifrables:modo:ws-sombra", value: "SOMBRA" },
  { key: "mensajes-indescifrables:modo:ws-prueba", value: "PRUEBA" },
  { key: "mensajes-indescifrables:lids-prueba:ws-prueba", value: "444444444444444" },
);

const T0 = new Date("2026-11-09T12:00:00.000Z");
const enMinutos = (minutos) => new Date(T0.getTime() + minutos * 60_000);
const evento = (sesion, idCrudo, lid, ocurridoEn = T0) => ({ sesion, idCrudo, lid, ocurridoEn: ocurridoEn.toISOString() });
const fila = (idCrudo) => tablas.mensajeIndescifrable.find((f) => f.idCrudo === idCrudo);

await prueba("registro: APAGADO no guarda, sesión desconocida no guarda, viejo fuera, repetido no se duplica", async () => {
  const lote = {
    latido: true,
    eventos: [
      evento("ses-ventas", "PERDIDOVENTAS0001", "111111111111111"),
      evento("ses-ventas", "PERDIDOVENTAS0001", "111111111111111"),
      evento("ses-apagada", "APAGADO000000001", "111111111111111"),
      evento("ses-otra", "SINLINEA00000001", "111111111111111"),
      evento("ses-ventas", "VIEJO00000000001", "111111111111111", new Date(T0.getTime() - 25 * 3_600_000)),
    ],
  };
  const resultado = await registro.registrarLote(lote, T0);
  assert.deepEqual(resultado, { recibidos: 5, guardados: 1, fueraDeTiempo: 1, sinLinea: 1, apagados: 1 });
  assert.equal(fila("PERDIDOVENTAS0001").revisarEn.getTime(), enMinutos(2).getTime());
  assert.equal(fila("APAGADO000000001"), undefined);
  assert.equal(tablas.appSetting.find((f) => f.key === "mensajes-indescifrables:latido").value, T0.toISOString());
  const otraVez = await registro.registrarLote({ eventos: [evento("ses-ventas", "PERDIDOVENTAS0001", "111111111111111")] }, T0);
  assert.equal(otraVez.guardados, 0);
  assert.equal(tablas.mensajeIndescifrable.filter((f) => f.idCrudo === "PERDIDOVENTAS0001").length, 1);
});

await prueba("webhook: un evento sin Message marca LLEGO, también si le gana al vigilante", async () => {
  await registro.registrarLote({ eventos: [evento("ses-ventas", "REACCION00000001", "111111111111111")] }, T0);
  await registro.marcarLlegoPorWebhook({ sesion: "ses-ventas", idCrudo: "REACCION00000001" }, enMinutos(0.1));
  assert.equal(fila("REACCION00000001").estado, "LLEGO");
  await registro.marcarLlegoPorWebhook({ sesion: "ses-ventas", idCrudo: "ANTESDELVIGIL001" }, T0);
  await registro.registrarLote({ eventos: [evento("ses-ventas", "ANTESDELVIGIL001", "111111111111111")] }, T0);
  assert.equal(fila("ANTESDELVIGIL001").estado, "LLEGO");
  await registro.marcarLlegoPorWebhook({ sesion: "ses-apagada", idCrudo: "NADA000000000001" }, T0);
  assert.equal(fila("NADA000000000001"), undefined, "APAGADO no escribe nada");
});

// Más casos en cola, todos ocurridos en T0.
tablas.message.push({ id: "m-real", workspaceId: "ws-activo", conversationId: "c-x", externalId: "false_111111111111111@lid_LLEGOPORMSG00001", createdAt: enMinutos(0.05), direction: "INBOUND", type: "TEXT" });
await registro.registrarLote(
  {
    eventos: [
      evento("ses-ventas", "LLEGOPORMSG00001", "111111111111111"),
      evento("ses-ventas", "PROPIALINEA00001", "999999999999999"),
      evento("ses-admin", "PERDIDOADMIN0001", "555555555555555"),
      evento("ses-sombra", "PERDIDOSOMBRA001", "111111111111111"),
      evento("ses-prueba", "PRUEBAFUERA00001", "111111111111111"),
      evento("ses-prueba", "PRUEBADENTRO0001", "444444444444444"),
    ],
  },
  T0,
);

await prueba("revisión: nada antes de los 2 minutos", async () => {
  const resultado = await revision.revisarMensajesIndescifrables(enMinutos(1));
  assert.equal(resultado.revisados, 0);
  assert.equal(espias.whatsapps.length, 0);
});

const mensajesAntes = tablas.message.length;
const contactosAntes = tablas.contact.length;
await prueba("revisión a los 2 min: cada caso termina en su estado", async () => {
  const resultado = await revision.revisarMensajesIndescifrables(enMinutos(2));
  assert.equal(resultado.revisados, 7);
  assert.equal(fila("LLEGOPORMSG00001").estado, "LLEGO");
  assert.equal(fila("PROPIALINEA00001").estado, "IGNORADO");
  assert.equal(fila("PERDIDOSOMBRA001").estado, "SOMBRA");
  assert.equal(fila("PRUEBAFUERA00001").estado, "SOMBRA");
  assert.equal(fila("PRUEBADENTRO0001").estado, "PERDIDO");
  assert.equal(fila("PERDIDOVENTAS0001").estado, "PERDIDO");
  assert.equal(fila("PERDIDOADMIN0001").estado, "PERDIDO");
});

await prueba("perdido en ventas: ficha con teléfono y LID anotado, nota OUTBOUND/SYSTEM, reparto, push y alerta ALTA", async () => {
  const perdido = fila("PERDIDOVENTAS0001");
  assert.equal(perdido.telefono, "573001112233");
  const contacto = tablas.contact.find((c) => c.phoneNumber === "573001112233");
  assert.equal(contacto.metadata.whatsappLidId, "111111111111111");
  const nota = tablas.message.find((m) => m.rawPayload?.origen === "mensaje-perdido:PERDIDOVENTAS0001");
  assert.equal(nota.direction, "OUTBOUND");
  assert.equal(nota.type, "SYSTEM");
  assert.equal(nota.rawPayload.kind, "note");
  assert.equal(nota.conversationId, perdido.conversationId);
  assert.ok(tablas.message.every((m) => m.id === "m-real" || m.direction !== "INBOUND"), "nunca un INBOUND falso");
  assert.ok(espias.repartos.some((r) => r.conversationId === perdido.conversationId && r.avisarPorPush === false));
  assert.ok(espias.pushes.some((p) => p.userId === "asesora1" && /escríbele/.test(p.payload.title)));
  const alerta = espias.alertas.find((a) => a.clave === `mensaje-perdido:${perdido.conversationId}`);
  assert.equal(alerta.prioridad, "ALTA");
  assert.equal(alerta.origen, "Mensajes perdidos");
  assert.equal(alerta.enviar, undefined, "la alerta no manda WhatsApp por su cuenta");
  assert.equal(tablas.conversation.find((c) => c.id === perdido.conversationId).lastMessageAt.getTime(), enMinutos(2).getTime());
});

await prueba("perdido en la línea ADMIN: chat con el LID (whatsappLid) y alerta, sin reparto", async () => {
  const perdido = fila("PERDIDOADMIN0001");
  assert.equal(perdido.telefono, null);
  const contacto = tablas.contact.find((c) => c.phoneNumber === "555555555555555");
  assert.equal(contacto.metadata.whatsappLid, true);
  assert.equal(contacto.excludedFromCrm, true);
  assert.ok(!espias.repartos.some((r) => r.conversationId === perdido.conversationId));
  assert.ok(espias.alertas.some((a) => a.clave === `mensaje-perdido:${perdido.conversationId}`));
  assert.ok(tablas.message.some((m) => m.conversationId === perdido.conversationId && m.rawPayload?.kind === "note"));
});

await prueba("SOMBRA y PRUEBA fuera de la lista no tocan chats, fichas ni alertas", async () => {
  const notas = tablas.message.slice(mensajesAntes).map((m) => m.rawPayload?.origen);
  assert.deepEqual(notas.sort(), ["mensaje-perdido:PERDIDOADMIN0001", "mensaje-perdido:PERDIDOVENTAS0001", "mensaje-perdido:PRUEBADENTRO0001"].sort());
  assert.equal(tablas.contact.length - contactosAntes, 3);
  assert.equal(espias.alertas.length, 3);
});

await prueba("WhatsApp agrupado: uno por negocio, con todos sus perdidos; no se repite antes de 15 min", async () => {
  assert.equal(espias.whatsapps.length, 2);
  const delActivo = espias.whatsapps.find((w) => w.workspaceId === "ws-activo");
  assert.match(delActivo.texto, /2 mensajes perdidos/);
  assert.ok(fila("PERDIDOVENTAS0001").avisadoEn);
  tablas.mensajeIndescifrable.push({ id: "mi-x", workspaceId: "ws-activo", channelId: "ventas", idCrudo: "TARDE00000000001", lid: "1", estado: "PERDIDO", avisadoEn: null, resumen: "Tarde (ventas)", intentos: 1, reclamadoEn: null });
  await revision.revisarMensajesIndescifrables(enMinutos(10));
  assert.equal(espias.whatsapps.length, 2, "antes de 15 min no sale otro");
  await revision.revisarMensajesIndescifrables(enMinutos(18));
  assert.equal(espias.whatsapps.length, 3);
  assert.match(espias.whatsapps[2].texto, /Tarde/);
});

await prueba("si el WhatsApp no sale, los perdidos esperan la próxima ventana (no se reintenta cada minuto)", async () => {
  espias.whatsappSale = false;
  tablas.mensajeIndescifrable.push({ id: "mi-y", workspaceId: "ws-activo", channelId: "ventas", idCrudo: "FALLA00000000001", lid: "1", estado: "PERDIDO", avisadoEn: null, resumen: "Falla (ventas)", intentos: 1, reclamadoEn: null });
  await revision.revisarMensajesIndescifrables(enMinutos(40));
  await revision.revisarMensajesIndescifrables(enMinutos(41));
  assert.equal(espias.whatsapps.length, 4);
  assert.equal(fila("FALLA00000000001").avisadoEn, null);
  espias.whatsappSale = true;
  await revision.revisarMensajesIndescifrables(enMinutos(56));
  assert.ok(fila("FALLA00000000001").avisadoEn);
});

await prueba("una fila trabada en REVISANDO se retoma a los 10 min y la nota no se duplica", async () => {
  const perdido = fila("PRUEBADENTRO0001");
  Object.assign(perdido, { estado: "REVISANDO", reclamadoEn: enMinutos(60) });
  await revision.revisarMensajesIndescifrables(enMinutos(65));
  assert.equal(perdido.estado, "REVISANDO", "antes de 10 min no se toca");
  await revision.revisarMensajesIndescifrables(enMinutos(71));
  assert.equal(perdido.estado, "PERDIDO");
  assert.equal(tablas.message.filter((m) => m.rawPayload?.origen === "mensaje-perdido:PRUEBADENTRO0001").length, 1);
});

/* ───────────────────────── 4. migración ───────────────────────── */

const NUEVA = "20261114120000_mensaje_indescifrable";
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const sqlNueva = fs.readFileSync(path.join(CARPETA, NUEVA, "migration.sql"), "utf8");

await prueba("la migración es aditiva: solo CREATE TABLE / CREATE INDEX, sin tocar tablas existentes", () => {
  const sentencias = sqlNueva
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  for (const sentencia of sentencias) {
    assert.match(sentencia, /^(BEGIN|COMMIT|CREATE TABLE IF NOT EXISTS "MensajeIndescifrable"|CREATE (UNIQUE )?INDEX IF NOT EXISTS "MensajeIndescifrable_\w+" ON "MensajeIndescifrable")/, sentencia);
  }
  assert.doesNotMatch(sqlNueva, /\b(ALTER|DROP|DELETE|TRUNCATE|UPDATE|REFERENCES)\b/i);
  // Va después de la última migración que había cuando se escribió (carta_de_colores). No se exige que sea la
  // última de todas: eso fallaba en cuanto otra tarea agregaba una migración más nueva.
  const anteriores = fs.readdirSync(CARPETA).filter((n) => /^\d{14}_/.test(n) && n <= "20261113120000_carta_de_colores");
  assert.ok(anteriores.length > 0 && NUEVA > "20261113120000_carta_de_colores", "va después de todas las migraciones que había");
});

await prueba("schema.prisma tiene el modelo con las mismas columnas que la migración", () => {
  const schema = leer("prisma/schema.prisma");
  const bloque = /model MensajeIndescifrable \{([\s\S]*?)\n\}/.exec(schema)?.[1];
  assert.ok(bloque, "falta el modelo");
  const delModelo = [...bloque.matchAll(/^\s{2}(\w+)\s+\w/gm)].map((m) => m[1]).sort();
  const deLaTabla = [...sqlNueva.matchAll(/^\s+"(\w+)" (TEXT|TIMESTAMP|INTEGER)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(delModelo, deLaTabla);
  assert.match(bloque, /@@unique\(\[channelId, idCrudo\]\)/);
  assert.doesNotMatch(bloque, /@relation/);
});

await prueba("PGlite: todas las migraciones + la nueva (dos veces) y el único por (línea, id)", async () => {
  const db = new PGlite();
  for (const nombre of fs.readdirSync(CARPETA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    await db.exec(fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8"));
  }
  await db.exec(sqlNueva);
  const insertar = `INSERT INTO "MensajeIndescifrable" ("id","workspaceId","channelId","idCrudo","lid","ocurridoEn","revisarEn") VALUES ($1,'ws','c1','3EB0AABBCC','111',now(),now()) ON CONFLICT ("channelId","idCrudo") DO NOTHING`;
  await db.query(insertar, ["a"]);
  await db.query(insertar, ["b"]);
  const filas = (await db.query(`SELECT "id","estado","intentos" FROM "MensajeIndescifrable"`)).rows;
  assert.deepEqual(filas, [{ id: "a", estado: "PENDIENTE", intentos: 0 }]);
  await db.close();
});

/* ───────────────────────── 5. cableado ───────────────────────── */

await prueba("cableado: el webhook de Evolution usa la del lib, el de WAHA marca 3 puntos y el reloj llama una vez", () => {
  const evolution = leer("src/app/api/webhooks/evolution/route.ts");
  assert.match(evolution, /import \{ resolveConversationWithLock \} from "@\/lib\/conversacion-por-contacto";/);
  assert.doesNotMatch(evolution, /function (resolveConversationWithLock|idDeConversacion)\(/);
  const waha = leer("src/app/api/webhooks/waha/route.ts");
  assert.equal(waha.match(/anotarQueLlego\(cuerpo\);/g)?.length, 3);
  const reloj = leer("src/app/api/cron/follows/route.ts");
  assert.equal(reloj.match(/await revisarMensajesIndescifrables\(\)/g)?.length, 1);
  const servicio = leer("src/features/mensajes-indescifrables/servicios/revision.ts");
  assert.doesNotMatch(servicio, /direction:\s*"INBOUND"/);
  const endpoint = leer("src/app/api/interno/mensajes-indescifrables/route.ts");
  assert.match(endpoint, /INDESCIFRABLES_SECRET/);
  assert.match(endpoint, /if \(!esperado\) return false;/);
  assert.match(endpoint, /timingSafeEqual/);
});

console.log(`\n${pruebas} pruebas de mensajes indescifrables: todas pasaron.`);
