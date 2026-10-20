// Pruebas del Tablero IA (src/features/tableros-inteligentes/services): quién aprueba,
// qué estados puede poner Claude, qué pasa al editar algo aprobado, qué se puede deshacer, los
// tipos de tarjeta (aprobación, cambio de tipo, madres permitidas y ciclos), borrar y deshacer con
// flechas, los niveles del mapa, la disposición radial y los contadores. Fase 2: las transiciones del
// trabajador, aprobar_tarjeta (quién, momento, estado, texto, zona protegida), el sí final solo del
// dueño, que el MCP no quita la zona protegida y los contadores nuevos. No necesita base ni red.
// Correr: npm run test:tableros
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const reglas = cargar("src/features/tableros-inteligentes/services/reglas.ts");
const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const { disponerRadial, sePisan, RADIO_INICIAL, ANCHO_CENTRO, ALTO_CENTRO, ANCHO_TARJETA, MAX_PRIMER_ANILLO, SEPARACION, ALTO_TARJETA } = cargar("src/features/tableros-inteligentes/services/disposicion.ts");
const reglasNiveles = cargar("src/features/tableros-inteligentes/services/niveles.ts");

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

/* ------------------------------------------------------------------ tipos: aprobación */

prueba("tipo sin aprobación: nunca POR_APROBAR ni APROBADO; va libre entre IDEA, EN_CURSO, HECHO, FALLIDO", () => {
  assert.ok(reglas.estadoPermitidoParaTipo("POR_APROBAR", false));
  assert.ok(reglas.estadoPermitidoParaTipo("APROBADO", false));
  for (const estado of reglas.ESTADOS_SIN_APROBACION) assert.equal(reglas.estadoPermitidoParaTipo(estado, false), null);
  for (const estado of reglas.ESTADOS_TARJETA) assert.equal(reglas.estadoPermitidoParaTipo(estado, true), null);
  assert.ok(reglas.puedeCambiarEstado("IDEA", "POR_APROBAR", false));
  assert.ok(reglas.puedeCambiarEstado("IDEA", "APROBADO", false));
  assert.equal(reglas.puedeCambiarEstado("IDEA", "EN_CURSO", false), null);
  assert.equal(reglas.puedeCambiarEstado("EN_CURSO", "HECHO", false), null);
  assert.equal(reglas.puedeCambiarEstado("HECHO", "IDEA", false), null);
  assert.ok(reglas.puedeCambiarEstado("IDEA", "IDEA", false), "mismo estado");
});

prueba("tipo con aprobación: las reglas de siempre (EN_CURSO solo sale de APROBADO)", () => {
  assert.ok(reglas.puedeCambiarEstado("IDEA", "EN_CURSO", true));
  assert.equal(reglas.puedeCambiarEstado("APROBADO", "EN_CURSO", true), null);
  assert.equal(reglas.puedeCambiarEstado("IDEA", "POR_APROBAR", true), null);
});

prueba("aprobar: solo tarjetas de un tipo con aprobación, desde POR_APROBAR, nunca el MCP", () => {
  assert.equal(reglas.puedeAprobar("PANTALLA", "POR_APROBAR", true), null);
  assert.ok(reglas.puedeAprobar("PANTALLA", "POR_APROBAR", false));
  assert.ok(reglas.puedeAprobar("MCP", "POR_APROBAR", true));
});

prueba("al crear: IDEA por defecto; POR_APROBAR solo si el tipo pide aprobación; APROBADO nunca", () => {
  assert.equal(reglas.estadoAlCrear(undefined, false), "IDEA");
  assert.equal(reglas.estadoAlCrear(undefined, true), "IDEA");
  assert.equal(reglas.estadoAlCrear("POR_APROBAR", true), "POR_APROBAR");
  assert.throws(() => reglas.estadoAlCrear("POR_APROBAR", false), /no pide aprobación/);
  assert.throws(() => reglas.estadoAlCrear("APROBADO", true));
  assert.throws(() => reglas.estadoAlCrear("EN_CURSO", false));
});

prueba("cambiar el tipo: con aprobación queda POR_APROBAR, sin aprobación queda IDEA (pierde la aprobación)", () => {
  assert.equal(reglas.estadoTrasCambiarTipo(true), "POR_APROBAR");
  assert.equal(reglas.estadoTrasCambiarTipo(false), "IDEA");
});

prueba("el MCP no le quita la aprobación a un tipo; el dueño sí, salvo con APROBADAS o EN_CURSO", () => {
  assert.ok(reglas.puedeCambiarAprobacionDelTipo("MCP", true, false, 0));
  assert.ok(reglas.puedeCambiarAprobacionDelTipo("TRABAJADOR", true, false, 0));
  assert.equal(reglas.puedeCambiarAprobacionDelTipo("PANTALLA", true, false, 0), null);
  assert.ok(reglas.puedeCambiarAprobacionDelTipo("PANTALLA", true, false, 2), "con aprobadas o en curso, ni el dueño");
  // Ponerle aprobación sí puede cualquiera; no cambiar nada tampoco es problema.
  assert.equal(reglas.puedeCambiarAprobacionDelTipo("MCP", false, true, 5), null);
  assert.equal(reglas.puedeCambiarAprobacionDelTipo("MCP", true, true, 5), null);
});

prueba("borrar un tipo: solo en pantalla y sin tarjetas que lo usen", () => {
  assert.ok(reglas.puedeBorrarTipo("MCP", 0));
  assert.ok(reglas.puedeBorrarTipo("PANTALLA", 1));
  assert.equal(reglas.puedeBorrarTipo("PANTALLA", 0), null);
});

prueba("tipos por defecto: Área (carpeta, dentro de Área), Idea <- Área, Tarea <- Idea; solo Tarea pide aprobación", () => {
  assert.deepEqual(
    reglas.TIPOS_POR_DEFECTO.map((t) => [t.nombre, t.requiereAprobacion, t.usaEstados, [...t.padres]]),
    [
      ["Área", false, false, ["Área"]],
      ["Idea", false, true, ["Área"]],
      ["Tarea", true, true, ["Idea"]],
    ],
  );
  for (const tipo of reglas.TIPOS_POR_DEFECTO) assert.ok(reglas.esIconoDeTipo(tipo.icono));
});

prueba("tipo sin estados (Área): sin estado, no se aprueba, cambiar_estado se rechaza", () => {
  assert.equal(reglas.estadoPermitidoParaTipo("IDEA", false, false), null, "IDEA interno");
  for (const estado of ["POR_APROBAR", "APROBADO", "EN_CURSO", "HECHO", "FALLIDO"]) {
    assert.ok(reglas.estadoPermitidoParaTipo(estado, false, false), estado);
  }
  for (const a of reglas.ESTADOS_SIN_APROBAR) assert.ok(reglas.puedeCambiarEstado("IDEA", a, false, false), a);
  assert.ok(reglas.puedeAprobar("PANTALLA", "POR_APROBAR", true, false));
  assert.equal(reglas.estadoAlCrear(undefined, false, false), "IDEA");
  assert.equal(reglas.estadoAlCrear("IDEA", false, false), "IDEA");
  assert.throws(() => reglas.estadoAlCrear("POR_APROBAR", false, false), /carpetas/);
  assert.equal(reglas.estadoTrasCambiarTipo(false, false), "IDEA");
  assert.equal(reglas.estadoTrasCambiarTipo(true, false), "IDEA");
});

