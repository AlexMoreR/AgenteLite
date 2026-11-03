// Pruebas de las reglas del Coach con Opus (parte 1, 3-nov-2026): src/features/coach/revision-opus/reglas.ts.
// Qué se rechaza al guardar la revisión y cómo salen los avisos a la asesora y al dueño.
// Parte 2: las herramientas del MCP (src/lib/mcp/coach.ts) y el área de envío "coach" (agentes-de-area/servicios/envios.ts),
// con la base, el WhatsApp y las alertas simulados: con el interruptor apagado no se guarda ni se manda nada.
// Sin base ni red. Correr: npm run test:coach-opus
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);
const cache = new Map();
// Módulos simulados por pedido ("@/lib/prisma", ...). Lo que empieza con "@/" y no está aquí se carga de src/.
let simulados = new Map();
function cargar(archivo) {
  const absoluto = path.resolve(archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (simulados.has(pedido)) return simulados.get(pedido);
    if (pedido.startsWith(".") || pedido.startsWith("@/")) {
      const base = pedido.startsWith("@/") ? path.resolve("src", pedido.slice(2)) : path.resolve(path.dirname(absoluto), pedido);
      const simulado = [...simulados.keys()].find((clave) => clave.startsWith("@/") && path.resolve("src", clave.slice(2)) === base);
      if (simulado) return simulados.get(simulado);
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(mod.exports, requerir, mod, absoluto, path.dirname(absoluto));
  return mod.exports;
}

const r = cargar("src/features/coach/revision-opus/reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const chat = (chatId, tipo, causa = "asesora", extra = {}) => ({
  chatId,
  tipo,
  quePaso: `El cliente preguntó el precio en el chat ${chatId}.`,
  momentoCaida: "Después de mandar el precio no se hizo pregunta de cierre.",
  mensajeModelo: "¿Te lo separo para entrega esta semana?",
  causa,
  ...extra,
});
const revision = (chats, extra = {}) => ({
  nombre: "Ingrid Pérez",
  modelo: "opus",
  resumen: "Respondiste rápido y con buena actitud. Falta cerrar con una pregunta.",
  chats,
  chatsLeidos: 14,
  ...extra,
});
const URL = "https://crm.ejemplo.com/";

prueba("CAUSAS es la lista acordada", () => {
  assert.deepEqual([...r.CAUSAS], ["asesora", "bot", "politica", "cliente_sin_intencion"]);
});

prueba("una revisión bien armada no tiene errores", () => {
  const datos = revision([chat("c1", "bien"), chat("c2", "mejorable"), chat("c3", "mejorable", "bot")]);
  assert.deepEqual(r.validarRevision(datos), []);
  assert.deepEqual(r.validarRevision(revision([])), []);
});

prueba("rechaza 2 chats 'bien'", () => {
  const errores = r.validarRevision(revision([chat("c1", "bien"), chat("c2", "bien")]));
  assert.ok(errores.some((e) => /2 chats "bien"/.test(e)), errores.join(" | "));
});

prueba("rechaza 3 chats 'mejorable'", () => {
  const errores = r.validarRevision(
    revision([chat("c1", "mejorable"), chat("c2", "mejorable"), chat("c3", "mejorable")]),
  );
  assert.ok(errores.some((e) => /3 chats "mejorable"/.test(e)), errores.join(" | "));
});

prueba("rechaza una causa inventada y un tipo inventado", () => {
  const errores = r.validarRevision(revision([chat("c1", "mejorable", "mala_suerte")]));
  assert.ok(errores.some((e) => /mala_suerte/.test(e)), errores.join(" | "));
  assert.ok(r.validarRevision(revision([chat("c1", "regular")])).some((e) => /bien o mejorable/.test(e)));
});

prueba("rechaza un teléfono escrito en el texto, con o sin espacios, guiones o +", () => {
  for (const telefono of ["3001234567", "+57 300 123 4567", "300-123-4567", "+573001234567", "300 1234"]) {
    const enChat = r.validarRevision(revision([chat("c1", "mejorable", "asesora", { quePaso: `Le escribió al ${telefono}` })]));
    assert.ok(enChat.some((e) => /teléfono/.test(e)), `no rechazó ${telefono} en quePaso`);
    const enResumen = r.validarRevision(revision([], { resumen: `Llama al ${telefono} mañana` }));
    assert.ok(enResumen.some((e) => /teléfono/.test(e)), `no rechazó ${telefono} en el resumen`);
  }
  // Los últimos 4, un precio con puntos y una fecha AAAA-MM-DD sí se pueden escribir.
  const ok = r.validarRevision(
    revision([chat("c1", "mejorable", "asesora", { quePaso: "El de …4567 pidió la cama de $1.250.000 el 2026-11-03" })]),
  );
  assert.deepEqual(ok, []);
});

prueba("rechaza lo que no es una revisión", () => {
  assert.ok(r.validarRevision(null).length > 0);
  assert.ok(r.validarRevision(revision("no es lista")).some((e) => /lista/.test(e)));
  assert.ok(r.validarRevision(revision([], { chatsLeidos: -1 })).some((e) => /chatsLeidos/.test(e)));
  assert.ok(r.validarRevision(revision([chat("c1", "bien"), chat("c1", "mejorable")])).some((e) => /repetido/.test(e)));
});

prueba("ultimos4 deja solo los últimos 4 dígitos", () => {
  assert.equal(r.ultimos4("+57 300 123 4567"), "4567");
  assert.equal(r.ultimos4("3001234567"), "4567");
  assert.equal(r.ultimos4(null), "");
});

prueba("el texto de la asesora trae su link, es corto y no trae teléfonos", () => {
  const texto = r.textoParaAsesora(
    {
      userId: "user_123",
      ...revision([chat("c1", "bien"), chat("c2", "mejorable")], {
        resumen: `${"Muy buen día de ventas, respondiste rápido. ".repeat(30)} El cliente 3001234567 volvió.`,
      }),
    },
    URL,
  );
  assert.ok(texto.includes("https://crm.ejemplo.com/cliente/equipo/coach/asesora/user_123"), texto);
  assert.ok(texto.length < 600, `largo ${texto.length}`);
  assert.equal(r.tieneTelefono(texto), false, texto);
  assert.match(texto, /Hola Ingrid/);
  assert.match(texto, /1 chat para mejorar/);
  const conTelefono = r.textoParaAsesora(
    { userId: "u9", ...revision([], { resumen: "El cliente +57 300 123 4567 volvió." }) },
    "https://crm.ejemplo.com",
  );
  assert.doesNotMatch(conTelefono, /300 123 4567/);
  assert.match(conTelefono, /…4567/);
  assert.ok(conTelefono.includes("https://crm.ejemplo.com/cliente/equipo/coach/asesora/u9"));
});

prueba("a la asesora no se le mencionan los chats de causa bot o política", () => {
  const conAjenos = r.textoParaAsesora(
    { userId: "u1", ...revision([chat("c1", "mejorable", "bot"), chat("c2", "mejorable", "politica")]) },
    URL,
  );
  assert.doesNotMatch(conAjenos, /para mejorar/);
  assert.doesNotMatch(conAjenos, /c1|c2/);
  const bienDelBot = r.textoParaAsesora({ userId: "u1", ...revision([chat("cX", "bien", "bot")]) }, URL);
  assert.doesNotMatch(bienDelBot, /Bien:/);
});

prueba("lo del dueño trae una línea por asesora", () => {
  const lineas = r.lineasParaDueno([
    { userId: "u1", ...revision([chat("c1", "bien"), chat("c2", "mejorable", "bot")]) },
    { userId: "u2", ...revision([chat("c3", "mejorable")], { nombre: "Génesis" }) },
    { userId: "u3", ...revision([], { nombre: "María Camila", resumen: "Llamó al 300 123 4567" }) },
  ]);
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /^Ingrid Pérez: 14 chats leídos · 1 bien · 1 para mejorar · 1 por el bot o la política/);
  assert.match(lineas[1], /^Génesis:/);
  assert.match(lineas[2], /^María Camila:/);
  assert.equal(r.tieneTelefono(lineas.join("\n")), false);
  assert.ok(lineas.every((linea) => !linea.includes("\n")));
  // La misma asesora dos veces sale una sola vez.
  assert.equal(r.lineasParaDueno([{ userId: "u1", ...revision([]) }, { userId: "u1", ...revision([]) }]).length, 1);
});

