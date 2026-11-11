// La foto de la bandeja (11-nov-2026). Correr: npm run test:foto-de-la-bandeja
import assert from "node:assert/strict";
import { test } from "node:test";

import { rutaDeLaVista, scriptDeLaFoto } from "./foto-de-la-bandeja";

type Nodo = {
  id: string;
  innerHTML: string;
  style: { cssText: string };
  atributos: Record<string, string>;
  setAttribute: (nombre: string, valor: string) => void;
  addEventListener: () => void;
  parentNode: { removeChild: (nodo: Nodo) => void } | null;
};

/** Un navegador de mentira con lo justo que usa el script, y el script corriendo adentro. */
function correrElScript(opciones: { search?: string; ancho?: number; alto?: number; foto?: Record<string, unknown> | null }) {
  const almacen = new Map<string, string>();
  const dueno = "negocio:usuario:v3";
  almacen.set("aglite:dueno-del-guardado", dueno);
  const ruta = rutaDeLaVista("/cliente/chats", "");
  if (opciones.foto !== null) {
    const foto = {
      version: 1,
      guardadoEn: Date.now() - 60_000,
      ruta,
      vw: 390,
      vh: 844,
      x: 0,
      y: 56,
      w: 390,
      h: 788,
      html: "<aside>la bandeja</aside>",
      ...(opciones.foto ?? {}),
    };
    almacen.set(`aglite:lista-guardada:foto:${dueno}`, JSON.stringify({ [String(foto.ruta)]: foto }));
  }
  const nodos = new Map<string, Nodo>();
  const agregados: Nodo[] = [];
  const documento = {
    activeElement: null,
    getElementById: (id: string) => nodos.get(id) ?? null,
    createElement: () => {
      const nodo: Nodo = {
        id: "",
        innerHTML: "",
        style: { cssText: "" },
        atributos: {},
        setAttribute(nombre, valor) {
          this.atributos[nombre] = valor;
        },
        addEventListener() {},
        parentNode: null,
      };
      return nodo;
    },
    body: {
      appendChild: (nodo: Nodo) => {
        nodos.set(nodo.id, nodo);
        agregados.push(nodo);
        nodo.parentNode = { removeChild: () => nodos.delete(nodo.id) };
      },
    },
  };
  const ventana = {
    location: { pathname: "/cliente/chats", search: opciones.search ?? "" },
    localStorage: { getItem: (clave: string) => almacen.get(clave) ?? null },
    innerWidth: opciones.ancho ?? 390,
    innerHeight: opciones.alto ?? 844,
    setTimeout: () => 0,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  // Solo con los globales que da el navegador: si el script usara algo de afuera, aca reventaria.
  new Function("window", "document", scriptDeLaFoto())(ventana, documento);
  return agregados;
}

test("la vista no depende del chat abierto ni del orden de los parametros", () => {
  assert.equal(rutaDeLaVista("/cliente/chats", "?chatKey=agent:1&assigned=mine&status=open"), "/cliente/chats?assigned=mine&status=open");
  assert.equal(rutaDeLaVista("/cliente/chats", "?status=open&assigned=mine"), "/cliente/chats?assigned=mine&status=open");
  assert.equal(rutaDeLaVista("/cliente/chats", ""), "/cliente/chats?");
});

test("con una foto vigente de esta vista y esta pantalla, la pone encima en el mismo lugar", () => {
  const agregados = correrElScript({});
  assert.equal(agregados.length, 1);
  assert.equal(agregados[0].id, "foto-de-la-bandeja");
  assert.equal(agregados[0].innerHTML, "<aside>la bandeja</aside>");
  assert.match(agregados[0].style.cssText, /position:fixed/);
  assert.match(agregados[0].style.cssText, /top:56px/);
  assert.match(agregados[0].style.cssText, /height:788px/);
});

test("no pone nada si se abre directo un chat, si la pantalla mide otra cosa, si es vieja o si no hay foto", () => {
  assert.equal(correrElScript({ search: "?chatKey=agent:1" }).length, 0);
  assert.equal(correrElScript({ ancho: 1366 }).length, 0);
  assert.equal(correrElScript({ foto: { guardadoEn: Date.now() - 25 * 3_600_000 } }).length, 0);
  assert.equal(correrElScript({ foto: { version: 2 } }).length, 0);
  assert.equal(correrElScript({ foto: { ruta: "/cliente/chats?assigned=mine" } }).length, 0);
  assert.equal(correrElScript({ foto: null }).length, 0);
});
