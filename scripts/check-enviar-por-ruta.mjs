// Pruebas de src/lib/chats/enviar-por-ruta.ts (despliegue ii del plan "envios por rutas fijas").
// La pantalla manda por las rutas fijas en vez de las Server Actions: se prueba que la accion recibe
// el MISMO objeto que antes le pasaba la pantalla, que la pantalla recibe lo MISMO que contesta la
// accion y que se LANZA donde antes lanzaba la accion (asi los catch de hoy siguen iguales).
// El fetch es falso y llama a procesarPedido con acciones falsas: no hay red ni sale ningun mensaje.
// Correr: node scripts/check-enviar-por-ruta.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(relativo) {
  const sourcePath = path.resolve(relativo);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    require,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

const R = cargar("src/lib/chats/ruta-de-envio.ts");
const E = cargar("src/lib/chats/enviar-por-ruta.ts");
const V = cargar("src/lib/nota-de-voz-reintento.ts");

const congelados = JSON.parse(fs.readFileSync(path.resolve("src/lib/chats/contrato-envios.congelados.json"), "utf8"));
const leer = (relativo) => fs.readFileSync(path.resolve(relativo), "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const AYUDANTE_DE_CADA_RUTA = {
  "enviar-archivo": E.enviarArchivoPorRuta,
  "enviar-audio": E.enviarAudioPorRuta,
  "enviar-ubicacion": E.enviarUbicacionPorRuta,
  "enviar-flujo": E.enviarFlujoPorRuta,
  reaccionar: E.reaccionarPorRuta,
  // Fijar es solo del CRM (no sale nada por WhatsApp), pero tambien va por su ruta fija.
  fijar: E.fijarPorRuta,
  // «No salió · Reintentar» de un paso del flujo: manda solo ese paso.
  "reintentar-paso-de-flujo": E.reintentarPasoDeFlujoPorRuta,
};

// Rutas que todavia no tienen un pedido en el archivo congelado: un cuerpo de ejemplo para la prueba de forma.
const CUERPO_DE_EJEMPLO = {
  fijar: { cuerpo: { conversationId: "c1", messageId: "m1" } },
};

/**
 * fetch falso: hace lo que hace la ruta (procesarPedido) con una accion falsa que anota lo que recibe.
 * Devuelve tambien los pedidos que vio, para revisar la forma (URL, metodo, cabeceras).
 */
function servidorFalso({ contestar = async () => ({ ok: true }), sesionValida = true, accesoAChats = true } = {}) {
  const llamadas = [];
  const pedidos = [];
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url, init });
    const nombre = String(url).replace("/api/cliente/chats/", "");
    const { status, cuerpo } = await R.procesarPedido({
      nombre,
      sesionValida,
      accesoAChats,
      leerCuerpo: async () => init.body,
      accion: async (entrada) => {
        llamadas.push(entrada);
        return contestar(entrada);
      },
      alLanzar: () => {},
    });
    return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  };
  return { llamadas, pedidos };
}

function fetchQueContesta(status, texto, contentType = "application/json") {
  globalThis.fetch = async () => new Response(texto, { status, headers: { "Content-Type": contentType } });
}

await prueba("cada ruta del contrato tiene su ayudante en la pantalla", () => {
  assert.deepStrictEqual(Object.keys(AYUDANTE_DE_CADA_RUTA).sort(), Object.keys(R.RUTAS_DE_ENVIO).sort());
  for (const [ruta, ayudante] of Object.entries(AYUDANTE_DE_CADA_RUTA)) assert.equal(typeof ayudante, "function", ruta);
  assert.equal(typeof E.enviarTextoSimplePorRuta, "function");
});

await prueba("ida y vuelta: la accion recibe exactamente cada payload congelado y la pantalla recibe lo que contesto", async () => {
  for (const [clave, pedido] of Object.entries(congelados.pedidos)) {
    const contesta = { ok: true };
    const { llamadas, pedidos } = servidorFalso({ contestar: async () => contesta });
    const resultado = await AYUDANTE_DE_CADA_RUTA[pedido.ruta](pedido.cuerpo);
    assert.equal(llamadas.length, 1, clave);
    assert.deepStrictEqual(llamadas[0], pedido.cuerpo, clave);
    assert.deepStrictEqual(resultado, contesta, clave);
    assert.equal(pedidos[0].url, `/api/cliente/chats/${pedido.ruta}`, clave);
  }
});

