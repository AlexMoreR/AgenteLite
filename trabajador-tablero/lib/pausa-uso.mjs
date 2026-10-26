// LA PAUSA POR USO DE CLAUDE (26-oct-2026, decisión del dueño): todo el desarrollo se construye en la nube de Claude, así que
// si el plan se agota se cae TODO (desarrollo, voz y chat del dueño). Al llegar al umbral (80 % por defecto) de la sesión o
// de la semana el Coordinador entra en "Pausado por uso de Claude": no toma tarjetas nuevas, detiene con orden las que corren
// (vuelven a la fila sin ERROR y sin gastar intento) y avisa UNA vez al dueño. Sale de la pausa cuando una lectura NUEVA del
// uso baja del umbral (o el dueño apaga el interruptor en el panel) y avisa en una línea.
//
// Este módulo solo decide y guarda el estado (en carpetaTrabajo/estado-uso.json, para que un reinicio del Coordinador no
// pierda la pausa ni repita el WhatsApp). Quién lee el uso es el vigilante (motores.mjs) y quién detiene y avisa es el
// planificador (bucle.mjs).
import fs from "node:fs";
import path from "node:path";

import { linkDelCoordinador } from "./motores.mjs";

export const UMBRAL_MINIMO = 50;
export const UMBRAL_MAXIMO = 95;
/** Lecturas malas seguidas antes de decir "no pude leer el uso" (una sola vez hasta que haya una buena). */
export const LECTURAS_MALAS_PARA_AVISAR = 3;
/** Pasada la hora de reinicio más este margen sin poder leer nada, la pausa se levanta sola (el cupo ya se reinició). */
const MARGEN_SIN_LECTURA_MS = 30 * 60_000;

const BOGOTA = "America/Bogota";
const MESES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DIA_MS = 24 * 60 * 60_000;

/** El umbral válido (50 a 95), o null si no es un número razonable. */
export function umbralValido(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= UMBRAL_MINIMO && numero <= UMBRAL_MAXIMO ? Math.round(numero) : null;
}

/**
 * "Oct 23, 3:20pm (America/Bogota)" / "Oct 30, 7am" / "3:20pm" -> el momento (ms) del reinicio, en hora de Bogotá (UTC-5,
 * sin horario de verano). Sin fecha: hoy a esa hora, o mañana si ya pasó. null si no trae hora (no se inventa).
 */
export function fechaDelReinicio(texto, ahora = Date.now()) {
  const limpio = String(texto ?? "");
  const hora = limpio.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (!hora) return null;
  let horas = Number(hora[1]) % 12;
  if (hora[3].toLowerCase() === "p") horas += 12;
  const minutos = Number(hora[2] ?? 0);
  const enBogota = new Date(ahora - 5 * 60 * 60_000);
  const dia = limpio.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b/);
  const mes = dia ? MESES[dia[1].toLowerCase()] : undefined;
  let año = enBogota.getUTCFullYear();
  let momento;
  if (mes !== undefined) {
    momento = Date.UTC(año, mes, Number(dia[2]), horas + 5, minutos);
    if (momento < ahora - DIA_MS) momento = Date.UTC(año + 1, mes, Number(dia[2]), horas + 5, minutos);
  } else {
    momento = Date.UTC(año, enBogota.getUTCMonth(), enBogota.getUTCDate(), horas + 5, minutos);
    if (momento <= ahora) momento += DIA_MS;
  }
  return momento;
}

/** "lun 27 oct, 3:20 p. m." en hora de Bogotá. */
export function textoDelReinicio(momento) {
  const f = new Date(momento);
  const dia = f.toLocaleDateString("es-CO", { timeZone: BOGOTA, weekday: "short", day: "numeric", month: "short" }).replace(/[,.]/g, "");
  const hora = f.toLocaleTimeString("es-CO", { timeZone: BOGOTA, hour: "numeric", minute: "2-digit", hour12: true });
  return `${dia}, ${hora}`.replace(/[  ]/g, " ");
}

/**
 * Qué periodos pasan del umbral y cuándo se reinicia lo que hay que esperar. `uso` es lo de leerUsoDeClaude.
 * -> { alto: [{ periodo, porcentaje, reinicio, reiniciaEn }], reiniciaEn (ms | null: el más lejano de los altos) }
 */
export function periodosAltos(uso, umbral, ahora = Date.now()) {
  const alto = [];
  for (const periodo of ["sesion", "semana"]) {
    const dato = uso?.[periodo];
    if (dato && dato.porcentaje >= umbral) alto.push({ periodo, porcentaje: dato.porcentaje, reinicio: dato.reinicio, reiniciaEn: fechaDelReinicio(dato.reinicio, ahora) });
  }
  const fechas = alto.map((p) => p.reiniciaEn).filter((x) => x !== null);
  return { alto, reiniciaEn: fechas.length ? Math.max(...fechas) : null };
}

