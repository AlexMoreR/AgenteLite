// Informe de SOLO LECTURA: ¿cómo se repartieron los leads nuevos entre las asesoras en los últimos 7 días?
// (Pedido de Alexander, 28-oct-2026: a María Camila le llegaron 10 y a Ingrid 42.)
//
// No asigna, no escribe y no manda mensajes: solo hace SELECT, dentro de una transacción de solo lectura.
// Uso:
//   node scripts/reporte-reparto-leads.mjs               contra la base de DATABASE_URL (aizen1 / producción)
//   node scripts/reporte-reparto-leads.mjs --dias 14     otra ventana
//   node scripts/reporte-reparto-leads.mjs --ejemplo     datos de ejemplo, sin base (para probar el conteo)
// Si la base no responde, el informe lo dice en `no_se_pudo_leer` y no inventa cifras.
import "dotenv/config";
import { fileURLToPath } from "node:url";

/** Cómo se asignó un chat, leyendo la nota de actividad que dejó el reparto. */
export function clasificarAsignacion({ texto = "", actorUserId = null, origen = null } = {}) {
  const t = String(texto);
  if (/como respaldo/i.test(t)) return "respaldo";
  if (/por la campa[ñn]a/i.test(t)) return "campana";
  if (origen === "reparto-de-madrugada" || /de madrugada/i.test(t)) return "madrugada";
  if (/auto-asignado a esta conversaci[oó]n/i.test(t)) return "turno";
  if (actorUserId) return "a_mano";
  return "otro";
}

const TIPOS = ["turno", "campana", "respaldo", "madrugada", "a_mano", "otro"];

/** Cuenta las notas "assigned" por asesora y por tipo. `filas`: { userId, texto, actorUserId, origen, dia }. */
export function contarAsignaciones(filas) {
  const porAsesora = new Map();
  for (const fila of filas) {
    if (!fila.userId) continue;
    const tipo = clasificarAsignacion(fila);
    const cuenta = porAsesora.get(fila.userId) ?? { total: 0, dias: {}, ...Object.fromEntries(TIPOS.map((x) => [x, 0])) };
    cuenta.total += 1;
    cuenta[tipo] += 1;
    cuenta.dias[fila.dia] = (cuenta.dias[fila.dia] ?? 0) + 1;
    porAsesora.set(fila.userId, cuenta);
  }
  return porAsesora;
}

const lista = (valor) => (Array.isArray(valor) ? valor.filter((x) => typeof x === "string") : []);

/** Quién está en la rueda de una línea y quién queda fuera (y por qué). Misma lógica de calcularReparto. */
export function leerRueda(metadata) {
  const m = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const colaboradoras = lista(m.collaboratorIds);
  const pausadas = new Set(lista(m.pausedAssignmentIds));
  const monitores = new Set(lista(m.monitorIds));
  const regla = m.adCampaignRouting && typeof m.adCampaignRouting === "object" ? m.adCampaignRouting : null;
  const reglaIds = regla ? (lista(regla.userIds).length ? lista(regla.userIds) : lista([regla.userId])) : [];
  return {
    colaboradoras,
    pausadas: [...pausadas],
    monitores: [...monitores],
    enLaRueda: colaboradoras.filter((id) => !pausadas.has(id) && !monitores.has(id)),
    ultimaDelTurno: typeof m.lastAutoAssignedUserId === "string" ? m.lastAutoAssignedUserId : null,
    reglaDeCampana: regla ? { palabras: lista(regla.keywords), userIds: reglaIds } : null,
  };
}

function leerArgumentos(argv) {
  const dias = argv.indexOf("--dias");
  return { ejemplo: argv.includes("--ejemplo"), dias: dias >= 0 ? Number(argv[dias + 1]) || 7 : 7 };
}

const nombreDe = (nombres, id) => nombres.get(id) ?? `(sin nombre ${String(id).slice(0, 6)})`;

function imprimirTabla(titulo, filas) {
  console.log(`\n== ${titulo} ==`);
  if (filas.length === 0) return console.log("(sin datos)");
  console.table(filas);
}

