// Pruebas de las VISTAS del Tablero IA (estilo Notion, 3-nov-2026): Tabla, Tablero (kanban), Calendario.
// Carga el services/vistas-de-tabla.ts REAL (filtrar, ordenar, agrupar, buscar, vistas de fábrica, kanban)
// y el services/vistas-guardadas.ts REAL con un prisma FALSO en memoria (la clave de AppSetting por persona).
// También revisa que la acción nueva pase por el servicio de siempre (origen PANTALLA). No necesita base ni red.
// Correr: npm run test:tablero-vistas
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const vistas = cargar("src/features/tableros-inteligentes/services/vistas-de-tabla.ts");
const reglas = cargar("src/features/tableros-inteligentes/services/reglas.ts");

// Prisma falso: solo appSetting.
const ajustes = new Map();
const prismaFalso = {
  appSetting: {
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { key: where.key, value: ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value);
      return { key: where.key, value: ajustes.get(where.key) };
    },
  },
};
const guardadas = cargar("src/features/tableros-inteligentes/services/vistas-guardadas.ts", {
  "@/lib/prisma": { prisma: prismaFalso },
});

let pasaron = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    pasaron += 1;
    console.log(`  ok  ${nombre}`);
  } catch (fallo) {
    console.error(`FALLA ${nombre}`);
    throw fallo;
  }
}

/* ------------------------------------------------------------------ datos */

const TIPOS = [
  { id: "area", nombre: "Área", requiereAprobacion: false, usaEstados: false, orden: 0 },
  { id: "idea", nombre: "Idea", requiereAprobacion: false, usaEstados: true, orden: 1 },
  { id: "tarea", nombre: "Tarea", requiereAprobacion: true, usaEstados: true, orden: 2 },
];

let n = 0;
function tarjeta(datos) {
  n += 1;
  return {
    id: `t${n}`,
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
    urgente: false,
    responsableId: null,
    responsableNombre: null,
    ...datos,
  };
}

const sistemas = tarjeta({ titulo: "Sistemas", tipoId: "area" });
const ventas = tarjeta({ titulo: "Ventas", tipoId: "area", area: "Ventas" });
const idea1 = tarjeta({ titulo: "Tabla estilo Notion", detalle: "Vista principal en tabla", padreId: sistemas.id, responsableId: "u-ema", responsableNombre: "Emanuel" });
const idea2 = tarjeta({ titulo: "Mejorar avisos", area: "Ventas", fecha: "2026-11-10T17:00:00.000Z" });
const tareaPorAprobar = tarjeta({ titulo: "Subir calendario", tipoId: "tarea", estado: "POR_APROBAR", area: "sistemas", urgente: true });
const tareaIdea = tarjeta({ titulo: "Tarea en idea", tipoId: "tarea", estado: "IDEA", area: "Sistemas" });
const planeando = tarjeta({ titulo: "Algo con repo", tipoId: "tarea", estado: "PLANEANDO", repo: "aizencrm", area: "Sistemas", responsableId: "u-alex", responsableNombre: "Alex" });
const enCursoRepo = tarjeta({ titulo: "Construyendo", tipoId: "tarea", estado: "EN_CURSO", repo: "aizencrm", padreId: sistemas.id });
const aprobada = tarjeta({ titulo: "Aprobada sin repo", tipoId: "tarea", estado: "APROBADO", padreId: ventas.id, fecha: "2026-11-03T17:00:00.000Z" });
const TARJETAS = [sistemas, ventas, idea1, idea2, tareaPorAprobar, tareaIdea, planeando, enCursoRepo, aprobada];
const filas = vistas.filasDeTabla(TARJETAS, TIPOS);
const fila = (t) => filas.find((f) => f.tarjeta.id === t.id);
const ids = (lista) => lista.map((f) => f.tarjeta.id);

/* ------------------------------------------------------------------ pruebas */

