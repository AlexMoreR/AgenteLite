// RELLENO HISTÓRICO DEL EMBUDO (F1).
//
// Reconstruye, para una línea y un rango de fechas, los mismos eventos que hoy se registran en
// vivo (ENTRADA, BIENVENIDA, RESPONDIÓ, PASO, RECOMENDACIÓN, SEÑAL, TURNO, ESCALADO, ASIGNADA,
// ASESORA_RESPONDIÓ, SEGUIMIENTO, ETAPA_CRM, VENTA) a partir de lo que ya está en la base:
//   - los mensajes de cada chat (Message), con rawPayload.source y externalId;
//   - las notas del agente ("Agente V3: Ganó "regla" porque…"), las de asignación y de etapa;
//   - el libro V3 vigente en cada momento (AppSetting agente-v3:libro / agente-v3:historial),
//     para saber qué producto activó y a qué paso movió cada regla ganadora;
//   - la etapa y la cotización de venta del contacto (Contact.crmStage / wonQuoteRef / wonAt).
// Todo con origen = "backfill" y claveUnica, así que correrlo dos veces no duplica nada. La foto
// de cada lead (EmbudoLead) se recalcula con TODOS sus eventos (los en vivo y los del relleno).
// Las reglas son las mismas del registro en vivo: src/features/embudo/dominio/*.ts.
//
// Por defecto SIMULA: solo cuenta y muestra un resumen. Para escribir hay que pasar --escribir.
//
// Uso:
//   node scripts/embudo-backfill.mjs --workspace <id> --linea <id o nombre> --desde 2026-10-01 --hasta 2026-10-09
//   node scripts/embudo-backfill.mjs ... --escribir         (inserta los eventos y recalcula los leads)
//   node scripts/embudo-backfill.mjs ... --limite 50        (solo los primeros 50 chats)
// Lee DATABASE_URL del entorno (o de .env). Necesita las dependencias de desarrollo (typescript).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const requireNativo = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ cargar el dominio en TS */

