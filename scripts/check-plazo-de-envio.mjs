// Pruebas del tope de 1 hora de la cola de archivos (src/components/chats/plazo-de-envio.ts) y
// candados de la foto rapida (velocidad de fotos, 11-nov-2026).
//
// El servidor reconoce un reintento por su clientMessageId mirando solo la ultima hora. Se prueba que
// la pantalla no reintente sola ni retome lo que paso esa hora, que Reintentar saque una clave nueva
// (avisando) y que el numero de la pantalla sea el MISMO que el del servidor.
// Sin red, sin base y sin navegador: las reglas son puras y lo demas se lee del codigo fuente.
// Correr: node scripts/check-plazo-de-envio.mjs
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

const leer = (relativo) => fs.readFileSync(path.resolve(relativo), "utf8").replace(/\r\n/g, "\n");
/** El cuerpo de una funcion: desde su firma hasta la siguiente funcion de primer nivel. */
function cuerpoDe(texto, firma) {
  const inicio = texto.indexOf(firma);
  assert.notEqual(inicio, -1, `no se encontro ${firma}`);
  const resto = texto.slice(inicio + firma.length);
  const fin = resto.search(/\n(export )?(async )?function |\nconst [A-Za-z_]+ = /);
  return fin === -1 ? resto : resto.slice(0, fin);
}

