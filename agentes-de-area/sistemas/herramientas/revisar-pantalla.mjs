// REVISAR UNA PANTALLA DE PRODUCCIÓN, SOLO LECTURA (Agente de Sistemas).
//
//   node herramientas/revisar-pantalla.mjs --url https://app.aizenbot.com/cliente/crm/tablero [--sesion sesion.json] [--esperar-ms 4000]
//
// Abre la pantalla con un navegador sin ventana (Playwright) y anota tres cosas: si respondió bien, los errores de la
// consola y las respuestas 500. Imprime un JSON con el resultado: FUNCIONA / FALLA (con el error exacto) / NO_SE_PUEDE_PROBAR.
//
// CUATRO CANDADOS (el navegador los cumple, no la buena voluntad del agente):
//  1. Bloquea todo pedido que no sea de lectura (POST, PUT, PATCH, DELETE): no sale a la red.
//  2. Bloquea el latido (/api/cliente/actividad/latido): así la cuenta no aparece "Recibiendo clientes" ni le caen leads.
//  3. Nunca hace clic (ni escribe ni navega por su cuenta): solo abre la dirección y mira.
//  4. Nunca abre un chat puntual: /cliente/chats/<id> se cambia por la bandeja /cliente/chats.
// La sesión del navegador (un archivo storageState de Playwright) vive solo en aizen1 y nunca se sube al repo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const METODOS_DE_LECTURA = new Set(["GET", "HEAD", "OPTIONS"]);
const LATIDO = /\/api\/cliente\/actividad\/latido(?:[/?#]|$)/;

/** ¿Este pedido es de lectura? Todo lo demás se bloquea. */
export const esPedidoDeLectura = (metodo) => METODOS_DE_LECTURA.has(String(metodo).toUpperCase());
export const esLatido = (url) => LATIDO.test(url);

/** Candado 4: un chat puntual se cambia por la bandeja. Devuelve la dirección a abrir y si se cambió. */
export function direccionSegura(direccion) {
  const url = new URL(direccion);
  if (/^\/cliente\/chats\/[^/]+/.test(url.pathname)) {
    const bandeja = new URL(url.toString());
    bandeja.pathname = "/cliente/chats";
    bandeja.search = "";
    bandeja.hash = "";
    return { url: bandeja.toString(), cambiada: true, aviso: "era un chat puntual: solo se abre la bandeja /cliente/chats" };
  }
  return { url: url.toString(), cambiada: false, aviso: null };
}

/**
 * Decide el resultado con lo que se vio (puro).
 *  - La pantalla misma contestó 4xx/5xx → FALLA (la ruta está rota).
 *  - Hubo pedidos de escritura bloqueados → NO_SE_PUEDE_PROBAR: la pantalla pide escribir para cargar y los errores
 *    que aparezcan pueden ser consecuencia del bloqueo, no del código.
 *  - Respuestas 500 o errores de consola → FALLA, con el error exacto.
 *  - Nada de lo anterior → FUNCIONA.
 */
export function decidirResultado({ estadoHttp, erroresConsola = [], respuestas500 = [], bloqueados = [], errorDeCarga = null }) {
  if (errorDeCarga) return { resultado: "FALLA", detalle: `No cargó: ${errorDeCarga}` };
  if (estadoHttp !== null && estadoHttp >= 400) return { resultado: "FALLA", detalle: `La pantalla respondió HTTP ${estadoHttp}` };
  const escrituras = bloqueados.filter((b) => b.motivo === "escritura");
  if (escrituras.length) {
    return {
      resultado: "NO_SE_PUEDE_PROBAR",
      detalle: `La pantalla pide escribir al cargar (${escrituras.map((b) => `${b.metodo} ${b.url}`).join("; ")}); se bloqueó para no tocar datos reales`,
    };
  }
  if (respuestas500.length || erroresConsola.length) {
    return { resultado: "FALLA", detalle: [...respuestas500.map((r) => `HTTP ${r.estado} en ${r.url}`), ...erroresConsola.map((e) => `Consola: ${e}`)].join(" | ").slice(0, 2000) };
  }
  return { resultado: "FUNCIONA", detalle: "Cargó sin errores en la consola ni respuestas 500" };
}

/** Abre la pantalla. `lanzador` se puede cambiar en las pruebas. */
export async function revisarPantalla({ url, sesion = null, esperarMs = 4000, hostsPermitidos = null, lanzador = null }) {
  const destino = direccionSegura(url);
  const host = new URL(destino.url).host;
  if (hostsPermitidos && !hostsPermitidos.includes(host)) {
    return { url: destino.url, resultado: "NO_SE_PUEDE_PROBAR", detalle: `El servidor ${host} no está en la lista de producción permitida`, erroresConsola: [], respuestas500: [], bloqueados: [] };
  }
  const { chromium } = lanzador ? { chromium: lanzador } : await import("playwright");
  const navegador = await chromium.launch();
  const erroresConsola = [];
  const respuestas500 = [];
  const bloqueados = [];
  let estadoHttp = null;
  let errorDeCarga = null;
  try {
    const contexto = await navegador.newContext(sesion && fs.existsSync(sesion) ? { storageState: sesion } : {});
    const pagina = await contexto.newPage();
    // Candados 1 y 2: todo pedido pasa por aquí.
    await pagina.route("**/*", (ruta) => {
      const pedido = ruta.request();
      if (esLatido(pedido.url())) {
        bloqueados.push({ metodo: pedido.method(), url: pedido.url(), motivo: "latido" });
        return ruta.abort();
      }
      if (!esPedidoDeLectura(pedido.method())) {
        bloqueados.push({ metodo: pedido.method(), url: pedido.url(), motivo: "escritura" });
        return ruta.abort();
      }
      return ruta.continue();
    });
    pagina.on("console", (mensaje) => {
      if (mensaje.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED/.test(mensaje.text())) erroresConsola.push(mensaje.text().slice(0, 500));
    });
    pagina.on("pageerror", (error) => erroresConsola.push(String(error.message).slice(0, 500)));
    pagina.on("response", (respuesta) => {
      if (respuesta.status() >= 500) respuestas500.push({ estado: respuesta.status(), url: respuesta.url() });
    });
    try {
      const respuesta = await pagina.goto(destino.url, { waitUntil: "load", timeout: 30_000 });
      estadoHttp = respuesta ? respuesta.status() : null;
      await pagina.waitForTimeout(esperarMs);
    } catch (error) {
      errorDeCarga = String(error.message ?? error).split("\n")[0];
    }
    await contexto.close();
  } finally {
    await navegador.close();
  }
  // Una respuesta 500 de la propia pantalla ya se cuenta por su estado.
  const solo500DeApoyo = respuestas500.filter((r) => r.url !== destino.url);
  const decision = decidirResultado({ estadoHttp, erroresConsola, respuestas500: solo500DeApoyo, bloqueados, errorDeCarga });
  return { url: destino.url, ...(destino.cambiada ? { aviso: destino.aviso } : {}), estadoHttp, ...decision, erroresConsola, respuestas500, bloqueados };
}

function leerArgumentos(argv) {
  const salida = { url: null, sesion: null, esperarMs: 4000, hosts: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--url") salida.url = argv[++i];
    else if (argv[i] === "--sesion") salida.sesion = path.resolve(argv[++i]);
    else if (argv[i] === "--esperar-ms") salida.esperarMs = Number(argv[++i]) || 4000;
    else if (argv[i] === "--hosts") salida.hosts = argv[++i].split(",").map((h) => h.trim()).filter(Boolean);
  }
  return salida;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (!opciones.url) {
    console.error("Falta --url <dirección de la pantalla de producción>");
    process.exit(2);
  }
  // La lista de servidores permitidos sale de la configuración (urlCrm y urlGestion), si se encuentra.
  let hosts = opciones.hosts;
  if (!hosts) {
    for (const candidato of [path.resolve("..", "config.local.json"), path.resolve("config.local.json")]) {
      if (!fs.existsSync(candidato)) continue;
      try {
        const config = JSON.parse(fs.readFileSync(candidato, "utf8").replace(/^﻿/, ""));
        hosts = [config.urlCrm, config.urlGestion].filter(Boolean).map((u) => new URL(u).host);
        break;
      } catch {
        // sin lista: se abre lo que pidan
      }
    }
  }
  const resultado = await revisarPantalla({ url: opciones.url, sesion: opciones.sesion, esperarMs: opciones.esperarMs, hostsPermitidos: hosts });
  console.log(JSON.stringify(resultado, null, 2));
}