/* ------------------------------------------------------------------------------------------------
   Parte 2: el área de envío "coach" y las herramientas del MCP, con todo lo de afuera simulado.
------------------------------------------------------------------------------------------------ */

const areas = cargar("src/features/agentes-de-area/dominio/reglas.ts");

prueba("'coach' es un área de envío pero no un agente de área (no cambia las pantallas)", () => {
  assert.deepEqual([...areas.AREAS], ["ventas", "marketing", "sistemas"]);
  assert.deepEqual([...areas.AREAS_DE_ENVIO], ["ventas", "marketing", "sistemas", "coach"]);
  assert.equal(areas.esAreaDeEnvio("coach"), true);
  assert.equal(areas.esArea("coach"), false);
  assert.equal(areas.esAreaDeEnvio("clientes"), false);
});

// La base simulada: AppSetting en un Map y las revisiones en una lista. Cada escritura queda anotada.
const WS = "ws_1";
function nuevaBase() {
  const ajustes = new Map();
  const escrituras = [];
  const revisiones = [];
  const prisma = {
    appSetting: {
      findUnique: async ({ where }) => (ajustes.has(where.key) ? { key: where.key, value: ajustes.get(where.key) } : null),
      upsert: async ({ where, create }) => {
        escrituras.push(["appSetting.upsert", where.key]);
        ajustes.set(where.key, create.value);
        return create;
      },
    },
    workspaceMember: { findFirst: async () => ({ id: "m1" }), findMany: async () => [] },
    coachRevision: {
      upsert: async ({ create }) => {
        escrituras.push(["coachRevision.upsert", create.userId]);
        const fila = { id: `rev_${create.userId}`, avisadoEn: null, creadoEn: new Date(), actualizadoEn: new Date(), ...create };
        revisiones.push(fila);
        return fila;
      },
      findMany: async ({ where }) => revisiones.filter((r) => r.workspaceId === where.workspaceId && r.fecha === where.fecha),
      updateMany: async ({ where }) => {
        escrituras.push(["coachRevision.updateMany", where.id]);
        const fila = revisiones.find((r) => r.id === where.id);
        if (fila) fila.avisadoEn = new Date();
        return { count: fila ? 1 : 0 };
      },
    },
    whatsAppChannel: { findFirst: async () => ({ purpose: "INTERNAL" }) },
    agenteDeAreaEnvio: {
      create: async ({ data }) => {
        escrituras.push(["agenteDeAreaEnvio.create", data.area, data.estado, data.numero]);
        return { id: `env_${escrituras.length}` };
      },
      update: async ({ data }) => {
        escrituras.push(["agenteDeAreaEnvio.update", data.estado]);
        return {};
      },
    },
  };
  return { prisma, ajustes, escrituras, revisiones };
}

