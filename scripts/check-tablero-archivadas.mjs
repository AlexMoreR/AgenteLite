// Pruebas de las tarjetas archivadas del Tablero IA (services/archivadas.ts) con un prisma FALSO, sin base ni red:
// cuándo se archiva una tarjeta (HECHO o FALLIDO de más de 3 días, sin hijas abiertas), el "ya corrió hoy", las tandas,
// la semana de lunes a domingo, el link del commit, que el límite de 300 y las listas de todos los días no cuenten
// las archivadas, y el filtro por día del link del resumen de las 6 p. m. (terminadasDelDia, 6-nov-2026).
// Correr: npm run test:tablero-archivadas
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const DIA = 24 * 3_600_000;
const AHORA = new Date("2026-10-31T15:00:00Z"); // 10 a. m. en Bogotá
const haceDias = (dias) => new Date(AHORA.getTime() - dias * DIA);

const estado = { tarjetas: [], historial: [], ajustes: new Map(), tocados: [] };

const coincide = (fila, where) =>
  Object.entries(where).every(([clave, valor]) => {
    const actual = fila[clave];
    if (valor === null) return actual === null || actual === undefined;
    if (valor && typeof valor === "object" && !(valor instanceof Date)) {
      if ("in" in valor) return valor.in.includes(actual);
      if ("notIn" in valor) return !valor.notIn.includes(actual);
      if ("lt" in valor) return actual < valor.lt;
      if ("not" in valor) return valor.not === null ? actual !== null && actual !== undefined : actual !== valor.not;
    }
    return actual === valor;
  });

const falso = {
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  tarjetaTablero: {
    findMany: async ({ where, take }) =>
      estado.tarjetas
        .filter((t) => coincide(t, where))
        .sort((a, b) => a.actualizadoEn - b.actualizadoEn)
        .slice(0, take ?? Infinity)
        .map((t) => ({ ...t })),
    groupBy: async ({ where }) => {
      const cuentas = new Map();
      for (const t of estado.tarjetas.filter((t) => coincide(t, where))) cuentas.set(t.padreId, (cuentas.get(t.padreId) ?? 0) + 1);
      return [...cuentas].map(([padreId, n]) => ({ padreId, _count: { _all: n } }));
    },
  },
  historialTarjeta: {
    findMany: async ({ where }) => estado.historial.filter((h) => coincide(h, where)),
  },
  tableroInteligente: {
    updateMany: async ({ where }) => {
      estado.tocados.push(...where.id.in);
      return { count: where.id.in.length };
    },
  },
  $transaction: async (fn) =>
    fn({
      tarjetaTablero: {
        updateMany: async ({ where, data }) => {
          const fila = estado.tarjetas.find((t) => coincide(t, where));
          if (!fila) return { count: 0 };
          Object.assign(fila, data);
          return { count: 1 };
        },
      },
      historialTarjeta: {
        create: async ({ data }) => {
          estado.historial.push({ ...data, creadoEn: AHORA, deshechoEn: null });
          return { id: `h${estado.historial.length}` };
        },
      },
    }),
};

const archivadas = cargar("src/features/tableros-inteligentes/services/archivadas.ts", {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
});

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.tarjetas = [];
  estado.historial = [];
  estado.ajustes.clear();
  estado.tocados = [];
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

let siguiente = 0;
/** Una tarjeta del tablero; `termino` = hace cuántos días pasó a su estado (queda en el historial). */
function tarjeta({ estado: est = "HECHO", termino = null, padreId = null, borradoEn = null, archivadaEn = null, editada = null } = {}) {
  siguiente += 1;
  const id = `t${siguiente}`;
  const fila = {
    id,
    tableroId: "tab1",
    estado: est,
    padreId,
    borradoEn,
    archivadaEn,
    terminadaEn: null,
    creadoEn: haceDias(30),
    actualizadoEn: haceDias(editada ?? termino ?? 10),
  };
  estado.tarjetas.push(fila);
  if (termino !== null) {
    estado.historial.push({ tarjetaId: id, accion: "estado", despues: { estado: est }, creadoEn: haceDias(termino), deshechoEn: null });
  }
  return fila;
}

/* ------------------------------------------------------------------ reglas puras */

