import { createHash } from "node:crypto";
import { readFile, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

import { resolverRutaSubida } from "@/lib/archivos-subidos";
import {
  CHAT_MEDIA_DIR_SEGMENTS,
  guardarBytesDeChat,
  tipoDeMedioPorMime,
  type PersistableMediaType,
} from "@/lib/guardar-archivo-de-chat";
import {
  CLAVE_ARCHIVOS_GUARDADOS,
  PESO_PARA_RECORTAR_EN_SQL,
  buscarArchivosEnPayload,
  decodificarBase64,
} from "@/lib/payload-sin-archivos";

/*
  Migracion de los mensajes VIEJOS: sacar el base64 de `Message.rawPayload` (y los `data:` de
  `mediaUrl`) a archivos en /uploads/chat-media. La red de prisma.ts ya evita que entre base64 nuevo.

  Cada llamada hace UNA tanda chica y responde. La corre la ruta interna
  /api/interno/archivos-de-mensajes (adentro de la app: mismo disco que sirve /uploads), y la llama por
  tandas scripts/migrar-archivos-de-mensajes.mjs. Por defecto es una SIMULACION: no escribe nada.

  Reglas:
  - Un mensaje a la vez (nunca dos archivos de 25 MB en memoria).
  - Antes de quitar nada, el archivo se comprueba: tamano y sha256 en disco, y que la app lo sirva
    por HTTP con el mismo tamano. Si algo no da, el mensaje queda como estaba.
  - El UPDATE es de una fila, con statement_timeout de 5 s y lock_timeout de 1 s, y su WHERE exige que
    el base64 sea exactamente el que se guardo (largo y md5): si el webhook cambio la fila en el
    medio, no se pisa nada.
  - Nunca se borra una fila ni un archivo.
*/

export const CLAVE_DEL_PROGRESO = "migracion-archivos-de-mensajes";
const TANDA_POR_DEFECTO = 20;
const TANDA_MAXIMA = 50;
const PRESUPUESTO_POR_DEFECTO_MS = 10_000;
const PRESUPUESTO_MAXIMO_MS = 15_000;
const SALTADOS_GUARDADOS = 200;

export type Fila = Record<string, unknown>;

/** La base, con consultas CORTAS (cada una en su transaccion con statement_timeout y lock_timeout). */
export type BaseDeLaMigracion = {
  consultar<T extends Fila = Fila>(sql: string, params?: unknown[]): Promise<T[]>;
  leerProgreso(): Promise<string | null>;
  guardarProgreso(valor: string): Promise<void>;
};

export type CasoDeMediaUrl =
  | "se_queda_local"
  | "data_url"
  | "sin_media_url"
  | "local_que_no_esta"
  | "externo_que_abre"
  | "externo_que_no_abre"
  | "externo_con_clave";

export type Saltado = { id: string; motivo: string };

export type ResultadoDeLaTanda = {
  simulacion: boolean;
  procesados: number;
  migrados: number;
  saltados: Saltado[];
  mbAArchivo: number;
  mbNuevosEnDisco: number;
  mbLiberadosEnBase: number;
  casosDeMediaUrl: Partial<Record<CasoDeMediaUrl, number>>;
  ultimoId: string | null;
  terminado: boolean;
  parado?: string;
};

export type Dependencias = {
  base: BaseDeLaMigracion;
  /** Carpeta de /uploads (por defecto `<cwd>/public/uploads`). */
  raizDeUploads?: string;
  /** Freno por carga: devuelve el motivo para no empezar, o null. */
  medirCarga?: () => Promise<string | null>;
  /** Que la app sirva el archivo con ese tamano (HEAD o GET con Range a 127.0.0.1). */
  comprobarPorHttp?: (enlace: string, bytes: number) => Promise<boolean>;
  /** Si una URL de otro servidor abre (HEAD, 5 s). */
  probarEnlaceExterno?: (url: string) => Promise<boolean>;
  /** Audio: la copia que suena en todos los navegadores (la de siempre), o null. */
  convertirAudio?: (dataUrl: string) => Promise<string | null>;
  ahora?: () => Date;
};

export type Parametros = {
  simulacion?: boolean;
  tanda?: number;
  presupuestoMs?: number;
  desdeId?: string | null;
};

type Progreso = {
  ultimoId: string | null;
  totales: { procesados: number; migrados: number; mbAArchivo: number; mbNuevosEnDisco: number; mbLiberadosEnBase: number };
  saltados: Saltado[];
  actualizado: string;
};

const MB = 1024 * 1024;
const enMb = (bytes: number) => Math.round((bytes / MB) * 100) / 100;
const md5 = (texto: string) => createHash("md5").update(texto, "utf8").digest("hex");

let tandaEnCurso = false;

/* ------------------------------------------------------------------------------------------------
   El freno por carga (lo de produccion; en las pruebas se reemplaza).
------------------------------------------------------------------------------------------------ */
let retrasoDelEventLoop: IntervalHistogram | null = null;

export function crearMedidorDeCarga(base: BaseDeLaMigracion, raizDeUploads: string) {
  if (!retrasoDelEventLoop) {
    retrasoDelEventLoop = monitorEventLoopDelay({ resolution: 20 });
    retrasoDelEventLoop.enable();
  }
  return async (): Promise<string | null> => {
    const nucleos = Math.max(1, os.cpus().length);
    const carga = os.loadavg()[0] / nucleos;
    if (carga > 0.7) return `cpu ${carga.toFixed(2)} por nucleo`;

    const p99 = (retrasoDelEventLoop?.percentile(99) ?? 0) / 1e6;
    retrasoDelEventLoop?.reset();
    if (p99 > 200) return `event loop ${Math.round(p99)} ms`;

    const inicio = Date.now();
    await base.consultar("SELECT 1 AS uno");
    const demora = Date.now() - inicio;
    if (demora > 200) return `la base tarda ${demora} ms en un SELECT 1`;

    const [activas] = await base.consultar<{ activas: unknown }>(
      `SELECT count(*)::int AS activas FROM pg_stat_activity WHERE state = 'active'`,
    );
    if (Number(activas?.activas ?? 0) > 6) return `${Number(activas?.activas)} consultas activas en la base`;

    const disco = await statfs(raizDeUploads).catch(() => null);
    if (!disco) return "no se pudo medir el espacio del disco";
    const libres = Number(disco.bavail) * Number(disco.bsize);
    if (libres < 5 * 1024 * MB) return `quedan ${enMb(libres)} MB libres en el disco`;
    return null;
  };
}

/* ------------------------------------------------------------------------------------------------
   Por defecto: comprobaciones por HTTP y conversion de audio.
------------------------------------------------------------------------------------------------ */
async function pedirConPlazo(url: string, init: RequestInit, ms: number) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: control.signal, redirect: "manual", cache: "no-store" });
  } finally {
    clearTimeout(reloj);
  }
}

