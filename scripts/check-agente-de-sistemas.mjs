// Pruebas del Agente de Sistemas (tercera área del molde de agentes de área), con una base de mentira.
//   npm run test:agente-de-sistemas
// El candado y las herramientas de aizen1 se prueban aparte: agentes-de-area/pruebas/probar-agente-de-sistemas.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";
const AHORA = new Date("2026-10-28T11:30:00Z"); // 6:30 a. m. en Colombia
const hace = (horas, minutos = 0) => new Date(AHORA.getTime() - (horas * 60 + minutos) * 60_000);

const db = { settings: new Map(), dias: new Map(), siguiente: 1, historial: [], tarjetas: [], claves: [], uso: new Map(), usoFalla: false };

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
  // Solo las tarjetas HECHO con repo, no borradas, cuyo cambio de estado cae dentro del rango.
  historialTarjeta: {
    findMany: async ({ where }) =>
      db.historial
        .filter((h) => h.accion === where.accion && h.creadoEn >= where.creadoEn.gte && h.tarjeta.estado === "HECHO" && h.tarjeta.repo)
        .sort((a, b) => b.creadoEn - a.creadoEn),
  },
  tarjetaTablero: {
    findMany: async ({ where }) => db.tarjetas.filter((t) => (where.estado.in ? where.estado.in.includes(t.estado) : t.estado === where.estado)),
  },
  claveTrabajador: { findMany: async () => db.claves },
  usoDelSistemaDia: {
    upsert: async ({ where, create, update }) => {
      if (db.usoFalla) throw new Error("la base no responde");
      const k = where.workspaceId_fecha_tipo_clave_quien;
      const id = `${k.workspaceId}|${k.fecha}|${k.tipo}|${k.clave}|${k.quien}`;
      const previo = db.uso.get(id);
      db.uso.set(id, previo ? { ...previo, veces: previo.veces + update.veces.increment } : { ...create });
      return {};
    },
    findMany: async ({ where }) => [...db.uso.values()].filter((f) => f.fecha >= where.fecha.gte),
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@prisma/client": { Prisma: { sql: (s, ...v) => ({ strings: [...s], valores: v }), join: (x) => x, DbNull: "DbNull" } },
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
const revision = cargar("src/features/agentes-de-area/servicios/revision-de-sistemas.ts", mocks);
const uso = cargar("src/lib/uso-del-sistema.ts", mocks);
const mcp = cargar("src/lib/mcp/agentes-de-area.ts", mocks);
const resumenes = cargar("src/features/agentes-de-area/servicios/resumenes.ts", mocks);
const textoDeHerramientas = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
const textoDeLaRuta = fs.readFileSync(path.join(RAIZ, "src/app/api/mcp/route.ts"), "utf8");
const textoDelLatido = fs.readFileSync(path.join(RAIZ, "src/app/api/cliente/actividad/latido/route.ts"), "utf8");

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
const hecha = (id, titulo, haceHoras, extra = {}) => ({
  tarjetaId: id,
  accion: "estado",
  creadoEn: hace(haceHoras),
  despues: { estado: "HECHO", subida: { commit: `commit${id}`, linkCommit: `https://github.com/x/y/commit/${id}` } },
  tarjeta: {
    estado: "HECHO",
    repo: "aizencrm",
    titulo,
    detalle: "detalle",
    resultado: { rama: `tablero/${id}`, archivos: ["src/app/cliente/crm/pauta/page.tsx", "src/lib/x.ts"], subida: { commit: `commit${id}` } },
    tablero: { nombre: "Magilus General" },
    ...extra,
  },
});

/* ------------------------------------------------------------------ las tarjetas HECHO de 24 h */

await prueba("una tarjeta que pasó a HECHO hace 3 horas entra en la revisión; una de hace 30 horas no", async () => {
  db.historial = [hecha("a", "Pantalla A", 3), hecha("b", "Pantalla B", 30)];
  const r = await revision.tarjetasHechasRecientemente(WS, AHORA);
  assert.deepEqual(r.map((t) => t.tarjetaId), ["a"]);
  assert.equal(r[0].commit, "commita");
  assert.equal(r[0].rama, "tablero/a");
  assert.equal(r[0].hechoEn, hace(3).toISOString(), "la hora sale del historial de la tarjeta");
  assert.deepEqual(r[0].pantallas, ["/cliente/crm/pauta"], "la pantalla sale de los archivos que tocó");
});

await prueba("entran juntas las tarjetas de los dos repos y de varios tableros; cada una una sola vez", async () => {
  db.historial = [
    hecha("a", "En CRM", 2),
    hecha("b", "En Gestión", 5, { repo: "gestion", tablero: { nombre: "Desarrollo Emanuel" } }),
    hecha("a", "En CRM", 6),
  ];
  const r = await revision.tarjetasHechasRecientemente(WS, AHORA);
  assert.deepEqual(r.map((t) => t.tarjetaId).sort(), ["a", "b"]);
  assert.deepEqual(r.map((t) => t.repo).sort(), ["aizencrm", "gestion"]);
  assert.equal(new Set(r.map((t) => t.tablero)).size, 2);
  assert.equal(r.find((t) => t.tarjetaId === "a").hechoEn, hace(2).toISOString(), "cuenta el cambio más reciente");
});

await prueba("sin repo no entra, y un estado que no dejó la tarjeta en HECHO tampoco", async () => {
  const sinRepo = hecha("c", "Sin repo", 1, { repo: null });
  const noHecho = { ...hecha("d", "No es HECHO", 1), despues: { estado: "ERROR" } };
  db.historial = [sinRepo, noHecho];
  assert.deepEqual(await revision.tarjetasHechasRecientemente(WS, AHORA), []);
});

/* ------------------------------------------------------------------ atascadas, ERROR y el trabajador */

await prueba("2 h 10 min en EN_CURSO sale atascada; 1 h 50 min no; en ERROR salen con su motivo", async () => {
  const t = (id, estado, desde, resultado = null) => ({ id, titulo: `T ${id}`, estado, actualizadoEn: desde, trabajoIniciadoEn: desde, resultado, tablero: { nombre: "Magilus General" } });
  db.tarjetas = [t("x", "EN_CURSO", hace(2, 10)), t("y", "EN_CURSO", hace(1, 50)), t("z", "PLANEANDO", hace(3)), t("w", "SUBIENDO", hace(0, 20)), t("e", "ERROR", hace(9), { error: "no compila: falta un import" })];
  const atascadas = await revision.tarjetasAtascadas(WS, AHORA);
  assert.deepEqual(atascadas.map((a) => a.tarjetaId), ["z", "x"], "las más viejas primero");
  assert.equal(atascadas.find((a) => a.tarjetaId === "x").horasAtascada, 2.2);
  const errores = await revision.tarjetasEnError(WS);
  assert.deepEqual(errores.map((e) => [e.tarjetaId, e.motivo]), [["e", "no compila: falta un import"]]);
});

await prueba("la clave del trabajador sin uso hace 40 minutos sale 'sin señal'; hace 5 minutos, viva", async () => {
  db.claves = [{ nombre: "aizen1", ultimoUsoEn: hace(0, 40) }, { nombre: "otra", ultimoUsoEn: hace(0, 1) }];
  const sin = await revision.vidaDelTrabajadorDelNegocio(WS, AHORA);
  assert.equal(sin.vivo, false);
  assert.equal(sin.clave, "aizen1");
  assert.match(sin.texto, /^sin señal desde /);
  db.claves = [{ nombre: "aizen1", ultimoUsoEn: hace(0, 5) }];
  assert.equal((await revision.vidaDelTrabajadorDelNegocio(WS, AHORA)).vivo, true);
  db.claves = [];
  assert.equal((await revision.vidaDelTrabajadorDelNegocio(WS, AHORA)).vivo, false);
});

/* ------------------------------------------------------------------ el contador */

await prueba("dos latidos en la misma pantalla el mismo día dan una fila con veces = 2", async () => {
  db.uso.clear();
  await uso.contarPantalla({ workspaceId: WS, userId: "ana", ruta: "/cliente/crm/pauta?fecha=2026-10-01" });
  await uso.contarPantalla({ workspaceId: WS, userId: "ana", ruta: "/cliente/crm/pauta" });
  await uso.contarPantalla({ workspaceId: WS, userId: "bea", ruta: "/cliente/crm/pauta" });
  const filas = [...db.uso.values()];
  assert.equal(filas.length, 2);
  assert.equal(filas.find((f) => f.quien === "ana").veces, 2);
  assert.equal(filas[0].tipo, "pantalla");
});

await prueba("el contador cuenta las herramientas del MCP, y NO cuenta al propio Agente de Sistemas ni rutas fuera de /cliente", async () => {
  db.uso.clear();
  await uso.contarHerramienta({ workspaceId: WS, userId: "alex", nombre: "ver_tablero" });
  await uso.contarHerramienta({ workspaceId: WS, userId: "alex", nombre: "agente_de_sistemas" });
  await uso.contarHerramienta({ workspaceId: WS, userId: "alex", nombre: "revision_de_sistemas" });
  await uso.contarPantalla({ workspaceId: WS, userId: "alex", ruta: "/cliente/crm/agente-de-sistemas" });
  await uso.contarPantalla({ workspaceId: WS, userId: "alex", ruta: "/api/algo" });
  assert.deepEqual([...db.uso.values()].map((f) => f.clave), ["ver_tablero"]);
  assert.equal(reglas.clavePantallaParaContar("/cliente/chats/abc123/otra/cosa"), "/cliente/chats/abc123", "a lo más tres niveles");
});

await prueba("si la base falla, el contador no lanza y el latido y el MCP lo llaman sin esperarlo", async () => {
  db.usoFalla = true;
  await uso.contarPantalla({ workspaceId: WS, userId: "ana", ruta: "/cliente/crm/pauta" });
  await uso.contarHerramienta({ workspaceId: WS, userId: "ana", nombre: "ver_tablero" });
  db.usoFalla = false;
  assert.match(textoDelLatido, /void contarPantalla\(/, "el latido no espera al contador");
  assert.match(textoDeLaRuta, /void contarHerramienta\(/, "el MCP no espera al contador");
});

await prueba("revision_de_sistemas con dias suma el uso de cada cosa subida", async () => {
  db.uso.clear();
  db.historial = [hecha("a", "Pantalla A", 3)];
  db.tarjetas = [];
  db.claves = [{ nombre: "aizen1", ultimoUsoEn: hace(0, 2) }];
  await uso.contarPantalla({ workspaceId: WS, userId: "ana", ruta: "/cliente/crm/pauta" });
  const hoy = reglas.hoyEnBogota(new Date());
  for (const f of db.uso.values()) f.fecha = hoy;
  const datos = await revision.datosDeRevision(WS, { dias: 30, ahora: new Date() });
  assert.equal(datos.ultimos_dias, 30);
  assert.ok(Array.isArray(datos.uso_pantallas));
  assert.equal(datos.uso_pantallas[0].veces, 1);
});

/* ------------------------------------------------------------------ la línea y el guardado */

await prueba("la línea: sin nada roto dice 'Sistemas: todo funciona'; con algo roto dice qué", () => {
  const bien = { fallas: 0, sinProbar: 1, funcionan: 3, atascadas: 0, enError: 0, trabajadorVivo: true };
  assert.equal(reglas.lineaDeSistemas(bien), "Sistemas: todo funciona");
  const mal = reglas.lineaDeSistemas({ ...bien, fallas: 1, atascadas: 2, enError: 1, trabajadorVivo: false });
  assert.match(mal, /1 subida falla/);
  assert.match(mal, /2 tarjetas atascadas/);
  assert.match(mal, /1 en ERROR/);
  assert.match(mal, /el trabajador no da señal/);
});

await prueba("con el interruptor apagado la línea no entra en el mensaje de las 7:30; prendido sí, en el mismo mensaje", () => {
  const resumen = { linea: "todo funciona", salioTarde: false, notaDeRetraso: null };
  assert.equal(reglas.lineaDeSistemasParaAlexander({ interruptorPrendido: false, resumen }), null);
  assert.equal(reglas.lineaDeSistemasParaAlexander({ interruptorPrendido: true, resumen }), "Sistemas: todo funciona");
  assert.equal(reglas.lineaDeSistemasParaAlexander({ interruptorPrendido: true, resumen: null }), "Sistemas: sin revisión hoy");
  assert.match(reglas.lineaDeSistemasParaAlexander({ interruptorPrendido: true, resumen: { ...resumen, salioTarde: true, notaDeRetraso: "aizen1 prendió a las 8:12" } }), /salió tarde: aizen1 prendió a las 8:12/);
  const lanzador = fs.readFileSync(path.join(RAIZ, "agentes-de-area/correr-agente.mjs"), "utf8");
  assert.match(lanzador, /conLineaDeSistemas\(/, "el lanzador la suma al MISMO mensaje");
});

const revisiones = [
  { titulo: "Pantalla A", repo: "aizencrm", commit: "abc123456789", resultado: "FUNCIONA" },
  { titulo: "Ruta rota", repo: "aizencrm", commit: "def", resultado: "falla", detalle: "GET /cliente/ruta-de-prueba-rota → 500: boom" },
  { titulo: "Solo escribe", repo: "gestion", commit: "9f9", resultado: "NO SE PUEDE PROBAR", detalle: "solo se prueba escribiendo datos" },
];

await prueba("guardar el resumen de Sistemas dos veces el mismo día deja uno solo y no pisa el de Ventas ni el de Marketing", async () => {
  db.dias.clear();
  await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { fecha: "2026-10-28", resumen: "ventas" }, contexto);
  await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { area: "marketing", fecha: "2026-10-28", linea: "marketing ok" }, contexto);
  const args = { area: "sistemas", fecha: "2026-10-28", linea: "Sistemas: 1 subida falla en producción", revisiones, salud: { disco: "ok" }, arreglos: [{ titulo: "[sistemas:def] arreglar", commit: "def", estado: "se_crearia" }], es_prueba: true };
  const uno = await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", args, contexto);
  assert.equal(uno.area, "sistemas");
  await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { ...args, linea: "Sistemas: todo funciona", revisiones: [revisiones[0]] }, contexto);
  const filas = [...db.dias.values()];
  assert.equal(filas.length, 3, "uno por área");
  assert.equal(filas.filter((f) => f.area === "sistemas").length, 1);
  const sistemas = db.dias.get(`${WS}|sistemas|2026-10-28`);
  assert.equal(sistemas.meta.linea, "Sistemas: todo funciona", "el segundo guardado reemplaza");
  assert.equal(sistemas.meta.revisiones.length, 1);
  assert.equal(db.dias.get(`${WS}|ventas|2026-10-28`).resumen, "ventas");
  assert.equal(db.dias.get(`${WS}|marketing|2026-10-28`).meta.linea, "marketing ok");
  assert.deepEqual(sistemas.mensajes, [], "Sistemas nunca deja mensajes de WhatsApp");
});

await prueba("las revisiones exigen un resultado válido, el error exacto en FALLA y el porqué en NO SE PUEDE PROBAR", () => {
  assert.equal(reglas.leerResultadoDeRevision("no_se_puede_probar"), "NO SE PUEDE PROBAR");
  assert.equal(reglas.leerResultadoDeRevision("Falla"), "FALLA");
  assert.throws(() => reglas.leerRevisionesDeSistemas([{ titulo: "x", resultado: "tal vez" }]), /FUNCIONA, FALLA o NO SE PUEDE PROBAR/);
  assert.throws(() => reglas.leerRevisionesDeSistemas([{ titulo: "x", resultado: "FALLA" }]), /error exacto/);
  assert.throws(() => reglas.leerRevisionesDeSistemas([{ titulo: "x", resultado: "NO SE PUEDE PROBAR" }]), /porqué/);
  assert.equal(reglas.leerRevisionesDeSistemas([{ titulo: "x", resultado: "FUNCIONA" }]).length, 1);
});

await prueba("agente_de_sistemas se lee por voz: interruptor, línea, qué falla y qué no se pudo probar, y el último informe de Uso", async () => {
  db.dias.clear();
  await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { area: "sistemas", fecha: "2026-10-26", linea: "Sistemas: todo funciona", subagentes: { uso: { lista: ["Pantalla Z: nadie la usó"] } } }, contexto);
  await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { area: "sistemas", fecha: "2026-10-28", linea: "Sistemas: 1 subida falla en producción", revisiones, arreglos: [{ titulo: "[sistemas:def] arreglar", estado: "se_crearia" }] }, contexto);
  db.tarjetas = [];
  db.claves = [{ nombre: "aizen1", ultimoUsoEn: new Date() }];
  const vista = await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_sistemas", { fecha: "2026-10-28" }, contexto);
  assert.equal(vista.agente, "Agente de Sistemas");
  assert.equal(vista.interruptor, "apagado", "empieza apagado");
  assert.equal(vista.resumen_del_dia.linea_para_alexander, "Sistemas: 1 subida falla en producción");
  assert.equal(vista.resumen_del_dia.falla.length, 1);
  assert.equal(vista.resumen_del_dia.falla[0].detalle, "GET /cliente/ruta-de-prueba-rota → 500: boom");
  assert.equal(vista.resumen_del_dia.no_se_pudo_probar.length, 1);
  assert.equal(vista.resumen_del_dia.tarjetas_de_arreglo[0].estado, "se_crearia");
  assert.equal(vista.ultimo_informe_de_uso.fecha, "2026-10-26");
  assert.ok(vista.advertencias.some((a) => /solo LEE/.test(a)));
});

