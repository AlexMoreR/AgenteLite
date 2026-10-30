// Pruebas de la regla "de dónde llegó el cliente" (src/lib/origen-del-cliente.ts), sin base de datos.
// Correr: npm run test:origen-del-cliente
//
// 1. Datos de anuncio → "anuncio" con título, id y red. 2. Marketplace por origen.canal o por línea "Ventas 2".
// 3. El anuncio manda sobre la línea. 4. Sin datos o datos rotos → orgánico, sin error.
// 5. herramientas.ts: el filtro `origen` está en el esquema con sus tres opciones y la respuesta trae `origen`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const { origenDelCliente, esTipoDeOrigen, TIPOS_DE_ORIGEN } = cargar("src/lib/origen-del-cliente.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const ventas2 = { channelId: "c2", nombre: "Ventas 2" };
const ventas1 = { channelId: "c1", nombre: "Ventas 1" };

prueba("datos de anuncio → anuncio con título, id y red", () => {
  const o = origenDelCliente({
    metadataContacto: {
      source: "meta ads",
      adTitle: "Camillas contra entrega Cali",
      adSourceId: "120210",
      adSourceApp: "instagram",
      adSourceUrl: "https://fb.me/abc",
      adCapturedAt: "2026-10-01T10:00:00Z",
    },
    linea: ventas1,
  });
  assert.equal(o.tipo, "anuncio");
  assert.equal(o.tituloDelAnuncio, "Camillas contra entrega Cali");
  assert.equal(o.idDelAnuncio, "120210");
  assert.equal(o.red, "Instagram");
  assert.equal(o.enlace, "https://fb.me/abc");
  assert.equal(o.etiqueta, "Anuncio de Meta · Instagram · «Camillas contra entrega Cali»");
});

prueba("un link que no es http(s) no se ofrece", () => {
  const o = origenDelCliente({ metadataContacto: { source: "meta ads", adSourceUrl: "javascript:alert(1)" } });
  assert.equal(o.tipo, "anuncio");
  assert.equal(o.enlace, null);
});

prueba("origen.canal = marketplace → marketplace", () => {
  assert.equal(origenDelCliente({ metadataContacto: { origen: { canal: "marketplace" } } }).tipo, "marketplace");
});

prueba("línea Ventas 2 sin datos → marketplace", () => {
  const o = origenDelCliente({ metadataContacto: {}, linea: ventas2 });
  assert.equal(o.tipo, "marketplace");
  assert.equal(o.etiqueta, "Marketplace");
});

prueba("anuncio que llega a la línea Ventas 2 → anuncio", () => {
  assert.equal(origenDelCliente({ metadataContacto: { source: "meta ads" }, linea: ventas2 }).tipo, "anuncio");
});

prueba("sin datos → orgánico / desconocido", () => {
  const o = origenDelCliente({ metadataContacto: {}, linea: ventas1 });
  assert.equal(o.tipo, "organico");
  assert.equal(o.etiqueta, "Orgánico / desconocido");
});

prueba("datos rotos (null, lista, texto, sin línea) → orgánico sin error", () => {
  for (const roto of [null, undefined, [], "hola", 5]) {
    assert.equal(origenDelCliente({ metadataContacto: roto }).tipo, "organico");
  }
});

prueba("esTipoDeOrigen acepta solo los tres", () => {
  assert.deepEqual([...TIPOS_DE_ORIGEN], ["anuncio", "marketplace", "organico"]);
  assert.equal(esTipoDeOrigen("anuncio"), true);
  assert.equal(esTipoDeOrigen("directo"), false);
});

prueba("herramientas.ts: filtro origen en el esquema y campo origen en la respuesta", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
  assert.match(fuente, /origen:\s*\{\s*description:[\s\S]*?enum:\s*\[\.\.\.TIPOS_DE_ORIGEN\]/);
  assert.match(fuente, /lista\(args, "origen", false\)/);
  assert.match(fuente, /totales_por_origen/);
  assert.match(fuente, /origen:\s*\(\(\{ tipo, tituloDelAnuncio/);
});

prueba("la ficha lee el origen con la acción de solo lectura y la acción valida el permiso", () => {
  const accion = fs.readFileSync(path.join(RAIZ, "src/app/actions/origen-del-contacto-actions.ts"), "utf8");
  assert.match(accion, /requireClientWorkspaceAccess\("chats"\)/);
  assert.match(accion, /workspaceId: access\.workspaceId/);
  assert.doesNotMatch(accion, /\.(create|update|delete|upsert)\(/);
});

console.log(`\n${pruebas} pruebas ok`);
