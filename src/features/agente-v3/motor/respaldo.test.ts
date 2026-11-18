// Pruebas del MENSAJE DE RESPALDO del Agente V3: cuando la IA no logra redactar, la clienta igual
// recibe algo (casos reales del 9 y 12-nov-2026). Correr: npm run test:agente-v3-respaldo
//
// Corre el motor REAL (ejecutar, decidir, respaldo), el redactor REAL y la parte de la IA REAL
// (sugerencia-de-respuesta) con `fetch` simulado. Solo se reemplaza lo que toca la base y el envío:
// WhatsApp es una lista en memoria. No se le escribe a nadie.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import ts from "typescript";

const nodeRequire = createRequire(path.resolve("package.json"));
const SRC = path.resolve("src");
const ruta = (relativa: string) => path.join(SRC, relativa);

// --- Cargador mínimo de TypeScript con alias "@/" y reemplazos (igual que scripts/check-agente-v3-foto.mjs)
type Modulo = { exports: Record<string, unknown> };
const cache = new Map<string, Modulo>();
function resolver(desde: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = path.join(SRC, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(desde), especificador);
  else return null;
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato;
  }
  throw new Error(`No encuentro ${especificador} desde ${desde}`);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cargar(archivo: string, reemplazos: Map<string, any>): any {
  if (reemplazos.has(archivo)) return reemplazos.get(archivo);
  const guardado = cache.get(archivo);
  if (guardado) return guardado.exports;
  const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: archivo,
  });
  const mod: Modulo = { exports: {} };
  cache.set(archivo, mod);
  const req = (especificador: string) => {
    const resuelto = resolver(archivo, especificador);
    return resuelto ? cargar(resuelto, reemplazos) : nodeRequire(especificador);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    req,
    mod,
    archivo,
    path.dirname(archivo),
  );
  return mod.exports;
}

// --- El mundo simulado ---------------------------------------------------------------------------
const COMBO = "prod-combo-diva";
const SILLAS = "prod-silla-barberia";
const FICHA = "evolution:linea-ventas:ficha-camilla-divan";
const PASOS_DE_LA_FICHA = [
  { kind: "image", url: "/ficha-camilla-divan.jpg", caption: null },
  { kind: "text", content: "Esta es la *Camilla Diván*: madera, espaldar graduable y tapizado en cuerina." },
];

type Estado = {
  productoActivo: string | null;
  pasoActual: string | null;
  flujosEnviados: string[];
  esPrimerMensaje: boolean;
  seguimientosEnviados: number[];
  avisoDePausaEnviado: boolean;
};

const mundo = {
  estado: null as Estado | null,
  // Los mensajes que la IA de la estrella lee del chat (del más nuevo al más viejo, como la base).
  mensajesDelChat: [] as Array<{ direction: string; type: string; content: string; transcripcion: null; createdAt: Date }>,
};

const prismaFalso = {
  conversation: {
    findFirst: async () => ({ activeProductContext: null, channelId: "linea-ventas", messages: mundo.mensajesDelChat }),
  },
  message: { findMany: async () => [] },
  product: { findFirst: async () => null },
};

const reemplazos = new Map<string, unknown>([
  [ruta("lib/prisma.ts"), { prisma: prismaFalso }],
  [
    ruta("lib/agent-product-flow.ts"),
    { getFlowReply: async ({ flowId }: { flowId: string }) => (flowId === FICHA ? { steps: PASOS_DE_LA_FICHA } : null) },
  ],
  [
    ruta("features/flows/services/getCreatedFlowItems.ts"),
    {
      getCreatedFlowItems: async () => [
        // El mismo nombre en OTRA línea: no se puede mandar desde este chat.
        { id: "evolution:otra-linea:ficha", sourceType: "evolution", sourceId: "otra-linea", title: "Ficha Camilla Divan", isChildFlow: false },
        { id: FICHA, sourceType: "evolution", sourceId: "linea-ventas", title: "Ficha  Camilla Diván", isChildFlow: false },
      ],
    },
  ],
  [ruta("lib/flujos-para-sugerir.ts"), { flujosParaSugerir: async () => [], mismaDireccion: (a: string, b: string) => a === b }],
  [
    ruta("features/agente-v3/servicios/almacen.ts"),
    { leerLibro: async () => libro },
  ],
  [
    ruta("features/agente-v3/servicios/catalogo.ts"),
    {
      catalogoActivo: async () => [
        { id: COMBO, nombre: "COMBO DIVA", codigo: "CMB01", categoria: "Combos de camillas", precio: 989_000, precioMayorista: 0, cantidadMinimaMayorista: 0, descripcion: null, foto: null },
        { id: SILLAS, nombre: "Silla barbería", codigo: "SIL01", categoria: "Sillas", precio: 650_000, precioMayorista: 0, cantidadMinimaMayorista: 0, descripcion: null, foto: null },
      ],
      nombreLegible: (nombre: string) => nombre,
      productosInactivos: async () => new Set(),
      reconocerEnElCatalogo: () => null,
      textoDeUnProducto: () => "",
      textoDeVariasOpciones: () => "",
    },
  ],
  [ruta("features/agente-v3/servicios/decisiones.ts"), { anotarDecision: async () => {} }],
  [ruta("features/agente-v3/motor/clasificar.ts"), { clasificarIntenciones: async () => [] }],
  [
    ruta("features/agente-v3/motor/estado.ts"),
    {
      leerEstado: async () => mundo.estado,
      guardarEstado: async (_id: string, estado: Estado) => {
        mundo.estado = estado;
      },
    },
  ],
]);