prueba("quitarle los estados a un tipo: MCP solo si todo está IDEA; nadie con APROBADAS/EN_CURSO; nunca con aprobación", () => {
  const nada = { aprobadasOEnCurso: 0, noIdea: 0 };
  assert.equal(reglas.puedeCambiarEstadosDelTipo("MCP", true, false, nada, false), null);
  assert.ok(reglas.puedeCambiarEstadosDelTipo("MCP", true, false, { aprobadasOEnCurso: 0, noIdea: 2 }, false));
  assert.equal(reglas.puedeCambiarEstadosDelTipo("PANTALLA", true, false, { aprobadasOEnCurso: 0, noIdea: 2 }, false), null);
  assert.ok(reglas.puedeCambiarEstadosDelTipo("PANTALLA", true, false, { aprobadasOEnCurso: 1, noIdea: 1 }, false));
  assert.ok(reglas.puedeCambiarEstadosDelTipo("PANTALLA", true, false, nada, true), "sin estados no pide aprobación");
  assert.equal(reglas.puedeCambiarEstadosDelTipo("MCP", false, true, nada, true), null, "darle estados siempre");
});

prueba("elegir tipo: por id o nombre (sin tildes ni mayúsculas); sin tipo = Idea, si no la primera sin aprobación", () => {
  const tipos = [
    { id: "t1", nombre: "Área", requiereAprobacion: false, orden: 0 },
    { id: "t2", nombre: "Idea", requiereAprobacion: false, orden: 1 },
    { id: "t3", nombre: "Tarea", requiereAprobacion: true, orden: 2 },
  ];
  assert.equal(reglas.elegirTipo(tipos, undefined).id, "t2");
  assert.equal(reglas.elegirTipo(tipos, "").id, "t2");
  assert.equal(reglas.elegirTipo(tipos, "area").id, "t1");
  assert.equal(reglas.elegirTipo(tipos, "AREA").id, "t1");
  assert.equal(reglas.elegirTipo(tipos, "Área").id, "t1");
  assert.equal(reglas.elegirTipo(tipos, " TAREA ").id, "t3");
  assert.equal(reglas.elegirTipo(tipos, "t3").id, "t3");
  assert.throws(() => reglas.elegirTipo(tipos, "Proyecto"), /No existe el tipo/);
  const sinIdea = tipos.filter((t) => t.id !== "t2");
  assert.equal(reglas.elegirTipo(sinIdea, undefined).id, "t1");
  assert.throws(() => reglas.elegirTipo([tipos[2]], undefined), /ni otro sin aprobación/);
});

prueba("color, ícono y link: se validan", () => {
  assert.equal(reglas.colorDeEntrada("#0EA5E9"), "#0ea5e9");
  assert.equal(reglas.colorDeEntrada(undefined), undefined);
  assert.throws(() => reglas.colorDeEntrada("azul"));
  assert.equal(reglas.iconoDeEntrada("capas"), "capas");
  assert.equal(reglas.iconoDeEntrada(""), null);
  assert.throws(() => reglas.iconoDeEntrada("dinosaurio"));
  assert.equal(reglas.linkDeEntrada("https://docs.google.com/x"), "https://docs.google.com/x");
  assert.equal(reglas.linkDeEntrada("http://a.co"), "http://a.co");
  assert.equal(reglas.linkDeEntrada(""), null);
  assert.equal(reglas.linkDeEntrada(undefined), undefined);
  assert.throws(() => reglas.linkDeEntrada("javascript:alert(1)"), /http/);
  assert.throws(() => reglas.linkDeEntrada("ftp://a.co"), /http/);
  assert.throws(() => reglas.linkDeEntrada("docs.google.com"), /no es un link/);
  assert.equal(reglas.textoDelLink("https://www.drive.google.com/a", null), "drive.google.com");
  assert.equal(reglas.textoDelLink("https://a.co", "Ver la hoja"), "Ver la hoja");
});

/* ------------------------------------------------------------------ tarjeta madre */

const permitidas = new Map([
  ["idea", new Set(["area"])],
  ["tarea", new Set(["idea"])],
  ["area", new Set(["area"])],
]);
const tj = (id, tipoId, tableroId = "T") => ({ id, tipoId, tableroId });

prueba("madre: solo si el tipo de la madre está permitido para el tipo de la hija", () => {
  const madres = new Map();
  assert.equal(reglas.puedeColgar(tj("i1", "idea"), tj("a1", "area"), permitidas, madres), null);
  assert.equal(reglas.puedeColgar(tj("t1", "tarea"), tj("i1", "idea"), permitidas, madres), null);
  assert.ok(reglas.puedeColgar(tj("t1", "tarea"), tj("a1", "area"), permitidas, madres), "Tarea no cuelga de Área");
  assert.ok(reglas.puedeColgar(tj("a1", "area"), tj("i1", "idea"), permitidas, madres), "Área no cuelga de Idea");
  assert.equal(reglas.puedeColgar(tj("ven", "area"), tj("mag", "area"), permitidas, madres), null, "Área dentro de Área");
  const nombres = new Map([["idea", "Idea"], ["area", "Área"], ["tarea", "Tarea"]]);
  assert.match(reglas.puedeColgar(tj("t1", "tarea"), tj("a1", "area"), permitidas, madres, nombres), /Puede colgar de: Idea/);
});

prueba("madre: mismo tablero y nunca ella misma", () => {
  assert.ok(reglas.puedeColgar(tj("i1", "idea"), tj("a1", "area", "OTRO"), permitidas, new Map()));
  const todo = new Map([["x", new Set(["x"])]]);
  assert.ok(reglas.puedeColgar(tj("a", "x"), tj("a", "x"), todo, new Map()));
});

prueba("madre: sin ciclos, ni directos ni largos", () => {
  // Con un tipo que puede colgar de sí mismo (si algún día se permite), los ciclos se cortan igual.
  const todo = new Map([["x", new Set(["x"])]]);
  const madres = new Map([
    ["a", null],
    ["b", "a"],
    ["c", "b"],
  ]);
  assert.equal(reglas.puedeColgar(tj("d", "x"), tj("c", "x"), todo, madres), null);
  assert.match(reglas.puedeColgar(tj("a", "x"), tj("c", "x"), todo, madres), /ciclo/);
  assert.match(reglas.puedeColgar(tj("b", "x"), tj("c", "x"), todo, madres), /ciclo/);
  // Un ciclo viejo en los datos no cuelga la revisión (termina).
  const roto = new Map([
    ["p", "q"],
    ["q", "p"],
  ]);
  assert.equal(reglas.puedeColgar(tj("z", "x"), tj("p", "x"), todo, roto), null);
});

