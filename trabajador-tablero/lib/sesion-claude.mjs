// LA PAUSA POR SESIÓN DE CLAUDE VENCIDA (24-nov-2026, parte 1 de 4): si se vence la sesión de Claude en aizen1 ("OAuth
// session expired and could not be refreshed"), cada tarjeta que se tome falla en cadena. Antes de tomar tarjetas el
// Coordinador mira `claude auth status`; si dice que no hay sesión, entra en "En pausa: sesión de Claude vencida", no toma
// nada y sigue mandando el latido. En pausa vuelve a mirar cada config.sesionClaude.revisarMinutos (3 por defecto) y sale
// sola cuando la sesión vuelve.
//
// Se arma igual que la pausa por uso (pausa-uso.mjs): este módulo solo decide y guarda el estado (en
// carpetaTrabajo/estado-sesion-claude.json, para que un reinicio del Coordinador siga en pausa). Quién deja de tomar es el
// planificador (bucle.mjs).
import fs from "node:fs";
import path from "node:path";

import { correr } from "./procesos.mjs";

/** Lo más que se espera a `claude auth status`. */
export const ESPERA_AUTH_STATUS_MS = 30_000;
/** Mientras hay trabajo, una revisión buena de hace menos de esto se reutiliza (no se corre el comando en cada vuelta). */
export const REUTILIZAR_REVISION_MS = 60_000;
export const REVISAR_MINUTOS_POR_DEFECTO = 3;

/** Lo que dicen Claude o la CLI cuando la sesión venció o no hay sesión. */
const ERROR_DE_SESION = /OAuth session expired|could not be refreshed|Failed to authenticate|Not logged in|Please run \/login/i;

/** ¿El texto (salida de un `claude`) dice que la sesión venció o que no hay sesión? */
export function esErrorDeSesion(texto) {
  return ERROR_DE_SESION.test(String(texto ?? ""));
}

/**
 * Lo que dice `claude auth status`: true (hay sesión), false (no hay) o null (no se entiende). Lee `loggedIn` del JSON;
 * si no viene JSON, busca "Not logged in" en el texto.
 */
export function leerAuthStatus(texto) {
  const limpio = String(texto ?? "").trim();
  const candidatos = [limpio, limpio.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean);
  for (const candidato of candidatos) {
    try {
      const datos = JSON.parse(candidato);
      if (datos && typeof datos.loggedIn === "boolean") return datos.loggedIn;
    } catch {
      // No es JSON: se mira el texto.
    }
  }
  if (/Not logged in/i.test(limpio)) return false;
  return null;
}

/** Correr `config.comandoClaude auth status` (30 s como máximo). -> { texto, motivo } (texto null = no respondió). */
async function correrAuthStatus(config, entorno) {
  const resultado = await correr([...config.comandoClaude, "auth", "status"], {
    cwd: config.carpetaTrabajo && fs.existsSync(config.carpetaTrabajo) ? config.carpetaTrabajo : undefined,
    entrada: "",
    timeoutMs: ESPERA_AUTH_STATUS_MS,
    env: entorno,
  });
  if (resultado.vencido) return { texto: null, motivo: `tardó más de ${ESPERA_AUTH_STATUS_MS / 1000} s` };
  return { texto: `${resultado.salida ?? ""}\n${resultado.errores ?? ""}`, motivo: resultado.codigo === 0 ? null : `salió con código ${resultado.codigo}` };
}

/**
 * La pausa por sesión de Claude vencida.
 *
 *   revisar()             mira la sesión (si toca) y devuelve si está vencida. Si el comando no responde o no se entiende,
 *                         NO pausa: lo anota en el registro (una vez hasta la próxima revisión buena).
 *   vencida()             ¿hay pausa ahora?
 *   marcarVencida(motivo) entra en pausa sin mirar el comando (para la parte 2: un error de sesión al correr una tarjeta).
 *   resumen()             para el latido y el panel: { vencida, desde, revisadaEn }.
 *   esErrorDeSesion(txt)  ¿el texto dice que la sesión venció?
 */