const { atenderConAgenteV3 } = cargar(ruta("features/agente-v3/motor/ejecutar.ts"), reemplazos);
const { responderConElRedactor } = cargar(ruta("features/agente-v3/servicios/redactor.ts"), reemplazos);
const { TEXTO_DE_RESPALDO, buscarFlujoDeLaLinea } = cargar(ruta("features/agente-v3/motor/respaldo.ts"), reemplazos);
const { generarSugerenciaDeRespuesta } = cargar(ruta("lib/sugerencia-de-respuesta.ts"), reemplazos);

// El libro reducido: la red de PRESENTACION contesta con IA; en los demás pasos no hay red.
const libro = {
  version: 7,
  actualizadoEl: "2026-11-12T00:00:00.000Z",
  comoHablamos: "Forma de pago: anticipo del 50% y el resto antes del despacho.",
  reglas: [
    {
      id: "red-presentacion",
      nombre: "Red del paso PRESENTACION: que conteste la IA",
      activa: true,
      cuando: { tipo: "siempre" },
      soloSi: { pasoActual: "PRESENTACION" },
      entonces: [{ tipo: "responder_con_ia", guia: "Preséntale el combo y pregúntale qué servicio ofrece." }],
    },
    {
      id: "precio",
      nombre: "Pregunta el precio",
      activa: true,
      cuando: { tipo: "frase", frases: ["cuanto vale"] },
      entonces: [{ tipo: "mensaje", texto: "El combo vale *$989.000*. ¿En qué *ciudad* estás?" }],
    },
  ],
};