prueba("cambiar el tipo de una tarjeta con hijas: se rechaza si alguna hija quedaría mal colgada", () => {
  const hijas = [
    { id: "t1", tipoId: "tarea", titulo: "Guion" },
    { id: "t2", tipoId: "tarea", titulo: "Fletes" },
  ];
  assert.equal(reglas.hijasQueQuedanMal("idea", hijas, permitidas), null);
  assert.match(reglas.hijasQueQuedanMal("area", hijas, permitidas), /2 hija\(s\).*"Guion"/);
  assert.equal(reglas.hijasQueQuedanMal("area", [], permitidas), null);
});

/* ------------------------------------------------------------------ borrar y deshacer */

prueba("borrar: Claude no borra lo APROBADO ni lo EN_CURSO; lo demás sí", () => {
  assert.ok(reglas.puedeBorrarTarjeta("MCP", "APROBADO"));
  assert.ok(reglas.puedeBorrarTarjeta("MCP", "EN_CURSO"));
  for (const estado of ["IDEA", "POR_APROBAR", "HECHO", "FALLIDO"]) {
    assert.equal(reglas.puedeBorrarTarjeta("MCP", estado), null, estado);
  }
});

prueba("deshacer un borrado: se puede, y vuelve con su estado (que nunca es APROBADO)", () => {
  const borrar = cambio({
    accion: "borrar",
    antes: { estado: "IDEA", borradoEn: null, conexiones: [{ id: "f1", origenId: "c1", destinoId: "c2" }] },
    despues: { borradoEn: T0.toISOString() },
  });
  assert.equal(reglas.puedeDeshacer(borrar, [], "IDEA"), null);
  assert.equal(reglas.puedeDeshacer(borrar, [], "POR_APROBAR"), null);
  assert.ok(reglas.puedeDeshacer(borrar, [], "APROBADO"));
  assert.ok(reglas.puedeDeshacer({ ...borrar, deshechoEn: despues(5) }, [], "IDEA"), "dos veces no");
});

prueba("después de un borrado no se deshace nada anterior de esa tarjeta (primero el borrado)", () => {
  const borrar = cambio({ id: "b1", accion: "borrar", creadoEn: despues(1000), antes: { estado: "IDEA" }, despues: {} });
  assert.ok(reglas.puedeDeshacer(cambio(), [borrar], "IDEA"), "editar previo");
  const flecha = cambio({ accion: "conectar", antes: null, despues: { conexionId: "x" } });
  assert.ok(reglas.puedeDeshacer(flecha, [borrar], "IDEA"), "flecha previa");
  // Con el borrado ya deshecho, sí.
  const deshecho = { ...borrar, deshechoEn: despues(2000) };
  assert.equal(reglas.puedeDeshacer(cambio(), [deshecho], "IDEA"), null);
});

prueba("deshacer un cambio de tipo: no devuelve un APROBADO ni lo quita", () => {
  const deTareaAIdea = cambio({
    antes: { tipoId: "tarea", estado: "APROBADO" },
    despues: { tipoId: "idea", estado: "IDEA" },
  });
  assert.ok(reglas.puedeDeshacer(deTareaAIdea, [], "IDEA"), "volvería a APROBADO");
  const deIdeaATarea = cambio({ antes: { tipoId: "idea", estado: "IDEA" }, despues: { tipoId: "tarea", estado: "POR_APROBAR" } });
  assert.equal(reglas.puedeDeshacer(deIdeaATarea, [], "POR_APROBAR"), null);
});

/* ------------------------------------------------------------------ niveles */

const arbol = [
  { id: "mag", padreId: null, titulo: "Magilus" },
  { id: "ven", padreId: "mag", titulo: "Ventas" },
  { id: "mkt", padreId: "mag", titulo: "Marketing" },
  { id: "i1", padreId: "ven", titulo: "Guion" },
  { id: "t1", padreId: "i1", titulo: "Escribir guion" },
  { id: "t2", padreId: "i1", titulo: "Probar guion", borradoEn: "2026-10-19T00:00:00Z" },
  { id: "suelta", padreId: null, titulo: "Suelta" },
  { id: "huerfana", padreId: "t2", titulo: "Cuelga de una borrada" },
];

prueba("conteo de hijas: sin las borradas, y una hija de una borrada no cuenta para nadie", () => {
  const cuenta = reglasNiveles.contarHijas(arbol);
  assert.equal(cuenta.get("mag"), 2);
  assert.equal(cuenta.get("ven"), 1);
  assert.equal(cuenta.get("i1"), 1, "t2 está borrada");
  assert.equal(cuenta.get("t2"), undefined);
  assert.equal(cuenta.get("t1"), undefined);
});

prueba("nivel raíz: tarjetas sin madre (y las de madre borrada) más sus hijas directas, nada más", () => {
  const { nivel, visibles } = reglasNiveles.tarjetasDelNivel(arbol, null);
  assert.equal(nivel, null);
  assert.deepEqual(visibles.sort(), ["huerfana", "mag", "mkt", "suelta", "ven"].sort());
});

prueba("entrar a una tarjeta: ella y solo sus hijas directas; un nivel que no existe = raíz", () => {
  assert.deepEqual(reglasNiveles.tarjetasDelNivel(arbol, "ven").visibles, ["ven", "i1"]);
  assert.deepEqual(reglasNiveles.tarjetasDelNivel(arbol, "i1").visibles, ["i1", "t1"]);
  assert.equal(reglasNiveles.tarjetasDelNivel(arbol, "t2").nivel, null, "borrada");
  assert.equal(reglasNiveles.tarjetasDelNivel(arbol, "nada").nivel, null);
});

prueba("migas: de la raíz al nivel; y el link de una tarjeta abre el nivel de su madre", () => {
  assert.deepEqual(
    reglasNiveles.migasDelNivel(arbol, "i1").map((m) => m.titulo),
    ["Magilus", "Ventas", "Guion"],
  );
  assert.deepEqual(reglasNiveles.migasDelNivel(arbol, null), []);
  assert.equal(reglasNiveles.nivelDeLaTarjeta(arbol, "t1"), "i1");
  assert.equal(reglasNiveles.nivelDeLaTarjeta(arbol, "mag"), null);
  assert.equal(reglasNiveles.nivelDeLaTarjeta(arbol, "huerfana"), null, "madre borrada");
});

prueba("grupos radiales: raíz = cada tarjeta sin madre con sus hijas directas (las nietas no); nivel = ella y sus hijas", () => {
  const raiz = reglasNiveles.gruposDelNivel(arbol, null);
  assert.equal(raiz.nivel, null);
  assert.deepEqual(raiz.grupos, [
    { centro: "mag", hijas: ["ven", "mkt"] },
    { centro: "suelta", hijas: [] },
    { centro: "huerfana", hijas: [] },
  ]);
  assert.deepEqual(reglasNiveles.gruposDelNivel(arbol, "ven").grupos, [{ centro: "ven", hijas: ["i1"] }]);
});