const EQUIPO = [
  { numero: "573000000001", userId: null, soloDe: null },
  { numero: "573000000002", userId: "u_ingrid", soloDe: "u_ingrid" },
];

function cargarCoachMcp(base) {
  const envios = [];
  const alertas = [];
  cache.clear();
  simulados = new Map([
    ["@prisma/client", { Prisma: { sql: () => ({}) } }],
    ["@/lib/prisma", { prisma: base.prisma }],
    ["@/lib/mcp/supervisor", { puedeVerElSupervisor: async () => true }],
    ["@/lib/app-url", { getPublicBaseUrl: () => "https://crm.ejemplo.com" }],
    ["@/features/coach/servicios/generar-coach", { chatsDelDia: async () => [], medirChat: () => { throw new Error("no se usa"); } }],
    ["@/features/agentes-de-area/servicios/config", { leerEquipoDeAvisos: async () => EQUIPO }],
    [
      "@/features/agentes-de-area/servicios/envios",
      {
        ORIGEN_COACH: "Coach con Opus",
        mandarWhatsAppAlEquipo: async (input) => {
          envios.push(input);
          return { ok: true, estado: "ENVIADO", motivo: null, envioId: "e1" };
        },
      },
    ],
    ["@/features/alertas/servicios/alertas", { registrarAlerta: async (pedido) => (alertas.push(pedido), { id: "a1", creada: true, salioPorWhatsApp: false }) }],
    [
      "@/features/avisos-gravedad/servicios/enrutador",
      { numeroDeAvisosDeLaPersona: async (_ws, userId) => EQUIPO.find((p) => p.userId === userId)?.numero ?? null },
    ],
  ]);
  const mcp = cargar("src/lib/mcp/coach.ts");
  return { mcp, envios, alertas };
}

