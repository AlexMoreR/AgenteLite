import { CLAVE_COMBO } from "@/features/embudo/dominio/combo";
import type { LibroDeReglas } from "@/features/agente-v3/domain/reglas";
import { prisma } from "@/lib/prisma";

import { consolidar } from "../dominio/alertas";
import { agruparCambios, analizarHora, hallazgoDelCambioDelLibro, hallazgosDeArreglo } from "../dominio/analisis";
import { detectarAtencion } from "../dominio/detectores-atencion";
import { escenariosDelCombo } from "../dominio/escenarios";
import { correrGuardian } from "../dominio/guardian";
import { diffDelLibro } from "../dominio/libro-diff";
import type { CambioDelLibro } from "../dominio/tipos";
import { guardarIncidentes, leerIncidentesAbiertos } from "./almacen-alertas";
import { avisarAlDueno } from "./avisar";
import { claveLibroVisto, negociosConSupervisor } from "./config";
import { chatsExcluidosDeAtencion, leerChatsAbiertos, leerFichasRecientes, leerFlujosDelLibro, leerLineaDelLibro, nombresDeAsesoras } from "./datos";
import { purgarChatsExcluidos } from "../dominio/exclusiones";
import { hallazgosDeTareasSinDuena } from "../dominio/tareas-sin-duena";
import { leerTareasSinDuena } from "@/features/seguimiento-inteligente/servicios/tareas";

/**
 * LAS VUELTAS DEL SUPERVISOR (las llama el reloj de /api/cron/follows).
 *
 * - Cada 5 min: (1) ¿cambió el libro V3? → diff + Change Guardian (tiempo real del libro);
 *   (2) chequeo de atención, determinista y sin IA.
 * - Cada hora: análisis agregado contra la línea base (bot + embudo + asesoras + post-cambio).
 *
 * Todo apagado si `supervisor:activo:<workspaceId>` no vale "true". Nada de esto escribe en el
 * libro, en los chats, en el reparto ni en las etapas: solo guarda sus propias alertas
 * (SupervisorAlerta), la marca de "libro visto" y manda push al dueño.
 */

let corriendo5 = false;
let corriendoHora = false;

/** El producto del combo y su flujo de fotos, sacados del libro (para los escenarios dorados). */
export function idsDelComboEnElLibro(libro: LibroDeReglas): { productoComboId: string | null; flujoFotosCombo: string | null } {
  const conteo = new Map<string, number>();
  let flujoFotosCombo: string | null = null;
  for (const regla of libro.reglas) {
    const producto = regla.soloSi?.productoActivo;
    if (producto && producto !== "ninguno" && producto !== "cualquiera") conteo.set(producto, (conteo.get(producto) ?? 0) + 1);
    for (const accion of regla.entonces) {
      if (accion.tipo === "flujo" && /foto.*combo|combo.*foto/i.test(accion.titulo ?? "")) flujoFotosCombo ??= accion.flujoId;
    }
  }
  const productoComboId = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { productoComboId, flujoFotosCombo };
}

async function vigilarElLibro(workspaceId: string, ahora: Date): Promise<number> {
  const linea = await leerLineaDelLibro(workspaceId);
  const marca = await prisma.appSetting.findUnique({ where: { key: claveLibroVisto(workspaceId) } });
  const vista = marca?.value ? Number(marca.value) : null;
  const actual = linea.actual.version;
  if (vista === actual) return 0;
  const guardarMarca = () =>
    prisma.appSetting.upsert({
      where: { key: claveLibroVisto(workspaceId) },
      create: { key: claveLibroVisto(workspaceId), value: String(actual) },
      update: { value: String(actual) },
    });
  // Primera vez: solo se anota la versión. No se juzga un libro que ya estaba antes de prenderlo.
  if (vista === null || !Number.isFinite(vista)) {
    await guardarMarca();
    return 0;
  }
  const anterior = linea.libros.get(vista) ?? null;
  const ids = idsDelComboEnElLibro(linea.actual);
  const flujos = await leerFlujosDelLibro(workspaceId, linea.actual).catch(() => ({}));
  const escenarios = ids.productoComboId ? escenariosDelCombo({ productoComboId: ids.productoComboId, flujoFotosCombo: ids.flujoFotosCombo }) : [];
  const informe = correrGuardian({ candidato: linea.actual, anterior, escenarios, flujos });
  const diff = anterior ? diffDelLibro(anterior, linea.actual) : null;
  const ultimo = linea.cambios.at(-1);
  const cambio: CambioDelLibro = {
    version: actual,
    anterior: vista,
    en: ultimo && ultimo.version === actual ? ultimo.en : ahora,
    autor: ultimo?.autor ?? null,
    resumen: linea.cambios.filter((c) => c.version > vista && c.version <= actual).map((c) => c.resumen).filter(Boolean).join(" · ") || null,
  };
  const abiertos = await leerIncidentesAbiertos(workspaceId);
  const hallazgos = [
    ...(diff ? [hallazgoDelCambioDelLibro({ cambio, diff, informe, producto: CLAVE_COMBO })] : []),
    ...hallazgosDeArreglo({ abiertos, cambio, informe }),
  ];
  const resultado = consolidar({ abiertos, hallazgos, ahora, cambios: agruparCambios(linea.cambios), familiasEvaluadas: [] });
  await guardarIncidentes(workspaceId, resultado.incidentes, ahora);
  await avisarAlDueno({ workspaceId, avisos: resultado.avisar });
  await guardarMarca();
  return hallazgos.length;
}

