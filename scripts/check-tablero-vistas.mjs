// Pruebas del Tablero IA ESTILO NOTION (2-nov-2026): la lógica de las vistas Tabla, Tablero (kanban) y
// Calendario (services/vistas-de-tabla.ts): filtrar, ordenar, agrupar y buscar, las vistas de fábrica,
// que el menú de Estado y el kanban ofrezcan SOLO lo que permite puedeCambiarEstado, que la clave de
// AppSetting lleve el userId, y la limpieza de lo guardado. Además, que vistas-guardadas.ts lea y guarde
// por persona (con un prisma FALSO en memoria). No necesita base ni red.
// Correr: npm run test:tablero-vistas
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar } from "./supervisor-cargar.mjs";

const v = cargar("src/features/tableros-inteligentes/services/vistas-de-tabla.ts");
const reglas = cargar("src/features/tableros-inteligentes/services/reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  return Promise.resolve(fn()).then(() => {
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  });
}

/* ------------------------------------------------------------------ datos */

const tipos = [
  { id: "area", nombre: "Área", requiereAprobacion: false, usaEstados: false, orden: 0 },
  { id: "idea", nombre: "Idea", requiereAprobacion: false, usaEstados: true, orden: 1 },
  { id: "tarea", nombre: "Tarea", requiereAprobacion: true, usaEstados: true, orden: 2 },
];

let n = 0;
const tarjeta = (extra) => ({
  id: `t${(n += 1)}`,
  numero: n,
  codigo: `T-${n}`,
  titulo: `Tarjeta ${n}`,
  detalle: "",
  area: null,
  estado: "IDEA",
  fecha: null,
  tipoId: "idea",
  padreId: null,
  repo: null,
  responsableId: null,
  responsableNombre: null,
  urgente: false,
  ...extra,
});

const sistemas = tarjeta({ id: "sis", titulo: "Sistemas", tipoId: "area" });
const t1 = tarjeta({ titulo: "Tablero estilo Notion", detalle: "Una tabla como vista principal", area: "Sistemas", padreId: "sis", fecha: "2026-11-02T17:00:00.000Z", responsableId: "u1", responsableNombre: "Emanuel" });
const t2 = tarjeta({ titulo: "Cotizador nuevo", area: "Ventas", tipoId: "tarea", estado: "POR_APROBAR", urgente: true, responsableId: "u2", responsableNombre: "Alexander" });
const t3 = tarjeta({ titulo: "Arreglar avisos", area: "Sistemas", tipoId: "tarea", estado: "PLANEANDO", repo: "aizencrm", padreId: "sis", fecha: "2026-11-10T17:00:00.000Z" });
const t4 = tarjeta({ titulo: "Migrar chats", area: "sistemas", tipoId: "tarea", estado: "APROBADO", repo: "aizencrm" });
const t5 = tarjeta({ titulo: "Idea de marketing", area: null });
const t6 = tarjeta({ titulo: "Tarea sin repo en curso", tipoId: "tarea", estado: "EN_CURSO", area: "Ventas" });
const tarjetas = [sistemas, t1, t2, t3, t4, t5, t6];
const filas = v.filasDeLaTabla(tarjetas, tipos);
const fila = (id) => filas.find((f) => f.id === id);
const ids = (lista) => lista.map((f) => f.id);

/* ------------------------------------------------------------------ pruebas */

await prueba("una fila por tarjeta con las 9 columnas del plan", () => {
  assert.equal(filas.length, tarjetas.length);
  assert.deepEqual([...v.COLUMNAS], ["codigo", "titulo", "tipo", "area", "estado", "prioridad", "responsable", "fecha", "madre"]);
  assert.deepEqual(
    v.COLUMNAS.map((c) => v.NOMBRE_DE_LA_COLUMNA[c]),
    ["Código", "Título", "Tipo", "Área", "Estado", "Prioridad", "Responsable", "Fecha", "De qué cuelga"],
  );
  const f = fila(t1.id);
  assert.equal(f.codigo, "T-2");
  assert.equal(f.tipo, "Idea");
  assert.equal(f.estado, "IDEA");
  assert.equal(f.prioridad, "Normal");
  assert.equal(f.responsable, "Emanuel");
  assert.equal(f.fecha, "2026-11-02");
  assert.equal(f.madre, "Sistemas");
  assert.equal(fila(t2.id).prioridad, "Urgente");
  // Una carpeta (Área) no tiene estado.
  assert.equal(fila("sis").estado, null);
  assert.equal(v.textoDeColumna(fila("sis"), "estado"), "—");
});

