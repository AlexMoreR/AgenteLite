// Pruebas del origen del cliente (src/lib/origen-del-cliente.ts), sin base de datos.
// Correr: npm run test:origen-del-cliente
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const { origenDelCliente, TIPOS_DE_ORIGEN } = cargar("src/lib/origen-del-cliente.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const ventas2 = { channelId: "c2", nombre: "Ventas 2" };

prueba("datos de anuncio -> anuncio con título, id y red", () => {
  const o = origenDelCliente({
    metadataContacto: {
      source: "meta ads",
      adTitle: "Camillas Cali",
      adSourceId: "123",
      adSourceApp: "instagram",
      adSourceUrl: "https://fb.me/x",
      adCapturedAt: "2026-10-01T00:00:00Z",
    },
  });
  assert.equal(o.tipo, "anuncio");
  assert.equal(o.anuncioTitulo, "Camillas Cali");
  assert.equal(o.anuncioId, "123");
  assert.equal(o.red, "Instagram");
  assert.equal(o.anuncioUrl, "https://fb.me/x");
  assert.match(o.etiqueta, /Anuncio de Meta · Instagram · «Camillas Cali»/);
});

prueba("un link que no es web no se ofrece", () => {
  const o = origenDelCliente({ metadataContacto: { source: "meta ads", adSourceUrl: "javascript:alert(1)" } });
  assert.equal(o.anuncioUrl, null);
});

prueba("origen.canal = marketplace -> marketplace", () => {
  assert.equal(origenDelCliente({ metadataContacto: { origen: { canal: "marketplace" } } }).tipo, "marketplace");
});

prueba("línea Ventas 2 sin datos -> marketplace", () => {
  assert.equal(origenDelCliente({ metadataContacto: {}, linea: ventas2 }).tipo, "marketplace");
});

prueba("anuncio que llega a Ventas 2 -> anuncio", () => {
  assert.equal(origenDelCliente({ metadataContacto: { source: "meta ads" }, linea: ventas2 }).tipo, "anuncio");
});

prueba("sin datos -> orgánico / desconocido", () => {
  const o = origenDelCliente({ metadataContacto: {}, linea: { channelId: "c1", nombre: "Ventas 1" } });
  assert.equal(o.tipo, "organico");
  assert.equal(o.etiqueta, "Orgánico / desconocido");
});

prueba("datos rotos -> orgánico, sin error", () => {
  for (const roto of [null, undefined, [], "texto", 5]) {
    assert.equal(origenDelCliente({ metadataContacto: roto }).tipo, "organico");
  }
});

prueba("herramientas.ts: filtro origen con sus tres opciones y campo origen en la respuesta", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
  assert.deepEqual([...TIPOS_DE_ORIGEN], ["anuncio", "marketplace", "organico"]);
  assert.match(fuente, /origen: \{\s+description:/);
  assert.match(fuente, /\.\.\.TIPOS_DE_ORIGEN/);
  assert.match(fuente, /totales_por_origen/);
  assert.match(fuente, /origen: \(\(\) =>/);
});

prueba("la ficha lee el origen con permiso de chats y solo lectura", () => {
  const accion = fs.readFileSync(path.join(RAIZ, "src/app/actions/origen-del-contacto-actions.ts"), "utf8");
  assert.match(accion, /requireClientWorkspaceAccess\("chats"\)/);
  assert.doesNotMatch(accion, /\.(create|update|delete|upsert)\(/);
});

console.log(`\n${pruebas} pruebas ok`);