await prueba("las columnas de la tabla son las del plan, en orden", () => {
  assert.deepEqual(
    vistas.COLUMNAS.map((c) => c.nombre),
    ["Código", "Título", "Tipo", "Área", "Estado", "Prioridad", "Responsable", "Fecha"],
  );
  assert.equal(filas.length, TARJETAS.length, "una fila por tarjeta");
});

await prueba("la vista por defecto es Tabla y las vistas son Tabla, Tablero, Calendario y Mapa", () => {
  assert.equal(vistas.VISTA_POR_DEFECTO, "tabla");
  assert.deepEqual([...vistas.VISTAS], ["tabla", "tablero", "calendario", "mapa"]);
  assert.equal(vistas.esVista("mapa"), true);
  assert.equal(vistas.esVista("lista"), false);
});

await prueba("valor de cada columna: área heredada de la carpeta, prioridad, fecha y carpetas sin estado", () => {
  assert.equal(fila(idea1).area, "Sistemas");
  assert.equal(fila(idea1).areaHeredada, true);
  assert.equal(fila(idea2).areaHeredada, false);
  assert.deepEqual(vistas.valorDeColumna(fila(tareaPorAprobar), "prioridad"), { clave: "URGENTE", texto: "Urgente" });
  assert.deepEqual(vistas.valorDeColumna(fila(idea2), "prioridad"), { clave: "NORMAL", texto: "Normal" });
  assert.equal(vistas.valorDeColumna(fila(sistemas), "estado").clave, "", "una carpeta no es una idea");
  assert.equal(vistas.valorDeColumna(fila(idea2), "fecha").clave, "2026-11");
  assert.equal(vistas.diaDeBogota("2026-11-10T17:00:00.000Z"), "2026-11-10");
  assert.equal(vistas.diaDeBogota("2026-11-04T03:00:00.000Z"), "2026-11-03", "el día es el de Colombia");
  assert.equal(vistas.diaDeBogota(null), null);
});

await prueba("filtrar: Tipo = Idea deja solo tarjetas de tipo Idea; varias columnas se suman", () => {
  const soloIdeas = vistas.filtrarFilas(filas, { busqueda: "", filtros: { tipo: ["idea"] } });
  assert.deepEqual(ids(soloIdeas), [idea1.id, idea2.id]);
  const ventasUrgentes = vistas.filtrarFilas(filas, { busqueda: "", filtros: { area: ["sistemas"], prioridad: ["URGENTE"] } });
  assert.deepEqual(ids(ventasUrgentes), [tareaPorAprobar.id]);
  const porResponsable = vistas.filtrarFilas(filas, { busqueda: "", filtros: { responsable: ["u-ema", ""] } });
  assert.ok(porResponsable.every((f) => f.tarjeta.responsableId !== "u-alex"));
  assert.equal(vistas.filtrarFilas(filas, { busqueda: "", filtros: { tipo: [] } }).length, filas.length, "filtro vacío = todas");
});

await prueba("buscar en título, detalle y código (sin tildes ni mayúsculas)", () => {
  assert.deepEqual(ids(vistas.filtrarFilas(filas, { busqueda: "NOTION", filtros: {} })), [idea1.id]);
  assert.deepEqual(ids(vistas.filtrarFilas(filas, { busqueda: "vista principal", filtros: {} })), [idea1.id]);
  assert.deepEqual(ids(vistas.filtrarFilas(filas, { busqueda: "T-4", filtros: {} })), [idea2.id]);
  assert.deepEqual(ids(vistas.filtrarFilas(filas, { busqueda: "t4", filtros: {} })), [idea2.id]);
  assert.deepEqual(ids(vistas.filtrarFilas(filas, { busqueda: "4", filtros: {} })), [idea2.id]);
  assert.deepEqual(ids(vistas.filtrarFilas(filas, { busqueda: "cámara", filtros: {} })), [], "nada que diga cámara");
  assert.equal(vistas.filtrarFilas(filas, { busqueda: "  ", filtros: {} }).length, filas.length);
});