// --- La IA simulada --------------------------------------------------------------------------------
const fetchOriginal = globalThis.fetch;
const claveOriginal = process.env.OPENAI_API_KEY;
type IaFalsa = "tiempo" | "conexion" | { status: number } | { contenido: unknown };
function iaQueResponde(...respuestas: IaFalsa[]) {
  let turno = 0;
  globalThis.fetch = (async () => {
    const respuesta = respuestas[Math.min(turno, respuestas.length - 1)];
    turno += 1;
    if (respuesta === "tiempo") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (respuesta === "conexion") throw new TypeError("fetch failed");
    if ("status" in respuesta) return new Response("{}", { status: respuesta.status });
    const contenido = typeof respuesta.contenido === "string" ? respuesta.contenido : JSON.stringify(respuesta.contenido);
    return new Response(JSON.stringify({ choices: [{ message: { content: contenido } }] }), { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "falsa";
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (claveOriginal === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = claveOriginal;
});

// --- WhatsApp simulado: las herramientas que usan el webhook y el retomar --------------------------
function chatSimulado(opciones: { yaSalio?: string[] } = {}) {
  const registro = { enviados: [] as string[], avisos: [] as string[], pausas: 0 };
  const yaSalio = new Set(opciones.yaSalio ?? []);
  const enviarTexto = async (texto: string) => {
    registro.enviados.push(texto);
    yaSalio.add(texto);
    return true;
  };
  const avisarAsesor = async (motivo: string) => {
    registro.avisos.push(motivo);
  };
  const pausarIa = async () => {
    registro.pausas += 1;
  };
  const yaLoDijimos = async (texto: string) => yaSalio.has(texto.trim());
  const delRedactor = (guia?: string, foto?: string | null) =>
    responderConElRedactor({ workspaceId: "ws", conversationId: "cv", guia, foto, enviarTexto, avisarAsesor, yaLoDijimos, pausarIa });
  return {
    registro,
    herramientas: {
      enviarPaso: async (paso: { kind: string; content?: string; url?: string }) =>
        paso.kind === "text" ? enviarTexto(paso.content ?? "") : (registro.enviados.push(`[${paso.kind}] ${paso.url}`), true),
      avisarAsesor,
      cambiarEtapa: async () => {},
      pausarIa,
      responderConIa: (guia: string) => delRedactor(guia),
      responderSinRegla: ({ foto }: { foto: string | null }) => delRedactor(undefined, foto),
      buscarFlujo: (titulo: string) => buscarFlujoDeLaLinea({ workspaceId: "ws", channelId: "linea-ventas", titulo }),
      yaLoDijimos,
    },
  };
}

function estadoEn(paso: string | null, producto: string | null, flujosEnviados: string[] = []): Estado {
  return { productoActivo: producto, pasoActual: paso, flujosEnviados, esPrimerMensaje: false, seguimientosEnviados: [], avisoDePausaEnviado: false };
}

async function atender(mensaje: string, estado: Estado, opciones: { yaSalio?: string[] } = {}) {
  mundo.estado = estado;
  mundo.mensajesDelChat = [
    { direction: "INBOUND", type: "TEXT", content: mensaje, transcripcion: null, createdAt: new Date() },
    { direction: "OUTBOUND", type: "TEXT", content: "¡Hola! Bienvenida a Magilus.", transcripcion: null, createdAt: new Date(Date.now() - 60_000) },
  ];
  const chat = chatSimulado(opciones);
  const resultado = await atenderConAgenteV3({ workspaceId: "ws", conversationId: "cv", mensaje, herramientas: chat.herramientas });
  return { resultado, ...chat.registro, estado: mundo.estado as Estado };
}

const fichaSalio = (enviados: string[]) =>
  PASOS_DE_LA_FICHA.every((paso) => enviados.some((enviado) => (paso.kind === "text" ? enviado === paso.content : enviado.includes(paso.url!))));

// --- Los 5 chats ---------------------------------------------------------------------------------
test("1) 573001893576 «Soy lashita camilla etc» en PRESENTACION, la IA no contesta a tiempo: sale la Ficha y pasa a PRODUCTO", async () => {
  iaQueResponde("tiempo");
  const { resultado, enviados, avisos, estado } = await atender("Soy lashita camilla etc", estadoEn("PRESENTACION", COMBO));
  assert.equal(resultado.atendido, true);
  assert.ok(fichaSalio(enviados), `salió la ficha: ${JSON.stringify(enviados)}`);
  assert.ok(!enviados.includes(TEXTO_DE_RESPALDO), "no va además el texto");
  assert.equal(estado.pasoActual, "PRODUCTO");
  assert.ok(estado.flujosEnviados.includes(FICHA), "la ficha queda anotada para no repetirla");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /^El agente no pudo/);
  assert.match(avisos[0], /tiempo de espera/);
  assert.match(avisos[0], /se le mandó un mensaje de respaldo/);
  assert.match(resultado.porque, /tiempo de espera/);
});

test("2) «Las 3» en PRODUCTO, la IA responde vacío: sale el texto de respaldo", async () => {
  iaQueResponde({ contenido: "" });
  const { resultado, enviados, avisos, pausas, estado } = await atender("Las 3", estadoEn("PRODUCTO", COMBO));
  assert.equal(resultado.atendido, true);
  assert.deepEqual(enviados, [TEXTO_DE_RESPALDO]);
  assert.equal(estado.pasoActual, "PRODUCTO");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /^El agente no pudo/);
  assert.match(avisos[0], /respuesta vacía/);
  assert.equal(pausas, 0);
});

test("3) el texto de respaldo ya salió hoy (y la ficha también): no se repite, solo el aviso", async () => {
  iaQueResponde({ status: 429 });
  const { resultado, enviados, avisos } = await atender("ok", estadoEn("PRODUCTO", COMBO, [FICHA]), { yaSalio: [TEXTO_DE_RESPALDO] });
  assert.equal(resultado.atendido, true);
  assert.deepEqual(enviados, [], "no sale nada repetido");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /^El agente no pudo/);
  assert.match(avisos[0], /la IA respondió 429/);
  assert.match(avisos[0], /: que conteste una persona$/);
});

test("4) en PRESENTACION con la Ficha ya enviada: sale el texto, no la Ficha otra vez", async () => {
  iaQueResponde("conexion");
  const { enviados, avisos, estado } = await atender("hola, info", estadoEn("PRESENTACION", COMBO, [FICHA]));
  assert.deepEqual(enviados, [TEXTO_DE_RESPALDO]);
  assert.equal(estado.pasoActual, "PRESENTACION", "sin ficha no cambia de paso");
  assert.match(avisos[0], /fallo de conexión/);
});

test("5) en CIERRE la IA inventa un precio (filtro): sale el texto, llega el aviso y la IA se pausa", async () => {
  const inventado = { texto: "El envío te sale en *$123.456*, ¿te lo separo?", falta_dato: false };
  iaQueResponde({ contenido: inventado }, { contenido: inventado }, { contenido: inventado });
  const { resultado, enviados, avisos, pausas } = await atender("y el envio?", estadoEn("CIERRE", COMBO));
  assert.equal(resultado.atendido, true);
  assert.deepEqual(enviados, [TEXTO_DE_RESPALDO]);
  assert.ok(!enviados.some((texto) => texto.includes("123.456")), "el precio inventado no sale");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /^El agente no pudo/);
  assert.match(avisos[0], /rompía una regla/);
  assert.equal(pausas, 1);
});

