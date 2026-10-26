// Pruebas del candado y de las herramientas del Agente de Sistemas (solo lectura), sin red y sin producción.
//   npm run test:agente-de-sistemas-candado
//
// - revisar-pantalla.mjs contra un servidor de mentira: una ruta con 500 o con error en la consola da FALLA con el
//   error exacto; una ruta que pide un POST al cargar queda NO_SE_PUEDE_PROBAR y el POST NO sale; el latido nunca sale.
// - leer-servidor.mjs rechaza cualquier comando fuera de su lista (sin abrir ssh).
// - Las listas de permisos no tienen aprobar, cambiar estado, editar, borrar, WhatsApp, git, gh ni npm.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SISTEMAS = path.join(RAIZ, "agentes-de-area", "sistemas");
const { revisarPantalla, decidirPedido, direccionPermitida } = await import("../sistemas/herramientas/revisar-pantalla.mjs");
const { armarComandoRemoto, leerServidor, LISTA } = await import("../sistemas/herramientas/leer-servidor.mjs");
const { evaluarSalud } = await import("../sistemas/herramientas/salud-de-aizen1.mjs");
const { BASH_DE_SISTEMAS, PROHIBIDAS_DE_SISTEMAS, CRM_LECTURA_DE_SISTEMAS, CEREBRO_DEL_AREA, PROHIBIDAS_DEL_CEREBRO_GENERAL } = await import("../correr-agente.mjs");

let pruebas = 0;
const fallas = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