await prueba("ordenar por cualquier columna, en las dos direcciones, sin tocar la lista", () => {
  const copia = [...filas];
  const porCodigoDesc = vistas.ordenarFilas(filas, { columna: "codigo", direccion: "desc" });
  assert.equal(porCodigoDesc[0].tarjeta.id, aprobada.id);
  assert.deepEqual(filas, copia);
  const porPrioridad = vistas.ordenarFilas(filas, { columna: "prioridad", direccion: "asc" });
  assert.equal(porPrioridad[0].tarjeta.id, tareaPorAprobar.id, "urgente primero");
  const porFecha = vistas.ordenarFilas(filas, { columna: "fecha", direccion: "asc" });
  assert.deepEqual(ids(porFecha.slice(0, 2)), [aprobada.id, idea2.id]);
  const porTitulo = vistas.ordenarFilas(filas, { columna: "titulo", direccion: "asc" });
  assert.equal(porTitulo[0].tarjeta.titulo, "Algo con repo");
  for (const { clave } of vistas.COLUMNAS) {
    assert.equal(vistas.ordenarFilas(filas, { columna: clave, direccion: "asc" }).length, filas.length, clave);
  }
  assert.deepEqual(ids(vistas.ordenarFilas(filas, null)), ids(filas));
});

await prueba("agrupar por Área: un grupo por área (sin mayúsculas ni tildes) y 'Sin área' al final", () => {
  const grupos = vistas.agrupar(filas, "area");
  assert.deepEqual(grupos.map((g) => g.texto), ["Sistemas", "Ventas", "Sin área"]);
  assert.equal(grupos[0].filas.length, 5, "las que dicen sistemas y las que cuelgan de la carpeta Sistemas");
  for (const columna of vistas.COLUMNAS_CON_OPCIONES) {
    const total = vistas.agrupar(filas, columna).reduce((s, g) => s + g.filas.length, 0);
    assert.equal(total, filas.length, `agrupar por ${columna} no pierde filas`);
  }
  const porResponsable = vistas.aplicarConfig(filas, { ...vistas.CONFIG_VACIA, agrupar: "responsable" });
  assert.deepEqual(porResponsable.map((g) => g.texto), ["Alex", "Emanuel", "Nadie"]);
});

await prueba("vistas de fábrica: Ideas (estado IDEA) y Sistemas en curso", () => {
  const [ideas, sistemasEnCurso] = vistas.VISTAS_DE_FABRICA;
  assert.equal(ideas.nombre, "Ideas");
  assert.equal(sistemasEnCurso.nombre, "Sistemas en curso");
  const filasIdeas = vistas.aplicarConfig(filas, ideas.config)[0].filas;
  assert.deepEqual(ids(filasIdeas), [idea1.id, idea2.id, tareaIdea.id]);
  assert.ok(filasIdeas.every((f) => f.tarjeta.estado === "IDEA" && f.usaEstados), "las carpetas no son ideas");
  const filasSistemas = vistas.aplicarConfig(filas, sistemasEnCurso.config)[0].filas;
  assert.deepEqual(ids(filasSistemas), [planeando.id, enCursoRepo.id]);
});

