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
const modelosCoordinador = cargar("src/features/tableros-inteligentes/services/modelos-del-coordinador.ts");
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

prueba("contadores del inicio: el conteo agrupado suma lo mismo que los chips en la raíz", () => {
  const vivas = arbolConteo.filter((tarjeta) => !tarjeta.borradoEn);
  const filas = [];
  for (const tarjeta of vivas) {
    const fila = filas.find((f) => f.estado === tarjeta.estado && f.tipoId === tarjeta.tipoId);
    if (fila) fila.cantidad += 1;
    else filas.push({ estado: tarjeta.estado, tipoId: tarjeta.tipoId, cantidad: 1 });
  }
  assert.deepEqual(
    reglasNiveles.contadoresDelConteo(filas, tiposConteo),
    reglasNiveles.contadoresDelNivel(arbolConteo, tiposConteo, null),
  );
  assert.deepEqual(reglasNiveles.contadoresDelConteo([], tiposConteo), { teToca: 0, enCurso: 0, siguen: 0, hecho: 0 });
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
  assert.match(reglas.puedeCambiarEstado("PLAN_LISTO", "PLAN_APROBADO", true, true, true), /solo el Coordinador/);
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

prueba("borrar: sin la confirmación del dueño, Claude no borra nada aprobado ni nada del trabajador", () => {
  for (const estado of ["APROBADO", "EN_CURSO", ...FASE2]) assert.ok(reglas.puedeBorrarTarjeta("MCP", estado), estado);
  assert.equal(reglas.puedeBorrarTarjeta("PANTALLA", "ERROR"), null);
});

const voz = (texto, cuentaOk = true) => ({
  problemaDelTexto: trabajo.textoDeConfirmacionParaBorrar(texto),
  problemaDeLaCuenta: cuentaOk ? null : "La conexión llegó con la cuenta Emanuel: no es la dueña.",
});

prueba("borrar por voz: PLAN_LISTO y ERROR se borran con el dueño y 'sí, bórrala'", () => {
  for (const estado of ["PLAN_LISTO", "ERROR"]) {
    assert.equal(reglas.puedeBorrarTarjeta("MCP", estado, [], voz("sí, bórrala")), null, estado);
    assert.match(reglas.puedeBorrarTarjeta("MCP", estado), /sí, bórrala/, `${estado} sin texto`);
    assert.ok(reglas.puedeBorrarTarjeta("MCP", estado, [], voz("no la borres, sí")), `${estado} no la borres`);
    assert.ok(reglas.puedeBorrarTarjeta("MCP", estado, [], voz("sí, dale")), `${estado} sin borrar`);
    assert.match(reglas.puedeBorrarTarjeta("MCP", estado, [], voz("sí, bórrala", false)), /dueño.*Emanuel/, `${estado} otra cuenta`);
  }
});

prueba("borrar por voz: lo que tiene el trabajador, lo aprobado y lo de zona protegida siguen bloqueados", () => {
  for (const estado of ["EN_CURSO", "PLANEANDO", "SUBIENDO", "APROBADO", "PLAN_APROBADO", "POR_REVISAR"]) {
    assert.ok(reglas.puedeBorrarTarjeta("MCP", estado, [], voz("sí, bórrala")), estado);
  }
  for (const estado of ["PLAN_LISTO", "ERROR", "IDEA", "POR_APROBAR", "FALLIDO"]) {
    assert.match(reglas.puedeBorrarTarjeta("MCP", estado, ["BOT_VENTAS"], voz("sí, bórrala")), /zona protegida/, estado);
  }
  // La pantalla sí.
  assert.equal(reglas.puedeBorrarTarjeta("PANTALLA", "PLAN_LISTO", ["BOT_VENTAS"]), null);
});

prueba("borrar por voz: POR_APROBAR, FALLIDO, IDEA y HECHO se borran como siempre (con o sin texto)", () => {
  for (const estado of ["POR_APROBAR", "FALLIDO", "IDEA", "HECHO"]) {
    assert.equal(reglas.puedeBorrarTarjeta("MCP", estado), null, estado);
    assert.equal(reglas.puedeBorrarTarjeta("MCP", estado, [], voz("sí, bórrala", false)), null, `${estado} con texto`);
    assert.ok(reglas.puedeBorrarTarjeta("MCP", estado, [], voz("no la borres, sí")), `${estado} no la borres`);
  }
});

prueba("texto para borrar: 'sí' y una palabra de borrar (sin tildes ni mayúsculas); 'no la borres' no", () => {
  for (const bueno of ["sí, bórrala", "Si borralo", "SÍ, ELIMÍNALA", "sí, bórrala ya", "Bórrala, sí.", "si, borra esa"]) {
    assert.equal(trabajo.textoDeConfirmacionParaBorrar(bueno), null, bueno);
  }
  for (const malo of [undefined, "", "sí", "bórrala", "dale, bórrala", "sí, dale", "si no la borres", "sí, no lo elimines", 42]) {
    assert.ok(trabajo.textoDeConfirmacionParaBorrar(malo), String(malo));
  }
});

prueba("deshacer un borrado por voz: vuelve PLAN_LISTO o ERROR; sin la marca, no", () => {
  const porVoz = (estado) =>
    cambio({
      accion: "borrar",
      antes: { estado, borradoEn: null, conexiones: [] },
      despues: { borradoEn: T0.toISOString(), via: "voz", como: "borrado por voz por Alexander", textoConfirmacion: "sí, bórrala" },
    });
  for (const estado of ["PLAN_LISTO", "ERROR"]) {
    assert.equal(reglas.puedeDeshacer(porVoz(estado), [], estado), null, estado);
    const sinMarca = cambio({ accion: "borrar", antes: { estado, borradoEn: null }, despues: { borradoEn: T0.toISOString() } });
    assert.ok(reglas.puedeDeshacer(sinMarca, [], estado), `${estado} sin marca`);
    assert.ok(reglas.puedeDeshacer({ ...porVoz(estado), deshechoEn: despues(5) }, [], estado), `${estado} dos veces`);
  }
  // La marca no abre los demás estados aprobados.
  for (const estado of ["APROBADO", "PLAN_APROBADO", "POR_REVISAR", "SUBIENDO"]) {
    assert.ok(reglas.puedeDeshacer(porVoz(estado), [], estado), estado);
  }
  assert.equal(reglas.puedeDeshacer(porVoz("POR_APROBAR"), [], "POR_APROBAR"), null);
});

prueba("deshacer: lo del trabajador y cualquier aprobación (también por voz) no se deshacen; no deja ni quita estados aprobados", () => {
  assert.match(reglas.puedeDeshacer(cambio({ origen: "TRABAJADOR", accion: "estado" }), [], "PLAN_LISTO"), /Coordinador/);
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
    soltar: ["PLANEANDO", "EN_CURSO", "SUBIENDO"],
    reparar: ["PLANEANDO", "EN_CURSO", "SUBIENDO"],
    partir: ["PLANEANDO", "EN_CURSO"],
    depender: ["APROBADO", "PLANEANDO", "EN_CURSO"],
    recoger: ["ERROR"],
    "ya-hecha": ["PLANEANDO", "EN_CURSO"],
    limpieza: ["EN_CURSO", "SUBIENDO", "POR_REVISAR", "HECHO"],
  };
  for (const [accion, validos] of Object.entries(esperado)) {
    for (const estado of reglas.ESTADOS_TARJETA) {
      const veredicto = trabajo.puedeElTrabajador(accion, estado);
      assert.equal(veredicto === null, validos.includes(estado), `${accion} desde ${estado}`);
    }
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(trabajo.TRANSICIONES_DEL_TRABAJADOR).map(([accion, regla]) => [accion, regla.a])),
    { latido: null, plan: "PLAN_LISTO", resultado: "POR_REVISAR", subida: "HECHO", error: "ERROR", soltar: null, reparar: null, partir: null, depender: null, recoger: null, "ya-hecha": "HECHO", limpieza: null, rescatar: null, revisar_de_nuevo: null },
  );
  // Revisión previa (27-oct-2026): la nota de "ya estaba hecha" y el título único de la tarjeta de limpieza.
  assert.equal(trabajo.notaDeYaHecha("f4759b0"), "ya estaba hecho (commit f4759b0)");
  assert.equal(trabajo.tituloDeLimpieza("aizencrm"), "Limpieza: main trae errores viejos (aizencrm)");
  assert.deepEqual(
    Object.fromEntries(Object.entries(trabajo.AL_TOMAR).map(([de, regla]) => [de, [regla.a, regla.etapa]])),
    { APROBADO: ["PLANEANDO", "planear"], PLAN_APROBADO: ["EN_CURSO", "construir"], SUBIENDO: ["SUBIENDO", "subir"] },
  );
});

prueba("reparar y partir: tope de 3 reparaciones, resumen de máximo 3 líneas, partes de 2 a 4", () => {
  assert.equal(trabajo.TOPE_DE_REPARACIONES, 3);
  assert.equal(trabajo.puedeReparar(0), null);
  assert.equal(trabajo.puedeReparar(2), null);
  assert.match(trabajo.puedeReparar(3), /escala/);
  // El resumen de escalada: 3 líneas con texto como máximo, sin líneas vacías.
  assert.equal(trabajo.resumenDeEscalada("a\n\n b \nc\nd\ne"), "a\nb\nc");
  assert.equal(trabajo.resumenDeEscalada(""), "El Coordinador no dijo el motivo.");
  // 30-oct-2026: sin motivo (o sin causa) queda la etapa y el intento, nunca un texto vacío o sin datos.
  assert.equal(trabajo.sinMotivoDelCoordinador("construir", 2), "El Coordinador no mandó motivo (etapa construir, intento 2).");
  assert.equal(trabajo.sinMotivoDelCoordinador("planear", 1, "causa"), "El Coordinador no mandó causa (etapa planear, intento 1).");
  assert.equal(trabajo.resumenDeEscalada("  \n ", trabajo.sinMotivoDelCoordinador("subir", 3)), "El Coordinador no mandó motivo (etapa subir, intento 3).");
  assert.equal(trabajo.motivoDeEntrada(undefined, trabajo.sinMotivoDelCoordinador("planear", 1)), "El Coordinador no mandó motivo (etapa planear, intento 1).");
  assert.equal(trabajo.motivoDeEntrada(" no compila "), "no compila");
  assert.equal(trabajo.causaDeEntrada("", trabajo.sinMotivoDelCoordinador("construir", 2, "causa")), "El Coordinador no mandó causa (etapa construir, intento 2).");
  assert.ok(trabajo.MOTIVO_VENCIDA.split("\n").length <= 3);
  // La causa es una sola línea.
  assert.equal(trabajo.causaDeEntrada("  primera   línea \nsegunda"), "primera línea");
  assert.equal(trabajo.categoriaDeEntrada("limite_claude"), "limite_claude");
  assert.equal(trabajo.categoriaDeEntrada("inventada"), "otra");
  assert.equal(trabajo.categoriaDeEntrada(""), null);
  // Partir: de 2 a 4 partes, cada una con título y detalle.
  const parte = (n) => ({ titulo: `P${n}`, detalle: `Hacer ${n}` });
  assert.throws(() => trabajo.partesDeEntrada([parte(1)]), /2 a 4/);
  assert.throws(() => trabajo.partesDeEntrada([1, 2, 3, 4, 5].map(parte)), /2 a 4/);
  assert.throws(() => trabajo.partesDeEntrada([parte(1), { titulo: "x" }]), /detalle/);
  assert.equal(trabajo.partesDeEntrada([parte(1), parte(2)]).length, 2);
  assert.equal(trabajo.partesDeEntrada([1, 2, 3, 4].map(parte)).length, 4);
  assert.equal(trabajo.puedePartir({ yaPartida: false, esParte: false }), null);
  assert.ok(trabajo.puedePartir({ yaPartida: true, esParte: false }));
  assert.ok(trabajo.puedePartir({ yaPartida: false, esParte: true }));
  // Medir antes de planear (26-oct-2026): partir también desde PLANEANDO; las hijas quedan "por planear", sin plan.
  assert.equal(trabajo.puedeElTrabajador("partir", "PLANEANDO"), null);
  assert.equal(trabajo.puedeElTrabajador("partir", "EN_CURSO"), null);
  assert.ok(trabajo.puedeElTrabajador("partir", "SUBIENDO"));
  assert.equal(trabajo.estadoDeLasHijas("PLANEANDO"), "APROBADO");
  assert.equal(trabajo.estadoDeLasHijas("EN_CURSO"), "PLAN_APROBADO");
  // Dependencias antes de arrancar: "Esperando a «X»", nunca ERROR; si la otra está en error o fallida, lo dice.
  assert.equal(trabajo.etiquetaEsperando([]), null);
  assert.equal(trabajo.etiquetaEsperando([{ titulo: "El molde", estado: "HECHO" }]), null);
  assert.equal(trabajo.etiquetaEsperando([{ titulo: "El molde", estado: "EN_CURSO" }]), "Esperando a «El molde»");
  assert.equal(trabajo.etiquetaEsperando([{ titulo: "El molde", estado: "ERROR" }]), "Esperando a «El molde», que está en error");
  assert.equal(trabajo.etiquetaEsperando([{ titulo: "El molde", estado: "FALLIDO" }]), "Esperando a «El molde», que está fallida");
  assert.match(trabajo.etiquetaEsperando([{ titulo: "A", estado: "EN_CURSO" }, { titulo: "B", estado: "ERROR" }]), /^Esperando a «A» y «B»; «B» está en error o fallidas$/);
  assert.equal(trabajo.dependenciaHaceCiclo([{ origenId: "a", destinoId: "b" }], "b", "a"), true);
  // Recoger los errores viejos: máximo 2 veces por tarjeta; lo que hay que recordar va en resultado.recogida.
  assert.deepEqual(trabajo.recogidaDelResultado(null), { veces: 0, ultima: null, linea: null });
  assert.deepEqual(trabajo.recogidaDelResultado({ recogida: { veces: 1, ultima: "2026-10-26", linea: "Decide A o B" } }), { veces: 1, ultima: "2026-10-26", linea: "Decide A o B" });
  assert.equal(trabajo.puedeRecoger({ recogida: { veces: 1 } }), null);
  assert.match(trabajo.puedeRecoger({ recogida: { veces: 2 } }), /Ya se recogió 2 veces/);
  assert.equal(trabajo.TOPE_DE_RECOGIDAS_POR_TARJETA, 2);
  assert.equal(trabajo.TOPE_DE_RECOGIDAS_POR_DIA, 6);
  assert.equal(trabajo.estadoTrasRecoger("Un plan"), "PLAN_APROBADO");
  assert.equal(trabajo.estadoTrasRecoger(null), "APROBADO");
  assert.equal(trabajo.decisionDeRecogerDeEntrada(" Partir "), "partir");
  assert.equal(trabajo.decisionDeRecogerDeEntrada("borrar"), null);
  assert.equal(trabajo.lineaParaElDueno("  Falta que\ndecidas   A o B  "), "Falta que decidas A o B");
  assert.equal(trabajo.puedeElTrabajador("recoger", "ERROR"), null);
  assert.ok(trabajo.puedeElTrabajador("recoger", "EN_CURSO"));
  assert.equal(trabajo.puedeElTrabajador("depender", "PLANEANDO"), null);
  // La madre se cierra cuando todas las hijas están HECHO.
  assert.equal(trabajo.madreSeCierra([]), false);
  assert.equal(trabajo.madreSeCierra([{ estado: "HECHO" }, { estado: "EN_CURSO" }]), false);
  assert.equal(trabajo.madreSeCierra([{ estado: "HECHO" }, { estado: "HECHO" }]), true);
});

