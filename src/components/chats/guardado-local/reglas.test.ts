import { test } from "node:test";
import assert from "node:assert/strict";

import type { SharedInboxConversationItem } from "../chat-inbox-types";
import {
  aplicarCambiosEnOrden,
  esGuardadoVigente,
  filaParaGuardar,
  llaveDelDueno,
  MAX_FILAS_GUARDADAS,
  MAX_LARGO_DEL_ULTIMO_MENSAJE,
  reconciliarPrimeraPagina,
  recortarLista,
  VERSION_DEL_GUARDADO,
} from "./reglas";

// Correr: npx tsx --test src/components/chats/guardado-local/reglas.test.ts

const HORA = 3_600_000;
const AHORA = Date.UTC(2026, 10, 10, 12, 0, 0);

test("llaves: negocio + usuario + version; sin alguno no hay dueño", () => {
  assert.equal(llaveDelDueno("n1", "u1"), `n1:u1:${VERSION_DEL_GUARDADO}`);
  assert.equal(llaveDelDueno("n1", "u1", "v9"), "n1:u1:v9");
  assert.equal(llaveDelDueno(" n1 ", " u1 "), `n1:u1:${VERSION_DEL_GUARDADO}`);
  assert.equal(llaveDelDueno(null, "u1"), null);
  assert.equal(llaveDelDueno("n1", null), null);
  assert.equal(llaveDelDueno("n1", ""), null);
  assert.equal(llaveDelDueno("n1", "u1", ""), null);
  assert.notEqual(llaveDelDueno("n1", "u1"), llaveDelDueno("n1", "u2"), "otro usuario, otra llave");
  assert.notEqual(llaveDelDueno("n1", "u1"), llaveDelDueno("n2", "u1"), "otro negocio, otra llave");
});

test("caducidad: vale hasta 24 h; despues, sin fecha o de otra version, no", () => {
  const de = (horas: number, version = VERSION_DEL_GUARDADO) => ({ guardadoEn: AHORA - horas * HORA, version });
  assert.equal(esGuardadoVigente(de(0), AHORA), true);
  assert.equal(esGuardadoVigente(de(23.9), AHORA), true);
  assert.equal(esGuardadoVigente(de(24), AHORA), true);
  assert.equal(esGuardadoVigente(de(24.01), AHORA), false);
  assert.equal(esGuardadoVigente(de(2), AHORA, { maxHoras: 1 }), false);
  assert.equal(esGuardadoVigente(de(1, "v2"), AHORA), false, "version distinta se descarta");
  assert.equal(esGuardadoVigente(de(1, "v4"), AHORA, { version: "v4" }), true);
  assert.equal(esGuardadoVigente({ version: VERSION_DEL_GUARDADO }, AHORA), false, "sin fecha");
  assert.equal(esGuardadoVigente({ guardadoEn: "ayer", version: VERSION_DEL_GUARDADO }, AHORA), false);
  assert.equal(esGuardadoVigente(null, AHORA), false);
  assert.equal(esGuardadoVigente(de(-48), AHORA), false, "una fecha en el futuro lejano no la vuelve eterna");
});

function item(extra: Partial<SharedInboxConversationItem> & { id: string }): SharedInboxConversationItem {
  return {
    source: "agent",
    label: "Cliente",
    secondaryLabel: "573000000000",
    lastMessage: "hola",
    href: `/cliente/chats?chatKey=${extra.id}`,
    ...extra,
  } as SharedInboxConversationItem;
}

const CAMPOS_PERMITIDOS = [
  "id",
  "source",
  "label",
  "secondaryLabel",
  "avatarUrl",
  "tags",
  "incomingCount",
  "assignedToName",
  "crmStage",
  "status",
  "lastMessage",
  "lastMessageType",
  "lastMessageDirection",
  "lastMessageStatus",
  "lastMessageAt",
  "href",
].sort();