await prueba("sePuedeArchivar: una HECHO de hace 4 días sí; una de hace 2 días no", async () => {
  const base = { estado: "HECHO", borradoEn: null, archivadaEn: null };
  assert.equal(archivadas.sePuedeArchivar({ ...base, terminadaEn: haceDias(4) }, 0, AHORA, 3), true);
  assert.equal(archivadas.sePuedeArchivar({ ...base, terminadaEn: haceDias(2) }, 0, AHORA, 3), false);
  assert.equal(archivadas.sePuedeArchivar({ ...base, estado: "FALLIDO", terminadaEn: haceDias(4) }, 0, AHORA, 3), true);
});

await prueba("sePuedeArchivar: IDEA, EN_CURSO y los demás estados abiertos nunca se archivan", async () => {
  for (const abierto of ["IDEA", "POR_APROBAR", "APROBADO", "EN_CURSO", "PLANEANDO", "PLAN_LISTO", "POR_REVISAR", "SUBIENDO", "ERROR"]) {
    assert.equal(
      archivadas.sePuedeArchivar({ estado: abierto, borradoEn: null, archivadaEn: null, terminadaEn: haceDias(100) }, 0, AHORA, 3),
      false,
      abierto,
    );
  }
});

await prueba("sePuedeArchivar: una madre con una hija abierta no; una borrada o ya archivada tampoco", async () => {
  const vieja = { estado: "HECHO", borradoEn: null, archivadaEn: null, terminadaEn: haceDias(10) };
  assert.equal(archivadas.sePuedeArchivar(vieja, 1, AHORA, 3), false);
  assert.equal(archivadas.sePuedeArchivar({ ...vieja, borradoEn: haceDias(1) }, 0, AHORA, 3), false);
  assert.equal(archivadas.sePuedeArchivar({ ...vieja, archivadaEn: haceDias(1) }, 0, AHORA, 3), false);
  assert.equal(archivadas.esHijaAbierta({ estado: "EN_CURSO", borradoEn: null }), true);
  assert.equal(archivadas.esHijaAbierta({ estado: "HECHO", borradoEn: null }), false);
  assert.equal(archivadas.esHijaAbierta({ estado: "EN_CURSO", borradoEn: haceDias(1) }), false);
});

await prueba("fechaDeTerminada: el último cambio a HECHO o FALLIDO sin deshacer; sin historial, la última edición", async () => {
  const historial = [
    { despues: { estado: "HECHO" }, creadoEn: haceDias(9), deshechoEn: null },
    { despues: { estado: "EN_CURSO" }, creadoEn: haceDias(8), deshechoEn: null },
    { despues: { estado: "FALLIDO" }, creadoEn: haceDias(5), deshechoEn: null },
    { despues: { estado: "HECHO" }, creadoEn: haceDias(1), deshechoEn: haceDias(1) },
    { despues: { titulo: "otro" }, creadoEn: haceDias(0.5), deshechoEn: null },
  ];
  assert.equal(archivadas.fechaDeTerminada(historial, AHORA).getTime(), haceDias(5).getTime());
  assert.equal(archivadas.fechaDeTerminada([], haceDias(7)).getTime(), haceDias(7).getTime());
});

await prueba("diasDelAjuste: sin fila o con basura vale 3; un entero de 0 a 365 se respeta", async () => {
  assert.equal(archivadas.diasDelAjuste(null), 3);
  assert.equal(archivadas.diasDelAjuste("abc"), 3);
  assert.equal(archivadas.diasDelAjuste("-2"), 3);
  assert.equal(archivadas.diasDelAjuste("999"), 3);
  assert.equal(archivadas.diasDelAjuste(" 7 "), 7);
  assert.equal(archivadas.diasDelAjuste("0"), 0);
});