prueba("el límite de Claude no cuenta como intento: las esperas seguidas se cuentan aparte", () => {
  const cuenta = (...v) => v.map((cuentaComoIntento) => ({ cuentaComoIntento }));
  assert.equal(trabajo.esperasSeguidas([]), 0);
  assert.equal(trabajo.esperasSeguidas(cuenta(true, false, false)), 2);
  assert.equal(trabajo.esperasSeguidas(cuenta(false, true)), 0);
  assert.equal(trabajo.estadoTrasReparar("PLANEANDO"), "APROBADO");
  assert.equal(trabajo.estadoTrasReparar("EN_CURSO"), "PLAN_APROBADO");
});

prueba("dependencias: no se permiten ciclos", () => {
  const flechas = [
    { origenId: "ventas", destinoId: "marketing" },
    { origenId: "marketing", destinoId: "sistemas" },
  ];
  assert.equal(trabajo.dependenciaHaceCiclo(flechas, "ventas", "sistemas"), false);
  assert.equal(trabajo.dependenciaHaceCiclo(flechas, "sistemas", "ventas"), true, "ciclo indirecto");
  assert.equal(trabajo.dependenciaHaceCiclo(flechas, "marketing", "ventas"), true, "ciclo directo");
  assert.equal(trabajo.dependenciaHaceCiclo([], "a", "a"), true, "consigo misma");
  assert.equal(trabajo.dependenciaHaceCiclo(flechas, "cerebro", "ventas"), false);
});

prueba("tomar en paralelo: maxParalelo 1 si no viene (trabajador viejo), tope 12 (aizen1 + nube); excluir solo ids de texto", () => {
  assert.deepEqual(trabajo.opcionesDeTomar({}), { maxParalelo: 1, excluir: [] });
  assert.deepEqual(trabajo.opcionesDeTomar({ maxParalelo: 3, excluir: ["a", "", 7, null, "b"] }), { maxParalelo: 3, excluir: ["a", "b"] });
  assert.equal(trabajo.MAXIMO_EN_PARALELO, 12);
  assert.equal(trabajo.opcionesDeTomar({ maxParalelo: 10 }).maxParalelo, 10, "2 en aizen1 + 8 en la nube caben");
  assert.equal(trabajo.opcionesDeTomar({ maxParalelo: 12 }).maxParalelo, 12);
  assert.equal(trabajo.opcionesDeTomar({ maxParalelo: 99 }).maxParalelo, 12);
  assert.equal(trabajo.opcionesDeTomar({ maxParalelo: 0 }).maxParalelo, 1);
  assert.equal(trabajo.opcionesDeTomar({ maxParalelo: "2" }).maxParalelo, 2);
  assert.equal(trabajo.opcionesDeTomar({ maxParalelo: "x" }).maxParalelo, 1);
  assert.equal(trabajo.opcionesDeTomar({ excluir: "a" }).excluir.length, 0);
});

prueba("candado: cada latido da 5 min más, nunca más allá del tope de la etapa (20 / 90 / 45 min)", () => {
  assert.deepEqual({ ...trabajo.MINUTOS_POR_ETAPA }, { planear: 20, construir: 90, subir: 80 });
  const inicio = new Date("2026-10-20T15:00:00Z");
  const min = (n) => new Date(inicio.getTime() + n * 60_000);
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, inicio).toISOString(), min(5).toISOString());
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, min(40)).toISOString(), min(45).toISOString());
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, min(88)).toISOString(), min(90).toISOString(), "tope");
  assert.equal(trabajo.vencimientoDelCandado("planear", inicio, min(19)).toISOString(), min(20).toISOString(), "tope plan");
  assert.equal(trabajo.vencimientoDelCandado("subir", inicio, min(44)).toISOString(), min(49).toISOString(), "tope subir (80 min: incluye la vigilancia de 30)");
  assert.equal(trabajo.vencimientoDelCandado("subir", inicio, min(79)).toISOString(), min(80).toISOString(), "tope subir");
});

prueba("construir en la nube (25-oct-2026): 180 min solo cuando el latido dice nube; en aizen1 y en las otras etapas no cambia", () => {
  assert.equal(trabajo.MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE, 180);
  assert.equal(trabajo.topeDeLaEtapa("construir"), 90);
  assert.equal(trabajo.topeDeLaEtapa("construir", "aizen1"), 90);
  assert.equal(trabajo.topeDeLaEtapa("construir", "nube"), 180);
  assert.equal(trabajo.topeDeLaEtapa("planear", "nube"), 20, "la nube solo cambia el tope de construir");
  assert.equal(trabajo.topeDeLaEtapa("subir", "nube"), 80);
  const inicio = new Date("2026-10-25T15:00:00Z");
  const min = (n) => new Date(inicio.getTime() + n * 60_000);
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, min(88), "aizen1").toISOString(), min(90).toISOString(), "aizen1: 90");
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, min(88), "nube").toISOString(), min(93).toISOString(), "nube: sigue dando 5 min");
  assert.equal(trabajo.vencimientoDelCandado("construir", inicio, min(178), "nube").toISOString(), min(180).toISOString(), "tope de 180");
  assert.equal(trabajo.vencimientoDelCandado("planear", inicio, min(19), "nube").toISOString(), min(20).toISOString());
});

prueba("el latido dice dónde se construye y el link de la sesión; solo se aceptan links seguros de claude.ai", () => {
  const sesion = "https://claude.ai/code/session_01AbC-9_x";
  assert.deepEqual(trabajo.latidoDeEntrada({ lugar: "nube", sesion }), { lugar: "nube", linkSesion: sesion });
  assert.deepEqual(trabajo.latidoDeEntrada({ lugar: "aizen1" }), { lugar: "aizen1", linkSesion: null });
  assert.deepEqual(trabajo.latidoDeEntrada({}), { lugar: null, linkSesion: null }, "un Coordinador viejo no manda nada");
  assert.deepEqual(trabajo.latidoDeEntrada(null), { lugar: null, linkSesion: null });
  assert.deepEqual(trabajo.latidoDeEntrada({ lugar: "luna", sesion }), { lugar: null, linkSesion: null }, "lugar desconocido");
  assert.equal(trabajo.latidoDeEntrada({ lugar: "aizen1", sesion }).linkSesion, null, "el link solo vale en la nube");
  for (const malo of [
    "http://claude.ai/code/session_ABC",
    "https://claude.ai.malo.example/code/session_ABC",
    "https://evil.example/https://claude.ai/code/session_ABC",
    "https://claude.ai/code/session_ABC?next=https://evil.example",
    "https://claude.ai/code/session_ABC/../../x",
    "https://claude.ai/code/",
    "javascript:alert(1)",
    "https://claude.ai/code/session_ABC ",
    42,
    null,
  ]) {
    assert.equal(trabajo.linkDeSesionDeEntrada(malo), malo === "https://claude.ai/code/session_ABC " ? "https://claude.ai/code/session_ABC" : null, String(malo));
    assert.equal(trabajo.latidoDeEntrada({ lugar: "nube", sesion: malo }).linkSesion, malo === "https://claude.ai/code/session_ABC " ? "https://claude.ai/code/session_ABC" : null);
  }
});

prueba("el resultado guarda dónde se construyó (aizen1 o nube) y el link de la sesión; un link raro o un Coordinador viejo no guardan nada", () => {
  const base = { resumen: "Hecho", paso: true };
  const sesion = "https://claude.ai/code/session_01AbC";
  const nube = trabajo.resultadoDeEntrada({ ...base, construidoEn: "nube", linkSesion: sesion, segundosNube: 361.4 });
  assert.equal(nube.construidoEn, "nube");
  assert.equal(nube.linkSesion, sesion);
  assert.equal(nube.segundosNube, 361);
  const enAizen1 = trabajo.resultadoDeEntrada({ ...base, construidoEn: "aizen1", linkSesion: sesion, segundosNube: 5 });
  assert.equal(enAizen1.construidoEn, "aizen1");
  assert.ok(!("linkSesion" in enAizen1) && !("segundosNube" in enAizen1), "en aizen1 no hay sesión");
  const raro = trabajo.resultadoDeEntrada({ ...base, construidoEn: "nube", linkSesion: "https://evil.example/code/session_X", segundosNube: -3 });
  assert.equal(raro.construidoEn, "nube");
  assert.ok(!("linkSesion" in raro) && !("segundosNube" in raro));
  const viejo = trabajo.resultadoDeEntrada(base);
  assert.ok(!("construidoEn" in viejo) && !("linkSesion" in viejo));
  assert.ok(!("construidoEn" in trabajo.resultadoDeEntrada({ ...base, construidoEn: "luna" })));
});

