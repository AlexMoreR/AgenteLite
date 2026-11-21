// Pruebas de las llamadas entrantes en la PWA, parte 1: el servidor avisa cuando entra una llamada
// (src/app/api/webhooks/wacalls/route.ts, src/features/llamadas/services/avisar-llamada-entrante.ts,
// src/lib/wacalls.ts y la rama "llamada" de public/sw.js).
// Correr: npm run test:llamada-entrante
//
// El webhook se carga de verdad (transpilado con typescript, como en check-llamada-global.mjs) con
// sus dependencias de servidor simuladas: prisma, el realtime, el push y next. Se le manda un aviso
// con firma valida, igual que lo firma WaCalls, y se mira que avisos salen.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const leer = (ruta) => fs.readFileSync(path.resolve(ruta), "utf8");

// --- Dependencias simuladas ---

const registro = { realtime: [], push: [], intentos: [], mensajes: [], after: [] };

const negocio = "ws-1";
const datos = {
  canales: [
    { id: "canal-otro", workspaceId: "ws-2", metadata: { wacallsSessionId: "linea-otra" } },
    { id: "canal-1", workspaceId: negocio, metadata: { wacallsSessionId: "linea-1" } },
  ],
  contactos: [
    { id: "contacto-1", workspaceId: negocio, phoneNumber: "573001112233", name: "Laura Gómez", avatarUrl: "/f.jpg" },
  ],
  conversaciones: [
    {
      id: "chat-1",
      workspaceId: negocio,
      contactId: "contacto-1",
      channelId: "canal-1",
      assignedToUserId: "asesora-con-permiso",
      segundoAsesorId: "asesora-sin-permiso",
      lastMessageAt: null,
    },
  ],
  miembros: [
    { userId: "dueno", role: "OWNER", moduleAccess: null, user: { role: "CLIENTE" } },
    { userId: "asesora-con-permiso", role: "MEMBER", moduleAccess: ["chats", "llamadas"], user: { role: "EMPLEADO" } },
    { userId: "asesora-sin-permiso", role: "MEMBER", moduleAccess: ["chats"], user: { role: "EMPLEADO" } },
    { userId: "otra", role: "MEMBER", moduleAccess: ["llamadas"], user: { role: "EMPLEADO" } },
  ],
};

const coincide = (fila, where = {}) =>
  Object.entries(where).every(([clave, valor]) => (valor === undefined ? true : fila[clave] === valor));

const prisma = {
  whatsAppChannel: {
    findMany: async ({ where }) => datos.canales.filter((c) => coincide(c, { workspaceId: where?.workspaceId })),
    findUnique: async () => null,
  },
  contact: {
    findFirst: async ({ where }) =>
      datos.contactos.find((c) => coincide(c, { phoneNumber: where.phoneNumber, workspaceId: where.workspaceId })) ??
      null,
  },
  conversation: {
    findFirst: async ({ where }) => datos.conversaciones.find((c) => coincide(c, where)) ?? null,
    findUnique: async ({ where }) => datos.conversaciones.find((c) => c.id === where.id) ?? null,
    update: async () => ({}),
  },
  workspaceMember: {
    findMany: async ({ select }) =>
      select?.role ? datos.miembros : datos.miembros.map((m) => ({ userId: m.userId })),
    findFirst: async () => null,
  },
  workspace: { findUnique: async () => ({ ownerId: "dueno" }) },
  callAttempt: {
    findFirst: async () => null,
    count: async () => 0,
    create: async ({ data }) => {
      registro.intentos.push(data);
      return { id: `intento-${registro.intentos.length}` };
    },
    update: async () => ({}),
    findUnique: async () => null,
  },
  message: {
    create: async ({ data }) => {
      registro.mensajes.push(data);
      return { id: "m" };
    },
  },
};

