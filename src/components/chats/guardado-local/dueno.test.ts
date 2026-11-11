import { test } from "node:test";
import assert from "node:assert/strict";

// Correr: npx tsx --test src/components/chats/guardado-local/dueno.test.ts

/* Un navegador de mentira, ANTES de importar el modulo. */
const almacen = new Map<string, string>();
let localStorageRoto = false;
const basesBorradas: string[] = [];
const ventanaFalsa = {
  localStorage: {
    getItem: (clave: string) => {
      if (localStorageRoto) throw new Error("SecurityError");
      return almacen.get(clave) ?? null;
    },
    setItem: (clave: string, valor: string) => {
      if (localStorageRoto) throw new Error("SecurityError");
      almacen.set(clave, valor);
    },
    removeItem: (clave: string) => void almacen.delete(clave),
    get length() {
      if (localStorageRoto) throw new Error("SecurityError");
      return almacen.size;
    },
    key: (indice: number) => [...almacen.keys()][indice] ?? null,
  },
  indexedDB: { deleteDatabase: (nombre: string) => void basesBorradas.push(nombre) },
};
(globalThis as unknown as { window: typeof ventanaFalsa }).window = ventanaFalsa;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dueno = require("./dueno") as typeof import("./dueno");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lista = require("./lista-guardada") as typeof import("./lista-guardada");

const CLAVE = "aglite:dueno-del-guardado";

test("antes de fijar no hay dueño; al fijar queda anotado con la version", () => {
  dueno.reiniciarDuenoParaPruebas();
  assert.equal(dueno.duenoDelGuardado(), null);
  dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u1" });
  assert.equal(dueno.duenoDelGuardado(), "n1:u1:v3");
  assert.equal(almacen.get(CLAVE), "n1:u1:v3");
});

test("con el mismo dueño no borra nada (se llama en cada render)", () => {
  almacen.set("aglite:chat-history-cache:v3:n1:u1:v3", "{}");
  let avisos = 0;
  const quitar = dueno.alCambiarElDueno(() => {
    avisos += 1;
  });
  for (let vez = 0; vez < 5; vez += 1) {
    dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u1" });
  }
  assert.ok(almacen.has("aglite:chat-history-cache:v3:n1:u1:v3"));
  assert.equal(avisos, 0);
  quitar();
});

test("al recargar con el mismo dueño (otra carga de la pagina) se conserva lo guardado", () => {
  dueno.reiniciarDuenoParaPruebas();
  dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u1" });
  assert.ok(almacen.has("aglite:chat-history-cache:v3:n1:u1:v3"));
});

test("otro dueño: borra todo, avisa a los modulos y borra la base de IndexedDB", () => {
  let avisos = 0;
  const quitar = dueno.alCambiarElDueno(() => {
    avisos += 1;
  });
  dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u2" });
  assert.equal(almacen.has("aglite:chat-history-cache:v3:n1:u1:v3"), false);
  assert.equal(dueno.duenoDelGuardado(), "n1:u2:v3");
  assert.ok(avisos >= 1, "se avisa para vaciar la memoria");
  assert.ok(basesBorradas.includes("aglite-chats"));
  quitar();
});

test("si otra pestaña cambia de dueño, esta deja de leer y escribir", () => {
  dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u2" });
  almacen.set(CLAVE, "n1:u3:v3");
  assert.equal(dueno.duenoDelGuardado(), null);
  // Y si la otra pestaña cerro sesion (no hay llave), tampoco.
  almacen.delete(CLAVE);
  assert.equal(dueno.duenoDelGuardado(), null);
});

test("la lista guardada sigue al dueño: lo de otro dueño no se lee", () => {
  dueno.reiniciarDuenoParaPruebas();
  dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u1" });
  almacen.set(
    "aglite:lista-guardada:v3:n1:u1:v3",
    JSON.stringify({ version: "v3", guardadoEn: Date.now(), vistaKey: "v", filas: [{ id: "agent:1", label: "Ana" }] }),
  );
  assert.equal(lista.leerListaDelCelular()?.filas.length, 1);
  // Vieja de 25 h: no.
  assert.equal(lista.leerListaDelCelular(Date.now() + 25 * 3_600_000), null);

  dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u9" });
  assert.equal(lista.leerListaDelCelular(), null, "un dueño distinto da null");
  assert.equal(almacen.has("aglite:lista-guardada:v3:n1:u1:v3"), false);

  // Quitar un chat sin acceso de la lista guardada.
  almacen.set(
    "aglite:lista-guardada:v3:n1:u9:v3",
    JSON.stringify({
      version: "v3",
      guardadoEn: Date.now(),
      vistaKey: "v",
      filas: [
        { id: "agent:1", label: "Ana" },
        { id: "agent:2", label: "Beto" },
      ],
    }),
  );
  lista.quitarDeLaListaDelCelular("agent:1");
  assert.deepEqual(
    lista.leerListaDelCelular()?.filas.map((fila) => fila.id),
    ["agent:2"],
  );
});

test("apagado: sin dueño y sin nada guardado", () => {
  almacen.set("aglite:chat-visited:v1", "{}");
  dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u9", apagado: true });
  assert.equal(dueno.duenoDelGuardado(), null);
  assert.deepEqual([...almacen.keys()].filter((clave) => clave.startsWith("aglite:")), []);
});

test("con localStorage roto nunca lanza y no hay dueño", () => {
  dueno.reiniciarDuenoParaPruebas();
  localStorageRoto = true;
  try {
    assert.doesNotThrow(() => dueno.fijarDuenoDelGuardado({ workspaceId: "n1", userId: "u1" }));
    assert.equal(dueno.duenoDelGuardado(), null);
    assert.doesNotThrow(() => dueno.borrarTodoElGuardado());
    assert.equal(lista.leerListaDelCelular(), null);
    assert.doesNotThrow(() => lista.guardarListaEnElCelular("v", []));
  } finally {
    localStorageRoto = false;
  }
});
