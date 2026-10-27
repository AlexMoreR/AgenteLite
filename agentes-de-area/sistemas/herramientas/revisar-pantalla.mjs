// REVISAR UNA PANTALLA DE PRODUCCIÓN (Agente de Sistemas). SOLO LECTURA.
//
//   node herramientas/revisar-pantalla.mjs --url https://app.aizenbot.com/cliente/direccion/pauta [--sesion sesion.json] [--esperar-ms 4000]
//
// Abre la pantalla con un navegador sin ventana (Playwright, el mismo que usan las pruebas del repo) y anota tres cosas:
// si respondió bien, los errores de la consola y las respuestas 500. Imprime un JSON con el resultado:
//   FUNCIONA | FALLA (con el error exacto) | NO_SE_PUEDE_PROBAR (con el porqué).
//
// CUATRO CANDADOS (el agente no puede quitarlos, están aquí y no en su prompt):
//   1. Bloquea todo pedido que no sea de lectura (POST, PUT, PATCH, DELETE): el pedido NO sale. Una ruta que lo necesita
//      para cargar queda como NO_SE_PUEDE_PROBAR.
//   2. Bloquea el latido de la app (/api/cliente/actividad/latido): así la cuenta no aparece "Recibiendo clientes" ni le caen leads.
//   3. Nunca hace clic, ni escribe, ni manda formularios: solo navega y espera.
//   4. Nunca abre un chat puntual: si la ruta es de un chat (/cliente/chats/<id>), abre solo la bandeja (/cliente/chats).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CARPETA = path.dirname(fileURLToPath(import.meta.url));

/** Métodos que no escriben. Todo lo demás se bloquea. */
const METODOS_DE_LECTURA = new Set(["GET", "HEAD", "OPTIONS"]);
const RUTA_DEL_LATIDO = /\/api\/cliente\/actividad\/latido/;
const CHAT_PUNTUAL = /^\/cliente\/chats\/[^/]+/;

/** ¿Deja salir este pedido? Puro: es lo que prueba probar-agente-de-sistemas.mjs. */
export function decidirPedido(metodo, url) {
  if (RUTA_DEL_LATIDO.test(url)) return { sale: false, motivo: "latido" };
  if (!METODOS_DE_LECTURA.has(String(metodo).toUpperCase())) return { sale: false, motivo: "escritura" };
  return { sale: true, motivo: null };
}

/** La dirección que de verdad se abre: un chat puntual se cambia por la bandeja. */
export function direccionPermitida(entrada, base) {
  let url;
  try {
    url = new URL(entrada);
  } catch {
    return { ok: false, motivo: "la dirección no es válida" };
  }
  if (base && url.origin !== new URL(base).origin) return { ok: false, motivo: `solo se revisan pantallas de ${new URL(base).origin}` };
  if (CHAT_PUNTUAL.test(url.pathname)) {
    url.pathname = "/cliente/chats";
    url.search = "";
    return { ok: true, url: url.toString(), nota: "era un chat puntual: se abrió solo la bandeja" };
  }
  return { ok: true, url: url.toString(), nota: null };
}

async function cargarPlaywright() {
  const requerir = createRequire(path.join(CARPETA, "../../../package.json"));
  for (const nombre of ["@playwright/test", "playwright"]) {
    try {
      const modulo = requerir(nombre);
      if (modulo?.chromium) return modulo;
    } catch {
      // Se prueba el siguiente.
    }
  }
  throw new Error("no encuentro Playwright: correr npm ci en la carpeta del repo");
}

/**
 * Abre `entrada` en solo lectura. `lanzar` se puede cambiar en las pruebas.
 * Devuelve { estado, url, http, motivo, erroresConsola, respuestas500, pedidosBloqueados, nota }.
 */