await prueba("la Tabla esconde Hecho y Fallido salvo que se filtre por Estado; las carpetas se quedan", () => {
  // Datos propios para no cambiar los de las pruebas de arriba.
  const carpeta = tarjeta({ titulo: "Carpeta Cierres", tipoId: "area" });
  const hecha1 = tarjeta({ titulo: "Cierre de caja listo", tipoId: "tarea", estado: "HECHO", padreId: carpeta.id });
  const hecha2 = tarjeta({ titulo: "Otra terminada", estado: "HECHO" });
  const fallida = tarjeta({ titulo: "Cierre que falló", tipoId: "tarea", estado: "FALLIDO" });
  const ideaViva = tarjeta({ titulo: "Cierre semanal", estado: "IDEA" });
  const enCurso = tarjeta({ titulo: "Algo en curso", tipoId: "tarea", estado: "EN_CURSO" });
  const lista = vistas.filasDeTabla([carpeta, hecha1, hecha2, fallida, ideaViva, enCurso], TIPOS);
  const deLaTabla = (config) => ids(vistas.aplicarConfig(lista, config).flatMap((g) => g.filas));

  assert.deepEqual([...vistas.ESTADOS_OCULTOS_EN_TABLA], ["HECHO", "FALLIDO"]);
  // a) sin filtros: ni Hecho ni Fallido; la carpeta sin estado sí.
  assert.deepEqual(deLaTabla(vistas.CONFIG_VACIA), [carpeta.id, ideaViva.id, enCurso.id]);
  // b) filtro de Estado = Hecho: solo las hechas.
  assert.deepEqual(deLaTabla({ ...vistas.CONFIG_VACIA, filtros: { estado: ["HECHO"] } }), [hecha1.id, hecha2.id]);
  // c) Hecho o Idea: las hechas y las ideas.
  assert.deepEqual(deLaTabla({ ...vistas.CONFIG_VACIA, filtros: { estado: ["HECHO", "IDEA"] } }), [hecha1.id, hecha2.id, ideaViva.id]);
  // d) buscar sin filtro de Estado no trae terminadas.
  assert.deepEqual(deLaTabla({ ...vistas.CONFIG_VACIA, busqueda: "cierre" }), [carpeta.id, ideaViva.id]);
  // Agrupado tampoco las trae (la regla va antes de agrupar).
  const agrupadas = vistas.aplicarConfig(lista, { ...vistas.CONFIG_VACIA, agrupar: "estado" });
  assert.ok(!agrupadas.some((g) => g.clave === "HECHO" || g.clave === "FALLIDO"), "sin grupos de terminadas");
  // e) el contador de escondidas.
  assert.equal(vistas.contarTerminadasOcultas(lista, vistas.CONFIG_VACIA), 3);
  assert.equal(vistas.contarTerminadasOcultas(lista, { ...vistas.CONFIG_VACIA, busqueda: "cierre" }), 2, "cuenta después de buscar");
  assert.equal(vistas.contarTerminadasOcultas(lista, { ...vistas.CONFIG_VACIA, filtros: { estado: ["HECHO"] } }), 0);
  assert.equal(vistas.contarTerminadasOcultas(lista, { ...vistas.CONFIG_VACIA, filtros: { estado: ["HECHO", "IDEA"] } }), 0);
  // ocultarTerminadas no toca la lista que llega.
  const copia = [...lista];
  vistas.ocultarTerminadas(lista, {});
  assert.deepEqual(lista, copia);
});

await prueba("una vista que llega de afuera se limpia (columnas y valores raros fuera)", () => {
  const limpia = vistas.limpiarConfig({
    busqueda: 42,
    filtros: { tipo: ["idea", 3, "idea"], inventada: ["x"], area: "no-es-lista" },
    orden: { columna: "titulo", direccion: "subiendo" },
    agrupar: "codigo",
  });
  assert.deepEqual(limpia, { busqueda: "", filtros: { tipo: ["idea"] }, orden: null, agrupar: null });
  assert.deepEqual(vistas.limpiarConfig(null), vistas.CONFIG_VACIA);
  assert.deepEqual(vistas.limpiarConfig({ orden: { columna: "fecha", direccion: "desc" }, agrupar: "area" }).orden, {
    columna: "fecha",
    direccion: "desc",
  });
});

await prueba("una vista guardada que usaba «De qué cuelga» (madre) llega limpia", () => {
  const limpia = vistas.limpiarConfig({ orden: { columna: "madre", direccion: "asc" }, agrupar: "madre", filtros: { madre: ["x"] } });
  assert.equal(limpia.orden, null);
  assert.equal(limpia.agrupar, null);
  assert.deepEqual(limpia.filtros, {});
});