const conTipo = [
  { id: "mag", padreId: null, titulo: "Magilus", tipoId: "area" },
  { id: "ven", padreId: "mag", titulo: "Ventas", tipoId: "area" },
  { id: "mkt", padreId: "mag", titulo: "Marketing", tipoId: "area" },
  { id: "i1", padreId: "ven", titulo: "Guion", tipoId: "idea" },
  { id: "t1", padreId: "i1", titulo: "Escribir", tipoId: "tarea" },
  { id: "i2", padreId: "mag", titulo: "Idea general", tipoId: "idea" },
  { id: "borrada", padreId: "ven", titulo: "x", tipoId: "idea", borradoEn: "2026-10-19T00:00:00Z" },
  { id: "s1", padreId: null, titulo: "Suelta", tipoId: "tarea" },
];
const esArea = (t) => t.tipoId === "area";

prueba("lista por área: cada área con sus descendientes (con sangría), sueltas al final, sin borradas", () => {
  const { areas, sueltas } = reglasNiveles.agruparPorArea(conTipo, esArea);
  assert.deepEqual(
    areas.map((g) => [g.ruta.join(" › "), g.tarjetas.map((f) => `${f.tarjeta.id}:${f.profundidad}`)]),
    [
      ["Magilus", ["i2:0"]],
      ["Magilus › Ventas", ["i1:0", "t1:1"]],
      ["Magilus › Marketing", []],
    ],
  );
  assert.deepEqual(sueltas.map((f) => f.tarjeta.id), ["s1"]);
});

prueba("lista por área dentro de un nivel: solo lo que cuelga de ese nivel, con su área de encabezado", () => {
  const enVentas = reglasNiveles.agruparPorArea(conTipo, esArea, "ven");
  assert.deepEqual(enVentas.areas.map((g) => g.ruta.join(" › ")), ["Magilus › Ventas"]);
  assert.deepEqual(enVentas.areas[0].tarjetas.map((f) => f.tarjeta.id), ["i1", "t1"]);
  assert.deepEqual(enVentas.sueltas, []);
  const enGuion = reglasNiveles.agruparPorArea(conTipo, esArea, "i1");
  assert.deepEqual(enGuion.areas.map((g) => [g.area.id, g.ruta.join(" › ")]), [["ven", "Magilus › Ventas"]]);
  assert.deepEqual(enGuion.areas[0].tarjetas.map((f) => f.tarjeta.id), ["i1", "t1"]);
});

/* ------------------------------------------------------------------ mapa radial */

// Rectángulos de tarjeta (esquina arriba-izquierda) que se tocan, sin margen de aire.
const encima = (p, q) => sePisan(p, q, 0);
function sinSolapes(posiciones, nombre) {
  // Todas contra todas, sin aire: ninguna encima de otra.
  const todas = [...posiciones.entries()];
  for (let i = 0; i < todas.length; i += 1) {
    for (let j = i + 1; j < todas.length; j += 1) {
      assert.ok(!encima(todas[i][1], todas[j][1]), `${nombre}: ${todas[i][0]} queda encima de ${todas[j][0]}`);
    }
  }
}

// Las posiciones ya son el centro de cada etiqueta (nodeOrigin [0.5, 0.5]).
const centroDe = (p) => p;

prueba("radial: el centro en el medio y sus hijas alrededor, todas a la misma distancia si caben en un anillo", () => {
  const pos = disponerRadial([{ centro: "c", hijas: ["a", "b", "d", "e", "f"] }]);
  const c = centroDe(pos.get("c"));
  const distancias = ["a", "b", "d", "e", "f"].map((h) => {
    const q = centroDe(pos.get(h));
    return Math.hypot(q.x - c.x, q.y - c.y);
  });
  for (const d of distancias) assert.ok(Math.abs(d - RADIO_INICIAL) <= 2, `distancia ${d}`);
  // Alrededor de verdad: hay hijas arriba, abajo, a la izquierda y a la derecha del centro.
  const qs = ["a", "b", "d", "e", "f"].map((h) => centroDe(pos.get(h)));
  assert.ok(qs.some((q) => q.y < c.y - 100) && qs.some((q) => q.y > c.y + 100));
  assert.ok(qs.some((q) => q.x < c.x - 100) && qs.some((q) => q.x > c.x + 100));
  sinSolapes(pos, "un anillo");
});

prueba("radial: determinista y sin solapes con muchas hijas, varios grupos y sueltas", () => {
  for (const cantidad of [0, 1, 6, 7, 13, 40, 120]) {
    const grupos = [
      { centro: "raiz", hijas: Array.from({ length: cantidad }, (_, i) => `h${i}`) },
      { centro: "otra", hijas: Array.from({ length: Math.ceil(cantidad / 3) }, (_, i) => `o${i}`) },
      ...Array.from({ length: Math.ceil(cantidad / 4) }, (_, i) => ({ centro: `s${i}`, hijas: [] })),
    ];
    const uno = disponerRadial(grupos);
    const dos = disponerRadial(grupos);
    assert.deepEqual([...uno.entries()], [...dos.entries()]);
    const total = grupos.reduce((n, g) => n + 1 + g.hijas.length, 0);
    assert.equal(uno.size, total);
    sinSolapes(uno, `radial de ${cantidad}`);
  }
});

prueba("radial: las que ya tenían lugar no se mueven y las nuevas no caen encima", () => {
  const grupos = [{ centro: "c", hijas: ["a", "b", "d"] }];
  const antes = disponerRadial(grupos);
  // El dueño arrastró "a" justo donde iría la próxima hija.
  const previas = new Map(antes);
  const masGrupos = [{ centro: "c", hijas: ["a", "b", "d", "n1", "n2", "n3", "n4", "n5"] }];
  const lugarDeN1 = disponerRadial(masGrupos).get("n1");
  previas.set("a", { ...lugarDeN1 });
  const despues = disponerRadial(masGrupos, previas);
  for (const [id, p] of previas) assert.deepEqual(despues.get(id), p, `${id} no se mueve`);
  sinSolapes(despues, "con fijas");
});

prueba("radial: agregar hijas de a una (como el refresco de 5 s) nunca las encima ni mueve las de antes", () => {
  let previas = new Map();
  const hijas = [];
  for (let i = 0; i < 30; i += 1) {
    hijas.push(`k${i}`);
    const pos = disponerRadial([{ centro: "c", hijas: [...hijas] }], previas);
    for (const [viejo, p] of previas) assert.deepEqual(pos.get(viejo), p);
    sinSolapes(pos, `paso ${i}`);
    previas = pos;
  }
});

prueba("radial: una tarjeta repetida en dos grupos se dibuja una sola vez", () => {
  const pos = disponerRadial([
    { centro: "a", hijas: ["x"] },
    { centro: "b", hijas: ["x", "y"] },
  ]);
  assert.equal(pos.size, 4);
  sinSolapes(pos, "repetida");
});