const CONTEXTO = { workspaceId: WS, userId: "u_dueno" };
const REVISION_OK = {
  fecha: "2026-11-03",
  userId: "u_ingrid",
  nombre: "Ingrid Pérez",
  resumen: "Respondiste rápido. Falta cerrar con una pregunta.",
  chats: [chat("c1", "bien"), chat("c2", "mejorable")],
  chatsLeidos: 12,
};

async function pruebaAsincrona(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await pruebaAsincrona("las 4 herramientas existen y las de leer son de solo lectura", async () => {
  const { mcp } = cargarCoachMcp(nuevaBase());
  const nombres = mcp.HERRAMIENTAS_MCP_COACH.map((h) => h.name);
  assert.deepEqual(nombres, ["coach_chats_del_dia", "coach_ver_chat", "coach_guardar_revision", "coach_avisar_del_dia"]);
  const porNombre = Object.fromEntries(mcp.HERRAMIENTAS_MCP_COACH.map((h) => [h.name, h]));
  assert.equal(porNombre.coach_chats_del_dia.annotations.readOnlyHint, true);
  assert.equal(porNombre.coach_ver_chat.annotations.readOnlyHint, true);
  assert.equal(porNombre.coach_guardar_revision.annotations.readOnlyHint, false);
  for (const nombre of nombres) assert.equal(mcp.esHerramientaDelCoach(nombre), true);
  const herramientas = fs.readFileSync("src/lib/mcp/herramientas.ts", "utf8");
  assert.match(herramientas, /\.\.\.HERRAMIENTAS_MCP_COACH/);
  assert.match(herramientas, /esHerramientaDelCoach\(nombre\)/);
});

await pruebaAsincrona("con el interruptor apagado, guardar responde apagado y no guarda nada", async () => {
  const base = nuevaBase();
  const { mcp } = cargarCoachMcp(base);
  const respuesta = await mcp.ejecutarHerramientaMcpCoach("coach_guardar_revision", REVISION_OK, CONTEXTO);
  assert.equal(respuesta.apagado, true);
  assert.deepEqual(base.escrituras, []);
});

await pruebaAsincrona("con el interruptor apagado, avisar responde apagado y no manda ni anota nada", async () => {
  const base = nuevaBase();
  const { mcp, envios, alertas } = cargarCoachMcp(base);
  for (const args of [{ fecha: "2026-11-03" }, { fecha: "2026-11-03", prueba: true }, { fecha: "2026-11-03", saltado: true, motivo: "uso 85 %" }]) {
    const respuesta = await mcp.ejecutarHerramientaMcpCoach("coach_avisar_del_dia", args, CONTEXTO);
    assert.equal(respuesta.apagado, true, JSON.stringify(args));
  }
  assert.deepEqual(envios, []);
  assert.deepEqual(alertas, []);
  assert.deepEqual(base.escrituras, []);
});

await pruebaAsincrona("prendido: guardar usa el modelo opus y devuelve los errores de validación", async () => {
  const base = nuevaBase();
  base.ajustes.set(`coach-opus:${WS}`, "1");
  const { mcp } = cargarCoachMcp(base);
  const mala = await mcp.ejecutarHerramientaMcpCoach(
    "coach_guardar_revision",
    { ...REVISION_OK, chats: [chat("c1", "bien"), chat("c2", "bien")] },
    CONTEXTO,
  );
  assert.equal(mala.ok, false);
  assert.ok(mala.errores.some((e) => /2 chats "bien"/.test(e)), mala.errores.join(" | "));
  assert.deepEqual(base.escrituras, []);
  const buena = await mcp.ejecutarHerramientaMcpCoach("coach_guardar_revision", { ...REVISION_OK, modelo: "otro" }, CONTEXTO);
  assert.equal(buena.ok, true);
  assert.equal(base.revisiones[0].modelo, "opus");
});

await pruebaAsincrona("prendido con prueba=true: devuelve los textos y no manda, no marca ni guarda alerta", async () => {
  const base = nuevaBase();
  base.ajustes.set(`coach-opus:${WS}`, "1");
  const { mcp, envios, alertas } = cargarCoachMcp(base);
  await mcp.ejecutarHerramientaMcpCoach("coach_guardar_revision", REVISION_OK, CONTEXTO);
  base.escrituras.length = 0;
  const respuesta = await mcp.ejecutarHerramientaMcpCoach("coach_avisar_del_dia", { fecha: "2026-11-03", prueba: true }, CONTEXTO);
  assert.equal(respuesta.prueba, true);
  assert.match(respuesta.asesoras[0].texto, /Hola Ingrid/);
  assert.ok(respuesta.asesoras[0].texto.includes("https://crm.ejemplo.com/cliente/equipo/coach/asesora/u_ingrid"));
  assert.equal(respuesta.dueno.lineas.length, 1);
  assert.deepEqual(envios, []);
  assert.deepEqual(alertas, []);
  assert.deepEqual(base.escrituras, []);
});

await pruebaAsincrona("prendido: avisa a la asesora por el área coach, la marca y el dueño va solo a Alertas", async () => {
  const base = nuevaBase();
  base.ajustes.set(`coach-opus:${WS}`, "1");
  const { mcp, envios, alertas } = cargarCoachMcp(base);
  await mcp.ejecutarHerramientaMcpCoach("coach_guardar_revision", REVISION_OK, CONTEXTO);
  const respuesta = await mcp.ejecutarHerramientaMcpCoach("coach_avisar_del_dia", { fecha: "2026-11-03" }, CONTEXTO);
  assert.equal(respuesta.ok, true);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].area, "coach");
  assert.equal(envios[0].pedido.tipo, "ASESORA");
  assert.equal(envios[0].pedido.numero, "573000000002");
  assert.ok(base.revisiones[0].avisadoEn, "no se marcó avisada");
  // El resumen del dueño: una alerta en la página, sin forma de mandar WhatsApp.
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].enviar, undefined);
  assert.equal(alertas[0].origen, "Coach con Opus");
  // Ya avisada: la segunda vuelta no manda otra vez.
  await mcp.ejecutarHerramientaMcpCoach("coach_avisar_del_dia", { fecha: "2026-11-03" }, CONTEXTO);
  assert.equal(envios.length, 1);
});