export function crearPausaPorSesion({ config, registro, ahora = () => Date.now(), entorno, leer = correrAuthStatus }) {
  const archivo = config.carpetaTrabajo ? path.join(config.carpetaTrabajo, "estado-sesion-claude.json") : null;
  const minutos = Number(config.sesionClaude?.revisarMinutos);
  const revisarMs = (Number.isFinite(minutos) && minutos > 0 ? minutos : REVISAR_MINUTOS_POR_DEFECTO) * 60_000;

  const leerArchivo = () => {
    if (!archivo) return {};
    try {
      return JSON.parse(fs.readFileSync(archivo, "utf8"));
    } catch {
      return {};
    }
  };
  // Lo guardado: { vencida, desde, motivo, revisadaEn }. Se lee al arrancar: un reinicio sigue en pausa.
  let estado = { vencida: false, desde: null, motivo: null, revisadaEn: null, ...leerArchivo() };
  estado.vencida = estado.vencida === true;
  const guardar = (cambios) => {
    estado = { ...estado, ...cambios };
    if (!archivo) return;
    try {
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      fs.writeFileSync(archivo, `${JSON.stringify(estado, null, 2)}\n`);
    } catch (error) {
      registro.aviso(`no pude guardar ${archivo}: ${error.message}`);
    }
  };

  // En memoria: cuándo toca la próxima revisión en pausa (0 = ya, también al arrancar), la última revisión buena y la última
  // que no se entendió (para no correr el comando en cada vuelta ni repetir la línea del registro).
  let proximaEnPausa = 0;
  let ultimaBuena = 0;
  let ultimaFallida = 0;
  let falloAnotado = false;
  let enVuelo = null;

  const entrar = (motivo) => {
    const momento = ahora();
    proximaEnPausa = momento + revisarMs;
    if (estado.vencida) return;
    guardar({ vencida: true, desde: momento, motivo: motivo ?? null });
    registro.aviso(`PAUSA por sesión de Claude vencida (${motivo ?? "sin motivo"}): no tomo tarjetas; reviso cada ${revisarMs / 60_000} min`);
  };

  async function revisarAhora() {
    const momento = ahora();
    let respuesta;
    try {
      respuesta = await leer(config, entorno);
    } catch (error) {
      respuesta = { texto: null, motivo: error?.message ?? String(error) };
    }
    const sesion = respuesta?.texto === null || respuesta?.texto === undefined ? null : leerAuthStatus(respuesta.texto);
    if (sesion === null) {
      ultimaFallida = momento;
      if (estado.vencida) proximaEnPausa = momento + revisarMs;
      if (!falloAnotado) {
        falloAnotado = true;
        registro.aviso(`no pude revisar la sesión de Claude (\`claude auth status\` ${respuesta?.motivo ?? "dio una respuesta que no entiendo"}): no pauso por eso`);
      }
      return estado.vencida;
    }
    falloAnotado = false;
    ultimaBuena = momento;
    ultimaFallida = 0;
    guardar({ revisadaEn: momento });
    if (!sesion) entrar("claude auth status: no hay sesión");
    else if (estado.vencida) {
      guardar({ vencida: false, desde: null, motivo: null });
      registro.info("volvió la sesión de Claude: salgo de la pausa y vuelvo a tomar tarjetas");
    }
    return estado.vencida;
  }

  const api = {
    /** Mira la sesión si toca y devuelve si está vencida. Dos llamadas a la vez comparten la misma revisión. */
    async revisar() {
      const momento = ahora();
      if (estado.vencida) {
        if (momento < proximaEnPausa) return true;
      } else {
        if (ultimaBuena && momento - ultimaBuena < REUTILIZAR_REVISION_MS) return false;
        if (ultimaFallida && momento - ultimaFallida < REUTILIZAR_REVISION_MS) return false;
      }
      enVuelo ??= revisarAhora().finally(() => {
        enVuelo = null;
      });
      return enVuelo;
    },
    vencida: () => estado.vencida,
    marcarVencida(motivo) {
      entrar(motivo);
    },
    resumen() {
      return {
        vencida: estado.vencida,
        desde: estado.vencida && estado.desde ? new Date(estado.desde).toISOString() : null,
        revisadaEn: estado.revisadaEn ? new Date(estado.revisadaEn).toISOString() : null,
      };
    },
    esErrorDeSesion,
  };
  return api;
}
