// Pruebas de los avisos de WhatsApp al dueño del Tablero IA (avisos-al-dueno.ts y aviso-del-trabajador.ts): los 5 casos
// con mensaje de máximo 3 líneas y link, que no avise de empezar/terminar/avanzar, un solo aviso por problema cada
// 3 horas, silencio de 9:00 p. m. a 7:00 a. m. (menos el Coordinador caído), el interruptor, el número validado
// (no asesoras ni líneas), la línea Admin por id y el 412 de antes. Con un prisma y un envío de WhatsApp FALSOS:
// no necesita base ni red.
// Correr: npm run test:tablero-avisos-al-dueno
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const ADMIN_ID = "cmt06kiob00lw2hk2mgllstsb";
const estado = { ajustes: new Map(), claves: [], tarjetas: [], enviados: [], falla: false, lineas: [], miembros: [], dueno: "u-dueno" };

const reiniciar = () => {
  estado.ajustes.clear();
  estado.enviados.length = 0;
  estado.falla = false;
  estado.claves = [{ workspaceId: "ws1", ultimoUsoEn: new Date("2026-10-26T15:00:00Z"), revocadaEn: null }];
  estado.tarjetas = [];
  estado.lineas = [
    { id: ADMIN_ID, workspaceId: "ws1", name: "Admin", isActive: true, evolutionInstanceName: "inst-admin", phoneNumber: "573009990000", status: "CONNECTED" },
    { id: "ventas1", workspaceId: "ws1", name: "Ventas", isActive: true, evolutionInstanceName: "inst-ventas", phoneNumber: "573008880000", status: "CONNECTED" },
  ];
  estado.miembros = [
    { workspaceId: "ws1", userId: "u-dueno", user: { phone: "3001112233" } },
    { workspaceId: "ws1", userId: "u-asesora", user: { phone: "+57 310 555 4444" } },
  ];
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
};

