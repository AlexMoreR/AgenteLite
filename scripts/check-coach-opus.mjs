// Pruebas de las reglas del Coach con Opus (parte 1, 3-nov-2026): src/features/coach/revision-opus/reglas.ts.
// Qué se rechaza al guardar la revisión y cómo salen los avisos a la asesora y al dueño.
// Parte 2: las herramientas del MCP (src/lib/mcp/coach.ts) y el área de envío "coach", con la base y los envíos
// simulados: con el interruptor apagado, guardar y avisar responden "apagado" y no guardan ni mandan nada.
// Sin base ni red. Correr: npm run test:coach-opus
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);
const SRC = path.resolve("src");

/**
 * Un cargador de TypeScript con su propio caché. `simulados` reemplaza módulos por su alias ("@/lib/prisma")
 * o por su ruta desde src ("features/agentes-de-area/servicios/config"): así se prueba sin base ni red.
 */
function crearCargador(simulados = {}) {
  const cache = new Map();
  const simuladoDe = (absoluto) => {
    const relativo = path.relative(SRC, absoluto).replace(/\\/g, "/").replace(/\.tsx?$/, "");
    return simulados[`@/${relativo}`];
  };
  function cargar(archivo) {
    const absoluto = path.resolve(archivo);
    const simulado = simuladoDe(absoluto);
    if (simulado) return simulado;
    if (cache.has(absoluto)) return cache.get(absoluto).exports;
    const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: absoluto,
    });
    const mod = { exports: {} };
    cache.set(absoluto, mod);
    const resolver = (base) => {
      const simuladoDeBase = simuladoDe(base);
      if (simuladoDeBase) return simuladoDeBase;
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
      throw new Error(`No encontré ${base}`);
    };
    const requerir = (pedido) => {
      if (simulados[pedido]) return simulados[pedido];
      if (pedido.startsWith("@/")) return resolver(path.join(SRC, pedido.slice(2)));
      if (pedido.startsWith(".")) return resolver(path.resolve(path.dirname(absoluto), pedido));
      return requireNativo(pedido);
    };
    new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(mod.exports, requerir, mod, absoluto, path.dirname(absoluto));
    return mod.exports;
  }
  return cargar;
}

const cargar = crearCargador();
const r = cargar("src/features/coach/revision-opus/reglas.ts");