await prueba('semanaDe("2026-10-30") da del lunes 26 al domingo 1, en hora de Bogotá', async () => {
  const semana = archivadas.semanaDe("2026-10-30");
  assert.equal(semana.lunes, "2026-10-26");
  assert.equal(semana.domingo, "2026-11-01");
  assert.equal(semana.desde.toISOString(), "2026-10-26T05:00:00.000Z");
  assert.equal(semana.hasta.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(archivadas.semanaDe("2026-10-26").lunes, "2026-10-26", "un lunes es el comienzo de su semana");
  assert.equal(archivadas.semanaDe("2026-11-01").lunes, "2026-10-26", "un domingo es el final de su semana");
  assert.equal(archivadas.semanaDe("2026-02-30"), null);
  assert.equal(archivadas.semanaDe("30/10/2026"), null);
});

await prueba("linkDelCommit: solo un https:// (va a un href); busquedaDe: T-123 busca por código", async () => {
  assert.equal(archivadas.linkDelCommit({ subida: { linkCommit: "https://github.com/x/y/commit/abc" } }), "https://github.com/x/y/commit/abc");
  assert.equal(archivadas.linkDelCommit({ subida: { linkCommit: "javascript:alert(1)" } }), null);
  assert.equal(archivadas.linkDelCommit({ subida: { linkCommit: 'https://x.co/"><script>' } }), null);
  assert.equal(archivadas.linkDelCommit(null), null);
  assert.deepEqual(archivadas.busquedaDe("T-123"), { numero: 123 });
  assert.deepEqual(archivadas.busquedaDe("t123"), { numero: 123 });
  assert.deepEqual(archivadas.busquedaDe("  aizencrm "), { texto: "aizencrm" });
  assert.equal(archivadas.busquedaDe("   "), null);
});

await prueba("el límite cuenta solo las no archivadas (ni borradas)", async () => {
  const lista = [
    { borradoEn: null, archivadaEn: null },
    { borradoEn: null, archivadaEn: AHORA },
    { borradoEn: AHORA, archivadaEn: null },
    { borradoEn: null, archivadaEn: null },
  ];
  assert.equal(lista.filter(archivadas.cuentaParaElLimite).length, 2);
});

/* ------------------------------------------------------------------ archivar (el reloj) */

await prueba("archivarLasTerminadas: archiva la HECHO de hace 4 días y deja la de hace 2, la IDEA y la EN_CURSO", async () => {
  const vieja = tarjeta({ termino: 4 });
  const nueva = tarjeta({ termino: 2 });
  const idea = tarjeta({ estado: "IDEA" });
  const enCurso = tarjeta({ estado: "EN_CURSO", termino: 9 });
  const fallida = tarjeta({ estado: "FALLIDO", termino: 6 });
  const r = await archivadas.archivarLasTerminadas(AHORA);
  assert.deepEqual(r, { archivadas: 2, quedan: false });
  assert.equal(vieja.archivadaEn, AHORA);
  assert.equal(vieja.terminadaEn.getTime(), haceDias(4).getTime());
  assert.equal(vieja.estado, "HECHO", "sigue HECHO: archivar no cambia el estado");
  assert.equal(fallida.archivadaEn, AHORA);
  assert.equal(nueva.archivadaEn, null);
  assert.equal(idea.archivadaEn, null);
  assert.equal(enCurso.archivadaEn, null);
  const anotadas = estado.historial.filter((h) => h.accion === "archivar");
  assert.equal(anotadas.length, 2);
  assert.ok(anotadas.every((h) => h.origen === "TRABAJADOR" && h.quien === archivadas.QUIEN_ARCHIVA));
  assert.deepEqual([...new Set(estado.tocados)], ["tab1"], "el tablero se refresca en la pantalla");
});

await prueba("archivarLasTerminadas: una madre con una hija EN_CURSO no se archiva; con todas sus hijas cerradas, sí", async () => {
  const madre = tarjeta({ termino: 10 });
  const hija = tarjeta({ estado: "EN_CURSO", padreId: madre.id });
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(madre.archivadaEn, null);
  hija.estado = "HECHO";
  estado.historial.push({ tarjetaId: hija.id, accion: "estado", despues: { estado: "HECHO" }, creadoEn: haceDias(5), deshechoEn: null });
  estado.ajustes.clear(); // otro día
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(madre.archivadaEn, AHORA);
  assert.equal(hija.archivadaEn, AHORA);
});

await prueba("archivarLasTerminadas: una hija borrada no cuenta como abierta", async () => {
  const madre = tarjeta({ termino: 10 });
  tarjeta({ estado: "EN_CURSO", padreId: madre.id, borradoEn: haceDias(1) });
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(madre.archivadaEn, AHORA);
});

await prueba("archivarLasTerminadas: usa la fecha del historial, no la última edición", async () => {
  // Terminó hace 6 días y la editaron ayer: se archiva igual.
  const editada = tarjeta({ termino: 6, editada: 1 });
  // Sin historial: se usa la última edición (hace 5 días).
  const sinHistorial = tarjeta({ editada: 5 });
  // Sin historial y editada hace 1 día: no.
  const reciente = tarjeta({ editada: 1 });
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(editada.archivadaEn, AHORA);
  assert.equal(sinHistorial.archivadaEn, AHORA);
  assert.equal(reciente.archivadaEn, null);
});

await prueba("archivarLasTerminadas: una vez al día; los días salen del ajuste", async () => {
  const cinco = tarjeta({ termino: 5 });
  estado.ajustes.set(archivadas.CLAVE_DIAS, "7");
  assert.deepEqual(await archivadas.archivarLasTerminadas(AHORA), { archivadas: 0, quedan: false });
  assert.equal(cinco.archivadaEn, null, "con 7 días, una de hace 5 se queda");
  assert.equal(estado.ajustes.get(archivadas.CLAVE_ULTIMO_DIA), "2026-10-31");
  estado.ajustes.set(archivadas.CLAVE_DIAS, "3");
  assert.deepEqual(await archivadas.archivarLasTerminadas(AHORA), { archivadas: 0, quedan: false }, "ya corrió hoy");
  assert.equal(cinco.archivadaEn, null);
  const manana = new Date(AHORA.getTime() + DIA);
  await archivadas.archivarLasTerminadas(manana);
  assert.equal(cinco.archivadaEn, manana);
});

await prueba("limpieza inicial: va por tandas de 200 y sigue en la vuelta siguiente hasta terminar", async () => {
  const viejas = Array.from({ length: 330 }, () => tarjeta({ termino: 20 }));
  const r1 = await archivadas.archivarLasTerminadas(AHORA);
  assert.deepEqual(r1, { archivadas: archivadas.TANDA, quedan: true });
  assert.equal(estado.ajustes.has(archivadas.CLAVE_ULTIMO_DIA), false, "con una tanda llena no se marca el día");
  const r2 = await archivadas.archivarLasTerminadas(AHORA);
  assert.deepEqual(r2, { archivadas: 130, quedan: false });
  assert.equal(viejas.filter((t) => t.archivadaEn).length, 330);
  assert.equal(estado.ajustes.get(archivadas.CLAVE_ULTIMO_DIA), "2026-10-31");
});

/* ------------------------------------------------------------------ el filtro en tableros.ts */

await prueba("tableros.ts: el límite, el mapa, los contadores y 'Te toca a ti' usan VISIBLE (sin archivadas)", async () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/features/tableros-inteligentes/services/tableros.ts"), "utf8");
  assert.match(fuente, /const VISIBLE = \{ borradoEn: null, archivadaEn: null \} as const;/);
  const cuerpo = (nombre) => {
    const inicio = fuente.indexOf(`export async function ${nombre}(`);
    assert.ok(inicio >= 0, `falta ${nombre}`);
    const fin = fuente.indexOf("\nexport ", inicio + 10);
    return fuente.slice(inicio, fin);
  };
  assert.match(cuerpo("crearTarjeta"), /count\(\{ where: \{ tableroId: tablero\.id, \.\.\.VISIBLE \} \}\)/, "el límite de 300");
  assert.match(cuerpo("contenidoDelTablero"), /: VISIBLE\) \}/, "el mapa y el refresco");
  assert.equal((cuerpo("listarTableros").match(/\.\.\.VISIBLE/g) ?? []).length, 2, "los contadores del selector");
  assert.match(cuerpo("pendientesDelDueno"), /\.\.\.VISIBLE,/, "Te toca a ti");
  assert.match(cuerpo("cambiarEstadoTarjeta"), /data: \{ estado, \.\.\.alReabrir\(estado\) \}/, "se desarchiva al reabrir");
  assert.match(cuerpo("editarTarjeta"), /data: \{ \.\.\.nuevo, estado, \.\.\.alReabrir\(estado\) \}/, "editar a un estado abierto desarchiva");
  assert.match(cuerpo("aprobarTarjeta"), /\.\.\.alReabrir\(veredicto\.a\)/, "reintentar una FALLIDO archivada la desarchiva");
  assert.match(cuerpo("deshacerCambioTarjeta"), /Object\.assign\(datos, alReabrir\(estadoRestaurado\)\)/, "deshacer a un estado abierto desarchiva");
});

