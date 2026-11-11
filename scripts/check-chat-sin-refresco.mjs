// P3, dentro del chat: asignar, cambiar la etapa y anotar sin las dos renderizaciones completas de la
// pantalla; ficha e interruptor de seguimientos sin el permiso sin cache; /live sin channel.metadata y
// con los mensajes en paralelo; audios sin bajar enteros.
//
// Dos partes:
//  1. refrescarTrasAccionDelChat (src/components/chats/refrescar-tras-accion-del-chat.ts) con fetch,
//     window y la seleccion del chat falsos: publica el chat y la fila cuando los dos llegan, y en
//     CUALQUIER otro caso cae al router.refresh() de siempre.
//  2. Lectura del codigo (sin comentarios) de las acciones, los controles, el cargador y /live.
//
// No usa la base ni la red. Correr: node scripts/check-chat-sin-refresco.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** El codigo del archivo, sin comentarios (los comentarios hablan de router.refresh y revalidatePath). */
function codigo(relativo) {
  const ruta = path.resolve(relativo);
  return ts.transpileModule(fs.readFileSync(ruta, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.Preserve,
      removeComments: true,
    },
    fileName: ruta,
  }).outputText;
}

/** El cuerpo de `function nombre(` hasta la siguiente funcion de primer nivel. */
function cuerpoDe(texto, nombre) {
  const inicio = texto.search(new RegExp(`(export\\s+)?(async\\s+)?function\\s+${nombre}\\s*\\(`));
  assert.ok(inicio >= 0, `no encontre la funcion ${nombre}`);
  const resto = texto.slice(inicio + 1);
  const fin = resto.search(/\n(export\s+)?(async\s+)?function\s+\w+\s*\(/);
  return fin >= 0 ? resto.slice(0, fin) : resto;
}

/* ------------------------------------------------------------------ 1. el refresco del chat */

const seleccion = { chatKey: null, cerrado: false };
const stubs = {
  "./chat-selection-store": {
    getPendingConversationSelection: () => (seleccion.chatKey ? { id: "x", chatKey: seleccion.chatKey } : null),
    getSelectionClosed: () => seleccion.cerrado,
  },
  "./chat-inbox-conversation-utils": {
    normalizeLiveConversationSnapshot: (v) =>
      v && typeof v === "object" && typeof v.id === "string" && Array.isArray(v.messages) ? v : null,
    normalizeLiveConversationListSnapshot: (v) => (v && typeof v === "object" && typeof v.id === "string" ? v : null),
  },
};
const rutaRefresco = path.resolve("src/components/chats/refrescar-tras-accion-del-chat.ts");
const refrescoJs = ts.transpileModule(fs.readFileSync(rutaRefresco, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: rutaRefresco,
}).outputText;
const modulo = { exports: {} };
new Function("exports", "require", "module", refrescoJs)(
  modulo.exports,
  (nombre) => {
    if (!(nombre in stubs)) throw new Error(`import inesperado en el refresco: ${nombre}`);
    return stubs[nombre];
  },
  modulo,
);
const { refrescarTrasAccionDelChat } = modulo.exports;
assert.equal(typeof refrescarTrasAccionDelChat, "function");

const eventos = [];
globalThis.CustomEvent = class {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};
globalThis.window = { dispatchEvent: (evento) => eventos.push(evento) };

function respuesta(status, cuerpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo };
}
const chatBueno = { id: "c1", messages: [{ id: "m1", createdAt: "2026-11-10T00:00:00Z" }], assignedTo: { id: "u2" } };
const filaBuena = { id: "c1", lastMessageAt: "2026-11-10T00:00:00Z" };

/** Corre el refresco con un fetch falso. Devuelve lo que paso. */
async function correr({ live, summary, lanzar = false, antes, durante } = {}) {
  eventos.length = 0;
  seleccion.chatKey = null;
  seleccion.cerrado = false;
  antes?.();
  const pedidos = [];
  globalThis.fetch = async (url) => {
    pedidos.push(String(url));
    durante?.();
    if (lanzar) throw new Error("sin red");
    return String(url).includes("/live?") ? live : summary;
  };
  let refrescos = 0;
  await refrescarTrasAccionDelChat({ conversationId: "c1", refrescarTodo: () => (refrescos += 1) });
  return { pedidos, refrescos, eventos: eventos.map((evento) => evento.type), detalles: eventos.map((e) => e.detail) };
}