const simulados = {
  "@/lib/prisma": { prisma },
  "@/lib/realtime-notify": {
    notifyRealtimeUpdate: async (aviso) => {
      registro.realtime.push(aviso);
    },
  },
  "@/lib/web-push": {
    sendChatPushToWorkspace: async (envio) => {
      registro.push.push(envio);
      return 1;
    },
  },
  "@/lib/llamada-transcripcion": { transcribirYResumirLlamada: async () => undefined },
  "next/server": {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    after: (fn) => {
      registro.after.push(fn);
    },
  },
  "next/cache": { revalidatePath: () => undefined },
};

// Carga un .ts del repo transpilado. Los "@/..." se resuelven a src/ (o a un simulado, si lo hay).
const cache = new Map();
function cargarTs(archivo) {
  const sourcePath = path.resolve(archivo);
  if (cache.has(sourcePath)) {
    return cache.get(sourcePath).exports;
  }
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  cache.set(sourcePath, mod);
  const requerir = (especificador) => {
    if (especificador in simulados) {
      return simulados[especificador];
    }
    if (especificador.startsWith("@/") || especificador.startsWith(".")) {
      const base = especificador.startsWith("@/")
        ? path.resolve("src", especificador.slice(2))
        : path.resolve(path.dirname(sourcePath), especificador);
      for (const candidato of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato)) {
          return cargarTs(candidato);
        }
      }
      throw new Error(`no se encontro ${especificador} desde ${archivo}`);
    }
    return require(especificador);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    requerir,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

// Solo `type` de @prisma/client: transpileModule los borra, no hace falta simularlo.
const { POST } = cargarTs("src/app/api/webhooks/wacalls/route.ts");

const SECRETO = "secreto-de-prueba";
process.env.WACALLS_WEBHOOK_SECRET = SECRETO;
delete process.env.WACALLS_WORKSPACE_ID;
delete process.env.WACALLS_URL;

async function mandarAviso(cuerpo) {
  registro.realtime = [];
  registro.push = [];
  registro.intentos = [];
  registro.mensajes = [];
  registro.after = [];
  const texto = JSON.stringify(cuerpo);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const firma = `v1=${createHmac("sha256", SECRETO).update(`${timestamp}.${texto}`).digest("hex")}`;
  const respuesta = await POST(
    new Request("http://localhost/api/webhooks/wacalls", {
      method: "POST",
      headers: { "x-wacalls-signature": firma, "x-wacalls-timestamp": timestamp },
      body: texto,
    }),
  );
  // Lo que el webhook deja para despues de responder (after) se corre aca.
  for (const fn of registro.after) {
    await fn();
  }
  return respuesta;
}

const llamadaBase = {
  sessionId: "linea-1",
  callId: "llam-123",
  peer: "573001112233@s.whatsapp.net",
  peerName: "Laura",
  startedAt: Date.now() - 30000,
};

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("un aviso sin firma valida se rechaza (el buzon sigue cerrado)", async () => {
  const respuesta = await POST(
    new Request("http://localhost/api/webhooks/wacalls", {
      method: "POST",
      headers: { "x-wacalls-signature": "v1=00", "x-wacalls-timestamp": String(Math.floor(Date.now() / 1000)) },
      body: "{}",
    }),
  );
  assert.equal(respuesta.status, 401);
});