prueba("radial: hasta 16 hijas van en UN solo anillo, ángulos iguales empezando arriba, sin tocar el centro", () => {
  for (const cantidad of [1, 2, 5, 8, 12, 16]) {
    const hijas = Array.from({ length: cantidad }, (_, i) => `h${i}`);
    const pos = disponerRadial([{ centro: "c", hijas }]);
    const c = pos.get("c");
    const radios = hijas.map((h) => Math.hypot(pos.get(h).x - c.x, pos.get(h).y - c.y));
    for (const r of radios) assert.ok(Math.abs(r - radios[0]) <= 2, `${cantidad}: un solo radio`);
    // La primera arriba del centro.
    assert.ok(Math.abs(pos.get("h0").x - c.x) <= 1 && pos.get("h0").y < c.y, `${cantidad}: empieza arriba`);
    // Ángulos iguales.
    const angulos = hijas.map((h) => Math.atan2(pos.get(h).y - c.y, pos.get(h).x - c.x));
    for (let i = 1; i < cantidad; i += 1) {
      const paso = (angulos[i] - angulos[i - 1] + 4 * Math.PI) % (2 * Math.PI);
      assert.ok(Math.abs(paso - (2 * Math.PI) / cantidad) < 0.02, `${cantidad}: paso parejo`);
    }
    // Ninguna toca la etiqueta del centro (que es más grande).
    for (const h of hijas) {
      const q = pos.get(h);
      const toca =
        Math.abs(q.x - c.x) < (ANCHO_CENTRO + ANCHO_TARJETA) / 2 + SEPARACION &&
        Math.abs(q.y - c.y) < (ALTO_CENTRO + ALTO_TARJETA) / 2 + SEPARACION;
      assert.ok(!toca, `${cantidad}: ${h} toca el centro`);
    }
    sinSolapes(pos, `anillo de ${cantidad}`);
  }
  // El radio crece con la cantidad.
  const radioCon = (n) => {
    const pos = disponerRadial([{ centro: "c", hijas: Array.from({ length: n }, (_, i) => `h${i}`) }]);
    return Math.hypot(pos.get("h0").x - pos.get("c").x, pos.get("h0").y - pos.get("c").y);
  };
  assert.ok(radioCon(16) > radioCon(8));
});

prueba("radial: más de 16 hijas = dos anillos, el de afuera intercalado y sin solapes", () => {
  const cantidad = MAX_PRIMER_ANILLO + 4;
  const hijas = Array.from({ length: cantidad }, (_, i) => `h${i}`);
  const pos = disponerRadial([{ centro: "c", hijas }]);
  const c = pos.get("c");
  const radios = [...new Set(hijas.map((h) => Math.round(Math.hypot(pos.get(h).x - c.x, pos.get(h).y - c.y) / 5)))];
  assert.equal(radios.length, 2, "dos radios");
  sinSolapes(pos, "dos anillos");
});

/* ------------------------------------------------------------------ contadores */

const tiposConteo = [
  { id: "area", usaEstados: false, requiereAprobacion: false },
  { id: "tarea", usaEstados: true, requiereAprobacion: true },
  { id: "nota", usaEstados: true, requiereAprobacion: false },
];
const arbolConteo = [
  { id: "mag", padreId: null, tipoId: "area", estado: "IDEA" },
  { id: "ven", padreId: "mag", tipoId: "area", estado: "IDEA" },
  { id: "mkt", padreId: "mag", tipoId: "area", estado: "IDEA" },
  { id: "t1", padreId: "ven", tipoId: "tarea", estado: "POR_APROBAR" },
  { id: "t2", padreId: "t1", tipoId: "tarea", estado: "FALLIDO" },
  { id: "t3", padreId: "t1", tipoId: "tarea", estado: "EN_CURSO" },
  { id: "t4", padreId: "ven", tipoId: "tarea", estado: "IDEA" },
  { id: "t5", padreId: "ven", tipoId: "tarea", estado: "APROBADO" },
  { id: "t6", padreId: "ven", tipoId: "tarea", estado: "HECHO" },
  { id: "n1", padreId: "ven", tipoId: "nota", estado: "POR_APROBAR" },
  { id: "x", padreId: "ven", tipoId: "tarea", estado: "FALLIDO", borradoEn: "2026-10-19T00:00:00Z" },
  { id: "bajoX", padreId: "x", tipoId: "tarea", estado: "FALLIDO" },
  { id: "suelta", padreId: null, tipoId: "tarea", estado: "HECHO" },
];

prueba("contadores: recursivos, sin borradas, sin carpetas; POR_APROBAR solo de tipos con aprobación", () => {
  const c = reglasNiveles.contadoresRecursivos(arbolConteo, tiposConteo);
  assert.deepEqual(c.get("t1"), { teToca: 2, enCurso: 1, siguen: 0, hecho: 0 });
  // n1 es POR_APROBAR de un tipo sin aprobación: no le toca al dueño, sigue.
  assert.deepEqual(c.get("ven"), { teToca: 2, enCurso: 1, siguen: 3, hecho: 1 });
  assert.deepEqual(c.get("mag"), c.get("ven"));
  assert.deepEqual(c.get("mkt"), { teToca: 0, enCurso: 0, siguen: 0, hecho: 0 });
  assert.equal(c.get("x"), undefined, "borrada");
  // bajoX cuelga de una borrada: queda suelta en la raíz y no suma a Ventas.
  assert.deepEqual(c.get("bajoX"), { teToca: 1, enCurso: 0, siguen: 0, hecho: 0 });
  assert.deepEqual(reglasNiveles.contadoresDelNivel(arbolConteo, tiposConteo, "ven"), c.get("ven"));
  assert.deepEqual(reglasNiveles.contadoresDelNivel(arbolConteo, tiposConteo, null), {
    teToca: 3,
    enCurso: 1,
    siguen: 3,
    hecho: 2,
  });
});

prueba("filtro por grupos: atenúa la que no tiene nada en los grupos activos; 'sin tareas' nunca", () => {
  const activos = new Set(["teToca", "enCurso", "siguen"]);
  const cero = { teToca: 0, enCurso: 0, siguen: 0, hecho: 0 };
  assert.equal(reglasNiveles.atenuadaPorGrupos({ ...cero, hecho: 3 }, activos), true);
  assert.equal(reglasNiveles.atenuadaPorGrupos({ ...cero, hecho: 3, siguen: 1 }, activos), false);
  assert.equal(reglasNiveles.atenuadaPorGrupos(cero, activos), false);
  assert.equal(reglasNiveles.atenuadaPorGrupos({ ...cero, hecho: 3 }, new Set([...activos, "hecho"])), false);
});

/* ================================================================== FASE 2: el trabajador */

