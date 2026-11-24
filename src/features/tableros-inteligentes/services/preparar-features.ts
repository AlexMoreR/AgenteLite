import { createHash } from "node:crypto";

import { Prisma, type EstadoTarjeta } from "@prisma/client";

import { ORIGEN_COORDINADOR } from "@/features/alertas/dominio/reglas";
import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { prisma } from "@/lib/prisma";

import { aprobarSolaLaTarea } from "./aprobacion-automatica";
import { avisoDeQueNecesita, avisosPrendidos, claveDelAvisoDelCoordinador, porQueNecesitaAlDueno, prioridadDelAviso } from "./avisos-al-dueno";
import { claveDelAreaFeatures, leerAreaFeatures } from "./coordinador-en-vivo";
import { normalizar } from "./reglas-riesgo";
import { repoPorElTexto } from "./repo-por-el-texto";
import { SQL_POR_PREPARAR_EN_FEATURES } from "./sql-trabajador";
import { estaArchivado } from "./tableros-archivados";

/*
  FEATURES SOLAS (24-nov-2026, "Coordinador: tomar y desarrollar TODO lo que cuelga de Features", parte 3). Cada vuelta del
  reloj (/api/cron/follows) prepara sola las tarjetas que cuelgan del Área Features (sub-áreas incluidas) para que el
  Coordinador las tome sin que el dueño elija el repositorio. Solo mira las de IDEA o POR_APROBAR que nadie empezó (intentos = 0):
  - Una Idea con hijas vivas no se toca: sus hijas son el trabajo.
  - Sin repo, lo elige por el texto (repo-por-el-texto.ts): con uno, lo pone; con 'los-dos', la original queda como madre, sin
    cambios, y se crean dos Tareas hijas (una de Gestión y una del CRM); sin saber, deja la pregunta en el historial y abre la
    alerta "el Coordinador pregunta" (`coord:necesita:<id>:…`, solo en la página). La vuelta siguiente vuelve a leer el texto.
  - Una Idea (sin hijas) con repo pasa al tipo Tarea del mismo tablero (historial "editar").
  - Con tipo Tarea y repo pasa a POR_APROBAR y sigue la aprobación de siempre (aprobarSolaLaTarea, sin cambiar sus reglas). La
    que espera el sí del dueño (dinero de Gestión, gasto en Meta Ads, libro V3) queda POR_APROBAR con su alerta `auto:necesita`.
  No manda nada por WhatsApp: las alertas quedan en la página (los avisos de siempre deciden después si sale algo).

  Interruptor por negocio en AppSetting `tablero:features-solas:<negocio>`: sin la fila está PRENDIDO; con "false" no hace nada.
*/

export const claveDelInterruptorDeFeaturesSolas = (negocioId: string) => `tablero:features-solas:${negocioId}`;

/** Quien firma en el historial lo que hace esta vuelta (no es una persona ni el Coordinador de aizen1). */
export const QUIEN_FEATURES_SOLAS = "sistema:features-solas";

/** ¿Está prendida la preparación sola de Features en este negocio? Sin la fila, sí. */
export async function featuresSolasPrendido(negocioId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDelInterruptorDeFeaturesSolas(negocioId) }, select: { value: true } });
  return fila?.value !== "false";
}

export type ResultadoDePrepararFeatures = {
  revisadas: number;
  pasadasATarea: number;
  conRepo: number;
  partidas: number;
  preguntadas: number;
  aprobadas: number;
  esperanAlDueno: number;
};

const vacio = (): ResultadoDePrepararFeatures => ({ revisadas: 0, pasadasATarea: 0, conRepo: 0, partidas: 0, preguntadas: 0, aprobadas: 0, esperanAlDueno: 0 });

type Tipo = { id: string; nombre: string; requiereAprobacion: boolean; usaEstados: boolean; orden: number };

const esTipo = (tipo: { nombre: string } | null | undefined, nombre: string) => normalizar(tipo?.nombre ?? "") === nombre;