await prueba("una llamada ENTRANTE que suena avisa en vivo y al celular, con el nombre y el chat", async () => {
  const respuesta = await mandarAviso({ event: "call.ringing", call: { ...llamadaBase, direction: "inbound" } });
  assert.equal(respuesta.status, 200);

  assert.equal(registro.realtime.length, 1, "no salio el aviso en vivo");
  const enVivo = registro.realtime[0];
  assert.equal(enVivo.type, "llamada-entrante");
  assert.equal(enVivo.workspaceId, negocio);
  assert.equal(enVivo.data.estado, "sonando");
  assert.equal(enVivo.data.llamadaId, "llam-123");
  assert.equal(enVivo.data.nombre, "Laura Gómez");
  assert.equal(enVivo.data.numero, "573001112233");
  assert.equal(enVivo.data.foto, "/f.jpg");
  assert.equal(enVivo.data.conversacionId, "chat-1");
  assert.ok(enVivo.data.href.includes("chatKey=agent:chat-1"), "el aviso en vivo no lleva al chat");
  assert.ok(enVivo.data.href.includes("llamada=llam-123"));

  // Se enteran los asignados al chat que tienen permiso de llamadas. El resto, no.
  const noSeEnteran = new Set(enVivo.data.noSeEnteran);
  assert.ok(!noSeEnteran.has("asesora-con-permiso"), "la asesora del chat con permiso no se entera");
  assert.ok(noSeEnteran.has("asesora-sin-permiso"), "se entera una asesora sin permiso de llamadas");
  assert.ok(noSeEnteran.has("otra"), "se entera alguien que no tiene el chat");
  assert.ok(noSeEnteran.has("dueno"), "el dueño no tiene el chat asignado: no le suena (regla de los mensajes)");

  assert.equal(registro.push.length, 1, "no salio la notificacion al celular");
  const push = registro.push[0];
  assert.equal(push.workspaceId, negocio);
  assert.equal(push.payload.tipo, "llamada");
  assert.equal(push.payload.title, "Te está llamando Laura Gómez");
  assert.equal(push.payload.tag, "llamada:llam-123");
  assert.equal(push.payload.requireInteraction, true);
  assert.ok(push.payload.url.includes("chatKey=agent:chat-1"), "el push no abre el chat");
  assert.ok(push.payload.url.includes("?") && push.payload.url.includes("llamada=llam-123"));
  assert.deepEqual(new Set(push.excludeUserIds), noSeEnteran);

  // No se escribio nada en el chat ni se anoto la llamada: eso es al terminar.
  assert.equal(registro.intentos.length, 0);
  assert.equal(registro.mensajes.length, 0);
});

await prueba("un numero sin ficha sale como numero y no se crea ficha", async () => {
  await mandarAviso({
    event: "call.ringing",
    call: { ...llamadaBase, peer: "573009998877@s.whatsapp.net", direction: "inbound" },
  });
  assert.equal(registro.realtime.length, 1);
  assert.equal(registro.realtime[0].data.nombre, null);
  assert.equal(registro.realtime[0].data.numero, "573009998877");
  assert.equal(registro.push[0].payload.title, "Te está llamando +573009998877");
  assert.equal(registro.push[0].payload.url, "/cliente/chats?llamada=llam-123");
});

await prueba("una llamada SALIENTE que suena no avisa nada", async () => {
  const respuesta = await mandarAviso({ event: "call.ringing", call: { ...llamadaBase, direction: "outbound" } });
  assert.equal(respuesta.status, 200);
  assert.equal(registro.realtime.length, 0);
  assert.equal(registro.push.length, 0);
});

await prueba("si el aviso falla, el webhook igual responde 200", async () => {
  const original = prisma.whatsAppChannel.findMany;
  prisma.whatsAppChannel.findMany = async () => {
    throw new Error("base caida");
  };
  const avisoOriginal = console.warn;
  console.warn = () => undefined;
  try {
    const respuesta = await mandarAviso({ event: "call.ringing", call: { ...llamadaBase, direction: "inbound" } });
    assert.equal(respuesta.status, 200);
  } finally {
    prisma.whatsAppChannel.findMany = original;
    console.warn = avisoOriginal;
  }
});

await prueba("contestada: avisa en vivo que dejo de sonar, sin push", async () => {
  await mandarAviso({ event: "call.connected", call: { ...llamadaBase, direction: "inbound" } });
  assert.equal(registro.realtime.length, 1);
  assert.equal(registro.realtime[0].type, "llamada-entrante");
  assert.equal(registro.realtime[0].data.estado, "contestada");
  assert.equal(registro.push.length, 0);
});

const infoOriginal = console.info;
console.info = () => undefined;

