// LA PAUSA POR SESIÓN DE CLAUDE VENCIDA (24-nov-2026, parte 1 de 4): si se vence la sesión de Claude en aizen1 (el OAuth no
// se pudo renovar), cada tarjeta que se toma falla y gasta un intento, en cadena. Antes de tomar tarjetas el Coordinador
// revisa la sesión con `claude auth status`; mientras esté vencida no toma nada y lo dice UNA vez en el registro. La revisa
// cada `sesionClaude.revisarMinutos` (3 por defecto) y, cuando vuelve, sale de la pausa sola.
//
// Se arma igual que la pausa por uso (pausa-uso.mjs): este módulo solo decide y guarda el estado (en
// carpetaTrabajo/estado-sesion-claude.json, para que un reinicio del Coordinador siga en pausa); quién deja de tomar es el
// planificador (bucle.mjs).
//
// Si el comando no responde o la respuesta no se entiende, NO se pausa: solo se anota en el registro (mejor seguir como antes
// que parar todo por una lectura dudosa).
import fs from "node:fs";
import path from "node:path";

import { correr } from "./procesos.mjs";

/** Tiempo máximo de `claude auth status`. */
export const TIEMPO_MAXIMO_REVISION_MS = 30_000;
/** Con la sesión buena, una revisión de hace menos de esto se reutiliza (no se corre el comando en cada vuelta). */
export const REUTILIZAR_REVISION_MS = 60_000;
/** Cada cuánto se revisa en pausa, si la configuración no dice otra cosa. */
export const REVISAR_MINUTOS_POR_DEFECTO = 3;

// Lo que dice Claude cuando la sesión se venció o no hay sesión.
const TEXTOS_DE_SESION_VENCIDA = [/OAuth session expired/i, /could not be refreshed/i, /Failed to authenticate/i, /Not logged in/i, /Please run \/login/i];

/** ¿El texto (salida o error de un `claude`) dice que la sesión de Claude se venció? */
export function esErrorDeSesion(texto) {
  const limpio = String(texto ?? "");
  return TEXTOS_DE_SESION_VENCIDA.some((patron) => patron.test(limpio));
}

/**
 * Lo que contestó `claude auth status` -> true (hay sesión), false (no hay) o null (no se entiende).
 * Lee `loggedIn` del JSON (también si viene con texto alrededor); sin JSON, busca "Not logged in".
 */
export function sesionDeLaRespuesta(texto) {
  const limpio = String(texto ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  const candidatos = [limpio.trim()];
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio >= 0 && fin > inicio) candidatos.push(limpio.slice(inicio, fin + 1));
  for (const candidato of candidatos) {
    try {
      const datos = JSON.parse(candidato);
      if (typeof datos?.loggedIn === "boolean") return datos.loggedIn;
    } catch {
      // No es JSON: se sigue con el texto.
    }
  }
  if (/Not logged in/i.test(limpio)) return false;
  return null;
}

/** Los minutos entre revisiones en pausa (config.sesionClaude.revisarMinutos; 3 si no viene o no es un número > 0). */
export function minutosEntreRevisiones(config) {
  const minutos = Number(config?.sesionClaude?.revisarMinutos);
  return Number.isFinite(minutos) && minutos > 0 ? minutos : REVISAR_MINUTOS_POR_DEFECTO;
}

/**
 * La pausa por sesión de Claude vencida.
 *
 *   revisar()             corre `claude auth status` (30 s como máximo) si toca y decide entrar o salir de la pausa.
 *                         Con la sesión buena reutiliza la revisión de hace menos de 1 minuto; en pausa revisa cada
 *                         revisarMinutos. Nunca lanza.
 *   vencida()             ¿está en pausa por sesión vencida?
 *   marcarVencida(motivo) entra en pausa ya (por ejemplo, cuando una tarjeta falló con el error de sesión).
 *   resumen()             { vencida, desde, revisadaEn } para el latido y el panel.
 *   esErrorDeSesion(t)    ¿el texto es el error de sesión vencida?
 *
 * `correrComando` se puede cambiar en las pruebas; por defecto, correr() de procesos.mjs.
 */
