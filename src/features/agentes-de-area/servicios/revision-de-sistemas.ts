import { prisma } from "@/lib/prisma";

import {
  ESTADOS_QUE_SE_ATASCAN,
  HORAS_DE_REVISION,
  HORAS_PARA_ATASCADA,
  estaAtascada,
  hoyEnBogota,
  lineaDeSistemas,
  pantallasDeArchivos,
  quedoHechoRecien,
  vidaDelTrabajador,
} from "../dominio/reglas";

/**
 * LA REVISIÓN DE SISTEMAS: solo LEE el Tablero IA, la clave del trabajador y el contador de uso, y los entrega ya cruzados
 * al Agente de Sistemas (herramienta `revision_de_sistemas`). No escribe nada.
 */

const comoObjeto = (valor: unknown): Record<string, unknown> => (valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {});
const texto = (valor: unknown): string | null => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/** El nombre de la clave del trabajador que corre en aizen1. */
export const NOMBRE_DE_LA_CLAVE_DEL_TRABAJADOR = "aizen1";

export type TarjetaHecha = {
  tarjetaId: string;
  titulo: string;
  detalle: string;
  tablero: string;
  repo: string | null;
  commit: string | null;
  rama: string | null;
  linkCommit: string | null;
  hechoEn: string;
  /** Pantallas `/cliente/...` que la subida tocó (de los archivos del resultado), para abrirlas y medir su uso. */
  pantallas: string[];
};

/** Las tarjetas que pasaron a HECHO en las últimas `horas` (24 por defecto), con su commit y la hora en que quedaron HECHO. */
export async function tarjetasHechasRecientemente(workspaceId: string, ahora: Date, horas = HORAS_DE_REVISION): Promise<TarjetaHecha[]> {
  const desde = new Date(ahora.getTime() - horas * 3_600_000);
  const filas = await prisma.historialTarjeta.findMany({
    where: { accion: "estado", creadoEn: { gte: desde }, tarjeta: { borradoEn: null, estado: "HECHO", repo: { not: null }, tablero: { workspaceId } } },
    orderBy: { creadoEn: "desc" },
    select: {
      tarjetaId: true,
      creadoEn: true,
      despues: true,
      tarjeta: { select: { titulo: true, detalle: true, repo: true, resultado: true, tablero: { select: { nombre: true } } } },
    },
  });
  // Una tarjeta puede tener varios cambios de estado: cuenta el más reciente que la dejó en HECHO.
  const porTarjeta = new Map<string, TarjetaHecha>();
  for (const fila of filas) {
    if (comoObjeto(fila.despues).estado !== "HECHO" || porTarjeta.has(fila.tarjetaId)) continue;
    if (!quedoHechoRecien(fila.creadoEn, ahora, horas)) continue;
    const resultado = comoObjeto(fila.tarjeta.resultado);
    const subida = comoObjeto(resultado.subida);
    porTarjeta.set(fila.tarjetaId, {
      tarjetaId: fila.tarjetaId,
      titulo: fila.tarjeta.titulo,
      detalle: fila.tarjeta.detalle,
      tablero: fila.tarjeta.tablero.nombre,
      repo: fila.tarjeta.repo,
      commit: texto(subida.commit) ?? texto(resultado.commit),
      rama: texto(resultado.rama),
      linkCommit: texto(subida.linkCommit),
      hechoEn: fila.creadoEn.toISOString(),
      pantallas: pantallasDeArchivos(resultado.archivos),
    });
  }
  return [...porTarjeta.values()];
}

export type TarjetaAtascada = { tarjetaId: string; titulo: string; tablero: string; estado: string; horasAtascada: number; ultimoLatido: string | null };

export async function tarjetasAtascadas(workspaceId: string, ahora: Date): Promise<TarjetaAtascada[]> {
  const filas = await prisma.tarjetaTablero.findMany({
    where: { estado: { in: [...ESTADOS_QUE_SE_ATASCAN] }, borradoEn: null, repo: { not: null }, tablero: { workspaceId } },
    select: { id: true, titulo: true, estado: true, trabajoIniciadoEn: true, actualizadoEn: true, tablero: { select: { nombre: true } } },
  });
  const atascadas: TarjetaAtascada[] = [];
  for (const fila of filas) {
    // El último movimiento de la tarjeta es el último latido del trabajador (cada latido le corre el candado).
    const desde = fila.actualizadoEn ?? fila.trabajoIniciadoEn;
    if (!estaAtascada(fila.estado, desde, ahora)) continue;
    atascadas.push({
      tarjetaId: fila.id,
      titulo: fila.titulo,
      tablero: fila.tablero.nombre,
      estado: fila.estado,
      horasAtascada: Math.round(((ahora.getTime() - (desde as Date).getTime()) / 3_600_000) * 10) / 10,
      ultimoLatido: fila.actualizadoEn ? fila.actualizadoEn.toISOString() : null,
    });
  }
  return atascadas.sort((a, b) => b.horasAtascada - a.horasAtascada);
}