const FASE2 = ["PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "SUBIENDO", "ERROR"];

prueba("estados: los 6 nuevos existen, FALLIDO sigue, y Claude no tiene ninguno de los nuevos ni APROBADO", () => {
  assert.deepEqual([...reglas.ESTADOS_TARJETA], ["IDEA", "POR_APROBAR", "APROBADO", "EN_CURSO", "HECHO", "FALLIDO", ...FASE2]);
  assert.deepEqual([...reglas.ESTADOS_SIN_APROBAR], ["IDEA", "POR_APROBAR", "EN_CURSO", "HECHO", "FALLIDO"]);
  for (const estado of reglas.ESTADOS_TARJETA) assert.ok(reglas.NOMBRE_DEL_ESTADO[estado], estado);
});

prueba("cambiar_estado nunca pone un estado del trabajador, ni APROBADO, desde ningún estado, con o sin repo", () => {
  for (const de of reglas.ESTADOS_TARJETA) {
    for (const a of [...FASE2, "APROBADO"]) {
      for (const conRepo of [true, false]) {
        assert.ok(reglas.puedeCambiarEstado(de, a, true, true, conRepo), `${de} -> ${a} (repo ${conRepo})`);
        assert.ok(reglas.puedeCambiarEstado(de, a, false, true, conRepo), `${de} -> ${a} sin aprobación`);
      }
    }
  }
  assert.match(reglas.puedeCambiarEstado("PLAN_LISTO", "PLAN_APROBADO", true, true, true), /solo el trabajador/);
});

prueba("con repo, EN_CURSO y HECHO los pone solo el trabajador; sin repo sigue la fase 1 (a mano)", () => {
  assert.ok(reglas.puedeCambiarEstado("APROBADO", "EN_CURSO", true, true, true));
  assert.ok(reglas.puedeCambiarEstado("APROBADO", "HECHO", true, true, true));
  assert.equal(reglas.puedeCambiarEstado("APROBADO", "EN_CURSO", true, true, false), null);
  assert.equal(reglas.puedeCambiarEstado("EN_CURSO", "HECHO", true, true, false), null);
  assert.equal(reglas.puedeCambiarEstado("EN_CURSO", "FALLIDO", true, true, false), null);
});

prueba("mientras el trabajador la tiene (PLANEANDO, EN_CURSO con repo, SUBIENDO) nadie le mueve el estado ni la edita", () => {
  for (const de of ["PLANEANDO", "SUBIENDO"]) {
    for (const a of reglas.ESTADOS_SIN_APROBAR) assert.ok(reglas.puedeCambiarEstado(de, a, true, true, true), `${de} -> ${a}`);
    assert.ok(reglas.puedeEditarTarjeta(de, true), de);
  }
  for (const a of reglas.ESTADOS_SIN_APROBAR) assert.ok(reglas.puedeCambiarEstado("EN_CURSO", a, true, true, true), `EN_CURSO -> ${a}`);
  assert.ok(reglas.puedeEditarTarjeta("EN_CURSO", true));
  assert.equal(reglas.puedeEditarTarjeta("EN_CURSO", false), null, "EN_CURSO sin repo es a mano");
  for (const estado of ["IDEA", "POR_APROBAR", "APROBADO", "PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "ERROR", "HECHO"]) {
    assert.equal(reglas.puedeEditarTarjeta(estado, true), null, estado);
  }
});

prueba("desde lo que dejó el trabajador, Claude puede abandonarla (FALLIDO) o volverla a pedir (POR_APROBAR / IDEA)", () => {
  for (const de of ["PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "ERROR"]) {
    assert.equal(reglas.puedeCambiarEstado(de, "FALLIDO", true, true, true), null, de);
    assert.equal(reglas.puedeCambiarEstado(de, "POR_APROBAR", true, true, true), null, de);
    assert.equal(reglas.puedeCambiarEstado(de, "IDEA", true, true, true), null, de);
  }
  assert.ok(reglas.puedeCambiarEstado("IDEA", "FALLIDO", true, true, true));
  assert.ok(reglas.puedeCambiarEstado("POR_APROBAR", "FALLIDO", true, true, false));
});

prueba("tipo sin aprobación: ningún estado del trabajador le corresponde", () => {
  for (const estado of FASE2) assert.ok(reglas.estadoPermitidoParaTipo(estado, false), estado);
  for (const estado of FASE2) assert.equal(reglas.estadoPermitidoParaTipo(estado, true), null, estado);
});

prueba("editar algo aprobado o que dejó el trabajador lo devuelve a POR_APROBAR (Claude y trabajador; la pantalla no)", () => {
  for (const estado of ["APROBADO", "PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "ERROR"]) {
    assert.equal(reglas.estadoTrasEditar("MCP", estado), "POR_APROBAR", estado);
    assert.equal(reglas.estadoTrasEditar("PANTALLA", estado), estado, estado);
  }
  assert.equal(reglas.estadoTrasEditar("MCP", "HECHO"), "HECHO");
});

prueba("borrar: Claude no borra nada aprobado ni nada del trabajador", () => {
  for (const estado of ["APROBADO", "EN_CURSO", ...FASE2]) assert.ok(reglas.puedeBorrarTarjeta("MCP", estado), estado);
  assert.equal(reglas.puedeBorrarTarjeta("PANTALLA", "ERROR"), null);
});

prueba("deshacer: lo del trabajador y cualquier aprobación (también por voz) no se deshacen; no deja ni quita estados aprobados", () => {
  assert.match(reglas.puedeDeshacer(cambio({ origen: "TRABAJADOR", accion: "estado" }), [], "PLAN_LISTO"), /trabajador/);
  assert.match(
    reglas.puedeDeshacer(cambio({ origen: "MCP", accion: "aprobar", antes: { estado: "POR_REVISAR" } }), [], "SUBIENDO"),
    /aprobación/,
  );
  for (const estado of FASE2) {
    const editar = cambio({ antes: { titulo: "V", estado }, despues: { titulo: "N", estado: "POR_APROBAR" } });
    assert.ok(reglas.puedeDeshacer(editar, [], "POR_APROBAR"), `dejaría ${estado}`);
    const pedir = cambio({ accion: "estado", antes: { estado: "IDEA" }, despues: { estado: "POR_APROBAR" } });
    assert.ok(reglas.puedeDeshacer(pedir, [], estado), `quitaría ${estado}`);
    assert.ok(reglas.puedeDeshacer(cambio({ accion: "crear", antes: null, despues: {} }), [], estado), `crear con ${estado}`);
  }
  // Lo de siempre sigue: deshacer un editar sin estados aprobados de por medio.
  assert.equal(reglas.puedeDeshacer(cambio(), [], "IDEA"), null);
});

prueba("transiciones del trabajador: cada acción solo desde su estado", () => {
  const esperado = {
    latido: ["PLANEANDO", "EN_CURSO", "SUBIENDO"],
    plan: ["PLANEANDO"],
    resultado: ["EN_CURSO"],
    subida: ["SUBIENDO"],
    error: ["PLANEANDO", "EN_CURSO", "SUBIENDO"],
  };
  for (const [accion, validos] of Object.entries(esperado)) {
    for (const estado of reglas.ESTADOS_TARJETA) {
      const veredicto = trabajo.puedeElTrabajador(accion, estado);
      assert.equal(veredicto === null, validos.includes(estado), `${accion} desde ${estado}`);
    }
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(trabajo.TRANSICIONES_DEL_TRABAJADOR).map(([accion, regla]) => [accion, regla.a])),
    { latido: null, plan: "PLAN_LISTO", resultado: "POR_REVISAR", subida: "HECHO", error: "ERROR" },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(trabajo.AL_TOMAR).map(([de, regla]) => [de, [regla.a, regla.etapa]])),
    { APROBADO: ["PLANEANDO", "planear"], PLAN_APROBADO: ["EN_CURSO", "construir"], SUBIENDO: ["SUBIENDO", "subir"] },
  );
});

prueba("candado: cada latido da 5 min más, nunca más allá del tope de la etapa (20 / 90 / 30 min)", () => {
  assert.deepEqual({ ...trabajo.MINUTOS_POR_ETAPA }, { planear: 20, construir: 90, subir: 30 });
  const inicio = new Date("2026-10-20T15:00:00Z");
  const min = (n) => new Date(inicio.getTime() + n * 60_000);
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, inicio).toISOString(), min(5).toISOString());
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, min(40)).toISOString(), min(45).toISOString());
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, min(88)).toISOString(), min(90).toISOString(), "tope");
  assert.equal(trabajo.vencimientoDelCandado("planear", inicio, min(19)).toISOString(), min(20).toISOString(), "tope plan");
  assert.equal(trabajo.vencimientoDelCandado("subir", inicio, min(29)).toISOString(), min(30).toISOString(), "tope subir");
});

