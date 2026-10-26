// Pruebas del Agente de Sistemas (tercera área del molde de agentes de área), con una base de mentira.
//   npm run test:agente-de-sistemas
// El candado, las herramientas y el lanzador se prueban aparte: npm run test:agente-de-sistemas-candado y
// npm run test:agentes-de-area-lanzador.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";

const db = {
  settings: new Map(),
  dias: new Map(),
  siguiente: 1,
  filas: [],
  mensajes: [],
  consultas: [],
  historial: [],
  tarjetas: [],
  claves: [],
  uso: new Map(),
  usoFalla: false,
};

const MEMBRESIAS = new Map([[`${WS}:alex`, { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } }]]);

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      db.settings.set(where.key, db.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  workspaceMember: { findFirst: async ({ where }) => MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null },
  agenteDeAreaDia: {
    upsert: async ({ where, create, update }) => {
      const k = where.workspaceId_area_fecha;
      const clave = `${k.workspaceId}|${k.area}|${k.fecha}`;
      const previo = db.dias.get(clave);
      const fila = previo ? { ...previo, ...update, actualizadoEn: new Date() } : { id: `d${db.siguiente++}`, ...create, actualizadoEn: new Date() };
      db.dias.set(clave, fila);
      return fila;
    },
    findUnique: async ({ where }) => {
      const k = where.workspaceId_area_fecha;
      return db.dias.get(`${k.workspaceId}|${k.area}|${k.fecha}`) ?? null;
    },
    findMany: async ({ where }) => [...db.dias.values()].filter((d) => d.area === where.area).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
  },
  agenteDeAreaEnvio: { findMany: async () => [] },
  historialTarjeta: {
    findMany: async ({ where }) =>
      db.historial
        .filter((h) => h.accion === where.accion && h.creadoEn >= where.creadoEn.gte && h.deshechoEn === null && h.tarjeta.estado === "HECHO" && !h.tarjeta.borradoEn && h.tarjeta.repo)
        .sort((a, b) => b.creadoEn - a.creadoEn),
  },
  tarjetaTablero: {
    findMany: async ({ where }) => {
      if (where.titulo) return db.tarjetas.filter((t) => t.titulo.includes("[sistemas:"));
      const estados = where.estado.in ?? [where.estado];
      return db.tarjetas.filter((t) => estados.includes(t.estado) && (!where.repo || t.repo));
    },
  },
  claveTrabajador: { findMany: async () => db.claves },
  usoDelSistemaDia: {
    upsert: async ({ where, create, update }) => {
      if (db.usoFalla) throw new Error("la base no responde");
      const k = where.workspaceId_fecha_tipo_clave_quien;
      const clave = [k.workspaceId, k.fecha, k.tipo, k.clave, k.quien].join("|");
      const previa = db.uso.get(clave);
      const fila = previa ? { ...previa, veces: previa.veces + update.veces.increment } : { ...create };
      db.uso.set(clave, fila);
      return fila;
    },
    findMany: async ({ where }) => [...db.uso.values()].filter((f) => f.fecha >= where.fecha.gte),
    aggregate: async () => ({ _min: { fecha: [...db.uso.values()].map((f) => f.fecha).sort()[0] ?? null } }),
  },
  // La primera consulta son los leads (EmbudoLead + Contact); la segunda, los primeros mensajes.
  $queryRaw: async (consulta) => {
    const texto = Array.isArray(consulta?.strings) ? consulta.strings.join("?") : String(consulta?.[0] ?? "");
    db.consultas.push(texto);
    return texto.includes('FROM "Message"') ? db.mensajes : db.filas;
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@prisma/client": {
    Prisma: {
      sql: (strings, ...valores) => ({ strings: [...strings], valores }),
      join: (x) => x,
      DbNull: "DbNull",
    },
  },
  react: { cache: (f) => f },
  "@/lib/cache-de-permisos": {
    cacheDeSupervisoras: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeAcceso: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeCanales: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    invalidarTrasEscritura: () => {},
  },
  "@/lib/web-push": { sendPushToUser: async () => 0 },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async () => {} },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: null } }) },
};