/** El tipo Tarea del tablero: el que se llama "Tarea" y, si no hay, el primero que pide aprobación y tiene estados. */
function tipoTareaDe(tipos: readonly Tipo[]): Tipo | null {
  return tipos.find((tipo) => esTipo(tipo, "tarea")) ?? [...tipos].sort((a, b) => a.orden - b.orden).find((tipo) => tipo.requiereAprobacion && tipo.usaEstados) ?? null;
}

/** La huella del texto que se preguntó: si el dueño no lo cambió, no se vuelve a preguntar en cada vuelta. */
const huella = (titulo: string, detalle: string) => createHash("sha1").update(`${titulo}\n${detalle}`).digest("hex").slice(0, 16);

/** La pregunta que queda en el historial y en la alerta (fija por tarjeta: la clave de la alerta no cambia entre vueltas). */
export function preguntaDelRepo(titulo: string): string {
  const corto = titulo.replace(/\s+/g, " ").trim().slice(0, 80);
  return `El Coordinador pregunta: «${corto}» no dice en qué sistema va. ¿Es de Gestión (magilus.com, ventas, órdenes, cotizaciones) o del CRM (chats, WhatsApp, tablero, alertas)? Escríbelo en el detalle y la tomo sola en la próxima vuelta.`;
}

/** La aclaración que lleva cada hija cuando la tarjeta es de los dos sistemas. */
export function aclaracionDeLaParte(repo: "gestion" | "aizencrm"): string {
  return repo === "gestion"
    ? "PARTE DE GESTIÓN (repo gestion): haz solo lo que toca Gestión (magilus.com). Lo del CRM va en la tarjeta hermana."
    : "PARTE DEL CRM (repo aizencrm): haz solo lo que toca el CRM. Lo de Gestión va en la tarjeta hermana.";
}

type Fila = {
  id: string;
  tableroId: string;
  titulo: string;
  detalle: string;
  estado: EstadoTarjeta;
  repo: string | null;
  intentos: number;
  tipoId: string;
  padreId: string | null;
  area: string | null;
  orden: number;
  zonaProtegida: string[];
  riesgo: string | null;
  riesgoMotivo: string | null;
  riesgoPor: string | null;
  prioridad: string;
  creadoPor: string;
  actualizadoEn: Date;
  tipo: { nombre: string; usaEstados: boolean };
};

async function anotar(tx: Prisma.TransactionClient, tarjetaId: string, accion: string, antes: Record<string, unknown> | null, despues: Record<string, unknown>) {
  await tx.historialTarjeta.create({
    data: {
      tarjetaId,
      quien: QUIEN_FEATURES_SOLAS,
      origen: "TRABAJADOR",
      accion,
      antes: antes === null ? Prisma.DbNull : (antes as Prisma.InputJsonValue),
      despues: despues as Prisma.InputJsonValue,
    },
  });
}

/** ¿Esta vuelta ya dejó esta marca (pregunta con la misma huella, o la partida en dos) en el historial de la tarjeta? */
async function yaAnotado(tarjetaId: string, marca: (despues: Record<string, unknown>) => boolean): Promise<boolean> {
  const filas = await prisma.historialTarjeta.findMany({
    where: { tarjetaId, accion: "estado" },
    orderBy: { creadoEn: "desc" },
    take: 50,
    select: { quien: true, despues: true },
  });
  return filas.some((fila) => fila.quien === QUIEN_FEATURES_SOLAS && fila.despues !== null && typeof fila.despues === "object" && marca(fila.despues as Record<string, unknown>));
}