await prueba("los campos undefined (sin caption, sin agente) no viajan, igual que en la accion", async () => {
  const { llamadas } = servidorFalso();
  await E.enviarArchivoPorRuta({ ...congelados.pedidos["enviar-archivo/un-archivo"].cuerpo, caption: undefined, agentId: undefined });
  assert.equal(Object.prototype.hasOwnProperty.call(llamadas[0], "caption"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(llamadas[0], "agentId"), false);
});

await prueba("forma del pedido: POST JSON, same-origin, no-store; 60 s de limite salvo el flujo", async () => {
  for (const [ruta, ayudante] of Object.entries(AYUDANTE_DE_CADA_RUTA)) {
    const { pedidos } = servidorFalso();
    const pedido = Object.values(congelados.pedidos).find((p) => p.ruta === ruta) ?? CUERPO_DE_EJEMPLO[ruta];
    assert.ok(pedido, `${ruta} sin pedido congelado ni de ejemplo`);
    await ayudante(pedido.cuerpo);
    const { init } = pedidos[0];
    assert.equal(init.method, "POST", ruta);
    assert.equal(init.credentials, "same-origin", ruta);
    assert.equal(init.cache, "no-store", ruta);
    assert.equal(init.headers["Content-Type"], "application/json", ruta);
    assert.equal(typeof init.body, "string", ruta);
    if (ruta === "enviar-flujo") {
      assert.equal(init.signal, undefined, "el flujo hace pausas entre pasos: no lleva limite");
    } else {
      assert.ok(init.signal instanceof AbortSignal, `${ruta} sin limite de tiempo`);
    }
  }
  assert.equal(E.LIMITE_ESPERA_RUTA_MS, 60_000);
});

await prueba("las respuestas congeladas se leen como hoy, aunque traigan campos de mas", async () => {
  for (const [clave, congelada] of Object.entries(congelados.respuestas)) {
    const pedido = Object.values(congelados.pedidos).find((p) => p.ruta === congelada.ruta);
    servidorFalso({ contestar: async () => congelada.cuerpo });
    assert.deepStrictEqual(await AYUDANTE_DE_CADA_RUTA[congelada.ruta](pedido.cuerpo), congelada.cuerpo, clave);
    const conMas = { ...congelada.cuerpo, campoNuevo: 1 };
    servidorFalso({ contestar: async () => conMas });
    assert.deepStrictEqual(await AYUDANTE_DE_CADA_RUTA[congelada.ruta](pedido.cuerpo), conMas, clave);
  }
});

await prueba("sin sesion (401), sin acceso (403), JSON roto (400) y cuerpo grande (413): se devuelve el cuerpo, no lanza", async () => {
  servidorFalso({ sesionValida: false });
  assert.deepStrictEqual(await E.enviarAudioPorRuta(congelados.pedidos["enviar-audio/nota-de-voz"].cuerpo), {
    error: "Tu sesión se cerró. Vuelve a entrar para enviar.",
  });
  const sinAcceso = servidorFalso({ accesoAChats: false });
  assert.deepStrictEqual(await E.reaccionarPorRuta({ messageId: "m1", emoji: "👍" }), { error: "No autorizado" });
  assert.equal(sinAcceso.llamadas.length, 0);
  for (const [status, cuerpo] of [
    [400, { error: "Datos invalidos" }],
    [413, { error: "Datos invalidos" }],
  ]) {
    fetchQueContesta(status, JSON.stringify(cuerpo));
    assert.deepStrictEqual(await E.enviarUbicacionPorRuta({ conversationId: "c" }), cuerpo, String(status));
  }
  // Un caption enorme llega de verdad al limite de la ruta (413) y vuelve como { error }.
  const grande = servidorFalso();
  const resultado = await E.enviarArchivoPorRuta({ ...congelados.pedidos["enviar-archivo/un-archivo"].cuerpo, caption: "a".repeat(40 * 1024) });
  assert.deepStrictEqual(resultado, { error: "Datos invalidos" });
  assert.equal(grande.llamadas.length, 0);
});

await prueba("la accion hace redirect(): la pantalla recibe { error: No autorizado } como antes recibia un error", async () => {
  servidorFalso({
    contestar: async () => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    },
  });
  assert.deepStrictEqual(await E.enviarFlujoPorRuta(congelados.pedidos["enviar-flujo/mandar"].cuerpo), { error: "No autorizado" });
});