await pruebaAsincrona("día saltado: lo anota y le avisa SOLO al dueño por el área coach", async () => {
  const base = nuevaBase();
  base.ajustes.set(`coach-opus:${WS}`, "1");
  const { mcp, envios } = cargarCoachMcp(base);
  const respuesta = await mcp.ejecutarHerramientaMcpCoach(
    "coach_avisar_del_dia",
    { fecha: "2026-11-03", saltado: true, motivo: "uso semanal 85 %" },
    CONTEXTO,
  );
  assert.equal(respuesta.saltado, true);
  assert.ok(base.escrituras.some(([que, clave]) => que === "appSetting.upsert" && clave === `coach-opus-saltado:${WS}`));
  assert.equal(envios.length, 1);
  assert.equal(envios[0].area, "coach");
  assert.equal(envios[0].pedido.tipo, "ALEXANDER");
  assert.equal(envios[0].pedido.numero, "573000000001");
  assert.match(envios[0].pedido.texto, /día saltado por uso/);
});

await pruebaAsincrona("los chats más útiles para revisar van primero", async () => {
  const { mcp } = cargarCoachMcp(nuevaBase());
  const base = { ganadoHoy: false, cotizacion: false, crmStage: "NUEVO", erroresDuros: [], mensajesDelDia: 4, mensajesDeLaAsesora: 2 };
  const plano = mcp.utilidadParaRevisar(base);
  assert.ok(mcp.utilidadParaRevisar({ ...base, ganadoHoy: true }) > plano);
  assert.ok(mcp.utilidadParaRevisar({ ...base, erroresDuros: [{}] }) > plano);
  assert.ok(mcp.utilidadParaRevisar({ ...base, crmStage: "NEGOCIACION" }) > plano);
  assert.ok(mcp.utilidadParaRevisar({ ...base, mensajesDeLaAsesora: 0 }) < plano);
  assert.equal(mcp.MAXIMO_CHATS_POR_ASESORA, 25);
});