await prueba("menú de Estado: IDEA no ofrece Aprobado; PLANEANDO no deja cambiar y dice el motivo de la regla", () => {
  const deIdea = vistas.estadosPermitidos(fila(tareaIdea));
  assert.ok(!deIdea.includes("APROBADO"));
  assert.deepEqual(deIdea, ["POR_APROBAR"]);
  assert.equal(vistas.motivoSinCambios(fila(tareaIdea)), null);
  assert.deepEqual(vistas.estadosPermitidos(fila(planeando)), []);
  assert.match(vistas.motivoSinCambios(fila(planeando)), /El Coordinador tiene esta tarjeta/);
  assert.deepEqual(vistas.estadosPermitidos(fila(sistemas)), [], "las carpetas no tienen estado");
  // Lo que ofrece el menú es exactamente lo que deja la regla del servidor.
  for (const f of filas) {
    for (const estado of vistas.estadosPermitidos(f)) {
      assert.equal(reglas.puedeCambiarEstado(f.tarjeta.estado, estado, f.requiereAprobacion, f.usaEstados, Boolean(f.tarjeta.repo)), null);
      assert.notEqual(estado, "APROBADO");
    }
  }
});

await prueba("kanban: columnas por estado, el Coordinador junto y sin arrastre, carpetas fuera", () => {
  assert.deepEqual(
    vistas.COLUMNAS_DEL_KANBAN.map((c) => c.nombre),
    ["Idea", "Por aprobar", "Aprobado", "En curso", "Con el Coordinador", "Hecho", "Fallido"],
  );
  assert.equal(vistas.columnaDelKanban(fila(sistemas)), null);
  assert.equal(vistas.columnaDelKanban(fila(planeando)), vistas.COLUMNA_DEL_COORDINADOR);
  assert.equal(vistas.columnaDelKanban(fila(enCursoRepo)), vistas.COLUMNA_DEL_COORDINADOR, "EN_CURSO con repo lo tiene el Coordinador");
  assert.equal(vistas.columnaDelKanban(fila(aprobada)), "APROBADO");
  assert.deepEqual(vistas.destinosDelKanban(fila(planeando)), []);
  const alCoordinador = vistas.COLUMNAS_DEL_KANBAN.find((c) => c.clave === vistas.COLUMNA_DEL_COORDINADOR);
  assert.equal(vistas.veredictoDelKanban(fila(tareaIdea), alCoordinador), vistas.NO_SE_ARRASTRA_AL_COORDINADOR);
});

await prueba("kanban: de Idea a En curso no deja (con el motivo de la regla); a Por aprobar sí y pide confirmación", () => {
  const enCurso = vistas.COLUMNAS_DEL_KANBAN.find((c) => c.clave === "EN_CURSO");
  const porAprobar = vistas.COLUMNAS_DEL_KANBAN.find((c) => c.clave === "POR_APROBAR");
  const aprobado = vistas.COLUMNAS_DEL_KANBAN.find((c) => c.clave === "APROBADO");
  assert.equal(
    vistas.veredictoDelKanban(fila(tareaIdea), enCurso),
    reglas.puedeCambiarEstado("IDEA", "EN_CURSO", true, true, false),
  );
  assert.match(vistas.veredictoDelKanban(fila(tareaIdea), enCurso), /Solo se pone EN_CURSO/);
  assert.match(vistas.veredictoDelKanban(fila(tareaIdea), aprobado), /Aprobar es su propia acción/);
  assert.equal(vistas.veredictoDelKanban(fila(tareaIdea), porAprobar), null);
  assert.equal(vistas.pideConfirmacion("POR_APROBAR"), true);
  assert.equal(vistas.pideConfirmacion("HECHO"), false);
  // Solo ofrece lo que permite puedeCambiarEstado.
  for (const f of filas) {
    for (const destino of vistas.destinosDelKanban(f)) {
      assert.equal(reglas.puedeCambiarEstado(f.tarjeta.estado, destino.destino, f.requiereAprobacion, f.usaEstados, Boolean(f.tarjeta.repo)), null);
    }
  }
  assert.deepEqual(vistas.destinosDelKanban(fila(aprobada)).map((c) => c.clave), ["IDEA", "POR_APROBAR", "EN_CURSO", "HECHO", "FALLIDO"]);
  // Una idea (tipo sin aprobación) va a En curso directo.
  assert.equal(vistas.veredictoDelKanban(fila(idea2), enCurso), null);
});