const reglas = cargar("src/features/agentes-de-area/dominio/reglas.ts", mocks);
const sis = cargar("src/features/agentes-de-area/dominio/reglas-sistemas.ts", mocks);
const revision = cargar("src/features/agentes-de-area/servicios/revision-de-sistemas.ts", mocks);
const uso = cargar("src/lib/uso-del-sistema.ts", mocks);
const resumenes = cargar("src/features/agentes-de-area/servicios/resumenes.ts", mocks);
const mcp = cargar("src/lib/mcp/agentes-de-area.ts", mocks);
const textoDeHerramientas = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");


let pruebas = 0;
const fallas = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

const contexto = { workspaceId: WS, userId: "alex" };
const AHORA = new Date("2026-10-27T11:30:00Z"); // 6:30 a. m. en Colombia
const haceH = (h, m = 0) => new Date(AHORA.getTime() - (h * 60 + m) * 60_000);
const tablero = { id: "t1", nombre: "Magilus General" };

function tarjeta(id, extra = {}) {
  return { id, titulo: `Tarjeta ${id}`, detalle: "", repo: "aizencrm", estado: "HECHO", resultado: null, trabajoIniciadoEn: null, trabajoVenceEn: null, actualizadoEn: haceH(1), borradoEn: null, tablero, ...extra };
}
function hecho(t, creadoEn) {
  return { tarjetaId: t.id, creadoEn, accion: "estado", despues: { estado: "HECHO" }, deshechoEn: null, tarjeta: t };
}
function reiniciar() {
  db.settings.clear();
  db.dias.clear();
  db.historial = [];
  db.tarjetas = [];
  db.claves = [];
  db.uso.clear();
  db.usoFalla = false;
}

/* ------------------------------------------------------------------ las tarjetas HECHO de las últimas 24 h */

await prueba("una tarjeta que pasó a HECHO hace 3 h entra en la revisión; una de hace 30 h no; entran los dos repos y varios tableros", async () => {
  reiniciar();
  const reciente = tarjeta("a", { titulo: "Pantalla nueva", detalle: "Abre /cliente/crm/tablero y la herramienta `ver_tablero`", resultado: { commit: "abc1234def", rama: "tablero/a" } });
  const viejo = tarjeta("b", { titulo: "Vieja" });
  const deGestion = tarjeta("c", { repo: "gestion", titulo: "Cambio en Gestión", tablero: { id: "t2", nombre: "Desarrollo Emanuel" }, resultado: { subida: { commit: "fff9999" } } });
  db.historial = [hecho(reciente, haceH(3)), hecho(viejo, haceH(30)), hecho(deGestion, haceH(0, 20))];
  const r = await revision.revisionDeSistemas(WS, { ahora: AHORA });
  assert.deepEqual(r.hechas.map((x) => x.titulo), ["Cambio en Gestión", "Pantalla nueva"], "la más reciente primero");
  const a = r.hechas.find((x) => x.titulo === "Pantalla nueva");
  assert.equal(a.commit, "abc1234def");
  assert.equal(a.rama, "tablero/a");
  assert.equal(a.hecho_en, haceH(3).toISOString());
  assert.deepEqual(a.pantallas_nombradas, ["/cliente/crm/tablero"]);
  assert.deepEqual(a.herramientas_nombradas, ["ver_tablero"]);
  const g = r.hechas.find((x) => x.repo === "gestion");
  assert.equal(g.tablero, "Desarrollo Emanuel");
  assert.equal(g.commit, "fff9999", "el commit también sale de resultado.subida");
});

await prueba("hechasRecientes: la última vez que quedó HECHO manda, y un cambio a otro estado no cuenta", () => {
  const mapa = sis.hechasRecientes(
    [
      { tarjetaId: "x", estadoNuevo: "HECHO", en: haceH(20) },
      { tarjetaId: "x", estadoNuevo: "HECHO", en: haceH(2) },
      { tarjetaId: "y", estadoNuevo: "ERROR", en: haceH(1) },
      { tarjetaId: "z", estadoNuevo: "HECHO", en: haceH(24, 1) },
    ],
    AHORA,
  );
  assert.deepEqual([...mapa.keys()], ["x"]);
  assert.equal(mapa.get("x").getTime(), haceH(2).getTime());
});