async function chequearAtencion(workspaceId: string, ahora: Date): Promise<number> {
  const chats = await leerChatsAbiertos({ workspaceId, ahora });
  const tareasSinDuena = await leerTareasSinDuena(workspaceId, ahora).catch(() => []);
  const hallazgos = [...detectarAtencion(chats, ahora), ...hallazgosDeTareasSinDuena(tareasSinDuena, ahora)];
  const abiertosCrudos = (await leerIncidentesAbiertos(workspaceId)).filter((inc) => inc.familia === "ATENCION");
  // Los chats que ya no son tarea (PERDIDO/GANADO, exterior, dormidos, ya respondidos) salen de las
  // alertas abiertas, y la alerta que queda vacía se cierra (exclusiones.ts).
  const excluidos = await chatsExcluidosDeAtencion(
    workspaceId,
    abiertosCrudos.flatMap((inc) => inc.hallazgos.flatMap((h) => h.evidencia.chats)),
    ahora,
  ).catch(() => new Set<string>());
  const { incidentes: abiertos } = purgarChatsExcluidos(abiertosCrudos, excluidos, ahora);
  const resultado = consolidar({ abiertos, hallazgos, ahora, cambios: [], familiasEvaluadas: ["ATENCION"] });
  await guardarIncidentes(workspaceId, resultado.incidentes, ahora);
  await avisarAlDueno({ workspaceId, avisos: resultado.avisar });
  return hallazgos.length;
}

/** Cada 5 minutos. Devuelve cuántos negocios revisó y cuántos hallazgos hubo. */
export async function vueltaDeCincoMinutos(ahora = new Date()): Promise<{ negocios: number; hallazgos: number }> {
  if (corriendo5) return { negocios: 0, hallazgos: 0 };
  corriendo5 = true;
  try {
    const negocios = await negociosConSupervisor();
    let hallazgos = 0;
    for (const workspaceId of negocios) {
      try {
        hallazgos += await vigilarElLibro(workspaceId, ahora);
      } catch (error) {
        console.error("[supervisor] libro", workspaceId, error instanceof Error ? error.message : error);
      }
      try {
        hallazgos += await chequearAtencion(workspaceId, ahora);
      } catch (error) {
        console.error("[supervisor] atencion", workspaceId, error instanceof Error ? error.message : error);
      }
    }
    return { negocios: negocios.length, hallazgos };
  } finally {
    corriendo5 = false;
  }
}

/** Cada hora: el análisis agregado contra la línea base. */
export async function vueltaDeCadaHora(ahora = new Date()): Promise<{ negocios: number; hallazgos: number }> {
  if (corriendoHora) return { negocios: 0, hallazgos: 0 };
  corriendoHora = true;
  try {
    const negocios = await negociosConSupervisor();
    let total = 0;
    for (const workspaceId of negocios) {
      try {
        const linea = await leerLineaDelLibro(workspaceId);
        const cambios = agruparCambios(linea.cambios);
        const [fichas, nombres] = await Promise.all([
          leerFichasRecientes({ workspaceId, ahora, versionEn: linea.versionEn }),
          nombresDeAsesoras(workspaceId),
        ]);
        const hallazgos = analizarHora({ fichas, ahora, cambios, productos: [{ clave: CLAVE_COMBO, nombre: "Combo de Camilla" }], nombresDeAsesoras: nombres });
        const abiertos = (await leerIncidentesAbiertos(workspaceId)).filter((inc) => inc.familia !== "ATENCION");
        const resultado = consolidar({ abiertos, hallazgos, ahora, cambios, familiasEvaluadas: ["BOT", "EMBUDO", "CAMBIO"] });
        await guardarIncidentes(workspaceId, resultado.incidentes, ahora);
        await avisarAlDueno({ workspaceId, avisos: resultado.avisar });
        total += hallazgos.length;
      } catch (error) {
        console.error("[supervisor] hora", workspaceId, error instanceof Error ? error.message : error);
      }
    }
    return { negocios: negocios.length, hallazgos: total };
  } finally {
    corriendoHora = false;
  }
}
