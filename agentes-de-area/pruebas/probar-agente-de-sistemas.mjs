// Pruebas del candado y de las herramientas del Agente de Sistemas, contra un servidor de mentira (sin red, sin base):
//   npm run test:agente-de-sistemas-candado
// Comprueba que revisar-pantalla.mjs nunca deja salir un pedido que escriba ni el latido, que marca FALLA con el error
// exacto, que leer-servidor.mjs rechaza todo comando fuera de su lista y que la lista de permisos no tiene nada que escriba.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CARPETA = path.join(RAIZ, "agentes-de-area");
const { chromium } = await import("playwright");
const { revisarPantalla, decidirResultado, direccionSegura, esPedidoDeLectura, esLatido } = await import("../sistemas/herramientas/revisar-pantalla.mjs");
const { armarComandoRemoto, leerServidor, COMANDOS } = await import("../sistemas/herramientas/leer-servidor.mjs");
const { evaluarSalud } = await import("../sistemas/herramientas/salud-de-aizen1.mjs");
const candado = await import("../lib/candado-sistemas.mjs");

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

/* ───────────────────────────────────────────────────── el servidor de mentira ── */
const recibidos = [];
const servidor = http.createServer((pedido, respuesta) => {
  recibidos.push(`${pedido.method} ${pedido.url}`);
  const html = (cuerpo, estado = 200) => {
    respuesta.writeHead(estado, { "Content-Type": "text/html; charset=utf-8" });
    respuesta.end(`<!doctype html><html><body>${cuerpo}</body></html>`);
  };
  if (pedido.url === "/cliente/ok") return html("<h1>Hola</h1><script>fetch('/api/datos').then(r=>r.json())</script>");
  if (pedido.url === "/api/datos") {
    respuesta.writeHead(200, { "Content-Type": "application/json" });
    return respuesta.end("{}");
  }
  if (pedido.url === "/cliente/ruta-rota") return html("Error interno", 500);
  if (pedido.url === "/cliente/no-existe") return html("No encontrada", 404);
  if (pedido.url === "/cliente/consola") return html("<script>console.error('TypeError: no se puede leer x de undefined')</script>");
  if (pedido.url === "/cliente/api-500") return html("<script>fetch('/api/rota').then(()=>{})</script>");
  if (pedido.url === "/api/rota") {
    respuesta.writeHead(500);
    return respuesta.end("boom");
  }
  if (pedido.url === "/cliente/pide-post") return html("<script>fetch('/api/crear',{method:'POST',body:'{}'}).catch(()=>{});</script>");
  if (pedido.url === "/cliente/con-latido") return html("<script>fetch('/api/cliente/actividad/latido',{method:'POST',body:'{}'}).catch(()=>{});</script>");
  if (pedido.url.startsWith("/cliente/chats")) return html("<h1>Bandeja</h1>");
  respuesta.writeHead(404);
  respuesta.end();
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${servidor.address().port}`;
const revisar = (ruta, extra = {}) => revisarPantalla({ url: `${base}${ruta}`, esperarMs: 300, ...extra });

/* ───────────────────────────────────────────────────── revisar-pantalla.mjs ── */
await prueba("una pantalla sana da FUNCIONA y solo hace pedidos de lectura", async () => {
  recibidos.length = 0;
  const r = await revisar("/cliente/ok");
  assert.equal(r.resultado, "FUNCIONA");
  assert.equal(r.estadoHttp, 200);
  assert.ok(recibidos.every((x) => x.startsWith("GET ")), recibidos.join(","));
});

await prueba("una ruta que devuelve 500 da FALLA con el error exacto", async () => {
  const r = await revisar("/cliente/ruta-rota");
  assert.equal(r.resultado, "FALLA");
  assert.match(r.detalle, /HTTP 500/);
});

await prueba("una ruta que no existe (404) da FALLA con el HTTP", async () => {
  const r = await revisar("/cliente/no-existe");
  assert.equal(r.resultado, "FALLA");
  assert.match(r.detalle, /HTTP 404/);
});

await prueba("un error en la consola da FALLA con el texto exacto", async () => {
  const r = await revisar("/cliente/consola");
  assert.equal(r.resultado, "FALLA");
  assert.match(r.detalle, /Consola: TypeError: no se puede leer x de undefined/);
});

await prueba("una respuesta 500 de apoyo (un API que se pide al cargar) da FALLA", async () => {
  const r = await revisar("/cliente/api-500");
  assert.equal(r.resultado, "FALLA");
  assert.match(r.detalle, /HTTP 500 en .*\/api\/rota/);
});

await prueba("una ruta que pide un POST al cargar: el POST NO sale y queda NO_SE_PUEDE_PROBAR", async () => {
  recibidos.length = 0;
  const r = await revisar("/cliente/pide-post");
  assert.equal(r.resultado, "NO_SE_PUEDE_PROBAR");
  assert.match(r.detalle, /pide escribir al cargar/);
  assert.ok(!recibidos.some((x) => x.startsWith("POST ")), `el servidor recibió: ${recibidos.join(",")}`);
  assert.equal(r.bloqueados[0].metodo, "POST");
});

await prueba("el latido NUNCA sale (así la cuenta no aparece 'Recibiendo clientes')", async () => {
  recibidos.length = 0;
  const r = await revisar("/cliente/con-latido");
  assert.ok(!recibidos.some((x) => x.includes("/api/cliente/actividad/latido")), `el servidor recibió: ${recibidos.join(",")}`);
  assert.ok(r.bloqueados.some((b) => b.motivo === "latido"));
});

await prueba("nunca abre un chat puntual: solo la bandeja", async () => {
  recibidos.length = 0;
  const r = await revisar("/cliente/chats/cmabc123?x=1");
  assert.equal(r.url, `${base}/cliente/chats`);
  assert.match(r.aviso, /chat puntual/);
  assert.ok(!recibidos.some((x) => x.includes("cmabc123")), recibidos.join(","));
  assert.equal(direccionSegura("https://x.com/cliente/crm/tablero").cambiada, false);
});

await prueba("un servidor que no es de producción permitida no se abre", async () => {
  recibidos.length = 0;
  const r = await revisar("/cliente/ok", { hostsPermitidos: ["app.aizenbot.com"] });
  assert.equal(r.resultado, "NO_SE_PUEDE_PROBAR");
  assert.equal(recibidos.length, 0);
});

await prueba("el programa nunca hace clic ni escribe (no usa click, fill, teclado, mouse, press ni evaluate)", () => {
  const codigo = fs.readFileSync(path.join(CARPETA, "sistemas", "herramientas", "revisar-pantalla.mjs"), "utf8").replace(/\/\/.*$/gm, "");
  for (const metodo of [".click(", ".dblclick(", ".fill(", ".keyboard.", ".mouse.", ".press(", ".check(", ".selectOption(", ".setInputFiles(", ".evaluate(", ".tap("]) {
    assert.ok(!codigo.includes(metodo), `no debe usar ${metodo}`);
  }
});

await prueba("decidirResultado y esPedidoDeLectura: puras", () => {
  assert.ok(esPedidoDeLectura("get") && esPedidoDeLectura("HEAD") && !esPedidoDeLectura("POST") && !esPedidoDeLectura("PATCH") && !esPedidoDeLectura("DELETE") && !esPedidoDeLectura("PUT"));
  assert.ok(esLatido("https://app.aizenbot.com/api/cliente/actividad/latido") && !esLatido("https://app.aizenbot.com/cliente/crm"));
  assert.equal(decidirResultado({ estadoHttp: 200 }).resultado, "FUNCIONA");
  assert.equal(decidirResultado({ estadoHttp: null, errorDeCarga: "net::ERR_CONNECTION_REFUSED" }).resultado, "FALLA");
  // Escritura bloqueada + error de consola: puede ser consecuencia del bloqueo → no se acusa al código.
  assert.equal(decidirResultado({ estadoHttp: 200, erroresConsola: ["x"], bloqueados: [{ metodo: "POST", url: "u", motivo: "escritura" }] }).resultado, "NO_SE_PUEDE_PROBAR");
});

/* ───────────────────────────────────────────────────── leer-servidor.mjs ── */
const vps = { host: "10.0.0.5", usuario: "deploy", llave: "/llaves/trabajador", contenedor: "aizencrm-app", urlInicio: "https://app.aizenbot.com" };

await prueba("leer-servidor rechaza cualquier comando fuera de su lista (y no toca la red)", () => {
  let llamadas = 0;
  const correr = () => { llamadas += 1; return { status: 0, stdout: "", stderr: "" }; };
  for (const nombre of ["rm", "bash", "docker", "cat", "exec", "logs; rm -rf /", "constructor", "__proto__", "toString", ""]) {
    assert.throws(() => leerServidor(nombre, {}, vps, { correr }), /Comando no permitido/, nombre);
  }
  assert.equal(llamadas, 0, "ningún comando llegó a ssh");
  assert.deepEqual(Object.keys(COMANDOS).sort(), ["disco", "inicio", "logs", "uptime"]);
});

await prueba("leer-servidor: los argumentos peligrosos se rechazan antes de armar el comando", () => {
  for (const ruta of ["/cliente/x; rm -rf /", "/cliente/$(whoami)", "/cliente/x' && ls #", "cliente/sin-barra", "/cliente/`id`", "/a b"]) {
    assert.throws(() => armarComandoRemoto("logs", { ruta }, vps), /--ruta/, ruta);
  }
  assert.throws(() => armarComandoRemoto("logs", { ruta: "/cliente/x", horas: "24; ls" }, vps), /--horas/);
  assert.throws(() => armarComandoRemoto("logs", { ruta: "/cliente/x", horas: "500" }, vps), /--horas/);
  assert.throws(() => armarComandoRemoto("logs", { ruta: "/cliente/x" }, { ...vps, contenedor: "a; ls" }), /contenedor/);
  assert.throws(() => armarComandoRemoto("inicio", {}, { ...vps, urlInicio: "https://x.com; ls" }), /urlInicio/);
});

await prueba("leer-servidor: los comandos permitidos arman justo lo esperado, por ssh con la llave", () => {
  assert.equal(armarComandoRemoto("logs", { ruta: "/cliente/crm/tablero", horas: "24" }, vps), "docker logs --since 24h aizencrm-app 2>&1 | grep -F -- '/cliente/crm/tablero' | tail -n 200");
  assert.equal(armarComandoRemoto("disco", {}, vps), "df -h");
  assert.equal(armarComandoRemoto("uptime", {}, vps), "uptime");
  assert.match(armarComandoRemoto("inicio", {}, vps), /^curl -s -o \/dev\/null -m 15 -w '%\{http_code\}' https:\/\/app\.aizenbot\.com$/);
  let args;
  const r = leerServidor("uptime", {}, vps, { correr: (cmd, a) => { args = { cmd, a }; return { status: 0, stdout: "up 3 days", stderr: "" }; } });
  assert.equal(args.cmd, "ssh");
  assert.deepEqual(args.a.slice(0, 2), ["-i", "/llaves/trabajador"]);
  assert.equal(args.a.at(-1), "uptime");
  assert.equal(r.salida, "up 3 days");
});

/* ───────────────────────────────────────────────────── salud-de-aizen1.mjs ── */
await prueba("salud de aizen1: avisa disco casi lleno, RAM y CPU altas; sin alertas dice BIEN", () => {
  const GB = 1024 ** 3;
  const bien = evaluarSalud({ discoLibre: 100 * GB, discoTotal: 250 * GB, ramLibre: 8 * GB, ramTotal: 16 * GB, cpuPorCiento: 12 });
  assert.equal(bien.estado, "BIEN");
  const mal = evaluarSalud({ discoLibre: 5 * GB, discoTotal: 250 * GB, ramLibre: 1 * GB, ramTotal: 16 * GB, cpuPorCiento: 95, ultimoLogDelTrabajador: new Date("2026-10-27T05:00:00Z"), ahora: new Date("2026-10-27T06:00:00Z") });
  assert.equal(mal.estado, "CON_ALERTAS");
  assert.equal(mal.alertas.length, 3);
  assert.equal(mal.trabajador.haceMinutos, 60);
});

/* ───────────────────────────────────────────────────── el candado ── */
const FUERA = ["aprobar_tarjeta", "cambiar_estado_tarjeta", "editar_tarjeta", "borrar_tarjeta", "mandar_whatsapp_al_equipo", "crear_tarjeta"];

await prueba("la lista de permisos de .claude/settings.json no tiene herramientas que escriban, git, gh ni npm; crear_tarjeta está prohibida", () => {
  const ajustes = JSON.parse(fs.readFileSync(path.join(CARPETA, "sistemas", ".claude", "settings.json"), "utf8"));
  const permitidas = ajustes.permissions.allow;
  const prohibidas = ajustes.permissions.deny;
  for (const x of FUERA) {
    assert.ok(!permitidas.some((p) => p.includes(x)), `no permitida: ${x}`);
    assert.ok(prohibidas.includes(`mcp__aizencrm__${x}`), `prohibida: ${x}`);
  }
  for (const x of ["git", "gh", "npm"]) {
    assert.ok(!permitidas.some((p) => new RegExp(`^Bash\\(${x}\\b`).test(p)), `no permitida: ${x}`);
    assert.ok(prohibidas.includes(`Bash(${x}:*)`), `prohibida: ${x}`);
  }
  for (const x of ["Bash", "Write", "Edit"]) assert.ok(!permitidas.includes(x), `no permitida (sin restricción): ${x}`);
  // Las únicas consolas permitidas son los tres programas fijos.
  assert.deepEqual(permitidas.filter((p) => p.startsWith("Bash")).sort(), [...candado.PROGRAMAS_PERMITIDOS].sort());
});

await prueba(".claude/settings.json coincide con lib/candado-sistemas.mjs", () => {
  const ajustes = JSON.parse(fs.readFileSync(path.join(CARPETA, "sistemas", ".claude", "settings.json"), "utf8"));
  for (const x of [...candado.CRM_PERMITIDAS_SISTEMAS, ...candado.PROGRAMAS_PERMITIDOS]) assert.ok(ajustes.permissions.allow.includes(x), `falta en settings.json: ${x}`);
  for (const x of candado.PROHIBIDAS_DE_SISTEMAS) assert.ok(ajustes.permissions.deny.includes(x), `falta en deny de settings.json: ${x}`);
});

await prueba("las listas del candado no dejan pasar nada que escriba", () => {
  for (const x of FUERA) assert.ok(!candado.CRM_PERMITIDAS_SISTEMAS.some((p) => p.endsWith(`__${x}`)), x);
  // La única que escribe es guardar el resumen.
  const escritoras = candado.CRM_PERMITIDAS_SISTEMAS.filter((p) => /__(crear|editar|borrar|aprobar|cambiar|mandar|conectar|deshacer|guardar|renombrar)_/.test(p));
  assert.deepEqual(escritoras, ["mcp__aizencrm__guardar_resumen_del_dia"]);
});

await prueba("sistemas/CLAUDE.md dice los límites y la marca de la tarjeta de arreglo", () => {
  const texto = fs.readFileSync(path.join(CARPETA, "sistemas", "CLAUDE.md"), "utf8");
  for (const frase of ["SOLO LECTURA", "Nunca modificas código", "nunca haces deploy", "Nunca apruebas tarjetas", "Nunca tocas datos de clientes, ventas ni dinero", "Nunca le escribes a nadie", "[sistemas:<commit>]", "Sistemas: todo funciona", "POR_APROBAR"]) {
    assert.ok(texto.includes(frase), `falta: ${frase}`);
  }
  for (const sub of ["revisor-de-produccion", "salud-del-sistema", "uso"]) assert.ok(fs.existsSync(path.join(CARPETA, "sistemas", "subagentes", sub, "PROMPT.md")), sub);
  assert.match(fs.readFileSync(path.join(CARPETA, "sistemas", "subagentes", "uso", "PROMPT.md"), "utf8"), /^Frecuencia: lunes/m);
});

servidor.close();
console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:\n- " + fallas.join("\n- "));
  process.exit(1);
}