/* ------------------------------------------------------------------ atascadas, ERROR y el trabajador */

await prueba("una tarjeta 2 h 10 min en EN_CURSO sale como atascada; una de 1 h 50 min no; PLANEANDO y SUBIENDO también cuentan", async () => {
  reiniciar();
  db.tarjetas = [
    tarjeta("larga", { estado: "EN_CURSO", trabajoIniciadoEn: haceH(2, 10), titulo: "Larga" }),
    tarjeta("corta", { estado: "EN_CURSO", trabajoIniciadoEn: haceH(1, 50), titulo: "Corta" }),
    tarjeta("plan", { estado: "PLANEANDO", trabajoIniciadoEn: null, actualizadoEn: haceH(5), titulo: "Plan" }),
    tarjeta("sube", { estado: "SUBIENDO", trabajoIniciadoEn: haceH(3), titulo: "Sube" }),
    tarjeta("lista", { estado: "PLAN_LISTO", trabajoIniciadoEn: haceH(9), titulo: "Esperando al dueño" }),
  ];
  const r = await revision.revisionDeSistemas(WS, { ahora: AHORA });
  assert.deepEqual(r.atascadas.map((x) => x.titulo), ["Plan", "Sube", "Larga"], "las que llevan más tiempo primero; PLAN_LISTO no se atasca");
  assert.equal(r.atascadas.find((x) => x.titulo === "Larga").minutos_en_el_estado, 130);
  assert.ok(r.atascadas[0].ultimo_latido);
});

await prueba("las tarjetas en ERROR salen con su motivo", async () => {
  reiniciar();
  db.tarjetas = [
    tarjeta("e1", { estado: "ERROR", titulo: "Rota", resultado: { error: "no compila: Type error en x.ts" } }),
    tarjeta("e2", { estado: "ERROR", titulo: "Sin motivo", resultado: null }),
  ];
  const r = await revision.revisionDeSistemas(WS, { ahora: AHORA });
  assert.equal(r.en_error.length, 2);
  assert.equal(r.en_error.find((x) => x.titulo === "Rota").motivo, "no compila: Type error en x.ts");
  assert.equal(r.en_error.find((x) => x.titulo === "Sin motivo").motivo, "(sin motivo guardado)");
});

await prueba("la clave 'aizen1' sin uso hace 40 minutos sale 'sin señal'; con uso hace 5 minutos está viva", async () => {
  reiniciar();
  db.claves = [{ nombre: "otra", ultimoUsoEn: haceH(0, 1) }, { nombre: "aizen1", ultimoUsoEn: haceH(0, 40) }];
  let r = await revision.revisionDeSistemas(WS, { ahora: AHORA });
  assert.equal(r.trabajador.vivo, false);
  assert.match(r.trabajador.estado, /^sin señal desde /);
  assert.equal(r.trabajador.minutos_sin_uso, 40);
  db.claves = [{ nombre: "aizen1", ultimoUsoEn: haceH(0, 5) }];
  r = await revision.revisionDeSistemas(WS, { ahora: AHORA });
  assert.equal(r.trabajador.vivo, true);
  db.claves = [];
  r = await revision.revisionDeSistemas(WS, { ahora: AHORA });
  assert.equal(r.trabajador.vivo, false);
  assert.match(r.trabajador.estado, /nunca se ha usado/);
});

/* ------------------------------------------------------------------ el contador de uso */

await prueba("el contador: dos latidos en la misma pantalla el mismo día dan UNA fila con veces = 2", async () => {
  reiniciar();
  const dato = { workspaceId: WS, tipo: "PANTALLA", clave: "/cliente/crm/tablero", quien: "ana", fecha: "2026-10-27" };
  await uso.registrarUso(dato);
  await uso.registrarUso(dato);
  assert.equal(db.uso.size, 1);
  assert.equal([...db.uso.values()][0].veces, 2);
  await uso.registrarUso({ ...dato, quien: "luis" });
  await uso.registrarUso({ ...dato, fecha: "2026-10-28" });
  assert.equal(db.uso.size, 3, "otra persona u otro día = otra fila");
});

