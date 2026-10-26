// RECOGER LOS ERRORES VIEJOS (26-oct-2026). La autorreparación (diagnostico.mjs) solo actúa sobre las fallas NUEVAS: siete
// tarjetas llevaban días en ERROR (23-24 oct) sin que nadie las volviera a tocar. Una vez al día —y la primera vez que arranca
// el Coordinador con este cambio— se revisan TODAS las tarjetas en ERROR y a cada una se le aplica el mismo diagnóstico:
//   - reintentar: la causa fue pasajera (build trabado, PC cargado, límite de Claude, choque con main);
//   - partir: fue por tiempo o por tamaño (las grandes van a la nube cuando se construyan, como siempre);
//   - dejar UNA línea para el dueño: necesita una decisión, una clave, o no es una falla pasajera.
// Topes para no dar vueltas: cada tarjeta se recoge máximo `maximoPorTarjeta` veces (2; el CRM lo exige y lo cuenta en
// resultado.recogida) y se recogen máximo `maximoPorDia` tarjetas por día (6). La fecha de la última recogida va en
// <carpetaTrabajo>/recoger-errores.json (no hay migración).
import fs from "node:fs";
import path from "node:path";

import { diagnosticar, enUnaLinea } from "./diagnostico.mjs";
import { fechaBogota } from "./motores.mjs";

export const RECOGER_POR_DEFECTO = { activo: true, maximoPorDia: 6, maximoPorTarjeta: 2 };

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

/** Lo que dice el error cuando falta algo que solo el dueño puede dar: una decisión o una clave. */
const NECESITA_AL_DUENO = /decid[aeoi]\b|decisi[oó]n|\bA o B\b|\bA\/B\b|opci[oó]n A|clave|token|credencial|contrase[ñn]a|api[ _-]?key|necesita(?:s)? (?:que|tu)|tiene(?:s)? que (?:elegir|decidir)/i;

const PASAJERAS = new Set(["limite_claude", "pc_sobrecargado", "carpeta_trabada", "coordinador_cortado", "sesion_atascada", "choca_con_main"]);
const DE_TAMANO = new Set(["tiempo_agotado", "tarea_muy_grande"]);

/**
 * Qué hacer con una tarjeta en ERROR. `tarjeta` es la de /errores del CRM: { titulo, plan, esParte, recogidas, lineaParaElDueno,
 * motivo, ultimoError, ultimosIntentos }.
 * -> { accion: "reintentar" | "partir" | "dueno" | "saltar", categoria, causa, linea?, nube?, motivo }
 */
export function decidirRecogida(tarjeta, { maximoPorTarjeta = RECOGER_POR_DEFECTO.maximoPorTarjeta } = {}) {
  const veces = Number(tarjeta?.recogidas) || 0;
  const textoDelError = [tarjeta?.motivo, tarjeta?.ultimoError].filter(Boolean).join("\n");
  const ultimoIntento = [...(tarjeta?.ultimosIntentos ?? [])].reverse().find((intento) => intento?.etapa);
  const etapa = ultimoIntento?.etapa ?? (tarjeta?.plan ? "construir" : "planear");
  const diagnostico = diagnosticar({ error: textoDelError, etapa, tarjeta });
  const base = { categoria: diagnostico.categoria, causa: diagnostico.causa };
  if (veces >= maximoPorTarjeta) {
    return { ...base, accion: "saltar", motivo: `ya se recogió ${veces} veces: se queda en ERROR con su línea` };
  }
  if (NECESITA_AL_DUENO.test(textoDelError)) {
    return { ...base, accion: "dueno", linea: enUnaLinea(`Necesita algo tuyo: ${diagnostico.causa}`, 300), motivo: "pide una decisión o una clave del dueño" };
  }
  if (PASAJERAS.has(diagnostico.categoria)) {
    return { ...base, accion: "reintentar", motivo: `causa pasajera (${diagnostico.categoria})` };
  }
  if (DE_TAMANO.has(diagnostico.categoria)) {
    // Una parte ya no se parte más (el CRM lo rechaza): se reintenta, y al ser grande se construye en la nube.
    if (tarjeta?.esParte) return { ...base, accion: "reintentar", nube: true, motivo: "es una parte que se pasó de tiempo: se reintenta (va a la nube)" };
    return { ...base, accion: "partir", nube: true, motivo: "se pasó de tiempo o de tamaño: se parte (lo grande va a la nube)" };
  }
  if (diagnostico.categoria === "no_cambio_nada" || (diagnostico.categoria === "otra" && veces === 0)) {
    return { ...base, accion: "reintentar", motivo: diagnostico.categoria === "otra" ? "causa desconocida: un reintento" : "Claude no cambió nada: se reintenta (al planear mira sus dependencias)" };
  }
  return {
    ...base,
    accion: "dueno",
    linea: enUnaLinea(`No es una falla pasajera (${diagnostico.categoria}): ${diagnostico.causa} Revísala y pulsa Reintentar, o dime que la cierre.`, 300),
    motivo: "una falla que reintentar igual no arregla",
  };
}