const cache = new Map();
function cargar(archivo) {
  const ts = requireNativo("typescript");
  const absoluto = path.resolve(RAIZ, archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (pedido.startsWith(".")) {
      const base = path.resolve(path.dirname(absoluto), pedido);
      for (const candidato of [base, `${base}.ts`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports, requerir, mod, absoluto, path.dirname(absoluto),
  );
  return mod.exports;
}

const dominio = () => ({
  eventos: cargar("src/features/embudo/dominio/eventos.ts"),
  combo: cargar("src/features/embudo/dominio/combo.ts"),
});

/* ------------------------------------------------------------------ utilidades */

const ORIGEN = "backfill";
const FUENTES_DE_PERSONA = new Set(["manual", "instance"]);
const FUENTES_DE_SEGUIMIENTO = new Set(["agente-v3-seguimiento", "follow"]);
/** Claves que el registro en vivo usa igual: el relleno no las duplica nunca. */
const CLAVES_COMO_EN_VIVO = /^(ENTRADA|BIENVENIDA|RESPONDIO|PASO|RECOMENDACION|ASESORA_RESPONDIO|SENAL|VENTA):/;

function argumentos(argv) {
  const salida = { escribir: false, limite: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const clave = argv[i];
    const valor = argv[i + 1];
    if (clave === "--escribir") salida.escribir = true;
    else if (clave === "--simular") salida.escribir = false;
    else if (clave === "--workspace") { salida.workspace = valor; i += 1; }
    else if (clave === "--linea") { salida.linea = valor; i += 1; }
    else if (clave === "--desde") { salida.desde = valor; i += 1; }
    else if (clave === "--hasta") { salida.hasta = valor; i += 1; }
    else if (clave === "--limite") { salida.limite = Number(valor) || 0; i += 1; }
  }
  return salida;
}

const diaValido = (dia) => /^\d{4}-\d{2}-\d{2}$/.test(dia ?? "");
function rangoBogota(desde, hasta) {
  const fin = new Date(`${hasta}T00:00:00.000-05:00`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return { inicio: new Date(`${desde}T00:00:00.000-05:00`), fin };
}

function parsearJson(texto, porDefecto) {
  try {
    return texto ? JSON.parse(texto) : porDefecto;
  } catch {
    return porDefecto;
  }
}

/**
 * Las versiones del libro con su vigencia. El historial guarda cada versión ANTERIOR con la hora
 * en que se reemplazó (`at`); la actual rige desde `actualizadoEl`.
 */
export function armarLineaDeLibros(libroActual, historial) {
  const versiones = (Array.isArray(historial) ? historial : [])
    .filter((fila) => fila && typeof fila.at === "string" && fila.libro)
    .map((fila) => ({ version: fila.version ?? fila.libro?.version ?? null, hasta: new Date(fila.at), libro: fila.libro }))
    .sort((a, b) => a.hasta - b.hasta);
  return {
    enElMomento(cuando) {
      const vigente = versiones.find((fila) => fila.hasta > cuando);
      if (vigente) return { version: vigente.version, libro: vigente.libro };
      return { version: libroActual?.version ?? null, libro: libroActual ?? { reglas: [] } };
    },
  };
}

const RE_GANO = /Gan[oó] [«"“]([^»"”]+)[»"”] porque/;
const RE_SIGUE = /sigue con [«"“]([^»"”]+)[»"”]/;
const RE_RETOMO = /retom[oó] la conversaci[oó]n al volver a encenderse: (.+)$/;
const RE_PIDE_ASESOR = /^El agente pide un asesor: (.+)$/s;

/** Qué hizo la regla ganadora de una nota del V3: producto, paso y si mandó un flujo. */
function accionesDeLaNota(texto, libro) {
  const reglas = Array.isArray(libro?.reglas) ? libro.reglas : [];
  const nombres = [];
  const gano = texto.match(RE_GANO) ?? texto.match(RE_RETOMO);
  if (gano) nombres.push(gano[1].trim());
  const sigue = texto.match(RE_SIGUE);
  if (sigue) nombres.push(sigue[1].trim());
  const encontradas = nombres.map((nombre) => reglas.find((regla) => regla.nombre === nombre)).filter(Boolean);
  const acciones = encontradas.flatMap((regla) => (Array.isArray(regla.entonces) ? regla.entonces : []));
  return {
    regla: encontradas[0] ?? (nombres[0] ? { id: null, nombre: nombres[0] } : null),
    acciones,
    // Las notas sin regla del libro (Catálogo de Gestión, Redactor, Compra por cantidad) igual son turno.
    esTurno: Boolean(gano) || texto.startsWith("Agente V3:"),
  };
}

function aplicarAcciones(estado, acciones) {
  let siguiente = { ...estado };
  for (const accion of acciones) {
    if (accion?.tipo === "activar_producto") {
      siguiente = { ...siguiente, producto: accion.productoId, paso: siguiente.paso ?? "PRESENTACION" };
    }
    if (accion?.tipo === "ir_al_paso") siguiente = { ...siguiente, paso: accion.paso };
  }
  return siguiente;
}

function origenDeLaAsignacion(texto, actor, origen) {
  if (origen) return origen;
  const t = (texto ?? "").toLowerCase();
  if (t.includes("por la campa")) return "campana";
  if (t.includes("respaldo")) return "respaldo";
  if (t.includes("madrugada")) return "madrugada";
  if (t.includes("al responder")) return "tomo_al_responder";
  if (t.includes("auto-asignado")) return "turno";
  return actor ? "manual" : "automatico";
}

/**
 * Los eventos de UN chat, a partir de sus mensajes (del más viejo al más nuevo). Pura: no toca
 * la base. `claveProducto(id)` traduce un producto del V3 a la clave del embudo.
 */
export function reconstruirChat({ chat, mensajes, contacto, libros, config, claveProducto }) {
  const { eventos: e, combo } = dominio();
  const salida = [];
  const id = chat.id;
  const entrantes = mensajes.filter((m) => m.direction === "INBOUND" && m.type !== "SYSTEM");
  if (!entrantes.length) return salida;
  const primero = entrantes[0];

  // ENTRADA
  const anuncio = contacto?.metadata?.adTitle || contacto?.metadata?.adSourceId
    ? { titulo: contacto.metadata.adTitle ?? "", id: contacto.metadata.adSourceId ?? "", red: contacto.metadata.adSourceApp ?? "" }
    : null;
  const libroEntrada = libros.enElMomento(primero.createdAt);
  salida.push({
    tipo: "ENTRADA",
    origen: ORIGEN,
    producto: combo.productoDeEntrada({ anuncio, primerMensaje: primero.content }, config),
    libroVersion: libroEntrada.version,
    claveUnica: `ENTRADA:${id}`,
    createdAt: primero.createdAt,
    datos: { anuncioTitulo: anuncio?.titulo || null, anuncioRed: anuncio?.red || null, anuncioId: anuncio?.id || null, porAnuncio: Boolean(anuncio) },
  });

  let estado = { producto: null, paso: null };
  let ultimoCorte = new Date(0); // hasta dónde ya se miró (la nota anterior)
  let botHablo = false;
  let asesoraRespondio = false;
  const inicio = mensajes[0].createdAt;

  for (const m of mensajes) {
    const fuente = m.source ?? null;
    const texto = (m.content ?? "").trim();

    if (m.type !== "SYSTEM" && m.direction === "INBOUND") {
      // SEÑALES de cada mensaje (con la transcripción si es audio).
      for (const ev of e.eventosDeSenales({
        conversationId: id,
        texto: m.transcripcion || m.content || "",
        paso: estado.paso,
        producto: claveProducto(estado.producto),
        origen: ORIGEN,
        idDelMensaje: m.externalId || m.id,
        cuando: m.createdAt,
      })) salida.push(ev);
      continue;
    }

    if (m.type !== "SYSTEM" && m.direction === "OUTBOUND") {
      if (FUENTES_DE_PERSONA.has(fuente)) {
        // Lo que sale del celular en el primer minuto es el automático de la línea, no una persona.
        const automatico = fuente === "instance" && m.createdAt - inicio < 60_000;
        if (!asesoraRespondio && !automatico) {
          asesoraRespondio = true;
          salida.push({
            tipo: "ASESORA_RESPONDIO",
            origen: ORIGEN,
            claveUnica: `ASESORA_RESPONDIO:${id}`,
            createdAt: m.createdAt,
            datos: { asesora: m.enviadoPorUserId ?? null, via: fuente === "instance" ? "celular" : "crm" },
          });
        }
      } else if (FUENTES_DE_SEGUIMIENTO.has(fuente)) {
        salida.push({
          tipo: "SEGUIMIENTO_ENVIADO",
          origen: ORIGEN,
          paso: estado.paso,
          producto: claveProducto(estado.producto),
          claveUnica: `SEGUIMIENTO:${id}:${m.id}`,
          createdAt: m.createdAt,
          datos: { motor: fuente === "follow" ? "follow" : "v3" },
        });
      }
      continue;
    }

    // Notas del sistema.
    if (m.kind === "assigned") {
      salida.push({
        tipo: "ASIGNADA",
        origen: ORIGEN,
        claveUnica: `ASIGNADA:${id}:${m.id}`,
        createdAt: m.createdAt,
        datos: { asesora: m.assigneeUserId ?? null, origenReparto: origenDeLaAsignacion(texto, m.actorUserId, m.origen), carga: null },
      });
      continue;
    }
    if (m.kind === "stage_changed") {
      salida.push({ tipo: "ETAPA_CRM", origen: ORIGEN, claveUnica: `ETAPA:${id}:${m.id}`, createdAt: m.createdAt, datos: { nota: texto.slice(0, 200) } });
      continue;
    }
    const pide = texto.match(RE_PIDE_ASESOR);
    if (pide) {
      salida.push({ tipo: "ESCALADO", origen: ORIGEN, claveUnica: `ESCALADO:${id}:${m.id}`, createdAt: m.createdAt, datos: { motivo: pide[1].slice(0, 300) } });
      continue;
    }
    if (!(texto.startsWith("Agente V3:") || RE_RETOMO.test(texto))) continue;

    // UN TURNO DEL V3: lo que escribió la clienta desde la nota anterior y lo que salió del bot.
    const { version, libro } = libros.enElMomento(m.createdAt);
    const { regla, acciones, esTurno } = accionesDeLaNota(texto, libro);
    if (!esTurno) continue;
    const delTurno = mensajes.filter((x) => x.createdAt > ultimoCorte && x.createdAt <= m.createdAt && x.type !== "SYSTEM");
    const delCliente = delTurno.filter((x) => x.direction === "INBOUND");
    const ultimoDelCliente = delCliente.at(-1);
    const delBot = delTurno.filter(
      (x) => x.direction === "OUTBOUND" && !FUENTES_DE_PERSONA.has(x.source) && !FUENTES_DE_SEGUIMIENTO.has(x.source) &&
        (!ultimoDelCliente || x.createdAt >= ultimoDelCliente.createdAt),
    );
    const antes = { ...estado };
    const despues = aplicarAcciones(estado, acciones);
    const traza = {
      libroVersion: version,
      antes: { pasoActual: antes.paso, producto: antes.producto, esPrimerMensaje: !botHablo },
      despues: { pasoActual: despues.paso, producto: despues.producto },
      intenciones: [],
      tiposDeAccion: acciones.map((accion) => accion.tipo),
      conSaludo: !botHablo && delBot.length > 0,
      envioFlujo: acciones.some((accion) => accion.tipo === "flujo"),
      mensajesEnviados: delBot.length,
      reglaId: regla?.id ?? null,
      reglaNombre: regla?.nombre ?? null,
      cuando: (ultimoDelCliente?.createdAt ?? m.createdAt).toISOString(),
    };
    for (const ev of e.eventosDelTurno({
      conversationId: id,
      traza,
      atendido: true,
      mensajeCliente: delCliente.map((x) => x.transcripcion || x.content || "").join("\n"),
      tipoMensaje: ultimoDelCliente?.type ?? "TEXT",
      claveProducto,
      origen: ORIGEN,
      idDelTurno: m.id,
      incluirSenales: false, // ya salieron por mensaje, arriba
    })) salida.push(ev);
    estado = despues;
    if (delBot.length) botHablo = true;
    ultimoCorte = m.createdAt;
  }

  // VENTA: el contacto quedó en Ganado con su cotización de Gestión.
  if (contacto?.crmStage === "GANADO" && contacto.wonQuoteRef) {
    salida.push({
      tipo: "VENTA",
      origen: ORIGEN,
      claveUnica: `VENTA:${id}:${contacto.wonQuoteRef}`,
      createdAt: contacto.wonAt ?? mensajes.at(-1).createdAt,
      datos: { cotizacion: contacto.wonQuoteRef },
    });
  }
  return salida;
}

/* ------------------------------------------------------------------ base */

async function leerChats(db, { workspaceId, channelId, inicio, fin, limite }) {
  const { rows } = await db.query(
    `SELECT c."id", c."contactId", c."channelId", c."startedAt", p."primerEntrante",
            ct."metadata" AS "contactoMeta", ct."crmStage", ct."wonAt", ct."wonQuoteRef"
     FROM "Conversation" c
     JOIN "Contact" ct ON ct."id" = c."contactId"
     JOIN LATERAL (
       SELECT min(m."createdAt") AS "primerEntrante" FROM "Message" m
       WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM'
     ) p ON true
     WHERE c."workspaceId" = $1 AND c."channelId" = $2
       AND p."primerEntrante" >= $3 AND p."primerEntrante" < $4
     ORDER BY p."primerEntrante" ASC
     ${limite ? `LIMIT ${Number(limite)}` : ""}`,
    [workspaceId, channelId, inicio, fin],
  );
  return rows;
}

async function leerMensajes(db, conversationId) {
  const { rows } = await db.query(
    `SELECT m."id", m."direction", m."type", m."content", m."transcripcion", m."externalId", m."createdAt",
            m."rawPayload"->>'source' AS "source", m."rawPayload"->>'kind' AS "kind",
            m."rawPayload"->>'assigneeUserId' AS "assigneeUserId", m."rawPayload"->>'actorUserId' AS "actorUserId",
            m."rawPayload"->>'origen' AS "origen", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId"
     FROM "Message" m
     WHERE m."conversationId" = $1 AND m."deletedAt" IS NULL AND COALESCE(m."isStatusBroadcast", false) = false
     ORDER BY m."createdAt" ASC, m."id" ASC`,
    [conversationId],
  );
  return rows.map((fila) => ({ ...fila, createdAt: new Date(fila.createdAt) }));
}

async function leerAjuste(db, clave) {
  const { rows } = await db.query(`SELECT "value" FROM "AppSetting" WHERE "key" = $1`, [clave]);
  return rows[0]?.value ?? null;
}

async function insertarEventos(db, chat, eventos) {
  let nuevos = 0;
  for (const ev of eventos) {
    const { rowCount } = await db.query(
      `INSERT INTO "EmbudoEvento" ("id","workspaceId","conversationId","contactId","channelId","producto","paso","tipo",
         "reglaId","reglaNombre","libroVersion","origen","datos","claveUnica","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT DO NOTHING`,
      [
        `bf${crypto.randomUUID().replace(/-/g, "").slice(0, 23)}`,
        chat.workspaceId, chat.id, chat.contactId, chat.channelId, ev.producto ?? null, ev.paso ?? null, ev.tipo,
        ev.reglaId ?? null, ev.reglaNombre ?? null, ev.libroVersion ?? null, ev.origen,
        ev.datos ? JSON.stringify(ev.datos) : null, ev.claveUnica ?? null, ev.createdAt ?? new Date(),
      ],
    );
    nuevos += rowCount ?? 0;
  }
  return nuevos;
}

/** Recalcula la foto del lead con TODOS sus eventos (en vivo + relleno), en orden. */
async function recalcularLead(db, chat) {
  const { eventos: e } = dominio();
  const { rows } = await db.query(
    `SELECT "tipo","origen","paso","producto","libroVersion","datos","createdAt" FROM "EmbudoEvento"
     WHERE "conversationId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
    [chat.id],
  );
  const contexto = {
    conversationId: chat.id, contactId: chat.contactId, workspaceId: chat.workspaceId,
    channelId: chat.channelId ?? "", inicioDeLaCharla: new Date(chat.startedAt),
  };
  let foto = null;
  for (const fila of rows) {
    const datos = typeof fila.datos === "string" ? parsearJson(fila.datos, null) : fila.datos;
    foto = e.aplicarEvento(foto, { ...fila, datos, createdAt: new Date(fila.createdAt) }, contexto);
  }
  if (!foto) return;
  const columnas = [
    "contactId", "workspaceId", "channelId", "productoEntrada", "productoActual", "mezcla", "anuncioId", "anuncioTitulo",
    "anuncioRed", "entradaEn", "libroVersionEntrada", "pasoActual", "pasoMaximo", "temperatura", "puntaje", "motivo",
    "senales", "transferencia", "asignadaA", "asignadaEn", "primeraRespuestaAsesoraEn", "ultimoClienteEn", "ultimoBotEn",
    "cotizacionRef", "cotizacionEn", "anticipoEn", "ventaEn",
  ];
  const valores = columnas.map((col) => (col === "senales" ? (foto.senales ? JSON.stringify(foto.senales) : null) : foto[col] ?? null));
  const lista = columnas.map((col) => `"${col}"`).join(",");
  const marcas = columnas.map((_, i) => `$${i + 2}`).join(",");
  const actualizar = columnas.map((col) => `"${col}" = EXCLUDED."${col}"`).join(",");
  await db.query(
    `INSERT INTO "EmbudoLead" ("conversationId",${lista},"updatedAt") VALUES ($1,${marcas},now())
     ON CONFLICT ("conversationId") DO UPDATE SET ${actualizar}, "version" = "EmbudoLead"."version" + 1, "updatedAt" = now()`,
    [chat.id, ...valores],
  );
}

/**
 * El relleno. `db` es cualquier cosa con `query(texto, valores)` que devuelva `{ rows, rowCount }`
 * (un Pool de pg, o PGlite en las pruebas).
 */
export async function ejecutarBackfill(db, opciones, log = console.log) {
  const { combo } = dominio();
  if (!opciones.workspace || !opciones.linea || !diaValido(opciones.desde) || !diaValido(opciones.hasta)) {
    throw new Error("Faltan --workspace, --linea, --desde AAAA-MM-DD y --hasta AAAA-MM-DD");
  }
  const { rows: lineas } = await db.query(
    `SELECT "id","name" FROM "WhatsAppChannel" WHERE "workspaceId" = $1 AND ("id" = $2 OR lower("name") = lower($2))`,
    [opciones.workspace, opciones.linea],
  );
  if (lineas.length !== 1) throw new Error(`La línea "${opciones.linea}" no existe o es ambigua (${lineas.length})`);
  const linea = lineas[0];

  if ((await leerAjuste(db, `embudo:activo:${opciones.workspace}`))?.trim().toLowerCase() === "false" && opciones.escribir) {
    throw new Error("El embudo está apagado en este negocio (embudo:activo = false): no se escribe nada.");
  }

  const config = combo.leerConfigEmbudoDeTexto(await leerAjuste(db, `embudo:config:${opciones.workspace}`));
  const libros = armarLineaDeLibros(
    parsearJson(await leerAjuste(db, `agente-v3:libro:${opciones.workspace}`), { reglas: [] }),
    parsearJson(await leerAjuste(db, `agente-v3:historial:${opciones.workspace}`), []),
  );
  const { rows: productos } = await db.query(`SELECT "id","name" FROM "Product" WHERE "workspaceId" = $1`, [opciones.workspace]);
  const nombres = new Map(productos.map((p) => [p.id, p.name]));
  const claveProducto = (id) => (id ? combo.claveDeProducto({ id, nombre: nombres.get(id) ?? null }, config) : null);

  const { inicio, fin } = rangoBogota(opciones.desde, opciones.hasta);
  const chats = await leerChats(db, { workspaceId: opciones.workspace, channelId: linea.id, inicio, fin, limite: opciones.limite });
  log(`Línea "${linea.name}" · ${opciones.desde} a ${opciones.hasta} · ${chats.length} chats · ${opciones.escribir ? "ESCRIBIENDO" : "simulación (no escribe)"}`);

  const porTipo = new Map();
  const embudo = { leads: 0, combo: 0, bienvenida: 0, respondio: 0, identificacion: 0, recomendacion: 0, senal: 0, asesora: 0, venta: 0 };
  let insertados = 0;
  for (const chat of chats) {
    const mensajes = await leerMensajes(db, chat.id);
    const contacto = {
      metadata: typeof chat.contactoMeta === "string" ? parsearJson(chat.contactoMeta, {}) : chat.contactoMeta ?? {},
      crmStage: chat.crmStage,
      wonQuoteRef: chat.wonQuoteRef,
      wonAt: chat.wonAt ? new Date(chat.wonAt) : null,
    };
    const reconstruidos = reconstruirChat({
      chat: { ...chat, workspaceId: opciones.workspace },
      mensajes,
      contacto,
      libros,
      config,
      claveProducto,
    });
    /*
      Desde que el registro en vivo empezó a anotar este chat, solo se rellena lo que tiene la
      MISMA claveUnica que en vivo (se descarta solo si ya está). Lo demás (TURNO, ESCALADO,
      ASIGNADA...) en vivo no lleva clave y quedaría repetido.
    */
    const { rows: enVivo } = await db.query(
      `SELECT min("createdAt") AS "desde" FROM "EmbudoEvento" WHERE "conversationId" = $1 AND "origen" <> 'backfill'`,
      [chat.id],
    );
    const vivoDesde = enVivo[0]?.desde ? new Date(enVivo[0].desde) : null;
    const eventos = vivoDesde
      ? reconstruidos.filter((ev) => (ev.createdAt ?? new Date()) < vivoDesde || CLAVES_COMO_EN_VIVO.test(ev.claveUnica ?? ""))
      : reconstruidos;
    for (const ev of eventos) porTipo.set(ev.tipo, (porTipo.get(ev.tipo) ?? 0) + 1);
    const tipos = new Set(eventos.map((ev) => `${ev.tipo}:${ev.paso ?? ""}`));
    const entrada = eventos.find((ev) => ev.tipo === "ENTRADA");
    embudo.leads += 1;
    if (entrada?.producto === combo.CLAVE_COMBO) embudo.combo += 1;
    if ([...tipos].some((t) => t.startsWith("BIENVENIDA_ENVIADA"))) embudo.bienvenida += 1;
    if (tipos.has("CLIENTE_RESPONDIO:PRESENTACION")) embudo.respondio += 1;
    if (tipos.has("CLIENTE_RESPONDIO:IDENTIFICACION")) embudo.identificacion += 1;
    if ([...tipos].some((t) => t.startsWith("RECOMENDACION_ENVIADA"))) embudo.recomendacion += 1;
    if ([...tipos].some((t) => t.startsWith("SENAL"))) embudo.senal += 1;
    if ([...tipos].some((t) => t.startsWith("ESCALADO") || t.startsWith("ASIGNADA"))) embudo.asesora += 1;
    if ([...tipos].some((t) => t.startsWith("VENTA"))) embudo.venta += 1;

    if (opciones.escribir) {
      insertados += await insertarEventos(db, { ...chat, workspaceId: opciones.workspace }, eventos);
      await recalcularLead(db, { ...chat, workspaceId: opciones.workspace });
    }
  }

  log("Eventos por tipo:");
  for (const [tipo, cuantos] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) log(`  ${tipo.padEnd(22)} ${cuantos}`);
  log("Embudo (todos los chats de la línea, cuenta si llegó alguna vez):");
  for (const [paso, cuantos] of Object.entries(embudo)) log(`  ${paso.padEnd(22)} ${cuantos}`);
  if (opciones.escribir) log(`Eventos nuevos insertados: ${insertados} (los repetidos se ignoraron por claveUnica).`);
  return { chats: chats.length, porTipo: Object.fromEntries(porTipo), embudo, insertados };
}

/* ------------------------------------------------------------------ línea de comandos */

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esPrincipal) {
  const opciones = argumentos(process.argv.slice(2));
  try {
    requireNativo("dotenv/config");
  } catch {
    // sin dotenv: se usa el entorno tal cual
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const { Pool } = requireNativo("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  ejecutarBackfill(pool, opciones)
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