export async function comprobarPorHttpLocal(enlace: string, bytes: number): Promise<boolean> {
  const url = `http://127.0.0.1:${process.env.PORT || 3000}${enlace}`;
  try {
    const cabeza = await pedirConPlazo(url, { method: "HEAD" }, 5000);
    if (cabeza.status === 200 && Number(cabeza.headers.get("content-length")) === bytes) return true;
  } catch {
    // Se prueba con GET de un byte.
  }
  try {
    const parcial = await pedirConPlazo(url, { method: "GET", headers: { Range: "bytes=0-0" } }, 5000);
    await parcial.body?.cancel().catch(() => {});
    if (parcial.status === 206) return parcial.headers.get("content-range") === `bytes 0-0/${bytes}`;
    return parcial.status === 200 && Number(parcial.headers.get("content-length")) === bytes;
  } catch {
    return false;
  }
}

export async function probarEnlaceExternoPorHead(url: string): Promise<boolean> {
  try {
    const respuesta = await pedirConPlazo(url, { method: "HEAD" }, 5000);
    return respuesta.status === 200;
  } catch {
    return false;
  }
}

async function convertirAudioComoSiempre(dataUrl: string) {
  const { persistChatMediaFromDataUrl } = await import("@/lib/chat-media-storage");
  return persistChatMediaFromDataUrl({ dataUrl, mediaType: "AUDIO" }).catch(() => null);
}

/* ------------------------------------------------------------------------------------------------
   La tanda.
------------------------------------------------------------------------------------------------ */
function limitar(valor: unknown, porDefecto: number, maximo: number) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return porDefecto;
  return Math.min(Math.floor(numero), maximo);
}

function tipoDeMedio(tipo: unknown, mimetype: string | null): PersistableMediaType {
  const conocidos: PersistableMediaType[] = ["IMAGE", "AUDIO", "VIDEO", "STICKER", "DOCUMENT"];
  return conocidos.includes(tipo as PersistableMediaType) ? (tipo as PersistableMediaType) : tipoDeMedioPorMime(mimetype);
}