await prueba("los dos llegan: publica el chat y la fila, sin refrescar la pantalla", async () => {
  const r = await correr({ live: respuesta(200, { ok: true, conversation: chatBueno }), summary: respuesta(200, { ok: true, conversation: filaBuena }) });
  assert.equal(r.refrescos, 0);
  assert.deepEqual(r.eventos, ["chat-live-update", "chat-list-update"]);
  assert.equal(r.detalles[0].chatKey, "agent:c1");
  assert.equal(r.detalles[0].conversation.id, "c1");
  assert.equal(r.detalles[1].conversation.id, "c1");
  // Mismos dos pedidos que el tiempo real, y /live SIN precarga ni conLlamada.
  assert.deepEqual(r.pedidos.sort(), ["/api/cliente/chats/live?chatKey=agent%3Ac1", "/api/cliente/chats/summary?chatKey=agent%3Ac1"]);
});

await prueba("el chat abierto por la seleccion del cliente cuenta como abierto", async () => {
  const r = await correr({
    antes: () => (seleccion.chatKey = "agent:c1"),
    live: respuesta(200, { ok: true, conversation: chatBueno }),
    summary: respuesta(200, { ok: true, conversation: filaBuena }),
  });
  assert.equal(r.refrescos, 0);
  assert.equal(r.eventos.length, 2);
});

await prueba("/summary dice 'no encontrada' (el chat se le paso a otra): refresco de siempre, nada publicado", async () => {
  const r = await correr({
    live: respuesta(200, { ok: true, conversation: chatBueno }),
    summary: respuesta(200, { ok: false, error: "Conversacion no encontrada" }),
  });
  assert.equal(r.refrescos, 1);
  assert.deepEqual(r.eventos, []);
});

await prueba("/live falla (404/500): refresco de siempre", async () => {
  for (const status of [404, 500]) {
    const r = await correr({ live: respuesta(status, { ok: false }), summary: respuesta(200, { ok: true, conversation: filaBuena }) });
    assert.equal(r.refrescos, 1);
    assert.deepEqual(r.eventos, []);
  }
});

await prueba("respuesta que no es JSON o sin datos: refresco de siempre", async () => {
  const roto = { ok: true, status: 200, json: async () => { throw new Error("html"); } };
  const r1 = await correr({ live: roto, summary: respuesta(200, { ok: true, conversation: filaBuena }) });
  assert.equal(r1.refrescos, 1);
  const r2 = await correr({ live: respuesta(200, { ok: true, conversation: { id: "c1" } }), summary: respuesta(200, { ok: true, conversation: filaBuena }) });
  assert.equal(r2.refrescos, 1);
  assert.deepEqual(r2.eventos, []);
});

await prueba("sin red: refresco de siempre", async () => {
  const r = await correr({ lanzar: true });
  assert.equal(r.refrescos, 1);
  assert.deepEqual(r.eventos, []);
});

await prueba("la asesora ya esta en otro chat (o lo cerro): no pide nada y refresca como siempre", async () => {
  const otro = await correr({ antes: () => (seleccion.chatKey = "agent:otro") });
  assert.equal(otro.refrescos, 1);
  assert.deepEqual(otro.pedidos, []);
  const cerrado = await correr({ antes: () => (seleccion.cerrado = true) });
  assert.equal(cerrado.refrescos, 1);
  assert.deepEqual(cerrado.pedidos, []);
});

await prueba("cambio de chat mientras viajaba el pedido: no publica, refresca como siempre", async () => {
  const r = await correr({
    durante: () => (seleccion.chatKey = "agent:otro"),
    live: respuesta(200, { ok: true, conversation: chatBueno }),
    summary: respuesta(200, { ok: true, conversation: filaBuena }),
  });
  assert.equal(r.refrescos, 1);
  assert.deepEqual(r.eventos, []);
});

