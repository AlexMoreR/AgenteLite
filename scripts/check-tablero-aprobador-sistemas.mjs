// Pruebas del aprobador de Sistemas (Emanuel, periodo de prueba hasta el 29-nov-2026): aprueba tarea, plan y subida de
// tarjetas de Tecnología, no lo que toca dinero o Meta Ads, vence solo; las alertas técnicas van a Sistemas y las de dinero
// a Alexander (con respaldo); el resumen diario tiene máximo 4 líneas y sin links. Con un prisma falso: no necesita base ni red.
// Correr: npm run test:tablero-aprobador-sistemas
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const ajustes = new Map();
const enviados = [];
const falso = {
  appSetting: {
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { value: ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => void ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value),
  },
  user: { findUnique: async () => ({ phone: null }) },
  historialTarjeta: { findMany: async () => [] },
  whatsAppChannel: {
    findFirst: async () => ({ name: "Admin", evolutionInstanceName: "admin-inst" }),
    findMany: async () => [{ name: "Admin", phoneNumber: "573009990000" }],
  },
  workspaceMember: { findMany: async () => [] },
};
const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async (datos) => void enviados.push(datos) },
  "./coordinador-en-vivo": { ultimoLatido: async () => null },
  "./tableros": {
    pendientesDelDueno: async () => [],
    todoElNegocio: (workspaceId) => ({ workspaceId, soloDe: null }),
    linkDeHoy: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=hoy",
    linkDelCoordinador: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=coordinador",
    linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}`,
  },
  "@/features/alertas/servicios/alertas": {
    leerResponsableDeSistemas: async () => null,
    marcarSalioPorWhatsApp: async () => {},
    registrarAlerta: async () => ({}),
    soloUrgentesPrendido: async () => false,
  },
};

const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const resumen = cargar("src/features/tableros-inteligentes/services/resumen-diario.ts", mocks);
const avisos = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const ANTES = new Date("2026-11-10T15:00:00Z");
const DESPUES = new Date("2026-11-30T05:00:01Z");
const sistemas = (vigente = true) => ({ esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "SISTEMAS", puedeSubir: true }, sistemasVigente: vigente });
const desarrollo = { esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "DESARROLLO", puedeSubir: true } };
const asesora = { esDueno: false, esAdminPlataforma: false, aprobador: null };
const dueno = { esDueno: true, esAdminPlataforma: false, aprobador: null };
const puede = (persona, momento, texto = "Arreglar el filtro de inventario", repo = "gestion", zonas = []) =>
  trabajo.personaPuedeAprobarMomento(persona, momento, "pantalla", repo, zonas, texto);

await prueba("SISTEMAS vigente aprueba la tarea, el plan y la subida de una tarjeta de Tecnología", () => {
  for (const momento of ["tarea", "plan", "subir"]) {
    assert.equal(puede(sistemas(), momento), null, momento);
    assert.equal(puede(sistemas(), momento, "Cambiar el orden de la lista", "aizencrm"), null, momento);
  }
});

await prueba("SISTEMAS no aprueba lo que toca dinero o Meta Ads (en español, con tildes o sin ellas)", () => {
  const casos = [
    "Calcular las comisiones del mes",
    "Registrar abonos y saldos de clientes",
    "Corregir la nómina de noviembre",
    "Subir el presupuesto de la campaña de Meta Ads",
    "Activar campañas nuevas",
    "Reporte de facturación",
    "Arreglar el pago contraentrega",
    "Cambiar la clave del token de Meta",
  ];
  for (const texto of casos) {
    for (const momento of ["tarea", "plan", "subir"]) {
      assert.equal(puede(sistemas(), momento, texto), trabajo.MENSAJE_DINERO_O_META_ADS, `${momento}: ${texto}`);
    }
  }
  // El dueño sí, y sin el texto de la tarjeta (duda) SISTEMAS no aprueba.
  assert.equal(puede(dueno, "subir", casos[0]), null);
  assert.equal(trabajo.personaPuedeAprobarMomento(sistemas(), "tarea", "pantalla", "gestion", []), trabajo.MENSAJE_DINERO_O_META_ADS);
  assert.equal(trabajo.MENSAJE_DINERO_O_META_ADS, "Esta tarjeta toca dinero o Meta Ads: la aprueba Alexander.");
});

await prueba("SISTEMAS no aprueba con zona protegida (ni META_ADS) ni sin repo de Tecnología", () => {
  assert.match(puede(sistemas(), "tarea", "Cambiar un texto", "gestion", ["BOT_VENTAS"]) ?? "", /zona protegida/);
  assert.ok(puede(sistemas(), "subir", "Cambiar un texto", "gestion", ["META_ADS"]));
  assert.match(puede(sistemas(), "tarea", "Cambiar un texto", null) ?? "", /Tecnología/);
});

await prueba("el permiso vence el 29-nov-2026: después ya no aprueba nada", () => {
  assert.equal(trabajo.permisoDeSistemasVigente(ANTES), true);
  assert.equal(trabajo.permisoDeSistemasVigente(DESPUES), false);
  assert.equal(trabajo.permisoDeSistemasVigente(ANTES, "no es una fecha"), false, "fecha ilegible = vencido");
  assert.equal(trabajo.permisoDeSistemasVigente(DESPUES, "2026-12-30T05:00:00Z"), true, "el ajuste del negocio la prorroga");
  for (const momento of ["tarea", "plan", "subir"]) assert.match(puede(sistemas(false), momento) ?? "", /venció/);
  assert.match(puede({ ...sistemas(), sistemasVigente: undefined }, "tarea") ?? "", /venció/);
});

await prueba("una asesora o un aprobador DESARROLLO siguen sin dar el sí final; DESARROLLO sigue aprobando tarea y plan", () => {
  assert.match(puede(asesora, "subir") ?? "", /solo el dueño/);
  assert.match(puede(desarrollo, "subir") ?? "", /solo el dueño/);
  assert.equal(puede(desarrollo, "plan"), null);
  assert.ok(puede(asesora, "tarea"));
});

await prueba("puedeAprobarMomento: la subida por la regla completa (pantalla) y el MCP usan el mismo límite", () => {
  const pedido = (extra) => ({
    momento: "subir", via: "pantalla", origen: "PANTALLA", estado: "POR_REVISAR", requiereAprobacion: true, usaEstados: true,
    repo: "gestion", zonaProtegida: [], tienePlan: true, resultadoPaso: true, persona: sistemas(), textoDeLaTarjeta: "Arreglar el filtro", ...extra,
  });
  assert.deepEqual(trabajo.puedeAprobarMomento(pedido()), { a: "SUBIENDO", momento: "subir" });
  assert.equal(trabajo.puedeAprobarMomento(pedido({ textoDeLaTarjeta: "Cobros y abonos" })).error, trabajo.MENSAJE_DINERO_O_META_ADS);
  const voz = pedido({ via: "voz", origen: "MCP", textoConfirmacion: "sí, apruebo", textoDeLaTarjeta: "Pagos de nómina" });
  assert.equal(trabajo.puedeAprobarMomento(voz).error, trabajo.MENSAJE_DINERO_O_META_ADS);
});

await prueba("el historial marca 'periodo de prueba' en lo que aprueba Sistemas", () => {
  const base = { estado: "APROBADO", momento: "tarea", via: "pantalla", quienNombre: "Emanuel Díaz", userId: "u1", textoConfirmacion: null };
  assert.equal(trabajo.registroDeAprobacion({ ...base, periodoDePrueba: true }).como, "aprobado en pantalla (periodo de prueba)");
  assert.equal(trabajo.registroDeAprobacion({ ...base, periodoDePrueba: true }).periodoDePrueba, true);
  assert.equal(trabajo.registroDeAprobacion(base).como, "aprobado en pantalla");
});

await prueba("a quién va cada aviso: lo técnico a Sistemas; dinero, Meta Ads o clave y 'aprobar en pantalla' a Alexander", () => {
  for (const tipo of ["caido", "sin_trabajo", "trabado", "limite"]) assert.equal(avisos.destinoDelAviso(tipo, "URGENTE"), "sistemas", tipo);
  assert.equal(avisos.destinoDelAviso("necesita", "URGENTE"), "dueno");
  assert.equal(avisos.destinoDelAviso("necesita", "ALTA"), "sistemas");
  assert.equal(avisos.destinoDelAviso("aprobar_en_pantalla", "ALTA"), "dueno");
});

await prueba("el aviso técnico sale al teléfono de Sistemas; sin teléfono (o apagado) se mantiene a Alexander", async () => {
  ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
  ajustes.set("tablero:avisos-sistemas:telefono:ws1", "573004445566");
  enviados.length = 0;
  let envio = await avisos.enviarAviso("ws1", "🔴 Sistemas está detenido", "sistemas");
  assert.equal(envio.salio, true);
  assert.equal(enviados.at(-1).phoneNumber, "573004445566");
  envio = await avisos.enviarAviso("ws1", "Necesita dinero", "dueno");
  assert.equal(enviados.at(-1).phoneNumber, "573001112233");
  // Interruptor de Sistemas apagado: respaldo a Alexander.
  ajustes.set("tablero:avisos-sistemas:activo:ws1", "false");
  envio = await avisos.enviarAviso("ws1", "🔴 Sistemas está detenido", "sistemas");
  assert.equal(envio.salio, true);
  assert.equal(enviados.at(-1).phoneNumber, "573001112233");
  assert.match(envio.motivo, /salió a Alexander/);
  // Teléfono de Sistemas que es de una línea del negocio: no sirve, respaldo.
  ajustes.set("tablero:avisos-sistemas:activo:ws1", "true");
  assert.equal((await avisos.guardarConfigDeSistemas("ws1", { telefono: "573009990000" })).ok, false);
  assert.equal((await avisos.guardarConfigDeSistemas("ws1", { telefono: "abc" })).ok, false);
  assert.equal((await avisos.guardarConfigDeSistemas("ws1", { telefono: "300 444 5566" })).ok, true);
  assert.equal(ajustes.get("tablero:avisos-sistemas:telefono:ws1"), "573004445566");
});

await prueba("resumen diario a Alexander: máximo 4 líneas, sin links ni listas; sin movimiento no hay texto", () => {
  const texto = resumen.textoDelResumenDiario({ listas: 4, conProblema: 1, esperando: 2 });
  const lineas = texto.split("\n");
  assert.ok(lineas.length <= 4);
  assert.equal(lineas[1], "✅ Se arregló: 4 tareas");
  assert.equal(lineas[2], "⚠️ Falló: 1 tarea");
  assert.equal(lineas[3], "👆 Pendiente: 2 tarjetas");
  assert.doesNotMatch(texto, /https?:|Ver:/);
  assert.equal(resumen.textoDelResumenDiario({ listas: 0, conProblema: 0, esperando: 0 }), "");
  assert.equal(avisos.aTresLineas("a\nb\nc\nd\ne", 4), "a\nb\nc\nd");
});

await prueba("el resumen diario sale una sola vez al día, desde las 7 p. m. y nunca en el silencio", async () => {
  ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
  enviados.length = 0;
  const siete = new Date("2026-11-10T00:30:00Z"); // 7:30 p. m. en Bogotá del 9-nov
  const mañana = new Date("2026-11-10T15:00:00Z"); // 10 a. m.
  const noche = new Date("2026-11-10T03:00:00Z"); // 10 p. m. (silencio)
  // Con cifras en 0 (los falsos no tienen nada) no manda nada y queda anotado el día.
  assert.equal((await avisos.enviarResumenDiario("ws1", mañana)).enviado, false);
  assert.equal((await avisos.enviarResumenDiario("ws1", noche)).enviado, false);
  assert.equal(enviados.length, 0);
  assert.equal((await avisos.enviarResumenDiario("ws1", siete)).enviado, false);
  assert.equal(ajustes.get("tablero:resumen-diario:ultimo:ws1"), "2026-11-09");
});

console.log(`\n${pruebas} pruebas del aprobador de Sistemas: todas bien`);
