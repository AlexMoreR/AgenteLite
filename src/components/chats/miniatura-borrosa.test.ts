// La llave de la miniatura borrosa (11-nov-2026). Correr: npx tsx --test src/components/chats/miniatura-borrosa.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { llaveDeLaFoto } from "./miniatura-borrosa";

test("la misma foto de WhatsApp con otra firma tiene la misma llave, tambien dentro del proxy", () => {
  const cdn = (firma: string) => `https://mmg.whatsapp.net/o1/v/t24/f2/m238/AQM57?ccb=11-4&oh=${firma}&oe=6A1B2C3D&_nc_sid=5e03e0&mms3=true`;
  assert.equal(llaveDeLaFoto(cdn("uno")), llaveDeLaFoto(cdn("dos")));
  const proxy = (firma: string) => `/api/media/proxy?url=${encodeURIComponent(cdn(firma))}`;
  assert.equal(llaveDeLaFoto(proxy("uno")), llaveDeLaFoto(proxy("dos")));
  assert.equal(llaveDeLaFoto(proxy("uno")), llaveDeLaFoto(cdn("tres")));
});

test("dos fotos distintas no comparten llave", () => {
  assert.notEqual(
    llaveDeLaFoto("/uploads/chatbot-flows/1784125251398-WhatsApp.jpeg"),
    llaveDeLaFoto("/uploads/chatbot-flows/1793288585541-WhatsApp.jpeg"),
  );
});
