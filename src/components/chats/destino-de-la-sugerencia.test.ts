import { test } from "node:test";
import assert from "node:assert/strict";

import { dondeVaLaSugerencia } from "./destino-de-la-sugerencia";

test("mismo chat abierto: la sugerencia va a la caja, como siempre", () => {
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:a", chatAbierto: "agent:a", borradorDelChatPedido: "" }),
    "caja",
  );
  // Aunque el chat tenga algo guardado, si sigue abierto se comporta igual que antes.
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:a", chatAbierto: "agent:a", borradorDelChatPedido: "hola" }),
    "caja",
  );
});

test("otro chat abierto y el chat pedido vacío: queda como borrador de su chat", () => {
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:a", chatAbierto: "agent:b", borradorDelChatPedido: "" }),
    "borrador",
  );
  // Solo espacios cuenta como vacío.
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:a", chatAbierto: "agent:b", borradorDelChatPedido: "  \n " }),
    "borrador",
  );
});

test("otro chat abierto y el chat pedido con texto: no se pisa, se descarta", () => {
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:a", chatAbierto: "agent:b", borradorDelChatPedido: "hola A" }),
    "descartar",
  );
});

test("sin chat abierto (se cerró el chat): no se escribe en ninguna caja", () => {
  assert.equal(
    dondeVaLaSugerencia({ chatPedido: "agent:a", chatAbierto: "", borradorDelChatPedido: "" }),
    "borrador",
  );
});