/**
 * El motivo de una tarjeta en ERROR (30-oct-2026). `resultado.error` es una ficha { motivo, en, cuando, categoria, causa }
 * (antes se leía como si fuera un texto y salía "sin motivo guardado" aunque el motivo estuviera guardado). Orden:
 * el motivo de la ficha, la causa de la ficha, el error como texto, `resultado.motivo`, la última causa anotada en los
 * intentos de la tarjeta y, si no hay nada, una frase fija con el estado en que estaba.
 */
export function motivoDeLaTarjetaEnError(resultado: unknown, ultimaCausa: string | null, estado: string | null): string {
  const datos = comoObjeto(resultado);
  const ficha = comoObjeto(datos.error);
  return (
    texto(ficha.motivo) ??
    texto(ficha.causa) ??
    texto(datos.error) ??
    texto(datos.motivo) ??
    texto(ultimaCausa) ??
    `en ERROR sin motivo guardado (estaba en ${texto(ficha.en) ?? texto(estado) ?? "un estado que no se guardó"})`
  );
}

export type TarjetaEnError = { tarjetaId: string; titulo: string; tablero: string; motivo: string };

export async function tarjetasEnError(workspaceId: string): Promise<TarjetaEnError[]> {
  const filas = await prisma.tarjetaTablero.findMany({
    where: { estado: "ERROR", borradoEn: null, repo: { not: null }, tablero: { workspaceId } },
    select: {
      id: true,
      titulo: true,
      resultado: true,
      tablero: { select: { nombre: true } },
      intentosDeTrabajo: { orderBy: { numero: "desc" }, take: 1, select: { causa: true } },
    },
  });
  return filas.map((fila) => ({
    tarjetaId: fila.id,
    titulo: fila.titulo,
    tablero: fila.tablero.nombre,
    motivo: motivoDeLaTarjetaEnError(fila.resultado, fila.intentosDeTrabajo?.[0]?.causa ?? null, "ERROR"),
  }));
}

/** ¿Está vivo el trabajador? Por el último uso de su clave "aizen1" (si no hay con ese nombre, la más usada). */
export async function vidaDelTrabajadorDelNegocio(workspaceId: string, ahora: Date) {
  const claves = await prisma.claveTrabajador.findMany({ where: { workspaceId, revocadaEn: null }, select: { nombre: true, ultimoUsoEn: true } });
  const clave = claves.find((c) => c.nombre.trim().toLowerCase() === NOMBRE_DE_LA_CLAVE_DEL_TRABAJADOR) ?? [...claves].sort((a, b) => (b.ultimoUsoEn?.getTime() ?? 0) - (a.ultimoUsoEn?.getTime() ?? 0))[0];
  const vida = vidaDelTrabajador(clave?.ultimoUsoEn ?? null, ahora);
  return { clave: clave?.nombre ?? null, ultimo_uso: clave?.ultimoUsoEn ? clave.ultimoUsoEn.toISOString() : null, ...vida };
}

type FilaDeUso = { fecha: string; tipo: string; clave: string; quien: string; veces: number };

/** Suma el contador de los últimos `dias`: por pantalla y por herramienta, con las veces, las personas y el último día. */
export async function usoDeLosUltimosDias(workspaceId: string, hoy: string, dias: number) {
  const desde = new Date(`${hoy}T00:00:00Z`);
  desde.setUTCDate(desde.getUTCDate() - dias);
  const filas = (await prisma.usoDelSistemaDia.findMany({
    where: { workspaceId, fecha: { gte: desde.toISOString().slice(0, 10) } },
    select: { fecha: true, tipo: true, clave: true, quien: true, veces: true },
  })) as FilaDeUso[];
  const grupos = new Map<string, { tipo: string; clave: string; veces: number; personas: Set<string>; ultimoDia: string }>();
  for (const fila of filas) {
    const id = `${fila.tipo}|${fila.clave}`;
    const grupo = grupos.get(id) ?? { tipo: fila.tipo, clave: fila.clave, veces: 0, personas: new Set<string>(), ultimoDia: fila.fecha };
    grupo.veces += fila.veces;
    grupo.personas.add(fila.quien);
    if (fila.fecha > grupo.ultimoDia) grupo.ultimoDia = fila.fecha;
    grupos.set(id, grupo);
  }
  const lista = [...grupos.values()].map((g) => ({ tipo: g.tipo, clave: g.clave, veces: g.veces, personas: g.personas.size, ultimo_dia: g.ultimoDia }));
  return lista.sort((a, b) => b.veces - a.veces);
}