prueba("texto de confirmación: ≥ 8 caracteres, con 'sí' y 'apruebo' (sin importar tildes ni mayúsculas); 'no apruebo' no", () => {
  for (const bueno of ["sí, apruebo", "Si apruebo", "SÍ APRUEBO TODO", "sí, lo apruebo", "Apruebo, sí."]) {
    assert.equal(trabajo.textoDeConfirmacionValido(bueno), null, bueno);
  }
  for (const malo of [undefined, "", "sí", "apruebo", "dale, apruebo", "sí, dale", "decisión apruebo", "si no apruebo", "sí,apruebx", 42]) {
    assert.ok(trabajo.textoDeConfirmacionValido(malo), String(malo));
  }
});

const dueno = { esDueno: true, esAdminPlataforma: false, aprobador: null };
const nadie = { esDueno: false, esAdminPlataforma: false, aprobador: null };
const admin = { esDueno: false, esAdminPlataforma: true, aprobador: null };
const desarrollo = { esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "DESARROLLO", puedeSubir: true } };
const todo = { esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "TODO", puedeSubir: true } };
const pedido = (extra) => ({
  momento: "tarea",
  via: "voz",
  origen: "MCP",
  estado: "POR_APROBAR",
  requiereAprobacion: true,
  usaEstados: true,
  repo: "aizencrm",
  zonaProtegida: [],
  tienePlan: false,
  resultadoPaso: false,
  textoConfirmacion: "sí, apruebo",
  persona: dueno,
  ...extra,
});
const aprobar = (extra) => trabajo.puedeAprobarMomento(pedido(extra));
const destino = (extra) => {
  const veredicto = aprobar(extra);
  return "error" in veredicto ? `ERROR: ${veredicto.error}` : veredicto.a;
};

prueba("aprobar_tarjeta por voz: el dueño, con texto válido, desde el estado de cada momento", () => {
  assert.equal(destino({}), "APROBADO");
  assert.equal(destino({ momento: "plan", estado: "PLAN_LISTO", tienePlan: true }), "PLAN_APROBADO");
  assert.equal(destino({ momento: "subir", estado: "POR_REVISAR", resultadoPaso: true }), "SUBIENDO");
  // Reintentar desde ERROR.
  assert.equal(destino({ estado: "ERROR" }), "APROBADO");
  assert.equal(destino({ momento: "plan", estado: "ERROR", tienePlan: true }), "PLAN_APROBADO");
});

prueba("aprobar_tarjeta: el estado tiene que corresponder al momento", () => {
  for (const estado of reglas.ESTADOS_TARJETA.filter((e) => e !== "POR_APROBAR" && e !== "ERROR")) {
    assert.match(destino({ estado }), /^ERROR/, `tarea desde ${estado}`);
  }
  for (const estado of reglas.ESTADOS_TARJETA.filter((e) => e !== "PLAN_LISTO" && e !== "ERROR")) {
    assert.match(destino({ momento: "plan", estado, tienePlan: true }), /^ERROR/, `plan desde ${estado}`);
  }
  for (const estado of reglas.ESTADOS_TARJETA.filter((e) => e !== "POR_REVISAR")) {
    assert.match(destino({ momento: "subir", estado, resultadoPaso: true }), /^ERROR/, `subir desde ${estado}`);
  }
  assert.match(destino({ momento: "plan", estado: "PLAN_LISTO", tienePlan: false }), /no tiene plan/);
  assert.match(destino({ momento: "subir", estado: "POR_REVISAR", resultadoPaso: false }), /paso/);
  assert.match(destino({ momento: "plan", estado: "PLAN_LISTO", tienePlan: true, repo: null }), /no tiene repo/);
  assert.match(destino({ momento: "jefe" }), /Momento desconocido/);
  assert.match(destino({ requiereAprobacion: false }), /no pide aprobación/);
  assert.match(destino({ usaEstados: false }), /no pide aprobación/);
});

prueba("aprobar_tarjeta: texto obligatorio y válido por voz; zona protegida = solo pantalla", () => {
  assert.match(destino({ textoConfirmacion: undefined }), /texto de confirmación/);
  assert.match(destino({ textoConfirmacion: "ok dale" }), /texto de confirmación/);
  assert.match(destino({ textoConfirmacion: "no apruebo, sí" }), /no apruebo/);
  assert.match(destino({ zonaProtegida: ["BOT_VENTAS"] }), /solo en la pantalla/);
  // En la pantalla, la de zona protegida la aprueba el dueño (sin texto) y nadie más.
  assert.equal(destino({ via: "pantalla", origen: "PANTALLA", zonaProtegida: ["LIBRO_V3"], textoConfirmacion: undefined }), "APROBADO");
  assert.match(destino({ via: "pantalla", origen: "PANTALLA", zonaProtegida: ["META_ADS"], persona: todo }), /solo el dueño/);
  assert.match(destino({ via: "pantalla", origen: "PANTALLA", zonaProtegida: ["META_ADS"], persona: admin }), /solo el dueño/);
});

prueba("aprobar_tarjeta: la vía tiene que ser la del origen; el trabajador nunca aprueba", () => {
  assert.match(destino({ via: "pantalla", origen: "MCP" }), /via voz/);
  assert.match(destino({ via: "voz", origen: "PANTALLA" }), /via voz/);
  assert.match(destino({ origen: "TRABAJADOR" }), /nunca aprueba/);
  assert.match(destino({ via: "pantalla", origen: "TRABAJADOR" }), /nunca aprueba/);
});

