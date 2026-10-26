import { prisma } from "@/lib/prisma";

import {
  ESTADOS_QUE_SE_ATASCAN,
  HORAS_DE_REVISION,
  commitYRama,
  estadoDelTrabajador,
  hechasRecientes,
  herramientasDeTexto,
  motivoDeError,
  rutasDeTexto,
  tarjetasAtascadas,
  tieneMarcaDeArreglo,
  usoDeLaTarjeta,
  type FilaDeUso,
} from "../dominio/reglas-sistemas";

/**
 * LOS DATOS DEL AGENTE DE SISTEMAS. SOLO LEE: tarjetas, historial, la clave del trabajador y el contador de uso.
 * No cambia nada. El agente (en aizen1) no abre tarjeta por tarjeta: aquí ya vienen cruzadas.
 */

const fechaDe = (fecha: Date) => new Date(fecha.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

type TarjetaLeida = {
  id: string;
  titulo: string;
  detalle: string;
  repo: string | null;
  estado: string;
  resultado: unknown;
  trabajoIniciadoEn: Date | null;
  trabajoVenceEn: Date | null;
  actualizadoEn: Date;
  tablero: { id: string; nombre: string };
};

const SELECCION_DE_TARJETA = {
  id: true,
  titulo: true,
  detalle: true,
  repo: true,
  estado: true,
  resultado: true,
  trabajoIniciadoEn: true,
  trabajoVenceEn: true,
  actualizadoEn: true,
  tablero: { select: { id: true, nombre: true } },
} as const;

export async function revisionDeSistemas(workspaceId: string, opciones: { dias?: number; ahora?: Date } = {}) {
  const ahora = opciones.ahora ?? new Date();
  const dias = opciones.dias && opciones.dias > 1 ? Math.min(Math.floor(opciones.dias), 90) : 1;
  const horas = dias > 1 ? dias * 24 : HORAS_DE_REVISION;
  const desde = new Date(ahora.getTime() - horas * 3_600_000);
  const noSePudoLeer: string[] = [];
  const intentar = async <T>(nombre: string, leer: () => Promise<T>, vacio: T): Promise<T> => {
    try {
      return await leer();
    } catch (error) {
      noSePudoLeer.push(`${nombre}: ${error instanceof Error ? error.message : String(error)}`);
      return vacio;
    }
  };

  // 1) HECHO en el rango: la hora sale del historial (acción "estado" cuyo `despues.estado` es HECHO).
  const historial = await intentar(
    "historial de las tarjetas HECHO",
    () =>
      prisma.historialTarjeta.findMany({
        where: {
          accion: "estado",
          creadoEn: { gte: desde },
          deshechoEn: null,
          tarjeta: { estado: "HECHO", borradoEn: null, repo: { not: null }, tablero: { workspaceId } },
        },
        orderBy: { creadoEn: "desc" },
        select: { tarjetaId: true, creadoEn: true, despues: true, tarjeta: { select: SELECCION_DE_TARJETA } },
      }),
    [],
  );
  const cambios = historial.map((fila) => ({
    tarjetaId: fila.tarjetaId,
    estadoNuevo: String((fila.despues as { estado?: unknown } | null)?.estado ?? ""),
    en: fila.creadoEn,
  }));
  const horaDeHecho = hechasRecientes(cambios, ahora, horas);
  const tarjetasPorId = new Map<string, TarjetaLeida>();
  for (const fila of historial) tarjetasPorId.set(fila.tarjetaId, fila.tarjeta as TarjetaLeida);

  // 2) Atascadas y en ERROR.
  const enTrabajo = await intentar(
    "tarjetas en trabajo",
    () =>
      prisma.tarjetaTablero.findMany({
        where: { estado: { in: [...ESTADOS_QUE_SE_ATASCAN] }, borradoEn: null, tablero: { workspaceId } },
        select: SELECCION_DE_TARJETA,
      }),
    [] as TarjetaLeida[],
  );
  const atascos = tarjetasAtascadas(enTrabajo, ahora);
  const enError = await intentar(
    "tarjetas en ERROR",
    () => prisma.tarjetaTablero.findMany({ where: { estado: "ERROR", repo: { not: null }, borradoEn: null, tablero: { workspaceId } }, select: SELECCION_DE_TARJETA }),
    [] as TarjetaLeida[],
  );

  // 3) El trabajador: la última vez que usó su clave ("aizen1"; si no hay con ese nombre, la más reciente).
  const claves = await intentar(
    "clave del trabajador",
    () => prisma.claveTrabajador.findMany({ where: { workspaceId, revocadaEn: null }, select: { nombre: true, ultimoUsoEn: true } }),
    [] as Array<{ nombre: string; ultimoUsoEn: Date | null }>,
  );
  const clave = claves.find((c) => c.nombre.trim().toLowerCase() === "aizen1") ?? [...claves].sort((a, b) => (b.ultimoUsoEn?.getTime() ?? 0) - (a.ultimoUsoEn?.getTime() ?? 0))[0];
  const trabajador = estadoDelTrabajador(clave?.ultimoUsoEn ?? null, ahora);

  // 4) El contador de uso de los últimos 30 días (solo si se pide más de un día).
  let uso: FilaDeUso[] = [];
  let usoDesde: string | null = null;
  if (dias > 1) {
    uso = await intentar(
      "contador de uso",
      () => prisma.usoDelSistemaDia.findMany({ where: { workspaceId, fecha: { gte: fechaDe(desde) } }, select: { fecha: true, tipo: true, clave: true, quien: true, veces: true } }),
      [] as FilaDeUso[],
    );
    const primero = await intentar("primer día del contador", () => prisma.usoDelSistemaDia.aggregate({ where: { workspaceId }, _min: { fecha: true } }), null);
    usoDesde = primero?._min?.fecha ?? null;
  }

  const hechas = [...horaDeHecho.entries()]
    .map(([id, hechoEn]) => ({ tarjeta: tarjetasPorId.get(id), hechoEn }))
    .filter((par): par is { tarjeta: TarjetaLeida; hechoEn: Date } => Boolean(par.tarjeta))
    .sort((a, b) => b.hechoEn.getTime() - a.hechoEn.getTime())
    .map(({ tarjeta, hechoEn }) => {
      const texto = `${tarjeta.titulo}\n${tarjeta.detalle}`;
      const { commit, rama } = commitYRama(tarjeta.resultado);
      const base = {
        tarjeta_id: tarjeta.id,
        titulo: tarjeta.titulo,
        detalle: tarjeta.detalle,
        repo: tarjeta.repo,
        tablero: tarjeta.tablero.nombre,
        commit,
        rama,
        hecho_en: hechoEn.toISOString(),
        pantallas_nombradas: rutasDeTexto(texto),
        herramientas_nombradas: herramientasDeTexto(texto),
      };
      if (dias <= 1) return base;
      // Sin datos de uso si la tarjeta se subió antes de que existiera el contador.
      const sinDatosDeUso = !usoDesde || fechaDe(hechoEn) < usoDesde;
      const medido = usoDeLaTarjeta(texto, uso, fechaDe(hechoEn));
      return { ...base, uso: sinDatosDeUso ? { sin_datos_de_uso: true, nota: "se subió antes de que existiera el contador de uso" } : medido };
    });

  const arreglosYaCreados = await intentar(
    "tarjetas de arreglo ya creadas",
    async () => {
      const filas = await prisma.tarjetaTablero.findMany({
        where: { titulo: { contains: "[sistemas:" }, borradoEn: null, tablero: { workspaceId } },
        select: { id: true, titulo: true, estado: true },
        take: 200,
      });
      return filas.filter((f) => tieneMarcaDeArreglo(f.titulo)).map((f) => ({ tarjeta_id: f.id, titulo: f.titulo, estado: f.estado }));
    },
    [] as Array<{ tarjeta_id: string; titulo: string; estado: string }>,
  );

  return {
    generado_en: ahora.toISOString(),
    rango: dias > 1 ? `últimos ${dias} días` : `últimas ${HORAS_DE_REVISION} horas`,
    hechas,
    atascadas: atascos.map((a) => {
      const t = enTrabajo.find((x) => x.id === a.id)!;
      return {
        tarjeta_id: a.id,
        titulo: t.titulo,
        estado: a.estado,
        tablero: t.tablero.nombre,
        minutos_en_el_estado: a.minutos,
        ultimo_latido: (t.trabajoVenceEn ?? t.actualizadoEn).toISOString(),
      };
    }),
    en_error: enError.map((t) => ({ tarjeta_id: t.id, titulo: t.titulo, repo: t.repo, tablero: t.tablero.nombre, motivo: motivoDeError(t.resultado) ?? "(sin motivo guardado)" })),
    trabajador: { vivo: trabajador.vivo, minutos_sin_uso: trabajador.minutosSinUso, estado: trabajador.texto },
    arreglos_ya_creados: arreglosYaCreados,
    ...(dias > 1 ? { uso_medido_desde: usoDesde ?? "todavía no hay datos de uso" } : {}),
    advertencias: [
      "Solo lectura: esta herramienta no cambia nada.",
      "La hora en que quedó HECHO sale del historial de la tarjeta.",
      ...(dias > 1 ? ["El contador de uso empieza a contar el día que se sube: lo de antes no tiene uso medido. Gestión no tiene contador."] : []),
    ],
    ...(noSePudoLeer.length ? { no_se_pudo_leer: noSePudoLeer } : {}),
  };
}

