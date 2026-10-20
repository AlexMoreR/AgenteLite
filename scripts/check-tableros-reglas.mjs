// Pruebas del Tablero IA (src/features/tableros-inteligentes/services): quién aprueba,
// qué estados puede poner Claude, qué pasa al editar algo aprobado, qué se puede deshacer y la
// disposición del mapa. No necesita base ni red.
// Correr: npm run test:tableros
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const reglas = cargar("src/features/tableros-inteligentes/services/reglas.ts");
const { disponer, sePisan } = cargar("src/features/tableros-inteligentes/services/disposicion.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T0 = new Date("2026-10-19T15:00:00Z");
const despues = (ms) => new Date(T0.getTime() + ms);
const cambio = (extra) => ({
  id: "c1",
  accion: "editar",
  origen: "MCP",
  creadoEn: T0,
  deshechoEn: null,
  antes: { titulo: "Viejo" },
  despues: { titulo: "Nuevo" },
  ...extra,
});

/* ------------------------------------------------------------------ estados */

prueba("nadie pone APROBADO con un cambio de estado, desde ningún estado", () => {
  for (const de of reglas.ESTADOS_TARJETA) {
    assert.ok(reglas.puedeCambiarEstado(de, "APROBADO"), `desde ${de}`);
  }
});

prueba("la lista de estados de Claude no incluye APROBADO", () => {
  assert.ok(!reglas.ESTADOS_SIN_APROBAR.includes("APROBADO"));
  assert.equal(reglas.ESTADOS_SIN_APROBAR.length, 5);
  assert.deepEqual([...reglas.ESTADOS_AL_CREAR], ["IDEA", "POR_APROBAR"]);
});

prueba("EN_CURSO solo sale de APROBADO; HECHO y FALLIDO de APROBADO o EN_CURSO", () => {
  assert.equal(reglas.puedeCambiarEstado("APROBADO", "EN_CURSO"), null);
  assert.ok(reglas.puedeCambiarEstado("IDEA", "EN_CURSO"));
  assert.ok(reglas.puedeCambiarEstado("POR_APROBAR", "EN_CURSO"));
  assert.equal(reglas.puedeCambiarEstado("EN_CURSO", "HECHO"), null);
  assert.equal(reglas.puedeCambiarEstado("APROBADO", "FALLIDO"), null);
  assert.ok(reglas.puedeCambiarEstado("IDEA", "HECHO"));
  assert.ok(reglas.puedeCambiarEstado("POR_APROBAR", "FALLIDO"));
});

prueba("pedir aprobación y bajar de estado se puede desde cualquier lado", () => {
  assert.equal(reglas.puedeCambiarEstado("IDEA", "POR_APROBAR"), null);
  assert.equal(reglas.puedeCambiarEstado("APROBADO", "IDEA"), null);
  assert.equal(reglas.puedeCambiarEstado("HECHO", "POR_APROBAR"), null);
  assert.ok(reglas.puedeCambiarEstado("IDEA", "IDEA"), "mismo estado");
});

/* ------------------------------------------------------------------ aprobar */

prueba("aprobar: solo desde POR_APROBAR", () => {
  assert.equal(reglas.puedeAprobar("PANTALLA", "POR_APROBAR"), null);
  for (const estado of ["IDEA", "APROBADO", "EN_CURSO", "HECHO", "FALLIDO"]) {
    assert.ok(reglas.puedeAprobar("PANTALLA", estado), `desde ${estado}`);
  }
});

prueba("aprobar: nunca desde el MCP", () => {
  assert.ok(reglas.puedeAprobar("MCP", "POR_APROBAR"));
});

prueba("quién aprueba: dueño o ADMIN de la plataforma; empleado o miembro común no", () => {
  assert.equal(reglas.personaPuedeAprobar({ isOwner: true, role: "CLIENTE" }), true);
  assert.equal(reglas.personaPuedeAprobar({ isOwner: false, role: "ADMIN" }), true);
  assert.equal(reglas.personaPuedeAprobar({ isOwner: false, role: "CLIENTE" }), false);
  assert.equal(reglas.personaPuedeAprobar({ isOwner: false, role: "EMPLEADO" }), false);
});

/* ------------------------------------------------------------------ editar */

prueba("Claude edita una APROBADA: vuelve a POR_APROBAR", () => {
  assert.equal(reglas.estadoTrasEditar("MCP", "APROBADO"), "POR_APROBAR");
  assert.equal(reglas.estadoTrasEditar("TRABAJADOR", "APROBADO"), "POR_APROBAR");
});

prueba("editar algo que no está aprobado no cambia su estado", () => {
  for (const estado of ["IDEA", "POR_APROBAR", "EN_CURSO", "HECHO", "FALLIDO"]) {
    assert.equal(reglas.estadoTrasEditar("MCP", estado), estado);
  }
});

/* ------------------------------------------------------------------ deshacer */

prueba("deshacer un editar sin nada después: se puede", () => {
  assert.equal(reglas.puedeDeshacer(cambio(), [], "IDEA"), null);
});

prueba("no se deshace un cambio de la PANTALLA ni una aprobación", () => {
  assert.ok(reglas.puedeDeshacer(cambio({ origen: "PANTALLA" }), [], "IDEA"));
  assert.ok(reglas.puedeDeshacer(cambio({ accion: "aprobar", antes: { estado: "POR_APROBAR" } }), [], "APROBADO"));
});

prueba("no se deshace dos veces ni se deshace un deshacer", () => {
  assert.ok(reglas.puedeDeshacer(cambio({ deshechoEn: despues(5) }), [], "IDEA"));
  assert.ok(reglas.puedeDeshacer(cambio({ accion: "deshacer" }), [], "IDEA"));
});

prueba("si después hubo otro cambio sin deshacer sobre lo mismo, se niega", () => {
  const otro = cambio({ id: "c2", creadoEn: despues(1000) });
  assert.ok(reglas.puedeDeshacer(cambio(), [otro], "IDEA"));
  // La aprobación del dueño posterior también bloquea.
  const aprobacion = cambio({ id: "c3", accion: "aprobar", origen: "PANTALLA", creadoEn: despues(1000) });
  assert.ok(reglas.puedeDeshacer(cambio(), [aprobacion], "APROBADO"));
});

prueba("lo posterior ya deshecho, o un deshacer, no bloquea", () => {
  const deshecho = cambio({ id: "c2", creadoEn: despues(1000), deshechoEn: despues(2000) });
  const deshacer = cambio({ id: "c3", accion: "deshacer", creadoEn: despues(2000) });
  assert.equal(reglas.puedeDeshacer(cambio(), [deshecho, deshacer], "IDEA"), null);
});

prueba("una flecha posterior no bloquea deshacer un editar (tocan cosas distintas)", () => {
  const flecha = cambio({ id: "c2", accion: "conectar", creadoEn: despues(1000), antes: null, despues: { conexionId: "x" } });
  assert.equal(reglas.puedeDeshacer(cambio(), [flecha], "IDEA"), null);
});

prueba("deshacer una creación se niega si después hubo cualquier cambio", () => {
  const crear = cambio({ accion: "crear", antes: null, despues: { titulo: "A" } });
  assert.equal(reglas.puedeDeshacer(crear, [], "IDEA"), null);
  const flecha = cambio({ id: "c2", accion: "conectar", creadoEn: despues(1000), antes: null, despues: { conexionId: "x" } });
  assert.ok(reglas.puedeDeshacer(crear, [flecha], "IDEA"));
});

prueba("deshacer no DEJA un APROBADO (editar una aprobada y deshacerlo)", () => {
  const editarAprobada = cambio({
    antes: { titulo: "Viejo", estado: "APROBADO" },
    despues: { titulo: "Nuevo", estado: "POR_APROBAR" },
  });
  assert.ok(reglas.puedeDeshacer(editarAprobada, [], "POR_APROBAR"));
  const bajarDeAprobado = cambio({ accion: "estado", antes: { estado: "APROBADO" }, despues: { estado: "IDEA" } });
  assert.ok(reglas.puedeDeshacer(bajarDeAprobado, [], "IDEA"));
});

prueba("deshacer no QUITA un APROBADO", () => {
  const pedir = cambio({ accion: "estado", antes: { estado: "IDEA" }, despues: { estado: "POR_APROBAR" } });
  // Si de algún modo la tarjeta quedó APROBADA, deshacer el pedido no la baja.
  assert.ok(reglas.puedeDeshacer(pedir, [], "APROBADO"));
  const crear = cambio({ accion: "crear", antes: null, despues: { titulo: "A" } });
  assert.ok(reglas.puedeDeshacer(crear, [], "APROBADO"));
});

/* ------------------------------------------------------------------ entradas */

prueba("fecha: AAAA-MM-DD queda a mediodía de Colombia; vacío borra; basura falla", () => {
  assert.equal(reglas.fechaDeEntrada("2026-10-20").toISOString(), "2026-10-20T17:00:00.000Z");
  assert.equal(reglas.fechaDeEntrada(""), null);
  assert.equal(reglas.fechaDeEntrada(null), null);
  assert.equal(reglas.fechaDeEntrada(undefined), undefined);
  assert.throws(() => reglas.fechaDeEntrada("mañana"));
});

/* ------------------------------------------------------------------ mapa */

prueba("mapa: es determinista y no encima tarjetas", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const aristas = [
    { origenId: "a", destinoId: "b" },
    { origenId: "b", destinoId: "c" },
  ];
  const uno = disponer(ids, aristas);
  const dos = disponer(ids, aristas);
  assert.deepEqual([...uno.entries()], [...dos.entries()]);
  for (const x of ids) {
    for (const y of ids) {
      if (x >= y) continue;
      const p = uno.get(x);
      const q = uno.get(y);
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 60, `${x}-${y} muy cerca`);
    }
  }
});

