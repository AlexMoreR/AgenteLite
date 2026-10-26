// RECOGER LOS ERRORES VIEJOS (26-oct-2026). La autorreparación (bucle.mjs: manejarFalla) solo actúa sobre fallas NUEVAS: las 7
// tarjetas que quedaron en ERROR el 23-24 de octubre nadie las volvió a tocar. Una vez al día (y la primera vez que arranca con
// este cambio) el Coordinador revisa TODAS las tarjetas en ERROR, les aplica el mismo diagnóstico de la autorreparación
// (diagnostico.mjs) y hace una de tres cosas:
//   - REINTENTAR si la causa fue pasajera (un build trabado, el PC cargado, el límite de Claude, un choque con main);
//   - PARTIR si fue por tiempo o por tamaño (las hijas quedan en orden; si son grandes, van a la nube al construirse);
//   - dejar UNA LÍNEA PARA EL DUEÑO si necesita una decisión o una clave ("Falta que decidas A o B sobre la carpeta de Drive").
// Si el texto de la tarjeta nombra otra como molde o requisito (medir.mjs), antes de reintentarla pone la flecha de dependencia:
// queda «Esperando a «X»», no en ERROR otra vez.
//
// Topes para no dar vueltas infinitas: cada tarjeta se recoge máximo 2 veces (el CRM lo exige: 409; si vuelve a fallar queda en
// ERROR con su motivo y no se reintenta sola) y se recogen máximo `recogerErrores.maximoPorDia` (6) tarjetas por día.
// Lo que se recuerda: cuántas veces se recogió cada tarjeta y la línea para el dueño van en `resultado.recogida` de la tarjeta;
// la fecha de la última pasada va en recoger-errores.json, en la carpeta de trabajo del Coordinador (aizen1).
// Cerrar o pasar a FALLIDO una tarjeta NUNCA se hace acá: es decisión del dueño.
import fs from "node:fs";
import path from "node:path";

import { diagnosticar, enUnaLinea } from "./diagnostico.mjs";
import { dependenciasNombradas } from "./medir.mjs";
import { fechaBogota } from "./motores.mjs";
import { horaEnBogota } from "./manual-nocturno.mjs";

/** Cuántas veces se recoge una misma tarjeta (igual que TOPE_DE_RECOGIDAS_POR_TARJETA del CRM). */
export const TOPE_DE_RECOGIDAS_POR_TARJETA = 2;

export const rutaDelEstadoDeRecoger = (carpetaTrabajo) => path.join(carpetaTrabajo, "recoger-errores.json");

