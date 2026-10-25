// Pruebas de los avisos por WhatsApp al dueño del Tablero IA (avisos-al-dueno.ts): los 5 casos, que NO avise
// por empezar/terminar/avanzar, no repetir antes de 3 horas, el silencio de 9 p. m. a 7 a. m., el interruptor,
// la validación del número, la línea Admin y los reintentos. Usa un prisma y un Evolution FALSOS en memoria.
// No necesita base ni red.
// Correr: npm run test:tablero-avisos-al-dueno
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const LINEA_ADMIN_ID = "cmt06kiob00lw2hk2mgllstsb";

const estado = {
  ajustes: new Map(),
  negocios: ["ws1"],
  tarjetas: [],
  miembros: [],
  canales: [],
  contactos: [],
  salidas: [], // lo que se mandó por WhatsApp: { instanceName, phoneNumber, text }
  evolutionFalla: false,
};

const falso = {
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    findMany: async ({ where }) =>
      [...estado.ajustes].filter(([key]) => key.startsWith(where.key.startsWith)).map(([, value]) => ({ value })),
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  tableroInteligente: { findMany: async () => estado.negocios.map((workspaceId) => ({ workspaceId })) },
  tarjetaTablero: {
    findMany: async ({ where }) => estado.tarjetas.filter((t) => where.estado.in.includes(t.estado)),
  },
  workspace: { findUnique: async () => ({ ownerId: "dueno" }) },
  workspaceMember: { findMany: async () => estado.miembros },
  whatsAppChannel: {
    findMany: async ({ where }) => {
      if (!where.OR) return estado.canales.map((c) => ({ phoneNumber: c.phoneNumber }));
      // La búsqueda de la línea Admin: activa, con instancia, por id fijo o por nombre "Admin".
      return estado.canales.filter(
        (c) => c.isActive && c.evolutionInstanceName != null && (c.id === LINEA_ADMIN_ID || String(c.name).toLowerCase() === "admin"),
      );
    },
  },
  contact: {
    findFirst: async ({ where }) => {
      const cola = where.phoneNumber.endsWith;
      const hallado = estado.contactos.find((numero) => numero.endsWith(cola));
      return hallado ? { id: "c1" } : null;
    },
  },
};

const evolution = {
  sendEvolutionTextMessageWithReconnect: async ({ instanceName, phoneNumber, text }) => {
    if (estado.evolutionFalla) throw new Error("línea desconectada");
    estado.salidas.push({ instanceName, phoneNumber, text });
  },
};