prueba("mapa: las que ya tenían lugar no se mueven al llegar una nueva", () => {
  const previas = new Map([
    ["a", { x: 10, y: 20 }],
    ["b", { x: 300, y: -40 }],
  ]);
  const nuevas = disponer(["a", "b", "c"], [{ origenId: "c", destinoId: "a" }], previas);
  assert.deepEqual(nuevas.get("a"), { x: 10, y: 20 });
  assert.deepEqual(nuevas.get("b"), { x: 300, y: -40 });
  const c = nuevas.get("c");
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
  // Nace cerca de la tarjeta con la que está conectada.
  assert.ok(Math.hypot(c.x - 10, c.y - 20) < 700);
});

// Rectángulos de tarjeta (esquina arriba-izquierda) que se tocan, sin margen de aire.
const encima = (p, q) => sePisan(p, q, 0);
function sinSolapes(posiciones, revisar, nombre) {
  const todas = [...posiciones.entries()];
  for (const [x, p] of todas) {
    if (!revisar.has(x)) continue;
    for (const [y, q] of todas) {
      if (x === y) continue;
      assert.ok(!encima(p, q), `${nombre}: ${x} queda encima de ${y}`);
    }
  }
}

prueba("mapa: un tablero nuevo no tiene tarjetas encimadas (muchas tarjetas, varias formas)", () => {
  for (const cantidad of [2, 7, 25, 60]) {
    const ids = Array.from({ length: cantidad }, (_, i) => `t${String(i).padStart(2, "0")}`);
    // Estrella (todas a la primera), cadena y sueltas: las tres juntan tarjetas de formas distintas.
    const estrella = ids.slice(1).map((id) => ({ origenId: ids[0], destinoId: id }));
    const cadena = ids.slice(1).map((id, i) => ({ origenId: ids[i], destinoId: id }));
    for (const [forma, aristas] of [["estrella", estrella], ["cadena", cadena], ["sueltas", []]]) {
      const pos = disponer(ids, aristas);
      sinSolapes(pos, new Set(ids), `${forma} de ${cantidad}`);
    }
  }
});

