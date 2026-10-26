// Pruebas del origen del cliente (src/lib/origen-del-cliente.ts) y de su uso en el MCP.
// Correr: npm run test:origen-del-cliente
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const { origenDelCliente } = cargar("src/lib/origen-del-cliente.ts");
const ventas2 = { channelId: "c2", nombre: "Ventas 2", purpose: "SALES", metadata: null };

// Datos de anuncio -> anuncio con título, id y red.
const anuncio = origenDelCliente({
  source: "meta ads", adTitle: "Camillas contra entrega Cali", adSourceId: "123", adSourceApp: "instagram",
  adSourceUrl: "https://fb.me/x", adCapturedAt: "2026-10-01T00:00:00Z",
});
assert.equal(anuncio.tipo, "anuncio");
assert.equal(anuncio.tituloAnuncio, "Camillas contra entrega Cali");
assert.equal(anuncio.idAnuncio, "123");
assert.equal(anuncio.red, "Instagram");
assert.equal(anuncio.enlace, "https://fb.me/x");
assert.equal(anuncio.etiqueta, "Anuncio de Meta · Instagram · «Camillas contra entrega Cali»");

// Un enlace que no es http(s) no se ofrece.
assert.equal(origenDelCliente({ source: "meta ads", adSourceUrl: "javascript:alert(1)" }).enlace, null);

// Marketplace por metadata y por línea.
assert.equal(origenDelCliente({ origen: { canal: "marketplace" } }).tipo, "marketplace");
assert.equal(origenDelCliente({}, ventas2).tipo, "marketplace");
assert.equal(origenDelCliente(null, ventas2).etiqueta, "Marketplace");

// Anuncio que llega a la línea de Marketplace -> anuncio.
assert.equal(origenDelCliente({ source: "meta ads" }, ventas2).tipo, "anuncio");

// Sin datos -> orgánico.
assert.equal(origenDelCliente({}).tipo, "organico");
assert.equal(origenDelCliente({}, { channelId: "c1", nombre: "Ventas 1" }).tipo, "organico");
assert.equal(origenDelCliente({}).etiqueta, "Orgánico / desconocido");

// Datos rotos no lanzan error.
for (const roto of [null, undefined, [], "texto", 5, { adTitle: 7, origen: "x" }]) {
  assert.equal(origenDelCliente(roto).tipo, "organico");
}

// MCP: el filtro y el campo en listar_conversaciones.
const mcp = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
assert.match(mcp, /origen: \{\s+description:/);
assert.match(mcp, /TIPOS_DE_ORIGEN/);
assert.match(mcp, /lista\(args, "origen"\)/);
assert.match(mcp, /totales_por_origen/);
assert.match(mcp, /origen: \(\(\{ tipo/);
const origen = fs.readFileSync(path.join(RAIZ, "src/lib/origen-del-cliente.ts"), "utf8");
for (const t of ["anuncio", "marketplace", "organico"]) assert.ok(origen.includes(`"${t}"`));

console.log("origen del cliente: OK");