test("filaParaGuardar: solo los campos que pinta la fila; nada de ids internos ni payloads", () => {
  const completa = {
    ...item({ id: "agent:c1" }),
    contactId: "contacto-secreto",
    segundoAsesorId: "u9",
    segundoAsesorNombre: "Otra",
    esperaDesde: new Date(AHORA).toISOString(),
    sinResponderDesde: new Date(AHORA),
    assignedToUserId: "u1",
    agentId: "a1",
    channelId: "canal",
    automationPaused: true,
    rawPayload: { base64: "xxxx", telefono: "57301" },
    mediaUrl: "https://medios/foto.jpg",
    tags: [{ label: "VIP", color: "#f00", id: "tag-interno" }],
    lastMessage: "x".repeat(500),
    lastMessageAt: new Date(AHORA),
    incomingCount: 3,
  } as unknown as SharedInboxConversationItem;
  const fila = filaParaGuardar(completa)!;
  assert.deepEqual(Object.keys(fila).sort(), CAMPOS_PERMITIDOS);
  const texto = JSON.stringify(fila);
  for (const prohibido of ["contacto-secreto", "u9", "Otra", "base64", "57301", "medios", "tag-interno", "canal"]) {
    assert.ok(!texto.includes(prohibido), `no se guarda ${prohibido}`);
  }
  assert.equal(fila.lastMessage?.length, MAX_LARGO_DEL_ULTIMO_MENSAJE, "el ultimo mensaje va cortado");
  assert.equal(fila.lastMessageAt, new Date(AHORA).toISOString());
  assert.deepEqual(fila.tags, [{ label: "VIP", color: "#f00" }]);
  assert.equal(fila.incomingCount, 3);
  assert.equal(filaParaGuardar({} as SharedInboxConversationItem), null, "sin id no se guarda");
});

test("recortarLista: como mucho 40, en el orden en que llegan", () => {
  const filas = Array.from({ length: 100 }, (_, i) => i);
  assert.equal(MAX_FILAS_GUARDADAS, 40);
  assert.deepEqual(recortarLista(filas), filas.slice(0, 40));
  assert.deepEqual(recortarLista(filas, 3), [0, 1, 2]);
  assert.deepEqual(recortarLista([1, 2], 40), [1, 2]);
  assert.deepEqual(recortarLista(filas, 0), []);
});

const fila = (id: string, minutos: number | null) => ({
  id,
  lastMessageAt: minutos === null ? null : new Date(AHORA - minutos * 60_000),
});

test("reconciliar: quita lo reasignado (mas nuevo que la pagina) y conserva lo cargado al bajar", () => {
  // Lista en pantalla: a (1 min), reasignado (3 min), b (5 min), cargadoAlBajar (300 min).
  const actual = [fila("a", 1), fila("reasignado", 3), fila("b", 5), fila("cargadoAlBajar", 300)];
  // La primera pagina trae a y b (la mas vieja: 5 min) y hay mas.
  const pagina = [fila("a", 1), fila("b", 5)];
  const quedan = reconciliarPrimeraPagina(actual, pagina, true).map((f) => f.id);
  assert.deepEqual(quedan, ["a", "b", "cargadoAlBajar"]);
});

test("reconciliar: sin mas paginas sale todo lo que no vino; lo conservado y lo sin fecha se queda", () => {
  const actual = [fila("a", 1), fila("viejo", 900), fila("abierto", 2), fila("oficial", 3), fila("sinFecha", null)];
  const pagina = [fila("a", 1)];
  assert.deepEqual(
    reconciliarPrimeraPagina(actual, pagina, false, (f) => f.id === "abierto" || f.id === "oficial").map((f) => f.id),
    ["a", "abierto", "oficial"],
  );
  // Con mas paginas, la fila sin fecha se conserva (no se puede comparar).
  assert.deepEqual(
    reconciliarPrimeraPagina([fila("a", 1), fila("sinFecha", null)], [fila("a", 1), fila("b", 10)], true).map((f) => f.id),
    ["a", "sinFecha"],
  );
});

test("reconciliar: si no hay nada que quitar devuelve la misma lista; una pagina vacia con mas no quita nada", () => {
  const actual = [fila("a", 1), fila("b", 5)];
  assert.equal(reconciliarPrimeraPagina(actual, [fila("a", 1), fila("b", 5)], true), actual);
  assert.equal(reconciliarPrimeraPagina(actual, [], true), actual);
  assert.deepEqual(reconciliarPrimeraPagina(actual, [], false), [], "la vista quedo vacia");
  // La fila con la MISMA hora que la mas vieja de la pagina se conserva (empate: puede seguir en la vista).
  assert.deepEqual(
    reconciliarPrimeraPagina([fila("a", 1), fila("empate", 5)], [fila("a", 1), fila("b", 5)], true).map((f) => f.id),
    ["a", "empate"],
  );
});

