// Pruebas del origen del cliente (src/lib/origen-del-cliente.ts) y de su uso en listar_conversaciones.
// Correr: npm run test:origen-del-cliente
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const { clasificarOrigenDelCliente } = cargar("src/lib/origen-del-cliente.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const ventas1 = { channelId: "c1", nombre: "Ventas 1" };
const ventas2 = { channelId: "c2", nombre: "Ventas 2" };

prueba("datos de anuncio → Anuncio de Meta con título, id y red", () => {
  const o = clasificarOrigenDelCliente({
    metadataContacto: { source: "meta ads", adTitle: "Camillas Cali", adSourceId: "123", adSourceApp: "instagram", adSourceUrl: "https://fb.me/x" },
    linea: ventas1,
  });
  assert.equal(o.tipo, "anuncio");
  assert.equal(o.adTitulo, "Camillas Cali");
  assert.equal(o.adId, "123");
  assert.equal(o.red, "Instagram");
  assert.equal(o.adUrl, "https://fb.me/x");
  assert.equal(o.etiqueta, "Anuncio de Meta · Instagram · «Camillas Cali»");
});

prueba("origen.canal = marketplace → Marketplace", () => {
  assert.equal(clasificarOrigenDelCliente({ metadataContacto: { origen: { canal: "marketplace" } }, linea: ventas1 }).tipo, "marketplace");
});

prueba("línea Ventas 2 sin datos → Marketplace", () => {
  assert.equal(clasificarOrigenDelCliente({ metadataContacto: {}, linea: ventas2 }).tipo, "marketplace");
});

prueba("anuncio que llega a Ventas 2 → Anuncio", () => {
  assert.equal(clasificarOrigenDelCliente({ metadataContacto: { adCapturedAt: "2026-10-01T00:00:00Z" }, linea: ventas2 }).tipo, "anuncio");
});

prueba("sin datos → Orgánico / desconocido", () => {
  const o = clasificarOrigenDelCliente({ metadataContacto: {}, linea: ventas1 });
  assert.equal(o.tipo, "organico");
  assert.equal(o.etiqueta, "Orgánico / desconocido");
});

prueba("datos rotos no lanzan error", () => {
  for (const roto of [null, undefined, [], "texto", 5, { origen: "x" }]) {
    assert.equal(clasificarOrigenDelCliente({ metadataContacto: roto, linea: null }).tipo, "organico");
  }
});

prueba("un link que no es http(s) no se ofrece como enlace", () => {
  assert.equal(clasificarOrigenDelCliente({ metadataContacto: { source: "meta ads", adSourceUrl: "javascript:alert(1)" } }).adUrl, null);
});

prueba("listar_conversaciones: filtro origen en el esquema y campo origen en la respuesta", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
  assert.match(fuente, /origen: \{\s*description:[\s\S]*?TIPOS_DE_ORIGEN/);
  assert.match(fuente, /totales_por_origen/);
  assert.match(fuente, /titulo_del_anuncio/);
  assert.match(fuente, /take: origenesPedidos\.length > 0 \? 500 : limite/);
});

console.log(`\n${pruebas} pruebas ok`);