await prueba("el contador: si la base falla, no rompe nada (la promesa nunca rechaza)", async () => {
  reiniciar();
  db.usoFalla = true;
  await uso.registrarUso({ workspaceId: WS, tipo: "HERRAMIENTA", clave: "ver_tablero", quien: "k1" });
  assert.equal(db.uso.size, 0);
});

await prueba("el contador: cuenta pantallas /cliente/*, junta los chats puntuales y no cuenta lo demás ni al propio Agente de Sistemas", async () => {
  reiniciar();
  await uso.registrarUso({ workspaceId: WS, tipo: "PANTALLA", clave: "/cliente/chats/cmabc123?x=1", quien: "ana" });
  await uso.registrarUso({ workspaceId: WS, tipo: "PANTALLA", clave: "/cliente/chats", quien: "ana" });
  await uso.registrarUso({ workspaceId: WS, tipo: "PANTALLA", clave: "/admin/usuarios", quien: "ana" });
  await uso.registrarUso({ workspaceId: WS, tipo: "HERRAMIENTA", clave: "revision_de_sistemas", quien: "k1" });
  await uso.registrarUso({ workspaceId: WS, tipo: "HERRAMIENTA", clave: "agente_de_sistemas", quien: "k1" });
  await uso.registrarUso({ workspaceId: WS, tipo: "HERRAMIENTA", clave: "ver_tablero", quien: "k1" });
  const claves = [...db.uso.values()].map((f) => `${f.tipo}:${f.clave}:${f.veces}`).sort();
  assert.deepEqual(claves, ["HERRAMIENTA:ver_tablero:1", "PANTALLA:/cliente/chats:2"]);
});