export function crearPausaPorSesion({ config, registro, ahora = () => Date.now(), entorno = process.env, correrComando = correr }) {
  const archivo = path.join(config.carpetaTrabajo, "estado-sesion-claude.json");
  const revisarCadaMs = minutosEntreRevisiones(config) * 60_000;

  const leerArchivo = () => {
    try {
      const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
      return {
        vencida: datos?.vencida === true,
        desde: Number.isFinite(datos?.desde) ? datos.desde : null,
        motivo: typeof datos?.motivo === "string" ? datos.motivo : null,
        revisadaEn: Number.isFinite(datos?.revisadaEn) ? datos.revisadaEn : null,
      };
    } catch {
      return { vencida: false, desde: null, motivo: null, revisadaEn: null };
    }
  };
  // Se lee al arrancar: un reinicio del Coordinador sigue en pausa (y revisa en la primera vuelta).
  let estado = leerArchivo();
  const guardar = (cambios) => {
    estado = { ...estado, ...cambios };
    try {
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      fs.writeFileSync(archivo, `${JSON.stringify(estado, null, 2)}\n`);
    } catch (error) {
      registro.aviso(`no pude guardar ${archivo}: ${error.message}`);
    }
  };

  // En memoria: cuándo se corrió el comando por última vez y cuándo dio una respuesta buena (con sesión).
  let ultimaRevision = 0;
  let ultimaBuena = 0;
  // Un "no pude revisar" se anota una vez por racha (no en cada vuelta).
  let fallaAnotada = false;
  let enCurso = null;

  const noPudo = (motivo) => {
    if (fallaAnotada) return;
    fallaAnotada = true;
    registro.aviso(`no pude revisar la sesión de Claude (${motivo}): no pauso por esto`);
  };

  const api = {
    vencida: () => estado.vencida === true,
    marcarVencida(motivo) {
      if (estado.vencida) return;
      const momento = ahora();
      // La próxima revisión espera revisarMinutos (si no, la de la vuelta siguiente la levantaría sin dar tiempo).
      ultimaRevision = momento;
      ultimaBuena = 0;
      guardar({ vencida: true, desde: momento, motivo: String(motivo ?? "sin motivo").slice(0, 300) });
      registro.aviso(`PAUSA: la sesión de Claude está vencida (${String(motivo ?? "sin motivo").slice(0, 300)}); no tomo tarjetas hasta que vuelva`);
    },
    esErrorDeSesion,
    async revisar() {
      const momento = ahora();
      if (!estado.vencida && ultimaBuena && momento - ultimaBuena < REUTILIZAR_REVISION_MS) return;
      if (estado.vencida && ultimaRevision && momento - ultimaRevision < revisarCadaMs) return;
      if (enCurso) return enCurso;
      enCurso = (async () => {
        ultimaRevision = momento;
        let resultado;
        try {
          fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
          resultado = await correrComando([...config.comandoClaude, "auth", "status"], {
            cwd: config.carpetaTrabajo,
            entrada: "",
            timeoutMs: TIEMPO_MAXIMO_REVISION_MS,
            env: entorno,
          });
        } catch (error) {
          noPudo(String(error?.message ?? error).slice(0, 200));
          return;
        }
        if (resultado?.vencido) {
          noPudo(`tardó más de ${TIEMPO_MAXIMO_REVISION_MS / 1000} s`);
          return;
        }
        const hay = sesionDeLaRespuesta(`${resultado?.salida ?? ""}\n${resultado?.errores ?? ""}`);
        if (hay === null) {
          const detalle = String(resultado?.errores || resultado?.salida || "sin salida").trim().split(/\r?\n/)[0].slice(0, 200);
          noPudo(`respuesta que no entiendo, código ${resultado?.codigo}: ${detalle}`);
          return;
        }
        fallaAnotada = false;
        const cuando = ahora();
        if (hay) {
          ultimaBuena = cuando;
          if (estado.vencida) {
            guardar({ vencida: false, desde: null, motivo: null, revisadaEn: cuando });
            registro.info("volvió la sesión de Claude: salgo de la pausa y vuelvo a tomar tarjetas");
          } else if (estado.revisadaEn === null || cuando - estado.revisadaEn >= revisarCadaMs) {
            // Con la sesión buena el archivo se refresca de vez en cuando (no en cada revisión).
            guardar({ revisadaEn: cuando });
          } else estado = { ...estado, revisadaEn: cuando };
          return;
        }
        ultimaBuena = 0;
        if (estado.vencida) guardar({ revisadaEn: cuando });
        else {
          guardar({ revisadaEn: cuando });
          api.marcarVencida("claude auth status: no hay sesión (loggedIn: false)");
        }
      })();
      try {
        await enCurso;
      } finally {
        enCurso = null;
      }
    },
    resumen: () => ({
      vencida: estado.vencida === true,
      desde: estado.desde ? new Date(estado.desde).toISOString() : null,
      revisadaEn: estado.revisadaEn ? new Date(estado.revisadaEn).toISOString() : null,
    }),
  };
  return api;
}
