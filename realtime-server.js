/**
 * Altavoz de realtime (WebSocket).
 *
 * Por que existe: la API oficial de Meta SOLO entrega webhooks a nuestro servidor; no hay
 * ningun socket al que el navegador pueda conectarse (a diferencia de evogo, que expone su
 * propio /ws). Este proceso repone ese tramo que falta: servidor -> navegador.
 *
 * Que hace: nada mas que repetir. No tiene base de datos, ni sesion, ni logica de negocio,
 * ni sabe que es un mensaje.
 *
 *   1. La app (webhook de Meta) le hace POST /notify { workspaceId }  -- red interna, con token
 *   2. El avisa por WebSocket a los navegadores de ESE workspace
 *   3. El navegador pide el chat/fila que cambio y lo pinta (sin recargar la pagina)
 *
 * Corre con la MISMA imagen de la app, solo cambia el comando: `node realtime-server.js`.
 * Va en JavaScript plano a proposito: arranca sin compilar, un paso menos que pueda fallar
 * en un proceso que debe estar prendido 24/7.
 */

const http = require("node:http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.REALTIME_PORT || 4000);
// Token compartido con la app para que solo ELLA pueda publicar avisos. Si no se configura,
// el endpoint interno queda abierto: se avisa por log para que no pase inadvertido.
const INTERNAL_TOKEN = (process.env.REALTIME_INTERNAL_TOKEN || "").trim();
// Traefik enruta /rt hacia aca; el WebSocket vive en /rt/ws.
const WS_PATH = process.env.REALTIME_WS_PATH || "/rt/ws";
const NOTIFY_PATH = "/notify";
const HEARTBEAT_MS = 30000;

if (!INTERNAL_TOKEN) {
  console.warn("[realtime] REALTIME_INTERNAL_TOKEN vacio: /notify queda SIN autenticar");
}

// workspaceId -> Set<WebSocket>. En memoria a proposito: si el proceso reinicia, los
// navegadores reconectan solos y no se pierde nada (los mensajes viven en la BD de la app).
const clientsByWorkspace = new Map();

function addClient(workspaceId, socket) {
  let group = clientsByWorkspace.get(workspaceId);
  if (!group) {
    group = new Set();
    clientsByWorkspace.set(workspaceId, group);
  }
  group.add(socket);
}

function removeClient(workspaceId, socket) {
  const group = clientsByWorkspace.get(workspaceId);
  if (!group) return;
  group.delete(socket);
  if (group.size === 0) {
    clientsByWorkspace.delete(workspaceId);
  }
}

function broadcast(workspaceId, payload) {
  const group = clientsByWorkspace.get(workspaceId);
  if (!group || group.size === 0) {
    return 0;
  }

  const data = JSON.stringify(payload);
  let delivered = 0;

  for (const socket of group) {
    // 1 = OPEN. Un socket a medio cerrar se ignora; el 'close' lo saca del grupo.
    if (socket.readyState === 1) {
      try {
        socket.send(data);
        delivered += 1;
      } catch {
        // Si falla el envio a UN navegador, seguimos con el resto.
      }
    }
  }

  return delivered;
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      // Cortafuegos: el body esperado son unos pocos bytes ({ workspaceId }).
      if (raw.length > 10000) {
        raw = "";
        request.destroy();
        resolve(null);
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve(null);
      }
    });
    request.on("error", () => resolve(null));
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");

  // Sonda de salud (para Portainer / Traefik).
  if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/rt/health")) {
    const workspaces = clientsByWorkspace.size;
    let sockets = 0;
    for (const group of clientsByWorkspace.values()) sockets += group.size;

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, workspaces, sockets }));
    return;
  }

  // Publicacion interna: solo la app, por la red de Docker. NO se expone en Traefik.
  if (request.method === "POST" && (url.pathname === NOTIFY_PATH || url.pathname === "/rt/notify")) {
    if (INTERNAL_TOKEN) {
      const token = (request.headers["x-realtime-token"] || "").toString().trim();
      if (token !== INTERNAL_TOKEN) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
    }

    const body = await readJsonBody(request);
    const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : "";

    if (!workspaceId) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "workspaceId requerido" }));
      return;
    }

    const delivered = broadcast(workspaceId, {
      type: typeof body?.type === "string" ? body.type : "official-api-update",
      conversationId: typeof body?.conversationId === "string" ? body.conversationId : null,
      // Un dato chico y opcional. Lo usa la presencia ("esta escribiendo"), que no se puede
      // resolver con un simple "algo cambio": para cuando el navegador volviera a preguntar, la
      // persona ya dejo de escribir.
      data: body?.data && typeof body.data === "object" ? body.data : null,
      at: Date.now(),
    });

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, delivered }));
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: false }));
});

// noServer + upgrade manual: asi controlamos la ruta y rechazamos lo que no sea WS_PATH.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://localhost");

  if (url.pathname !== WS_PATH) {
    socket.destroy();
    return;
  }

  // El navegador se identifica con su workspace. No se manda ningun secreto: el peor caso es
  // enterarse de que "algo cambio" en un workspace, sin ver contenido. Los datos siguen
  // pidiendose a la app, que ahi si valida la sesion de la asesora.
  const workspaceId = (url.searchParams.get("workspaceId") || "").trim();
  if (!workspaceId) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.workspaceId = workspaceId;
    ws.isAlive = true;
    addClient(workspaceId, ws);

    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("close", () => removeClient(workspaceId, ws));
    ws.on("error", () => removeClient(workspaceId, ws));

    ws.send(JSON.stringify({ type: "ready", at: Date.now() }));
  });
});

// Ping periodico: sin esto, un socket muerto (wifi cortado, proxy que corta en silencio)
// queda en la lista para siempre y creemos que hay alguien escuchando cuando no lo hay.
const heartbeat = setInterval(() => {
  for (const group of clientsByWorkspace.values()) {
    for (const ws of group) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }
}, HEARTBEAT_MS);

server.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`[realtime] escuchando en :${PORT} (ws ${WS_PATH})`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[realtime] ${signal}: cerrando`);
    clearInterval(heartbeat);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