await prueba("vistas guardadas: la clave de AppSetting lleva el userId y cada persona tiene las suyas", async () => {
  assert.equal(guardadas.claveDeVistas("u-1"), "tablero-ia:vistas:u-1");
  assert.deepEqual(await guardadas.preferenciasDe("u-1"), { ultima: "tabla", guardadas: [] }, "la primera vez: Tabla");
  await guardadas.guardarUltimaVista("u-1", "calendario");
  assert.equal((await guardadas.preferenciasDe("u-1")).ultima, "calendario");
  assert.equal((await guardadas.preferenciasDe("u-2")).ultima, "tabla", "otra persona sigue en la suya");
  await guardadas.guardarUltimaVista("u-2", "tablero");
  assert.equal((await guardadas.preferenciasDe("u-1")).ultima, "calendario");
  await assert.rejects(() => guardadas.guardarUltimaVista("u-1", "inventada"), /no existe/);
  assert.deepEqual([...ajustes.keys()].sort(), ["tablero-ia:vistas:u-1", "tablero-ia:vistas:u-2"]);

  const lista = await guardadas.guardarVistaDeTabla("u-1", "  Mis urgentes ", { filtros: { prioridad: ["URGENTE"] }, agrupar: "area" });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nombre, "Mis urgentes");
  assert.deepEqual(lista[0].config, { busqueda: "", filtros: { prioridad: ["URGENTE"] }, orden: null, agrupar: "area" });
  assert.equal((await guardadas.preferenciasDe("u-1")).ultima, "calendario", "guardar una vista no cambia la última");
  assert.equal((await guardadas.preferenciasDe("u-2")).guardadas.length, 0);
  await assert.rejects(() => guardadas.guardarVistaDeTabla("u-1", "mis URGENTES", {}), /Ya tienes una vista/);
  await assert.rejects(() => guardadas.guardarVistaDeTabla("u-1", "   ", {}), /Ponle un nombre/);
  const sinNada = await guardadas.borrarVistaDeTabla("u-1", lista[0].id);
  assert.deepEqual(sinNada, []);
});

await prueba("lo guardado dañado no rompe la pantalla", () => {
  assert.deepEqual(guardadas.leerPreferencias("{no es json"), { ultima: "tabla", guardadas: [] });
  assert.deepEqual(guardadas.leerPreferencias(JSON.stringify({ ultima: "otra", guardadas: [{ id: 1 }, { id: "a", nombre: "A", config: { agrupar: "x" } }] })), {
    ultima: "tabla",
    guardadas: [{ id: "a", nombre: "A", config: vistas.CONFIG_VACIA }],
  });
});

await prueba("las acciones nuevas usan el servicio de siempre con origen PANTALLA, sin tocar la base de otra persona", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/app/actions/tablero-ia-vistas-actions.ts"), "utf8");
  assert.match(fuente, /origen: "PANTALLA"/);
  assert.match(fuente, /cambiarEstadoTarjeta\(contexto/);
  assert.match(fuente, /editarTarjeta\(contexto, tarjetaId, permitido\)/);
  assert.ok(!/prisma\./.test(fuente), "la acción no escribe directo en la base");
  // Las vistas se guardan siempre con el userId de la sesión.
  assert.equal((fuente.match(/access\.userId/g) ?? []).length >= 4, true);
});

console.log(`\n${pasaron} pruebas de las vistas del Tablero IA: OK`);