const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  "@/lib/evolution": evolution,
  // tableros.ts arrastra media aplicación: solo se necesita el link de la tarjeta.
  "./tableros": { linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${encodeURIComponent(id)}` },
};

const avisos = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts", mocks);

const NUMERO_DUENO = "573105550000";
const CLAVE_NUMERO = avisos.claveDelTelefonoDelDueno("ws1");
const CLAVE_INTERRUPTOR = avisos.claveDelInterruptorDeAvisos("ws1");

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.ajustes.clear();
  estado.negocios = ["ws1"];
  estado.tarjetas = [];
  estado.salidas.length = 0;
  estado.evolutionFalla = false;
  estado.miembros = [
    { userId: "dueno", role: "OWNER", user: { phone: "3105550000" } },
    { userId: "asesora", role: "MEMBER", user: { phone: "3209998877" } },
    { userId: "sin-numero", role: "MEMBER", user: { phone: null } },
  ];
  estado.canales = [
    { id: LINEA_ADMIN_ID, name: "Línea 2", isActive: true, status: "CONNECTED", evolutionInstanceName: "inst-admin-id", phoneNumber: "573117770001" },
    { id: "admin-por-nombre", name: "Admin", isActive: true, status: "CONNECTED", evolutionInstanceName: "inst-admin-nombre", phoneNumber: "573117770002" },
    { id: "ventas1", name: "Ventas", isActive: true, status: "CONNECTED", evolutionInstanceName: "inst-ventas", phoneNumber: "573117770003" },
  ];
  estado.contactos = ["573151112233"];
  estado.ajustes.set(CLAVE_NUMERO, NUMERO_DUENO); // por defecto el dueño ya dejó su número
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// Fechas: Bogotá es UTC-5. 15:00Z = 10:00 a. m. (de día); 03:00Z = 10:00 p. m. del día anterior (silencio).
const DIA = new Date("2026-10-22T15:00:00Z");
const mas = (fecha, minutos) => new Date(fecha.getTime() + minutos * 60_000);

const tarjeta = (extra = {}) => {
  const desde = extra.desde ?? mas(DIA, -30);
  return {
    id: "t1",
    titulo: "Reporte de ventas",
    estado: "POR_APROBAR",
    plan: null,
    zonaProtegida: [],
    trabajoIniciadoEn: null,
    actualizadoEn: desde,
    historial: [{ creadoEn: desde }],
    intentosDeTrabajo: extra.causa ? [{ causa: extra.causa }] : [],
    ...extra,
  };
};

// Un latido del Coordinador recibido `minutos` antes de `ahora`.
const latido = (ahora, minutos) => estado.ajustes.set("trabajador:latido:ws1:k1", JSON.stringify({ recibidoEn: mas(ahora, -minutos).toISOString() }));

const lineasDe = (texto) => texto.split("\n");
function revisarMensaje(texto) {
  const lineas = lineasDe(texto);
  assert.ok(lineas.length <= 3, `más de 3 líneas:\n${texto}`);
  assert.match(lineas[lineas.length - 1], /^https:\/\/app\.aizenbot\.com\/cliente\/tablero-ia/, `la última línea no es el link:\n${texto}`);
}
const unico = () => {
  assert.equal(estado.salidas.length, 1, JSON.stringify(estado.salidas));
  revisarMensaje(estado.salidas[0].text);
  return estado.salidas[0].text;
};
const ultimoDelHistorial = async () => (await avisos.avisosParaLaPantalla("ws1")).ultimos[0];

/* ------------------------------------------------------------------ hora y números */

await prueba("silencio: 9:00 p. m. a 7:00 a. m. de Bogotá", () => {
  assert.equal(avisos.enSilencio(new Date("2026-10-23T01:59:00Z")), false); // 8:59 p. m.
  assert.equal(avisos.enSilencio(new Date("2026-10-23T02:00:00Z")), true); // 9:00 p. m.
  assert.equal(avisos.enSilencio(new Date("2026-10-23T11:59:00Z")), true); // 6:59 a. m.
  assert.equal(avisos.enSilencio(new Date("2026-10-23T12:00:00Z")), false); // 7:00 a. m.
});

await prueba("normalizarTelefono: 300… pasa a 57300…, con indicativo queda igual, basura es null", () => {
  assert.equal(avisos.normalizarTelefono("300 123 4567"), "573001234567");
  assert.equal(avisos.normalizarTelefono("573001234567"), "573001234567");
  assert.equal(avisos.normalizarTelefono("+57 (300) 123-4567"), "573001234567");
  assert.equal(avisos.normalizarTelefono("abc"), null);
  assert.equal(avisos.normalizarTelefono("12345"), null);
  assert.equal(avisos.normalizarTelefono(null), null);
});

/* ------------------------------------------------------------------ los 5 casos */

await prueba("caído: más de 10 min sin latido avisa; con 9 min no; sin latido nunca no", async () => {
  latido(DIA, 9);
  await avisos.revisarAvisosAlDueno(DIA);
  assert.equal(estado.salidas.length, 0);

  latido(DIA, 11);
  const r = await avisos.revisarAvisosAlDueno(DIA);
  assert.deepEqual(r, { enviados: 1 });
  const texto = unico();
  assert.ok(texto.includes("Coordinador"));
  assert.ok(texto.includes("11 min"));
  assert.equal(estado.salidas[0].phoneNumber, NUMERO_DUENO);

  estado.ajustes.clear();
  estado.ajustes.set(CLAVE_NUMERO, NUMERO_DUENO);
  estado.salidas.length = 0;
  await avisos.revisarAvisosAlDueno(DIA);
  assert.equal(estado.salidas.length, 0);
});

await prueba("sin trabajo: nada en curso ni en fila y hay tarjetas esperando; dice cuáles y qué necesitan", async () => {
  latido(DIA, 1);
  estado.tarjetas = [
    tarjeta({ id: "a", titulo: "Pantalla de metas", estado: "POR_APROBAR", desde: mas(DIA, -30) }),
    tarjeta({ id: "b", titulo: "Informe semanal", estado: "POR_REVISAR", desde: mas(DIA, -30) }),
  ];
  // Si algo cambió hace menos de 10 min (acaba de terminar la última) todavía no es «sin trabajo».
  estado.tarjetas[1].historial = [{ creadoEn: mas(DIA, -5) }];
  await avisos.revisarAvisosAlDueno(DIA);
  assert.equal(estado.salidas.length, 0);
  estado.tarjetas[1].historial = [{ creadoEn: mas(DIA, -30) }];
  await avisos.revisarAvisosAlDueno(DIA);
  const texto = unico();
  assert.ok(texto.includes("sin trabajo"));
  assert.ok(texto.includes("Pantalla de metas") && texto.includes("aprobar la tarea"));
  assert.ok(texto.includes("Informe semanal") && texto.includes("revisar el resultado"));

  // Si hay algo en fila (APROBADO) ya no es "sin trabajo".
  estado.salidas.length = 0;
  estado.ajustes.delete(avisos.claveDelEstadoDeAvisos("ws1"));
  estado.tarjetas.push(tarjeta({ id: "c", estado: "APROBADO" }));
  await avisos.revisarAvisosAlDueno(DIA);
  assert.equal(estado.salidas.length, 0);
});

await prueba("trabado: más de 2 h en PLANEANDO/EN_CURSO/SUBIENDO avisa; 1 h 59 no; ERROR con su causa", async () => {
  latido(DIA, 1);
  estado.tarjetas = [tarjeta({ estado: "EN_CURSO", desde: mas(DIA, -119) })];
  await avisos.revisarAvisosAlDueno(DIA);
  assert.equal(estado.salidas.length, 0);

  for (const [i, etapa] of ["PLANEANDO", "EN_CURSO", "SUBIENDO"].entries()) {
    estado.ajustes.delete(avisos.claveDelEstadoDeAvisos("ws1"));
    estado.salidas.length = 0;
    estado.tarjetas = [tarjeta({ id: `x${i}`, titulo: "Pantalla lenta", estado: etapa, desde: mas(DIA, -121) })];
    await avisos.revisarAvisosAlDueno(DIA);
    const texto = unico();
    assert.ok(texto.includes("trabado") && texto.includes("Pantalla lenta") && texto.includes("2 h 1 min"), texto);
    assert.ok(texto.includes(`tarjeta=x${i}`)); // un solo problema de una tarjeta: link a la tarjeta
  }

  estado.ajustes.delete(avisos.claveDelEstadoDeAvisos("ws1"));
  estado.salidas.length = 0;
  estado.tarjetas = [tarjeta({ titulo: "Se cayó", estado: "ERROR", causa: "las pruebas fallaron" })];
  await avisos.revisarAvisosAlDueno(DIA);
  const texto = estado.salidas[0].text;
  revisarMensaje(texto);
  assert.ok(texto.includes("trabado") && texto.includes("las pruebas fallaron"));
});

await prueba("necesita: plan con presupuesto de Meta Ads, zona META_ADS y error de clave de acceso", async () => {
  latido(DIA, 1);
  const casos = [
    [tarjeta({ titulo: "Subir gasto", estado: "PLAN_LISTO", plan: "Voy a subir el presupuesto de la campaña" }), "presupuesto"],
    [tarjeta({ titulo: "Tocar anuncios", estado: "PLAN_LISTO", plan: "Cambiar un texto", zonaProtegida: ["META_ADS"] }), "Meta Ads"],
    [tarjeta({ titulo: "Conectar API", estado: "ERROR", causa: "falta la clave de acceso" }), "falta la clave de acceso"],
  ];
  for (const [t, esperado] of casos) {
    estado.ajustes.delete(avisos.claveDelEstadoDeAvisos("ws1"));
    estado.salidas.length = 0;
    estado.tarjetas = [t];
    await avisos.revisarAvisosAlDueno(DIA);
    assert.ok(estado.salidas.length === 1, t.titulo);
    revisarMensaje(estado.salidas[0].text);
    assert.ok(estado.salidas[0].text.includes("necesita"), estado.salidas[0].text);
    assert.ok(estado.salidas[0].text.includes(esperado), estado.salidas[0].text);
  }

  // Un plan sin dinero ni zona protegida no es un aviso "necesita".
  estado.ajustes.delete(avisos.claveDelEstadoDeAvisos("ws1"));
  estado.salidas.length = 0;
  estado.tarjetas = [tarjeta({ estado: "PLAN_LISTO", plan: "Cambiar un texto de la pantalla" }), tarjeta({ id: "t2", estado: "EN_CURSO" })];
  await avisos.revisarAvisosAlDueno(DIA);
  assert.equal(estado.salidas.length, 0);
});

await prueba("límite: lo manda el Coordinador con tipo limite; sin tipo o tipo raro se descarta sin enviar", async () => {
  const r = await avisos.recibirAvisoDelCoordinador("ws1", "limite", "Se agotó el uso de Claude\nNo queda otro motor\nUna tercera línea\nhttps://otro.link", DIA);
  assert.equal(r.enviado, true);
  const texto = unico();
  assert.equal(lineasDe(texto).length, 2); // el texto del Coordinador (en una línea) + el link del CRM
  assert.ok(texto.includes("Se agotó el uso de Claude") && texto.includes("No queda otro motor"));
  assert.equal(texto.includes("tercera"), false);
  assert.equal(texto.includes("otro.link"), false);

  estado.salidas.length = 0;
  for (const tipo of [undefined, null, "", "raro", "avance", 5]) {
    const d = await avisos.recibirAvisoDelCoordinador("ws1", tipo, "Algo pasó", DIA);
    assert.equal(d.enviado, false);
    assert.equal(d.descartado, true);
  }
  assert.equal((await avisos.recibirAvisoDelCoordinador("ws1", "limite", "   ", DIA)).descartado, true);
  assert.equal(estado.salidas.length, 0);
});

/* ------------------------------------------------------------------ lo que NO se avisa */

await prueba("no avisa por empezar, terminar ni avanzar", async () => {
  latido(DIA, 1);
  estado.tarjetas = [
    tarjeta({ id: "a", estado: "PLANEANDO", desde: mas(DIA, -1) }),
    tarjeta({ id: "b", estado: "EN_CURSO", desde: mas(DIA, -30) }),
    tarjeta({ id: "c", estado: "SUBIENDO", desde: mas(DIA, -5) }),
    tarjeta({ id: "d", estado: "APROBADO" }),
    tarjeta({ id: "e", estado: "PLAN_APROBADO" }),
    tarjeta({ id: "f", estado: "HECHO" }),
  ];
  await avisos.revisarAvisosAlDueno(DIA);
  await avisos.revisarAvisosAlDueno(mas(DIA, 1));
  assert.equal(estado.salidas.length, 0);

  // Terminar: la única tarjeta pasa a HECHO (la consulta ni la trae) y tampoco hay aviso.
  estado.tarjetas = [tarjeta({ id: "b", estado: "HECHO" })];
  await avisos.revisarAvisosAlDueno(mas(DIA, 2));
  assert.equal(estado.salidas.length, 0);
});

/* ------------------------------------------------------------------ cuándo se repite */

await prueba("no repite antes de 3 horas y sí a las 3 horas", async () => {
  latido(DIA, 1);
  estado.tarjetas = [tarjeta({ titulo: "Pantalla de metas" })];
  await avisos.revisarAvisosAlDueno(DIA);
  assert.equal(estado.salidas.length, 1);
  latido(mas(DIA, 1), 1);
  await avisos.revisarAvisosAlDueno(mas(DIA, 1));
  latido(mas(DIA, 179), 1);
  await avisos.revisarAvisosAlDueno(mas(DIA, 179));
  assert.equal(estado.salidas.length, 1);
  latido(mas(DIA, 180), 1);
  await avisos.revisarAvisosAlDueno(mas(DIA, 180));
  assert.equal(estado.salidas.length, 2);
  revisarMensaje(estado.salidas[1].text);
});

await prueba("un problema que se resuelve y vuelve avisa de nuevo", async () => {
  latido(DIA, 1);
  estado.tarjetas = [tarjeta({ titulo: "Pantalla de metas" })];
  await avisos.revisarAvisosAlDueno(DIA);
  assert.equal(estado.salidas.length, 1);

  estado.tarjetas = []; // se resolvió
  await avisos.revisarAvisosAlDueno(mas(DIA, 1));
  estado.tarjetas = [tarjeta({ titulo: "Pantalla de metas" })]; // vuelve, 2 minutos después
  await avisos.revisarAvisosAlDueno(mas(DIA, 2));
  assert.equal(estado.salidas.length, 2);
});

await prueba("varios problemas en la misma vuelta salen en UN solo mensaje de 3 líneas o menos", async () => {
  latido(DIA, 30); // caído
  estado.tarjetas = [
    tarjeta({ id: "a", titulo: "Gasto Meta", estado: "PLAN_LISTO", plan: "Subir el presupuesto de la campaña" }),
    tarjeta({ id: "b", titulo: "Tarea lenta", estado: "EN_CURSO", desde: mas(DIA, -300) }),
    tarjeta({ id: "c", titulo: "Con error", estado: "ERROR", causa: "falló la compilación" }),
  ];
  const r = await avisos.revisarAvisosAlDueno(DIA);
  assert.deepEqual(r, { enviados: 1 });
  const texto = unico();
  assert.equal(lineasDe(texto).length, 3);
  assert.ok(texto.includes("Coordinador")); // el más grave va primero
  assert.ok(texto.includes("problemas más"));
  assert.equal(texto.includes("tarjeta="), false); // varios problemas: link general
});

/* ------------------------------------------------------------------ silencio */

await prueba("silencio nocturno: solo sale «caído»; lo del Coordinador queda pendiente y sale a las 7:00 a. m.", async () => {
  const noche = new Date("2026-10-23T03:00:00Z"); // 10:00 p. m.
  latido(noche, 1);
  estado.tarjetas = [tarjeta({ titulo: "Pantalla de metas" })];
  await avisos.revisarAvisosAlDueno(noche);
  assert.equal(estado.salidas.length, 0);

  const r = await avisos.recibirAvisoDelCoordinador("ws1", "limite", "Se agotó el uso de Claude", noche);
  assert.equal(r.enviado, false);
  assert.equal(r.descartado, false);
  assert.ok(r.motivo.includes("7:00"));
  assert.equal((await avisos.estadoDeAvisosDelNegocio("ws1")).pendientes.length, 1);

  // A las 6:59 sigue callado; a las 7:00 sale lo pendiente (y lo de la tarjeta, que sigue esperando).
  estado.tarjetas = [];
  latido(new Date("2026-10-23T11:59:00Z"), 1);
  await avisos.revisarAvisosAlDueno(new Date("2026-10-23T11:59:00Z"));
  assert.equal(estado.salidas.length, 0);
  latido(new Date("2026-10-23T12:00:00Z"), 1);
  await avisos.revisarAvisosAlDueno(new Date("2026-10-23T12:00:00Z"));
  const texto = unico();
  assert.ok(texto.includes("Se agotó el uso de Claude"));
  assert.equal((await avisos.estadoDeAvisosDelNegocio("ws1")).pendientes.length, 0);
  await avisos.revisarAvisosAlDueno(new Date("2026-10-23T12:01:00Z"));
  assert.equal(estado.salidas.length, 1);

  // «Caído» sí atraviesa el silencio.
  estado.salidas.length = 0;
  estado.ajustes.delete(avisos.claveDelEstadoDeAvisos("ws1"));
  latido(noche, 20);
  await avisos.revisarAvisosAlDueno(noche);
  assert.ok(unico().includes("Coordinador"));
});

/* ------------------------------------------------------------------ interruptor */

await prueba("interruptor apagado: no sale nada; sin la fila está prendido", async () => {
  latido(DIA, 30);
  estado.tarjetas = [tarjeta()];
  assert.equal(await avisos.avisosAlDuenoPrendidos("ws1"), true);

  estado.ajustes.set(CLAVE_INTERRUPTOR, "false");
  assert.equal(await avisos.avisosAlDuenoPrendidos("ws1"), false);
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  const r = await avisos.recibirAvisoDelCoordinador("ws1", "limite", "Se agotó el uso de Claude", DIA);
  assert.equal(r.enviado, false);
  assert.equal(estado.salidas.length, 0);

  await avisos.ponerAvisosAlDueno("ws1", true);
  assert.equal(estado.ajustes.get(CLAVE_INTERRUPTOR), "true");
  await avisos.revisarAvisosAlDueno(mas(DIA, 1));
  assert.equal(estado.salidas.length, 1);
});

/* ------------------------------------------------------------------ el número */

await prueba("validarTelefonoDelDueno rechaza asesora, línea del negocio y cliente; acepta al dueño", async () => {
  const asesora = await avisos.validarTelefonoDelDueno("ws1", "3209998877");
  assert.equal(asesora.ok, false);
  assert.ok(asesora.error.includes("asesora"));
  assert.equal((await avisos.validarTelefonoDelDueno("ws1", "+57 320 999 8877")).ok, false);

  const linea = await avisos.validarTelefonoDelDueno("ws1", "573117770003");
  assert.equal(linea.ok, false);
  assert.ok(linea.error.includes("línea"));

  const cliente = await avisos.validarTelefonoDelDueno("ws1", "3151112233");
  assert.equal(cliente.ok, false);
  assert.ok(cliente.error.includes("cliente"));

  assert.equal((await avisos.validarTelefonoDelDueno("ws1", "no es un número")).ok, false);

  assert.deepEqual(await avisos.validarTelefonoDelDueno("ws1", "310 555 0000"), { ok: true, numero: NUMERO_DUENO });
});

await prueba("guardarTelefonoDelDueno no guarda un número rechazado y al enviar solo va al guardado", async () => {
  estado.ajustes.clear();
  const malo = await avisos.guardarTelefonoDelDueno("ws1", "3209998877");
  assert.equal(malo.ok, false);
  assert.equal(estado.ajustes.has(CLAVE_NUMERO), false);
  assert.equal(await avisos.telefonoDelDueno("ws1"), null);

  const bueno = await avisos.guardarTelefonoDelDueno("ws1", "310 555 0000");
  assert.equal(bueno.ok, true);
  assert.equal(estado.ajustes.get(CLAVE_NUMERO), NUMERO_DUENO);
  assert.equal(await avisos.telefonoDelDueno("ws1"), NUMERO_DUENO);

  latido(DIA, 1);
  estado.tarjetas = [tarjeta()];
  await avisos.revisarAvisosAlDueno(DIA);
  unico();
  assert.equal(estado.salidas[0].phoneNumber, NUMERO_DUENO);

  // Si alguien deja a mano el número de una asesora, tampoco sale: se vuelve a validar al enviar.
  estado.salidas.length = 0;
  estado.ajustes.set(CLAVE_NUMERO, "573209998877");
  const r = await avisos.mandarAlDueno("ws1", "hola");
  assert.equal(r.salio, false);
  assert.ok(r.motivo.includes("asesora"));
  assert.equal(estado.salidas.length, 0);
});

/* ------------------------------------------------------------------ la línea */

await prueba("sale por la línea de id fijo; si no existe, por la llamada Admin; nunca por una de ventas", async () => {
  // Hay la de id fijo, otra llamada «Admin» y una de ventas: gana la de id fijo.
  assert.deepEqual(await avisos.mandarAlDueno("ws1", "uno"), { salio: true, motivo: null });
  assert.equal(estado.salidas[0].instanceName, "inst-admin-id");

  // Sin la de id fijo: la llamada «Admin» (aunque esté en minúsculas).
  estado.canales = estado.canales.filter((c) => c.id !== LINEA_ADMIN_ID);
  estado.canales.find((c) => c.id === "admin-por-nombre").name = "admin";
  await avisos.mandarAlDueno("ws1", "dos");
  assert.equal(estado.salidas[1].instanceName, "inst-admin-nombre");

  // Solo de ventas: no sale y el motivo lo dice.
  estado.canales = estado.canales.filter((c) => c.id === "ventas1");
  const r = await avisos.mandarAlDueno("ws1", "tres");
  assert.equal(r.salio, false);
  assert.ok(r.motivo.includes("Admin"));
  assert.equal(estado.salidas.length, 2);
  assert.equal(estado.salidas.some((s) => s.instanceName === "inst-ventas"), false);
});

/* ------------------------------------------------------------------ fallas */

await prueba("sin número: no lanza, queda en el historial y se reintenta al guardar el número", async () => {
  estado.ajustes.clear();
  latido(DIA, 1);
  estado.tarjetas = [tarjeta({ titulo: "Pantalla de metas" })];
  for (let i = 0; i < 4; i++) assert.deepEqual(await avisos.revisarAvisosAlDueno(mas(DIA, i)), { enviados: 0 });
  assert.equal(estado.salidas.length, 0);

  const vista = await avisos.avisosParaLaPantalla("ws1");
  assert.equal(vista.numero, null);
  assert.equal(vista.ultimos.length, 1); // no se llena de entradas repetidas
  assert.equal(vista.ultimos[0].salio, false);
  assert.ok(vista.ultimos[0].motivo.includes("falta su número en Mi empresa → Claude"));

  assert.equal((await avisos.guardarTelefonoDelDueno("ws1", "3105550000")).ok, true);
  await avisos.revisarAvisosAlDueno(mas(DIA, 5));
  unico();
  const despues = await ultimoDelHistorial();
  assert.equal(despues.salio, true);
});

await prueba("si Evolution lanza error el aviso no se marca como avisado y se reintenta", async () => {
  const aviso = console.warn;
  console.warn = () => {};
  try {
    latido(DIA, 1);
    estado.tarjetas = [tarjeta({ titulo: "Pantalla de metas" })];
    estado.evolutionFalla = true;
    for (let i = 0; i < 4; i++) assert.deepEqual(await avisos.revisarAvisosAlDueno(mas(DIA, i)), { enviados: 0 });
    assert.equal(estado.salidas.length, 0);
    const guardado = await avisos.estadoDeAvisosDelNegocio("ws1");
    assert.deepEqual(guardado.problemas, {}); // sigue sin marcarse
    assert.equal(guardado.historial.length, 1);
    assert.equal(guardado.historial[0].salio, false);
    assert.ok(guardado.historial[0].motivo.includes("Admin"));

    estado.evolutionFalla = false;
    assert.deepEqual(await avisos.revisarAvisosAlDueno(mas(DIA, 5)), { enviados: 1 });
    unico();
    // Y ya avisado: no repite en la vuelta siguiente.
    await avisos.revisarAvisosAlDueno(mas(DIA, 6));
    assert.equal(estado.salidas.length, 1);
  } finally {
    console.warn = aviso;
  }
});

await prueba("un aviso del Coordinador que no salió queda pendiente y sale en la siguiente vuelta", async () => {
  const aviso = console.warn;
  console.warn = () => {};
  try {
    estado.evolutionFalla = true;
    const r = await avisos.recibirAvisoDelCoordinador("ws1", "necesita", "Falta una clave de Meta", DIA);
    assert.equal(r.enviado, false);
    assert.equal((await avisos.estadoDeAvisosDelNegocio("ws1")).pendientes.length, 1);
    estado.evolutionFalla = false;
    await avisos.revisarAvisosAlDueno(mas(DIA, 1));
    assert.ok(unico().includes("Falta una clave de Meta"));
  } finally {
    console.warn = aviso;
  }
});

/* ------------------------------------------------------------------ la prueba manual */

await prueba("mandarPruebaAlDueno manda al número guardado por la línea Admin y queda en el historial", async () => {
  const r = await avisos.mandarPruebaAlDueno("ws1", DIA);
  assert.deepEqual(r, { salio: true, motivo: null });
  const texto = unico();
  assert.equal(estado.salidas[0].phoneNumber, NUMERO_DUENO);
  assert.equal(estado.salidas[0].instanceName, "inst-admin-id");
  assert.ok(texto.includes("Prueba"));
  assert.equal((await ultimoDelHistorial()).tipos, "prueba");
  // La prueba no cuenta como «último aviso».
  assert.equal((await avisos.estadoDeLosAvisosAlDueno("ws1")).ultimoAviso, null);

  // Sin número no lanza.
  estado.ajustes.clear();
  const sin = await avisos.mandarPruebaAlDueno("ws1", DIA);
  assert.equal(sin.salio, false);
  assert.ok(sin.motivo.includes("falta su número"));
});

console.log(`\n${pruebas} pruebas, todas bien`);
