/**
 * EL MOTOR DEL RELLENO HISTÓRICO DEL EMBUDO (sin Next, sin Prisma: recibe la base por parámetro).
 *
 * Lo usan:
 *  - la app (servicios/relleno.ts, sección "Historia" de /cliente/crm/embudo), con Prisma;
 *  - el script scripts/embudo-backfill.mjs y las pruebas, con un Pool de pg o PGlite.
 * Por eso aquí solo hay imports relativos y SQL explícito con conversiones (::jsonb, ::int,
 * timestamptz AT TIME ZONE 'UTC'), que funciona igual con los dos clientes.
 *
 * Reglas:
 *  - Solo ESCRIBE en EmbudoEvento y EmbudoLead. Lo demás (Conversation, Message, Contact,
 *    AppSetting, Product, WhatsAppChannel) solo se lee.
 *  - Idempotente: cada evento lleva claveUnica y se inserta con ON CONFLICT DO NOTHING.
 *  - Por lotes (100 chats por defecto) con una pausa entre lotes, para no cargar la base.
 *  - En modo simular no escribe nada: solo cuenta.
 */

import { leerConfigEmbudoDeTexto, claveDeProducto } from "../dominio/combo";
import { aplicarEvento, type ContextoDelLead, type EventoDelEmbudo, type FotoDelLead } from "../dominio/eventos";
import { esDiaValido, rangoBogota } from "../dominio/panel";
import {
  armarLineaDeLibros,
  filtrarContraEnVivo,
  parsearJson,
  reconstruirChat,
  resumenVacio,
  sumarChat,
  type LibroV3,
  type MensajeDelRelleno,
  type ResumenDelEmbudo,
} from "../dominio/relleno";

/** Lo mínimo que el motor necesita de la base. */
export type BaseDelRelleno = {
  leer(sql: string, valores: unknown[]): Promise<Record<string, unknown>[]>;
  /** Devuelve cuántas filas cambió. */
  escribir(sql: string, valores: unknown[]): Promise<number>;
};

export type OpcionesDelRelleno = {
  workspaceId: string;
  /** Id de la línea (WhatsAppChannel) o su nombre exacto. */
  linea: string;
  desde: string;
  hasta: string;
  escribir: boolean;
  /** Solo los primeros N chats (0 = todos). */
  limite?: number;
  tamanoLote?: number;
  pausaEntreLotesMs?: number;
};

export type ProgresoDelRelleno = {
  lineaId: string;
  lineaNombre: string;
  procesados: number;
  total: number;
  /** Eventos que se generarían (simular) o que se intentaron guardar (guardar), por tipo. */
  porTipo: Record<string, number>;
  resumen: ResumenDelEmbudo;
  /** Eventos nuevos de verdad (los repetidos se ignoran por claveUnica). 0 al simular. */
  insertados: number;
  leadsRecalculados: number;
};

export const TAMANO_LOTE_POR_DEFECTO = 100;

/** Un instante para la base: texto ISO convertido a timestamp UTC (las columnas no tienen zona). */
const INSTANTE = (n: number) => `($${n}::timestamptz AT TIME ZONE 'UTC')`;

const fecha = (valor: unknown): Date | null => {
  if (valor === null || valor === undefined) return null;
  const f = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isFinite(f.getTime()) ? f : null;
};
const textoONulo = (valor: unknown): string | null => (typeof valor === "string" ? valor : valor == null ? null : String(valor));
const iso = (valor: Date | null | undefined) => (valor ? valor.toISOString() : null);
const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

function nuevoId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  return `bf${aleatorio.slice(0, 23)}`;
}

async function leerAjuste(db: BaseDelRelleno, clave: string): Promise<string | null> {
  const filas = await db.leer(`SELECT "value" FROM "AppSetting" WHERE "key" = $1`, [clave]);
  return textoONulo(filas[0]?.value);
}

type ChatDelRelleno = {
  id: string;
  contactId: string;
  channelId: string;
  startedAt: Date;
  adTitle: string | null;
  adSourceId: string | null;
  adSourceApp: string | null;
  crmStage: string | null;
  wonAt: Date | null;
  wonQuoteRef: string | null;
};