const falso = {
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  workspace: { findUnique: async () => ({ ownerId: estado.dueno }) },
  workspaceMember: { findMany: async () => estado.miembros },
  whatsAppChannel: {
    findMany: async () => estado.lineas,
    findFirst: async ({ where }) => {
      const candidatas = estado.lineas.filter((l) => l.workspaceId === where.workspaceId && l.isActive && l.evolutionInstanceName);
      if (where.id) return candidatas.find((l) => l.id === where.id) ?? null;
      return candidatas.find((l) => l.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null;
    },
  },
  claveTrabajador: {
    findMany: async ({ where, distinct }) => {
      const filas = estado.claves.filter((c) => (!where.workspaceId || c.workspaceId === where.workspaceId) && c.revocadaEn === null);
      return distinct ? [...new Map(filas.map((c) => [c.workspaceId, c])).values()] : filas;
    },
  },
  tarjetaTablero: { findMany: async () => estado.tarjetas.map((t) => ({ trabajoIniciadoEn: null, actualizadoEn: t.desde, resultado: null, plan: null, zonaProtegida: [], ...t, historial: [{ creadoEn: t.desde }] })) },
};

const evolution = {
  sendEvolutionTextMessageWithReconnect: async (datos) => {
    if (estado.falla) throw new Error("línea caída");
    estado.enviados.push(datos);
  },
};

const mocks = { "@/lib/prisma": { prisma: falso }, "@/lib/evolution": evolution, "@prisma/client": { Prisma: {} } };
const A = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts", mocks);
const T = cargar("src/features/tableros-inteligentes/services/aviso-del-trabajador.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// Bogotá es UTC-5: 10:00 a. m. = 15:00Z; 11:00 p. m. = 04:00Z del día siguiente.
const MEDIODIA = new Date("2026-10-26T17:00:00Z");
const NOCHE = new Date("2026-10-27T04:00:00Z");
const hace = (ahora, minutos) => new Date(ahora.getTime() - minutos * 60_000);
const tarjeta = (extra) => ({ id: "t1", titulo: "Reporte de ventas", estado: "POR_APROBAR", repo: "aizencrm", desde: hace(MEDIODIA, 30), ...extra });
const lineasDe = (texto) => texto.split("\n");
const sinGuardar = () => estado.claves.forEach((c) => (c.ultimoUsoEn = hace(MEDIODIA, 1)));

/* ------------------------------------------------------------------ número */

await prueba("normalizarTelefono: solo dígitos con indicativo; 300… recibe el 57", () => {
  assert.equal(A.normalizarTelefono("300 111 2233"), "573001112233");
  assert.equal(A.normalizarTelefono("+57 300-111-2233"), "573001112233");
  assert.equal(A.normalizarTelefono("573001112233"), "573001112233");
  assert.equal(A.normalizarTelefono("12345"), null);
  assert.equal(A.normalizarTelefono("hola"), null);
  assert.equal(A.normalizarTelefono(null), null);
});

await prueba("validarTelefonoDelDueno rechaza una asesora y una línea del negocio, y acepta el del dueño", async () => {
  const asesora = await A.validarTelefonoDelDueno("ws1", "3105554444");
  assert.equal(asesora.ok, false);
  assert.match(asesora.error, /asesora|línea/);
  const linea = await A.validarTelefonoDelDueno("ws1", "+57 300 888 0000");
  assert.equal(linea.ok, false);
  const bueno = await A.validarTelefonoDelDueno("ws1", "3001112233");
  assert.deepEqual(bueno, { ok: true, numero: "573001112233" });
  assert.equal((await A.guardarTelefonoDelDueno("ws1", "3105554444")).ok, false);
  assert.equal(estado.ajustes.get("tablero:avisos-dueno:telefono:ws1"), "573001112233", "el rechazado no se guarda");
});

/* ------------------------------------------------------------------ silencio y repetición */

await prueba("silencio de 9:00 p. m. a 7:00 a. m. (Bogotá)", () => {
  assert.equal(A.enSilencio(new Date("2026-10-27T01:59:00Z")), false, "8:59 p. m.");
  assert.equal(A.enSilencio(new Date("2026-10-27T02:00:00Z")), true, "9:00 p. m.");
  assert.equal(A.enSilencio(new Date("2026-10-27T11:59:00Z")), true, "6:59 a. m.");
  assert.equal(A.enSilencio(new Date("2026-10-27T12:00:00Z")), false, "7:00 a. m.");
});

await prueba("tocaAvisar: uno por problema; otra vez solo pasadas 3 horas", () => {
  const avisado = A.sinAvisos();
  assert.equal(A.tocaAvisar("x", avisado, MEDIODIA), true);
  avisado.problemas.x = MEDIODIA.toISOString();
  assert.equal(A.tocaAvisar("x", avisado, new Date(MEDIODIA.getTime() + 179 * 60_000)), false);
  assert.equal(A.tocaAvisar("x", avisado, new Date(MEDIODIA.getTime() + 181 * 60_000)), true);
});

/* ------------------------------------------------------------------ los 5 casos */

await prueba("caso 1: Coordinador sin señales más de 10 minutos avisa; con señales recientes no", async () => {
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, 9);
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 0);
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, 11);
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 1);
  const texto = estado.enviados[0].text;
  assert.match(texto, /apagado|no da señales/);
  assert.ok(lineasDe(texto).length <= 3 && texto.includes("/cliente/tableros-inteligentes"));
  assert.equal(estado.enviados[0].instanceName, "inst-admin");
  assert.equal(estado.enviados[0].phoneNumber, "573001112233");
  // Mismo problema un minuto después: no se repite.
  assert.equal(await A.revisarNegocio("ws1", new Date(MEDIODIA.getTime() + 60_000)), 0);
  // Y pasadas 3 horas, sí.
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, -170);
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, 11);
  assert.equal(await A.revisarNegocio("ws1", new Date(MEDIODIA.getTime() + 181 * 60_000)), 1);
});

await prueba("caso 1 de noche: el Coordinador caído SÍ avisa en el silencio", async () => {
  estado.claves[0].ultimoUsoEn = hace(NOCHE, 30);
  assert.equal(await A.revisarNegocio("ws1", NOCHE), 1);
  assert.equal(estado.enviados.length, 1);
});

