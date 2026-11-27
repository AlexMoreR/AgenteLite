// Informe de SOLO LECTURA: ¿cuántos mensajes AUTOMÁTICOS le salieron al cliente en chats que ya eran de
// la asesora? (tarjeta 8yvjdvpw, parte 3, 27-11-2026: «el bot no debe escribir en chats que ya atiende una
// asesora»). Con las partes 1 y 2 en producción, `--dias 1` al día siguiente debe dar 0.
//
// No escribe, no asigna y no manda mensajes: solo hace SELECT, dentro de una transacción de solo lectura.
// Uso:
//   node scripts/reporte-automaticos-en-chats-de-asesora.mjs              últimos 7 días, contra DATABASE_URL
//   node scripts/reporte-automaticos-en-chats-de-asesora.mjs --dias 1     otra ventana
//   node scripts/reporte-automaticos-en-chats-de-asesora.mjs --ejemplo    datos inventados, sin base
// Si la base no responde, imprime `{ no_se_pudo_leer: [...] }` y sale con código 0: no inventa cifras.
//
// Qué cuenta:
//  - Mensajes SALIENTES automáticos (en el MCP salen como `agente_o_flujo`): sin origen (el bot o un
//    flujo) o con un origen de bot o de seguimiento. Nunca los de una persona (`manual` del CRM,
//    `instance` del celular, `automation_reactivation`, que lo manda la asesora con su botón), las notas
//    (`activity`, `llamada`, tipo SYSTEM), los borrados, los que fallaron, ni el HISTORIAL IMPORTADO
//    (`evolution-sync`, `evogo-history-sync`), que también saldría como `agente_o_flujo`.
//  - Solo en chats que EN ESE MOMENTO eran de la asesora (misma regla que src/lib/chat-de-la-asesora.ts):
//    la IA pausada (y pausada desde antes del envío), o asesora asignada y un mensaje de persona anterior
//    al envío (`manual`, o `instance` pasado el primer minuto de la charla: `esMensajeHumano`).
//    La base guarda la pausa y la asesora de HOY, no su historia: un chat que se pausó o se asignó
//    después del envío no cuenta, y uno que se despausó después tampoco.
//  - El AVISO DE PAUSA es el acuse de los chats pausados: sale cuando el bot pasa el chat y nadie del
//    equipo ha escrito todavía (hayPersonaEnElChat, parte 2). Por eso solo cuenta si una persona ya había
//    escrito antes de él; si no, es el comportamiento esperado y no es un error.
import "dotenv/config";
import { fileURLToPath } from "node:url";

/** Orígenes que NO son automáticos (persona, notas o historial importado). */
export const ORIGENES_NO_AUTOMATICOS = [
  "manual",
  "instance",
  "automation_reactivation",
  "activity",
  "llamada",
  "evolution-sync",
  "evogo-history-sync",
];

/** Lo que el celular manda solo en el primer minuto de la charla no es de persona (PRIMER_MINUTO_MS). */
export const PRIMER_MINUTO_SEGUNDOS = 60;

/** El acuse de un chat pausado (src/app/api/webhooks/evolution/route.ts, enviarAvisoDePausaUnaVez). */
export const TEXTO_AVISO_DE_PAUSA = "En un momento una de nuestras asesoras te contacta 🙌";

/** La respuesta al exterior si el negocio no la cambió (TEXTO_EXTERIOR_POR_DEFECTO). */
export const TEXTO_EXTERIOR_POR_DEFECTO =
  "¡Hola! 😊 Gracias por escribirnos. Por ahora solo vendemos y enviamos dentro de *Colombia*. Si estás en Colombia, cuéntame en qué ciudad y con gusto te ayudo 🙌";

const PREFIJO_CONFIG_SEGUIMIENTO = "seguimiento-inteligente:config:";

export const TIPOS = ["seguimiento", "aviso_de_pausa", "recordatorio_v3", "respuesta_al_exterior", "otro"];
export const CLASES_DE_SEGUIMIENTO = ["dia_siguiente", "inteligente", "tras_asesora", "campana", "otro"];

/**
 * La clase de un seguimiento `follow` por el nombre de su Follow: la misma regla que
 * `claseDeSeguimiento` (src/features/recuperacion/dominio/semana.ts). Los recordatorios del V3 van aparte.
 */
export function claseDelFollow(nombreDelFollow) {
  const nombre = String(nombreDelFollow ?? "").trim().toLowerCase();
  if (nombre.startsWith("tras asesora")) return "tras_asesora";
  if (nombre.startsWith("etapa")) return "dia_siguiente";
  if (nombre.startsWith("inteligente")) return "inteligente";
  if (nombre.startsWith("campa")) return "campana";
  return "otro";
}

const limpio = (texto) => String(texto ?? "").trim();

/**
 * Qué automático es. `fila`: { origen, follow, texto, workspaceId }. `textosExterior`: Map workspaceId →
 * texto de la respuesta al exterior configurado (si no hay, el de por defecto).
 */