/** Los chats de la línea cuyo PRIMER mensaje de la clienta cae en el rango, del más viejo al más nuevo. */
async function leerChats(
  db: BaseDelRelleno,
  input: { workspaceId: string; channelId: string; inicio: Date; fin: Date; limite: number },
): Promise<ChatDelRelleno[]> {
  const filas = await db.leer(
    `SELECT c."id", c."contactId", c."channelId", c."startedAt",
            ct."metadata"->>'adTitle' AS "adTitle", ct."metadata"->>'adSourceId' AS "adSourceId",
            ct."metadata"->>'adSourceApp' AS "adSourceApp",
            ct."crmStage"::text AS "crmStage", ct."wonAt", ct."wonQuoteRef"
     FROM "Conversation" c
     JOIN "Contact" ct ON ct."id" = c."contactId"
     JOIN LATERAL (
       SELECT min(m."createdAt") AS "primerEntrante" FROM "Message" m
       WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM'
     ) p ON true
     WHERE c."workspaceId" = $1 AND c."channelId" = $2
       AND p."primerEntrante" >= ${INSTANTE(3)} AND p."primerEntrante" < ${INSTANTE(4)}
     ORDER BY p."primerEntrante" ASC, c."id" ASC
     ${input.limite > 0 ? `LIMIT ${Math.floor(input.limite)}` : ""}`,
    [input.workspaceId, input.channelId, input.inicio.toISOString(), input.fin.toISOString()],
  );
  return filas.map((fila) => ({
    id: String(fila.id),
    contactId: String(fila.contactId),
    channelId: String(fila.channelId ?? input.channelId),
    startedAt: fecha(fila.startedAt) ?? new Date(),
    adTitle: textoONulo(fila.adTitle),
    adSourceId: textoONulo(fila.adSourceId),
    adSourceApp: textoONulo(fila.adSourceApp),
    crmStage: textoONulo(fila.crmStage),
    wonAt: fecha(fila.wonAt),
    wonQuoteRef: textoONulo(fila.wonQuoteRef),
  }));
}

async function leerMensajes(db: BaseDelRelleno, conversationId: string): Promise<MensajeDelRelleno[]> {
  const filas = await db.leer(
    `SELECT m."id", m."direction"::text AS "direction", m."type"::text AS "type", m."content", m."transcripcion",
            m."externalId", m."createdAt",
            m."rawPayload"->>'source' AS "source", m."rawPayload"->>'kind' AS "kind",
            m."rawPayload"->>'assigneeUserId' AS "assigneeUserId", m."rawPayload"->>'actorUserId' AS "actorUserId",
            m."rawPayload"->>'origen' AS "origen", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId"
     FROM "Message" m
     WHERE m."conversationId" = $1 AND m."deletedAt" IS NULL AND COALESCE(m."isStatusBroadcast", false) = false
     ORDER BY m."createdAt" ASC, m."id" ASC`,
    [conversationId],
  );
  return filas.map((fila) => ({
    id: String(fila.id),
    direction: String(fila.direction),
    type: String(fila.type),
    content: textoONulo(fila.content),
    transcripcion: textoONulo(fila.transcripcion),
    externalId: textoONulo(fila.externalId),
    createdAt: fecha(fila.createdAt) ?? new Date(0),
    source: textoONulo(fila.source),
    kind: textoONulo(fila.kind),
    assigneeUserId: textoONulo(fila.assigneeUserId),
    actorUserId: textoONulo(fila.actorUserId),
    origen: textoONulo(fila.origen),
    enviadoPorUserId: textoONulo(fila.enviadoPorUserId),
  }));
}

/** Inserta los eventos de un chat en UNA sentencia; los de claveUnica repetida se ignoran. */
async function insertarEventos(
  db: BaseDelRelleno,
  chat: ChatDelRelleno & { workspaceId: string },
  eventos: EventoDelEmbudo[],
): Promise<number> {
  if (!eventos.length) return 0;
  // Postgres acepta hasta 65 535 parámetros por sentencia: de a 500 eventos (7 500) sobra.
  if (eventos.length > 500) {
    let total = 0;
    for (let i = 0; i < eventos.length; i += 500) total += await insertarEventos(db, chat, eventos.slice(i, i + 500));
    return total;
  }
  const valores: unknown[] = [];
  const filas = eventos.map((ev) => {
    const n = valores.length;
    valores.push(
      nuevoId(),
      chat.workspaceId,
      chat.id,
      chat.contactId,
      chat.channelId,
      ev.producto ?? null,
      ev.paso ?? null,
      ev.tipo,
      ev.reglaId ?? null,
      ev.reglaNombre ?? null,
      typeof ev.libroVersion === "number" ? ev.libroVersion : null,
      ev.origen,
      ev.datos ? JSON.stringify(ev.datos) : null,
      ev.claveUnica ?? null,
      (ev.createdAt ?? new Date()).toISOString(),
    );
    const p = (i: number) => `$${n + i}`;
    return `(${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(10)},${p(11)}::int,${p(12)},${p(13)}::jsonb,${p(14)},${INSTANTE(n + 15)})`;
  });
  return db.escribir(
    `INSERT INTO "EmbudoEvento" ("id","workspaceId","conversationId","contactId","channelId","producto","paso","tipo",
       "reglaId","reglaNombre","libroVersion","origen","datos","claveUnica","createdAt")
     VALUES ${filas.join(",")}
     ON CONFLICT DO NOTHING`,
    valores,
  );
}