await prueba("la fecha se muestra en el día de Colombia (no cambia de día)", () => {
  // Las fechas se guardan a mediodía de Colombia; una de madrugada UTC sigue siendo el día anterior allá.
  assert.equal(v.diaDeLaFecha("2026-11-03T03:00:00.000Z"), "2026-11-02");
  assert.equal(v.diaDeLaFecha(null), null);
  assert.equal(v.diaDeLaFecha("no-es-fecha"), null);
});

await prueba("filtro Tipo = Idea deja solo las ideas; Estado = IDEA solo las IDEA", () => {
  const ideas = v.aplicarConfig(filas, { ...v.CONFIG_VACIA, filtros: [{ columna: "tipo", valores: ["Idea"] }] });
  assert.ok(ideas.length > 0);
  assert.ok(ideas.every((f) => f.tipo === "Idea"));
  const enIdea = v.aplicarConfig(filas, { ...v.CONFIG_VACIA, filtros: [{ columna: "estado", valores: ["IDEA"] }] });
  assert.ok(enIdea.every((f) => f.estado === "IDEA"));
  assert.deepEqual(new Set(ids(enIdea)), new Set([t1.id, t5.id]));
});

await prueba("varios valores en un filtro se suman (o); varios filtros se cruzan (y)", () => {
  const r = v.aplicarConfig(filas, {
    ...v.CONFIG_VACIA,
    filtros: [
      { columna: "estado", valores: ["IDEA", "POR_APROBAR"] },
      { columna: "area", valores: ["Ventas"] },
    ],
  });
  assert.deepEqual(ids(r), [t2.id]);
  // El valor vacío filtra las que no tienen.
  const sinArea = v.aplicarConfig(filas, { ...v.CONFIG_VACIA, filtros: [{ columna: "area", valores: [""] }] });
  assert.deepEqual(new Set(ids(sinArea)), new Set(["sis", t5.id]));
});

await prueba("agrupar por Área: un grupo por área (sin importar tildes o mayúsculas) y el vacío al final", () => {
  const grupos = v.agruparFilas(filas, "area");
  assert.deepEqual(grupos.map((g) => g.nombre), ["Sistemas", "Ventas", "—"]);
  assert.equal(grupos[0].filas.length, 3);
  // Agrupar por responsable y por estado (en el orden de los estados).
  assert.deepEqual(v.agruparFilas(filas, "responsable").map((g) => g.nombre), ["Alexander", "Emanuel", "—"]);
  assert.deepEqual(v.agruparFilas(filas, "estado").map((g) => g.nombre), ["Idea", "Por aprobar", "Aprobado", "En curso", "Planeando", "—"]);
});

await prueba("buscar por texto del título, del detalle y por código", () => {
  assert.deepEqual(ids(v.aplicarConfig(filas, { ...v.CONFIG_VACIA, busqueda: "cotizador" })), [t2.id]);
  assert.deepEqual(ids(v.aplicarConfig(filas, { ...v.CONFIG_VACIA, busqueda: "VISTA PRINCIPAL" })), [t1.id]);
  assert.deepEqual(ids(v.aplicarConfig(filas, { ...v.CONFIG_VACIA, busqueda: "t-4" })), [t3.id]);
  assert.deepEqual(ids(v.aplicarConfig(filas, { ...v.CONFIG_VACIA, busqueda: "4" })), [t3.id]);
  // Sin tildes: "area" encuentra "Área" en el título.
  assert.deepEqual(ids(v.aplicarConfig([fila("sis")], { ...v.CONFIG_VACIA, busqueda: "SISTEMAS" })), ["sis"]);
  assert.equal(v.aplicarConfig(filas, { ...v.CONFIG_VACIA, busqueda: "no existe nada así" }).length, 0);
});