prueba("la tarjeta dice dónde se construyó: 'La está construyendo Claude en la nube…', 'Construida en: aizen1 / la nube' y el link de la sesión", () => {
  const sesion = "https://claude.ai/code/session_01AbC";
  const { dondeSeConstruyo, esLinkDeSesion } = modelosCoordinador;
  assert.deepEqual(dondeSeConstruyo("EN_CURSO", { construccion: { lugar: "nube", linkSesion: sesion } }), { lugar: "nube", texto: "La está construyendo Claude en la nube…", link: sesion });
  assert.equal(dondeSeConstruyo("EN_CURSO", { construccion: { lugar: "nube", linkSesion: null } }).link, null, "todavía sin link");
  assert.equal(dondeSeConstruyo("EN_CURSO", { construccion: { lugar: "aizen1" } }), null, "en aizen1 vale el aviso de siempre");
  assert.equal(dondeSeConstruyo("EN_CURSO", null), null);
  assert.deepEqual(dondeSeConstruyo("HECHO", { construidoEn: "nube", linkSesion: sesion }), { lugar: "nube", texto: "Construida en: la nube", link: sesion });
  assert.deepEqual(dondeSeConstruyo("POR_REVISAR", { construidoEn: "aizen1" }), { lugar: "aizen1", texto: "Construida en: aizen1", link: null });
  assert.equal(dondeSeConstruyo("HECHO", { construidoEn: "nube", linkSesion: "https://evil.example/x" }).link, null, "un link que no es de claude.ai se descarta");
  assert.equal(dondeSeConstruyo("HECHO", {}), null, "una tarjeta de antes no dice nada");
  // Una que se cayó en la nube (ERROR) conserva el link de la sesión para mirarla.
  assert.deepEqual(dondeSeConstruyo("ERROR", { construccion: { lugar: "nube", linkSesion: sesion }, error: { motivo: "x" } }), { lugar: "nube", texto: "Construida en: la nube", link: sesion });
  assert.equal(esLinkDeSesion(sesion), true);
  assert.equal(esLinkDeSesion("https://claude.ai/code/session_"), false);
  assert.equal(esLinkDeSesion(undefined), false);
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

prueba("zonas que suben solas (24-oct-2026): bot, Meta Ads, libro V3 y chats (26-oct-2026) pasan a SUBIENDO", () => {
  assert.deepEqual([...trabajo.ZONAS_QUE_SUBEN_SOLAS], ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"]);
  const destinoDe = (zonaProtegida, extra = {}) => trabajo.destinoDelResultado({ paso: true, subeSolo: true, zonaProtegida, ...extra });
  assert.equal(destinoDe([]), "SUBIENDO");
  for (const zona of ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"]) assert.equal(destinoDe([zona]), "SUBIENDO", zona);
  assert.equal(destinoDe(["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"]), "SUBIENDO");
  assert.equal(destinoDe(["META_ADS", "OTRA_ZONA"]), "POR_REVISAR", "una zona que pide el sí frena a todas");
  // Sin pasar las pruebas o sin que el Coordinador diga que sube solo (gasto en Meta Ads, falta la simulación V3...), espera.
  assert.equal(destinoDe(["META_ADS"], { subeSolo: false }), "POR_REVISAR");
  assert.equal(destinoDe(["LIBRO_V3"], { paso: false }), "POR_REVISAR");
  assert.deepEqual(trabajo.zonasQuePidenTuSi(["BOT_VENTAS", "CHATS", "META_ADS", "OTRA_ZONA"]), ["OTRA_ZONA"]);
  // El sí final sigue siendo solo del dueño.
  assert.match(trabajo.personaPuedeAprobarMomento(todo, "subir", "voz", "aizencrm", ["BOT_VENTAS"]) ?? "", /dueño/);
  assert.equal(trabajo.personaPuedeAprobarMomento(dueno, "subir", "voz", "aizencrm", ["BOT_VENTAS"]), null);
  // La frase de la tarjeta.
  assert.equal(trabajo.fraseDeLaVigilancia({ zona: "BOT_VENTAS", minutos: 30, ok: true }), "Subió sola (zona Bot de ventas) — vigilancia 30 min OK");
  assert.equal(trabajo.fraseDeLaVigilancia({ zona: "META_ADS, LIBRO_V3", minutos: 30, ok: true }), "Subió sola (zona Meta Ads, Libro V3) — vigilancia 30 min OK");
  assert.deepEqual(trabajo.vigilanciaDeEntrada({ zona: "BOT_VENTAS", minutos: 30, ok: true }), { zona: "BOT_VENTAS", minutos: 30, ok: true });
  assert.equal(trabajo.vigilanciaDeEntrada({ minutos: 30 }), null);
  assert.equal(trabajo.vigilanciaDeEntrada("x"), null);
  assert.equal(trabajo.resultadoDeEntrada({ resumen: "x", esperaPor: "gasto en Meta Ads" }).esperaPor, "gasto en Meta Ads");
});

prueba("CHATS y BOT_VENTAS nunca esperan el sí final (30-oct-2026): si no suben solas van a ERROR; el gasto en Meta Ads sigue esperando", () => {
  const destinoDe = (zonaProtegida, extra = {}) => trabajo.destinoDelResultado({ paso: true, subeSolo: false, zonaProtegida, ...extra });
  // CHATS sin la confirmación de que no manda mensajes nuevos: ERROR.
  assert.equal(destinoDe(["CHATS"], { esperaPor: "falta la prueba de que no se mandan mensajes nuevos a clientes" }), "ERROR");
  assert.equal(destinoDe(["CHATS"]), "ERROR");
  assert.equal(destinoDe(["CHATS", "BOT_VENTAS"]), "ERROR");
  // BOT_VENTAS bien (subeSolo): SUBIENDO.
  assert.equal(destinoDe(["BOT_VENTAS"], { subeSolo: true }), "SUBIENDO");
  // Meta Ads con gasto, Libro V3 y tarjetas sin zona: siguen esperando el sí.
  assert.equal(destinoDe(["META_ADS"], { esperaPor: "gasto en Meta Ads (daily_budget)" }), "POR_REVISAR");
  assert.equal(destinoDe(["CHATS"], { esperaPor: "Gasto en META ADS" }), "POR_REVISAR");
  assert.equal(destinoDe(["LIBRO_V3"]), "POR_REVISAR");
  assert.equal(destinoDe([]), "POR_REVISAR");
  // Si no pasó la construcción, se trata como siempre.
  assert.equal(destinoDe(["CHATS"], { paso: false }), "POR_REVISAR");
  // Ayudas.
  assert.equal(trabajo.soloChatsOBot(["CHATS", "BOT_VENTAS"]), true);
  assert.equal(trabajo.soloChatsOBot([]), false);
  assert.equal(trabajo.soloChatsOBot(["CHATS", "META_ADS"]), false);
  assert.equal(trabajo.esGastoEnMetaAds("el cambio tiene gasto en Meta Ads"), true);
  assert.equal(trabajo.esGastoEnMetaAds("sin tildes: GASTO en meta ads"), true);
  assert.equal(trabajo.esGastoEnMetaAds("solo Meta Ads"), false);
  assert.equal(trabajo.esGastoEnMetaAds(null), false);
  // revisar_de_nuevo: solo desde POR_REVISAR; cualquier otro estado se rechaza.
  assert.equal(trabajo.puedeElTrabajador("revisar_de_nuevo", "POR_REVISAR"), null);
  for (const estado of ["EN_CURSO", "SUBIENDO", "ERROR", "HECHO", "PLAN_APROBADO"]) {
    assert.match(trabajo.puedeElTrabajador("revisar_de_nuevo", estado), /solo vale desde POR_REVISAR/, estado);
  }
  assert.ok(trabajo.ACCIONES_DEL_TRABAJADOR.includes("revisar_de_nuevo"));
});

prueba("el sí del dueño se hereda (27-oct-2026): vale aunque la tarea se reconstruya, salvo dinero, Meta Ads, envío nuevo en chats o migración destructiva", () => {
  const siDelDueno = [{ accion: "aprobar", despues: { via: "voz", momento: "tarea" } }];
  const tarea = { titulo: "Buscador de la bandeja", detalle: "Un buscador por nombre.", plan: "RIESGO: ALTO\nAPROBAR PLAN: sí\nBuscar en la bandeja.", historial: siDelDueno };
  // El resultado que hoy deja la tarjeta POR_REVISAR (el constructor no escribió la frase) hereda el sí.
  assert.equal(trabajo.porQueNoHeredaLaAprobacion({ ...tarea, esperaPor: "falta la prueba de que los chats no mandan mensajes nuevos a clientes (✔ chats: sin mensajes nuevos a clientes)" }), null);
  assert.equal(trabajo.porQueNoHeredaLaAprobacion(tarea), null);
  // Por pantalla también cuenta; una aprobación automática o una fila que no es "aprobar" no.
  assert.equal(trabajo.aprobacionDelDuenoEnElHistorial([{ accion: "aprobar", despues: { via: "pantalla" } }]), true);
  assert.equal(trabajo.aprobacionDelDuenoEnElHistorial([{ accion: "aprobar", despues: { via: "automatica" } }, { accion: "estado", despues: { via: "voz" } }]), false);
  assert.match(trabajo.porQueNoHeredaLaAprobacion({ ...tarea, historial: [] }), /no hay un sí/);
  // Excepciones: un envío nuevo en chats, dinero, gasto en Meta Ads, migración destructiva.
  assert.match(trabajo.porQueNoHeredaLaAprobacion({ ...tarea, esperaPor: "el cambio agrega un envío de mensaje en chats (espera el sí del dueño aunque el plan lo mencione)" }), /envío de mensaje/);
  assert.match(trabajo.porQueNoHeredaLaAprobacion({ ...tarea, esperaPor: "gasto en Meta Ads (daily_budget)" }), /gasto en Meta Ads/);
  assert.match(trabajo.porQueNoHeredaLaAprobacion({ ...tarea, plan: "RIESGO: ALTO\nGASTO EN META ADS: sube el presupuesto diario" }), /Meta Ads/);
  assert.ok(trabajo.porQueNoHeredaLaAprobacion({ ...tarea, titulo: "Pagar la nómina de las asesoras", detalle: "Calcula la nómina y las comisiones." }));
  assert.match(trabajo.porQueNoHeredaLaAprobacion({ ...tarea, migracionDestructiva: ["DROP"] }), /destructivos/);
  // destinoDelResultado: con la aprobación heredada sube aunque el Coordinador no lo dijera, pero nunca si no pasó o una zona pide el sí.
  const destino = (extra) => trabajo.destinoDelResultado({ paso: true, subeSolo: false, zonaProtegida: ["CHATS"], aprobacionHeredada: true, ...extra });
  assert.equal(destino({}), "SUBIENDO");
  assert.equal(destino({ aprobacionHeredada: false }), "ERROR", "CHATS que no sube sola ya no espera el sí: ERROR");
  assert.equal(destino({ paso: false }), "POR_REVISAR");
  assert.equal(destino({ zonaProtegida: ["OTRA_ZONA"] }), "POR_REVISAR");
  // Rescatar: solo desde POR_REVISAR.
  assert.equal(trabajo.puedeElTrabajador("rescatar", "POR_REVISAR"), null);
  assert.match(trabajo.puedeElTrabajador("rescatar", "EN_CURSO"), /solo vale desde POR_REVISAR/);
  assert.equal(trabajo.esperaSoloPorLaPruebaExtra("falta la prueba de que no se mandan mensajes nuevos a clientes"), true);
  assert.equal(trabajo.esperaSoloPorLaPruebaExtra("falta la simulación V3 (✔ ...)"), false);
  assert.equal(trabajo.esperaSoloPorLaPruebaExtra(null), false);
});

await prueba("las 3 líneas del resumen: se recortan y se descartan si vienen vacías", () => {
  assert.deepEqual(trabajo.resumenDeTresLineasDeEntrada({ hizo: "  Se agregó\nel botón ", ahora: "Sale en la sala", revisar: "La vista de hoy" }), {
    hizo: "Se agregó el botón",
    ahora: "Sale en la sala",
    revisar: "La vista de hoy",
  });
  assert.deepEqual(trabajo.resumenDeTresLineasDeEntrada({ hizo: "Algo", ahora: "   ", revisar: 5 }), { hizo: "Algo" });
  assert.equal(trabajo.resumenDeTresLineasDeEntrada({ hizo: "", ahora: " ", revisar: "" }), null);
  assert.equal(trabajo.resumenDeTresLineasDeEntrada("x"), null);
  assert.equal(trabajo.resumenDeTresLineasDeEntrada(null), null);
  assert.equal(trabajo.resumenDeTresLineasDeEntrada({ hizo: "x".repeat(900) }).hizo.length, 300);
});

prueba("aprobar_tarjeta: texto obligatorio y válido por voz; zona protegida: bot, Meta Ads, libro V3 y chats también por voz", () => {
  assert.match(destino({ textoConfirmacion: undefined }), /texto de confirmación/);
  assert.match(destino({ textoConfirmacion: "ok dale" }), /texto de confirmación/);
  assert.match(destino({ textoConfirmacion: "no apruebo, sí" }), /no apruebo/);
  assert.match(destino({ zonaProtegida: ["OTRA_ZONA"] }), /solo en la pantalla/);
  // Bot de ventas, Meta Ads, libro V3 (24-oct-2026) y chats (26-oct-2026) también se aprueban por voz; con una zona que no suba sola mezclada, no.
  for (const zona of ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"]) assert.equal(destino({ zonaProtegida: [zona] }), "APROBADO", zona);
  assert.equal(destino({ zonaProtegida: ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"] }), "APROBADO");
  assert.match(destino({ zonaProtegida: ["META_ADS", "OTRA_ZONA"] }), /solo en la pantalla/);
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

const duenaMagilus = { nombre: "Magilus", correo: "gestionmagilus@gmail.com" };
const cuenta = (extra) => ({
  nombre: "Magilus",
  correo: "gestionmagilus@gmail.com",
  tipoCuenta: "CLIENTE",
  miembroActivo: true,
  rolEnNegocio: "ADMIN",
  esDuenaRegistrada: true,
  duena: duenaMagilus,
  ...extra,
});
// Arma la persona como personaQueAprueba (tableros.ts), con la cuenta.
const persona = (extra) => {
  const c = cuenta(extra);
  return { esDueno: trabajo.esDuenoDelNegocio(c), esAdminPlataforma: c.tipoCuenta === "ADMIN", aprobador: null, cuenta: c };
};

prueba("dueña del negocio: la registrada (CLIENTE o ADMIN) si es miembro activo; CLIENTE OWNER; ADMIN solo no", () => {
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({})), true, "CLIENTE dueña registrada");
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({ tipoCuenta: "ADMIN" })), true, "ADMIN dueña registrada");
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({ esDuenaRegistrada: false, rolEnNegocio: "OWNER" })), true, "CLIENTE OWNER");
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({ tipoCuenta: "ADMIN", esDuenaRegistrada: false, rolEnNegocio: "OWNER" })), false, "ADMIN OWNER no registrada");
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({ tipoCuenta: "ADMIN", esDuenaRegistrada: false })), false, "ADMIN cualquiera");
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({ esDuenaRegistrada: false })), false, "CLIENTE no dueña");
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({ tipoCuenta: "EMPLEADO" })), false, "EMPLEADO");
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({ miembroActivo: false, rolEnNegocio: null })), false, "registrada pero no miembro");
  assert.equal(trabajo.esDuenoDelNegocio(cuenta({ tipoCuenta: "ADMIN", miembroActivo: false, rolEnNegocio: null })), false);
});

prueba("aprobar por voz: la dueña registrada con cuenta ADMIN aprueba la tarea, el plan y la subida", () => {
  const magilus = persona({ tipoCuenta: "ADMIN" });
  assert.equal(destino({ persona: magilus }), "APROBADO");
  assert.equal(destino({ persona: magilus, momento: "plan", estado: "PLAN_LISTO", tienePlan: true }), "PLAN_APROBADO");
  assert.equal(destino({ persona: magilus, momento: "subir", estado: "POR_REVISAR", resultadoPaso: true }), "SUBIENDO");
  // Las reglas de siempre siguen: texto, "no apruebo", zona protegida solo en pantalla.
  assert.match(destino({ persona: magilus, textoConfirmacion: "ok dale" }), /texto de confirmación/);
  assert.match(destino({ persona: magilus, textoConfirmacion: "no apruebo, sí" }), /no apruebo/);
  assert.match(destino({ persona: magilus, zonaProtegida: ["OTRA_ZONA"] }), /solo en la pantalla/);
  assert.equal(destino({ persona: magilus, zonaProtegida: ["BOT_VENTAS"] }), "APROBADO");
  assert.equal(destino({ persona: magilus, via: "pantalla", origen: "PANTALLA", zonaProtegida: ["META_ADS"], textoConfirmacion: undefined }), "APROBADO");
  // Una CLIENTE dueña sigue aprobando como hoy.
  assert.equal(destino({ persona: persona({ esDuenaRegistrada: false, rolEnNegocio: "OWNER" }), momento: "subir", estado: "POR_REVISAR", resultadoPaso: true }), "SUBIENDO");
});

prueba("aprobar por voz: un ADMIN que no es la dueña registrada no aprueba, y el error dice la cuenta y el motivo", () => {
  const gcm = persona({ nombre: "GCM Projects", correo: "gcm@ejemplo.com", tipoCuenta: "ADMIN", esDuenaRegistrada: false });
  const error = destino({ persona: gcm });
  assert.match(error, /No puedes aprobar/);
  assert.match(error, /La conexión llegó con la cuenta GCM Projects \(gcm@ejemplo\.com\)/);
  assert.match(error, /es ADMIN de la plataforma, pero no es la cuenta dueña de este negocio/);
  assert.match(error, /la dueña es Magilus, gestionmagilus@gmail\.com/);
  assert.match(error, /Crea la clave de Claude entrando con la cuenta dueña/);
  for (const momento of [{ momento: "plan", estado: "PLAN_LISTO", tienePlan: true }, { momento: "subir", estado: "POR_REVISAR", resultadoPaso: true }]) {
    assert.match(destino({ persona: gcm, ...momento }), /GCM Projects \(gcm@ejemplo\.com\).*ADMIN de la plataforma/);
  }
  assert.match(destino({ persona: gcm, momento: "subir", estado: "POR_REVISAR", resultadoPaso: true }), /solo el dueño/);
  // En la pantalla, el ADMIN sigue aprobando la tarea; la zona protegida y el sí final no, y dice por qué.
  assert.equal(destino({ persona: gcm, via: "pantalla", origen: "PANTALLA" }), "APROBADO");
  assert.match(destino({ persona: gcm, via: "pantalla", origen: "PANTALLA", zonaProtegida: ["LIBRO_V3"] }), /solo el dueño.*Entraste con la cuenta GCM Projects/);
});