await prueba("el Coordinador NO filtra las archivadas (una parte archivada sigue contando como HECHO)", async () => {
  for (const archivo of ["sql-trabajador.ts", "trabajador.ts", "madre-partida.ts"]) {
    const ruta = path.join(RAIZ, "src/features/tableros-inteligentes/services", archivo);
    if (!fs.existsSync(ruta)) continue;
    assert.ok(!fs.readFileSync(ruta, "utf8").includes("archivadaEn"), `${archivo} no debe mirar archivadaEn`);
  }
});

/* ------------------------------------------------------------------ el filtro por día (6-nov-2026) */

// Un where de prisma con relaciones (tarjeta → tablero), OR, rangos, `in`, `contains` y el path de un Json.
const TABLEROS = [
  { id: "tab1", workspaceId: "ws1", duenoUserId: "u1" },
  { id: "tab2", workspaceId: "ws1", duenoUserId: "u2" },
  { id: "otro", workspaceId: "ws2", duenoUserId: "u9" },
];
function coincideProfundo(fila, where) {
  return Object.entries(where).every(([clave, valor]) => {
    if (clave === "OR") return valor.some((o) => coincideProfundo(fila, o));
    if (clave === "tarjeta") {
      const t = estado.tarjetas.find((x) => x.id === fila.tarjetaId);
      return Boolean(t) && coincideProfundo(t, valor);
    }
    if (clave === "tablero") {
      const tab = TABLEROS.find((x) => x.id === fila.tableroId);
      return Boolean(tab) && coincideProfundo(tab, valor);
    }
    const actual = fila[clave];
    if (valor === null) return actual === null || actual === undefined;
    if (valor && typeof valor === "object" && !(valor instanceof Date)) {
      if ("path" in valor) return (actual ?? {})[valor.path[0]] === valor.equals;
      if ("in" in valor) return valor.in.includes(actual);
      if ("contains" in valor) return String(actual ?? "").toLowerCase().includes(valor.contains.toLowerCase());
      if ("not" in valor) return valor.not === null ? actual !== null && actual !== undefined : actual !== valor.not;
      return (!("gte" in valor) || actual >= valor.gte) && (!("lt" in valor) || actual < valor.lt);
    }
    return actual === valor;
  });
}