export function leerEstadoDeRecoger(carpetaTrabajo) {
  try {
    return JSON.parse(fs.readFileSync(rutaDelEstadoDeRecoger(carpetaTrabajo), "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function guardarEstadoDeRecoger(carpetaTrabajo, estado) {
  fs.mkdirSync(carpetaTrabajo, { recursive: true });
  const ruta = rutaDelEstadoDeRecoger(carpetaTrabajo);
  fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify(estado, null, 2)}\n`);
  fs.renameSync(`${ruta}.tmp`, ruta);
  return estado;
}

/** Categorías pasajeras: no son culpa de la tarea, se reintenta. */
const PASAJERAS = new Set(["limite_claude", "pc_sobrecargado", "carpeta_trabada", "coordinador_cortado", "sesion_atascada", "choca_con_main"]);
/** Por tiempo o por tamaño: se parte (si se puede). */
const POR_TAMANO = new Set(["tiempo_agotado", "tarea_muy_grande"]);

/** Frases de una tarjeta que pide algo del dueño: una decisión (A o B, "decide…") o una clave. */
const PIDE_DECISION = /(?:decid\w+|decisi[oó]n)[^\n]{0,80}?(?:\bA\s*(?:\/|o)\s*B\b|opci[oó]n|elegir|cu[aá]l)|\bA\s*(?:\/|o)\s*B\b[^\n]{0,80}?(?:decid\w+|decisi[oó]n|elegir)|falta (?:que )?(?:decidas|decida\w*|elijas|tu decisi[oó]n)|pide (?:al due[ñn]o )?(?:que )?decid\w+/i;
const PIDE_CLAVE = /falta (?:una |la |el |tu )?(?:clave|token|contrase[ñn]a|api[ _-]?key|credencial\w*)|necesita (?:una |la |el )?(?:clave|token|contrase[ñn]a|credencial\w*)|(?:clave|token|api[ _-]?key) (?:inv[aá]lid[ao]|vencid[ao]|faltante)/i;

/**
 * ¿La tarjeta necesita algo del dueño (una decisión o una clave)? -> la línea para él, o null. Mira el motivo del error, el
 * último error y el plan (el plan del Cerebro pide decidir A/B sobre la carpeta de Drive).
 */
export function lineaParaElDueno(item) {
  const textos = [item.motivo, item.ultimoError, item.plan].filter(Boolean);
  for (const texto of textos) {
    for (const linea of String(texto).split(/\r?\n/)) {
      const limpia = linea.replace(/^[\s#*>\-•\d.)]+/, "").replace(/\*\*/g, "").trim();
      if (PIDE_CLAVE.test(limpia)) return enUnaLinea(`Falta una clave o permiso: ${limpia}`, 300);
      if (PIDE_DECISION.test(limpia)) return enUnaLinea(`Falta que decidas: ${limpia}`, 300);
    }
  }
  return null;
}

/**
 * Decide qué hacer con UNA tarjeta en ERROR (pura). `item` es una de `enError` de /errores del CRM.
 *   -> { accion: "reintentar" | "partir" | "dueno" | "dejar", categoria, causa, linea?, depende: [ids], motivo }
 * "dejar" = no se toca (espera la respuesta del dueño, o ya se recogió el máximo).
 */
export function decidirRecogida(item, { topeRecogidas = TOPE_DE_RECOGIDAS_POR_TARJETA } = {}) {
  const etapa = item.cayoEn === "PLANEANDO" ? "planear" : item.cayoEn === "SUBIENDO" ? "subir" : "construir";
  const base = { categoria: "otra", causa: "", depende: [] };
  if (item.lineaDueno) return { ...base, accion: "dejar", motivo: `espera la respuesta del dueño: ${item.lineaDueno}` };
  if ((Number(item.recogidas) || 0) >= topeRecogidas) return { ...base, accion: "dejar", motivo: `ya se recogió ${item.recogidas} veces: se queda en ERROR con su motivo` };

  const textoError = item.ultimoError || item.motivo || "";
  const diagnostico = diagnosticar({ error: textoError, etapa, textoLog: item.motivo ?? "", tarjeta: item });
  const comun = { categoria: diagnostico.categoria, causa: diagnostico.causa, depende: dependenciasNombradas(item) };

  // 1. Necesita algo del dueño: UNA línea y no se reintenta (reintentar daría el mismo error).
  const linea = lineaParaElDueno(item);
  if (linea) return { ...comun, accion: "dueno", linea, motivo: "pide una decisión o una clave del dueño" };

  // 2. Fue por tiempo o por tamaño: se parte (una parte o una ya partida no se parte otra vez).
  if (POR_TAMANO.has(diagnostico.categoria)) {
    if (!item.esParte && !item.yaPartida) return { ...comun, accion: "partir", motivo: `${diagnostico.categoria}: se parte en partes pequeñas` };
    return { ...comun, accion: "reintentar", motivo: `${diagnostico.categoria} pero ya es una parte: se reintenta` };
  }

  // 3. Pasajera: se reintenta. Las demás (no compila, pruebas, lint, migración, no cambió nada, otra): una vez, con la base
  //    nueva de main; si ya se recogió, es de alguien.
  if (PASAJERAS.has(diagnostico.categoria)) return { ...comun, accion: "reintentar", motivo: `${diagnostico.categoria}: causa pasajera, se reintenta` };
  if ((Number(item.recogidas) || 0) === 0) return { ...comun, accion: "reintentar", motivo: `${diagnostico.categoria}: se reintenta una vez sobre lo último de main` };
  return {
    ...comun,
    accion: "dueno",
    linea: enUnaLinea(`Ya se reintentó y sigue fallando (${diagnostico.causa}): necesita que alguien lo mire en Detalles técnicos.`, 300),
    motivo: `${diagnostico.categoria}: ya se recogió y sigue fallando`,
  };
}

/**
 * crearRecogedorDeErrores({ crm, config, registro, avisar, partir, ahora? }) -> { revisar(), recogerYa() }
 *   revisar()   mira si toca (primera vez, o un día nuevo y ya pasó la hora de Bogotá) y, si toca, recoge. { hizo, motivo }
 *   recogerYa() recoge ahora (las pruebas y el --una-vez): { revisadas, reintentadas, partidas, alDueno, saltadas }
 *   partir(tarjeta, { causa, error }) -> [{ titulo, detalle }]  (bucle.mjs: planificador.partirParaRecoger)
 */
export function crearRecogedorDeErrores({ crm, config, registro, avisar = async () => undefined, partir, ahora = () => new Date() }) {
  const opciones = config.recogerErrores ?? { activo: true, hora: 6, maximoPorDia: 6 };

  async function recogerUna(item, decision) {
    const comun = { causa: decision.causa, categoria: decision.categoria };
    if (decision.accion === "dueno") {
      await crm.recoger(item.id, { decision: "dueno", linea: decision.linea });
      return "dueno";
    }
    // Las flechas primero: la tarjeta que nombra a otra como molde no arranca hasta que la otra esté HECHO.
    for (const origenId of decision.depende) {
      try {
        const respuesta = await crm.depender(item.id, origenId);
        if (respuesta?.creada) registro.info(`recoger errores: "${item.titulo}" ${String(respuesta.etiqueta ?? "espera a otra").replace(/^Esperando/, "esperando")}`);
      } catch (error) {
        registro.aviso(`recoger errores: no se pudo poner la dependencia de "${item.titulo}" (${String(error.message).split("\n")[0]})`);
      }
    }
    if (decision.accion === "partir") {
      let partes;
      try {
        partes = await partir({ ...item, tablero: "Tablero IA", intentos: Number(item.intentos) || 0 }, { causa: decision.causa, error: item.ultimoError ?? item.motivo ?? "" });
      } catch (error) {
        if (error?.limiteDeUso) throw error;
        // Sin partes no hay partida: se reintenta entera una vez más si quedan recogidas, o queda la línea para el dueño.
        registro.aviso(`recoger errores: no se pudo partir "${item.titulo}" (${String(error.message).split("\n")[0]}): se reintenta entera`);
        await crm.recoger(item.id, { decision: "reintentar", ...comun });
        return "reintentar";
      }
      await crm.recoger(item.id, { decision: "partir", ...comun, partes, error: item.ultimoError ?? "" });
      return "partir";
    }
    await crm.recoger(item.id, { decision: "reintentar", ...comun });
    return "reintentar";
  }

  async function recogerYa() {
    const { enError } = await crm.errores();
    const resumen = { revisadas: enError.length, reintentadas: 0, partidas: 0, alDueno: 0, saltadas: 0, fallos: 0, tarjetas: [] };
    let hechas = 0;
    for (const item of enError) {
      const decision = decidirRecogida(item);
      if (decision.accion === "dejar") {
        resumen.saltadas += 1;
        registro.info(`recoger errores: dejo "${item.titulo}" como está (${decision.motivo})`);
        continue;
      }
      if (hechas >= opciones.maximoPorDia) {
        resumen.saltadas += 1;
        continue;
      }
      try {
        const hizo = await recogerUna(item, decision);
        hechas += 1;
        registro.info(`recoger errores: "${item.titulo}" -> ${hizo} (${decision.motivo})${hizo === "dueno" ? `: ${decision.linea}` : ""}`);
        resumen.tarjetas.push({ id: item.id, titulo: item.titulo, hizo, linea: hizo === "dueno" ? decision.linea : null });
        if (hizo === "reintentar") resumen.reintentadas += 1;
        else if (hizo === "partir") resumen.partidas += 1;
        else resumen.alDueno += 1;
      } catch (error) {
        if (error?.limiteDeUso) {
          registro.aviso("recoger errores: Claude llegó a su límite de uso; sigo mañana con las que falten");
          break;
        }
        resumen.fallos += 1;
        registro.aviso(`recoger errores: no se pudo recoger "${item.titulo}": ${String(error.message).split("\n")[0]}`);
      }
    }
    return resumen;
  }

  return {
    recogerYa,
    async revisar() {
      if (!opciones.activo) return { hizo: false, motivo: "apagado" };
      const fecha = ahora();
      const hoy = fechaBogota(fecha);
      const estado = leerEstadoDeRecoger(config.carpetaTrabajo);
      // La primera vez que arranca con este cambio (sin archivo) recoge enseguida, a cualquier hora; después, una vez al día.
      if (estado?.dia === hoy) return { hizo: false, motivo: "ya_hecho" };
      if (estado && horaEnBogota(fecha) < opciones.hora) return { hizo: false, motivo: "antes_de_la_hora" };
      registro.info(`recoger errores: reviso las tarjetas en ERROR${estado ? "" : " (primera vez con este cambio)"}`);
      try {
        const resumen = await recogerYa();
        guardarEstadoDeRecoger(config.carpetaTrabajo, { dia: hoy, ...resumen, cuando: fecha.toISOString() });
        if (resumen.reintentadas + resumen.partidas + resumen.alDueno > 0) {
          const lineas = resumen.tarjetas.filter((una) => una.linea).map((una) => `«${una.titulo}»: ${una.linea}`);
          try {
            await avisar(
              `Recogí ${resumen.reintentadas + resumen.partidas + resumen.alDueno} error(es) viejo(s) del tablero: ${resumen.reintentadas} reintentada(s), ${resumen.partidas} partida(s), ${resumen.alDueno} esperan tu respuesta.${lineas.length ? ` ${lineas.join(" ")}` : ""}`.slice(0, 900),
            );
          } catch (error) {
            registro.aviso(`recoger errores: no se pudo avisar (${String(error.message).split("\n")[0]})`);
          }
        }
        return { hizo: true, ...resumen };
      } catch (error) {
        // Sin guardar el día: se reintenta en la próxima vuelta (el CRM caído o sin red no debe saltarse el día).
        registro.aviso(`recoger errores: no se pudo (${String(error.message).split("\n")[0]}); lo intento en la próxima vuelta`);
        return { hizo: false, motivo: "fallo", error: String(error.message).split("\n")[0] };
      }
    },
  };
}