function armarInforme({ asignaciones, chatsCreados, lineas, nombres, respaldo, horarios, presencia, miembrosActivos, dias }) {
  const cuentas = contarAsignaciones(asignaciones);
  const porAsesora = [...cuentas.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([id, c]) => ({ asesora: nombreDe(nombres, id), total_asignados: c.total, ...Object.fromEntries(TIPOS.map((x) => [x, c[x]])) }));
  const creados = chatsCreados.map((f) => ({
    asesora: f.userId ? nombreDe(nombres, f.userId) : "(sin asesora)",
    linea: f.linea,
    chats_creados: f.total,
  }));
  const diasOrdenados = [...new Set(asignaciones.map((f) => f.dia))].sort();
  const porDia = [...cuentas.entries()].map(([id, c]) => ({
    asesora: nombreDe(nombres, id),
    ...Object.fromEntries(diasOrdenados.map((d) => [d, c.dias[d] ?? 0])),
  }));
  const porLinea = new Map();
  for (const f of asignaciones) {
    if (!f.userId) continue;
    const clave = `${f.linea}|${f.userId}`;
    porLinea.set(clave, (porLinea.get(clave) ?? 0) + 1);
  }
  const asignadosPorLinea = [...porLinea.entries()]
    .map(([clave, total]) => {
      const [linea, id] = clave.split("|");
      return { linea, asesora: nombreDe(nombres, id), total };
    })
    .sort((a, b) => a.linea.localeCompare(b.linea) || b.total - a.total);

  const ruedas = lineas.map((l) => {
    const r = leerRueda(l.metadata);
    const nombresDe = (ids) => ids.map((id) => nombreDe(nombres, id)).join(", ") || "—";
    return {
      linea: l.name,
      tipo: l.purpose,
      estado: l.status,
      en_la_rueda: nombresDe(r.enLaRueda),
      pausadas_por_jefe: nombresDe(r.pausadas),
      solo_monitorean: nombresDe(r.monitores),
      regla_de_campana: r.reglaDeCampana
        ? `${r.reglaDeCampana.palabras.join("/")} -> ${nombresDe(r.reglaDeCampana.userIds)}`
        : "—",
      ultima_del_turno: r.ultimaDelTurno ? nombreDe(nombres, r.ultimaDelTurno) : "—",
    };
  });
  const personas = miembrosActivos.map((id) => {
    const p = presencia.get(id);
    return {
      asesora: nombreDe(nombres, id),
      horario_de_reparto: horarios[id] ? "recortado (ver Equipo)" : "siempre",
      pausada_a_mano: p?.pausaManualEn ? p.pausaManualEn : "—",
      ultimo_latido: p?.ultimoLatido ?? "nunca",
      es_respaldo: id === respaldo ? "SI" : "",
      lineas_donde_esta_en_la_rueda: lineas.filter((l) => leerRueda(l.metadata).enLaRueda.includes(id)).length,
    };
  });

  imprimirTabla(`Leads asignados por asesora, últimos ${dias} días (notas "asignado")`, porAsesora);
  imprimirTabla("Chats creados en la ventana, por asesora actual y línea", creados);
  imprimirTabla("Asignados por línea y asesora", asignadosPorLinea);
  imprimirTabla("Asignados por día", porDia);
  imprimirTabla("Líneas de ventas: rueda, pausadas, monitores y reglas de campaña", ruedas);
  imprimirTabla("Personas: horario, pausa a mano, latido y respaldo", personas);
  console.log(
    "\nNota: la marca de entrada de Gestión no se lee aquí porque el reparto tampoco la lee." +
      " Las reglas de campaña SÍ exigen estar 'Recibiendo clientes' (filtrarEnLinea en el webhook de Evolution).",
  );
  return { porAsesora, creados, asignadosPorLinea, porDia, ruedas, personas };
}

function datosDeEjemplo() {
  const hoy = new Date().toISOString().slice(0, 10);
  const nota = (userId, texto, linea = "Ventas 1", extra = {}) => ({ userId, texto, linea, dia: hoy, actorUserId: null, origen: null, ...extra });
  return {
    asignaciones: [
      ...Array.from({ length: 4 }, () => nota("u-ingrid", "Ingrid auto-asignado a esta conversación")),
      ...Array.from({ length: 2 }, () => nota("u-ingrid", 'Ingrid asignado por la campaña "Combo"')),
      nota("u-ingrid", "Ingrid asignado como respaldo (nadie estaba recibiendo clientes)"),
      nota("u-maria", "Maria auto-asignado a esta conversación"),
      nota("u-maria", "Magilus asignó a Maria", "Ventas 1", { actorUserId: "u-jefe" }),
    ],
    chatsCreados: [
      { userId: "u-ingrid", linea: "Ventas 1", total: 7 },
      { userId: "u-maria", linea: "Ventas 1", total: 2 },
      { userId: null, linea: "Ventas 1", total: 3 },
    ],
    lineas: [
      {
        name: "Ventas 1",
        purpose: "SALES",
        status: "CONNECTED",
        metadata: { collaboratorIds: ["u-ingrid", "u-maria"], pausedAssignmentIds: [], lastAutoAssignedUserId: "u-ingrid" },
      },
    ],
    nombres: new Map([["u-ingrid", "Ingrid"], ["u-maria", "María Camila"], ["u-jefe", "Magilus"]]),
    respaldo: "u-ingrid",
    horarios: {},
    presencia: new Map(),
    miembrosActivos: ["u-ingrid", "u-maria"],
  };
}