prueba("quién aprueba: dueño todo; DESARROLLO solo repos de desarrollo; TODO cualquiera; ADMIN solo en pantalla; nadie más", () => {
  assert.equal(destino({ persona: desarrollo }), "APROBADO");
  assert.equal(destino({ persona: desarrollo, repo: "gestion" }), "APROBADO");
  assert.match(destino({ persona: desarrollo, repo: null }), /DESARROLLO/);
  assert.equal(destino({ persona: todo, repo: null }), "APROBADO");
  assert.match(destino({ persona: nadie }), /No puedes aprobar/);
  assert.match(destino({ persona: admin }), /No puedes aprobar/, "ADMIN por voz no");
  assert.equal(destino({ persona: admin, via: "pantalla", origen: "PANTALLA" }), "APROBADO");
  assert.equal(destino({ persona: desarrollo, momento: "plan", estado: "PLAN_LISTO", tienePlan: true }), "PLAN_APROBADO");
});

prueba("el sí final (subir) es SOLO del dueño, aunque el aprobador tenga puedeSubir (SI_FINAL_SOLO_DUENO)", () => {
  assert.equal(trabajo.SI_FINAL_SOLO_DUENO, true);
  const subir = { momento: "subir", estado: "POR_REVISAR", resultadoPaso: true };
  assert.equal(destino({ ...subir }), "SUBIENDO");
  assert.equal(destino({ ...subir, via: "pantalla", origen: "PANTALLA" }), "SUBIENDO");
  for (const persona of [todo, desarrollo, admin, nadie]) {
    assert.match(destino({ ...subir, persona }), /solo el dueño/);
    assert.match(destino({ ...subir, persona, via: "pantalla", origen: "PANTALLA" }), /solo el dueño/);
  }
});

prueba("lo que queda en el historial de una aprobación: quién, momento, vía, texto y 'aprobado por voz'", () => {
  const registro = trabajo.registroDeAprobacion({
    estado: "APROBADO",
    momento: "tarea",
    via: "voz",
    quienNombre: "Alexander",
    userId: "u1",
    textoConfirmacion: "sí, apruebo",
  });
  assert.deepEqual(registro, {
    estado: "APROBADO",
    momento: "tarea",
    via: "voz",
    quienNombre: "Alexander",
    userId: "u1",
    textoConfirmacion: "sí, apruebo",
    como: "aprobado por voz",
  });
  assert.equal(trabajo.registroDeAprobacion({ ...registro, via: "pantalla" }).como, "aprobado en pantalla");
});

prueba("zona protegida: el MCP y el trabajador la ponen pero no la quitan; quitarla solo el dueño en la pantalla", () => {
  assert.equal(trabajo.puedeCambiarZonas("MCP", [], ["BOT_VENTAS"], false), null);
  assert.equal(trabajo.puedeCambiarZonas("MCP", ["BOT_VENTAS"], ["BOT_VENTAS", "LIBRO_V3"], true), null);
  assert.match(trabajo.puedeCambiarZonas("MCP", ["BOT_VENTAS"], [], true), /solo el dueño/);
  assert.match(trabajo.puedeCambiarZonas("TRABAJADOR", ["BOT_VENTAS"], [], true), /solo el dueño/);
  assert.match(trabajo.puedeCambiarZonas("PANTALLA", ["META_ADS"], [], false), /solo el dueño/);
  assert.equal(trabajo.puedeCambiarZonas("PANTALLA", ["META_ADS"], [], true), null);
  assert.deepEqual(trabajo.unirZonas(["LIBRO_V3"], ["META_ADS", "LIBRO_V3"]), ["META_ADS", "LIBRO_V3"]);
  assert.deepEqual(trabajo.zonasDeEntrada(["bot_ventas", " META_ADS ", "BOT_VENTAS"]), ["META_ADS", "BOT_VENTAS"]);
  assert.deepEqual(trabajo.zonasDeEntrada(null), []);
  assert.equal(trabajo.zonasDeEntrada(undefined), undefined);
  assert.throws(() => trabajo.zonasDeEntrada(["WHATSAPP"]), /no existe/);
});

prueba("repo: solo de la lista fija (gestion, aizencrm); vacío lo quita", () => {
  assert.deepEqual([...trabajo.REPOS_DEL_TRABAJADOR], ["gestion", "aizencrm"]);
  assert.equal(trabajo.repoDeEntrada("AizenCRM"), "aizencrm");
  assert.equal(trabajo.repoDeEntrada("Gestión"), "gestion");
  assert.equal(trabajo.repoDeEntrada(""), null);
  assert.equal(trabajo.repoDeEntrada(undefined), undefined);
  assert.throws(() => trabajo.repoDeEntrada("netmagi"), /no existe/);
});

prueba("resultado del trabajador: resumen obligatorio, paso solo si es true, link solo https", () => {
  const limpio = trabajo.resultadoDeEntrada({ resumen: " Listo ", paso: "true", linkRama: "http://x.co", rama: "tablero/a" });
  assert.equal(limpio.resumen, "Listo");
  assert.equal(limpio.paso, false);
  assert.equal(limpio.linkRama, null);
  assert.equal(trabajo.resultadoDeEntrada({ resumen: "x", paso: true, linkRama: "https://github.com/a/b/tree/c" }).linkRama, "https://github.com/a/b/tree/c");
  assert.throws(() => trabajo.resultadoDeEntrada({ paso: true }), /resumen/);
  assert.throws(() => trabajo.planDeEntrada("  "), /plan/);
  assert.equal(trabajo.planDeEntrada("a\r\nb"), "a\nb");
});

prueba("contadores nuevos: te toca = POR_APROBAR + PLAN_LISTO + POR_REVISAR + ERROR + FALLIDO; en curso = PLANEANDO + PLAN_APROBADO + EN_CURSO + SUBIENDO; siguen = IDEA + APROBADO", () => {
  const tipos = new Map([["tarea", { id: "tarea", usaEstados: true, requiereAprobacion: true }]]);
  const grupo = (estado) => reglasNiveles.grupoDeLaTarjeta({ estado, tipoId: "tarea" }, tipos);
  assert.deepEqual(
    Object.fromEntries(reglas.ESTADOS_TARJETA.map((estado) => [estado, grupo(estado)])),
    {
      IDEA: "siguen",
      POR_APROBAR: "teToca",
      APROBADO: "siguen",
      EN_CURSO: "enCurso",
      HECHO: "hecho",
      FALLIDO: "teToca",
      PLANEANDO: "enCurso",
      PLAN_LISTO: "teToca",
      PLAN_APROBADO: "enCurso",
      POR_REVISAR: "teToca",
      SUBIENDO: "enCurso",
      ERROR: "teToca",
    },
  );
  const arbol = [
    { id: "a", padreId: null, tipoId: "area", estado: "IDEA" },
    ...FASE2.map((estado, i) => ({ id: `t${i}`, padreId: "a", tipoId: "tarea", estado })),
  ];
  const c = reglasNiveles.contadoresRecursivos(arbol, [
    { id: "area", usaEstados: false, requiereAprobacion: false },
    { id: "tarea", usaEstados: true, requiereAprobacion: true },
  ]);
  assert.deepEqual(c.get("a"), { teToca: 3, enCurso: 3, siguen: 0, hecho: 0 });
});

console.log(`\n${pruebas} pruebas, todas bien`);