let pruebas = 0;
const pendientes = [];
function prueba(nombre, fn) {
  // Las pruebas async se esperan al final, en orden.
  pendientes.push(async () => {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  });
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
   Parte 2: las herramientas del MCP y el área de envío "coach" (base y envíos simulados)
------------------------------------------------------------------------------------------------ */

const WS = "ws_1";
const CONTEXTO = { workspaceId: WS, userId: "dueno" };

/** Una base en memoria: solo lo que tocan estas pruebas, y anota cada escritura. */
function crearBase({ prendido = false, revisiones = [], equipo = [] } = {}) {
  const ajustes = new Map();
  if (prendido) ajustes.set(`coach-opus:${WS}`, "1");
  ajustes.set(`agente-v3:avisos:${WS}`, JSON.stringify({ destinos: equipo }));
  const escrituras = [];
  const filas = revisiones.map((revision, i) => ({ id: `rev${i}`, workspaceId: WS, fecha: "2026-11-02", avisadoEn: null, chatsLeidos: 10, modelo: "opus", creadoEn: new Date(), actualizadoEn: new Date(), ...revision }));
  return {
    escrituras,
    filas,
    prisma: {
      appSetting: {
        findUnique: async ({ where }) => (ajustes.has(where.key) ? { key: where.key, value: ajustes.get(where.key) } : null),
        upsert: async ({ where, create }) => {
          escrituras.push(["appSetting.upsert", where.key]);
          ajustes.set(where.key, create.value);
          return create;
        },
      },
      coachRevision: {
        upsert: async (pedido) => {
          escrituras.push(["coachRevision.upsert", pedido.create.modelo]);
          return { id: "nueva", ...pedido.create, chats: pedido.create.chats, avisadoEn: null, creadoEn: new Date(), actualizadoEn: new Date() };
        },
        findMany: async ({ where }) => filas.filter((fila) => fila.workspaceId === where.workspaceId && fila.fecha === where.fecha),
        updateMany: async ({ where }) => {
          escrituras.push(["coachRevision.updateMany", where.id]);
          const fila = filas.find((f) => f.id === where.id);
          if (fila) fila.avisadoEn = new Date();
          return { count: fila ? 1 : 0 };
        },
      },
      workspaceMember: {
        findFirst: async () => ({ id: "m1" }),
        findMany: async () => [
          { userId: "dueno", role: "OWNER", user: { name: "Alexander" } },
          { userId: "u1", role: "AGENT", user: { name: "Ingrid Pérez" } },
          { userId: "u2", role: "AGENT", user: { name: "Génesis" } },
        ],
      },
      workspace: { findUnique: async () => ({ ownerId: "dueno" }) },
      whatsAppChannel: { findFirst: async () => ({ purpose: "ADMIN" }) },
      agenteDeAreaEnvio: {
        create: async ({ data }) => {
          escrituras.push(["agenteDeAreaEnvio.create", data.area, data.estado, data.numero]);
          return { id: `envio${escrituras.length}` };
        },
        update: async ({ data }) => {
          escrituras.push(["agenteDeAreaEnvio.update", data.estado]);
          return {};
        },
      },
    },
  };
}

/** Carga coach.ts con la base simulada y el envío real (envios.ts) con WhatsApp y alertas simulados. */
function cargarCoach(base) {
  const mandados = [];
  const alertas = [];
  const simulados = {
    "@/lib/prisma": { prisma: base.prisma },
    "@/lib/mcp/supervisor": { puedeVerElSupervisor: async () => true },
    "@/features/coach/servicios/generar-coach": {
      chatsDelDia: async () => {
        throw new Error("no se esperaba leer chats");
      },
      medirChat: () => {
        throw new Error("no se esperaba medir chats");
      },
    },
    "@/features/alertas/servicios/alertas": {
      registrarAlerta: async (pedido) => {
        alertas.push(pedido);
        return { id: `alerta${alertas.length}`, creada: true, salioPorWhatsApp: false };
      },
      marcarSalioPorWhatsApp: async () => {},
      soloUrgentesPrendido: async () => true,
    },
    "@/features/avisos-gravedad/servicios/enrutador": {
      leerConfigGravedad: async () => ({}),
      lineaInterna: async () => ({ canalId: "admin", instancia: "admin-inst" }),
    },
    "@/lib/evolution": {
      sendEvolutionTextMessageWithReconnect: async (envio) => {
        mandados.push(envio);
      },
    },
    "@/lib/app-url": { getPublicBaseUrl: () => "https://crm.ejemplo.com" },
  };
  const cargarConSimulados = crearCargador(simulados);
  return {
    mcp: cargarConSimulados("src/lib/mcp/coach.ts"),
    envios: cargarConSimulados("src/features/agentes-de-area/servicios/envios.ts"),
    mandados,
    alertas,
  };
}

const EQUIPO = [
  { numero: "573001110001", userId: "u1" },
  { numero: "573001110002", userId: "u2" },
  { numero: "573001110009", userId: "dueno" },
];
const REVISIONES = [
  { userId: "u1", nombre: "Ingrid Pérez", resumen: "Buen día: respondiste rápido.", chats: [chat("c1", "bien"), chat("c2", "mejorable")] },
  { userId: "u2", nombre: "Génesis", resumen: "Falta cerrar con una pregunta.", chats: [chat("c3", "mejorable", "bot")] },
];

prueba("'coach' es un área de envío aparte: no cambia AREAS (las pantallas de los agentes)", () => {
  const reglasDeArea = cargar("src/features/agentes-de-area/dominio/reglas.ts");
  assert.deepEqual([...reglasDeArea.AREAS], ["ventas", "marketing", "sistemas"]);
  assert.deepEqual([...reglasDeArea.AREAS_DE_ENVIO], ["ventas", "marketing", "sistemas", "coach"]);
  assert.equal(reglasDeArea.esAreaDeEnvio("coach"), true);
  assert.equal(reglasDeArea.esArea("coach"), false);
  assert.equal(reglasDeArea.esAreaDeEnvio("clientes"), false);
});

prueba("las 4 herramientas coach_* están registradas en el MCP con su tipo", () => {
  const { mcp } = cargarCoach(crearBase());
  assert.deepEqual(
    mcp.HERRAMIENTAS_MCP_COACH.map((h) => [h.name, h.annotations.readOnlyHint]),
    [
      ["coach_chats_del_dia", true],
      ["coach_ver_chat", true],
      ["coach_guardar_revision", false],
      ["coach_avisar_del_dia", false],
    ],
  );
  const registro = fs.readFileSync("src/lib/mcp/herramientas.ts", "utf8");
  assert.match(registro, /\.\.\.HERRAMIENTAS_MCP_COACH,/);
  assert.match(registro, /esHerramientaDelCoach\(nombre\)/);
});

prueba("interruptor apagado: guardar responde 'apagado' y no guarda nada", async () => {
  const base = crearBase({ prendido: false });
  const { mcp } = cargarCoach(base);
  const respuesta = await mcp.ejecutarHerramientaMcpCoach(
    "coach_guardar_revision",
    { fecha: "2026-11-02", userId: "u1", ...revision([chat("c1", "bien")]) },
    CONTEXTO,
  );
  assert.equal(respuesta.estado, "apagado");
  assert.equal(respuesta.guardado, false);
  assert.deepEqual(base.escrituras, []);
});

prueba("interruptor apagado: avisar responde 'apagado' y no manda ni guarda nada (tampoco el día saltado)", async () => {
  const base = crearBase({ prendido: false, revisiones: REVISIONES, equipo: EQUIPO });
  const { mcp, mandados, alertas } = cargarCoach(base);
  for (const args of [{ fecha: "2026-11-02" }, { fecha: "2026-11-02", saltado: true, motivo: "uso semanal 85 %" }]) {
    const respuesta = await mcp.ejecutarHerramientaMcpCoach("coach_avisar_del_dia", args, CONTEXTO);
    assert.equal(respuesta.estado, "apagado");
  }
  assert.deepEqual(base.escrituras, []);
  assert.deepEqual(mandados, []);
  assert.deepEqual(alertas, []);
  assert.ok(base.filas.every((fila) => fila.avisadoEn === null));
});

prueba("prendido: guardar con errores los devuelve y no guarda; bien armada se guarda con el modelo 'opus'", async () => {
  const base = crearBase({ prendido: true });
  const { mcp } = cargarCoach(base);
  const mala = await mcp.ejecutarHerramientaMcpCoach(
    "coach_guardar_revision",
    { fecha: "2026-11-02", userId: "u1", ...revision([chat("c1", "bien"), chat("c2", "bien")]) },
    CONTEXTO,
  );
  assert.equal(mala.guardado, false);
  assert.ok(mala.errores.some((e) => /2 chats "bien"/.test(e)), JSON.stringify(mala));
  assert.deepEqual(base.escrituras, []);
  const buena = await mcp.ejecutarHerramientaMcpCoach(
    "coach_guardar_revision",
    { fecha: "2026-11-02", userId: "u1", ...revision([chat("c1", "bien")], { modelo: "otro" }) },
    CONTEXTO,
  );
  assert.equal(buena.guardado, true);
  assert.equal(base.escrituras.length, 1);
  assert.deepEqual(base.escrituras[0], ["coachRevision.upsert", "opus"]);
});

prueba("prendido con prueba=true: devuelve los textos y no manda ni marca nada", async () => {
  const base = crearBase({ prendido: true, revisiones: REVISIONES, equipo: EQUIPO });
  const { mcp, mandados, alertas } = cargarCoach(base);
  const respuesta = await mcp.ejecutarHerramientaMcpCoach("coach_avisar_del_dia", { fecha: "2026-11-02", prueba: true }, CONTEXTO);
  assert.equal(respuesta.estado, "prueba");
  assert.equal(respuesta.asesoras.length, 2);
  assert.match(respuesta.asesoras[0].texto, /cliente\/equipo\/coach\/asesora\/u1/);
  assert.equal(respuesta.alerta_dueno.length, 2);
  assert.deepEqual(base.escrituras, []);
  assert.deepEqual(mandados, []);
  assert.deepEqual(alertas, []);
});

prueba("prendido: avisa a cada asesora por la línea Admin con el área 'coach', la marca y deja lo del dueño SOLO en Alertas", async () => {
  const base = crearBase({ prendido: true, revisiones: REVISIONES, equipo: EQUIPO });
  const { mcp, mandados, alertas } = cargarCoach(base);
  const respuesta = await mcp.ejecutarHerramientaMcpCoach("coach_avisar_del_dia", { fecha: "2026-11-02" }, CONTEXTO);
  assert.equal(respuesta.se_mando, 2);
  assert.deepEqual(mandados.map((m) => m.phoneNumber).sort(), ["573001110001", "573001110002"]);
  assert.ok(mandados.every((m) => m.instanceName === "admin-inst"));
  assert.ok(!mandados.some((m) => m.phoneNumber === "573001110009"), "al dueño no le sale WhatsApp con el resumen");
  // El texto lo arma el CRM: el de Génesis no nombra el chat del bot.
  assert.doesNotMatch(mandados.find((m) => m.phoneNumber === "573001110002").text, /para mejorar/);
  assert.ok(base.escrituras.filter((e) => e[0] === "agenteDeAreaEnvio.create").every((e) => e[1] === "coach"));
  assert.ok(base.filas.every((fila) => fila.avisadoEn instanceof Date));
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].prioridad, "MEDIA");
  assert.equal(alertas[0].enviar, undefined);
  // Ya avisadas: otra vuelta no manda nada de nuevo.
  const otra = await mcp.ejecutarHerramientaMcpCoach("coach_avisar_del_dia", { fecha: "2026-11-02" }, CONTEXTO);
  assert.equal(otra.se_mando, 0);
  assert.equal(mandados.length, 2);
});