await prueba("caso 2: sin trabajo y tarjetas esperando al dueño -> dice cuáles y qué necesitan", async () => {
  sinGuardar();
  estado.tarjetas = [
    tarjeta({ id: "a", titulo: "Reporte de ventas", estado: "POR_APROBAR" }),
    tarjeta({ id: "b", titulo: "Pantalla de metas", estado: "POR_REVISAR" }),
    tarjeta({ id: "c", titulo: "Filtro nuevo", estado: "PLAN_LISTO", plan: "Agrega un filtro a la lista." }),
  ];
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 1);
  const texto = estado.enviados[0].text;
  assert.match(texto, /sin trabajo/);
  assert.match(texto, /Reporte de ventas.*aprobar la tarea/);
  assert.match(texto, /Pantalla de metas.*revisar el resultado/);
  assert.match(texto, /Filtro nuevo.*aprobar el plan/);
  assert.ok(lineasDe(texto).length <= 3);
});

await prueba("caso 2: con algo en curso o en fila NO avisa de 'sin trabajo'", async () => {
  sinGuardar();
  estado.tarjetas = [tarjeta({ id: "a", estado: "POR_APROBAR" }), tarjeta({ id: "b", estado: "EN_CURSO", desde: hace(MEDIODIA, 20) })];
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 0);
  estado.tarjetas = [tarjeta({ id: "a", estado: "POR_APROBAR" }), tarjeta({ id: "b", estado: "APROBADO" })];
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 0);
  assert.equal(estado.enviados.length, 0);
});

await prueba("caso 3: más de 2 horas en el mismo estado, o ERROR con su causa, es 'trabado'", async () => {
  sinGuardar();
  estado.tarjetas = [
    tarjeta({ id: "a", titulo: "Larga", estado: "PLANEANDO", desde: hace(MEDIODIA, 121) }),
    tarjeta({ id: "b", titulo: "Rota", estado: "ERROR", resultado: { error: { motivo: "Las pruebas fallaron tras 3 reparaciones" } } }),
    tarjeta({ id: "c", titulo: "Reciente", estado: "EN_CURSO", desde: hace(MEDIODIA, 119) }),
  ];
  const problemas = A.detectarProblemas(
    { ultimoUsoDelCoordinador: hace(MEDIODIA, 1), tarjetas: estado.tarjetas.map((t) => ({ plan: null, zonaProtegida: [], motivoDelError: t.resultado?.error?.motivo ?? null, ...t })) },
    MEDIODIA,
  );
  assert.deepEqual(problemas.filter((p) => p.tipo === "trabado").map((p) => p.clave).sort(), ["trabado:a", "trabado:b"]);
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 1);
  const texto = estado.enviados[0].text;
  assert.match(texto, /Larga.*sin avanzar/);
  assert.match(texto, /Rota.*Las pruebas fallaron/);
  assert.ok(lineasDe(texto).length <= 3);
});

await prueba("caso 4: un plan que toca Meta Ads o dinero, o un error por falta de clave, necesita al dueño", async () => {
  sinGuardar();
  estado.tarjetas = [
    tarjeta({ id: "a", titulo: "Anuncios", estado: "PLAN_LISTO", zonaProtegida: ["META_ADS"], plan: "Cambia los anuncios." }),
    tarjeta({ id: "b", titulo: "Integración", estado: "ERROR", resultado: { error: { motivo: "Falta la clave de la API de pagos" } } }),
    tarjeta({ id: "c", titulo: "Presupuesto", estado: "PLAN_LISTO", plan: "Sube el presupuesto diario de las campañas de Meta Ads." }),
  ];
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 1);
  const texto = estado.enviados[0].text;
  assert.match(texto, /Anuncios.*Meta Ads/);
  assert.match(texto, /Integración.*clave/);
  assert.ok(lineasDe(texto).length <= 3);
});