/** El WhatsApp al entrar en pausa: 3 líneas como máximo. */
export function textoDelAvisoDePausa({ umbral, reiniciaEn, config }) {
  return [
    `⛔ Se paró todo: el uso de Claude llegó al ${umbral} %.`,
    reiniciaEn ? `Se reanuda el ${textoDelReinicio(reiniciaEn)}.` : "Se reanuda cuando se reinicie el uso.",
    `Ver: ${linkDelCoordinador(config)}`,
  ].join("\n");
}

export const textoDelAvisoDeReanudar = () => "✅ Volvió a trabajar: el uso de Claude se reinició.";

export function textoDelAvisoDeLecturaFallida({ desde, config }) {
  const hora = new Date(desde).toLocaleTimeString("es-CO", { timeZone: BOGOTA, hour: "numeric", minute: "2-digit", hour12: true }).replace(/[  ]/g, " ");
  return [`⚠️ No pude leer el uso de Claude desde las ${hora}: no sé si se acerca al límite.`, `Ver: ${linkDelCoordinador(config)}`].join("\n");
}

/**
 * La pausa por uso. El archivo estado-uso.json es compartido con el vigilante (que guarda ahí el último cruce del umbral);
 * aquí solo se toca la llave `pausaUso`.
 *
 *   ajustes({ activa, umbral })   lo que dice el CRM (interruptor del panel). Apagarla en plena pausa la levanta al instante.
 *   leyo(uso, motivo)             una lectura del uso (uso null = no se pudo leer). Decide entrar, salir o avisar la falla.
 *   pausado()                     ¿hay pausa ahora?
 *   pendientes()                  los WhatsApp que faltan por mandar: [{ clave, texto }] ("pausa", "reanudar", "lectura").
 *   avisado(clave)                ya salió (queda guardado en el archivo).
 *   resumen()                     para el latido y el panel.
 */