/** Sin repo y sin saber cuál: la pregunta en el historial (una vez por texto) y la alerta "el Coordinador pregunta". */
async function preguntar(negocioId: string, tarjeta: Fila): Promise<boolean> {
  const firma = huella(tarjeta.titulo, tarjeta.detalle);
  if (await yaAnotado(tarjeta.id, (despues) => despues.preguntaFeatures === firma)) return false;
  const texto = preguntaDelRepo(tarjeta.titulo);
  await prisma.$transaction(async (tx) => {
    // Queda como una nota de estado (sin cambiar el estado): la ficha la muestra con su texto.
    await anotar(tx, tarjeta.id, "estado", { estado: tarjeta.estado }, { estado: tarjeta.estado, nota: texto, preguntaFeatures: firma });
    await tx.tableroInteligente.update({ where: { id: tarjeta.tableroId }, data: { actualizadoEn: new Date() } });
  });
  await registrarAlerta({
    workspaceId: negocioId,
    clave: claveDelAvisoDelCoordinador("necesita", texto, tarjeta.id),
    prioridad: prioridadDelAviso("necesita", texto),
    titulo: `«${tarjeta.titulo.replace(/\s+/g, " ").trim().slice(0, 80)}»: el Coordinador pregunta en qué sistema va`,
    detalle: texto,
    origen: ORIGEN_COORDINADOR,
    refrescar: false,
  });
  return true;
}

/** De los dos sistemas: la original queda como madre, sin cambios, y nacen dos Tareas hijas (Gestión y CRM). Devuelve sus ids. */
async function partirEnDos(tarjeta: Fila, tarea: Tipo): Promise<string[]> {
  if (await yaAnotado(tarjeta.id, (despues) => Array.isArray(despues.partidaEnDos))) return [];
  // Cuelgan de la original si el tipo Tarea puede colgar de su tipo; si no, del mismo lugar que la original.
  const puedeColgar = Boolean(
    await prisma.tipoTarjetaPadre.findUnique({ where: { tipoId_tipoPadreId: { tipoId: tarea.id, tipoPadreId: tarjeta.tipoId } }, select: { tipoId: true } }),
  );
  const padreId = puedeColgar ? tarjeta.id : tarjeta.padreId;
  return prisma.$transaction(async (tx) => {
    // La original no se toca: si cambió un instante antes (alguien la editó), se deja para la vuelta siguiente.
    const sigue = await tx.tarjetaTablero.findFirst({ where: { id: tarjeta.id, actualizadoEn: tarjeta.actualizadoEn, repo: null, borradoEn: null }, select: { id: true } });
    if (!sigue) return [];
    const hijas: string[] = [];
    for (const [indice, repo] of (["gestion", "aizencrm"] as const).entries()) {
      const detalle = `${tarjeta.detalle.trimEnd()}\n\n${aclaracionDeLaParte(repo)}`.trim();
      const hija = await tx.tarjetaTablero.create({
        data: {
          tableroId: tarjeta.tableroId,
          titulo: tarjeta.titulo,
          detalle,
          area: tarjeta.area,
          estado: "POR_APROBAR",
          orden: tarjeta.orden + indice + 1,
          tipoId: tarea.id,
          padreId,
          repo,
          zonaProtegida: tarjeta.zonaProtegida,
          riesgo: tarjeta.riesgo,
          riesgoMotivo: tarjeta.riesgoMotivo,
          riesgoPor: tarjeta.riesgoPor,
          prioridad: tarjeta.prioridad,
          creadoPor: tarjeta.creadoPor,
        },
        select: { id: true },
      });
      hijas.push(hija.id);
      await anotar(tx, hija.id, "crear", null, { titulo: tarjeta.titulo, estado: "POR_APROBAR", tipoId: tarea.id, repo, padreId, madreFeatures: tarjeta.id });
    }
    // La marca en la madre (sin cambiar nada de ella): así no se vuelve a partir aunque las hijas cuelguen de otro lado.
    await anotar(tx, tarjeta.id, "estado", { estado: tarjeta.estado }, {
      estado: tarjeta.estado,
      nota: "Es de Gestión y del CRM: la partí en dos Tareas, una por repositorio.",
      partidaEnDos: hijas,
    });
    await tx.tableroInteligente.update({ where: { id: tarjeta.tableroId }, data: { actualizadoEn: new Date() } });
    return hijas;
  });
}

