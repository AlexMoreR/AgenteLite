// LA PAUSA POR SESIÓN DE CLAUDE VENCIDA (24-nov-2026): si la sesión de Claude de aizen1 se vence (OAuth sin renovar), cada
// tarjeta que se toma falla al instante y se gastan intentos y reparaciones en cadena. Antes de tomar tarjetas el
// Coordinador pregunta `claude auth status`; si dice que no hay sesión, entra en "En pausa: sesión de Claude vencida", no
// toma nada y vuelve a preguntar cada `config.sesionClaude.revisarMinutos` (3 por defecto). Cuando la sesión vuelve, sale
// de la pausa sola.
//
// Se arma igual que la pausa por uso (pausa-uso.mjs): este módulo solo decide y guarda el estado (en
// carpetaTrabajo/estado-sesion-claude.json, para que un reinicio del Coordinador siga en pausa). Quién deja de tomar
// tarjetas es el planificador (bucle.mjs).
//
// Si el comando no responde o la respuesta no se entiende, NO se pausa: solo se anota en el registro (no hay certeza).
import fs from "node:fs";
import path from "node:path";

import { entornoSeguro } from "./etapas.mjs";
import { correr } from "./procesos.mjs";

/** Tope de `claude auth status`. */
export const TIEMPO_MAXIMO_MS = 30_000;
/** Mientras hay trabajo, una revisión buena de hace menos de esto se reutiliza (no se corre el comando en cada vuelta). */
export const REUTILIZAR_MS = 60_000;
export const REVISAR_MINUTOS_POR_DEFECTO = 3;

const FRASES_DE_SESION = [/OAuth session expired/i, /could not be refreshed/i, /Failed to authenticate/i, /Not logged in/i, /Please run \/login/i];

/** ¿El texto (salida o error de Claude) dice que la sesión está vencida o que no hay sesión? */
export function esErrorDeSesion(texto) {
  const limpio = String(texto ?? "");
  return FRASES_DE_SESION.some((frase) => frase.test(limpio));
}

/**
 * Lo que dijo `claude auth status` -> true (hay sesión), false (no hay) o null (no se entiende). Lee `loggedIn` del JSON
 * (la CLI 2.1 lo da en la salida, también cuando sale con código 1); sin JSON, busca "Not logged in" en el texto.
 */
export function sesionDeLaRespuesta(texto) {
  const limpio = String(texto ?? "");
  const desde = limpio.indexOf("{");
  const hasta = limpio.lastIndexOf("}");
  if (desde !== -1 && hasta > desde) {
    try {
      const datos = JSON.parse(limpio.slice(desde, hasta + 1));
      if (typeof datos?.loggedIn === "boolean") return datos.loggedIn;
    } catch {
      // No era JSON: se mira el texto.
    }
  }
  if (/Not logged in/i.test(limpio)) return false;
  return null;
}

/** Correr `[...comandoClaude, "auth", "status"]`: -> { sesion: true | false | null, motivo }. */
async function preguntarAClaude(config) {
  try {
    fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
  } catch {
    // Sin carpeta corre igual (cwd falla y se anota abajo).
  }
  const resultado = await correr([...config.comandoClaude, "auth", "status"], {
    cwd: config.carpetaTrabajo,
    entrada: "",
    timeoutMs: TIEMPO_MAXIMO_MS,
    env: entornoSeguro(),
  });
  if (resultado.vencido) return { sesion: null, motivo: `claude auth status tardó más de ${TIEMPO_MAXIMO_MS / 1000} s` };
  const sesion = sesionDeLaRespuesta(`${resultado.salida}\n${resultado.errores}`);
  if (sesion === null) return { sesion: null, motivo: `no entendí la respuesta de claude auth status (código ${resultado.codigo})` };
  return { sesion, motivo: sesion ? null : "claude auth status dice que no hay sesión (loggedIn: false)" };
}

/**
 * La pausa por sesión vencida.
 *   revisar()              pregunta a Claude si hace falta (reutiliza la última respuesta según el reloj). -> ¿vencida?
 *   vencida()              ¿hay pausa ahora?
 *   marcarVencida(motivo)  entra en pausa sin preguntar (cuando una tarea ve el error de sesión; parte 2).
 *   resumen()              para el latido y el panel: { vencida, desde, revisadaEn }.
 *   esErrorDeSesion(texto) ¿ese texto es el error de sesión vencida?
 * `preguntar` se puede cambiar en las pruebas (por defecto corre la CLI de verdad, config.comandoClaude).
 */