await prueba("LANZA donde lanzaba la accion: la accion lanzo (500), sin red, HTML de un proxy, cuerpo raro", async () => {
  servidorFalso({
    contestar: async () => {
      throw new Error("se cayo el gateway");
    },
  });
  await assert.rejects(E.enviarArchivoPorRuta(congelados.pedidos["enviar-archivo/un-archivo"].cuerpo), E.EnvioSinRespuesta);

  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(E.enviarAudioPorRuta(congelados.pedidos["enviar-audio/nota-de-voz"].cuerpo), TypeError);

  globalThis.fetch = async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  };
  await assert.rejects(E.enviarArchivoPorRuta(congelados.pedidos["enviar-archivo/un-archivo"].cuerpo), { name: "TimeoutError" });

  for (const [status, texto, tipo] of [
    [502, "<html>Bad Gateway</html>", "text/html"],
    [200, "<html>login</html>", "text/html"],
    [200, "null", "application/json"],
    [200, "[]", "application/json"],
    [200, '{"otra":1}', "application/json"],
    [404, '{"error":"No existe"}', "application/json"],
    [500, '{"error":"No se pudo enviar","lanzo":true}', "application/json"],
  ]) {
    fetchQueContesta(status, texto, tipo);
    await assert.rejects(E.reaccionarPorRuta({ messageId: "m1", emoji: "👍" }), E.EnvioSinRespuesta, `${status} ${texto}`);
  }
});

await prueba("nota de voz: si la ruta no responde se reintenta UNA vez; si contesta { error } no se repite", async () => {
  const entrada = congelados.pedidos["enviar-audio/nota-de-voz"].cuerpo;
  // Lo mismo que hace chat-conversation-panel.tsx con destino.sendAction (ahora enviarAudioPorRuta).
  const paso = async () => {
    try {
      return V.clasificarEnvio({ resultado: await E.enviarAudioPorRuta(entrada) });
    } catch {
      return V.clasificarEnvio({ excepcion: true });
    }
  };
  let intentos = 0;
  globalThis.fetch = async () => {
    intentos += 1;
    throw new TypeError("Failed to fetch");
  };
  const sinRed = await V.conUnReintento(paso, { esperar: async () => {} });
  assert.equal(sinRed.ok, false);
  assert.equal(sinRed.intentos, 2);
  assert.equal(intentos, 2);
  assert.equal(sinRed.falla.mensaje, V.MENSAJE_SIN_CONEXION_ENVIO);

  const rechazo = servidorFalso({ contestar: async () => ({ error: "No se pudo enviar el audio" }) });
  const conError = await V.conUnReintento(paso, { esperar: async () => {} });
  assert.equal(conError.intentos, 1);
  assert.equal(rechazo.llamadas.length, 1);
  assert.equal(conError.falla.reintentable, false);

  servidorFalso();
  assert.equal((await V.conUnReintento(paso, { esperar: async () => {} })).ok, true);
});

await prueba("reenviar texto: el mismo FormData va a la ruta que ya existe (/enviar) y se lee su respuesta", async () => {
  const pedidos = [];
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url, init });
    return new Response(JSON.stringify({ ok: false, error: "Fuera de la ventana de 24 h", motivo: "otro", reintentable: false }), { status: 200 });
  };
  const datos = new FormData();
  datos.set("source", "agent");
  datos.set("conversationId", "conv-3");
  datos.set("message", "Hola");
  const resultado = await E.enviarTextoSimplePorRuta(datos);
  assert.equal(pedidos[0].url, "/api/cliente/chats/enviar");
  assert.equal(pedidos[0].init.body, datos);
  assert.equal(pedidos[0].init.headers, undefined, "el FormData pone su propio Content-Type");
  assert.equal(resultado.error, "Fuera de la ventana de 24 h");
  fetchQueContesta(401, JSON.stringify({ ok: false, error: "Tu sesión se cerró. Vuelve a entrar para enviar." }));
  assert.equal((await E.enviarTextoSimplePorRuta(datos)).error, "Tu sesión se cerró. Vuelve a entrar para enviar.");
});

await prueba("reintentar un paso: va a su ruta con { envioId, indice }, 60 s de limite, y devuelve lo que contesta", async () => {
  const contesta = { ok: false, error: "Ese paso ya no se puede reintentar" };
  const { llamadas, pedidos } = servidorFalso({ contestar: async () => contesta });
  const resultado = await E.reintentarPasoDeFlujoPorRuta({ envioId: "envio-1", indice: 3 });
  assert.equal(pedidos[0].url, "/api/cliente/chats/reintentar-paso-de-flujo");
  assert.equal(pedidos[0].init.body, JSON.stringify({ envioId: "envio-1", indice: 3 }));
  assert.ok(pedidos[0].init.signal instanceof AbortSignal);
  assert.deepStrictEqual(llamadas, [{ envioId: "envio-1", indice: 3 }]);
  assert.deepStrictEqual(resultado, contesta);
  fetchQueContesta(500, '{"error":"No se pudo enviar","lanzo":true}');
  await assert.rejects(E.reintentarPasoDeFlujoPorRuta({ envioId: "envio-1", indice: 3 }), E.EnvioSinRespuesta);
});

