// Pruebas del Tablero IA (src/features/tableros-inteligentes/services): quién aprueba,
// qué estados puede poner Claude, qué pasa al editar algo aprobado, qué se puede deshacer y la
// disposición del mapa. No necesita base ni red.
// Correr: npm run test:tableros
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const reglas = cargar("src/features/tableros-inteligentes/services/reglas.ts");
const { disponer } = cargar("src/features/tableros-inteligentes/services/disposicion.ts");

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

console.log(`\n${pruebas} pruebas, todas bien`);