type TipoDeColumna = "texto" | "bool" | "int" | "json" | "instante";
const COLUMNAS_DEL_LEAD: [keyof FotoDelLead, TipoDeColumna][] = [
  ["contactId", "texto"],
  ["workspaceId", "texto"],
  ["channelId", "texto"],
  ["productoEntrada", "texto"],
  ["productoActual", "texto"],
  ["mezcla", "bool"],
  ["anuncioId", "texto"],
  ["anuncioTitulo", "texto"],
  ["anuncioRed", "texto"],
  ["entradaEn", "instante"],
  ["libroVersionEntrada", "int"],
  ["pasoActual", "texto"],
  ["pasoMaximo", "texto"],
  ["temperatura", "texto"],
  ["puntaje", "int"],
  ["motivo", "texto"],
  ["senales", "json"],
  ["transferencia", "texto"],
  ["asignadaA", "texto"],
  ["asignadaEn", "instante"],
  ["primeraRespuestaAsesoraEn", "instante"],
  ["ultimoClienteEn", "instante"],
  ["ultimoBotEn", "instante"],
  ["cotizacionRef", "texto"],
  ["cotizacionEn", "instante"],
  ["anticipoEn", "instante"],
  ["ventaEn", "instante"],
];

/** Recalcula la foto del lead con TODOS sus eventos (en vivo + relleno), en orden. */
async function recalcularLead(db: BaseDelRelleno, chat: ChatDelRelleno & { workspaceId: string }): Promise<boolean> {
  const filas = await db.leer(
    `SELECT "tipo","origen","paso","producto","libroVersion","datos","createdAt" FROM "EmbudoEvento"
     WHERE "conversationId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
    [chat.id],
  );
  const contexto: ContextoDelLead = {
    conversationId: chat.id,
    contactId: chat.contactId,
    workspaceId: chat.workspaceId,
    channelId: chat.channelId ?? "",
    inicioDeLaCharla: chat.startedAt,
  };
  let foto: FotoDelLead | null = null;
  for (const fila of filas) {
    const evento: EventoDelEmbudo = {
      tipo: String(fila.tipo) as EventoDelEmbudo["tipo"],
      origen: String(fila.origen) as EventoDelEmbudo["origen"],
      paso: textoONulo(fila.paso),
      producto: textoONulo(fila.producto),
      libroVersion: fila.libroVersion == null ? null : Number(fila.libroVersion),
      datos: parsearJson<Record<string, unknown> | null>(fila.datos, null),
      createdAt: fecha(fila.createdAt) ?? new Date(),
    };
    foto = aplicarEvento(foto, evento, contexto);
  }
  if (!foto) return false;

  const valores: unknown[] = [chat.id];
  const marcas: string[] = [];
  for (const [columna, tipo] of COLUMNAS_DEL_LEAD) {
    const valor = foto[columna];
    valores.push(
      tipo === "instante"
        ? iso(valor as Date | null)
        : tipo === "json"
          ? valor
            ? JSON.stringify(valor)
            : null
          : (valor ?? null),
    );
    const n = valores.length;
    marcas.push(
      tipo === "instante" ? INSTANTE(n) : tipo === "json" ? `$${n}::jsonb` : tipo === "int" ? `$${n}::int` : tipo === "bool" ? `$${n}::boolean` : `$${n}`,
    );
  }
  const lista = COLUMNAS_DEL_LEAD.map(([col]) => `"${col}"`).join(",");
  const actualizar = COLUMNAS_DEL_LEAD.map(([col]) => `"${col}" = EXCLUDED."${col}"`).join(",");
  await db.escribir(
    `INSERT INTO "EmbudoLead" ("conversationId",${lista},"updatedAt") VALUES ($1,${marcas.join(",")},now())
     ON CONFLICT ("conversationId") DO UPDATE SET ${actualizar}, "version" = "EmbudoLead"."version" + 1, "updatedAt" = now()`,
    valores,
  );
  return true;
}

/**
 * El relleno completo de una línea y un rango de días (de Bogotá, ambos incluidos).
 * `alAvanzar` se llama al empezar (con el total) y al terminar cada lote.
 */
export async function ejecutarRelleno(
  db: BaseDelRelleno,
  opciones: OpcionesDelRelleno,
  alAvanzar?: (progreso: ProgresoDelRelleno) => Promise<void> | void,
): Promise<ProgresoDelRelleno> {
  if (!opciones.workspaceId || !opciones.linea || !esDiaValido(opciones.desde) || !esDiaValido(opciones.hasta)) {
    throw new Error("Faltan el negocio, la línea, desde AAAA-MM-DD y hasta AAAA-MM-DD");
  }
  if (opciones.desde > opciones.hasta) throw new Error("La fecha 'desde' es posterior a 'hasta'");

  const lineas = await db.leer(
    `SELECT "id","name" FROM "WhatsAppChannel" WHERE "workspaceId" = $1 AND ("id" = $2 OR lower("name") = lower($2))`,
    [opciones.workspaceId, opciones.linea],
  );
  if (lineas.length !== 1) throw new Error(`La línea "${opciones.linea}" no existe o es ambigua (${lineas.length})`);
  const linea = { id: String(lineas[0].id), nombre: String(lineas[0].name) };

  if (opciones.escribir && (await leerAjuste(db, `embudo:activo:${opciones.workspaceId}`))?.trim().toLowerCase() === "false") {
    throw new Error("El embudo está apagado en este negocio (embudo:activo = false): no se escribe nada.");
  }

  const config = leerConfigEmbudoDeTexto(await leerAjuste(db, `embudo:config:${opciones.workspaceId}`));
  const libros = armarLineaDeLibros(
    parsearJson<LibroV3>(await leerAjuste(db, `agente-v3:libro:${opciones.workspaceId}`), { reglas: [] }),
    parsearJson<unknown>(await leerAjuste(db, `agente-v3:historial:${opciones.workspaceId}`), []),
  );
  const productos = await db.leer(`SELECT "id","name" FROM "Product" WHERE "workspaceId" = $1`, [opciones.workspaceId]);
  const nombres = new Map(productos.map((p) => [String(p.id), textoONulo(p.name)]));
  const claveProducto = (id: string | null) => (id ? claveDeProducto({ id, nombre: nombres.get(id) ?? null }, config) : null);

  const { inicio, fin } = rangoBogota(opciones.desde, opciones.hasta);
  const chats = await leerChats(db, {
    workspaceId: opciones.workspaceId,
    channelId: linea.id,
    inicio,
    fin,
    limite: opciones.limite ?? 0,
  });

  const progreso: ProgresoDelRelleno = {
    lineaId: linea.id,
    lineaNombre: linea.nombre,
    procesados: 0,
    total: chats.length,
    porTipo: {},
    resumen: resumenVacio(),
    insertados: 0,
    leadsRecalculados: 0,
  };
  await alAvanzar?.(progreso);

  const tamano = Math.max(1, opciones.tamanoLote ?? TAMANO_LOTE_POR_DEFECTO);
  const pausa = Math.max(0, opciones.pausaEntreLotesMs ?? 250);
  for (let desdeIndice = 0; desdeIndice < chats.length; desdeIndice += tamano) {
    const lote = chats.slice(desdeIndice, desdeIndice + tamano);
    for (const chat of lote) {
      const conNegocio = { ...chat, workspaceId: opciones.workspaceId };
      const mensajes = await leerMensajes(db, chat.id);
      const reconstruidos = reconstruirChat({
        chat,
        mensajes,
        contacto: {
          metadata: { adTitle: chat.adTitle, adSourceId: chat.adSourceId, adSourceApp: chat.adSourceApp },
          crmStage: chat.crmStage,
          wonQuoteRef: chat.wonQuoteRef,
          wonAt: chat.wonAt,
        },
        libros,
        config,
        claveProducto,
      });
      const enVivo = await db.leer(
        `SELECT min("createdAt") AS "desde" FROM "EmbudoEvento" WHERE "conversationId" = $1 AND "origen" <> 'backfill'`,
        [chat.id],
      );
      const eventos = filtrarContraEnVivo(reconstruidos, fecha(enVivo[0]?.desde));
      sumarChat(progreso.resumen, progreso.porTipo, eventos);
      if (opciones.escribir && eventos.length) {
        progreso.insertados += await insertarEventos(db, conNegocio, eventos);
        if (await recalcularLead(db, conNegocio)) progreso.leadsRecalculados += 1;
      }
      progreso.procesados += 1;
    }
    await alAvanzar?.(progreso);
    if (pausa && desdeIndice + tamano < chats.length) await esperar(pausa);
  }
  return progreso;
}