await prueba("el latido y el MCP suman al contador sin esperarlo (void, sin await) y el contador es solo de /cliente/*", () => {
  const latido = fs.readFileSync(path.join(RAIZ, "src/app/api/cliente/actividad/latido/route.ts"), "utf8");
  assert.ok(/void registrarUso\(\{[^}]*tipo: "PANTALLA"/.test(latido), "el latido cuenta la pantalla sin esperar");
  const rutaMcp = fs.readFileSync(path.join(RAIZ, "src/app/api/mcp/route.ts"), "utf8");
  assert.ok(/void registrarUso\(\{[^}]*tipo: "HERRAMIENTA"/.test(rutaMcp), "el MCP cuenta la herramienta sin esperar");
  assert.equal(uso.rutaParaContar("/api/otra"), null);
  assert.equal(uso.diaDeUso(new Date("2026-10-27T03:00:00Z")), "2026-10-26", "día de Colombia");
});

await prueba("con dias=30: trae lo subido en el mes con su uso; lo subido antes del contador sale 'sin datos de uso'", async () => {
  reiniciar();
  const nueva = tarjeta("n", { titulo: "Pantalla nueva", detalle: "Va en /cliente/crm/agente-de-sistemas y la herramienta `agente_de_sistemas`" });
  const vieja = tarjeta("v", { titulo: "Vieja", detalle: "/cliente/crm/embudo" });
  db.historial = [hecho(nueva, new Date("2026-10-21T15:00:00Z")), hecho(vieja, new Date("2026-10-05T15:00:00Z"))];
  const fila = (fecha, tipo, clave, quien, veces) => db.uso.set([WS, fecha, tipo, clave, quien].join("|"), { fecha, tipo, clave, quien, veces });
  fila("2026-10-21", "PANTALLA", "/cliente/crm/agente-de-sistemas", "ana", 3);
  fila("2026-10-22", "PANTALLA", "/cliente/crm/agente-de-sistemas", "luis", 2);
  fila("2026-10-22", "HERRAMIENTA", "agente_de_sistemas", "k1", 4);
  const r = await revision.revisionDeSistemas(WS, { ahora: AHORA, dias: 30 });
  assert.equal(r.rango, "últimos 30 días");
  assert.equal(r.uso_medido_desde, "2026-10-21");
  const n = r.hechas.find((x) => x.titulo === "Pantalla nueva");
  assert.deepEqual(n.uso.pantallas, [{ clave: "/cliente/crm/agente-de-sistemas", veces: 5, personas: 2 }]);
  assert.deepEqual(n.uso.herramientas, [{ clave: "agente_de_sistemas", veces: 4, personas: 1 }]);
  assert.equal(r.hechas.find((x) => x.titulo === "Vieja").uso.sin_datos_de_uso, true);
});

/* ------------------------------------------------------------------ la línea y las revisiones */

await prueba("la línea: sin nada roto dice 'Sistemas: todo funciona'; con algo roto dice qué; NO SE PUEDE PROBAR no la rompe", () => {
  const funciona = { tarjetaId: null, titulo: "A", repo: null, commit: null, resultado: "FUNCIONA", detalle: null };
  const noSePuede = { ...funciona, titulo: "B", resultado: "NO_SE_PUEDE_PROBAR", detalle: "solo se prueba escribiendo datos" };
  const falla = { ...funciona, titulo: "Tabla", resultado: "FALLA", detalle: "HTTP 500" };
  assert.equal(sis.construirLineaDeSistemas([funciona, noSePuede], null), "Sistemas: todo funciona");
  const sano = { trabajadorVivo: true, atascadas: 0, enError: 0, respaldos: "CRM: ok. Gestión: ok", recursos: null, vps: "responde (200)", texto: null };
  assert.equal(sis.construirLineaDeSistemas([], sano), "Sistemas: todo funciona");
  assert.equal(sis.construirLineaDeSistemas([falla], sano), "Sistemas: falla “Tabla”");
  const roto = { ...sano, trabajadorVivo: false, atascadas: 2, enError: 1, respaldos: "falta el archivo de anoche de Gestión", vps: "no responde" };
  const linea = sis.construirLineaDeSistemas([], roto);
  for (const parte of ["el trabajador no da señal", "2 tarjetas atascadas", "1 en ERROR", "respaldo: falta el archivo de anoche de Gestión", "el VPS no responde"]) assert.ok(linea.includes(parte), parte);
  assert.ok(sis.construirLineaDeSistemas([falla, { ...falla, titulo: "Otra" }], null).includes("2 cosas subidas"));
});

await prueba("guardar el resumen de Sistemas: valida las revisiones (FALLA con el error, NO SE PUEDE PROBAR con el porqué) y no guarda mensajes", () => {
  const ok = reglas.leerResumenAGuardar(
    {
      revisiones: [
        { titulo: "A", resultado: "FUNCIONA", commit: "abc1234" },
        { titulo: "B", resultado: "falla", detalle: "HTTP 500 en /cliente/x", commit: "def5678" },
        { titulo: "C", resultado: "no se puede probar", detalle: "pide un POST para cargar" },
      ],
      salud: { trabajadorVivo: true, atascadas: 0, enError: 0, respaldos: "ok" },
      arreglos: [{ titulo: "Arreglar B [sistemas:def5678]", commit: "def5678", creada: false }],
      mensajes: [{ tipo: "alexander", numero: "573001112233", texto: "hola" }],
      sugeridos: [{ asesora: "María" }],
    },
    "2026-10-27",
    "sistemas",
  );
  assert.equal(ok.mensajes.length, 0);
  assert.equal(ok.sugeridos.length, 0);
  assert.deepEqual(ok.meta.revisiones.map((r) => r.resultado), ["FUNCIONA", "FALLA", "NO_SE_PUEDE_PROBAR"]);
  assert.equal(ok.meta.linea, "Sistemas: falla “B”", "sin línea del agente, se arma sola");
  assert.equal(ok.meta.arreglos[0].creada, false);
  assert.throws(() => reglas.leerResumenAGuardar({ revisiones: [{ titulo: "X", resultado: "FALLA" }] }, "2026-10-27", "sistemas"), /necesita el error exacto/);
  assert.throws(() => reglas.leerResumenAGuardar({ revisiones: [{ titulo: "X", resultado: "NO_SE_PUEDE_PROBAR" }] }, "2026-10-27", "sistemas"), /necesita el porqué/);
  assert.throws(() => reglas.leerResumenAGuardar({ revisiones: [{ titulo: "X", resultado: "TAL_VEZ" }] }, "2026-10-27", "sistemas"), /FUNCIONA, FALLA o NO SE PUEDE PROBAR/);
});

await prueba("guardar el resumen de Sistemas dos veces el mismo día deja uno solo y no pisa a Ventas ni a Marketing", async () => {
  reiniciar();
  await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { fecha: "2026-10-27", resumen: "ventas" }, contexto);
  await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { area: "marketing", fecha: "2026-10-27", linea: "M", resumen: "marketing" }, contexto);
  const uno = await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { area: "sistemas", fecha: "2026-10-27", resumen: "primero", linea: "Sistemas: todo funciona", es_prueba: true }, contexto);
  const dos = await mcp.ejecutarHerramientaMcpAgentesDeArea(
    "guardar_resumen_del_dia",
    { area: "sistemas", fecha: "2026-10-27", resumen: "segundo", revisiones: [{ titulo: "A", resultado: "FALLA", detalle: "HTTP 500", commit: "abc1234" }], subagentes: { "revisor-de-produccion": { ok: true } } },
    contexto,
  );
  assert.equal(uno.id, dos.id, "se reemplazó");
  assert.equal([...db.dias.values()].filter((d) => d.area === "sistemas").length, 1);
  assert.equal(db.dias.get("ws1|ventas|2026-10-27").resumen, "ventas");
  assert.equal(db.dias.get("ws1|marketing|2026-10-27").resumen, "marketing");
  assert.equal(db.dias.get("ws1|sistemas|2026-10-27").resumen, "segundo");
  await assert.rejects(() => mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { area: "finanzas" }, contexto), /"ventas", "marketing" o "sistemas"/);
});