await prueba("las dos herramientas son de solo lectura, están registradas y piden el permiso del Supervisor", async () => {
  for (const nombre of ["revision_de_sistemas", "agente_de_sistemas"]) {
    const herramienta = mcp.HERRAMIENTAS_MCP_AGENTES_DE_AREA.find((h) => h.name === nombre);
    assert.ok(herramienta, nombre);
    assert.equal(herramienta.annotations.readOnlyHint, true);
    assert.ok(mcp.esHerramientaDeAgentesDeArea(nombre));
  }
  assert.match(textoDeHerramientas, /HERRAMIENTAS_MCP_AGENTES_DE_AREA/);
  await assert.rejects(() => mcp.ejecutarHerramientaMcpAgentesDeArea("revision_de_sistemas", {}, { workspaceId: WS, userId: "nadie" }), /no tiene permiso/);
});

await prueba("la marca [sistemas:<commit>] evita repetir la tarjeta de arreglo", () => {
  assert.equal(reglas.marcaDeArreglo("abc123456789012345"), "[sistemas:abc123456789]");
  assert.equal(reglas.yaExisteArreglo(["otra", "[sistemas:abc123456789] Arreglar la pauta"], "abc123456789012345"), true);
  assert.equal(reglas.yaExisteArreglo(["otra"], "abc123456789"), false);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log(`Fallaron: ${fallas.join("; ")}`);
  process.exit(1);
}