export type RevisionDeSistemasDatos = Awaited<ReturnType<typeof datosDeRevision>>;

/** Todo lo que lee el Agente de Sistemas, ya cruzado. Con `dias` (7 a 90) agrega lo subido ese tiempo y lo que se usó. */
export async function datosDeRevision(workspaceId: string, opciones: { dias?: number | null; ahora?: Date } = {}) {
  const ahora = opciones.ahora ?? new Date();
  const noSePudoLeer: string[] = [];
  const intentar = async <T>(nombre: string, leer: () => Promise<T>, vacio: T): Promise<T> => {
    try {
      return await leer();
    } catch (error) {
      noSePudoLeer.push(`${nombre}: ${error instanceof Error ? error.message : String(error)}`);
      return vacio;
    }
  };
  const [hechas, atascadas, enError, trabajador] = await Promise.all([
    intentar("tarjetas HECHO de las últimas 24 h", () => tarjetasHechasRecientemente(workspaceId, ahora), [] as TarjetaHecha[]),
    intentar("tarjetas atascadas", () => tarjetasAtascadas(workspaceId, ahora), [] as TarjetaAtascada[]),
    intentar("tarjetas en ERROR", () => tarjetasEnError(workspaceId), [] as TarjetaEnError[]),
    intentar("el trabajador", () => vidaDelTrabajadorDelNegocio(workspaceId, ahora), null),
  ]);
  const hoy = hoyEnBogota(ahora);
  const resultado = {
    ahora: ahora.toISOString(),
    hoy,
    hechas_en_las_ultimas_24_h: hechas,
    atascadas: { regla: `más de ${HORAS_PARA_ATASCADA} h en PLANEANDO, EN_CURSO o SUBIENDO`, tarjetas: atascadas },
    en_error: enError,
    trabajador: trabajador ?? { vivo: false, texto: "no se pudo leer" },
    linea_sugerida: lineaDeSistemas({
      fallas: 0,
      sinProbar: 0,
      funcionan: hechas.length,
      atascadas: atascadas.length,
      enError: enError.length,
      trabajadorVivo: trabajador?.vivo ?? false,
    }),
    advertencias: [
      "Solo lectura: la herramienta no escribe nada. Las fallas de producción las descubre el agente al abrir cada pantalla; la línea sugerida solo cuenta lo atascado, lo que está en ERROR y el trabajador.",
      "El contador de uso empieza a contar el día que se subió; lo de antes no tiene uso medido.",
    ],
  } as Record<string, unknown>;

  const dias = opciones.dias ? Math.min(Math.max(Math.round(opciones.dias), 7), 90) : null;
  if (dias) {
    const [subidas, uso] = await Promise.all([
      intentar(`lo subido en los últimos ${dias} días`, () => tarjetasHechasRecientemente(workspaceId, ahora, dias * 24), [] as TarjetaHecha[]),
      intentar("el contador de uso", () => usoDeLosUltimosDias(workspaceId, hoy, dias), []),
    ]);
    const usoPorClave = new Map(uso.map((fila) => [`${fila.tipo}|${fila.clave}`, fila]));
    resultado.ultimos_dias = dias;
    resultado.subido = subidas.map((subida) => ({
      ...subida,
      uso_de_sus_pantallas: subida.pantallas.map((ruta) => usoPorClave.get(`pantalla|${ruta}`) ?? { tipo: "pantalla", clave: ruta, veces: 0, personas: 0, ultimo_dia: null }),
    }));
    resultado.uso_pantallas = uso.filter((fila) => fila.tipo === "pantalla");
    resultado.uso_herramientas = uso.filter((fila) => fila.tipo === "herramienta");
  }
  if (noSePudoLeer.length) resultado.no_se_pudo_leer = noSePudoLeer;
  return resultado;
}