prueba("aprobar por voz: sin ser miembro activo no es dueña aunque esté registrada; CLIENTE no dueña dice por qué", () => {
  const inactiva = persona({ miembroActivo: false, rolEnNegocio: null });
  assert.equal(inactiva.esDueno, false);
  assert.match(destino({ persona: inactiva }), /registrada como dueña, pero no es miembro activo.*volver a activarla/);
  const otra = persona({ nombre: "Otra", correo: "otra@ejemplo.com", esDuenaRegistrada: false, miembroActivo: false, rolEnNegocio: null });
  assert.match(destino({ persona: otra }), /Otra \(otra@ejemplo\.com\): no es miembro activo de este negocio \(la dueña es Magilus/);
  const cliente = persona({ nombre: "Asesora", correo: "a@ejemplo.com", esDuenaRegistrada: false });
  assert.match(destino({ persona: cliente }), /Asesora \(a@ejemplo\.com\): es CLIENTE, pero no es dueña de este negocio/);
  assert.match(destino({ persona: persona({ esDuenaRegistrada: false, duena: null }) }), /el negocio no tiene cuenta dueña registrada/);
  // La dueña no tiene motivo.
  assert.equal(trabajo.motivoNoEsDueno(cuenta({ tipoCuenta: "ADMIN" }), "voz"), null);
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

prueba("resultado del trabajador: el motor de cada paso (claude/codex) se guarda si vino, lo demás se ignora", () => {
  const conMotor = trabajo.resultadoDeEntrada({ resumen: "x", motor: { plan: "claude", construir: "codex", revisar: "gpt", otro: "codex" } });
  assert.deepEqual(conMotor.motor, { plan: "claude", construir: "codex" });
  assert.equal("motor" in trabajo.resultadoDeEntrada({ resumen: "x" }), false);
  assert.equal("motor" in trabajo.resultadoDeEntrada({ resumen: "x", motor: { construir: "otro" } }), false);
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

/* ------------------------------------------------------- nombre del tablero */

prueba("nombre de tablero: no vacío, hasta 60 letras y sin repetir el de otro (sin mirar mayúsculas)", () => {
  const existentes = [
    { id: "t1", nombre: "Prueba" },
    { id: "t2", nombre: "Ventas" },
  ];
  assert.ok(reglas.problemaDelNombreDeTablero("", existentes));
  assert.ok(reglas.problemaDelNombreDeTablero("   ", existentes));
  assert.ok(reglas.problemaDelNombreDeTablero(undefined, existentes));
  assert.equal(reglas.problemaDelNombreDeTablero("a".repeat(reglas.MAX_NOMBRE_TABLERO), existentes), null);
  assert.ok(reglas.problemaDelNombreDeTablero("a".repeat(reglas.MAX_NOMBRE_TABLERO + 1), existentes));
  assert.ok(reglas.problemaDelNombreDeTablero(" ventas ", existentes), "crear uno que ya existe");
  assert.ok(reglas.problemaDelNombreDeTablero("VENTAS", existentes, "t1"), "renombrar con el nombre de otro");
  assert.equal(reglas.problemaDelNombreDeTablero("PRUEBA", existentes, "t1"), null, "el propio, con otras mayúsculas");
  assert.equal(reglas.problemaDelNombreDeTablero("Producción", existentes), null);
});

prueba("ver todos los tableros, elegir su dueño y el panel Trabajador: dueño o ADMIN de la plataforma; una asesora no", () => {
  assert.equal(reglas.personaPuedeAprobar({ isOwner: true, role: "CLIENTE" }), true);
  assert.equal(reglas.personaPuedeAprobar({ isOwner: false, role: "ADMIN" }), true);
  assert.equal(reglas.personaPuedeAprobar({ isOwner: false, role: "CLIENTE" }), false);
  assert.equal(reglas.personaPuedeAprobar({ isOwner: false, role: "EMPLEADO" }), false);
});

/* ------------------------------------------------------------ tableros por cuenta */

prueba("el dueño de un tablero se elige por id, email o nombre (sin tildes ni mayúsculas)", () => {
  const miembros = [
    { userId: "u1", nombre: "Alexander Ruiz", email: "alex@magilus.co" },
    { userId: "u2", nombre: "Emanuel Díaz", email: "emanuel@magilus.co" },
    { userId: "u3", nombre: "Emanuela Gómez", email: "ela@magilus.co" },
  ];
  assert.equal(reglas.elegirMiembro(miembros, "u2").miembro.userId, "u2");
  assert.equal(reglas.elegirMiembro(miembros, " EMANUEL@magilus.co ").miembro.userId, "u2");
  assert.equal(reglas.elegirMiembro(miembros, "emanuel diaz").miembro.userId, "u2");
  assert.equal(reglas.elegirMiembro(miembros, "alexander").miembro.userId, "u1", "parte del nombre, si es uno solo");
  assert.match(reglas.elegirMiembro(miembros, "emanuel").error, /más de una persona/, "Emanuel y Emanuela: pide el email");
  assert.match(reglas.elegirMiembro(miembros, "Pedro").error, /no es una persona activa/);
  assert.match(reglas.elegirMiembro(miembros, "  ").error, /Falta el dueño/);
  assert.match(reglas.elegirMiembro(miembros, 7).error, /Falta el dueño/);
});

/* ------------------------------------------------------------ resumen corto de la ficha */

const { resumenCorto, sinMarkdown, seccionQueSeCambia, tituloCorto } = cargar("src/features/tableros-inteligentes/services/resumen-corto.ts");

prueba("tituloCorto: corta en ':', '—', '–' y '(' y deja 6 palabras o menos", () => {
  assert.equal(tituloCorto("Autorreparación del Coordinador: que se repare solo cuando falle"), "Autorreparación del Coordinador");
  assert.equal(tituloCorto("WhatsApp del Coordinador — máximo 3 líneas y el detalle en el tablero"), "WhatsApp del Coordinador");
  assert.equal(tituloCorto("Reuniones (parte 2) compartir pantalla"), "Reuniones");
  assert.equal(tituloCorto("Embudo - guardar la fecha de cada etapa"), "Embudo");
  const largo = tituloCorto("uno dos tres cuatro cinco seis siete ocho nueve");
  assert.equal(largo, "uno dos tres cuatro cinco seis…");
  assert.ok(largo.replace("…", "").split(" ").length <= 6);
  assert.equal(tituloCorto("  Reporte   de ventas "), "Reporte de ventas");
  assert.equal(tituloCorto(": raro"), ": raro");
});

prueba("el resumen corto limpia el markdown y quita el relleno del trabajador", () => {
  const r = resumenCorto({
    resultadoResumen:
      "## Resumen\nEspero a que terminen los subagentes.\n**Listo**: ahora el botón *Sí, subir* sale arriba de la ficha.\n- Se acortó el texto técnico.",
  });
  assert.equal(r.fuente, "resultado");
  assert.ok(!/[#*`]/.test(r.texto), r.texto);
  assert.ok(!/subagentes/i.test(r.texto), r.texto);
  assert.match(r.texto, /botón Sí, subir sale arriba/);
});

prueba("el resumen corto no pasa de ~300 caracteres y avisa que cortó", () => {
  const largo = Array.from({ length: 40 }, (_, i) => `Línea número ${i} que explica algo del cambio.`).join("\n");
  const r = resumenCorto({ resultadoResumen: largo });
  assert.ok(r.texto.length <= 300, String(r.texto.length));
  assert.equal(r.cortado, true);
  const unaLineaGigante = resumenCorto({ detalle: "palabra ".repeat(200) });
  assert.ok(unaLineaGigante.texto.length <= 301);
  assert.ok(unaLineaGigante.texto.endsWith("…"));
});

prueba("sin resultado usa 'Qué se cambia' del plan; sin plan, el detalle; sin nada, null", () => {
  const plan = "# Plan\n## Contexto\nTexto de contexto largo que no va.\n## Qué se cambia\n- Botón grande para subir.\n- Ficha más corta.\n## Pruebas\nCorrer todo.";
  assert.equal(seccionQueSeCambia(plan).includes("Contexto"), false);
  const r = resumenCorto({ resultadoResumen: "", plan, detalle: "otro" });
  assert.equal(r.fuente, "plan");
  assert.equal(r.texto, "Botón grande para subir. Ficha más corta.");
  assert.equal(resumenCorto({ plan: null, detalle: "Cambiar el color del botón principal." }).fuente, "detalle");
  assert.equal(resumenCorto({ resultadoResumen: "Listo.\n---\n", plan: "", detalle: "" }), null);
  assert.equal(sinMarkdown("1. **Hola** [link](http://x.co) `código`"), "Hola link código");
});

/* ------------------------------------------------------------------ riesgo BAJO / ALTO (reglas-riesgo.ts) */

const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");
const limpia = { titulo: "Reporte de ventas por mes", detalle: "Agregar un reporte nuevo de ventas por mes en una pantalla", repo: "aizen-crm", zonaProtegida: [] };
const conTexto = (detalle, titulo = "Tarea") => ({ ...limpia, titulo, detalle });

prueba("sin riesgo cuenta como ALTO y riesgoDeEntrada acepta bajo/ALTO/vacío", () => {
  assert.equal(riesgo.riesgoEfectivo(null), "ALTO");
  assert.equal(riesgo.riesgoEfectivo(undefined), "ALTO");
  assert.equal(riesgo.riesgoEfectivo("raro"), "ALTO");
  assert.equal(riesgo.riesgoEfectivo("ALTO"), "ALTO");
  assert.equal(riesgo.riesgoEfectivo("BAJO"), "BAJO");
  assert.equal(riesgo.riesgoDeEntrada("bajo"), "BAJO");
  assert.equal(riesgo.riesgoDeEntrada(" ALTO "), "ALTO");
  assert.equal(riesgo.riesgoDeEntrada(""), null);
  assert.equal(riesgo.riesgoDeEntrada(null), null);
  assert.equal(riesgo.riesgoDeEntrada(undefined), undefined);
  assert.throws(() => riesgo.riesgoDeEntrada("medio"), /BAJO o ALTO/);
});

prueba("motivosDeRiesgoAlto: cada zona protegida, dinero, permisos, mensajes y el trabajador dan ALTO", () => {
  for (const zona of ["CHATS", "BOT_VENTAS", "LIBRO_V3", "META_ADS"]) {
    const motivos = riesgo.motivosDeRiesgoAlto({ ...limpia, zonaProtegida: [zona] });
    assert.ok(motivos.some((m) => m.includes(zona)), zona);
  }
  const casos = [
    "Cambiar cómo se calculan los abonos",
    "Mostrar los saldos de cuentas",
    "Arreglar la nómina del mes",
    "Corregir las comisiones",
    "Mejorar la facturación",
    "Revisar los pagos pendientes",
    "Cambiar la contraseña por defecto",
    "Agregar un permiso nuevo",
    "Crear un usuario de prueba",
    "Rotar las credenciales",
    "Enviar mensajes a clientes con la promo",
    "Mandar un aviso por WhatsApp",
    "Cambiar las reglas de aprobación del trabajador",
  ];
  for (const caso of casos) assert.ok(riesgo.motivosDeRiesgoAlto(conTexto(caso)).length > 0, caso);
  assert.deepEqual(riesgo.motivosDeRiesgoAlto(limpia), []);
  assert.ok(riesgo.motivosDeRiesgoAlto({ ...limpia, repo: null }).some((m) => m.includes("repo")));
});

prueba("motivosDeRiesgoAlto: una migración destructiva en el detalle da ALTO", () => {
  assert.ok(riesgo.motivosDeRiesgoAlto(conTexto('Migración: DROP TABLE "Reporte";')).length > 0);
  assert.ok(riesgo.motivosDeRiesgoAlto(conTexto('Migración: DELETE FROM "Reporte";')).length > 0);
  assert.deepEqual(riesgo.motivosDeRiesgoAlto(conTexto('Migración: ALTER TABLE "Reporte" ADD COLUMN "mes" TEXT;')), []);
});

prueba("motivosDeLosArchivos: trabajador, reglas, dinero y login dan ALTO; un reporte no", () => {
  const alto = [
    "trabajador-tablero/lib/crm.mjs",
    "src/features/tableros-inteligentes/services/reglas-riesgo.ts",
    "src/features/tableros-inteligentes/services/reglas.ts",
    "src/features/abonos/lista.tsx",
    "src/features/nomina/calculo.ts",
    "src/features/comisiones/tabla.tsx",
    "src/app/login/page.tsx",
    "src/features/permisos/guardar.ts",
  ];
  for (const ruta of alto) assert.ok(riesgo.motivosDeLosArchivos([ruta]).length > 0, ruta);
  assert.ok(riesgo.motivosDeLosArchivos(["trabajador-tablero\\lib\\crm.mjs"]).length > 0);
  assert.deepEqual(riesgo.motivosDeLosArchivos(["src/features/reportes/x.tsx"]), []);
});

prueba("destructivoDelSql: detecta lo que borra o cambia y deja pasar lo aditivo", () => {
  const d = riesgo.destructivoDelSql;
  assert.deepEqual(d('DROP TABLE "X";'), ["DROP"]);
  assert.deepEqual(d('DELETE FROM "X";'), ["DELETE"]);
  assert.deepEqual(d('UPDATE "X" SET a = 1;'), ["UPDATE"]);
  assert.deepEqual(d('TRUNCATE "X";'), ["TRUNCATE"]);
  assert.ok(d('ALTER TABLE "X" RENAME COLUMN a TO b;').includes("RENAME"));
  assert.deepEqual(d('ALTER TABLE "X" ALTER COLUMN y TYPE INTEGER;'), ["ALTER destructivo"]);
  assert.ok(d('ALTER TABLE "X" DROP COLUMN y;').includes("DROP"));
  assert.deepEqual(d('ALTER TABLE "X" ADD COLUMN IF NOT EXISTS "riesgo" TEXT;'), []);
  assert.deepEqual(d('ALTER TABLE "X" ADD COLUMN "type" TEXT;'), []);
  assert.deepEqual(d("ALTER TYPE \"Estado\" ADD VALUE 'NUEVO';"), []);
  assert.deepEqual(d('CREATE TABLE "X" ("id" TEXT NOT NULL);'), []);
  assert.deepEqual(d('CREATE INDEX "i" ON "X"("id");'), []);
  assert.deepEqual(
    d('CREATE TABLE "H" ("id" TEXT, "xId" TEXT, CONSTRAINT "f" FOREIGN KEY ("xId") REFERENCES "X"("id") ON DELETE CASCADE ON UPDATE CASCADE);'),
    [],
  );
  assert.deepEqual(d('ALTER TABLE "H" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "X"("id") ON DELETE SET NULL ON UPDATE RESTRICT;'), []);
  assert.deepEqual(d(null), []);
  assert.deepEqual(d(""), []);
  // Comentarios y textos entre comillas no cuentan.
  assert.deepEqual(d('-- drop table viejo\nCREATE TABLE "X" ("id" TEXT);'), []);
  assert.deepEqual(d('/* delete everything */ CREATE TABLE "X" ("id" TEXT);'), []);
  assert.deepEqual(d("ALTER TABLE \"X\" ADD COLUMN \"c\" TEXT DEFAULT 'update me';"), []);
});

const PLAN_BASE = (extra = {}) => {
  const p = {
    riesgo: "RIESGO: BAJO — solo agrega un reporte nuevo",
    migracion: "No hay migración.",
    archivos: "- src/features/reportes/Reporte.tsx",
    zonas: "Zonas: ninguna. (No toca las rutas de chats, ni del bot de ventas.)",
    ...extra,
  };
  return `${p.riesgo}\n\n1. Contexto\nUn reporte de ventas por mes.\n\n2. Qué se cambia\nUn componente nuevo.\n\n3. Zonas protegidas\n${p.zonas}\n\n4. Migración\n${p.migracion}\n\n5. Archivos que se tocan\n${p.archivos}\n\n6. Pruebas\nCorrer todo.`;
};

prueba("riesgoDelPlan: BAJO limpio no trae motivos; sin la línea, ALTO o zona protegida sí", () => {
  const limpio = riesgo.riesgoDelPlan(PLAN_BASE());
  assert.equal(limpio.declarado, "BAJO");
  assert.equal(limpio.motivoDeclarado, "solo agrega un reporte nuevo");
  assert.deepEqual(limpio.motivosAlto, []);

  const sinLinea = riesgo.riesgoDelPlan(PLAN_BASE({ riesgo: "" }));
  assert.equal(sinLinea.declarado, null);
  assert.ok(sinLinea.motivosAlto.some((m) => m.includes("no trae la línea RIESGO")));

  const alto = riesgo.riesgoDelPlan(PLAN_BASE({ riesgo: "RIESGO: ALTO — toca dinero" }));
  assert.equal(alto.declarado, "ALTO");
  assert.ok(alto.motivosAlto.length > 0);

  const zona = riesgo.riesgoDelPlan(PLAN_BASE({ zonas: "TOCA ZONA PROTEGIDA: CHATS" }));
  assert.ok(zona.motivosAlto.some((m) => m.includes("zona protegida")));
  assert.deepEqual(riesgo.riesgoDelPlan(PLAN_BASE({ zonas: "No toca zona protegida." })).motivosAlto, []);
});

prueba("riesgoDelPlan: migración destructiva y archivos del trabajador dan ALTO", () => {
  const drop = riesgo.riesgoDelPlan(PLAN_BASE({ migracion: 'DROP TABLE "Reporte";' }));
  assert.ok(drop.motivosAlto.some((m) => m.includes("DROP")));
  const aditiva = riesgo.riesgoDelPlan(PLAN_BASE({ migracion: 'ALTER TABLE "X" ADD COLUMN IF NOT EXISTS "mes" TEXT;' }));
  assert.deepEqual(aditiva.motivosAlto, []);
  const trabajadorTocado = riesgo.riesgoDelPlan(PLAN_BASE({ archivos: "- trabajador-tablero/lib/crm.mjs" }));
  assert.ok(trabajadorTocado.motivosAlto.some((m) => m.includes("trabajador-tablero")));
});

prueba("problemaDelRiesgo: BAJO con motivo de riesgo alto es error (validación del servidor del MCP)", () => {
  const pedir = (extra = {}) => ({ quien: "CLAUDE", pedido: "BAJO", actual: null, actualPor: null, datos: limpia, ...extra });
  assert.equal(riesgo.problemaDelRiesgo(pedir()), null);
  assert.match(riesgo.problemaDelRiesgo(pedir({ datos: conTexto("Cambiar las comisiones de los asesores") })), /No puede ser riesgo BAJO/);
  assert.match(riesgo.problemaDelRiesgo(pedir({ datos: { ...limpia, zonaProtegida: ["CHATS"] } })), /No puede ser riesgo BAJO/);
  assert.match(riesgo.problemaDelRiesgo(pedir({ datos: conTexto('Migración: DROP TABLE "X";') })), /No puede ser riesgo BAJO/);
  assert.match(riesgo.problemaDelRiesgo(pedir({ datos: { ...limpia, repo: null } })), /No puede ser riesgo BAJO/);
  // Claude no baja a BAJO un ALTO que puso el trabajador o el dueño; el dueño sí, si las reglas no ven nada.
  assert.match(riesgo.problemaDelRiesgo(pedir({ actual: "ALTO", actualPor: "TRABAJADOR" })), /el trabajador/);
  assert.match(riesgo.problemaDelRiesgo(pedir({ actual: "ALTO", actualPor: "DUENO" })), /el dueño/);
  assert.equal(riesgo.problemaDelRiesgo(pedir({ actual: "ALTO", actualPor: "CLAUDE" })), null);
  assert.equal(riesgo.problemaDelRiesgo(pedir({ quien: "DUENO", actual: "ALTO", actualPor: "TRABAJADOR" })), null);
  assert.match(riesgo.problemaDelRiesgo(pedir({ quien: "DUENO", datos: conTexto("Pagar nómina") })), /No puede ser riesgo BAJO/);
  // ALTO (o no tocarlo) nunca da problema.
  assert.equal(riesgo.problemaDelRiesgo(pedir({ pedido: "ALTO", datos: conTexto("Pagar nómina") })), null);
  assert.equal(riesgo.problemaDelRiesgo(pedir({ pedido: null })), null);
  assert.equal(riesgo.problemaDelRiesgo(pedir({ pedido: undefined })), null);
});

prueba("porQueNoSeApruebaSola: solo BAJO limpio, con repo y el interruptor prendido", () => {
  const base = { ...limpia, riesgo: "BAJO", prendido: true };
  assert.equal(riesgo.porQueNoSeApruebaSola(base), null);
  assert.ok(riesgo.porQueNoSeApruebaSola({ ...base, prendido: false }).includes("apagada"));
  assert.ok(riesgo.porQueNoSeApruebaSola({ ...base, repo: null }));
  assert.ok(riesgo.porQueNoSeApruebaSola({ ...base, riesgo: null }));
  assert.ok(riesgo.porQueNoSeApruebaSola({ ...base, riesgo: "ALTO" }));
  assert.ok(riesgo.porQueNoSeApruebaSola({ ...base, zonaProtegida: ["META_ADS"] }));
  assert.ok(riesgo.porQueNoSeApruebaSola({ ...base, detalle: "Cambiar los saldos" }));
});

prueba("porQueLaTareaEsperaTuSi (regla 25-oct): arranca sola salvo dinero de Gestión, gasto en Meta Ads o zona que espera", () => {
  const base = { titulo: "Reporte de ventas por mes", detalle: "Agregar una pantalla nueva", zonaProtegida: [], zonasQueEsperan: [] };
  assert.equal(riesgo.porQueLaTareaEsperaTuSi(base), null);
  // Cualquier riesgo arranca: hablar de chats, usuarios o mensajes ya no la frena.
  assert.equal(riesgo.porQueLaTareaEsperaTuSi({ ...base, titulo: "Mejorar la bandeja de chats y los permisos de usuarios" }), null);
  for (const texto of ["Corregir los abonos", "Revisar el saldo", "Ajustar la nómina", "Pagar comisiones", "Arreglar la facturación", "Registrar pagos"]) {
    assert.ok(riesgo.porQueLaTareaEsperaTuSi({ ...base, titulo: texto })?.includes("dinero de Gestión"), texto);
    assert.ok(riesgo.porQueLaTareaEsperaTuSi({ ...base, detalle: texto }), texto);
  }
  for (const texto of ["Subir el presupuesto de la campaña", "Activar las campañas pausadas", "Crear gasto nuevo en Meta Ads", "Gastar en anuncios"]) {
    assert.ok(riesgo.porQueLaTareaEsperaTuSi({ ...base, detalle: texto })?.includes("Meta Ads"), texto);
  }
  assert.ok(riesgo.porQueLaTareaEsperaTuSi({ ...base, zonaProtegida: ["META_ADS"], zonasQueEsperan: ["META_ADS"] })?.includes("META_ADS"));
});

prueba("zonasQueNoArrancanSolas (regla 25-oct): CHATS y BOT_VENTAS arrancan solas; META_ADS y LIBRO_V3 no", () => {
  assert.deepEqual(trabajo.zonasQueNoArrancanSolas([]), []);
  assert.deepEqual(trabajo.zonasQueNoArrancanSolas(["CHATS", "BOT_VENTAS"]), []);
  assert.deepEqual(trabajo.zonasQueNoArrancanSolas(["CHATS", "META_ADS", "LIBRO_V3"]), ["META_ADS", "LIBRO_V3"]);
  // Desde el 26-oct-2026 CHATS también sube sola: ya no pide el sí final.
  assert.deepEqual(trabajo.zonasQuePidenTuSi(["CHATS"]), []);
});

prueba("laAprobacionDejaArrancar (regla 28-oct): voz cuenta como pantalla solo con CHATS / BOT_VENTAS; LIBRO_V3 y META_ADS piden pantalla", () => {
  const deja = trabajo.laAprobacionDejaArrancar;
  // Sin zona, cualquier vía (o ninguna).
  for (const via of ["pantalla", "voz", "automatica", "", null, undefined]) assert.equal(deja([], via), true, String(via));
  // Pantalla: siempre.
  for (const zona of ["CHATS", "BOT_VENTAS", "LIBRO_V3", "META_ADS"]) assert.equal(deja([zona], "pantalla"), true, zona);
  // Voz y automática: solo CHATS y/o BOT_VENTAS.
  assert.equal(deja(["CHATS"], "voz"), true, "voz + CHATS entra");
  assert.equal(deja(["BOT_VENTAS"], "voz"), true, "voz + BOT_VENTAS entra");
  assert.equal(deja(["CHATS", "BOT_VENTAS"], "voz"), true);
  assert.equal(deja(["CHATS", "BOT_VENTAS"], "automatica"), true);
  assert.equal(deja(["LIBRO_V3"], "voz"), false, "voz + LIBRO_V3 no entra");
  assert.equal(deja(["META_ADS"], "voz"), false, "voz + META_ADS no entra");
  assert.equal(deja(["CHATS", "LIBRO_V3"], "voz"), false, "una zona que pide pantalla frena a todas");
  assert.equal(deja(["LIBRO_V3"], "automatica"), false);
  // Sin vía conocida (o sin aprobación), con zona: no.
  assert.equal(deja(["CHATS"], ""), false);
  assert.equal(deja(["CHATS"], null), false);
  // Las zonas que esperan la pantalla y el texto de la alerta / la ficha.
  assert.deepEqual(trabajo.zonasQueEsperanLaPantalla(["CHATS", "LIBRO_V3"], "voz"), ["LIBRO_V3"]);
  assert.deepEqual(trabajo.zonasQueEsperanLaPantalla(["CHATS"], "voz"), []);
  assert.deepEqual(trabajo.zonasQueEsperanLaPantalla(["LIBRO_V3"], "pantalla"), []);
  assert.deepEqual(trabajo.zonasQueEsperanLaPantalla(["CHATS"], ""), ["CHATS"]);
  assert.equal(
    trabajo.textoDeAprobarEnPantalla("Arreglar el libro", ["LIBRO_V3"], "voz"),
    "«Arreglar el libro» está aprobada por voz pero toca Libro V3: apruébala en pantalla para que arranque",
  );
  assert.match(trabajo.textoDeAprobarEnPantalla("X", ["META_ADS"], ""), /aprobada por otra vía pero toca Meta Ads/);
});

prueba("aprobar en pantalla una APROBADO / PLAN_APROBADO que espera la pantalla (28-oct); si no espera, no", () => {
  const enPantalla = { via: "pantalla", origen: "PANTALLA", textoConfirmacion: undefined, zonaProtegida: ["LIBRO_V3"] };
  assert.equal(destino({ ...enPantalla, estado: "APROBADO", viaDeLaUltimaAprobacion: "voz" }), "APROBADO");
  assert.equal(destino({ ...enPantalla, momento: "plan", estado: "PLAN_APROBADO", tienePlan: true, viaDeLaUltimaAprobacion: "voz" }), "PLAN_APROBADO");
  // Ya aprobada en pantalla, o solo CHATS por voz (ya arranca), o sin saber la vía: "ya está aprobada".
  assert.match(destino({ ...enPantalla, estado: "APROBADO", viaDeLaUltimaAprobacion: "pantalla" }), /ya está aprobada/);
  assert.match(destino({ ...enPantalla, zonaProtegida: ["CHATS"], estado: "APROBADO", viaDeLaUltimaAprobacion: "voz" }), /ya está aprobada/);
  assert.match(destino({ ...enPantalla, estado: "APROBADO" }), /ya está aprobada/);
  // Por voz no se destraba (la voz no basta para LIBRO_V3).
  assert.match(destino({ zonaProtegida: ["LIBRO_V3"], estado: "APROBADO", viaDeLaUltimaAprobacion: "voz" }), /ya está aprobada/);
  // Solo el dueño (zona protegida).
  assert.match(destino({ ...enPantalla, estado: "APROBADO", viaDeLaUltimaAprobacion: "voz", persona: todo }), /solo el dueño/);
});

prueba("motivosDelResultado: archivos de riesgo, migración destructiva, zona o sin lista dan motivos", () => {
  const m = riesgo.motivosDelResultado;
  assert.deepEqual(m({ archivos: ["src/features/reportes/x.tsx"], migracionDestructiva: [], zonaProtegida: [] }), []);
  assert.deepEqual(m({ archivos: [], migracionDestructiva: null, zonaProtegida: [] }), []);
  assert.ok(m({ archivos: ["trabajador-tablero/lib/crm.mjs"], migracionDestructiva: [], zonaProtegida: [] }).length > 0);
  assert.ok(m({ archivos: ["src/a/b.ts"], migracionDestructiva: ["DROP"], zonaProtegida: [] }).some((x) => x.includes("DROP")));
  assert.ok(m({ archivos: ["src/a/b.ts"], migracionDestructiva: true, zonaProtegida: [] }).length > 0);
  assert.ok(m({ archivos: ["src/a/b.ts"], migracionDestructiva: [], zonaProtegida: ["CHATS"] }).length > 0);
  assert.ok(m({ archivos: null, migracionDestructiva: [], zonaProtegida: [] }).some((x) => x.includes("lista de archivos")));
});

prueba("resultadoDeEntrada guarda archivos (máx. 100) y migracionDestructiva, y sigue igual sin ellos", () => {
  const sin = trabajo.resultadoDeEntrada({ resumen: "Listo", paso: true });
  assert.equal("archivos" in sin, false);
  assert.equal("migracionDestructiva" in sin, false);
  const muchos = Array.from({ length: 150 }, (_, i) => `src/a/f${i}.ts`);
  const con = trabajo.resultadoDeEntrada({ resumen: "Listo", archivos: muchos, migracionDestructiva: ["DROP"] });
  assert.equal(con.archivos.length, 100);
  assert.deepEqual(con.migracionDestructiva, ["DROP"]);
  assert.deepEqual(trabajo.resultadoDeEntrada({ resumen: "Listo", archivos: [], migracionDestructiva: [] }).migracionDestructiva, []);
  // Un `true` suelto no se pierde: sigue siendo una migración destructiva.
  const verdadero = trabajo.resultadoDeEntrada({ resumen: "Listo", archivos: ["src/a/b.ts"], migracionDestructiva: true });
  assert.ok(verdadero.migracionDestructiva.length > 0);
});

prueba("riesgoDelPlan: si hay dos líneas RIESGO gana la ALTO, y el plan trae el título 'Archivos' repetido sin esconder la parte real", () => {
  const dos = riesgo.riesgoDelPlan("RIESGO: BAJO — sencillo\n\n1. Qué se cambia en los archivos\nUn texto.\n\nRIESGO: ALTO — toca dinero\n");
  assert.ok(dos.motivosAlto.length, "una línea ALTO basta");
  const repetido = riesgo.riesgoDelPlan(
    "RIESGO: BAJO — sencillo\n\n1. Qué se cambia en los archivos de la pantalla\nUn texto.\n\n5. Archivos que se tocan\n- trabajador-tablero/lib/etapas.mjs\n",
  );
  assert.ok(repetido.motivosAlto.some((motivo) => /trabajador/i.test(motivo)), "la parte real de archivos se revisa");
});

prueba("motivosDelResultado: un migration.sql sin migracionDestructiva es ALTO; una ruta de riesgo pasada la posición 100 también", () => {
  const sinCampo = riesgo.motivosDelResultado({
    archivos: ["src/app/cliente/reportes/page.tsx", "prisma/migrations/20261101000000_x/migration.sql"],
    migracionDestructiva: null,
    zonaProtegida: [],
  });
  assert.ok(sinCampo.length, "no se sabe si la migración es aditiva");
  const muchos = [...Array.from({ length: 150 }, (_, i) => `src/features/reportes/archivo-${i}.tsx`), "trabajador-tablero/lib/bucle.mjs"];
  assert.ok(riesgo.motivosDelResultado({ archivos: muchos, migracionDestructiva: [], zonaProtegida: [] }).length);
});

/* ------------------------------------------------------------------ hecho a mano */

const personaDeHecho = (extra) => ({ esDueno: false, esAdminPlataforma: false, aprobador: null, ...extra });
const pedidoDePantalla = (extra) => ({
  via: "pantalla",
  origen: "PANTALLA",
  estado: "ERROR",
  usaEstados: true,
  repo: "aizencrm",
  nota: "Lo subió Claude Code a mano",
  commit: undefined,
  persona: personaDeHecho({ esDueno: true }),
  ...extra,
});
const pedidoDeVoz = (extra) => pedidoDePantalla({ via: "voz", origen: "MCP", textoConfirmacion: "sí, márcala hecha", ...extra });

prueba("hecho a mano: el dueño marca HECHO desde ERROR, FALLIDO y POR_REVISAR, en pantalla y por voz", () => {
  for (const estado of ["ERROR", "FALLIDO", "POR_REVISAR"]) {
    assert.deepEqual(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ estado })), { nota: "Lo subió Claude Code a mano", commit: null }, estado);
    assert.ok(!("error" in trabajo.puedeMarcarHechoAMano(pedidoDeVoz({ estado }))), `${estado} voz`);
  }
});

prueba("hecho a mano: se niega si el Coordinador la tiene y en cualquier otro estado", () => {
  for (const estado of ["PLANEANDO", "EN_CURSO", "SUBIENDO"]) {
    assert.match(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ estado })).error, /Coordinador tiene/, estado);
  }
  for (const estado of ["POR_APROBAR", "APROBADO", "PLAN_LISTO", "PLAN_APROBADO", "IDEA", "HECHO"]) {
    assert.ok(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ estado })).error, estado);
  }
});