// --- Casos de control ------------------------------------------------------------------------------
test("control: la IA responde bien y no sale respaldo ni aviso", async () => {
  const bueno = "El combo es ideal para pestañas. ¿En qué *ciudad* estás?";
  iaQueResponde({ contenido: { texto: bueno, falta_dato: false } });
  const { enviados, avisos, estado } = await atender("Soy lashita camilla etc", estadoEn("PRESENTACION", COMBO));
  assert.deepEqual(enviados, [bueno]);
  assert.deepEqual(avisos, []);
  assert.equal(estado.pasoActual, "PRESENTACION");
});

test("PRESENTACION de sillas: no se le manda la ficha de una camilla, va el texto", async () => {
  iaQueResponde("tiempo");
  const { enviados, estado } = await atender("hola", estadoEn("PRESENTACION", SILLAS));
  assert.deepEqual(enviados, [TEXTO_DE_RESPALDO]);
  assert.equal(estado.pasoActual, "PRESENTACION");
});

test("una regla ya le mandó algo en el turno: si la IA falla no se suma el respaldo, solo el aviso", async () => {
  // Fuera del libro de arriba: una regla con [mensaje + responder_con_ia].
  const reglaDoble = {
    id: "doble",
    nombre: "Pregunta por envío",
    activa: true,
    cuando: { tipo: "frase", frases: ["envio a"] },
    entonces: [
      { tipo: "mensaje", texto: "¡Sí enviamos a todo el país!" },
      { tipo: "responder_con_ia", guia: "Pregunta la ciudad." },
    ],
  };
  libro.reglas.push(reglaDoble as (typeof libro.reglas)[number]);
  try {
    iaQueResponde("tiempo");
    const { enviados, avisos } = await atender("hacen envio a cali", estadoEn("PRODUCTO", COMBO));
    assert.deepEqual(enviados, ["¡Sí enviamos a todo el país!"]);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /tiempo de espera/);
  } finally {
    libro.reglas.pop();
  }
});

test("la Ficha se busca solo en la línea del chat", async () => {
  assert.equal(await buscarFlujoDeLaLinea({ workspaceId: "ws", channelId: "linea-ventas", titulo: "Ficha Camilla Divan" }), FICHA);
  assert.equal(await buscarFlujoDeLaLinea({ workspaceId: "ws", channelId: "linea-sin-ficha", titulo: "Ficha Camilla Divan" }), null);
});

// --- La causa llega, y la estrella sigue mostrando el mismo error -----------------------------------
test("la causa es distinta para tiempo de espera, código de error y respuesta vacía; el error de la estrella no cambia", async () => {
  mundo.mensajesDelChat = [{ direction: "INBOUND", type: "TEXT", content: "hola", transcripcion: null, createdAt: new Date() }];
  const casos: Array<[IaFalsa, string]> = [
    ["tiempo", "tiempo de espera"],
    [{ status: 429 }, "la IA respondió 429"],
    [{ status: 500 }, "la IA respondió 500"],
    [{ contenido: "" }, "respuesta vacía"],
    [{ contenido: { texto: "  ", falta_dato: false } }, "respuesta vacía"],
    ["conexion", "fallo de conexión"],
  ];
  for (const [ia, causa] of casos) {
    iaQueResponde(ia);
    const resultado = await generarSugerenciaDeRespuesta({ workspaceId: "ws", fuente: "agent", conversationId: "cv" });
    assert.equal(resultado.error, "No se pudo generar la sugerencia. Inténtalo de nuevo.", "lo que ve la asesora en la estrella");
    assert.equal(resultado.causa, causa);
  }
});