export async function revisarPantalla({ url: entrada, base = null, sesion = null, esperarMs = 4000, lanzar = null }) {
  const permitida = direccionPermitida(entrada, base);
  if (!permitida.ok) return { estado: "NO_SE_PUEDE_PROBAR", url: entrada, motivo: permitida.motivo };
  const resultado = { estado: "FUNCIONA", url: permitida.url, http: null, motivo: null, erroresConsola: [], respuestas500: [], pedidosBloqueados: [], nota: permitida.nota };

  let navegador;
  try {
    const abrir = lanzar ?? (async () => (await cargarPlaywright()).chromium.launch());
    navegador = await abrir();
  } catch (error) {
    return { ...resultado, estado: "NO_SE_PUEDE_PROBAR", motivo: `no se pudo abrir el navegador: ${error.message}` };
  }
  try {
    const contexto = await navegador.newContext(sesion && fs.existsSync(sesion) ? { storageState: sesion } : {});
    const pagina = await contexto.newPage();

    // Candados 1 y 2: lo que no es lectura (y el latido) no sale.
    await pagina.route("**/*", (ruta) => {
      const pedido = ruta.request();
      const decision = decidirPedido(pedido.method(), pedido.url());
      if (decision.sale) return ruta.continue();
      resultado.pedidosBloqueados.push({ metodo: pedido.method(), url: pedido.url(), motivo: decision.motivo });
      return ruta.abort("blockedbyclient");
    });
    pagina.on("console", (mensaje) => {
      if (mensaje.type() === "error") resultado.erroresConsola.push(mensaje.text().slice(0, 500));
    });
    pagina.on("pageerror", (error) => resultado.erroresConsola.push(`error de la página: ${String(error?.message ?? error).slice(0, 500)}`));
    pagina.on("response", (respuesta) => {
      if (respuesta.status() >= 500) resultado.respuestas500.push(`${respuesta.status()} ${respuesta.request().method()} ${respuesta.url()}`);
    });

    // Candado 3: solo navega y espera. No hay ningún clic en este archivo.
    const respuesta = await pagina.goto(permitida.url, { waitUntil: "load", timeout: 30_000 }).catch((error) => {
      resultado.motivo = `no cargó: ${error.message.split("\n")[0]}`;
      return null;
    });
    await pagina.waitForTimeout(esperarMs);
    resultado.http = respuesta ? respuesta.status() : null;
    const final = new URL(pagina.url());

    // Los errores de los pedidos que NOSOTROS bloqueamos no son de la pantalla.
    const bloqueadas = resultado.pedidosBloqueados.map((p) => p.url);
    resultado.erroresConsola = resultado.erroresConsola.filter((texto) => !bloqueadas.some((u) => texto.includes(u)) && !/blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(texto));
    const escrituras = resultado.pedidosBloqueados.filter((p) => p.motivo === "escritura");

    if (!respuesta) {
      resultado.estado = "FALLA";
    } else if (/^\/(login|iniciar-sesion|signin)/.test(final.pathname) && !/\/(login|iniciar-sesion|signin)/.test(new URL(permitida.url).pathname)) {
      resultado.estado = "NO_SE_PUEDE_PROBAR";
      resultado.motivo = "pide iniciar sesión: falta la sesión guardada (--sesion) de una cuenta de solo lectura";
    } else if (resultado.http >= 400) {
      resultado.estado = "FALLA";
      resultado.motivo = `HTTP ${resultado.http} en ${permitida.url}`;
    } else if (resultado.respuestas500.length) {
      resultado.estado = "FALLA";
      resultado.motivo = `respuesta 500: ${resultado.respuestas500[0]}`;
    } else if (escrituras.length) {
      // Candado 1: la ruta pide escribir para cargar. No se prueba (ni se deja salir el pedido).
      resultado.estado = "NO_SE_PUEDE_PROBAR";
      resultado.motivo = `pide un ${escrituras[0].metodo} para cargar (${escrituras[0].url}): solo se prueba escribiendo datos`;
    } else if (resultado.erroresConsola.length) {
      resultado.estado = "FALLA";
      resultado.motivo = `error en la consola: ${resultado.erroresConsola[0]}`;
    }
  } finally {
    await navegador.close().catch(() => {});
  }
  return resultado;
}

/* ──────────────────────────────────────────────────────────────── desde la línea de comandos ── */

function leerArgumentos(argv) {
  const salida = { url: null, base: null, sesion: null, esperarMs: 4000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--url") salida.url = argv[++i];
    else if (argv[i] === "--base") salida.base = argv[++i];
    else if (argv[i] === "--sesion") salida.sesion = argv[++i];
    else if (argv[i] === "--esperar-ms") salida.esperarMs = Number(argv[++i]) || 4000;
  }
  return salida;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (!opciones.url) {
    console.error("Uso: node herramientas/revisar-pantalla.mjs --url <pantalla de producción> [--base https://app.aizenbot.com] [--sesion sesion.json]");
    process.exit(2);
  }
  const resultado = await revisarPantalla(opciones);
  console.log(JSON.stringify(resultado, null, 2));
  process.exit(0);
}