await prueba("el id con prefijo agent: se pide igual", async () => {
  eventos.length = 0;
  seleccion.chatKey = null;
  seleccion.cerrado = false;
  const pedidos = [];
  globalThis.fetch = async (url) => {
    pedidos.push(String(url));
    return String(url).includes("/live?")
      ? respuesta(200, { ok: true, conversation: chatBueno })
      : respuesta(200, { ok: true, conversation: filaBuena });
  };
  let refrescos = 0;
  await refrescarTrasAccionDelChat({ conversationId: "agent:c1", refrescarTodo: () => (refrescos += 1) });
  assert.equal(refrescos, 0);
  assert.ok(pedidos.every((url) => url.endsWith("chatKey=agent%3Ac1")));
});

/* ------------------------------------------------------------------ 2. lectura del codigo */

const chatsActions = codigo("src/app/actions/chats-actions.ts");
const crmActions = codigo("src/app/actions/crm-actions.ts");

await prueba("las cuatro acciones solo revalidan si NO viene desdeElChat", async () => {
  const casos = [
    [chatsActions, "assignChatAction", 1],
    [chatsActions, "asignarSegundoAsesorAction", 1],
    [chatsActions, "addConversationNoteAction", 1],
    [crmActions, "updateCrmStageAction", 3],
  ];
  for (const [texto, nombre, esperadas] of casos) {
    const cuerpo = cuerpoDe(texto, nombre);
    assert.match(cuerpo, /desdeElChat/, `${nombre} no recibe desdeElChat`);
    const indices = [...cuerpo.matchAll(/revalidatePath\(/g)].map((m) => m.index);
    assert.equal(indices.length, esperadas, `${nombre}: esperaba ${esperadas} revalidatePath, hay ${indices.length}`);
    for (const indice of indices) {
      const antes = cuerpo.slice(0, indice);
      const ultimoIf = antes.lastIndexOf("if (");
      assert.ok(ultimoIf >= 0, `${nombre}: revalidatePath sin condicion`);
      const condicion = antes.slice(ultimoIf, antes.indexOf(")", ultimoIf) + 1);
      assert.match(condicion, /^if \(!input\??\.desdeElChat\)$/, `${nombre}: revalidatePath bajo "${condicion}"`);
      // Y que el bloque de ese if no se cerro antes del revalidatePath.
      const entre = antes.slice(ultimoIf);
      const abre = (entre.match(/\{/g) ?? []).length;
      const cierra = (entre.match(/\}/g) ?? []).length;
      assert.ok(abre > cierra, `${nombre}: revalidatePath fuera del bloque de !desdeElChat`);
    }
  }
});

await prueba("asignar y cambiar la etapa avisan si el contacto tiene otro chat", async () => {
  assert.match(cuerpoDe(chatsActions, "assignChatAction"), /tocaOtrosChats/);
  assert.match(cuerpoDe(crmActions, "updateCrmStageAction"), /contactoTieneOtrosChats\(/);
});

const asignar = codigo("src/components/chats/assign-chat-control.tsx");
const etapa = codigo("src/components/chats/crm-stage-control.tsx");
const nota = codigo("src/components/chats/internal-note-dialog.tsx");

await prueba("los tres controles mandan desdeElChat: true y usan el refresco del chat", async () => {
  for (const [nombre, texto] of [["assign-chat-control", asignar], ["crm-stage-control", etapa], ["internal-note-dialog", nota]]) {
    assert.match(texto, /desdeElChat: true/, `${nombre} no manda desdeElChat: true`);
    assert.match(texto, /refrescarTrasAccionDelChat\(\{/, `${nombre} no usa refrescarTrasAccionDelChat`);
    // El router.refresh que queda es el respaldo (refrescarTodo) o una rama condicionada.
    assert.match(texto, /refrescarTodo: \(\) => router\.refresh\(\)/, `${nombre} sin el respaldo router.refresh`);
  }
});

await prueba("asignar: en WhatsApp normal no sale router.refresh suelto despues de la transicion", async () => {
  const cuerpo = asignar.slice(asignar.indexOf("const handleAssign"), asignar.indexOf("const assignedToMe"));
  assert.match(cuerpo, /const desdeElChat = source === "agent"/);
  assert.match(cuerpo, /if \(!desdeElChat\) \{\s*router\.refresh\(\);\s*\}/, "el refresco de la API oficial tiene que quedar bajo !desdeElChat");
  assert.match(cuerpo, /desdeElChat \? \{ desdeElChat: true \} : \{\}/);
  // El error y la excepcion siguen refrescando como antes.
  // (El cuerpo sale de transpilar sin comentarios: el `if` de una linea puede salir con o sin llaves.)
  assert.match(cuerpo, /setError\(result\.error\);\s*if \(desdeElChat\)\s*\{?\s*router\.refresh\(\);/);
  assert.match(cuerpo, /catch \(falla\) \{\s*if \(desdeElChat\)\s*\{?\s*router\.refresh\(\);\s*\}?\s*throw falla;/);
  const segundo = asignar.slice(asignar.indexOf("const handleSegundo"), asignar.indexOf("const handleAssign"));
  assert.doesNotMatch(segundo.replace(/refrescarTodo: \(\) => router\.refresh\(\)/g, ""), /router\.refresh\(\);\s*\},\s*\[/, "handleSegundo no debe refrescar despues de la transicion");
});

await prueba("etapa: solo el chat abierto de WhatsApp normal y sin otros chats evita el refresco", async () => {
  assert.match(etapa, /source === "agent" && conversationId\?\.trim\(\)/);
  assert.match(etapa, /if \(chatAbierto && !result\.tocaOtrosChats\) \{\s*void refrescarTrasAccionDelChat/);
  const cabecera = codigo("src/components/chats/chat-header-actions.tsx");
  assert.equal((cabecera.match(/<CrmStageControl[^>]*conversationId=\{conversationId\}[^>]*source=\{source\}/gs) ?? []).length, 2);
});

await prueba("nota: la API oficial sigue con router.refresh", async () => {
  assert.match(nota, /const desdeElChat = source === "agent"/);
  assert.match(nota, /else \{\s*router\.refresh\(\);\s*\}/);
});

await prueba("la ficha y la lectura del interruptor usan el permiso guardado, sin getPrimaryWorkspaceForUser", async () => {
  const ficha = cuerpoDe(chatsActions, "getContactDetailsAction");
  assert.doesNotMatch(ficha, /getPrimaryWorkspaceForUser|requireClientWorkspaceAccess/);
  assert.match(ficha, /getClientWorkspaceAccessForUserCached\(session\.user\.id\)/);
  assert.match(ficha, /canAccessClientModule\(access, "chats"\)/);
  // Desde el 10-nov-2026 la lectura vive en lib/ficha-del-contacto.ts (tambien viaja dentro de /live).
  assert.match(ficha, /leerFichaDelContacto\(\{ workspaceId, userId: session\.user\.id, contactId \}\)/);
  const lib = fs.readFileSync(path.resolve("src/lib/ficha-del-contacto.ts"), "utf8");
  assert.match(lib, /estaEnModoMonitoreo\(\{ workspaceId, userId \}\),\s*\]\)/, "el modo monitoreo va dentro del Promise.all");

  const contexto = cuerpoDe(chatsActions, "chatDeSeguimientos");
  // (Transpilado sin comentarios: el `else` puede salir en otra linea, por eso se busca con regex.)
  const inicioLectura = contexto.indexOf("if (opciones.soloLeer)");
  const finLectura = contexto.slice(inicioLectura).search(/\}\s*else\s*\{/);
  assert.ok(inicioLectura >= 0 && finLectura > 0, "se encontro la rama de solo lectura");
  const ramaLectura = contexto.slice(inicioLectura, inicioLectura + finLectura);
  assert.match(ramaLectura, /getClientWorkspaceAccessForUserCached/);
  assert.doesNotMatch(ramaLectura, /getPrimaryWorkspaceForUser|requireClientWorkspaceAccess/);
  assert.match(cuerpoDe(chatsActions, "leerSeguimientosAutomaticosAction"), /chatDeSeguimientos\(conversationId, \{ soloLeer: true \}\)/);
  // La escritura NO usa la cache.
  assert.match(cuerpoDe(chatsActions, "fijarSeguimientosAutomaticosAction"), /chatDeSeguimientos\(input\.conversationId\)/);
});

await prueba("interruptor y respuestas rapidas: 60 s en el navegador y se actualizan al cambiarlos", async () => {
  const interruptor = codigo("src/components/chats/interruptor-seguimientos.tsx");
  assert.match(interruptor, /VIDA_DEL_ESTADO_MS = 60000|VIDA_DEL_ESTADO_MS = 60_000/);
  assert.match(interruptor, /setApagados\(respuesta\.apagados\);\s*guardarEstado\(conversationId, respuesta\.apagados\)/);
  assert.match(interruptor, /estadoPorChat\.delete\(conversationId\)/, "si falla el cambio se olvida lo guardado");

  const rapidas = codigo("src/components/chats/quick-replies-dialog.tsx");
  assert.match(rapidas, /VIDA_DE_LA_LISTA_MS = 60000|VIDA_DE_LA_LISTA_MS = 60_000/);
  const guardar = rapidas.slice(rapidas.indexOf("const handleSave"), rapidas.indexOf("const handleDelete"));
  assert.match(guardar, /olvidarListasGuardadas\(\);\s*await refresh\(filtro\)/);
  const borrar = rapidas.slice(rapidas.indexOf("const handleDelete"), rapidas.indexOf("const alternarMarcada"));
  assert.match(borrar, /olvidarListasGuardadas\(\);\s*setItems/);
  // No se toco la accion del servidor.
  assert.match(chatsActions, /export async function getQuickRepliesAction\(/);
});

const cargador = codigo("src/lib/chat-message-loader.ts");
const live = codigo("src/app/api/cliente/chats/live/route.ts");

await prueba("el cargador no lee channel.metadata y pide conversacion y mensajes en paralelo", async () => {
  const canal = cargador.match(/channel:\s*\{\s*select:\s*\{([^}]*)\}/);
  assert.ok(canal, "no encontre el select de channel");
  assert.doesNotMatch(canal[1], /metadata/);
  assert.match(canal[1], /id: true/);
  assert.match(canal[1], /evolutionInstanceName: true/);
  assert.match(cargador, /Promise\.all\(\[\s*prisma\.conversation\.findFirst\([\s\S]*?\),\s*messagesPromise,\s*\]\)/);
  // El cursor se sigue comprobando antes de usarse.
  assert.match(cargador, /cursorPromise\.then\(\(cursorMessage\) =>/);
});

await prueba("/live: mensajes en paralelo con el acceso, presencia con su propio metadata, sin foto al subir", async () => {
  const inicioCarga = live.indexOf("loadAgentConversationDetail({");
  const permiso = live.indexOf("puedeAbrirChatPorClave({");
  assert.ok(inicioCarga > 0 && permiso > 0 && inicioCarga < permiso, "el cargador tiene que salir antes de esperar el permiso");
  assert.equal((live.match(/loadAgentConversationDetail\(\{/g) ?? []).length, 1);
  assert.doesNotMatch(live, /conversation\.channel\?\.metadata|channel\?\.metadata/);
  assert.match(live, /after\(async \(\) => \{\s*const linea = await prisma\.whatsAppChannel\s*\.findUnique\(\{ where: \{ id: canalPresencia \}, select: \{ metadata: true \} \}\)/);
  assert.match(live, /scheduleSingleContactAvatarRefresh/);
  assert.match(live, /&& !esPrecarga && !beforeMessageId\) \{\s*scheduleSingleContactAvatarRefresh/);
  // El canal sigue sin viajar al navegador.
  assert.match(live, /const \{ channel, \.\.\.conversacionSinLinea \} = conversation/);
});

await prueba("audios: sin bajar el archivo si ya se sabe la duracion", async () => {
  const audio = codigo("src/components/chats/audio-message-card.tsx");
  assert.match(audio, /preload=\{meta\.seconds \? "none" : "metadata"\}/);
  assert.match(audio, /const duracionMostrada = duracion \|\| meta\.seconds \|\| 0/);
});

console.log(`\n${pruebas} pruebas ok`);