export function crearPausaPorSesion({ config, registro, ahora = () => Date.now(), preguntar = preguntarAClaude }) {
  const archivo = path.join(config.carpetaTrabajo, "estado-sesion-claude.json");
  const revisarMs = Math.max(0, Number(config.sesionClaude?.revisarMinutos ?? REVISAR_MINUTOS_POR_DEFECTO) || 0) * 60_000;

  const leerArchivo = () => {
    try {
      const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
      return { vencida: datos?.vencida === true, desde: Number(datos?.desde) || null, motivo: datos?.motivo ?? null, revisadaEn: Number(datos?.revisadaEn) || null };
    } catch {
      return { vencida: false, desde: null, motivo: null, revisadaEn: null };
    }
  };
  // Lo guardado se lee al arrancar: un reinicio del Coordinador sigue en pausa.
  let estado = leerArchivo();
  // Cuándo se preguntó por última vez (con respuesta o sin ella), para no correr el comando en cada vuelta.
  let preguntadaEn = estado.revisadaEn ?? null;
  // El motivo de la última falla anotada: una línea por racha, no una por vuelta.
  let ultimaFalla = "";
  let enVuelo = null;

  const guardar = () => {
    try {
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      fs.writeFileSync(archivo, `${JSON.stringify(estado, null, 2)}\n`);
    } catch (error) {
      registro.aviso(`no pude guardar ${archivo}: ${error.message}`);
    }
  };

  const entrar = (motivo) => {
    if (estado.vencida) return;
    estado = { ...estado, vencida: true, desde: ahora(), motivo: motivo ?? null };
    guardar();
    registro.aviso(`la sesión de Claude está vencida (${motivo ?? "sin motivo"}): no tomo tarjetas hasta que vuelva`);
  };

  async function preguntarYa() {
    const momento = ahora();
    preguntadaEn = momento;
    let respuesta;
    try {
      respuesta = await preguntar(config);
    } catch (error) {
      respuesta = { sesion: null, motivo: `claude auth status falló: ${error?.message ?? error}` };
    }
    if (respuesta?.sesion === null || respuesta?.sesion === undefined) {
      const motivo = respuesta?.motivo ?? "sin respuesta";
      if (motivo !== ultimaFalla) registro.aviso(`no pude revisar la sesión de Claude (${motivo}); no pauso por eso`);
      ultimaFalla = motivo;
      return;
    }
    ultimaFalla = "";
    estado = { ...estado, revisadaEn: momento };
    if (respuesta.sesion === false) {
      if (estado.vencida) guardar();
      else entrar(respuesta.motivo);
      return;
    }
    if (estado.vencida) {
      registro.info("volvió la sesión de Claude: salgo de la pausa y vuelvo a tomar tarjetas");
      estado = { ...estado, vencida: false, desde: null, motivo: null };
    }
    guardar();
  }

  const api = {
    /** Pregunta a Claude si toca. Mientras hay trabajo reutiliza la última de hace menos de 1 min; en pausa, cada revisarMinutos. */
    async revisar() {
      const espera = estado.vencida ? revisarMs : REUTILIZAR_MS;
      if (preguntadaEn !== null && ahora() - preguntadaEn < espera) return estado.vencida;
      enVuelo ??= preguntarYa().finally(() => {
        enVuelo = null;
      });
      await enVuelo;
      return estado.vencida;
    },
    vencida: () => estado.vencida,
    marcarVencida(motivo) {
      entrar(motivo);
      // La próxima revisión espera revisarMinutos desde ahora (no pregunta en la vuelta siguiente).
      preguntadaEn = ahora();
    },
    resumen: () => ({
      vencida: estado.vencida,
      desde: estado.desde ? new Date(estado.desde).toISOString() : null,
      revisadaEn: estado.revisadaEn ? new Date(estado.revisadaEn).toISOString() : null,
    }),
    esErrorDeSesion,
  };
  return api;
}