export function tipoDelMensaje(fila, textosExterior = new Map()) {
  if (fila.origen === "follow") return { tipo: "seguimiento", clase: claseDelFollow(fila.follow) };
  if (fila.origen === "agente-v3-seguimiento" || fila.origen === "agente-v3-seguimiento-ia") {
    return { tipo: "recordatorio_v3", clase: null };
  }
  const texto = limpio(fila.texto);
  if (texto && texto === TEXTO_AVISO_DE_PAUSA) return { tipo: "aviso_de_pausa", clase: null };
  const exterior = limpio(textosExterior.get(fila.workspaceId) ?? TEXTO_EXTERIOR_POR_DEFECTO);
  if (texto && (texto === exterior || texto === TEXTO_EXTERIOR_POR_DEFECTO)) return { tipo: "respuesta_al_exterior", clase: null };
  return { tipo: "otro", clase: null };
}

/** El texto de la respuesta al exterior guardado en `seguimiento-inteligente:config:<negocio>` (o null). */
export function textoExteriorDeLaConfig(valor) {
  try {
    const crudo = JSON.parse(String(valor ?? ""));
    const texto = crudo && typeof crudo === "object" ? crudo.exterior?.texto : null;
    return typeof texto === "string" && texto.trim() ? texto.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Arma el informe. `mensajes`: { conversationId, workspaceId, dia, origen, follow, texto, asesora,
 * personaAntes } (`personaAntes`: una persona ya había escrito antes de ese envío).
 */
export function armarInforme({ mensajes, textosExterior = new Map(), dias, noSePudoLeer = [] }) {
  const porDia = {};
  const porTipo = {
    seguimiento: { total: 0, por_clase: Object.fromEntries(CLASES_DE_SEGUIMIENTO.map((clase) => [clase, 0])) },
    aviso_de_pausa: 0,
    recordatorio_v3: 0,
    respuesta_al_exterior: 0,
    otro: 0,
  };
  const porChat = new Map();
  let total = 0;
  for (const mensaje of mensajes) {
    const { tipo, clase } = tipoDelMensaje(mensaje, textosExterior);
    // El acuse de pausa antes de que escriba una persona es lo esperado (ver arriba): no cuenta.
    if (tipo === "aviso_de_pausa" && mensaje.personaAntes === false) continue;
    total += 1;
    porDia[mensaje.dia] = (porDia[mensaje.dia] ?? 0) + 1;
    if (tipo === "seguimiento") {
      porTipo.seguimiento.total += 1;
      porTipo.seguimiento.por_clase[clase] += 1;
    } else {
      porTipo[tipo] += 1;
    }
    const chat = porChat.get(mensaje.conversationId) ?? {
      conversationId: mensaje.conversationId,
      asesora: mensaje.asesora ?? "(sin asesora)",
      cantidad: 0,
    };
    chat.cantidad += 1;
    porChat.set(mensaje.conversationId, chat);
  }
  const informe = {
    dias,
    total,
    por_dia: Object.fromEntries(Object.entries(porDia).sort(([a], [b]) => a.localeCompare(b))),
    por_tipo: porTipo,
    chats: [...porChat.values()].sort((a, b) => b.cantidad - a.cantidad || a.conversationId.localeCompare(b.conversationId)),
  };
  if (noSePudoLeer.length > 0) informe.no_se_pudo_leer = noSePudoLeer;
  return informe;
}

/**
 * La consulta de los mensajes. `$1` = días, `$2` = orígenes que no son automáticos, `$3` = segundos del
 * primer minuto. Es la misma regla que esChatDeLaAsesora, mirada en el momento de cada envío.
 */
export const SQL_MENSAJES = `
  SELECT m."conversationId", c."workspaceId",
         to_char(m."createdAt" AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS "dia",
         m."rawPayload"->>'source' AS "origen", m."content" AS "texto",
         f."name" AS "follow",
         COALESCE(NULLIF(trim(u."name"), ''), u."email") AS "asesora",
         persona."antes" AS "personaAntes"
    FROM "Message" m
    JOIN "Conversation" c ON c."id" = m."conversationId"
    LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
    CROSS JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM "Message" p
         WHERE p."conversationId" = m."conversationId"
           AND p."direction" = 'OUTBOUND' AND p."type" <> 'SYSTEM' AND p."deletedAt" IS NULL
           AND p."createdAt" < m."createdAt"
           AND (
             p."rawPayload"->>'source' = 'manual'
             OR (p."rawPayload"->>'source' = 'instance'
                 AND (c."startedAt" IS NULL OR p."createdAt" >= c."startedAt" + make_interval(secs => $3)))
           )
      ) AS "antes"
    ) persona
    LEFT JOIN LATERAL (
      SELECT fo."name" FROM "Follow" fo
       WHERE m."rawPayload"->>'source' = 'follow'
         AND fo."workspaceId" = c."workspaceId" AND fo."contactId" = c."contactId"
         AND fo."executedAt" >= m."createdAt" - interval '3 minutes'
         AND fo."executedAt" <= m."createdAt" + interval '1 minute'
       ORDER BY abs(extract(epoch FROM (fo."executedAt" - m."createdAt")))
       LIMIT 1
    ) f ON true
   WHERE m."direction" = 'OUTBOUND'
     AND m."type" <> 'SYSTEM'
     AND m."deletedAt" IS NULL
     AND m."status" <> 'FAILED'
     AND m."createdAt" >= now() - ($1 || ' days')::interval
     AND NOT (COALESCE(m."rawPayload"->>'source', '') = ANY($2::text[]))
     AND (
       (c."automationPaused" AND (c."automationPausedAt" IS NULL OR c."automationPausedAt" <= m."createdAt"))
       OR (c."assignedToUserId" IS NOT NULL AND persona."antes")
     )
   ORDER BY m."createdAt"
`;

/** Lee de la base con `q(sql, params) → filas`. Lo usa la prueba con una base de mentira. */
export async function leerDatos(q, dias) {
  const noSePudoLeer = [];
  const mensajes = (await q(SQL_MENSAJES, [String(dias), ORIGENES_NO_AUTOMATICOS, PRIMER_MINUTO_SEGUNDOS])).map((fila) => ({
    conversationId: fila.conversationId,
    workspaceId: fila.workspaceId,
    dia: fila.dia,
    origen: fila.origen,
    texto: fila.texto,
    follow: fila.follow,
    asesora: fila.asesora,
    personaAntes: fila.personaAntes === true,
  }));
  const textosExterior = new Map();
  try {
    const filas = await q(`SELECT "key", "value" FROM "AppSetting" WHERE "key" LIKE $1`, [`${PREFIJO_CONFIG_SEGUIMIENTO}%`]);
    for (const fila of filas) {
      const texto = textoExteriorDeLaConfig(fila.value);
      if (texto) textosExterior.set(fila.key.slice(PREFIJO_CONFIG_SEGUIMIENTO.length), texto);
    }
  } catch (error) {
    noSePudoLeer.push({ parte: "texto_exterior", error: mensajeDeError(error) });
  }
  return { mensajes, textosExterior, noSePudoLeer };
}

// Quita la clave de una URL de conexión si el error la trae.
const sinClave = (texto) => String(texto).replace(/(postgres(?:ql)?:\/\/[^:/@\s]+):[^@\s]*@/gi, "$1:***@");
const mensajeDeError = (error) => sinClave(error instanceof Error ? error.message : String(error));

export function datosDeEjemplo() {
  const fila = (conversationId, dia, origen, extra = {}) => ({
    conversationId,
    workspaceId: "ws-ejemplo",
    dia,
    origen,
    texto: null,
    follow: null,
    asesora: "Ingrid",
    personaAntes: true,
    ...extra,
  });
  return {
    mensajes: [
      fila("chat-ejemplo-1", "2026-11-20", "follow", { follow: "Etapa Precio · día siguiente" }),
      fila("chat-ejemplo-1", "2026-11-21", "follow", { follow: "Tras asesora: 1 h" }),
      fila("chat-ejemplo-1", "2026-11-21", null, { texto: TEXTO_AVISO_DE_PAUSA }),
      fila("chat-ejemplo-2", "2026-11-22", "agente-v3-seguimiento", { asesora: "María Camila" }),
      fila("chat-ejemplo-2", "2026-11-22", "follow", { follow: "Campaña: Black Friday", asesora: "María Camila" }),
      fila("chat-ejemplo-3", "2026-11-23", null, { texto: TEXTO_EXTERIOR_POR_DEFECTO, asesora: null }),
      fila("chat-ejemplo-3", "2026-11-24", "follow", { follow: "Inteligente: precio", asesora: null }),
      fila("chat-ejemplo-4", "2026-11-24", null, { texto: "Te dejo las fotos del combo 👇" }),
    ],
    textosExterior: new Map(),
    noSePudoLeer: [],
  };
}

function leerArgumentos(argv) {
  const posicion = argv.indexOf("--dias");
  const pedido = posicion >= 0 ? Number(argv[posicion + 1]) : 7;
  // Solo enteros de 1 a 365: el número va a la consulta como parámetro, nunca pegado al SQL.
  const dias = Number.isInteger(pedido) && pedido >= 1 && pedido <= 365 ? pedido : 7;
  return { ejemplo: argv.includes("--ejemplo"), dias };
}

async function leerDeLaBase(dias) {
  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  // Sin esto, un error de conexión del pool tumba el proceso en vez de llegar al catch.
  pool.on("error", () => {});
  try {
    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN READ ONLY");
      const datos = await leerDatos(async (sql, params = []) => (await cliente.query(sql, params)).rows, dias);
      await cliente.query("ROLLBACK");
      return datos;
    } finally {
      cliente.release();
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

async function principal() {
  const { ejemplo, dias } = leerArgumentos(process.argv.slice(2));
  let datos;
  if (ejemplo) {
    datos = datosDeEjemplo();
  } else {
    try {
      datos = await leerDeLaBase(dias);
    } catch (error) {
      console.log(JSON.stringify({ no_se_pudo_leer: [{ parte: "base", error: mensajeDeError(error) }] }, null, 2));
      return;
    }
  }
  console.log(JSON.stringify(armarInforme({ ...datos, dias }), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await principal();
}