prueba("hecho a mano: solo el dueño (ni asesora, ni aprobador, ni ADMIN de la plataforma que no es la dueña)", () => {
  const otras = [
    personaDeHecho({}),
    personaDeHecho({ aprobador: { alcance: "TODO", puedeSubir: true } }),
    personaDeHecho({ esAdminPlataforma: true }),
  ];
  for (const persona of otras) {
    assert.match(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ persona })).error, /solo el dueño/);
    assert.match(trabajo.puedeMarcarHechoAMano(pedidoDeVoz({ persona })).error, /solo el dueño/);
  }
});

prueba("hecho a mano: sin repo, sin nota, con nota larga o con el commit mal escrito se niega", () => {
  assert.ok(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ repo: null })).error);
  assert.match(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ nota: "   " })).error, /nota/);
  assert.match(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ nota: undefined })).error, /nota/);
  assert.match(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ nota: "a".repeat(501) })).error, /muy larga/);
  assert.equal(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ nota: "a".repeat(500) })).nota.length, 500);
  for (const commit of ["abc", "xyz 123456", "desplegado", "zzzzzzzz", "a".repeat(41), "http://github.com/a/b/commit/abcdef1", "https://malo.com/a"]) {
    assert.match(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ commit })).error, /commit/, commit);
  }
  assert.equal(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ commit: " abcdef1 " })).commit, "abcdef1");
  assert.equal(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ commit: "A".repeat(40) })).commit, "A".repeat(40));
  const link = "https://github.com/alexmorer/AgenteLite/commit/abcdef1";
  assert.equal(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ commit: link })).commit, link);
  assert.equal(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ commit: "" })).commit, null);
});