/* ───────────────────────────────────────────── el servidor de mentira ── */
const recibidos = { escrituras: [], latidos: [] };
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.url.startsWith("/api/cliente/actividad/latido")) recibidos.latidos.push(req.method);
  else if (req.method !== "GET") recibidos.escrituras.push(`${req.method} ${req.url}`);
  const html = (cuerpo) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>t</title><body>${cuerpo}</body>`);
  };
  switch (url.pathname) {
    case "/cliente/ok":
      return html('<h1>Pantalla sana</h1><script>fetch("/api/dato").then(()=>{})</script>');
    case "/api/dato":
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{}");
    case "/cliente/rota":
      res.writeHead(500, { "content-type": "text/html" });
      return res.end("<h1>Error interno: boom</h1>");
    case "/cliente/api-500":
      return html('<script>fetch("/api/rota")</script>');
    case "/api/rota":
      res.writeHead(500);
      return res.end("boom");
    case "/cliente/consola":
      return html('<script>console.error("TypeError: x is undefined en Pauta")</script>');
    case "/cliente/pide-post":
      return html('<script>fetch("/api/crear",{method:"POST",body:"{}"}).catch(()=>{})</script>');
    case "/cliente/latido":
      return html('<script>fetch("/api/cliente/actividad/latido",{method:"POST",body:"{}"}).catch(()=>{});setInterval(()=>fetch("/api/cliente/actividad/latido",{method:"POST"}).catch(()=>{}),200)</script>');
    case "/cliente/chats":
      return html("<h1>Bandeja</h1>");
    case "/cliente/chats/abc123":
      return html("<h1>Chat de un cliente</h1>");
    case "/login":
      return html("<h1>Entrar</h1>");
    case "/cliente/privada":
      res.writeHead(302, { location: "/login" });
      return res.end();
    default:
      res.writeHead(404);
      return res.end("no existe");
  }
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;
const abrir = (ruta, extra = {}) => revisarPantalla({ url: `${BASE}${ruta}`, base: BASE, esperarMs: 600, ...extra });

await prueba("una pantalla sana da FUNCIONA y sus pedidos de lectura salen", async () => {
  const r = await abrir("/cliente/ok");
  assert.equal(r.estado, "FUNCIONA", JSON.stringify(r));
  assert.equal(r.http, 200);
  assert.deepEqual(r.erroresConsola, []);
});

await prueba("una ruta que devuelve 500 da FALLA con el error exacto; una ruta que no existe, también", async () => {
  const r = await abrir("/cliente/rota");
  assert.equal(r.estado, "FALLA");
  assert.equal(r.http, 500);
  assert.match(r.motivo, /HTTP 500 en .*\/cliente\/rota/);
  const ausente = await abrir("/cliente/ruta-de-prueba-rota");
  assert.equal(ausente.estado, "FALLA");
  assert.match(ausente.motivo, /HTTP 404/);
});

await prueba("un 500 de un pedido que hace la pantalla da FALLA con la dirección exacta", async () => {
  const r = await abrir("/cliente/api-500");
  assert.equal(r.estado, "FALLA");
  assert.match(r.motivo, /respuesta 500: 500 GET .*\/api\/rota/);
});

await prueba("un error en la consola da FALLA con el texto exacto", async () => {
  const r = await abrir("/cliente/consola");
  assert.equal(r.estado, "FALLA");
  assert.equal(r.motivo, "error en la consola: TypeError: x is undefined en Pauta");
});

await prueba("una ruta que pide un POST para cargar: el POST NO sale y queda NO_SE_PUEDE_PROBAR", async () => {
  const antes = recibidos.escrituras.length;
  const r = await abrir("/cliente/pide-post");
  assert.equal(r.estado, "NO_SE_PUEDE_PROBAR");
  assert.match(r.motivo, /pide un POST para cargar/);
  assert.equal(recibidos.escrituras.length, antes, "el servidor nunca recibió el POST");
  assert.equal(r.pedidosBloqueados[0].metodo, "POST");
});

await prueba("el latido nunca sale (ni una sola vez) y no cuenta como falla", async () => {
  const r = await abrir("/cliente/latido");
  assert.deepEqual(recibidos.latidos, [], "el servidor nunca recibió un latido");
  assert.ok(r.pedidosBloqueados.length >= 1 && r.pedidosBloqueados.every((p) => p.motivo === "latido"));
  assert.equal(r.estado, "FUNCIONA", JSON.stringify(r));
});

await prueba("nunca abre un chat puntual: abre solo la bandeja", async () => {
  const r = await abrir("/cliente/chats/abc123");
  assert.equal(r.estado, "FUNCIONA");
  assert.equal(new URL(r.url).pathname, "/cliente/chats");
  assert.match(r.nota, /chat puntual/);
  assert.equal(direccionPermitida("https://app.aizenbot.com/cliente/chats/xyz?a=1", "https://app.aizenbot.com").url, "https://app.aizenbot.com/cliente/chats");
});

await prueba("pide iniciar sesión → NO_SE_PUEDE_PROBAR; otro dominio o dirección rara → no se abre", async () => {
  const r = await abrir("/cliente/privada");
  assert.equal(r.estado, "NO_SE_PUEDE_PROBAR");
  assert.match(r.motivo, /iniciar sesión/);
  const otro = await revisarPantalla({ url: "https://otro-sitio.com/cliente/x", base: BASE });
  assert.equal(otro.estado, "NO_SE_PUEDE_PROBAR");
  assert.equal((await revisarPantalla({ url: "no es una url", base: BASE })).estado, "NO_SE_PUEDE_PROBAR");
});

await prueba("decidirPedido: solo lectura sale; POST, PUT, PATCH, DELETE y el latido no", () => {
  for (const m of ["GET", "HEAD", "OPTIONS", "get"]) assert.equal(decidirPedido(m, "https://x/api/a").sale, true, m);
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) assert.equal(decidirPedido(m, "https://x/api/a").sale, false, m);
  assert.equal(decidirPedido("GET", "https://x/api/cliente/actividad/latido").sale, false);
  assert.equal(decidirPedido("POST", "https://x/api/cliente/actividad/latido").motivo, "latido");
});

await prueba("revisar-pantalla.mjs no tiene ningún clic ni escritura en el navegador", () => {
  const codigo = fs.readFileSync(path.join(SISTEMAS, "herramientas", "revisar-pantalla.mjs"), "utf8").replace(/\/\/.*$/gm, "");
  for (const peligroso of [".click(", ".fill(", ".press(", ".check(", ".dblclick(", ".setInputFiles(", ".dispatchEvent(", ".submit("]) {
    assert.ok(!codigo.includes(peligroso), `no debe usar ${peligroso}`);
  }
  assert.ok(!/\.type\([^)]/.test(codigo), "no debe teclear (.type con texto)");
});

servidor.close();

/* ───────────────────────────────────────────── leer-servidor.mjs ── */
const configServidor = { destino: "trabajador@vps", contenedor: "crm-app", urlInicio: "https://app.aizenbot.com" };

await prueba("leer-servidor rechaza cualquier comando fuera de su lista, sin abrir ssh", async () => {
  let abiertas = 0;
  const correr = async () => { abiertas += 1; return { codigo: 0, salida: "", errores: "" }; };
  for (const intruso of ["rm", "bash", "docker restart", "cat /etc/passwd", "psql", "constructor", "__proto__", "toString"]) {
    await assert.rejects(() => leerServidor(intruso, {}, configServidor, correr), /comando no permitido/, intruso);
  }
  assert.equal(abiertas, 0, "ssh no se abrió");
  assert.deepEqual(Object.keys(LISTA).sort(), ["disco", "inicio", "logs", "uptime"]);
});

await prueba("leer-servidor: la ruta no puede traer comandos; los valores de la configuración se validan", async () => {
  for (const mala of ["/cliente; rm -rf /", "/x$(id)", "/a b", "/a|b", "/a&&b", "`id`", "/a\nb", "", "x".repeat(200)]) {
    assert.throws(() => armarComandoRemoto("logs", { ruta: mala, horas: 24 }, configServidor), /ruta/, JSON.stringify(mala));
  }
  assert.throws(() => armarComandoRemoto("logs", { ruta: "/cliente/x" }, { ...configServidor, contenedor: "a; rm -rf /" }), /contenedor/);
  assert.throws(() => armarComandoRemoto("inicio", {}, { ...configServidor, urlInicio: "https://x.com; reboot" }), /urlInicio/);
  const ok = armarComandoRemoto("logs", { ruta: "/cliente/crm/pauta", horas: 999 }, configServidor);
  assert.equal(ok, "docker logs --since 48h crm-app 2>&1 | grep -F -- /cliente/crm/pauta | tail -n 200", "tope de 48 horas");
  for (const que of ["disco", "uptime", "inicio"]) assert.doesNotMatch(armarComandoRemoto(que, {}, configServidor), /rm |reboot|restart|stop|kill|>|;/);
});

await prueba("leer-servidor entrega la salida del comando permitido", async () => {
  const llamadas = [];
  const r = await leerServidor("disco", {}, configServidor, async (config, remoto) => { llamadas.push(remoto); return { codigo: 0, salida: "/dev/sda1 20G 5G 15G 25% /", errores: "" }; });
  assert.equal(r.ok, true);
  assert.deepEqual(llamadas, ["df -h --output=source,size,used,avail,pcent,target"]);
  const sinLineas = await leerServidor("logs", { ruta: "/cliente/x" }, configServidor, async () => ({ codigo: 1, salida: "", errores: "" }));
  assert.equal(sinLineas.ok, true, "grep sin coincidencias no es un error");
});

await prueba("salud de aizen1: disco casi lleno, RAM o CPU altas quedan en 'atencion'", () => {
  assert.equal(evaluarSalud({ discoLibrePorciento: 40, ramUsadaPorciento: 50, cpuPorciento: 10 }).estado, "ok");
  const mal = evaluarSalud({ discoLibrePorciento: 4, ramUsadaPorciento: 95, cpuPorciento: 97 });
  assert.equal(mal.estado, "atencion");
  assert.equal(mal.atencion.length, 3);
});

/* ───────────────────────────────────────────── la lista de permisos ── */
const PROHIBIDO_ABSOLUTO = ["aprobar_tarjeta", "cambiar_estado_tarjeta", "editar_tarjeta", "borrar_tarjeta", "mandar_whatsapp_al_equipo", "git", "gh", "npm"];

await prueba("la lista de permisos (settings.json y lanzador) no tiene aprobar, cambiar estado, editar, borrar, WhatsApp, git, gh ni npm", () => {
  const ajustes = JSON.parse(fs.readFileSync(path.join(SISTEMAS, ".claude", "settings.json"), "utf8"));
  const permitidas = [...ajustes.permissions.allow, ...BASH_DE_SISTEMAS, ...CRM_LECTURA_DE_SISTEMAS];
  for (const x of permitidas) {
    for (const mal of PROHIBIDO_ABSOLUTO) assert.ok(!new RegExp(`(^|[_(:])${mal}([_):]|$)`).test(x) || /prohibid/.test(x), `${x} contiene ${mal}`);
    assert.notEqual(x, "Bash", "Bash libre");
    assert.notEqual(x, "Edit");
    assert.ok(!x.endsWith("crear_tarjeta"), "crear_tarjeta solo la agrega el lanzador con el interruptor prendido");
  }
  const negadas = ajustes.permissions.deny.join(" ");
  for (const nombre of ["aprobar_tarjeta", "cambiar_estado_tarjeta", "editar_tarjeta", "borrar_tarjeta", "mandar_whatsapp_al_equipo", "Bash(git", "Bash(gh", "Bash(npm", "Edit"]) {
    assert.ok(negadas.includes(nombre), `settings.json tiene que negar ${nombre}`);
  }
  assert.deepEqual([...ajustes.permissions.deny].sort(), [...PROHIBIDAS_DE_SISTEMAS].sort(), "settings.json y el lanzador niegan lo mismo");
  assert.deepEqual(BASH_DE_SISTEMAS.map((b) => b.match(/herramientas\/([\w-]+\.mjs)/)[1]).sort(), ["leer-servidor.mjs", "revisar-pantalla.mjs", "salud-de-aizen1.mjs"]);
});

await prueba("el cerebro: settings.json permite las 3 herramientas del área y niega las 4 generales (igual que el lanzador)", () => {
  const ajustes = JSON.parse(fs.readFileSync(path.join(SISTEMAS, ".claude", "settings.json"), "utf8"));
  for (const x of CEREBRO_DEL_AREA) assert.ok(ajustes.permissions.allow.includes(x), `permitida: ${x}`);
  for (const x of PROHIBIDAS_DEL_CEREBRO_GENERAL) {
    assert.ok(ajustes.permissions.deny.includes(x) && !ajustes.permissions.allow.includes(x), `prohibida: ${x}`);
    assert.ok(PROHIBIDAS_DE_SISTEMAS.includes(x), `el lanzador la prohíbe: ${x}`);
  }
});

await prueba("el CLAUDE.md del agente y sus 3 prompts existen con su frecuencia", () => {
  const frecuencia = (nombre) => fs.readFileSync(path.join(SISTEMAS, "subagentes", nombre, "PROMPT.md"), "utf8").match(/^Frecuencia:\s*(\S+)/im)?.[1];
  assert.equal(frecuencia("revisor-de-produccion"), "diario");
  assert.equal(frecuencia("salud-del-sistema"), "diario");
  assert.equal(frecuencia("uso"), "lunes");
  const claude = fs.readFileSync(path.join(SISTEMAS, "CLAUDE.md"), "utf8");
  for (const clave of ["Sistemas: todo funciona", "[sistemas:", "POR_APROBAR", "SOLO LECTURA", "Nunca apruebas tarjetas"]) assert.ok(claude.includes(clave), clave);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log(`Fallaron: ${fallas.join("; ")}`);
  process.exit(1);
}