export function crearPausaPorUso({ config, registro, ahora = () => Date.now() }) {
  const archivo = path.join(config.carpetaTrabajo, "estado-uso.json");
  const porDefecto = config.pausaUso ?? { activa: true, umbral: config.umbralClaude ?? 80 };
  let ajuste = { activa: porDefecto.activa !== false, umbral: umbralValido(porDefecto.umbral) ?? 80 };
  // Lo último que se leyó (solo para el panel): { sesion, semana } con porcentaje y reinicio, y desde cuándo no se lee.
  let ultimoUso = null;
  let ultimaLectura = 0;
  let malas = 0;
  let sinLeerDesde = null;

  const leerArchivo = () => {
    try {
      return JSON.parse(fs.readFileSync(archivo, "utf8"));
    } catch {
      return {};
    }
  };
  const guardarArchivo = (cambios) => {
    try {
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      fs.writeFileSync(archivo, `${JSON.stringify({ ...leerArchivo(), ...cambios }, null, 2)}\n`);
    } catch (error) {
      registro.aviso(`no pude guardar ${archivo}: ${error.message}`);
    }
  };
  // Lo guardado: { pausa: { desde, umbral, reiniciaEn, porcentaje, periodo, avisada } | null, reanudarPendiente, lectura: { desde, avisada } | null }
  const estadoGuardado = () => ({ pausa: null, reanudarPendiente: false, lectura: null, ...(leerArchivo().pausaUso ?? {}) });
  const guardar = (valor) => guardarArchivo({ pausaUso: valor });

  // `avisar`: el WhatsApp de "volvió a trabajar" solo si se avisó la pausa y salió porque el uso bajó (no si el dueño la apagó).
  const salir = (motivo, avisar = true) => {
    const actual = estadoGuardado();
    if (!actual.pausa) return false;
    guardar({ ...actual, pausa: null, reanudarPendiente: avisar && actual.pausa.avisada === true });
    registro.info(`sale la pausa por uso de Claude: ${motivo}`);
    return true;
  };

  const api = {
    ajustes(nuevo) {
      if (!nuevo || typeof nuevo !== "object") return;
      const umbral = umbralValido(nuevo.umbral) ?? ajuste.umbral;
      const activa = typeof nuevo.activa === "boolean" ? nuevo.activa : ajuste.activa;
      const cambio = umbral !== ajuste.umbral || activa !== ajuste.activa;
      ajuste = { activa, umbral };
      if (!cambio) return;
      registro.info(`pausa por uso de Claude: ${activa ? `prendida al ${umbral} %` : "apagada"}`);
      if (!activa) salir("el interruptor del panel la apagó", false);
      // Un umbral nuevo se aplica con la próxima lectura (cada 2 a 5 minutos); aquí se vuelve a mirar la última ya leída.
      else if (ultimoUso) api.leyo(ultimoUso, null);
    },
    umbral: () => ajuste.umbral,
    activa: () => ajuste.activa,
    pausado: () => Boolean(estadoGuardado().pausa),
    /** ¿Conviene leer más seguido? Desde el 70 % (o en pausa) se lee cada pocos minutos. */
    cerca(desde = 70) {
      if (api.pausado()) return true;
      const mayor = Math.max(ultimoUso?.sesion?.porcentaje ?? 0, ultimoUso?.semana?.porcentaje ?? 0);
      return mayor >= desde;
    },
    /** Una lectura del uso. uso = null: no se pudo leer. -> { entro, salio }. */
    leyo(uso, motivo) {
      const momento = ahora();
      const resultado = { entro: false, salio: false };
      const actual = estadoGuardado();
      if (!uso) {
        malas += 1;
        sinLeerDesde ??= momento;
        if (malas >= LECTURAS_MALAS_PARA_AVISAR && !actual.lectura) {
          guardar({ ...actual, lectura: { desde: sinLeerDesde, avisada: false, motivo: motivo ?? null } });
          registro.aviso(`no pude leer el uso de Claude ${malas} veces seguidas: no pauso (no hay número); lo anoto en el panel`);
        }
        // En pausa y sin poder leer: sigue pausado, salvo que ya pasó la hora de reinicio con margen (el cupo ya se reinició).
        const reinicio = actual.pausa?.reiniciaEn;
        if (actual.pausa && reinicio && momento > reinicio + MARGEN_SIN_LECTURA_MS && malas >= LECTURAS_MALAS_PARA_AVISAR) {
          resultado.salio = salir("pasó la hora de reinicio y no se pudo leer el uso");
        }
        return resultado;
      }
      malas = 0;
      sinLeerDesde = null;
      ultimoUso = uso;
      ultimaLectura = momento;
      if (actual.lectura) guardar({ ...estadoGuardado(), lectura: null });
      if (!ajuste.activa) {
        resultado.salio = salir("la pausa por uso está apagada", false);
        return resultado;
      }
      const { alto, reiniciaEn } = periodosAltos(uso, ajuste.umbral, momento);
      if (alto.length && !actual.pausa) {
        const mayor = [...alto].sort((a, b) => b.porcentaje - a.porcentaje)[0];
        guardar({
          ...estadoGuardado(),
          reanudarPendiente: false,
          pausa: { desde: momento, umbral: ajuste.umbral, reiniciaEn, porcentaje: mayor.porcentaje, periodo: mayor.periodo, avisada: false },
        });
        registro.aviso(`PAUSA por uso de Claude: ${mayor.periodo === "semana" ? "semana" : "sesión"} al ${mayor.porcentaje} % (umbral ${ajuste.umbral} %); no tomo tarjetas y detengo las que corren`);
        resultado.entro = true;
      } else if (alto.length && actual.pausa) {
        // Sigue en pausa: se actualizan el porcentaje y la hora de vuelta (la semana puede haberse sumado a la sesión).
        const mayor = [...alto].sort((a, b) => b.porcentaje - a.porcentaje)[0];
        guardar({ ...estadoGuardado(), pausa: { ...actual.pausa, umbral: ajuste.umbral, porcentaje: mayor.porcentaje, periodo: mayor.periodo, reiniciaEn: reiniciaEn ?? actual.pausa.reiniciaEn } });
      } else if (actual.pausa) {
        resultado.salio = salir(`el uso bajó del ${ajuste.umbral} %`);
      }
      return resultado;
    },
    /** Los WhatsApp que faltan. Cada uno sale una vez; si el CRM lo calla (9 p. m. a 7 a. m.) se reintenta en la próxima vuelta. */
    pendientes() {
      const actual = estadoGuardado();
      const lista = [];
      if (actual.pausa && actual.pausa.avisada !== true) {
        lista.push({ clave: "pausa", texto: textoDelAvisoDePausa({ umbral: actual.pausa.umbral, reiniciaEn: actual.pausa.reiniciaEn, config }) });
      }
      if (!actual.pausa && actual.reanudarPendiente) lista.push({ clave: "reanudar", texto: textoDelAvisoDeReanudar() });
      if (actual.lectura && actual.lectura.avisada !== true) lista.push({ clave: "lectura", texto: textoDelAvisoDeLecturaFallida({ desde: actual.lectura.desde, config }) });
      return lista;
    },
    avisado(clave) {
      const actual = estadoGuardado();
      if (clave === "pausa" && actual.pausa) guardar({ ...actual, pausa: { ...actual.pausa, avisada: true } });
      else if (clave === "reanudar") guardar({ ...actual, reanudarPendiente: false });
      else if (clave === "lectura" && actual.lectura) guardar({ ...actual, lectura: { ...actual.lectura, avisada: true } });
    },
    /** Para el latido y el panel "Coordinador en vivo". */
    resumen() {
      const actual = estadoGuardado();
      return {
        activa: ajuste.activa,
        umbral: ajuste.umbral,
        sesion: ultimoUso?.sesion ?? null,
        semana: ultimoUso?.semana ?? null,
        leidoEn: ultimaLectura ? new Date(ultimaLectura).toISOString() : null,
        pausado: Boolean(actual.pausa),
        reiniciaEn: actual.pausa?.reiniciaEn ? new Date(actual.pausa.reiniciaEn).toISOString() : null,
        sinLeerDesde: actual.lectura ? new Date(actual.lectura.desde).toISOString() : null,
      };
    },
  };
  return api;
}