await prueba("diaValido y rangoDeUnDia: AAAA-MM-DD que exista; el día de Bogotá va de 05:00Z a 05:00Z", async () => {
  assert.equal(archivadas.diaValido("2026-11-06"), "2026-11-06");
  assert.equal(archivadas.diaValido(" 2026-11-06 "), "2026-11-06");
  for (const malo of ["2026-02-30", "06/11/2026", "hoy", "", "2026-11-6", "cualquier-cosa", null, undefined, 20261106, ["2026-11-06"]]) {
    assert.equal(archivadas.diaValido(malo), null, String(malo));
  }
  const rango = archivadas.rangoDeUnDia("2026-11-06");
  assert.equal(rango.desde.toISOString(), "2026-11-06T05:00:00.000Z");
  assert.equal(rango.hasta.toISOString(), "2026-11-07T05:00:00.000Z");
  assert.equal(archivadas.rangoDeUnDia("x"), null);
});

await prueba("terminadasDelDia: HECHO y FALLIDO de ese día de Bogotá, archivadas o no, solo del negocio", async () => {
  const historialOriginal = falso.historialTarjeta.findMany;
  const tarjetasOriginal = falso.tarjetaTablero.findMany;
  const consultas = [];
  falso.historialTarjeta.findMany = async (args) => {
    consultas.push(args);
    return estado.historial.filter((h) => coincideProfundo(h, args.where)).sort((a, b) => a.creadoEn - b.creadoEn);
  };
  falso.tarjetaTablero.findMany = async ({ where }) => estado.tarjetas.filter((t) => coincideProfundo(t, where)).map((t) => ({ ...t }));
  try {
    const HOY = "2026-11-06";
    const t = (id, extra = {}) => {
      const fila = { id, numero: Number(id.replace(/\D/g, "")) || null, titulo: `Tarea ${id}`, tableroId: "tab1", estado: "HECHO", repo: "aizencrm", resultado: null, borradoEn: null, archivadaEn: null, terminadaEn: null, actualizadoEn: new Date("2026-11-06T20:00:00Z"), tablero: { id: extra.tableroId ?? "tab1", nombre: "Empresa" }, ...extra };
      estado.tarjetas.push(fila);
      return fila;
    };
    const cambio = (tarjetaId, creadoEn, est = "HECHO", extra = {}) =>
      estado.historial.push({ tarjetaId, accion: "estado", despues: { estado: est }, creadoEn: new Date(creadoEn), deshechoEn: null, ...extra });

    t("t1"); cambio("t1", "2026-11-06T15:00:00Z"); // 10 a. m. de hoy, sin archivar
    t("t2", { estado: "FALLIDO" }); cambio("t2", "2026-11-06T22:00:00Z", "FALLIDO"); // 5 p. m., fallida
    t("t3", { archivadaEn: new Date("2026-11-06T23:00:00Z"), terminadaEn: new Date("2026-11-06T16:00:00Z") }); cambio("t3", "2026-11-06T16:00:00Z"); // archivada
    t("t4"); cambio("t4", "2026-11-07T04:59:00Z"); // 11:59 p. m. de hoy en Bogotá
    t("t5"); cambio("t5", "2026-11-07T05:00:00Z"); // 12:00 a. m. de mañana: otro día
    t("t6"); cambio("t6", "2026-11-06T04:59:00Z"); // 11:59 p. m. de ayer: otro día
    t("t7"); cambio("t7", "2026-11-06T15:00:00Z", "HECHO", { deshechoEn: new Date("2026-11-06T15:05:00Z") }); // deshecho
    t("t8", { estado: "EN_CURSO" }); cambio("t8", "2026-11-06T15:00:00Z"); // se reabrió después
    t("t9", { tableroId: "otro", tablero: { id: "otro", nombre: "Ajeno" } }); cambio("t9", "2026-11-06T15:00:00Z"); // otro negocio
    t("t10", { borradoEn: new Date("2026-11-06T18:00:00Z") }); cambio("t10", "2026-11-06T15:00:00Z"); // borrada
    t("t11"); estado.historial.push({ tarjetaId: "t11", accion: "editar", despues: { titulo: "x" }, creadoEn: new Date("2026-11-06T15:00:00Z"), deshechoEn: null }); // no terminó hoy
    t("t12"); cambio("t12", "2026-11-06T13:00:00Z", "FALLIDO"); cambio("t12", "2026-11-06T21:00:00Z"); // falló y luego quedó HECHO: una vez, con la última hora

    const lista = await archivadas.terminadasDelDia({ workspaceId: "ws1", soloDe: null }, HOY);
    assert.deepEqual(lista.map((x) => x.id), ["t4", "t2", "t12", "t3", "t1"], "de la última a la primera");
    assert.equal(lista.find((x) => x.id === "t1").archivadaEn, null, "la sin archivar sale con archivadaEn null");
    assert.ok(lista.find((x) => x.id === "t3").archivadaEn, "la archivada también sale");
    assert.equal(lista.find((x) => x.id === "t12").terminadaEn, "2026-11-06T21:00:00.000Z");
    assert.equal(lista.find((x) => x.id === "t2").estado, "FALLIDO");
    // La consulta va filtrada por el negocio y sin deshacer.
    assert.deepEqual(consultas[0].where.tarjeta.tablero, { workspaceId: "ws1" });
    assert.equal(consultas[0].where.deshechoEn, null);

    // El buscador sigue dentro del día; una asesora (soloDe) ve solo sus tableros.
    assert.deepEqual((await archivadas.terminadasDelDia({ workspaceId: "ws1", soloDe: null }, HOY, { buscar: "T-12" })).map((x) => x.id), ["t12"]);
    assert.deepEqual((await archivadas.terminadasDelDia({ workspaceId: "ws1", soloDe: null }, HOY, { buscar: "tarea t1" })).map((x) => x.id).sort(), ["t1", "t12"], "por título: t10 y t11 coinciden pero no terminaron hoy");
    assert.deepEqual(await archivadas.terminadasDelDia({ workspaceId: "ws1", soloDe: "u2" }, HOY), [], "no ve los tableros de otro");
    // Un día sin nada da la lista vacía, y una fecha mal escrita lanza (la acción la convierte en la lista normal).
    assert.deepEqual(await archivadas.terminadasDelDia({ workspaceId: "ws1", soloDe: null }, "2026-11-01"), []);
    await assert.rejects(() => archivadas.terminadasDelDia({ workspaceId: "ws1", soloDe: null }, "cualquier-cosa"), /AAAA-MM-DD/);
  } finally {
    falso.historialTarjeta.findMany = historialOriginal;
    falso.tarjetaTablero.findMany = tarjetasOriginal;
  }
});

console.log(`\n${pruebas} pruebas, todas bien`);