prueba("mapa: una nueva que caería encima de una fija se corre a un hueco y la fija no se mueve", () => {
  // Fijas en fila bien juntas: el resorte dejaría a la nueva justo sobre alguna.
  const previas = new Map(Array.from({ length: 6 }, (_, i) => [`f${i}`, { x: i * 230, y: 0 }]));
  const ids = [...previas.keys(), "n1", "n2", "n3"];
  const aristas = [
    { origenId: "f0", destinoId: "n1" },
    { origenId: "n1", destinoId: "f5" },
    { origenId: "f2", destinoId: "n2" },
    { origenId: "f3", destinoId: "n2" },
    { origenId: "n2", destinoId: "n3" },
  ];
  const pos = disponer(ids, aristas, previas);
  for (const [id, p] of previas) assert.deepEqual(pos.get(id), p);
  sinSolapes(pos, new Set(["n1", "n2", "n3"]), "nuevas junto a fijas");
});

prueba("mapa: agregar tarjetas de a una (como el refresco de 5 s) nunca las encima", () => {
  let previas = new Map();
  const ids = [];
  const aristas = [];
  for (let i = 0; i < 30; i += 1) {
    const id = `k${i}`;
    ids.push(id);
    if (i > 0) aristas.push({ origenId: ids[Math.floor(i / 3)], destinoId: id });
    const pos = disponer(ids, aristas, previas);
    for (const [viejo, p] of previas) assert.deepEqual(pos.get(viejo), p);
    sinSolapes(pos, new Set([id]), `paso ${i}`);
    previas = pos;
  }
  sinSolapes(previas, new Set(ids), "al final");
});

prueba("mapa: rodeada de fijas apretadas en grilla, la nueva igual encuentra hueco", () => {
  const previas = new Map();
  for (let fila = 0; fila < 8; fila += 1) {
    for (let col = 0; col < 8; col += 1) previas.set(`g${fila}-${col}`, { x: col * 224, y: fila * 134 });
  }
  const ids = [...previas.keys(), "nueva"];
  const pos = disponer(ids, [{ origenId: "g3-3", destinoId: "nueva" }], previas);
  sinSolapes(pos, new Set(["nueva"]), "grilla llena");
});

console.log(`\n${pruebas} pruebas, todas bien`);
