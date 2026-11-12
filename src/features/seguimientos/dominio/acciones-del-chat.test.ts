// Seguimiento del chat con adjuntos (11-nov-2026). Correr: npm run test:seguimiento-con-adjuntos
import assert from "node:assert/strict";
import { test } from "node:test";

import { armarAccionesDelChat, esArchivoPropio } from "./acciones-del-chat";
import { diaMasHoraDeBogota, horaDeBogotaAUtc } from "./fecha-exacta";

const FOTO = { tipo: "IMAGE" as const, url: "https://crm.magilus.com/uploads/chat-media/a.jpg" };
const PDF = { tipo: "DOC" as const, url: "https://crm.magilus.com/uploads/chat-media/b.pdf" };
const AUDIO = { tipo: "AUDIO" as const, url: "https://crm.magilus.com/uploads/chat-audio/c.ogg" };

test("solo texto: un mensaje de texto, como antes", () => {
  assert.deepEqual(armarAccionesDelChat("  Hola  ", []), [{ order: 1, messageType: "TEXT", content: "Hola", mediaUrl: "" }]);
});

test("foto + texto + audio: el texto va debajo de la foto y el audio sale despues", () => {
  assert.deepEqual(armarAccionesDelChat("Mira", [AUDIO, FOTO, PDF]), [
    { order: 1, messageType: "IMAGE", content: "Mira", mediaUrl: FOTO.url },
    { order: 2, messageType: "DOC", content: "", mediaUrl: PDF.url },
    { order: 3, messageType: "AUDIO", content: "", mediaUrl: AUDIO.url },
  ]);
});

test("texto + audio sin foto: primero el texto y despues la nota de voz", () => {
  assert.deepEqual(
    armarAccionesDelChat("Hola", [AUDIO]).map((a) => a.messageType),
    ["TEXT", "AUDIO"],
  );
  assert.deepEqual(
    armarAccionesDelChat("", [AUDIO]).map((a) => a.messageType),
    ["AUDIO"],
  );
});

test("solo acepta archivos subidos a nuestro servidor", () => {
  const propios = new Set(["crm.magilus.com"]);
  assert.equal(esArchivoPropio(FOTO.url, propios), true);
  assert.equal(esArchivoPropio("https://otro.com/uploads/a.jpg", propios), false);
  assert.equal(esArchivoPropio("https://crm.magilus.com/api/a.jpg", propios), false);
  assert.equal(esArchivoPropio("javascript:alert(1)", propios), false);
  assert.equal(esArchivoPropio("no es una url", propios), false);
});

test("Mañana a las 9:00 es el dia siguiente en Colombia, aunque en UTC ya sea otro dia", () => {
  // 11-nov 21:30 en Colombia = 12-nov 02:30 UTC
  const ahora = new Date("2026-11-12T02:30:00Z");
  assert.equal(diaMasHoraDeBogota(ahora, 1, "09:00"), "2026-11-12T09:00");
  assert.equal(horaDeBogotaAUtc("2026-11-12T09:00")?.toISOString(), "2026-11-12T14:00:00.000Z");
  assert.equal(diaMasHoraDeBogota(ahora, 7, "15:30"), "2026-11-18T15:30");
  assert.equal(diaMasHoraDeBogota(ahora, 1, "9"), null);
});

test("ver seguimientos: los pendientes primero (el mas proximo arriba) y se distingue lo de una persona", async () => {
  const { aSeguimientoDelCliente, ordenarSeguimientos } = await import("./seguimientos-del-cliente");
  const base = { executionError: null, messageType: "TEXT", content: null, mediaUrl: null, followRuleId: null };
  const lista = [
    aSeguimientoDelCliente({ ...base, id: "a", name: "Seguimiento desde el chat", executeAt: "2026-11-10T15:00:00Z", status: "EXECUTED", actions: [] }),
    aSeguimientoDelCliente({
      ...base,
      id: "b",
      name: "Seguimiento desde el chat",
      executeAt: "2026-11-14T15:00:00Z",
      status: "PENDING",
      actions: [
        { messageType: "IMAGE", content: "Mira", mediaUrl: "https://x/uploads/a.jpg" },
        { messageType: "AUDIO", content: null, mediaUrl: "https://x/uploads/b.ogg" },
      ],
    }),
    aSeguimientoDelCliente({ ...base, id: "c", name: "Etapa Bienvenida · 1", followRuleId: "r1", executeAt: "2026-11-12T15:00:00Z", status: "PENDING", actions: [] }),
    aSeguimientoDelCliente({ ...base, id: "d", name: null, executeAt: "2026-11-11T15:00:00Z", status: "CANCELLED", executionError: "Cancelado por actividad", actions: [] }),
  ];
  const orden = ordenarSeguimientos(lista);
  assert.deepEqual(orden.map((s) => s.id), ["c", "b", "d", "a"]);
  assert.equal(orden[0].deUnaPersona, false);
  assert.equal(orden[0].origen, "Etapa Bienvenida · 1");
  assert.equal(orden[1].origen, "Desde el chat");
  assert.deepEqual(orden[1].piezas.map((p) => p.tipo), ["IMAGE", "AUDIO"]);
  assert.equal(orden[2].motivo, "Cancelado por actividad");
});

test("una hora a 30 segundos vale; una que ya paso no (el servidor da 2 min de holgura)", async () => {
  const { validarFechaExacta } = await import("./fecha-exacta");
  const ahora = new Date("2026-11-12T02:35:30Z");
  assert.deepEqual(validarFechaExacta(new Date("2026-11-12T02:36:00Z"), ahora), { ok: true });
  assert.deepEqual(validarFechaExacta(new Date("2026-11-12T02:35:00Z"), ahora), { ok: false, motivo: "pasada" });
  assert.deepEqual(validarFechaExacta(new Date("2026-11-12T02:35:00Z"), ahora, 2 * 60_000), { ok: true });
});