await prueba("caso 5: el límite de Claude lo manda el Coordinador, con su tipo; sin tipo se descarta sin error", async () => {
  const contexto = { workspaceId: "ws1" };
  const sinTipo = await T.enviarAvisoDelTrabajador(contexto, { texto: "⚠️ el plan de Claude pasó el 80 %" });
  assert.equal(sinTipo.enviado, false);
  assert.match(sinTipo.motivo, /descartado/);
  assert.equal(estado.enviados.length, 0);
  const mala = await T.enviarAvisoDelTrabajador(contexto, { texto: "x", tipo: "avance" }).catch((e) => e);
  assert.equal(mala.enviado, false);

  const texto = "⚠️ Se agotó el uso de Claude: todo quedó en pausa.\nVuelve a las 3:20pm.\nesto sobra\nesto también";
  const bien = await avisoConHora(contexto, texto, MEDIODIA);
  assert.equal(bien.enviado, true);
  const enviado = estado.enviados[0].text;
  assert.ok(lineasDe(enviado).length <= 3 && enviado.includes("/cliente/tableros-inteligentes"));
  assert.match(enviado, /Vuelve a las 3:20pm/);
  // El mismo límite otra vez dentro de 3 horas: no se repite.
  const otra = await A.avisoDelCoordinador("ws1", "limite", texto, new Date(MEDIODIA.getTime() + 60 * 60_000));
  assert.equal(otra.enviado, false);
  assert.match(otra.motivo, /3 horas/);
  const luego = await A.avisoDelCoordinador("ws1", "limite", texto, new Date(MEDIODIA.getTime() + 181 * 60_000));
  assert.equal(luego.enviado, true);
});

async function avisoConHora(contexto, texto, ahora) {
  return A.avisoDelCoordinador(contexto.workspaceId, "limite", texto, ahora);
}

await prueba("caso 5 de noche: el límite de Claude calla en el silencio", async () => {
  const r = await A.avisoDelCoordinador("ws1", "limite", "Se agotó Claude", NOCHE);
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /silencio/);
  assert.equal(estado.enviados.length, 0);
});

/* ------------------------------------------------------------------ reglas de todos los avisos */

await prueba("no avisa de empezar, terminar ni avanzar", async () => {
  sinGuardar();
  estado.tarjetas = [
    tarjeta({ id: "a", estado: "PLANEANDO", desde: hace(MEDIODIA, 10) }),
    tarjeta({ id: "b", estado: "PLAN_APROBADO" }),
    tarjeta({ id: "c", estado: "SUBIENDO", desde: hace(MEDIODIA, 5) }),
    tarjeta({ id: "d", estado: "HECHO" }),
    tarjeta({ id: "e", estado: "IDEA" }),
  ];
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 0);
  assert.equal(estado.enviados.length, 0);
});

await prueba("de noche calla los casos 2, 3 y 4 y no los pierde: avisa al llegar las 7 a. m.", async () => {
  estado.claves[0].ultimoUsoEn = hace(NOCHE, 1);
  estado.tarjetas = [tarjeta({ id: "b", titulo: "Rota", estado: "ERROR", desde: hace(NOCHE, 60) })];
  assert.equal(await A.revisarNegocio("ws1", NOCHE), 0);
  assert.equal(estado.enviados.length, 0);
  const manana = new Date("2026-10-27T12:00:00Z");
  estado.claves[0].ultimoUsoEn = hace(manana, 1);
  assert.equal(await A.revisarNegocio("ws1", manana), 1);
});

await prueba("interruptor apagado: no sale nada; sin ajuste empieza prendido", async () => {
  assert.equal(await A.avisosAlDuenoPrendidos("ws1"), true);
  await A.ponerAvisosAlDueno("ws1", false);
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, 60);
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 0);
  const limite = await A.avisoDelCoordinador("ws1", "limite", "Se agotó Claude", MEDIODIA);
  assert.equal(limite.enviado, false);
  assert.equal(estado.enviados.length, 0);
  await A.ponerAvisosAlDueno("ws1", true);
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 1);
});