/** Con tipo Tarea y repo: la aprobación de siempre; si espera al dueño, su alerta `auto:necesita` en la página. */
async function ponerEnMarcha(negocioId: string, tarjetaId: string, conAvisos: boolean, resultado: ResultadoDePrepararFeatures) {
  const aprobacion = await aprobarSolaLaTarea(tarjetaId);
  if (aprobacion.aprobada) {
    resultado.aprobadas += 1;
    return;
  }
  const tarjeta = await prisma.tarjetaTablero.findFirst({
    where: { id: tarjetaId, borradoEn: null },
    select: { id: true, titulo: true, detalle: true, estado: true, plan: true, zonaProtegida: true },
  });
  if (!tarjeta || tarjeta.estado !== "POR_APROBAR") return;
  const motivo = porQueNecesitaAlDueno({ ...tarjeta, error: null });
  if (!motivo) return;
  resultado.esperanAlDueno += 1;
  if (!conAvisos) return;
  const aviso = avisoDeQueNecesita(tarjeta, motivo);
  await registrarAlerta({ workspaceId: negocioId, clave: aviso.clave, prioridad: aviso.prioridad, titulo: aviso.titulo, detalle: aviso.lineas.join("\n"), origen: ORIGEN_COORDINADOR, refrescar: false });
}

/**
 * Una vuelta para un negocio (ver arriba). Sin el id de Features guardado, o con el interruptor apagado, no hace nada. Una
 * tarjeta que falla no corta a las demás. Devuelve lo que hizo.
 */