await prueba("al terminar sin contestar: sigue creando el CallAttempt y avisa el fin con 'Llamada perdida'", async () => {
  const respuesta = await mandarAviso({
    event: "call.ended",
    call: { ...llamadaBase, direction: "inbound", endedAt: Date.now(), endReason: "timeout" },
  });
  assert.equal(respuesta.body.registrada, true);
  assert.equal(registro.intentos.length, 1, "no se creo el CallAttempt");
  assert.equal(registro.intentos[0].result, "no_contesto");
  assert.equal(registro.intentos[0].summary, "Llamada entrante · perdida");
  assert.equal(registro.mensajes.length, 1, "no se dejo la llamada en el chat");
  assert.equal(registro.mensajes[0].content, "Llamada entrante · perdida");

  const fin = registro.realtime.filter((aviso) => aviso.type === "llamada-entrante");
  assert.equal(fin.length, 1, "no salio el aviso en vivo de fin");
  assert.equal(fin[0].data.estado, "terminada");
  assert.equal(fin[0].data.llamadaId, "llam-123");
  // El de siempre, el que pinta la burbuja en el chat, sigue saliendo.
  assert.ok(registro.realtime.some((aviso) => aviso.type === "llamada"));

  assert.equal(registro.push.length, 1);
  assert.equal(registro.push[0].payload.title, "Llamada perdida de Laura Gómez");
  assert.equal(registro.push[0].payload.tag, "llamada:llam-123");
  assert.equal(registro.push[0].payload.estado, "perdida");
});

await prueba("al terminar una que se hablo: CallAttempt por registrar, aviso de fin y sin push", async () => {
  const respuesta = await mandarAviso({
    event: "call.ended",
    call: { ...llamadaBase, direction: "inbound", endedAt: llamadaBase.startedAt + 95000, endReason: "user_ended" },
  });
  assert.equal(respuesta.body.registrada, true);
  assert.equal(registro.intentos[0].result, "por_registrar");
  assert.equal(registro.intentos[0].summary, "Llamada entrante · 1 min 35s");
  const fin = registro.realtime.filter((aviso) => aviso.type === "llamada-entrante");
  assert.equal(fin.length, 1);
  assert.equal(fin[0].data.estado, "terminada");
  assert.equal(registro.push.length, 0);
});

await prueba("al terminar una saliente: se anota como siempre y no avisa nada nuevo", async () => {
  await mandarAviso({
    event: "call.ended",
    call: { ...llamadaBase, direction: "outbound", endedAt: Date.now(), endReason: "timeout" },
  });
  assert.equal(registro.intentos.length, 1);
  assert.equal(registro.intentos[0].summary, "Llamada saliente · no contestó");
  assert.equal(registro.realtime.filter((aviso) => aviso.type === "llamada-entrante").length, 0);
  assert.equal(registro.push.length, 0);
});

console.info = infoOriginal;

await prueba("sw.js tiene la rama de llamada, aparte del agrupado de chats", () => {
  const sw = leer("public/sw.js");
  assert.ok(/payload\.tipo === "llamada"/.test(sw), "falta la rama tipo === \"llamada\"");
  assert.ok(sw.includes("requireInteraction: true"), "falta requireInteraction: true");
  assert.ok(sw.includes("`llamada:${llamadaId}`"), "falta el tag llamada:<id>");
  assert.ok(sw.includes("Te está llamando"), "falta el texto 'Te está llamando'");
  assert.ok(sw.includes("[500, 250, 500, 250, 500]"), "falta la vibracion larga");
  // La rama sale antes de llegar al agrupado de chats.
  const rama = sw.indexOf('payload.tipo === "llamada"');
  const agrupado = sw.indexOf("await acumularMensaje(entrada)");
  assert.ok(rama > 0 && rama < agrupado, "la llamada pasa por el agrupado de chats");
  // La perdida se muestra aunque el CRM este a la vista.
  assert.ok(/if \(!perdida && \(await crmALaVista\(\)\)\)/.test(sw));
});

console.log(`${pruebas} pruebas ok`);