prueba("hecho a mano por voz: 'sí, márcala hecha' vale; 'no la marques hecha', un texto corto o uno sin 'sí' no", () => {
  for (const texto of ["sí, márcala hecha", "Si, marcalo hecho", "sí, ponla hecha"]) {
    assert.equal(trabajo.textoDeConfirmacionParaHecho(texto), null, texto);
  }
  for (const texto of [
    "no la marques hecha",
    "sí, no la marques hecha",
    "sí, pero no la marcas hecha",
    "sí, no está hecha",
    "¿sí la marco hecha?",
    "sí, está hecha",
    "sí",
    "hecha",
    "márcala hecha",
    "sí, dale",
    undefined,
    5,
  ]) {
    assert.ok(trabajo.textoDeConfirmacionParaHecho(texto), String(texto));
  }
  assert.match(trabajo.puedeMarcarHechoAMano(pedidoDeVoz({ textoConfirmacion: undefined })).error, /márcala hecha/);
  assert.match(trabajo.puedeMarcarHechoAMano(pedidoDeVoz({ textoConfirmacion: "sí, no la marques hecha" })).error, /un "no"/);
  assert.ok(trabajo.puedeMarcarHechoAMano(pedidoDeVoz({ textoConfirmacion: "no la marques hecha" })).error);
});

prueba("hecho a mano: por el MCP solo por voz, en la pantalla solo con el botón, y el Coordinador nunca", () => {
  assert.ok(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ origen: "MCP" })).error);
  assert.ok(trabajo.puedeMarcarHechoAMano(pedidoDeVoz({ origen: "PANTALLA" })).error);
  assert.ok(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ origen: "TRABAJADOR" })).error);
  assert.ok(trabajo.puedeMarcarHechoAMano(pedidoDePantalla({ usaEstados: false })).error);
});

prueba("hecho a mano: lo de siempre no cambia (el HECHO común de una tarjeta con repo sigue negado, y dice cómo pedirlo)", () => {
  for (const de of ["ERROR", "FALLIDO", "POR_REVISAR"]) {
    assert.match(reglas.puedeCambiarEstado(de, "HECHO", true, true, true), /márcala hecha/, de);
  }
  assert.ok(reglas.puedeCambiarEstado("APROBADO", "HECHO", true, true, true));
  assert.doesNotMatch(reglas.puedeCambiarEstado("APROBADO", "HECHO", true, true, true), /márcala hecha/);
  assert.equal(reglas.puedeCambiarEstado("APROBADO", "HECHO", true, true, false), null);
  assert.equal(reglas.puedeCambiarEstado("EN_CURSO", "HECHO", true, true, false), null);
  assert.deepEqual([...reglas.ESTADOS_QUE_SE_MARCAN_HECHO_A_MANO], ["ERROR", "FALLIDO", "POR_REVISAR"]);
});

prueba("hecho a mano: el registro del historial guarda nota, commit, vía y texto, y se reconoce", () => {
  const registro = trabajo.registroDeHechoAMano({
    via: "voz",
    quienNombre: "Alexander",
    userId: "u1",
    nota: "Subido a mano",
    commit: "abcdef1",
    textoConfirmacion: "sí, márcala hecha",
  });
  assert.equal(registro.estado, "HECHO");
  assert.equal(registro.como, "marcado hecho a mano por el dueño (Alexander)");
  assert.equal(registro.nota, "Subido a mano");
  assert.equal(registro.commit, "abcdef1");
  assert.equal(registro.textoConfirmacion, "sí, márcala hecha");
  assert.ok(trabajo.esHechoAMano({ accion: "estado", despues: registro }));
  assert.ok(!trabajo.esHechoAMano({ accion: "estado", despues: { estado: "HECHO" } }));
  assert.ok(!trabajo.esHechoAMano({ accion: "aprobar", despues: registro }));
});

prueba("hecho a mano: deshacerlo se niega si venía de ERROR o POR_REVISAR y se permite si venía de FALLIDO", () => {
  const marca = (antes) =>
    cambio({ accion: "estado", antes: { estado: antes }, despues: { estado: "HECHO", hechoAMano: true, via: "voz" } });
  for (const antes of ["ERROR", "POR_REVISAR"]) {
    assert.ok(reglas.puedeDeshacer(marca(antes), [], "HECHO"), antes);
  }
  assert.equal(reglas.puedeDeshacer(marca("FALLIDO"), [], "HECHO"), null);
});

/* ------------------------------------------------------------------ el sí del plan (regla del dueño 24-oct) */

prueba("lineaAprobarPlan: lee SOLO y ESPERA TU SÍ con motivo; sin línea es null", () => {
  assert.deepEqual(riesgo.lineaAprobarPlan("RIESGO: BAJO — x\nAPROBAR PLAN: SOLO"), { espera: false, motivo: null });
  assert.deepEqual(riesgo.lineaAprobarPlan("**APROBAR PLAN:** solo"), { espera: false, motivo: null });
  const espera = riesgo.lineaAprobarPlan("APROBAR PLAN: ESPERA TU SÍ — toca los abonos");
  assert.equal(espera.espera, true);
  assert.equal(espera.motivo, "toca los abonos");
  assert.equal(riesgo.lineaAprobarPlan("Un plan cualquiera sin la línea"), null);
});

prueba("lineaAprobarPlan: si trae varias líneas gana la que espera", () => {
  const r = riesgo.lineaAprobarPlan("APROBAR PLAN: SOLO\nAPROBAR PLAN: ESPERA TU SÍ — dinero");
  assert.equal(r.espera, true);
});

prueba("porQueElPlanEsperaTuSi: la línea SOLO pasa; ESPERA TU SÍ da el motivo", () => {
  assert.equal(riesgo.porQueElPlanEsperaTuSi("Cambia una pantalla.\nAPROBAR PLAN: SOLO"), null);
  const motivo = riesgo.porQueElPlanEsperaTuSi("Cambia algo.\nAPROBAR PLAN: ESPERA TU SÍ — sube el gasto en Meta Ads");
  assert.ok(motivo.includes("espera tu sí"));
  // El motivo queda como lo escribió el Coordinador (mayúsculas y tildes).
  assert.ok(motivo.includes("sube el gasto en Meta Ads"), motivo);
  // La línea tolera puntuación: "ESPERA TU SÍ." y "ESPERA TU SÍ (motivo)".
  assert.ok(riesgo.porQueElPlanEsperaTuSi("Cambia algo.\nAPROBAR PLAN: ESPERA TU SÍ."));
  assert.ok(riesgo.porQueElPlanEsperaTuSi("Cambia algo.\nAPROBAR PLAN: ESPERA TU SÍ (toca Meta Ads)").includes("toca Meta Ads"));
});

