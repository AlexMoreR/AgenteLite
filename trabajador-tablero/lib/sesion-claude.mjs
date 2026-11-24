// LA PAUSA POR SESIÓN DE CLAUDE VENCIDA (24-nov-2026, parte 1 de 4): si la sesión de Claude en aizen1 se vence (el token
// de OAuth no se pudo renovar), cada tarjeta que se toma falla en cadena con "OAuth session expired". En vez de eso, antes
// de tomar tarjetas el Coordinador mira `claude auth status`: si dice que no hay sesión, no toma nada hasta que vuelva.
// Se arma igual que la pausa por uso (pausa-uso.mjs): este módulo solo revisa, decide y guarda el estado (en
// carpetaTrabajo/estado-sesion-claude.json, para que un reinicio del Coordinador siga en pausa). Quién deja de tomar
// tarjetas es el planificador (bucle.mjs).
//
// Si el comando no responde o la respuesta no se entiende, NO se pausa (no hay certeza): solo se anota en el registro.
import fs from "node:fs";
import path from "node:path";

import { correr } from "./procesos.mjs";

/** Lo máximo que se espera a `claude auth status`. */
export const ESPERA_MAXIMA_MS = 30_000;
/** Con sesión buena, una revisión de hace menos de esto se reutiliza (no se corre el comando en cada vuelta). */
export const REUTILIZAR_MS = 60_000;
/** En pausa, cada cuántos minutos se vuelve a mirar si la sesión volvió (config.sesionClaude.revisarMinutos). */
export const REVISAR_MINUTOS_POR_DEFECTO = 3;

// Los textos con que Claude dice que la sesión se venció o que no hay sesión.
const ERRORES_DE_SESION = [/OAuth session expired/i, /could not be refreshed/i, /Failed to authenticate/i, /Not logged in/i, /Please run \/login/i];

/** ¿El texto (salida de un `claude`) dice que la sesión se venció o que no hay sesión? */
export function esErrorDeSesion(texto) {
  const valor = String(texto ?? "");
  return ERRORES_DE_SESION.some((patron) => patron.test(valor));
}

/** El primer objeto JSON del texto con `loggedIn` booleano, o null. */
function loggedInDe(texto) {
  const valor = String(texto ?? "").trim();
  const inicio = valor.indexOf("{");
  const fin = valor.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;
  try {
    const datos = JSON.parse(valor.slice(inicio, fin + 1));
    return typeof datos?.loggedIn === "boolean" ? datos.loggedIn : null;
  } catch {
    return null;
  }
}

/**
 * Qué dice `claude auth status`: { loggedIn: true | false } o { loggedIn: null, motivo } si no se entiende.
 * Primero el JSON (`loggedIn`); si no viene JSON, se busca "Not logged in" en el texto.
 */
export function leerEstadoDeSesion(resultado) {
  if (!resultado || resultado.vencido) return { loggedIn: null, motivo: `no respondió en ${ESPERA_MAXIMA_MS / 1000} s` };
  const salida = String(resultado.salida ?? "");
  const errores = String(resultado.errores ?? "");
  const porJson = loggedInDe(salida) ?? loggedInDe(errores);
  if (porJson !== null) return { loggedIn: porJson };
  if (/Not logged in/i.test(`${salida}\n${errores}`)) return { loggedIn: false };
  const muestra = `${salida} ${errores}`.replace(/\s+/g, " ").trim().slice(0, 200);
  return { loggedIn: null, motivo: `respuesta que no se entiende (código ${resultado.codigo ?? "?"}): ${muestra || "vacía"}` };
}

/**
 * La pausa por sesión de Claude vencida. `correrComando` y `entorno` se pueden cambiar en las pruebas.
 *   revisar()             corre `claude auth status` (si toca) y decide entrar o salir de la pausa. Nunca lanza error.
 *   vencida()             ¿está en pausa por sesión vencida?
 *   marcarVencida(motivo) entra en pausa sin esperar la revisión (p. ej. una etapa vio "OAuth session expired").
 *   resumen()             para el latido y el panel: { vencida, desde, revisadaEn }.
 *   esErrorDeSesion(txt)  ¿ese texto dice que la sesión se venció?
 */