/**
 * El recogedor. `partir(tarjeta, causa, error)` devuelve las partes (2 a 4) de una sesión de solo lectura; se inyecta para
 * probar sin Claude. `ahora()` también. Una vez al día: si hoy ya se hizo, no hace nada.
 *   revisar() -> { hizo, motivo?, recogidas: [{ id, titulo, accion, motivo }] }
 */
export function crearRecogedor({ crm, config, registro, partir, ahora = () => new Date() }) {
  const ajustes = () => ({ ...RECOGER_POR_DEFECTO, ...(config.recogerErrores ?? {}) });

  return {
    /** `pausadoPorUso`: "Pausado por uso de Claude" (motores.mjs): no se recoge nada (puede abrir una sesión de Claude para partir). */
    async revisar({ pausadoPorUso = false } = {}) {
      const { activo, maximoPorDia, maximoPorTarjeta } = ajustes();
      if (!activo) return { hizo: false, motivo: "apagado", recogidas: [] };
      if (pausadoPorUso) return { hizo: false, motivo: "pausado por uso de Claude", recogidas: [] };
      const ahoraMs = ahora();
      const hoy = fechaBogota(ahoraMs);
      const previo = leerEstadoDeRecoger(config.carpetaTrabajo);
      if (previo?.fecha === hoy) return { hizo: false, motivo: "ya se hizo hoy", recogidas: [] };
      if (previo?.pausadoHasta && Date.parse(previo.pausadoHasta) > ahoraMs.getTime()) return { hizo: false, motivo: "en pausa por el límite de uso de Claude", recogidas: [] };

      const { tarjetas } = await crm.errores();
      registro.info(`recoger errores viejos: ${tarjetas.length} tarjeta(s) en ERROR (máximo ${maximoPorDia} hoy, ${maximoPorTarjeta} veces cada una)`);
      const recogidas = [];
      let pausadoHasta = null;
      for (const tarjeta of tarjetas) {
        if (recogidas.length >= maximoPorDia) break;
        const decision = decidirRecogida(tarjeta, { maximoPorTarjeta });
        if (decision.accion === "saltar") {
          registro.info(`"${tarjeta.titulo}": ${decision.motivo}`);
          continue;
        }
        // La misma línea para el dueño de ayer no se vuelve a escribir ni gasta un cupo del día.
        if (decision.accion === "dueno" && tarjeta.lineaParaElDueno === decision.linea) continue;
        try {
          if (decision.accion === "reintentar") {
            await crm.recoger(tarjeta.id, { decision: "reintentar", categoria: decision.categoria, causa: enUnaLinea(`Recogida: ${decision.causa}`), error: tarjeta.ultimoError ?? undefined });
          } else if (decision.accion === "partir") {
            const partes = await partir(tarjeta, enUnaLinea(`Recogida: ${decision.causa}`), tarjeta.ultimoError ?? "");
            await crm.recoger(tarjeta.id, { decision: "partir", categoria: decision.categoria === "tiempo_agotado" ? "tiempo_agotado" : "tarea_muy_grande", causa: enUnaLinea(`Recogida: ${decision.causa}`), error: tarjeta.ultimoError ?? undefined, partes, etapa: tarjeta.plan ? "construir" : "planear" });
          } else {
            await crm.recoger(tarjeta.id, { decision: "dueno", linea: decision.linea });
          }
          registro.info(`recogí "${tarjeta.titulo}": ${decision.accion} (${decision.motivo})`);
          recogidas.push({ id: tarjeta.id, titulo: tarjeta.titulo, accion: decision.accion, motivo: decision.motivo });
        } catch (error) {
          if (error?.limiteDeUso) {
            pausadoHasta = new Date(ahoraMs.getTime() + 30 * 60_000).toISOString();
            registro.aviso("recoger errores: Claude llegó a su límite de uso; sigo en 30 min con lo que falta");
            break;
          }
          registro.aviso(`no se pudo recoger "${tarjeta.titulo}" (${decision.accion}): ${String(error?.message ?? error).split("\n")[0]}`);
        }
      }
      guardarEstadoDeRecoger(config.carpetaTrabajo, pausadoHasta ? { ...(previo ?? {}), pausadoHasta } : { fecha: hoy, cuando: ahoraMs.toISOString(), recogidas });
      return { hizo: true, recogidas };
    },
  };
}