await prueba("varios problemas a la vez: un solo mensaje de máximo 3 líneas; el resto sale en la próxima vuelta", async () => {
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, 1);
  estado.tarjetas = [
    tarjeta({ id: "a", titulo: "Anuncios", estado: "PLAN_LISTO", zonaProtegida: ["META_ADS"], plan: "x" }),
    tarjeta({ id: "b", titulo: "Rota", estado: "ERROR", resultado: { error: { motivo: "no compila" } } }),
  ];
  // Tres tipos de problema (necesita, trabado y sin trabajo): no caben en 2 líneas + el link.
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 1);
  assert.ok(lineasDe(estado.enviados[0].text).length <= 3);
  const siguiente = new Date(MEDIODIA.getTime() + 60_000);
  estado.claves[0].ultimoUsoEn = hace(siguiente, 1);
  const hubo = await A.revisarNegocio("ws1", siguiente);
  assert.equal(hubo, 1, "lo que no cupo sale en la vuelta siguiente");
  assert.equal(await A.revisarNegocio("ws1", new Date(siguiente.getTime() + 60_000)), 0, "y después ya no se repite");
});

/* ------------------------------------------------------------------ línea y número (el 412) */

await prueba("sale por la línea Admin por su id, nunca por una de ventas; sin esa, por la llamada 'Admin'", async () => {
  estado.lineas = estado.lineas.map((l) => (l.id === ADMIN_ID ? { ...l, evolutionInstanceName: "inst-admin" } : l));
  assert.equal((await A.mandarPrueba("ws1", MEDIODIA)).salio, true);
  assert.equal(estado.enviados[0].instanceName, "inst-admin");
  estado.lineas = estado.lineas.filter((l) => l.id !== ADMIN_ID).concat([{ id: "otro", workspaceId: "ws1", name: "admin", isActive: true, evolutionInstanceName: "inst-admin-2", phoneNumber: "573007770000" }]);
  assert.equal((await A.mandarPrueba("ws1", MEDIODIA)).salio, true);
  assert.equal(estado.enviados[1].instanceName, "inst-admin-2");
  estado.lineas = estado.lineas.filter((l) => l.id !== "otro");
  const sinAdmin = await A.mandarPrueba("ws1", MEDIODIA);
  assert.equal(sinAdmin.salio, false, "solo quedó la de ventas: no se usa");
  assert.equal(estado.enviados.some((e) => e.instanceName === "inst-ventas"), false);
});

await prueba("sin número no da 412: lo anota como 'falta su número' y el aviso del Coordinador responde ok", async () => {
  estado.ajustes.delete("tablero:avisos-dueno:telefono:ws1");
  const r = await A.avisoDelCoordinador("ws1", "limite", "Se agotó Claude", MEDIODIA);
  assert.equal(r.ok, true);
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /falta su número en Mi empresa → Claude/);
  const pantalla = await A.avisosParaLaPantalla("ws1");
  assert.equal(pantalla.telefono, null);
  assert.equal(pantalla.ultimos[0].salio, false);
  assert.match(pantalla.ultimos[0].motivo, /falta su número/);
  // El ajuste viejo sigue valiendo si alguien lo llenó a mano.
  estado.ajustes.set("trabajador:aviso-telefono:ws1", "573001112233");
  assert.equal(await A.leerTelefonoDelDueno("ws1"), "573001112233");
});

await prueba("el número guardado de una asesora (ajuste viejo) no recibe nada", async () => {
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573105554444");
  const r = await A.mandarPrueba("ws1", MEDIODIA);
  assert.equal(r.salio, false);
  assert.equal(estado.enviados.length, 0);
});

await prueba("si la línea falla, no se marca como avisado y se reintenta pasados los 10 minutos", async () => {
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, 30);
  estado.falla = true;
  assert.equal(await A.revisarNegocio("ws1", MEDIODIA), 0);
  const pantalla = await A.avisosParaLaPantalla("ws1");
  assert.equal(pantalla.ultimos[0].salio, false);
  estado.falla = false;
  assert.equal(await A.revisarNegocio("ws1", new Date(MEDIODIA.getTime() + 60_000)), 0, "espera antes de reintentar");
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, 30);
  assert.equal(await A.revisarNegocio("ws1", new Date(MEDIODIA.getTime() + 11 * 60_000)), 1);
});

await prueba("revisarAvisosAlDueno recorre los negocios con clave y no lanza", async () => {
  estado.claves[0].ultimoUsoEn = hace(MEDIODIA, 30);
  assert.deepEqual(await A.revisarAvisosAlDueno(MEDIODIA), { enviados: 1 });
});

console.log(`\n${pruebas} pruebas, todas bien`);