prueba("porQueElPlanEsperaTuSi: archivos de abonos esperan aunque diga SOLO", () => {
  const motivo = riesgo.porQueElPlanEsperaTuSi("Archivos:\n- src/features/abonos/tabla.tsx\nAPROBAR PLAN: SOLO");
  assert.ok(motivo && motivo.includes("dinero"), motivo);
});

prueba("porQueElPlanEsperaTuSi: presupuesto, activar campañas o gasto en Meta Ads esperan", () => {
  const planes = [
    "Sube el presupuesto diario de la campaña.\nAPROBAR PLAN: SOLO",
    "Activar las campañas nuevas de Meta.\nAPROBAR PLAN: SOLO",
    "Lanzar una campaña de remarketing.",
    "Puede generar gasto en Meta Ads.\nAPROBAR PLAN: SOLO",
  ];
  for (const plan of planes) assert.ok(riesgo.porQueElPlanEsperaTuSi(plan), plan);
});

prueba("porQueElPlanEsperaTuSi: la línea GASTO EN META ADS: <qué> espera; con 'no' o ninguno, no", () => {
  assert.match(riesgo.porQueElPlanEsperaTuSi("APROBAR PLAN: SOLO\n**GASTO EN META ADS:** sube el tope diario"), /gasto en Meta Ads/);
  assert.match(riesgo.porQueElPlanEsperaTuSi("APROBAR PLAN: SOLO\nGASTO EN META ADS"), /gasto en Meta Ads/);
  assert.equal(riesgo.gastoDeclaradoEnElPlan("GASTO EN META ADS: no"), null);
  assert.equal(riesgo.gastoDeclaradoEnElPlan("GASTO EN META ADS: ninguno, solo lee reportes"), null);
  assert.equal(riesgo.gastoDeclaradoEnElPlan("Este plan no tiene gasto en Meta Ads."), null);
});

prueba("porQueElPlanEsperaTuSi: sin línea y hablando de abonos espera; sin línea y sin dinero pasa", () => {
  assert.ok(riesgo.porQueElPlanEsperaTuSi("Se cambia cómo se muestran los abonos en la lista."));
  assert.equal(riesgo.porQueElPlanEsperaTuSi("Se agrega un reporte de ventas por mes.\nArchivos:\n- src/features/reportes/Reporte.tsx"), null);
  // Con la línea SOLO, hablar de abonos en el texto no basta (solo cuentan los archivos y Meta).
  assert.equal(riesgo.porQueElPlanEsperaTuSi("Muestra los abonos en una lista.\nAPROBAR PLAN: SOLO"), null);
});

prueba("porQueElPlanEsperaTuSi: con la tarea aprobada por el dueño, el dinero de Gestión no pide un segundo sí", () => {
  const abonos = "Archivos:\n- src/features/abonos/tabla.tsx\nCRITERIOS DE ACEPTACIÓN:\n- la tabla muestra los abonos\nAPROBAR PLAN: SOLO";
  assert.equal(riesgo.porQueElPlanEsperaTuSi(abonos, { tareaAprobadaPorElDueno: true }), null);
  assert.equal(riesgo.porQueElPlanNuevoEsperaTuSi(abonos, { tareaAprobadaPorElDueno: true }), null);
  // Con false (o sin opción) da el motivo de Gestión de hoy.
  assert.match(riesgo.porQueElPlanEsperaTuSi(abonos, { tareaAprobadaPorElDueno: false }), /toca dinero/);
  assert.match(riesgo.porQueElPlanEsperaTuSi(abonos), /toca dinero/);
  assert.match(riesgo.porQueElPlanNuevoEsperaTuSi(abonos), /toca dinero/);
  // Sin la línea, las palabras de Gestión tampoco frenan.
  const palabras = "Se cambia cómo se muestran los abonos en la lista.";
  assert.equal(riesgo.porQueElPlanEsperaTuSi(palabras, { tareaAprobadaPorElDueno: true }), null);
  assert.match(riesgo.porQueElPlanEsperaTuSi(palabras), /dinero de Gestión/);
  // ESPERA TU SÍ con el único motivo de Gestión no frena; sin la opción, sí.
  const espera = "Cambia los saldos.\nAPROBAR PLAN: ESPERA TU SÍ — toca abonos y saldos de Gestión";
  assert.equal(riesgo.porQueElPlanEsperaTuSi(espera, { tareaAprobadaPorElDueno: true }), null);
  assert.match(riesgo.porQueElPlanEsperaTuSi(espera), /espera tu sí/);
});

prueba("porQueElPlanEsperaTuSi: con la tarea aprobada por el dueño, Meta Ads, preguntas, NECESITO y el agente necesita siguen esperando", () => {
  const si = { tareaAprobadaPorElDueno: true };
  assert.match(riesgo.porQueElPlanEsperaTuSi("APROBAR PLAN: SOLO\nGASTO EN META ADS: sube el tope diario", si), /gasto en Meta Ads/);
  assert.ok(riesgo.porQueElPlanEsperaTuSi("Activar las campañas nuevas de Meta.\nAPROBAR PLAN: SOLO", si));
  assert.match(riesgo.porQueElPlanEsperaTuSi("Cambia abonos.\nAPROBAR PLAN: ESPERA TU SÍ — zona META_ADS y abonos", si), /META_ADS/);
  assert.match(riesgo.porQueElPlanEsperaTuSi("Cambia abonos.\nAPROBAR PLAN: ESPERA TU SÍ — toca el LIBRO_V3 y los pagos", si), /LIBRO_V3/);
  assert.match(riesgo.porQueElPlanEsperaTuSi("Cambia abonos.\nAPROBAR PLAN: ESPERA TU SÍ — el agente necesita la clave de pagos", si), /el agente necesita/);
  // Sin motivo no se sabe que sea solo Gestión: sigue esperando.
  assert.ok(riesgo.porQueElPlanEsperaTuSi("Cambia algo.\nAPROBAR PLAN: ESPERA TU SÍ.", si));
  assert.match(riesgo.porQueElPlanEsperaTuSi("Cambia abonos.\nPREGUNTAS ABIERTAS:\n- ¿el abono mínimo es 35 % o 50 %?\nAPROBAR PLAN: SOLO", si), /preguntas abiertas/);
  assert.match(riesgo.porQueElPlanEsperaTuSi("Cambia abonos.\nNECESITO: acceso a la pasarela de pagos\nAPROBAR PLAN: SOLO", si), /necesita algo del dueño: acceso a la pasarela/);
  // Sin la opción, NECESITO no se mira acá (como hoy).
  assert.equal(riesgo.porQueElPlanEsperaTuSi("Cambia una pantalla.\nNECESITO: una clave\nAPROBAR PLAN: SOLO"), null);
  // Plan nuevo: criterios y supuestos de negocio siguen esperando.
  assert.match(riesgo.porQueElPlanNuevoEsperaTuSi("Cambia abonos.\nAPROBAR PLAN: SOLO", si), /CRITERIOS DE ACEPTACIÓN/);
  assert.match(
    riesgo.porQueElPlanNuevoEsperaTuSi("Cambia abonos.\nCRITERIOS DE ACEPTACIÓN:\n- se ve\nSUPUESTOS:\n- el precio baja 10 %\nAPROBAR PLAN: SOLO", si),
    /decisión de negocio/,
  );
  // La tarea con zona META_ADS sigue esperando (esa regla no cambia).
  assert.ok(riesgo.porQueLaTareaEsperaTuSi({ titulo: "x", detalle: "y", zonaProtegida: ["META_ADS"], zonasQueEsperan: ["META_ADS"] }));
});

prueba("tareaAprobadaPorElDuenoEnElHistorial: solo el sí de la tarea dado en pantalla o por voz", () => {
  const fila = (despues, accion = "aprobar") => [{ accion, despues }];
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial(fila({ momento: "tarea", via: "voz" })), true);
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial(fila({ momento: "tarea", via: "pantalla" })), true);
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial(fila({ momento: "tarea", via: "automatica" })), false);
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial(fila({ momento: "tarea" })), false);
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial(fila({ momento: "plan", via: "pantalla" })), false);
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial(fila({ momento: "tarea", via: "voz" }, "estado")), false);
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial(fila(null)), false);
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial([]), false);
  // Una hija que heredó el sí de su madre (via "pantalla") cuenta.
  const heredada = trabajo.registroDeAprobacion({ estado: "APROBADO", momento: "tarea", via: "pantalla", quienNombre: "el dueño (en la tarjeta madre)", userId: "u", textoConfirmacion: null });
  assert.equal(trabajo.tareaAprobadaPorElDuenoEnElHistorial(fila({ ...heredada, como: "heredada", heredadaDe: "madre" })), true);
});

/* ------------------------------------------------------------------ responsable de la tarjeta */

prueba("puedeAsignarResponsable: el dueño y el ADMIN (soloDe null) siempre; la dueña del tablero; otra persona no", () => {
  assert.equal(reglas.puedeAsignarResponsable(null, "u-ana"), true, "dueño del negocio o ADMIN en un tablero con dueña");
  assert.equal(reglas.puedeAsignarResponsable(null, null), true, "dueño del negocio en un tablero sin dueño");
  assert.equal(reglas.puedeAsignarResponsable("u-ana", "u-ana"), true, "la dueña del tablero");
  assert.equal(reglas.puedeAsignarResponsable("u-bruno", "u-ana"), false, "otra persona (solo ve la tarjeta que le asignaron)");
});

prueba("puedeAsignarResponsable: un tablero sin dueño solo lo asigna quien ve todo (soloDe null)", () => {
  assert.equal(reglas.puedeAsignarResponsable("u-ana", null), false);
  assert.equal(reglas.puedeAsignarResponsable("", null), false);
});

prueba("soloCambiaResponsable: solo si todo el cambio es el responsable", () => {
  assert.equal(reglas.soloCambiaResponsable(["responsableId"]), true);
  assert.equal(reglas.soloCambiaResponsable(["responsableId", "responsableId"]), true);
  assert.equal(reglas.soloCambiaResponsable(["responsableId", "titulo"]), false);
  assert.equal(reglas.soloCambiaResponsable(["titulo"]), false);
  assert.equal(reglas.soloCambiaResponsable(["responsableId", "riesgo"]), false);
  assert.equal(reglas.soloCambiaResponsable([]), false, "sin cambios no es 'solo el responsable'");
});

prueba("elegirMiembro con rol responsable: encuentra por id, email, nombre y nombre parcial", () => {
  const miembros = [
    { userId: "u1", nombre: "Emanuel Diaz", email: "emanuel@x.co" },
    { userId: "u2", nombre: "Ana Pérez", email: "ana@x.co" },
    { userId: "u3", nombre: "Ana Gómez", email: "ana2@x.co" },
  ];
  assert.equal(reglas.elegirMiembro(miembros, "Emanuel", "responsable").miembro.userId, "u1");
  assert.equal(reglas.elegirMiembro(miembros, "emanuel diaz", "responsable").miembro.userId, "u1");
  assert.equal(reglas.elegirMiembro(miembros, "ANA2@X.CO", "responsable").miembro.userId, "u3");
  assert.equal(reglas.elegirMiembro(miembros, "u2", "responsable").miembro.userId, "u2");
  assert.equal(reglas.elegirMiembro(miembros, "ana gomez", "responsable").miembro.userId, "u3");
});

prueba("elegirMiembro con rol responsable: los mensajes dicen 'responsable', no 'dueño'", () => {
  const miembros = [
    { userId: "u1", nombre: "Emanuel Diaz", email: "emanuel@x.co" },
    { userId: "u2", nombre: "Ana Pérez", email: "ana@x.co" },
    { userId: "u3", nombre: "Ana Gómez", email: "ana2@x.co" },
  ];
  assert.equal(reglas.elegirMiembro(miembros, "", "responsable").error, "Falta el responsable: el nombre o el email de una persona del negocio.");
  assert.equal(reglas.elegirMiembro(miembros, undefined, "responsable").error, "Falta el responsable: el nombre o el email de una persona del negocio.");
  const noExiste = reglas.elegirMiembro(miembros, "Zoe", "responsable").error;
  assert.ok(noExiste.includes('"Zoe" no es una persona activa de este negocio'), noExiste);
  assert.ok(noExiste.includes("Pueden ser responsables: Emanuel Diaz, Ana Pérez, Ana Gómez."), noExiste);
  assert.ok(!noExiste.includes("dueños"), noExiste);
  const ambiguo = reglas.elegirMiembro(miembros, "Ana", "responsable").error;
  assert.ok(ambiguo.includes("Hay más de una persona así"), ambiguo);
  assert.ok(ambiguo.includes("Ana Pérez (ana@x.co)") && ambiguo.includes("Ana Gómez (ana2@x.co)"), ambiguo);
  assert.ok(ambiguo.endsWith("Usa el email."), ambiguo);
  assert.ok(reglas.elegirMiembro([], "Zoe", "responsable").error.includes("Pueden ser responsables: nadie."));
});

prueba("elegirMiembro sin rol sigue diciendo 'dueño' (no se rompió lo de los tableros)", () => {
  const miembros = [{ userId: "u1", nombre: "Emanuel Diaz", email: "emanuel@x.co" }];
  assert.equal(reglas.elegirMiembro(miembros, "").error, "Falta el dueño: el nombre o el email de una persona del negocio.");
  assert.ok(reglas.elegirMiembro(miembros, "Zoe").error.includes("Pueden ser dueños: Emanuel Diaz."));
  assert.equal(reglas.elegirMiembro(miembros, "Emanuel").miembro.userId, "u1");
});