const P = cargar("src/components/chats/plazo-de-envio.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const HORA = 60 * MIN;
const AHORA = 10 * 24 * HORA;
const REANUDAR = 30 * MIN;

await prueba("el plazo de la pantalla es 1 hora, el MISMO que mira el servidor para no duplicar", () => {
  assert.equal(P.PLAZO_ANTI_DUPLICADO_MS, HORA);
  const servidor = cuerpoDe(leer("src/app/actions/agent-actions.ts"), "async function enviarArchivoDelChat(");
  const ventana = servidor.match(/rawPayload: \{ path: \["clientMessageId"\], equals: clave \}/);
  assert.ok(ventana, "enviarArchivoDelChat ya no busca el clientMessageId");
  const fecha = servidor.match(/createdAt: \{ gte: new Date\(Date\.now\(\) - (\d+) \* (\d+)_000\) \}/);
  assert.ok(fecha, "enviarArchivoDelChat ya no limita la busqueda del repetido por fecha");
  assert.equal(Number(fecha[1]) * Number(fecha[2]) * 1000, P.PLAZO_ANTI_DUPLICADO_MS, "la pantalla y el servidor no miran la misma ventana");
});

await prueba("vencido: mas de 1 hora desde el ultimo intento (o desde Enviar si nunca se intento)", () => {
  assert.equal(P.plazoVencido({ creadaEn: AHORA - HORA, intentoDeEnvioEn: null }, AHORA), false, "justo 1 h no vence");
  assert.equal(P.plazoVencido({ creadaEn: AHORA - HORA - 1, intentoDeEnvioEn: null }, AHORA), true);
  // Creado hace 3 h pero intentado hace 10 min: el servidor todavia lo reconoce.
  assert.equal(P.plazoVencido({ creadaEn: AHORA - 3 * HORA, intentoDeEnvioEn: AHORA - 10 * MIN }, AHORA), false);
  assert.equal(P.plazoVencido({ creadaEn: AHORA - 3 * HORA, intentoDeEnvioEn: AHORA - 61 * MIN }, AHORA), true);
  assert.equal(P.inicioDelPlazo({ creadaEn: 5, intentoDeEnvioEn: null }), 5);
  assert.equal(P.inicioDelPlazo({ creadaEn: 5, intentoDeEnvioEn: 9 }), 9);
});

await prueba("al volver a abrir: solo se retoma lo pendiente, reciente y dentro de la hora", () => {
  const pendiente = (creada, intento = null) => ({ estado: "pendiente", creadaEn: AHORA - creada, intentoDeEnvioEn: intento === null ? null : AHORA - intento });
  assert.equal(P.puedeRetomarseSolo(pendiente(5 * MIN), AHORA, REANUDAR), true);
  assert.equal(P.puedeRetomarseSolo(pendiente(20 * MIN, 10 * MIN), AHORA, REANUDAR), true);
  assert.equal(P.puedeRetomarseSolo(pendiente(31 * MIN), AHORA, REANUDAR), false, "mas de 30 min: vuelve en rojo");
  assert.equal(P.puedeRetomarseSolo(pendiente(2 * HORA, 5 * MIN), AHORA, REANUDAR), false, "mas de 1 h desde Enviar: nunca sale solo");
  assert.equal(P.puedeRetomarseSolo({ ...pendiente(5 * MIN), estado: "fallida" }, AHORA, REANUDAR), false, "uno fallido espera a Reintentar");
  // Aunque alguien suba el tope de retomar por encima de la hora, la hora manda.
  assert.equal(P.puedeRetomarseSolo(pendiente(90 * MIN), AHORA, 3 * HORA), false);
  assert.equal(P.puedeRetomarseSolo(pendiente(50 * MIN), AHORA, 3 * HORA), true);
});

await prueba("Reintentar: la misma clave dentro de la hora; una NUEVA pasada la hora", () => {
  let creadas = 0;
  const nuevaClave = () => `nueva-${++creadas}`;
  assert.deepStrictEqual(
    P.claveParaReintentar({ clave: "vieja", creadaEn: AHORA - 20 * MIN, intentoDeEnvioEn: AHORA - 10 * MIN }, AHORA, nuevaClave),
    { clave: "vieja", nueva: false },
  );
  assert.equal(creadas, 0, "dentro de la hora no se gasta una clave");
  assert.deepStrictEqual(
    P.claveParaReintentar({ clave: "vieja", creadaEn: AHORA - 2 * HORA, intentoDeEnvioEn: AHORA - 61 * MIN }, AHORA, nuevaClave),
    { clave: "nueva-1", nueva: true },
  );
  assert.deepStrictEqual(
    P.claveParaReintentar({ clave: "vieja", creadaEn: AHORA - 2 * HORA, intentoDeEnvioEn: null }, AHORA, nuevaClave),
    { clave: "nueva-2", nueva: true },
  );
});

await prueba("los textos para la asesora estan en español y dicen que revisar", () => {
  assert.match(P.MOTIVO_PASO_LA_HORA, /más de una hora/);
  assert.match(P.MOTIVO_PASO_LA_HORA, /Revisa el chat/);
  assert.match(P.AVISO_REINTENTO_VENCIDO, /mensaje nuevo/);
  assert.match(P.AVISO_REINTENTO_VENCIDO, /dos veces/);
});

await prueba("plazo-de-envio.ts no importa nada (se prueba con Node solo)", () => {
  assert.doesNotMatch(leer("src/components/chats/plazo-de-envio.ts"), /^\s*import\b/m);
});

// --- Candados sobre la cola (fotos-en-envio.ts y el panel) ---

await prueba("retomar al abrir usa el tope y deja el motivo de la hora en la burbuja roja", () => {
  const cola = leer("src/components/chats/fotos-en-envio.ts");
  const reanudar = cuerpoDe(cola, "export async function reanudarEnviosGuardados(");
  assert.match(reanudar, /puedeRetomarseSolo\(/);
  assert.match(reanudar, /REANUDAR_SOLO_HASTA_MS/);
  assert.match(reanudar, /MOTIVO_PASO_LA_HORA/);
  assert.match(reanudar, /intentoDeEnvioEn/);
  // Se guarda en el navegador: sin esto, al recargar se perderia cuando fue el ultimo intento.
  assert.match(cuerpoDe(cola, "function comoGuardado("), /intentoDeEnvioEn: foto\.intentoDeEnvioEn/);
  assert.match(cola, /"clave", "intentoDeEnvioEn"/);
  assert.match(leer("src/components/chats/envios-guardados.ts"), /intentoDeEnvioEn\?: number \| null/);
});

await prueba("el panel anota cada intento, frena el reintento vencido y Reintentar cambia la clave avisando", () => {
  const panel = leer("src/components/chats/chat-conversation-panel.tsx");
  const enviar = panel.slice(panel.indexOf("const enviarFoto = useCallback("), panel.indexOf("const enviarFotoRef = useRef("));
  assert.match(enviar, /actualizarFoto\(id, \{ intentoDeEnvioEn: Date\.now\(\) \}\)/);
  assert.match(enviar, /plazoVencido\(plazoDe\(actual\), Date\.now\(\)\)/);
  assert.match(enviar, /clientMessageId: inicial\.clave/);
  const reintentar = panel.slice(panel.indexOf("const reintentarFoto = useCallback("), panel.indexOf("const descartarFoto = useCallback("));
  assert.match(reintentar, /claveParaReintentar\(/);
  assert.match(reintentar, /toast\.warning\(AVISO_REINTENTO_VENCIDO/);
  assert.match(reintentar, /nueva \? \{ clave, intentoDeEnvioEn: null \}/);
});

// --- Candados de la foto rapida (Tarea A) ---

await prueba("las rutas de la foto miden sus pasos (Server-Timing y [timing])", () => {
  for (const [archivo, log] of [
    ["src/app/api/cliente/chats/upload-media/route.ts", "chats/upload-media"],
    ["src/app/api/cliente/chats/upload-media/chunk/route.ts", "chats/upload-media/chunk"],
    ["src/app/api/cliente/chats/enviar-archivo/route.ts", "chats/enviar-archivo"],
  ]) {
    const texto = leer(archivo);
    assert.match(texto, /export const POST = conServerTiming\(/, archivo);
    assert.ok(texto.includes(`{ log: "${log}" }`), `${archivo} sin linea [timing]`);
  }
  for (const archivo of ["src/app/api/cliente/chats/upload-media/route.ts", "src/app/api/cliente/chats/upload-media/chunk/route.ts"]) {
    const texto = leer(archivo);
    for (const paso of ["auth", "cuerpo", "disco"]) assert.ok(texto.includes(`t.marca("${paso}")`), `${archivo} sin paso ${paso}`);
  }
  const accion = cuerpoDe(leer("src/app/actions/agent-actions.ts"), "async function enviarArchivoDelChat(");
  for (const paso of ["sesion", "datos", "whatsapp", "guardado", "postEnvio"]) {
    assert.ok(accion.includes(`marca("${paso}")`), `enviarArchivoDelChat sin paso ${paso}`);
  }
  assert.match(leer("src/lib/chats/atender-ruta-de-envio.ts"), /anotarLlamadaExterna\(`ruta_\$\{paso\}`/);
});

await prueba("cada pedazo ya no hace el permiso sin cache ni getPrimaryWorkspaceForUser", () => {
  for (const archivo of [
    "src/app/api/cliente/chats/upload-media/route.ts",
    "src/app/api/cliente/chats/upload-media/chunk/route.ts",
    "src/lib/chats/atender-ruta-de-envio.ts",
  ]) {
    const texto = leer(archivo);
    assert.match(texto, /getClientWorkspaceAccessForUserCached\(/, archivo);
    assert.doesNotMatch(texto, /getClientWorkspaceAccessForUser\(/, archivo);
    assert.doesNotMatch(texto, /getPrimaryWorkspaceForUser\(|from "@\/lib\/workspace"/, archivo);
  }
});

await prueba("enviar el archivo: controles a la vez, etiquetas y dueño del chat despues de responder", () => {
  const accion = cuerpoDe(leer("src/app/actions/agent-actions.ts"), "async function enviarArchivoDelChat(");
  const controles = accion.slice(accion.indexOf("await Promise.all(["), accion.indexOf('marca("datos")'));
  for (const control of ["estaEnModoMonitoreo(", "prisma.conversation.findFirst(", "prisma.message.findFirst(", "stat(filePath)"]) {
    assert.ok(controles.includes(control), `${control} ya no va junto con los otros controles`);
  }
  // El modo monitoreo sigue cortando ANTES de hablar con WhatsApp.
  assert.ok(accion.indexOf("if (enMonitoreo)") < accion.indexOf("sendEvolutionMediaUrl("));
  const despues = accion.slice(accion.indexOf("after(async () => {"));
  assert.match(despues, /syncLeadLifecycleForContact\(/);
  assert.match(despues, /claimConversationIfUnassigned\(/);
  // La pausa de la IA se sigue esperando (que el bot no conteste encima de la asesora).
  const antes = accion.slice(0, accion.indexOf("after(async () => {"));
  assert.match(antes, /setConversationAutomationPaused\(/);
  assert.doesNotMatch(antes, /await syncLeadLifecycleForContact\(/);
  assert.match(accion, /contenidoParaWaha,/);
});

await prueba("la foto achicada sube en un solo pedido; lo demas sigue en pedazos de 512 KB", () => {
  const panel = leer("src/components/chats/chat-conversation-panel.tsx");
  assert.match(panel, /const TROZO_DE_FOTO_ACHICADA_BYTES = 1024 \* 1024;/);
  assert.match(panel, /foto\.tipo === "IMAGE" && archivo\.size <= TROZO_DE_FOTO_ACHICADA_BYTES \? \{ tamanoTrozo: TROZO_DE_FOTO_ACHICADA_BYTES \}/);
  assert.match(leer("src/lib/subir-archivo-por-pedazos.ts"), /const TAMANO_TROZO = 512 \* 1024;/);
  assert.match(leer("src/lib/comprimir-foto.ts"), /export const PESO_ACEPTABLE_BYTES = 900 \* 1024;/);
});

await prueba("que no se manda nada: esta prueba no importa Prisma, gateways ni acciones", () => {
  const yo = leer("scripts/check-plazo-de-envio.mjs");
  for (const [, modulo] of yo.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)"/gm)) {
    assert.doesNotMatch(modulo, /prisma|evolution|waha|official-api|gateway|actions|^@\//i, modulo);
  }
});

console.log(`\n${pruebas} pruebas ok`);
