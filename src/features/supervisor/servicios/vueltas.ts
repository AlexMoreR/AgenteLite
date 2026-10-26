import { CLAVE_COMBO } from "@/features/embudo/dominio/combo";
import { prisma } from "@/lib/prisma";

import { idsDelComboEnElLibro } from "../dominio/ids-del-combo";

import { consolidar, severidadDelIncidente } from "../dominio/alertas";
import { aplicaRevalidacion, aplicarRevalidaciones, quitarRevalidacion, revalidarIncidente } from "../dominio/revalidacion";
import { agruparCambios, analizarHora, hallazgoDelCambioDelLibro, hallazgosDeArreglo } from "../dominio/analisis";
import { detectarAtencion, esTurnoDelCliente, estadoDeEspera } from "../dominio/detectores-atencion";
import { leerConfigTurno } from "@/lib/turno-config";
import { CONFIG_TURNO_APAGADO } from "@/lib/turno-de-la-conversacion";
import { escenariosDelCombo } from "../dominio/escenarios";
import { correrGuardian } from "../dominio/guardian";
import { diffDelLibro } from "../dominio/libro-diff";
import type { CambioDelLibro } from "../dominio/tipos";
import { guardarIncidentes, leerIncidentesAbiertos } from "./almacen-alertas";
import { CONFIG_GRAVEDAD_POR_DEFECTO, detectarPagoSinRespuesta } from "@/features/avisos-gravedad/dominio/reglas";
import { leerConfigGravedad } from "@/features/avisos-gravedad/servicios/enrutador";
import { avisarTareasSinDuena, gestionarAcciones, leerConfigAccionable } from "@/features/supervisor-accionable/servicios/accionable";
import { avisarAlDueno } from "./avisar";
import { claveLibroVisto, negociosConSupervisor, revalidacionActiva } from "./config";
import { chatsExcluidosDeAtencion, leerChatsAbiertos, leerFichasRecientes, leerFlujosDelLibro, leerLineaDelLibro, nombresDeAsesoras } from "./datos";
import { purgarAcusesConAcuerdo, purgarChatsExcluidos } from "../dominio/exclusiones";
import {
  arreglosDeLosIncidentes,
  confirmarArreglo,
  marcarCambiosDelArreglo,
  versionDelIncidente,
  type Confirmacion,
} from "../dominio/version-del-incidente";
import { hallazgosDeTareasSinDuena, tareasSinDuenaConTurno } from "../dominio/tareas-sin-duena";
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

/*
  Las alertas "Posible dato viejo" de los agentes de área (familia CEREBRO) las cierra el dueño: el Supervisor
  no las vuelve a mirar, ni las cierra, ni las mezcla con sus incidentes (el texto "CEREBRO" no es una Familia del tipo).
*/
const noEsDelCerebro = (inc: { familia: string }) => inc.familia !== "CEREBRO";

let corriendo5 = false;
let corriendoHora = false;

export { idsDelComboEnElLibro };

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
  const abiertos = (await leerIncidentesAbiertos(workspaceId)).filter(noEsDelCerebro);
  const hallazgos = [
    ...(diff ? [hallazgoDelCambioDelLibro({ cambio, diff, informe, producto: CLAVE_COMBO })] : []),
    ...hallazgosDeArreglo({ abiertos, cambio, informe }),
  ];
  // Si la versión nueva arregla un incidente abierto, pasa ya a "arreglado, esperando confirmación".
  const { arreglos, inicios } = arreglosDeLosIncidentes({ abiertos, libros: linea.libros, cambios: linea.cambios, escenarios, flujos });
  const resultado = consolidar({
    abiertos,
    hallazgos,
    ahora,
    cambios: agruparCambios(linea.cambios),
    familiasEvaluadas: [],
    versiones: { arreglos, inicios },
  });
  await guardarIncidentes(workspaceId, resultado.incidentes, ahora);
  await avisarAlDueno({ workspaceId, avisos: resultado.avisar, incidentes: resultado.incidentes, ahora });
  await guardarMarca();
  return hallazgos.length;
}