// El envío real (envios.ts) con el área "coach": su interruptor es el del Coach con Opus y siguen las protecciones.
function cargarEnvios(base, { ventasPrendido = false } = {}) {
  const mandados = [];
  const consultados = [];
  cache.clear();
  simulados = new Map([
    ["@/lib/prisma", { prisma: base.prisma }],
    ["@/lib/evolution", { sendEvolutionTextMessageWithReconnect: async (m) => mandados.push(m) }],
    ["@/features/alertas/servicios/alertas", { marcarSalioPorWhatsApp: async () => {}, registrarAlerta: async () => ({ id: "a1" }), soloUrgentesPrendido: async () => true }],
    [
      "@/features/avisos-gravedad/servicios/enrutador",
      { leerConfigGravedad: async () => ({}), lineaInterna: async () => ({ canalId: "canal_admin", instancia: "admin" }) },
    ],
    [
      "./config",
      { leerEquipoDeAvisos: async () => EQUIPO, agenteActivo: async (area) => (consultados.push(area), ventasPrendido) },
    ],
  ]);
  return { envios: cargar("src/features/agentes-de-area/servicios/envios.ts"), mandados, consultados };
}

const PEDIDO_ASESORA = { tipo: "ASESORA", numero: "573000000002", destinatario: "Ingrid", texto: "Hola Ingrid" };

await pruebaAsincrona("envío con área coach y el Coach con Opus apagado: bloqueado aunque el Agente de Ventas esté prendido", async () => {
  const base = nuevaBase();
  const { envios, mandados, consultados } = cargarEnvios(base, { ventasPrendido: true });
  const r = await envios.mandarWhatsAppAlEquipo({ workspaceId: WS, area: "coach", pedido: PEDIDO_ASESORA });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, areas.MOTIVO_INTERRUPTOR_APAGADO);
  assert.deepEqual(mandados, []);
  assert.deepEqual(consultados, [], "el área coach no debe usar el interruptor de un agente de área");
});

await pruebaAsincrona("envío con área coach prendido: sale por la línea interna y se anota con el área coach", async () => {
  const base = nuevaBase();
  base.ajustes.set(`coach-opus:${WS}`, "1");
  const { envios, mandados } = cargarEnvios(base);
  const r = await envios.mandarWhatsAppAlEquipo({ workspaceId: WS, area: "coach", pedido: PEDIDO_ASESORA });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(mandados.length, 1);
  assert.equal(mandados[0].instanceName, "admin");
  assert.ok(base.escrituras.some(([que, area, estado]) => que === "agenteDeAreaEnvio.create" && area === "coach" && estado === "PENDIENTE"));
});

await pruebaAsincrona("envío con área coach: un número que no es del equipo nunca sale, y tampoco por una línea de ventas", async () => {
  const base = nuevaBase();
  base.ajustes.set(`coach-opus:${WS}`, "1");
  const { envios, mandados } = cargarEnvios(base);
  const cliente = await envios.mandarWhatsAppAlEquipo({ workspaceId: WS, area: "coach", pedido: { ...PEDIDO_ASESORA, numero: "573119998877" } });
  assert.equal(cliente.motivo, areas.MOTIVO_NO_ES_DEL_EQUIPO);
  base.prisma.whatsAppChannel.findFirst = async () => ({ purpose: "SALES" });
  const ventas = await envios.mandarWhatsAppAlEquipo({ workspaceId: WS, area: "coach", pedido: PEDIDO_ASESORA });
  assert.equal(ventas.ok, false);
  assert.deepEqual(mandados, []);
});

console.log(`\n${pruebas} pruebas ok`);