async function leerDeLaBase(dias) {
  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const cliente = await pool.connect();
  const noSePudoLeer = [];
  const intentar = async (nombre, fn, porDefecto) => {
    try {
      return await fn();
    } catch (error) {
      noSePudoLeer.push({ parte: nombre, error: error instanceof Error ? error.message : String(error) });
      return porDefecto;
    }
  };
  try {
    await cliente.query("BEGIN READ ONLY");
    const q = async (sql, params = []) => (await cliente.query(sql, params)).rows;

    const lineasFilas = await intentar(
      "lineas",
      () => q(`SELECT "id","workspaceId","name","purpose","status","metadata" FROM "WhatsAppChannel" WHERE "isActive" = true`),
      [],
    );
    const nombreDeLinea = new Map(lineasFilas.map((l) => [l.id, l.name]));
    const asignaciones = await intentar(
      "asignaciones",
      async () =>
        (
          await q(
            `SELECT m."channelId", m."content",
                    m."rawPayload"->>'assigneeUserId' AS "assignee",
                    m."rawPayload"->>'actorUserId' AS "actor",
                    m."rawPayload"->>'origen' AS "origen",
                    to_char(m."createdAt" AT TIME ZONE 'America/Bogota','YYYY-MM-DD') AS "dia"
               FROM "Message" m
               JOIN "WhatsAppChannel" c ON c."id" = m."channelId" AND c."purpose" = 'SALES'
              WHERE m."type" = 'SYSTEM'
                AND m."rawPayload"->>'source' = 'activity'
                AND m."rawPayload"->>'kind' = 'assigned'
                AND m."createdAt" >= now() - ($1 || ' days')::interval`,
            [String(dias)],
          )
        ).map((f) => ({
          userId: f.assignee,
          texto: f.content,
          actorUserId: f.actor,
          origen: f.origen,
          dia: f.dia,
          linea: nombreDeLinea.get(f.channelId) ?? "(sin línea)",
        })),
      [],
    );
    const usuarios = await intentar("usuarios", () => q(`SELECT "id","name","email" FROM "User"`), []);
    const nombres = new Map(usuarios.map((u) => [u.id, (u.name || u.email || "").trim()]));

    // Notas viejas (antes del 02-oct) no traen el id: se leen por el nombre que dice el texto.
    const sinId = asignaciones.filter((a) => !a.userId);
    for (const a of sinId) {
      const encontrada = [...nombres.entries()].find(([, n]) => n && String(a.texto).startsWith(n));
      if (encontrada) a.userId = encontrada[0];
    }

    const chatsCreados = await intentar(
      "chats_creados",
      async () =>
        (
          await q(
            `SELECT v."assignedToUserId" AS "userId", c."name" AS "linea", count(*)::int AS "total"
               FROM "Conversation" v
               JOIN "WhatsAppChannel" c ON c."id" = v."channelId" AND c."purpose" = 'SALES'
              WHERE v."createdAt" >= now() - ($1 || ' days')::interval
              GROUP BY 1, 2 ORDER BY 3 DESC`,
            [String(dias)],
          )
        ),
      [],
    );
    const settings = await intentar("ajustes", () => q(`SELECT "key","value" FROM "AppSetting" WHERE "key" LIKE 'equipo:%'`), []);
    let respaldo = null;
    let horarios = {};
    for (const s of settings) {
      if (s.key.startsWith("equipo:asesora-de-respaldo:")) respaldo = s.value.trim() || null;
      if (s.key.startsWith("equipo:horario-reparto:")) {
        try {
          horarios = { ...horarios, ...JSON.parse(s.value) };
        } catch {
          noSePudoLeer.push({ parte: "horario-reparto", error: "JSON inválido" });
        }
      }
    }
    const presenciaFilas = await intentar("presencia", () => q(`SELECT "userId","ultimoLatido","enLineaDesde","pausaManualEn" FROM "PresenciaEnLinea"`), []);
    const miembros = await intentar("miembros", () => q(`SELECT "userId" FROM "WorkspaceMember" WHERE "isActive" = true`), []);
    await cliente.query("ROLLBACK");
    return {
      asignaciones,
      chatsCreados,
      lineas: lineasFilas.filter((l) => l.purpose === "SALES"),
      nombres,
      respaldo,
      horarios,
      presencia: new Map(presenciaFilas.map((p) => [p.userId, p])),
      miembrosActivos: miembros.map((m) => m.userId),
      noSePudoLeer,
    };
  } finally {
    cliente.release();
    await pool.end();
  }
}

async function principal() {
  const { ejemplo, dias } = leerArgumentos(process.argv.slice(2));
  let datos;
  if (ejemplo) {
    datos = { ...datosDeEjemplo(), noSePudoLeer: [] };
  } else {
    try {
      datos = await leerDeLaBase(dias);
    } catch (error) {
      console.log(JSON.stringify({ no_se_pudo_leer: [{ parte: "base", error: error instanceof Error ? error.message : String(error) }] }, null, 2));
      process.exitCode = 1;
      return;
    }
  }
  armarInforme({ ...datos, dias });
  if (datos.noSePudoLeer.length > 0) {
    console.log("\nno_se_pudo_leer:", JSON.stringify(datos.noSePudoLeer));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal();
}