await prueba("ordenar por cualquier columna; los vacíos siempre al final", () => {
  const porCodigo = v.ordenarFilas(filas, { columna: "codigo", direccion: "asc" });
  assert.deepEqual(porCodigo.map((f) => f.numero), [1, 2, 3, 4, 5, 6, 7]);
  // Sin orden: la más nueva primero.
  assert.equal(v.ordenarFilas(filas, null)[0].numero, 7);
  const porFecha = v.ordenarFilas(filas, { columna: "fecha", direccion: "desc" });
  assert.deepEqual(ids(porFecha).slice(0, 2), [t3.id, t1.id]);
  assert.equal(porFecha.at(-1).fecha, null);
  const porFechaAsc = v.ordenarFilas(filas, { columna: "fecha", direccion: "asc" });
  assert.deepEqual(ids(porFechaAsc).slice(0, 2), [t1.id, t3.id]);
  const porPrioridad = v.ordenarFilas(filas, { columna: "prioridad", direccion: "asc" });
  assert.equal(porPrioridad[0].id, t2.id);
  const porEstado = v.ordenarFilas(filas, { columna: "estado", direccion: "asc" });
  assert.equal(porEstado[0].estado, "IDEA");
  assert.equal(porEstado.at(-1).estado, null);
  for (const columna of v.COLUMNAS) {
    for (const direccion of ["asc", "desc"]) assert.equal(v.ordenarFilas(filas, { columna, direccion }).length, filas.length);
  }
});

await prueba('vistas de fábrica: "Ideas" y "Sistemas en curso" filtran bien', () => {
  const [ideas, enCurso] = v.VISTAS_DE_FABRICA;
  assert.equal(ideas.nombre, "Ideas");
  assert.equal(enCurso.nombre, "Sistemas en curso");
  const r1 = v.aplicarConfig(filas, ideas.config);
  assert.ok(r1.length && r1.every((f) => f.estado === "IDEA"));
  const r2 = v.aplicarConfig(filas, enCurso.config);
  // Área Sistemas (también "sistemas") y estados en curso: APROBADO y PLANEANDO; no la IDEA.
  assert.deepEqual(new Set(ids(r2)), new Set([t3.id, t4.id]));
});

await prueba("el menú de Estado ofrece solo lo que permite puedeCambiarEstado (IDEA nunca a Aprobado)", () => {
  for (const f of filas.filter((x) => x.estado)) {
    const ofrecidos = v.estadosPermitidos(f);
    for (const estado of reglas.ESTADOS_TARJETA) {
      const permitido =
        estado !== f.estado &&
        reglas.puedeCambiarEstado(f.estado, estado, f.requiereAprobacion, f.usaEstados, f.conRepo) === null &&
        reglas.estadoPermitidoParaTipo(estado, f.requiereAprobacion, f.usaEstados) === null;
      assert.equal(ofrecidos.includes(estado), permitido, `${f.titulo}: ${estado}`);
    }
    assert.ok(!ofrecidos.includes("APROBADO"), "aprobar es el botón de la tarjeta");
  }
  // Una Tarea en IDEA: a Por aprobar sí, a Aprobado no.
  const tareaIdea = v.filasDeLaTabla([tarjeta({ tipoId: "tarea", estado: "IDEA" })], tipos)[0];
  assert.ok(v.estadosPermitidos(tareaIdea).includes("POR_APROBAR"));
  assert.ok(!v.estadosPermitidos(tareaIdea).includes("APROBADO"));
});

await prueba("una tarjeta PLANEANDO no deja cambiar el estado y da el motivo de la regla", () => {
  const f = fila(t3.id);
  assert.deepEqual(v.estadosPermitidos(f), []);
  assert.match(v.motivoSinCambios(f), /Coordinador tiene esta tarjeta/);
  assert.equal(v.motivoSinCambios(fila(t1.id)), null);
  assert.match(v.motivoSinCambios(fila("sis")), /carpetas/);
});