async function chequearAtencion(workspaceId: string, ahora: Date): Promise<number> {
  // Turno de la conversación (lib/turno-de-la-conversacion.ts). Apagado = exactamente lo de antes.
  const turno = await leerConfigTurno(workspaceId).catch(() => CONFIG_TURNO_APAGADO);
  const chats = await leerChatsAbiertos({ workspaceId, ahora, conTurno: turno.activo });
  const todasSinDuena = await leerTareasSinDuena(workspaceId, ahora).catch(() => []);
  // Con el turno: las tareas sin dueña de chats donde esperamos al cliente no van a la supervisora
  // (salvo formulario / cotización / fecha cercana / caliente).
  const tareasSinDuena = turno.activo ? tareasSinDuenaConTurno(todasSinDuena, chats) : todasSinDuena;
  // Avisos por gravedad: con el interruptor, también "ya pagué" / comprobante sin respuesta (CRÍTICO).
  const gravedad = await leerConfigGravedad(workspaceId).catch(() => null);
  // Supervisor accionable: también necesita el detector de "ya pagué" (es su caso más urgente).
  const accionable = await leerConfigAccionable(workspaceId).catch(() => null);
  const conPago = Boolean(gravedad?.activo || accionable?.activo);
  const hallazgos = [
    ...detectarAtencion(chats, ahora, undefined, { asignadoIgnoraTurno: turno.asignadoSinRespuesta === "siempre" }),
    ...hallazgosDeTareasSinDuena(tareasSinDuena, ahora),
    ...(conPago ? detectarPagoSinRespuesta(chats, ahora, gravedad?.pagoSinRespuestaMin ?? CONFIG_GRAVEDAD_POR_DEFECTO.pagoSinRespuestaMin) : []),
  ];
  const abiertosCrudos = (await leerIncidentesAbiertos(workspaceId)).filter((inc) => inc.familia === "ATENCION");
  // Los chats que ya no son tarea (PERDIDO/GANADO, exterior, dormidos, ya respondidos) salen de las
  // alertas abiertas, y la alerta que queda vacía se cierra (exclusiones.ts).
  const excluidos = await chatsExcluidosDeAtencion(
    workspaceId,
    abiertosCrudos.flatMap((inc) => inc.hallazgos.flatMap((h) => h.evidencia.chats)),
    ahora,
  ).catch(() => new Set<string>());
  // Con el turno: los chats donde ya respondimos y esperamos al cliente también salen de las alertas abiertas.
  if (turno.activo && turno.asignadoSinRespuesta === "turno") {
    for (const chat of chats) if (esTurnoDelCliente(chat)) excluidos.add(chat.conversationId);
  }
  const { incidentes: purgados } = purgarChatsExcluidos(abiertosCrudos, excluidos, ahora);
  // El cliente solo acusa recibo de algo ya acordado: sale de las alertas abiertas (menos las de pago).
  const conAcuse = new Set(chats.filter((chat) => estadoDeEspera(chat, ahora).acuse).map((chat) => chat.conversationId));
  const { incidentes: abiertos } = purgarAcusesConAcuerdo(purgados, conAcuse, ahora);
  const resultado = consolidar({ abiertos, hallazgos, ahora, cambios: [], familiasEvaluadas: ["ATENCION"] });
  await guardarIncidentes(workspaceId, resultado.incidentes, ahora);
  // Con el accionable, avisarAlDueno deja fuera las alertas de chat: las maneja gestionarAcciones.
  await avisarAlDueno({ workspaceId, avisos: resultado.avisar, incidentes: resultado.incidentes, ahora });
  if (accionable?.activo) {
    await gestionarAcciones({ workspaceId, hallazgos, chats, ahora, config: accionable, asignadoIgnoraTurno: turno.asignadoSinRespuesta === "siempre" });
    // Las tareas de seguimiento sin asesora van a la supervisora (no a Alexander).
    await avisarTareasSinDuena({ workspaceId, tareas: tareasSinDuena, ahora, config: accionable });
  }
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
        // Revalidación de incidentes viejos (dominio/revalidacion.ts). Apagada = exactamente lo de antes.
        const revalidar = await revalidacionActiva(workspaceId);
        // El hallazgo de la revalidación de la vuelta anterior sale antes de consolidar: se decide de nuevo.
        const abiertos = quitarRevalidacion((await leerIncidentesAbiertos(workspaceId)).filter((inc) => inc.familia !== "ATENCION" && noEsDelCerebro(inc)));
        // Los incidentes del libro ya arreglados (Change Guardian sobre el historial): se acotan a su
        // versión y se confirman con los leads de después del arreglo (version-del-incidente.ts).
        const ids = idsDelComboEnElLibro(linea.actual);
        const escenarios = ids.productoComboId ? escenariosDelCombo({ productoComboId: ids.productoComboId, flujoFotosCombo: ids.flujoFotosCombo }) : [];
        const flujos = escenarios.length ? await leerFlujosDelLibro(workspaceId, linea.actual).catch(() => ({})) : {};
        const { arreglos, inicios } = arreglosDeLosIncidentes({ abiertos, libros: linea.libros, cambios: linea.cambios, escenarios, flujos });
        const inicioDe = (inc: { clave: string; desde: Date }) => {
          const version = versionDelIncidente(inc.clave);
          return inicios.get(inc.clave) ?? linea.cambios.find((c) => c.version === version)?.en ?? inc.desde;
        };
        const revalidables = revalidar
          ? abiertos.filter((inc) => aplicaRevalidacion({ incidente: inc, versionActual: linea.actual.version, inicio: inicioDe(inc), ahora }))
          : [];
        // Para comparar contra los 14 días ANTES del defecto hace falta leer desde ahí (máx. 30 días).
        const masViejo = Math.min(
          ahora.getTime(),
          ...[...arreglos.keys()].map((clave) => inicios.get(clave)?.getTime() ?? ahora.getTime()),
          ...revalidables.map((inc) => inicioDe(inc).getTime()),
        );
        const dias = Math.min(30, Math.max(16, Math.ceil((ahora.getTime() - masViejo) / 86_400_000) + 15));
        const [fichas, nombres] = await Promise.all([
          leerFichasRecientes({ workspaceId, ahora, versionEn: linea.versionEn, dias }),
          nombresDeAsesoras(workspaceId),
        ]);
        const entradas = new Map(fichas.map((f) => [f.conversationId, f.entradaEn]));
        const confirmaciones = new Map<string, Confirmacion>();
        for (const [clave, arreglo] of arreglos) {
          const inc = abiertos.find((i) => i.clave === clave);
          if (!inc) continue;
          const producto = inc.producto ?? CLAVE_COMBO;
          confirmaciones.set(
            clave,
            confirmarArreglo({ hallazgos: inc.hallazgos, arreglo, inicioDelDefecto: inicios.get(clave) ?? inc.desde, fichas, ahora, filtro: (f) => f.producto === producto }),
          );
        }
        const crudos = analizarHora({
          fichas: dias > 16 ? fichas.filter((f) => ahora.getTime() - f.entradaEn.getTime() <= 16 * 86_400_000) : fichas,
          ahora,
          cambios,
          productos: [{ clave: CLAVE_COMBO, nombre: "Combo de Camilla" }],
          nombresDeAsesoras: nombres,
        });
        const hallazgos = marcarCambiosDelArreglo({
          hallazgos: crudos,
          arreglos: [...arreglos.entries()].map(([clave, arreglo]) => ({ version: versionDelIncidente(clave) as number, arreglo })),
          libros: linea.libros,
        });
        const consolidado = consolidar({
          abiertos,
          hallazgos,
          ahora,
          cambios,
          familiasEvaluadas: ["BOT", "EMBUDO", "CAMBIO"],
          versiones: { arreglos, inicios, confirmaciones, entradaDe: (id) => entradas.get(id) ?? null },
        });
        /*
          Antes de mantener o escalar un incidente técnico viejo, comprobar si SIGUE con la versión
          actual del libro (leads nuevos + simulador). Si ya no ocurre se cierra con la evidencia; si
          falta muestra queda pendiente (no CRÍTICO, sin aviso); si sigue, se escala con datos de hoy.
        */
        const resultado = revalidar
          ? aplicarRevalidaciones({
              incidentes: consolidado.incidentes,
              avisar: consolidado.avisar,
              abiertasAntes: new Set(abiertos.map((inc) => inc.clave)),
              versionActual: linea.actual.version,
              ahora,
              inicioDe,
              severidadDelDefecto: severidadDelIncidente,
              revalidar: (inc) =>
                revalidarIncidente({
                  incidente: inc,
                  fichas,
                  ahora,
                  versionActual: linea.actual.version,
                  libroActual: linea.actual,
                  libros: linea.libros,
                  cambios: linea.cambios,
                  escenarios,
                  flujos,
                  arreglo: arreglos.get(inc.clave) ?? null,
                  inicioDelDefecto: inicioDe(inc),
                  filtro: (f) => f.producto === (inc.producto ?? CLAVE_COMBO),
                }),
            })
          : consolidado;
        await guardarIncidentes(workspaceId, resultado.incidentes, ahora);
        await avisarAlDueno({ workspaceId, avisos: resultado.avisar, incidentes: resultado.incidentes, ahora });
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