/* ------------------------------------------------------------------ el interruptor, la línea de las 7:30 y la lectura por voz */

await prueba("el interruptor de sistemas empieza apagado y es independiente de los otros", async () => {
  reiniciar();
  assert.equal(reglas.claveInterruptorDelAgente("sistemas", WS), "agente-area:sistemas:ws1");
  assert.equal((await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_sistemas", {}, contexto)).interruptor, "apagado");
  db.settings.set("agente-area:ventas:ws1", JSON.stringify({ activo: true }));
  db.settings.set("agente-area:marketing:ws1", JSON.stringify({ activo: true }));
  assert.equal((await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_sistemas", {}, contexto)).interruptor, "apagado", "prender Ventas o Marketing no prende Sistemas");
  db.settings.set("agente-area:sistemas:ws1", JSON.stringify({ activo: true }));
  assert.equal((await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_sistemas", {}, contexto)).interruptor, "prendido");
});

await prueba("la línea de las 7:30: apagado NO entra; prendido entra en el mismo mensaje; sin corrida y tarde se avisan", () => {
  const resumen = { linea: "Sistemas: todo funciona", salioTarde: false, notaDeRetraso: null };
  assert.equal(sis.lineaDeSistemasParaAlexander({ interruptorPrendido: false, resumen }), null);
  assert.equal(sis.lineaDeSistemasParaAlexander({ interruptorPrendido: false, resumen: null }), null);
  assert.equal(sis.lineaDeSistemasParaAlexander({ interruptorPrendido: true, resumen }), "Sistemas: todo funciona");
  assert.equal(sis.lineaDeSistemasParaAlexander({ interruptorPrendido: true, resumen: { ...resumen, linea: "falla X" } }), "Sistemas: falla X");
  assert.equal(sis.lineaDeSistemasParaAlexander({ interruptorPrendido: true, resumen: null }), "Sistemas: sin revisión hoy");
  assert.ok(sis.lineaDeSistemasParaAlexander({ interruptorPrendido: true, resumen: { ...resumen, salioTarde: true, notaDeRetraso: "aizen1 prendió a las 7:41" } }).endsWith("(salió tarde: aizen1 prendió a las 7:41)"));
});

await prueba("agente_de_sistemas (por voz): el resumen de hoy trae la línea, lo que falla, lo que no se pudo probar, lo atascado y el informe de Uso", async () => {
  reiniciar();
  db.tarjetas = [tarjeta("atasco", { estado: "EN_CURSO", trabajoIniciadoEn: new Date(Date.now() - 3 * 3_600_000), titulo: "Atascada" })]; // la herramienta usa la hora real
  await mcp.ejecutarHerramientaMcpAgentesDeArea(
    "guardar_resumen_del_dia",
    {
      area: "sistemas",
      fecha: "2026-10-26",
      resumen: "lunes",
      subagentes: { uso: { nadieLoUsa: [{ titulo: "Embudo viejo" }] } },
    },
    contexto,
  );
  await mcp.ejecutarHerramientaMcpAgentesDeArea(
    "guardar_resumen_del_dia",
    {
      area: "sistemas",
      fecha: "2026-10-27",
      linea: "Sistemas: falla “Tabla”",
      resumen: "hoy",
      revisiones: [
        { titulo: "Tabla", resultado: "FALLA", detalle: "HTTP 500 en /cliente/crm/tabla", commit: "abc1234" },
        { titulo: "Gestión", resultado: "NO_SE_PUEDE_PROBAR", detalle: "es un cambio de Gestión sin pantalla" },
        { titulo: "Ok", resultado: "FUNCIONA" },
      ],
      arreglos: [{ titulo: "Arreglar Tabla [sistemas:abc1234]", commit: "abc1234", creada: false }],
    },
    contexto,
  );
  const ver = await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_sistemas", { fecha: "2026-10-27" }, contexto);
  assert.equal(ver.agente, "Agente de Sistemas");
  assert.equal(ver.resumen_del_dia.linea_para_alexander, "Sistemas: falla “Tabla”");
  assert.equal(ver.resumen_del_dia.lo_que_falla.length, 1);
  assert.equal(ver.resumen_del_dia.lo_que_falla[0].detalle, "HTTP 500 en /cliente/crm/tabla");
  assert.equal(ver.resumen_del_dia.lo_que_no_se_pudo_probar.length, 1);
  assert.equal(ver.resumen_del_dia.tarjetas_de_arreglo[0].creada, false);
  assert.equal(ver.atascadas_ahora.length, 1);
  assert.equal(ver.ultimo_informe_de_uso.fecha, "2026-10-26");
  assert.equal(ver.ultimo_informe_de_uso.informe.nadieLoUsa[0].titulo, "Embudo viejo");
  assert.equal(ver.ultimos_dias.length, 2, "solo los días de sistemas");
  assert.ok(ver.advertencias.some((x) => x.includes("solo LEE")));
});

/* ------------------------------------------------------------------ marca de la tarjeta de arreglo */

await prueba("la marca [sistemas:<commit>] se arma con el commit, y las tarjetas de arreglo ya creadas se ven para no repetirlas", async () => {
  assert.equal(sis.marcaDeArreglo("ABC1234DEF5678901"), "[sistemas:abc1234def56]");
  assert.equal(sis.marcaDeArreglo("abc"), null);
  assert.equal(sis.marcaDeArreglo(null), null);
  assert.ok(sis.tieneMarcaDeArreglo("Arreglar la tabla [sistemas:abc1234]") && !sis.tieneMarcaDeArreglo("Arreglar la tabla"));
  reiniciar();
  db.tarjetas = [tarjeta("ya", { estado: "POR_APROBAR", titulo: "Arreglar la tabla [sistemas:abc1234]" }), tarjeta("otra", { estado: "HECHO", titulo: "Sin marca" })];
  const r = await revision.revisionDeSistemas(WS, { ahora: AHORA });
  assert.deepEqual(r.arreglos_ya_creados.map((x) => x.tarjeta_id), ["ya"]);
});

/* ------------------------------------------------------------------ solo lee, herramientas y pantalla */

await prueba("revision_de_sistemas y agente_de_sistemas están registradas, son de solo lectura y el servicio solo lee", () => {
  const por = (nombre) => mcp.HERRAMIENTAS_MCP_AGENTES_DE_AREA.find((h) => h.name === nombre);
  assert.equal(por("revision_de_sistemas").annotations.readOnlyHint, true);
  assert.equal(por("agente_de_sistemas").annotations.readOnlyHint, true);
  assert.ok(mcp.esHerramientaDeAgentesDeArea("revision_de_sistemas") && mcp.esHerramientaDeAgentesDeArea("agente_de_sistemas"));
  assert.ok(por("guardar_resumen_del_dia").inputSchema.properties.area.enum.includes("sistemas"));
  const codigo = fs.readFileSync(path.join(RAIZ, "src/features/agentes-de-area/servicios/revision-de-sistemas.ts"), "utf8");
  assert.ok(!/\.(create|update|upsert|delete|updateMany|deleteMany)\(|INSERT|DELETE FROM|UPDATE "/i.test(codigo), "el servicio solo lee");
});

await prueba("un MCP sin permiso (no es del equipo que supervisa) no puede leer la revisión", async () => {
  await assert.rejects(() => mcp.ejecutarHerramientaMcpAgentesDeArea("revision_de_sistemas", {}, { workspaceId: WS, userId: "intruso" }), /no tiene permiso/);
});

await prueba("la pantalla: ruta nueva, menú junto a Ventas y Marketing, mismo panel con la tabla de revisiones y el mismo permiso", () => {
  const pagina = fs.readFileSync(path.join(RAIZ, "src/app/cliente/crm/agente-de-sistemas/page.tsx"), "utf8");
  assert.ok(pagina.includes('area="sistemas"'));
  const compartida = fs.readFileSync(path.join(RAIZ, "src/features/agentes-de-area/components/PaginaDeAgenteDeArea.tsx"), "utf8");
  assert.ok(compartida.includes("puedeSupervisar(access)"), "mismos permisos que Ventas");
  const nav = fs.readFileSync(path.join(RAIZ, "src/components/nav-crm.tsx"), "utf8");
  assert.ok(nav.indexOf('view: "agente-de-marketing"') < nav.indexOf('view: "agente-de-sistemas"'));
  assert.ok(/agente-de-sistemas[^\n]*soloJefes: true/.test(nav));
  const panel = fs.readFileSync(path.join(RAIZ, "src/features/agentes-de-area/components/PanelAgenteDeArea.tsx"), "utf8");
  assert.ok(panel.includes("TablaDeRevisiones") && panel.includes("InterruptorDelAgente"));
  const acciones = fs.readFileSync(path.join(RAIZ, "src/app/actions/agentes-de-area-actions.ts"), "utf8");
  assert.ok(acciones.includes("esArea(area)"));
  const sidebar = fs.readFileSync(path.join(RAIZ, "src/components/app-sidebar.tsx"), "utf8");
  assert.ok(sidebar.includes('"agente-de-sistemas"'));
});

await prueba("la tabla de revisiones lee solo lo que viene y deja '—' en lo que falta", () => {
  const tabla = cargar("src/features/agentes-de-area/components/TablaDeRevisiones.tsx", { ...mocks, "react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: null } });
  const filas = tabla.leerRevisionesDelResumen({ revisiones: [{ titulo: "A", resultado: "FALLA", detalle: "HTTP 500", commit: "abc1234" }, "basura", { resultado: "FUNCIONA" }] });
  assert.equal(filas.length, 2);
  assert.equal(filas[1].titulo, "(sin título)");
  assert.deepEqual(tabla.leerRevisionesDelResumen(null), []);
  assert.equal(tabla.leerArreglosDelResumen({ arreglos: [{ titulo: "X", creada: true }, { titulo: "Y" }] }).map((a) => a.creada).join(), "true,false");
});

await prueba("la migración del contador es solo aditiva y está en la carpeta esperada", () => {
  const sql = fs.readFileSync(path.join(RAIZ, "prisma/migrations/20261023120000_uso_del_sistema/migration.sql"), "utf8");
  assert.ok(/^\s*BEGIN;/m.test(sql) && /COMMIT;\s*$/.test(sql.trim()));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "UsoDelSistemaDia"'));
  assert.ok(!/\b(DROP|DELETE\s+FROM|TRUNCATE|ALTER|RENAME)\b/i.test(sql.replace(/^--.*$/gm, "")));
  const esquema = fs.readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
  assert.ok(esquema.includes("model UsoDelSistemaDia") && esquema.includes("@@unique([workspaceId, fecha, tipo, clave, quien])"));
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:\n- " + fallas.join("\n- "));
  process.exit(1);
}