export async function prepararFeatures(negocioId: string, ahora: Date = new Date()): Promise<ResultadoDePrepararFeatures> {
  const resultado = vacio();
  const area = await leerAreaFeatures(negocioId);
  if (!area) return resultado;
  if (!(await featuresSolasPrendido(negocioId))) return resultado;
  const filas = await prisma.$queryRawUnsafe<{ id: string }[]>(SQL_POR_PREPARAR_EN_FEATURES, area, negocioId);
  if (!filas.length) return resultado;
  const conAvisos = await avisosPrendidos(negocioId).catch(() => true);
  const tiposPorTablero = new Map<string, Tipo[]>();
  const archivado = new Map<string, boolean>();

  for (const { id } of filas) {
    try {
      const tarjeta = (await prisma.tarjetaTablero.findFirst({
        where: { id, borradoEn: null },
        select: {
          id: true,
          tableroId: true,
          titulo: true,
          detalle: true,
          estado: true,
          repo: true,
          intentos: true,
          tipoId: true,
          padreId: true,
          area: true,
          orden: true,
          zonaProtegida: true,
          riesgo: true,
          riesgoMotivo: true,
          riesgoPor: true,
          prioridad: true,
          creadoPor: true,
          actualizadoEn: true,
          tipo: { select: { nombre: true, usaEstados: true } },
        },
      })) as Fila | null;
      if (!tarjeta || (tarjeta.estado !== "IDEA" && tarjeta.estado !== "POR_APROBAR") || tarjeta.intentos !== 0 || !tarjeta.tipo.usaEstados) continue;
      if (!archivado.has(tarjeta.tableroId)) archivado.set(tarjeta.tableroId, await estaArchivado(negocioId, tarjeta.tableroId));
      if (archivado.get(tarjeta.tableroId)) continue;
      if (!tiposPorTablero.has(tarjeta.tableroId)) {
        tiposPorTablero.set(
          tarjeta.tableroId,
          await prisma.tipoTarjeta.findMany({
            where: { tableroId: tarjeta.tableroId },
            select: { id: true, nombre: true, requiereAprobacion: true, usaEstados: true, orden: true },
          }),
        );
      }
      const tarea = tipoTareaDe(tiposPorTablero.get(tarjeta.tableroId) ?? []);
      if (!tarea) continue;
      const esIdea = esTipo(tarjeta.tipo, "idea");
      // Solo Ideas y Tareas: otro tipo (uno propio del tablero) se deja como está.
      if (!esIdea && tarjeta.tipoId !== tarea.id) continue;
      resultado.revisadas += 1;
      const hijasVivas = await prisma.tarjetaTablero.count({ where: { padreId: tarjeta.id, borradoEn: null } });
      // Una Idea con hijas no se toca: sus hijas son el trabajo.
      if (esIdea && hijasVivas > 0) continue;

      let repo = tarjeta.repo;
      if (!repo) {
        // Una Tarea sin repo que ya tiene hijas ya se partió (o la partieron a mano): sus hijas son el trabajo.
        if (hijasVivas > 0) continue;
        const elegido = repoPorElTexto(tarjeta.titulo, tarjeta.detalle);
        if (elegido === null) {
          if (await preguntar(negocioId, tarjeta)) resultado.preguntadas += 1;
          continue;
        }
        if (elegido === "los-dos") {
          const hijas = await partirEnDos(tarjeta, tarea);
          if (hijas.length) resultado.partidas += 1;
          for (const hija of hijas) await ponerEnMarcha(negocioId, hija, conAvisos, resultado);
          continue;
        }
        repo = elegido;
      }

      // El tipo Tarea, el repo y POR_APROBAR, en un solo cambio con su historial "editar".
      const datos: Prisma.TarjetaTableroUncheckedUpdateManyInput = {};
      const antes: Record<string, unknown> = {};
      const despues: Record<string, unknown> = {};
      if (esIdea) {
        datos.tipoId = tarea.id;
        antes.tipoId = tarjeta.tipoId;
        despues.tipoId = tarea.id;
      }
      if (!tarjeta.repo) {
        datos.repo = repo;
        antes.repo = null;
        despues.repo = repo;
      }
      if (tarjeta.estado !== "POR_APROBAR") {
        datos.estado = "POR_APROBAR";
        antes.estado = tarjeta.estado;
        despues.estado = "POR_APROBAR";
      }
      if (Object.keys(datos).length) {
        const hecho = await prisma.$transaction(async (tx) => {
          // Condicionado a lo que se leyó: si alguien la editó un instante antes, se deja para la vuelta siguiente.
          const cambio = await tx.tarjetaTablero.updateMany({
            where: { id: tarjeta.id, estado: tarjeta.estado, actualizadoEn: tarjeta.actualizadoEn, intentos: 0, borradoEn: null },
            data: datos,
          });
          if (cambio.count !== 1) return false;
          await anotar(tx, tarjeta.id, "editar", antes, { ...despues, motivo: "Features solas: el Coordinador la prepara para tomarla sin pedir el repositorio" });
          await tx.tableroInteligente.update({ where: { id: tarjeta.tableroId }, data: { actualizadoEn: ahora } });
          return true;
        });
        if (!hecho) continue;
        if (esIdea) resultado.pasadasATarea += 1;
        if (!tarjeta.repo) resultado.conRepo += 1;
      }
      await ponerEnMarcha(negocioId, tarjeta.id, conAvisos, resultado);
    } catch (error) {
      console.error("[preparar-features] no se pudo preparar la tarjeta", id, error instanceof Error ? error.message : String(error));
    }
  }
  return resultado;
}

/** La vuelta del reloj: cada negocio que tiene guardado el id de Features (lo manda el Coordinador en su latido). Nunca lanza por un negocio. */
export async function prepararFeaturesDeTodos(ahora: Date = new Date()): Promise<number> {
  const prefijo = claveDelAreaFeatures("");
  const filas = await prisma.appSetting.findMany({ where: { key: { startsWith: prefijo } }, select: { key: true } });
  let hechas = 0;
  for (const { key } of filas) {
    const negocioId = key.slice(prefijo.length);
    if (!negocioId) continue;
    try {
      const r = await prepararFeatures(negocioId, ahora);
      hechas += r.aprobadas + r.partidas + r.preguntadas;
    } catch (error) {
      console.error("[preparar-features] no se pudo preparar el negocio", negocioId, error instanceof Error ? error.message : String(error));
    }
  }
  return hechas;
}