prueba("día saltado: se anota y el dueño recibe el único WhatsApp (corto, urgente)", async () => {
  const base = crearBase({ prendido: true, equipo: EQUIPO });
  const { mcp, mandados, alertas } = cargarCoach(base);
  const respuesta = await mcp.ejecutarHerramientaMcpCoach(
    "coach_avisar_del_dia",
    { fecha: "2026-11-02", saltado: true, motivo: "uso semanal 85 %" },
    CONTEXTO,
  );
  assert.equal(respuesta.estado, "saltado");
  assert.equal(respuesta.se_mando, 1);
  assert.ok(base.escrituras.some((e) => e[0] === "appSetting.upsert" && e[1] === `coach-opus-saltado:${WS}`));
  assert.deepEqual(mandados.map((m) => m.phoneNumber), ["573001110009"]);
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].prioridad, "URGENTE");
  assert.match(alertas[0].titulo, /saltado por uso/);
});

prueba("el envío con el área 'coach' usa el interruptor del Coach y nunca le escribe a alguien fuera del equipo", async () => {
  const pedido = (numero) => ({ tipo: "ASESORA", numero, texto: "hola", destinatario: null });
  const apagado = crearBase({ prendido: false, equipo: EQUIPO });
  const conApagado = cargarCoach(apagado);
  const r1 = await conApagado.envios.mandarWhatsAppAlEquipo({ workspaceId: WS, area: "coach", pedido: pedido("573001110001") });
  assert.equal(r1.ok, false);
  assert.match(r1.motivo, /interruptor apagado/);
  assert.deepEqual(conApagado.mandados, []);

  const prendido = crearBase({ prendido: true, equipo: EQUIPO });
  const conPrendido = cargarCoach(prendido);
  const r2 = await conPrendido.envios.mandarWhatsAppAlEquipo({ workspaceId: WS, area: "coach", pedido: pedido("573009999999") });
  assert.equal(r2.ok, false);
  assert.match(r2.motivo, /no es del equipo/);
  const r3 = await conPrendido.envios.mandarWhatsAppAlEquipo({ workspaceId: WS, area: "coach", pedido: pedido("573001110001") });
  assert.equal(r3.ok, true);
  assert.deepEqual(conPrendido.mandados.map((m) => m.phoneNumber), ["573001110001"]);
});