test("aplicarCambiosEnOrden: ordena por (at, id), ignora lo repetido y nunca retrocede", () => {
  const vacio = { filas: new Map<string, ReturnType<typeof fila>>(), vistos: new Map<string, number>() };
  // Llegan en desorden: el de las 10 primero, despues el de las 5.
  const r1 = aplicarCambiosEnOrden(vacio, [
    { conversationId: "c1", at: 10, fila: fila("c1", 1) },
    { conversationId: "c1", at: 5, fila: fila("c1", 30) },
  ]);
  assert.equal(r1.filas.get("c1")?.lastMessageAt?.getTime(), AHORA - 60_000, "gana el mas nuevo");
  assert.equal(r1.vistos.get("c1"), 10);

  // Un cambio viejo que llega despues no pisa.
  const r2 = aplicarCambiosEnOrden(r1, [{ conversationId: "c1", at: 7, fila: fila("c1", 60) }]);
  assert.equal(r2.filas.get("c1")?.lastMessageAt?.getTime(), AHORA - 60_000);

  // Un cambio nuevo con una fila de lastMessageAt mas viejo tampoco retrocede.
  const r3 = aplicarCambiosEnOrden(r2, [{ conversationId: "c1", at: 20, fila: fila("c1", 120) }]);
  assert.equal(r3.filas.get("c1")?.lastMessageAt?.getTime(), AHORA - 60_000);

  // Repetidos: mismo conversationId + at se aplica una vez.
  const r4 = aplicarCambiosEnOrden(vacio, [
    { conversationId: "c2", at: 3, fila: fila("c2", 10) },
    { conversationId: "c2", at: 3, fila: fila("c2", 1) },
  ]);
  assert.equal(r4.filas.get("c2")?.lastMessageAt?.getTime(), AHORA - 10 * 60_000);

  // fila null = salio de la vista.
  const r5 = aplicarCambiosEnOrden(r4, [{ conversationId: "c2", at: 9, fila: null }]);
  assert.equal(r5.filas.has("c2"), false);
  // No cambia el estado de entrada.
  assert.equal(r4.filas.has("c2"), true);

  // Mismo at, distinto chat: se aplican los dos, en orden de id.
  const r6 = aplicarCambiosEnOrden(vacio, [
    { conversationId: "zz", at: 1, fila: fila("zz", 1) },
    { conversationId: "aa", at: 1, fila: fila("aa", 1) },
  ]);
  assert.deepEqual([...r6.filas.keys()], ["aa", "zz"]);
});

test("lista guardada: lo que se guarda no tiene campos fuera de la lista", async () => {
  // Sin window: armarListaParaGuardar es pura.
  const { armarListaParaGuardar } = await import("./lista-guardada");
  const filas = Array.from({ length: 60 }, (_, i) =>
    ({ ...item({ id: `agent:${i}` }), contactId: "secreto", rawPayload: { x: 1 } }) as unknown as SharedInboxConversationItem,
  );
  const lista = armarListaParaGuardar("vista", filas, AHORA);
  assert.equal(lista.filas.length, MAX_FILAS_GUARDADAS);
  assert.equal(lista.version, VERSION_DEL_GUARDADO);
  assert.equal(lista.guardadoEn, AHORA);
  for (const guardada of lista.filas) {
    assert.deepEqual(Object.keys(guardada).sort(), CAMPOS_PERMITIDOS);
  }
  assert.ok(!JSON.stringify(lista).includes("secreto"));
});

test("filaParaGuardar: el chat abierto fuera del filtro guarda su marca; las demas filas no la llevan", () => {
  const escondida = filaParaGuardar(item({ id: "agent:abierto", fueraDeLaVista: true }))!;
  assert.equal(escondida.fueraDeLaVista, true, "al volver a la vista sigue escondida");
  const normal = filaParaGuardar(item({ id: "agent:a", fueraDeLaVista: false }))!;
  assert.equal("fueraDeLaVista" in normal, false);
  assert.deepEqual(Object.keys(normal).sort(), CAMPOS_PERMITIDOS);
});
