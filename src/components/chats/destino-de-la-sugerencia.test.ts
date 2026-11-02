import { test } from "node:test";
import assert from "node:assert/strict";

import { dondeVaLaSugerencia } from "./destino-de-la-sugerencia";

test("mismo chat abierto: la sugerencia va a la caja", () => {
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:A", chatAbierto: "agent:A", borradorDelChatPedido: "" }),
    "caja",
  );
  // Aunque el chat tenga texto: es la misma caja de hoy, la asesora pidio la sugerencia ahi.
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:A", chatAbierto: "agent:A", borradorDelChatPedido: "hola" }),
    "caja",
  );
});

test("otro chat abierto y el chat pedido vacio: queda como su borrador", () => {
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:A", chatAbierto: "agent:B", borradorDelChatPedido: "" }),
    "borrador",
  );
  // Solo espacios cuenta como vacio.
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:A", chatAbierto: "official:B", borradorDelChatPedido: "  \n " }),
    "borrador",
  );
});

test("otro chat abierto y el chat pedido con texto: se descarta, no se pisa nada", () => {
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:A", chatAbierto: "agent:B", borradorDelChatPedido: "hola A" }),
    "descartar",
  );
});

test("sin chat abierto (se cerro el chat): no se escribe en ninguna caja", () => {
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:A", chatAbierto: "", borradorDelChatPedido: "" }),
    "borrador",
  );
});