await prueba("la franja reintenta por la ruta y solo los pasos fallidos tienen «Reintentar»", () => {
  const franja = leer("src/components/chats/franja-envio-de-flujo.tsx");
  assert.match(franja, /import \{[^}]*\breintentarPasoDeFlujoPorRuta\b[^}]*\} from "@\/lib\/chats\/enviar-por-ruta"/);
  assert.doesNotMatch(franja, /reintentarPasoDeFlujoAction/, "la franja no llama a la Server Action");
  assert.match(franja, /paso\.estado === "fallido"/);
  assert.match(franja, /No salió/);
  assert.match(franja, /Reintentar/);
});

// --- Candados sobre la pantalla ---

await prueba("la pantalla manda por las rutas: no importa las acciones de envio y effectiveComposer usa los ayudantes", () => {
  const inbox = leer("src/components/chats/shared-inbox.tsx");
  const composer = inbox.slice(inbox.indexOf("const effectiveComposer"), inbox.indexOf("}, [composer, renderedConversation, selectedConversationId]);"));
  assert.match(composer, /audio:[^\n]*sendAction: enviarAudioPorRuta/);
  assert.match(composer, /media:[^\n]*sendAction: enviarArchivoPorRuta/);

  const PROHIBIDAS = {
    "src/components/chats/chat-conversation-panel.tsx": ["sendChatLocationReplyAction"],
    "src/components/chats/forward-message-dialog.tsx": ["sendChatAudioReplyAction", "sendChatMediaReplyAction", "sendUnifiedChatReplyAction"],
    "src/components/chats/send-flow-dialog.tsx": ["sendFlowToChatAction"],
    "src/components/chats/chat-message-bubble.tsx": ["reaccionarAlMensajeAction"],
  };
  for (const [archivo, acciones] of Object.entries(PROHIBIDAS)) {
    const texto = leer(archivo);
    const imports = [...texto.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)];
    for (const accion of acciones) {
      const loImporta = imports.some(([, nombres, modulo]) => modulo.startsWith("@/app/actions") && new RegExp(`\\b${accion}\\b`).test(nombres));
      assert.equal(loImporta, false, `${archivo} sigue importando ${accion}`);
    }
    assert.match(texto, /from "@\/lib\/chats\/enviar-por-ruta"/, `${archivo} no usa enviar-por-ruta`);
  }
});

await prueba("se quitaron los 'Actualizamos la app' de los envios de archivos y el aviso de version nueva", () => {
  for (const archivo of ["src/components/chats/chat-conversation-panel.tsx", "src/components/chats/media-library-dialog.tsx"]) {
    const texto = leer(archivo);
    assert.doesNotMatch(texto, /Actualizamos la app/, archivo);
    assert.doesNotMatch(texto, /hayVersionNueva/, archivo);
  }
  // Desde el envio instantaneo (T-744) el aviso ya no vive en el panel: la cola de fotos no repite sola
  // si el servidor contesto un error, porque el archivo pudo haber salido.
  assert.match(leer("src/components/chats/fotos-en-envio.ts"), /el archivo pudo haber salido/);
  // Desde el 11-nov-2026 no hay aviso: la version nueva entra en silencio (app-version-guard.tsx).
  assert.doesNotMatch(leer("src/components/app-version-guard.tsx"), /Hay una versión nueva del CRM/);
  // Las Server Actions no se borran: page.tsx las sigue pasando y las rutas las usan.
  assert.match(leer("src/app/cliente/chats/page.tsx"), /sendAction: sendChatMediaReplyAction/);
});

await prueba("que no se manda nada: el ayudante solo importa tipos y esta prueba no importa Prisma, gateways ni acciones", () => {
  const ayudante = leer("src/lib/chats/enviar-por-ruta.ts");
  for (const linea of ayudante.split("\n").filter((l) => /^\s*import\b/.test(l))) {
    assert.match(linea, /^\s*import type\b/, `enviar-por-ruta.ts importa codigo de verdad: ${linea}`);
  }
  const yo = leer("scripts/check-enviar-por-ruta.mjs");
  for (const [, modulo] of yo.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)"/gm)) {
    assert.doesNotMatch(modulo, /prisma|evolution|waha|official-api|gateway|actions|^@\//i, modulo);
  }
});

console.log(`\n${pruebas} pruebas ok`);