await prueba("kanban: columnas por estado, las del Coordinador juntas, sin carpetas", () => {
  const columnas = v.filasPorColumnaKanban(filas);
  assert.deepEqual([...columnas.keys()], [...v.COLUMNAS_KANBAN]);
  assert.deepEqual(ids(columnas.get("IDEA")), [t1.id, t5.id]);
  assert.deepEqual(ids(columnas.get(v.COLUMNA_COORDINADOR)), [t3.id]);
  assert.equal(v.nombreDeColumnaKanban(v.COLUMNA_COORDINADOR), "Con el Coordinador");
  assert.ok(![...columnas.values()].flat().some((f) => f.id === "sis"));
  for (const estado of reglas.ESTADOS_DE_LA_FASE_2) assert.equal(v.columnaKanbanDe(estado), v.COLUMNA_COORDINADOR);
});

await prueba("kanban: soltar solo donde la regla deja; si no, el mismo motivo que el servidor", () => {
  // Tarea POR_APROBAR -> EN_CURSO: no (hay que aprobarla primero).
  const tarea = fila(t2.id);
  assert.equal(v.motivoParaSoltar(tarea, "EN_CURSO"), reglas.puedeCambiarEstado("POR_APROBAR", "EN_CURSO", true, true, false));
  assert.ok(v.motivoParaSoltar(tarea, "EN_CURSO"));
  assert.ok(v.motivoParaSoltar(tarea, "APROBADO"), "aprobar no se arrastra");
  assert.equal(v.motivoParaSoltar(tarea, "IDEA"), null);
  // Nunca a la columna del Coordinador, y nada sale de PLANEANDO.
  assert.ok(v.motivoParaSoltar(fila(t1.id), v.COLUMNA_COORDINADOR));
  assert.ok(v.motivoParaSoltar(fila(t3.id), "FALLIDO"));
  // Con repo: EN_CURSO y HECHO los pone el Coordinador.
  assert.ok(v.motivoParaSoltar(fila(t4.id), "EN_CURSO"));
  assert.ok(v.motivoParaSoltar(fila(t4.id), "HECHO"));
  // Sin repo, EN_CURSO -> HECHO sí.
  assert.equal(v.motivoParaSoltar(fila(t6.id), "HECHO"), null);
  // Cada columna del kanban acepta exactamente lo que ofrece el menú de Estado.
  for (const f of filas.filter((x) => x.estado)) {
    for (const columna of v.COLUMNAS_KANBAN) {
      if (columna === f.estado) continue;
      const deja = v.motivoParaSoltar(f, columna) === null;
      assert.equal(deja, columna !== v.COLUMNA_COORDINADOR && v.estadosPermitidos(f).includes(columna), `${f.titulo} -> ${columna}`);
    }
  }
});

await prueba("calendario: cada tarjeta con fecha en su día y las demás en Sin fecha", () => {
  const { porDia, sinFecha } = v.filasPorDia(filas);
  assert.deepEqual(ids(porDia.get("2026-11-02")), [t1.id]);
  assert.deepEqual(ids(porDia.get("2026-11-10")), [t3.id]);
  assert.equal(sinFecha.length, filas.length - 2);
});

await prueba("la clave de AppSetting lleva el userId", () => {
  assert.equal(v.claveDeVistas("user_123"), "tablero-ia:vistas:user_123");
  assert.notEqual(v.claveDeVistas("a"), v.claveDeVistas("b"));
  assert.throws(() => v.claveDeVistas(""), /persona/);
});

await prueba("lo guardado se limpia: valores dañados no rompen la pantalla", () => {
  assert.deepEqual(v.limpiarPreferencias("{no es json"), { ultimaVista: "tabla", guardadas: [] });
  assert.deepEqual(v.limpiarPreferencias(null), { ultimaVista: "tabla", guardadas: [] });
  const limpio = v.limpiarPreferencias(
    JSON.stringify({
      ultimaVista: "calendario",
      guardadas: [
        { id: "a", nombre: "Mías", config: { busqueda: "x", filtros: [{ columna: "estado", valores: ["IDEA", 3] }, { columna: "inventada", valores: ["y"] }], orden: { columna: "fecha", direccion: "desc" }, agrupar: "area" } },
        { id: "a", nombre: "Repetida", config: {} },
        { id: "fabrica:ideas", nombre: "Pirata", config: {} },
        { id: "b", nombre: "", config: {} },
      ],
    }),
  );
  assert.equal(limpio.ultimaVista, "calendario");
  assert.equal(limpio.guardadas.length, 1);
  assert.deepEqual(limpio.guardadas[0].config, {
    busqueda: "x",
    filtros: [{ columna: "estado", valores: ["IDEA"] }],
    orden: { columna: "fecha", direccion: "desc" },
    agrupar: "area",
  });
  assert.equal(v.limpiarPreferencias({ ultimaVista: "otra" }).ultimaVista, "tabla");
});