function leerProgreso(texto: string | null): Progreso {
  const vacio: Progreso = {
    ultimoId: null,
    totales: { procesados: 0, migrados: 0, mbAArchivo: 0, mbNuevosEnDisco: 0, mbLiberadosEnBase: 0 },
    saltados: [],
    actualizado: "",
  };
  if (!texto) return vacio;
  try {
    const leido = JSON.parse(texto) as Partial<Progreso>;
    return { ...vacio, ...leido, totales: { ...vacio.totales, ...(leido.totales ?? {}) }, saltados: leido.saltados ?? [] };
  } catch {
    return vacio;
  }
}

export async function migrarTanda(parametros: Parametros, deps: Dependencias): Promise<ResultadoDeLaTanda> {
  const simulacion = parametros.simulacion !== false;
  const tanda = limitar(parametros.tanda, TANDA_POR_DEFECTO, TANDA_MAXIMA);
  const presupuestoMs = limitar(parametros.presupuestoMs, PRESUPUESTO_POR_DEFECTO_MS, PRESUPUESTO_MAXIMO_MS);
  const raizDeUploads = deps.raizDeUploads ?? path.join(process.cwd(), "public", "uploads");
  const carpetaDeChat = path.join(raizDeUploads, ...CHAT_MEDIA_DIR_SEGMENTS.slice(2));
  const comprobarPorHttp = deps.comprobarPorHttp ?? comprobarPorHttpLocal;
  const probarEnlaceExterno = deps.probarEnlaceExterno ?? probarEnlaceExternoPorHead;
  const convertirAudio = deps.convertirAudio ?? convertirAudioComoSiempre;
  const ahora = deps.ahora ?? (() => new Date());

  const resultado: ResultadoDeLaTanda = {
    simulacion,
    procesados: 0,
    migrados: 0,
    saltados: [],
    mbAArchivo: 0,
    mbNuevosEnDisco: 0,
    mbLiberadosEnBase: 0,
    casosDeMediaUrl: {},
    ultimoId: null,
    terminado: false,
  };

  if (tandaEnCurso) {
    return { ...resultado, parado: "otra tanda en curso" };
  }
  tandaEnCurso = true;
  try {
    const motivoDeCarga = await (deps.medirCarga ?? crearMedidorDeCarga(deps.base, raizDeUploads))();
    if (motivoDeCarga) {
      return { ...resultado, parado: `carga: ${motivoDeCarga}` };
    }

    const progreso = leerProgreso(simulacion ? null : await deps.base.leerProgreso());
    const desdeId = parametros.desdeId ?? progreso.ultimoId ?? "";
    resultado.ultimoId = desdeId || null;

    // Candidatos: consulta corta por el indice de la clave primaria. Una fila ya migrada pesa menos de
    // 64 KB y deja de salir (idempotente sin marca extra).
    const candidatos = await deps.base.consultar<{ id: string }>(
      `SELECT "id" FROM "Message"
       WHERE "id" > $1 AND (pg_column_size("rawPayload") > ${PESO_PARA_RECORTAR_EN_SQL} OR "mediaUrl" LIKE 'data:%')
       ORDER BY "id" LIMIT ${tanda}`,
      [desdeId],
    );
    if (candidatos.length < tanda) resultado.terminado = true;

    const inicio = Date.now();
    const hashesNuevos = new Set<string>();
    const casos = resultado.casosDeMediaUrl;
    const contarCaso = (caso: CasoDeMediaUrl) => {
      casos[caso] = (casos[caso] ?? 0) + 1;
    };
    const saltar = (id: string, motivo: string) => resultado.saltados.push({ id, motivo });

    for (const { id } of candidatos) {
      if (Date.now() - inicio > presupuestoMs) {
        resultado.terminado = false;
        break;
      }
      resultado.procesados += 1;
      resultado.ultimoId = id;

      const [fila] = await deps.base.consultar<{
        id: string;
        type: string | null;
        mediaUrl: string | null;
        rawPayload: unknown;
        peso: unknown;
      }>(
        `SELECT "id", "type"::text AS "type", "mediaUrl", "rawPayload", pg_column_size("rawPayload") AS "peso"
         FROM "Message" WHERE "id" = $1`,
        [id],
      );
      if (!fila) {
        saltar(id, "ya no existe");
        continue;
      }
      let pesoActual = Number(fila.peso ?? 0);
      const archivos = buscarArchivosEnPayload(fila.rawPayload);
      const mediaUrlDeDatos = fila.mediaUrl?.trim().toLowerCase().startsWith("data:") ? fila.mediaUrl.trim() : null;

      if (archivos.length === 0 && !mediaUrlDeDatos) {
        saltar(id, "pesado pero sin base64 en las rutas conocidas (revisar a mano)");
        continue;
      }

      // Cada archivo: decodificar, guardar, comprobar.
      type Listo = { ruta: string[]; texto: string; enlace: string; bytes: number; sha256: string; tipo: string; datos: Buffer };
      const listos: Listo[] = [];
      let fallo = false;
      // Los del payload y, si mediaUrl es un `data:`, ese tambien (se guarda aparte: puede ser otro archivo).
      const fuentes: Array<{ ruta: string[] | null; texto: string; mimetype: string | null }> = [
        ...archivos.map((archivo) => ({ ruta: archivo.ruta, texto: archivo.texto, mimetype: archivo.mimetype })),
        ...(mediaUrlDeDatos ? [{ ruta: null, texto: mediaUrlDeDatos, mimetype: null }] : []),
      ];

      for (const fuente of fuentes) {
        const decodificado = decodificarBase64(fuente.texto);
        if (!decodificado) {
          saltar(id, `base64 roto en ${fuente.ruta?.join(".") ?? "mediaUrl"}`);
          fallo = true;
          break;
        }
        const tipo = decodificado.mimetype ?? fuente.mimetype ?? "application/octet-stream";
        const mediaType = tipoDeMedio(fila.type, tipo);
        const datos = decodificado.bytes;
        if (simulacion) {
          listos.push({ ruta: fuente.ruta ?? [], texto: fuente.texto, enlace: "", bytes: datos.length, sha256: "", tipo, datos });
          continue;
        }
        try {
          const guardado = await guardarBytesDeChat({
            bytes: decodificado.bytes,
            mimeType: tipo,
            mediaType,
            comprobar: "hash",
            carpeta: carpetaDeChat,
          });
          const enDisco = await stat(guardado.rutaEnDisco);
          const hashDelDisco = createHash("sha256").update(await readFile(guardado.rutaEnDisco)).digest("hex");
          if (enDisco.size !== decodificado.bytes.length || hashDelDisco !== guardado.sha256) {
            saltar(id, "el archivo en disco no coincide");
            fallo = true;
            break;
          }
          if (!(await comprobarPorHttp(guardado.enlace, guardado.bytes))) {
            saltar(id, `la app no sirve ${guardado.enlace} con el tamano esperado`);
            fallo = true;
            break;
          }
          if (!guardado.yaExistia && !hashesNuevos.has(guardado.sha256)) {
            hashesNuevos.add(guardado.sha256);
            resultado.mbNuevosEnDisco += guardado.bytes;
          }
          listos.push({ ruta: fuente.ruta ?? [], texto: fuente.texto, enlace: guardado.enlace, bytes: guardado.bytes, sha256: guardado.sha256, tipo, datos });
        } catch (error) {
          saltar(id, `no se pudo guardar: ${error instanceof Error ? error.message : String(error)}`);
          fallo = true;
          break;
        }
      }
      if (fallo || listos.length === 0) continue;

      // ¿Hace falta un mediaUrl nuevo? Si era un `data:`, apunta a SU archivo; si no, al primero del payload.
      const delMediaUrl = listos.find((listo) => listo.ruta.length === 0) ?? null;
      const primero = delMediaUrl ?? listos[0];
      const actual = fila.mediaUrl?.trim() || "";
      let caso: CasoDeMediaUrl;
      if (!actual) caso = "sin_media_url";
      else if (actual.toLowerCase().startsWith("data:")) caso = "data_url";
      else if (actual.startsWith("/uploads/")) {
        const enDisco = resolverRutaSubida(raizDeUploads, actual.slice("/uploads/".length).split("?")[0].split("/"));
        const datos = enDisco ? await stat(enDisco).catch(() => null) : null;
        caso = datos?.isFile() && datos.size > 0 ? "se_queda_local" : "local_que_no_esta";
      } else if (/\/api\/files\//i.test(actual)) caso = "externo_con_clave";
      else if (/^https?:\/\//i.test(actual)) caso = (await probarEnlaceExterno(actual)) ? "externo_que_abre" : "externo_que_no_abre";
      else caso = "local_que_no_esta";
      contarCaso(caso);

      let mediaUrlNuevo: string | null = null;
      if (caso !== "se_queda_local" && caso !== "externo_que_abre") {
        mediaUrlNuevo = primero.enlace;
        if (!simulacion && tipoDeMedio(fila.type, primero.tipo) === "AUDIO") {
          mediaUrlNuevo = (await convertirAudio(`data:${primero.tipo};base64,${primero.datos.toString("base64")}`)) ?? primero.enlace;
        }
      }

      if (simulacion) {
        resultado.migrados += 1;
        resultado.mbAArchivo += listos.reduce((suma, listo) => suma + listo.bytes, 0);
        continue;
      }

      // Actualizar: una ruta por vez, exigiendo que el base64 sea el mismo que se guardo. El mediaUrl
      // nuevo va con la escritura de su propio archivo (el `data:`) o, si no hay, con la primera.
      const pesoAntes = pesoActual;
      let migroAlgo = false;
      for (const listo of listos) {
        const nuevoEnEsta = listo === primero ? mediaUrlNuevo : null;
        let filas: Array<{ peso: unknown }>;
        if (listo.ruta.length) {
          const marca = JSON.stringify([
            { ruta: listo.ruta.join("."), enlace: listo.enlace, bytes: listo.bytes, sha256: listo.sha256, tipo: listo.tipo, fecha: ahora().toISOString() },
          ]);
          filas = await deps.base.consultar<{ peso: unknown }>(
            `UPDATE "Message"
             SET "rawPayload" = jsonb_set("rawPayload" #- $2::text[], '{${CLAVE_ARCHIVOS_GUARDADOS}}',
                                          COALESCE("rawPayload"->'${CLAVE_ARCHIVOS_GUARDADOS}', '[]'::jsonb) || $3::jsonb),
                 "mediaUrl" = COALESCE($4::text, "mediaUrl")
             WHERE "id" = $1
               AND length("rawPayload" #>> $2::text[]) = $5
               AND md5("rawPayload" #>> $2::text[]) = $6
             RETURNING pg_column_size("rawPayload") AS "peso"`,
            [id, listo.ruta, marca, nuevoEnEsta, listo.texto.length, md5(listo.texto)],
          );
        } else {
          // El archivo del mediaUrl (data:): aca siempre hay mediaUrl nuevo (caso "data_url").
          filas = await deps.base.consultar<{ peso: unknown }>(
            `UPDATE "Message" SET "mediaUrl" = $2::text
             WHERE "id" = $1 AND md5("mediaUrl") = $3
             RETURNING pg_column_size("rawPayload") AS "peso"`,
            [id, nuevoEnEsta ?? listo.enlace, md5(listo.texto)],
          );
        }
        if (filas.length === 0) {
          saltar(id, "cambio mientras se migraba; reintentar");
          break;
        }
        migroAlgo = true;
        resultado.mbAArchivo += listo.bytes;
        pesoActual = Number(filas[0].peso ?? pesoActual);
      }
      if (migroAlgo) {
        resultado.migrados += 1;
        resultado.mbLiberadosEnBase += Math.max(0, pesoAntes - pesoActual);
      }
    }

    if (!simulacion) {
      const saltados = [...progreso.saltados, ...resultado.saltados].slice(-SALTADOS_GUARDADOS);
      const nuevo: Progreso = {
        ultimoId: resultado.ultimoId,
        totales: {
          procesados: progreso.totales.procesados + resultado.procesados,
          migrados: progreso.totales.migrados + resultado.migrados,
          mbAArchivo: progreso.totales.mbAArchivo + enMb(resultado.mbAArchivo),
          mbNuevosEnDisco: progreso.totales.mbNuevosEnDisco + enMb(resultado.mbNuevosEnDisco),
          mbLiberadosEnBase: progreso.totales.mbLiberadosEnBase + enMb(resultado.mbLiberadosEnBase),
        },
        saltados,
        actualizado: ahora().toISOString(),
      };
      await deps.base.guardarProgreso(JSON.stringify(nuevo));
    }

    return {
      ...resultado,
      mbAArchivo: enMb(resultado.mbAArchivo),
      mbNuevosEnDisco: enMb(resultado.mbNuevosEnDisco),
      mbLiberadosEnBase: enMb(resultado.mbLiberadosEnBase),
    };
  } finally {
    tandaEnCurso = false;
  }
}