prueba("colorDeTipoValido y fondoSuaveDeTipo: hex válido, inválido y vacío", () => {
  assert.equal(reglas.colorDeTipoValido("#6366f1"), "#6366f1");
  assert.equal(reglas.colorDeTipoValido(" #FFF "), "#FFF");
  assert.equal(reglas.colorDeTipoValido("rojo"), null);
  assert.equal(reglas.colorDeTipoValido("#12345"), null);
  assert.equal(reglas.colorDeTipoValido(""), null);
  assert.equal(reglas.colorDeTipoValido(null), null);
  assert.match(reglas.fondoSuaveDeTipo("#6366f1"), /^color-mix\(in srgb, #6366f1 16%/);
});

prueba("inicialDeLaPersona: la inicial en mayúscula; '?' si no hay nombre", () => {
  assert.equal(reglas.inicialDeLaPersona("Emanuel"), "E");
  assert.equal(reglas.inicialDeLaPersona("emanuel diaz"), "E");
  assert.equal(reglas.inicialDeLaPersona("  ana pérez  "), "A");
  assert.equal(reglas.inicialDeLaPersona("Ñandú"), "Ñ");
  assert.equal(reglas.inicialDeLaPersona(""), "?");
  assert.equal(reglas.inicialDeLaPersona("   "), "?");
  assert.equal(reglas.inicialDeLaPersona(null), "?");
  assert.equal(reglas.inicialDeLaPersona(undefined), "?");
});

{
  // Área (A) > Idea (I) > Tareas; B es otra Área.
  const arbol = (extra = []) => [
    { id: "A", padreId: null, responsableId: null },
    { id: "I", padreId: "A", responsableId: null },
    { id: "T1", padreId: "I", responsableId: "u-ana" },
    { id: "T2", padreId: "I", responsableId: "u-bruno" },
    { id: "B", padreId: null, responsableId: null },
    { id: "I2", padreId: "B", responsableId: null },
    ...extra,
  ];

  prueba("tarjetasConMias: incluye las mías y todas sus madres (la carpeta con tareas mías no se apaga)", () => {
    const mias = reglasNiveles.tarjetasConMias(arbol(), "u-ana");
    assert.deepEqual([...mias].sort(), ["A", "I", "T1"]);
    assert.ok(!mias.has("T2") && !mias.has("B") && !mias.has("I2"));
  });

  prueba("tarjetasConMias: una madre que también es mía no se duplica; sin tarjetas mías, vacío", () => {
    const mias = reglasNiveles.tarjetasConMias(arbol([{ id: "T3", padreId: "T1", responsableId: "u-ana" }]), "u-ana");
    assert.deepEqual([...mias].sort(), ["A", "I", "T1", "T3"]);
    assert.equal(reglasNiveles.tarjetasConMias(arbol(), "u-nadie").size, 0);
    assert.equal(reglasNiveles.tarjetasConMias([], "u-ana").size, 0);
  });

  prueba("tarjetasConMias: ignora las borradas (ni ellas ni sus madres cuentan)", () => {
    const tarjetas = arbol().map((t) => (t.id === "T1" ? { ...t, borradoEn: new Date() } : t));
    assert.equal(reglasNiveles.tarjetasConMias(tarjetas, "u-ana").size, 0);
    // Una borrada con madre mía: la madre sigue contando por ser mía.
    const conMadreMia = [
      { id: "M", padreId: null, responsableId: "u-ana" },
      { id: "H", padreId: "M", responsableId: "u-ana", borradoEn: new Date() },
    ];
    assert.deepEqual([...reglasNiveles.tarjetasConMias(conMadreMia, "u-ana")], ["M"]);
  });

  prueba("tarjetasConMias: una madre que no está en la lista no rompe nada", () => {
    const mias = reglasNiveles.tarjetasConMias([{ id: "X", padreId: "no-existe", responsableId: "u-ana" }], "u-ana");
    assert.deepEqual([...mias], ["X"]);
  });

  prueba("tarjetasConMias: un ciclo en las madres no cuelga", () => {
    const ciclo = [
      { id: "P", padreId: "Q", responsableId: "u-ana" },
      { id: "Q", padreId: "R", responsableId: null },
      { id: "R", padreId: "P", responsableId: null },
      { id: "S", padreId: "S", responsableId: "u-ana" },
    ];
    const mias = reglasNiveles.tarjetasConMias(ciclo, "u-ana");
    assert.deepEqual([...mias].sort(), ["P", "Q", "R", "S"]);
  });
}

// ── Madres partidas, huérfanas y "cerrar como fallida" (26-oct-2026) ──────────────────────────
{
  const P = (...estados) => estados.map((estado) => ({ estado }));
  prueba("cierreDeLaMadre: HECHO si todas HECHO, FALLIDO si todas terminaron y alguna falló, null si alguna sigue o no hay", () => {
    assert.equal(trabajo.cierreDeLaMadre([]), null);
    assert.equal(trabajo.cierreDeLaMadre(P("HECHO", "EN_CURSO")), null);
    assert.equal(trabajo.cierreDeLaMadre(P("HECHO", "ERROR")), null, "una parte en ERROR todavía se puede reintentar");
    assert.equal(trabajo.cierreDeLaMadre(P("HECHO", "HECHO")), "HECHO");
    assert.equal(trabajo.cierreDeLaMadre(P("FALLIDO", "FALLIDO", "FALLIDO")), "FALLIDO", "«Paralelo de verdad»: sus 3 partes fallidas");
    assert.equal(trabajo.cierreDeLaMadre(P("HECHO", "FALLIDO")), "FALLIDO");
    assert.match(trabajo.notaDelCierreDeLaMadre(P("HECHO", "FALLIDO"), "FALLIDO"), /1 de sus 2 partes/);
    assert.match(trabajo.notaDelCierreDeLaMadre(P("HECHO", "HECHO"), "HECHO"), /sus 2 partes están hechas/);
  });

  prueba("esperaASusPartes: solo una madre partida con alguna parte viva sin terminar", () => {
    const partida = { partida: { hijas: ["h1", "h2"], causa: "x", cuando: "" } };
    assert.equal(trabajo.esperaASusPartes(partida, P("HECHO", "PLAN_APROBADO")), true);
    assert.equal(trabajo.esperaASusPartes(partida, P("FALLIDO", "FALLIDO")), false);
    assert.equal(trabajo.esperaASusPartes(partida, []), false, "sin partes vivas no espera a nadie: es huérfana");
    assert.equal(trabajo.esperaASusPartes({}, P("EN_CURSO")), false);
    assert.equal(trabajo.esperaASusPartes(null, P("EN_CURSO")), false);
  });

  prueba("huérfanas: el motivo es claro y el tiempo es 30 min", () => {
    assert.equal(trabajo.MINUTOS_PARA_HUERFANA, 30);
    assert.match(trabajo.MOTIVO_HUERFANA, /^Quedó huérfana: nadie la estaba trabajando/);
    assert.equal(trabajo.MOTIVO_HUERFANA.split("\n").length, 3);
  });

  prueba("vencidas y huérfanas (30-oct-2026): el motivo y la causa del intento llevan siempre la frase fija con el estado", () => {
    const sql = cargar("src/features/tableros-inteligentes/services/sql-trabajador.ts");
    for (const [consulta, frase] of [
      [sql.SQL_PASAR_VENCIDAS_A_ERROR, `'venció el candado en ' || x."antes" || ' sin respuesta del Coordinador'`],
      [sql.SQL_PASAR_HUERFANAS_A_ERROR, `'huérfana: ' || v."antes" || ' sin candado'`],
    ]) {
      // El motivo arranca con la frase (nunca vacío aunque $3 llegue vacío) y la fila de IntentoTarjeta también la usa.
      assert.ok(consulta.includes(`'motivo', ((${frase}) || COALESCE(E'\\n' || NULLIF(btrim($3::text), ''), ''))`), "motivo con la frase fija");
      assert.ok(consulta.split(frase).length >= 3, "la frase está en el motivo y en la causa del intento");
      assert.match(consulta, /AS "motivo"/, "devuelve el motivo guardado para el historial");
    }
  });

  const AHORA = new Date("2026-10-26T20:00:00Z");
  const base = {
    origen: "PANTALLA",
    estado: "ERROR",
    usaEstados: true,
    repo: "aizencrm",
    trabajoVenceEn: null,
    ahora: AHORA,
    esperaPartes: false,
    persona: { esDueno: true, esAdminPlataforma: false, aprobador: null },
  };
  const cerrar = (extra) => trabajo.puedeCerrarComoFallida({ ...base, ...extra });

  prueba("cerrar como fallida: ERROR y huérfanas (PLANEANDO / EN_CURSO sin candado o con candado vencido), dueño o ADMIN", () => {
    assert.equal(cerrar({}), null);
    assert.equal(cerrar({ estado: "PLANEANDO" }), null, "PLANEANDO sin candado (huérfana)");
    assert.equal(cerrar({ estado: "EN_CURSO" }), null, "EN_CURSO sin candado (huérfana, como «Retroactivos en Gestión»)");
    assert.equal(cerrar({ estado: "EN_CURSO", trabajoVenceEn: new Date("2026-10-26T19:59:00Z") }), null, "candado vencido");
    assert.equal(cerrar({ persona: { esDueno: false, esAdminPlataforma: true, aprobador: null } }), null, "el ADMIN de la plataforma también");
    // ERROR con un vencimiento viejo colgado no importa: ERROR no está en las manos del Coordinador.
    assert.equal(cerrar({ trabajoVenceEn: new Date("2099-01-01T00:00:00Z") }), null);
  });

  prueba("cerrar como fallida: nunca con el candado vigente, ni SUBIENDO, ni una madre que espera partes, ni fuera de la pantalla", () => {
    assert.match(cerrar({ estado: "EN_CURSO", trabajoVenceEn: new Date("2026-10-26T20:03:00Z") }), /El Coordinador tiene esta tarjeta/);
    assert.match(cerrar({ estado: "PLANEANDO", trabajoVenceEn: new Date("2026-10-26T20:00:01Z") }), /El Coordinador tiene esta tarjeta/);
    assert.match(cerrar({ estado: "SUBIENDO" }), /Está SUBIENDO/, "SUBIENDO pendiente es válida (pudo haber empujado a main)");
    for (const estado of ["POR_APROBAR", "APROBADO", "PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "HECHO", "FALLIDO", "IDEA"]) {
      assert.ok(cerrar({ estado }), `no desde ${estado}`);
    }
    assert.match(cerrar({ estado: "PLANEANDO", esperaPartes: true }), /espera a sus partes/);
    assert.equal(cerrar({ estado: "ERROR", esperaPartes: true }), null, "desde ERROR sí");
    assert.match(cerrar({ origen: "MCP" }), /solo en la pantalla/);
    assert.match(cerrar({ origen: "TRABAJADOR" }), /solo en la pantalla/);
    assert.match(cerrar({ repo: null }), /no tiene repo/);
    assert.match(cerrar({ usaEstados: false }), /carpetas/);
    assert.match(cerrar({ persona: { esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "TODO", puedeSubir: true } } }), /solo el dueño/);
  });

  prueba("registroDeCierreComoFallida: FALLIDO, por la pantalla, con quién y si estaba huérfana", () => {
    const r = trabajo.registroDeCierreComoFallida({ quienNombre: "Alexander", userId: "u1", antes: "EN_CURSO", esDueno: true });
    assert.deepEqual(r, {
      estado: "FALLIDO",
      cerradaComoFallida: true,
      via: "pantalla",
      quienNombre: "Alexander",
      userId: "u1",
      como: "cerrada como fallida por el dueño (Alexander)",
      huerfana: true,
    });
    assert.equal(trabajo.registroDeCierreComoFallida({ quienNombre: "Admin", userId: "u2", antes: "ERROR", esDueno: false }).huerfana, false);
    assert.match(trabajo.registroDeCierreComoFallida({ quienNombre: "Admin", userId: "u2", antes: "ERROR", esDueno: false }).como, /el ADMIN/);
  });

  prueba("estadoAlPonerRepo: una EN_CURSO de la fase 1 que recibe repo vuelve a POR_APROBAR (si no, quedaba huérfana)", () => {
    assert.equal(trabajo.estadoAlPonerRepo("EN_CURSO", null, "gestion"), "POR_APROBAR");
    assert.equal(trabajo.estadoAlPonerRepo("EN_CURSO", "gestion", "gestion"), "EN_CURSO");
    assert.equal(trabajo.estadoAlPonerRepo("EN_CURSO", null, null), "EN_CURSO", "sin repo sigue a mano");
    assert.equal(trabajo.estadoAlPonerRepo("APROBADO", null, "aizencrm"), "APROBADO");
    assert.equal(trabajo.estadoAlPonerRepo("IDEA", null, "aizencrm"), "IDEA");
  });
}

prueba("codigoDeTarjeta: T-<numero> sin ceros, y vacío sin número", () => {
  assert.equal(reglas.codigoDeTarjeta(123), "T-123");
  assert.equal(reglas.codigoDeTarjeta(1), "T-1");
  assert.equal(reglas.codigoDeTarjeta(null), "");
  assert.equal(reglas.codigoDeTarjeta(undefined), "");
});

prueba("el código T-123 llega a la tarjeta, al cuadrito, a la ficha y al MCP", async () => {
  const { readFileSync } = await import("node:fs");
  const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
  const servicio = leer("src/features/tableros-inteligentes/services/tableros.ts");
  assert.match(servicio, /const SELECT_TARJETA = \{\s*id: true,\s*numero: true,/);
  assert.match(servicio, /codigo: codigoDeTarjeta\(fila\.numero\)/);
  assert.match(leer("src/features/tableros-inteligentes/components/NodoTarjeta.tsx"), /data\.codigo \?/);
  assert.match(leer("src/features/tableros-inteligentes/components/FichaTarjeta.tsx"), /tarjeta\.codigo \?/);
  const mcp = leer("src/lib/mcp/tableros-inteligentes.ts");
  assert.match(mcp, /idDeTarjetaPorCodigo/);
  assert.ok((mcp.match(/codigo/g) ?? []).length >= 8, "el MCP devuelve codigo en las herramientas de tarjetas");
});

console.log(`\n${pruebas} pruebas, todas bien`);