await prueba("guardar una vista: con nombre, reemplaza la del mismo nombre, no pisa las de fábrica", () => {
  const p1 = v.agregarVista(v.PREFERENCIAS_INICIALES, " Mis ideas ", { filtros: [{ columna: "tipo", valores: ["Idea"] }] }, "id1");
  assert.equal(p1.guardadas.length, 1);
  assert.equal(p1.guardadas[0].nombre, "Mis ideas");
  const p2 = v.agregarVista(p1, "mis ideas", { agrupar: "area" }, "id2");
  assert.equal(p2.guardadas.length, 1);
  assert.equal(p2.guardadas[0].id, "id1");
  assert.equal(p2.guardadas[0].config.agrupar, "area");
  assert.throws(() => v.agregarVista(p1, "  ", {}, "x"), /nombre/);
  assert.throws(() => v.agregarVista(p1, "Ideas", {}, "x"), /fábrica/);
  let p = v.PREFERENCIAS_INICIALES;
  for (let i = 0; i < v.MAX_VISTAS_GUARDADAS; i += 1) p = v.agregarVista(p, `Vista ${i}`, {}, `v${i}`);
  assert.throws(() => v.agregarVista(p, "Una más", {}, "z"), /hasta/);
});

await prueba("vistas-guardadas.ts: cada persona lee y guarda lo suyo en AppSetting", async () => {
  const filasAppSetting = new Map();
  const prisma = {
    appSetting: {
      findUnique: async ({ where }) => (filasAppSetting.has(where.key) ? { value: filasAppSetting.get(where.key) } : null),
      upsert: async ({ where, create, update }) => {
        filasAppSetting.set(where.key, filasAppSetting.has(where.key) ? update.value : create.value);
      },
    },
  };
  const servicio = cargar("src/features/tableros-inteligentes/services/vistas-guardadas.ts", { "@/lib/prisma": { prisma } });
  assert.deepEqual(await servicio.leerPreferenciasDeVistas("ana"), { ultimaVista: "tabla", guardadas: [] });
  await servicio.guardarUltimaVista("ana", "calendario");
  await assert.rejects(servicio.guardarUltimaVista("ana", "inventada"), /no existe/);
  await servicio.guardarVistaConNombre("ana", "Urgentes", { filtros: [{ columna: "prioridad", valores: ["Urgente"] }] });
  assert.deepEqual([...filasAppSetting.keys()], ["tablero-ia:vistas:ana"]);
  const ana = await servicio.leerPreferenciasDeVistas("ana");
  assert.equal(ana.ultimaVista, "calendario");
  assert.equal(ana.guardadas[0].nombre, "Urgentes");
  // Otra persona sigue en su propia vista.
  assert.deepEqual(await servicio.leerPreferenciasDeVistas("beto"), { ultimaVista: "tabla", guardadas: [] });
  const quedan = await servicio.borrarVistaGuardada("ana", ana.guardadas[0].id);
  assert.deepEqual(quedan, []);
  assert.equal((await servicio.leerPreferenciasDeVistas("ana")).ultimaVista, "calendario");
});

await prueba("la acción cambia el estado con la regla de siempre (cambiarEstadoTarjeta, origen PANTALLA) y no aprueba", () => {
  const codigo = fs.readFileSync("src/app/actions/tablero-ia-vistas-actions.ts", "utf8");
  assert.match(codigo, /^"use server";/);
  assert.match(codigo, /cambiarEstadoTarjeta\(contexto, tarjetaId, estado\)/);
  assert.match(codigo, /origen: "PANTALLA"/);
  assert.match(codigo, /editarTarjeta\(contexto, tarjetaId, permitidos\)/);
  assert.doesNotMatch(codigo, /aprobarTarjeta/);
  // El userId de las vistas sale de la sesión, no de lo que manda la pantalla.
  assert.match(codigo, /const \{ userId \} = await sesion\(\);/);
});

console.log(`\n${pruebas} pruebas OK`);