prueba("chats del día: primero los más útiles, los quietos al final y máximo 25 por asesora", () => {
  const { mcp } = cargarCoach(crearBase());
  const desde = new Date("2026-11-02T05:00:00Z");
  const hoy = new Date("2026-11-02T15:00:00Z");
  const medido = (id, extra = {}) => ({
    id,
    quieto: false,
    cotizacion: false,
    ganadoHoy: false,
    atribucionSegura: true,
    erroresDuros: [],
    mensajes: [{ en: hoy, autor: "cliente" }],
    ...extra,
  });
  const chats = [
    medido("quieto", { quieto: true, erroresDuros: [{}, {}] }),
    medido("simple"),
    medido("con-error", { erroresDuros: [{}] }),
    medido("cotizado", { cotizacion: true }),
    ...Array.from({ length: 30 }, (_, i) => medido(`relleno${String(i).padStart(2, "0")}`)),
  ];
  const orden = mcp.ordenarParaRevisar(chats, desde);
  assert.equal(orden.length, 25);
  assert.deepEqual(orden.slice(0, 2).map((c) => c.id), ["con-error", "cotizado"]);
  assert.ok(!orden.some((c) => c.id === "quieto"));
  assert.equal(mcp.ordenarParaRevisar([medido("a"), medido("quieto", { quieto: true })], desde).at(-1).id, "quieto");
});