export function crearPausaPorSesion({ config, registro, ahora = () => Date.now(), entorno, correrComando = correr }) {
  const archivo = path.join(config.carpetaTrabajo, "estado-sesion-claude.json");
  const minutos = Number(config.sesionClaude?.revisarMinutos);
  const revisarCadaMs = (Number.isFinite(minutos) && minutos > 0 ? minutos : REVISAR_MINUTOS_POR_DEFECTO) * 60_000;
  // Cuándo se intentó la última revisión (buena o no) y la que está corriendo (para no lanzar dos a la vez).
  let ultimoIntento = 0;
  let enCurso = null;

  const leerArchivo = () => {
    try {
      const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
      return datos && typeof datos === "object" ? datos : {};
    } catch {
      return {};
    }
  };
  // Lo guardado: { vencida, desde, motivo, revisadaEn }. Se lee al arrancar (un reinicio sigue en pausa).
  let estado = { vencida: false, desde: null, motivo: null, revisadaEn: null, ...leerArchivo() };
  estado.vencida = estado.vencida === true;
  const guardar = (cambios) => {
    estado = { ...estado, ...cambios };
    try {
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      fs.writeFileSync(archivo, `${JSON.stringify(estado, null, 2)}\n`);
    } catch (error) {
      registro.aviso(`no pude guardar ${archivo}: ${error.message}`);
    }
  };

  const entrar = (motivo) => {
    if (estado.vencida) return;
    guardar({ vencida: true, desde: ahora(), motivo: motivo ?? null });
    registro.aviso(`PAUSA por sesión de Claude vencida: ${motivo ?? "sin motivo"}; no tomo tarjetas hasta que vuelva`);
  };
  const salir = () => {
    if (!estado.vencida) return;
    guardar({ vencida: false, desde: null, motivo: null });
    registro.info("sale la pausa por sesión de Claude: la sesión volvió");
  };

  async function revisarAhora() {
    let resultado;
    try {
      // Sin la carpeta (primer arranque) el comando ni siquiera arranca (ENOENT del cwd).
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      resultado = await correrComando([...config.comandoClaude, "auth", "status"], {
        cwd: config.carpetaTrabajo,
        entrada: "",
        timeoutMs: ESPERA_MAXIMA_MS,
        env: entorno,
      });
    } catch (error) {
      resultado = { codigo: null, salida: "", errores: String(error?.message ?? error) };
    }
    const { loggedIn, motivo } = leerEstadoDeSesion(resultado);
    if (loggedIn === null) {
      // Sin certeza no se pausa (ni se sale de una pausa): solo se anota.
      registro.aviso(`no pude revisar la sesión de Claude (\`claude auth status\`): ${motivo}; no cambio nada`);
      return;
    }
    guardar({ revisadaEn: ahora() });
    if (loggedIn) salir();
    else entrar("`claude auth status` dice que no hay sesión (loggedIn: false)");
  }

  const api = {
    /** Revisa la sesión si toca: con sesión, cada 1 minuto como mucho; en pausa, cada revisarMinutos. */
    async revisar() {
      if (enCurso) return enCurso;
      const espera = estado.vencida ? revisarCadaMs : REUTILIZAR_MS;
      if (ultimoIntento && ahora() - ultimoIntento < espera) return;
      ultimoIntento = ahora();
      enCurso = revisarAhora()
        .catch((error) => registro.aviso(`no pude revisar la sesión de Claude: ${error?.message ?? error}`))
        .finally(() => {
          enCurso = null;
        });
      return enCurso;
    },
    vencida: () => estado.vencida,
    marcarVencida(motivo) {
      entrar(motivo);
      // La próxima revisión espera revisarMinutos desde ahora (no se corre el comando en la misma vuelta).
      ultimoIntento = ahora();
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