prueba("cambiarCoachOpus: solo el dueño o un administrador, valida el valor y no toca el Coach nocturno", () => {
  const fuente = fs.readFileSync("src/app/actions/coach-actions.ts", "utf8");
  assert.match(fuente, /^"use server";/);
  const inicio = fuente.indexOf("export async function cambiarCoachOpus(");
  assert.ok(inicio >= 0, "falta la acción cambiarCoachOpus");
  const fin = fuente.indexOf("\n}\n", inicio);
  const cuerpo = fuente.slice(inicio, fin);
  // La misma protección que la acción del interruptor nocturno.
  assert.match(fuente, /guardarCoachNocturnoAction[\s\S]*?requireClientWorkspaceAccess\("crm", \{ ownerOnly: true \}\)/);
  const permiso = cuerpo.indexOf('requireClientWorkspaceAccess("crm", { ownerOnly: true })');
  const guardar = cuerpo.indexOf("guardarCoachOpusActivo(access.workspaceId, activo)");
  assert.ok(permiso >= 0, "cambiarCoachOpus tiene que pedir ownerOnly");
  assert.ok(guardar > permiso, "primero el permiso, después guardar");
  assert.ok(cuerpo.indexOf('typeof activo !== "boolean"') > permiso && cuerpo.indexOf('typeof activo !== "boolean"') < guardar);
  assert.match(cuerpo, /revalidatePath\("\/cliente\/equipo\/coach\/informe"\)/);
  assert.doesNotMatch(cuerpo, /guardarCoachNocturno\(/);

  // ownerOnly deja pasar solo al dueño o a un administrador.
  const acceso = fs.readFileSync("src/lib/client-workspace-access.ts", "utf8");
  assert.match(acceso, /options\.ownerOnly && !access\.isOwner && access\.role !== "ADMIN"/);
});

prueba("la tarjeta de la asesora tapa teléfonos, avisa 'no depende de ti' y la página la pone con su control", () => {
  const tarjeta = fs.readFileSync("src/features/coach/components/RevisionOpusCard.tsx", "utf8");
  assert.match(tarjeta, /taparTelefonos/);
  assert.match(tarjeta, /chat\.causa === "bot" \|\| chat\.causa === "politica"/);
  assert.match(tarjeta, /No depende de ti/);
  assert.match(tarjeta, /Copiar mensaje modelo|CopiarMensajeModelo/);
  const pagina = fs.readFileSync("src/app/cliente/equipo/coach/asesora/[userId]/page.tsx", "utf8");
  assert.match(pagina, /if \(!supervisa && userId !== access\.userId\) redirect/);
  assert.match(pagina, /leerRevision\(access\.workspaceId, userId\)/);
  assert.match(pagina, /<RevisionOpusCard /);
});

for (const correr of pendientes) {
  try {
    await correr();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
console.log(`\n${pruebas} pruebas ok`);
