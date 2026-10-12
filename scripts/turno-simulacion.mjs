// SIMULACIÓN "¿DE QUIÉN ES EL TURNO?" con chats reales exportados EN SOLO LECTURA (12-10-2026).
//
//   node scripts/turno-simulacion.mjs <carpeta-o-archivos.jsonl…> --antes <raíz del repo de antes> \
//        [--desde 2026-10-05T05:00Z] [--hasta 2026-10-12T15:10Z] [--json salida.json]
//
// Corre, sobre los MISMOS chats y cada 5 minutos, el código de ANTES (otra copia del repo, p. ej.
// un `git worktree` de main) y el de AHORA (este repo), y compara:
//   - Supervisor: avisos de atención por chat (caliente esperando, señal sin dueña, asignado sin
//     respuesta, "ya pagué", oportunidades a retomar) y las acciones del Supervisor accionable;
//   - Seguimiento inteligente: tareas humanas (conversación + motivo + toque) y descartes;
//   - Intención fuerte: cada mensaje del cliente con señal fuerte debe tener una persona a tiempo o
//     un aviso / tarea del código nuevo antes de que una persona escriba.
// El export (una línea JSON por conversación {tipo:"conv"} y por mensaje {tipo:"msg"}) sale del MCP
// del CRM: teléfono reducido a los últimos 4 dígitos y números largos cambiados por "[num]".
// No toca la base ni la red.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireNativo = createRequire(path.join(RAIZ, "package.json"));
const ts = requireNativo("typescript");

/** Carga un .ts de `raiz` (sin Next ni base), resolviendo imports relativos y el alias "@/" de esa raíz. */
function cargador(raiz) {
  const cache = new Map();
  const cargar = (archivo) => {
    const absoluto = path.isAbsolute(archivo) ? archivo : path.resolve(raiz, archivo);
    if (cache.has(absoluto)) return cache.get(absoluto).exports;
    const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: absoluto,
    });
    const mod = { exports: {} };
    cache.set(absoluto, mod);
    const requerir = (pedido) => {
      let base = null;
      if (pedido.startsWith("@/")) base = path.join(raiz, "src", pedido.slice(2));
      else if (pedido.startsWith(".")) base = path.resolve(path.dirname(absoluto), pedido);
      if (base) {
        for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
          if (fs.existsSync(c) && fs.statSync(c).isFile()) return cargar(c);
        }
      }
      return requireNativo(pedido);
    };
    new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(mod.exports, requerir, mod, absoluto, path.dirname(absoluto));
    return mod.exports;
  };
  return cargar;
}

const args = process.argv.slice(2);
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const valoresDeOpcion = new Set(["antes", "desde", "hasta", "json"].filter((n) => args.includes(`--${n}`)).map((n) => args[args.indexOf(`--${n}`) + 1]));
const entradas = args.filter((a) => !a.startsWith("--") && !valoresDeOpcion.has(a));
const raizAntes = opcion("antes", null);
if (!entradas.length || !raizAntes) {
  console.error("Uso: node scripts/turno-simulacion.mjs <export.jsonl | carpeta>… --antes <raíz del repo de antes> [--desde ISO] [--hasta ISO] [--json salida]");
  process.exit(2);
}

/* ------------------------------------------------------------------------------------------------
   Los dos códigos
------------------------------------------------------------------------------------------------ */

const versiones = {};
for (const [nombre, raiz] of [["antes", path.resolve(raizAntes)], ["ahora", RAIZ]]) {
  const cargar = cargador(raiz);
  versiones[nombre] = {
    atencion: cargar("src/features/supervisor/dominio/detectores-atencion.ts"),
    gravedad: cargar("src/features/avisos-gravedad/dominio/reglas.ts"),
    acc: cargar("src/features/supervisor-accionable/dominio/reglas.ts"),
    motor: cargar("src/features/seguimiento-inteligente/dominio/motor.ts"),
    config: cargar("src/features/seguimiento-inteligente/dominio/config.ts"),
    temperatura: cargar("src/features/seguimiento-inteligente/dominio/temperatura.ts"),
  };
}
const turnoLib = cargador(RAIZ)("src/lib/turno-del-chat.ts");

/* ------------------------------------------------------------------------------------------------
   El export
------------------------------------------------------------------------------------------------ */

const archivos = entradas.flatMap((e) =>
  fs.statSync(e).isDirectory() ? fs.readdirSync(e).filter((f) => f.endsWith(".jsonl")).sort().map((f) => path.join(e, f)) : [e],
);
const convs = new Map();
const crudos = new Map();
for (const archivo of archivos) {
  for (const linea of fs.readFileSync(archivo, "utf8").replace(/^﻿/, "").split("\n")) {
    if (!linea.trim()) continue;
    const f = JSON.parse(linea);
    if (f.tipo === "conv") {
      // Si una conversación sale en dos días, vale la última (la más completa).
      convs.set(f.id, f);
      crudos.set(f.id, []);
    } else if (f.tipo === "msg" && crudos.has(f.c)) {
      crudos.get(f.c).push(f);
    }
  }
}

/** "2026-10-10 14:25" (Bogotá) → Date UTC. Los del mismo minuto conservan su orden. */
const fechaBogota = (s, orden) => new Date(Date.parse(`${s.replace(" ", "T")}:00-05:00`) + orden);
const RE_ASIGNADO = /^(.+?) (?:auto-)?asignad[oa] a esta conversaci/i;
const RE_ALERTAS = /Necesita atenci[oó]n/i;

const chats = [];
for (const [id, c] of convs) {
  const lista = crudos.get(id) ?? [];
  // Alimentador interno de alertas (teléfono del equipo): no es un cliente.
  if (lista.filter((m) => RE_ALERTAS.test(m.x ?? "")).length >= 3) continue;
  const mensajes = lista.map((m, i) => {
    const en = fechaBogota(m.t, i);
    const x = m.x ?? "";
    if (m.q === "sistema" || m.ty === "SYSTEM") {
      const asignada = RE_ASIGNADO.exec(x)?.[1]?.trim() ?? null;
      return { en, sistema: true, texto: x, asignadaA: asignada };
    }
    const direccion = m.q === "cliente" ? "IN" : "OUT";
    const origen = m.q === "asesora_desde_crm" ? "manual" : m.q === "enviado_desde_el_celular" ? "instance" : null;
    return { en, sistema: false, direccion, tipo: m.ty || "TEXT", texto: x, origen };
  });
  mensajes.sort((a, b) => a.en - b.en);
  chats.push({ id, c, mensajes, n: 0, foto: null });
}

const desde = new Date(opcion("desde", "2026-10-05T05:00:00Z"));
const ultimoMensaje = Math.max(...chats.flatMap((ch) => ch.mensajes.map((m) => m.en.getTime())));
const hasta = new Date(opcion("hasta", new Date(ultimoMensaje).toISOString()));
const PASO = 5 * 60_000;
const MIN = 60_000;
const H = 60 * MIN;
const ref = (ch) => `…${ch.c.tel ?? "????"} (${ch.id.slice(0, 10)})`;

/* ------------------------------------------------------------------------------------------------
   Estado de un chat a la hora T
------------------------------------------------------------------------------------------------ */

function delTurno(m) {
  return m.sistema
    ? { direccion: "OUT", tipo: "SYSTEM", texto: m.texto, en: m.en, origen: null }
    : { direccion: m.direccion, tipo: m.tipo, texto: m.texto, en: m.en, origen: m.origen };
}

/** Lo que se calculó del chat con sus primeros `n` mensajes (se recalcula solo si entra uno nuevo). */
function fotoDelChat(ch, ahora) {
  while (ch.n < ch.mensajes.length && ch.mensajes[ch.n].en <= ahora) ch.n += 1;
  if (!ch.n) return null;
  if (ch.foto && ch.foto.n === ch.n) return ch.foto;
  ch.foto = { ...calcularFoto(ch, ch.mensajes.slice(0, ch.n), ahora), n: ch.n, abierto: {}, ficha: {} };
  return ch.foto;
}

function calcularFoto(ch, hasta, ahora) {
  const visibles = hasta.filter((m) => !m.sistema);
  const delCliente = visibles.filter((m) => m.direccion === "IN");
  const ultimoCliente = delCliente.at(-1)?.en ?? null;
  const humana = [...visibles].reverse().find((m) => m.direccion === "OUT" && (m.origen === "manual" || m.origen === "instance"))?.en ?? null;
  const pendientes = delCliente.filter((m) => !humana || m.en > humana).slice(-5).map((m) => m.texto);
  const asignaciones = hasta.filter((m) => m.sistema && m.asignadaA);
  const asesora = asignaciones.length ? asignaciones.at(-1).asignadaA : ch.c.as ?? null;
  const asignadaEn = asignaciones.length ? asignaciones.at(-1).en : null;
  const ultimo = ch.mensajes.at(-1).en;
  const cerrada = (ch.c.e === "GANADO" || ch.c.e === "PERDIDO") && ahora >= ultimo;
  const etapa = cerrada ? ch.c.e : ch.c.e === "GANADO" || ch.c.e === "PERDIDO" ? "NUEVO" : ch.c.e;
  return { hasta, visibles, delCliente, ultimoCliente, humana, pendientes, asesora, asignadaEn, etapa, ultimoMov: hasta.at(-1).en };
}

function chatAbierto(ch, foto, ahora, conTurno) {
  const temperatura = versiones.ahora.temperatura.calificar({
    mensajes: foto.delCliente.filter((m) => m.texto).slice(-20).map((m) => ({ texto: m.texto, en: m.en })),
    ahora,
    productoInteres: null,
    etapaCrm: foto.etapa,
  }).temperatura;
  const chat = {
    conversationId: ch.id,
    asesoraId: foto.asesora,
    asesoraNombre: foto.asesora,
    etapa: foto.etapa,
    ultimoClienteEn: foto.ultimoCliente,
    ultimaRespuestaHumanaEn: foto.humana,
    textosPendientes: foto.pendientes,
    textosDelCliente: foto.delCliente.slice(-20).map((m) => m.texto),
    pausado: Boolean(ch.c.pausada),
    telefono: null,
    asignadaEn: foto.asesora ? foto.asignadaEn : null,
    temperatura,
    nombreCliente: null,
  };
  if (conTurno) chat.turno = turnoLib.turnoDelChat(foto.hasta.map(delTurno), { ahora });
  return chat;
}

function fichaDelMotor(ch, foto, conPases) {
  const mensajes = foto.visibles.map((m) => ({ direccion: m.direccion, tipo: m.tipo, texto: m.texto, en: m.en, leidoEn: m.en, estado: "READ", origen: m.origen, media: null }));
  const ficha = {
    conversationId: ch.id,
    nombre: null,
    etapaCrm: foto.etapa,
    pausado: Boolean(ch.c.pausada),
    asignadaA: foto.asesora,
    pais: "CO",
    marcaExterior: false,
    inicioDeLaCharla: foto.delCliente[0]?.en ?? null,
    familiaDelBot: "combo-camilla",
    flujosEnviados: [],
    cotizacion: { en: null, ref: null, total: null },
    mensajesUtiles: 0,
    mensajes,
  };
  if (conPases) {
    ficha.notasDelBot = foto.hasta
      .filter((m) => m.sistema && (/^El agente pide un asesor/i.test(m.texto) || /^Agente V3: Gan.*no se entendi/i.test(m.texto)))
      .map((m) => ({ en: m.en, texto: m.texto }));
  }
  return ficha;
}

/* ------------------------------------------------------------------------------------------------
   La corrida
------------------------------------------------------------------------------------------------ */

const TIPO_DE_AVISO = (clave) =>
  clave.startsWith("ATENCION:caliente-esperando:sin-duena")
    ? "caliente_sin_duena"
    : clave.startsWith("ATENCION:caliente-esperando:")
      ? "caliente_esperando"
      : clave.startsWith("ATENCION:senal-sin-duena")
        ? "senal_sin_duena"
        : clave.startsWith("ATENCION:asignado-sin-respuesta:")
          ? "asignado_sin_respuesta"
          : clave.startsWith("ATENCION:pago-sin-respuesta")
            ? "pago_sin_respuesta"
            : clave.startsWith("ATENCION:oportunidades-a-retomar")
              ? "oportunidad_a_retomar"
              : clave;

const R = {};
for (const v of ["antes", "ahora"]) {
  R[v] = {
    episodios: new Map(), // "chat|tipo" → [{desde, hasta}]
    tareas: new Map(), // "chat|motivo|toque" → {primera, chat, motivo, toque, sinDuena}
    descartes: new Map(),
    acc: { estado: versiones[v].acc.estadoVacio(), avisos: 0, acciones: 0, segundo: 0, escaladas: 0, escaladasAlexander: 0, porChat: new Map() },
    alertaPorChat: new Map(), // chat → [fechas en que estuvo alertado]
  };
}
const SUPERVISORA = { id: "Ingrid Sanchez", nombre: "Ingrid Sanchez" };
const PASO_MOTOR = 15 * 60_000;
const configMotor = (v) =>
  versiones[v].config.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "activo" }, cadencia: { descarte: "sombra" } }));
const CONFIG_MOTOR = { antes: configMotor("antes"), ahora: configMotor("ahora") };

function anotarEpisodio(r, clave, ahora) {
  const lista = r.episodios.get(clave) ?? [];
  const ultimo = lista.at(-1);
  if (ultimo && ahora - ultimo.hasta <= 15 * MIN) ultimo.hasta = ahora;
  else lista.push({ desde: ahora, hasta: ahora });
  r.episodios.set(clave, lista);
}

for (let t = desde.getTime(); t <= hasta.getTime(); t += PASO) {
  const ahora = new Date(t);
  const fotos = new Map();
  for (const ch of chats) {
    const foto = fotoDelChat(ch, ahora);
    if (!foto || ahora - foto.ultimoMov > 72 * H || ch.c.st === "CLOSED") continue;
    fotos.set(ch.id, { ch, foto });
  }
  for (const v of ["antes", "ahora"]) {
    const V = versiones[v];
    const r = R[v];
    const abiertos = [...fotos.values()].map(({ ch, foto }) => (foto.abierto[v] ??= chatAbierto(ch, foto, foto.hasta.at(-1).en, v === "ahora")));
    const hallazgos = [...V.atencion.detectarAtencion(abiertos, ahora), ...V.gravedad.detectarPagoSinRespuesta(abiertos, ahora, 30)];
    for (const h of hallazgos) {
      for (const id of h.evidencia.chats) {
        anotarEpisodio(r, `${id}|${TIPO_DE_AVISO(h.clave)}`, ahora);
        const fechas = r.alertaPorChat.get(id) ?? [];
        fechas.push(ahora);
        r.alertaPorChat.set(id, fechas);
      }
    }
    // Supervisor accionable (aviso a la responsable → segundo aviso → escala a Alexander).
    const candidatas = V.acc.candidatasDeLaVuelta({ hallazgos, chats: abiertos, ahora, supervisora: SUPERVISORA, extras: new Map() });
    const res = V.acc.avanzar({
      estado: r.acc.estado,
      candidatas,
      chats: abiertos,
      atendidas: {},
      ahora,
      config: { ...V.acc.CONFIG_ACCIONABLE_POR_DEFECTO, activo: true },
      supervisora: SUPERVISORA,
    });
    r.acc.estado = res.estado;
    for (const e of res.eventos) {
      if (e.tipo === "avisar") {
        r.acc.avisos += 1;
        r.acc.acciones += e.accionIds.length;
        for (const id of e.accionIds) {
          const a = res.estado.acciones[id];
          if (a.conversationId) r.acc.porChat.set(a.conversationId, (r.acc.porChat.get(a.conversationId) ?? 0) + 1);
        }
      } else if (e.tipo === "segundo_aviso") r.acc.segundo += e.accionIds.length;
      else if (e.tipo === "escalar") {
        r.acc.escaladas += 1;
        if (e.gravedad !== "OBSERVACION") r.acc.escaladasAlexander += 1;
      }
    }
    // Seguimiento inteligente, cada 15 min.
    if ((t - desde.getTime()) % PASO_MOTOR === 0) {
      for (const { ch, foto } of fotos.values()) {
        if (!foto.delCliente.length) continue;
        const d = V.motor.evaluarLead((foto.ficha[v] ??= fichaDelMotor(ch, foto, v === "ahora")), CONFIG_MOTOR[v], ahora).decision;
        if (d.accion === "tarea_asesora") {
          const clave = `${ch.id}|${d.motivo}|${d.toque ?? ""}`;
          if (!r.tareas.has(clave)) r.tareas.set(clave, { primera: ahora, chat: ch.id, motivo: d.motivo, toque: d.toque, prioridad: d.prioridad, sinDuena: !foto.asesora });
        } else if (d.accion === "descartar" && !r.descartes.has(ch.id)) {
          r.descartes.set(ch.id, { en: ahora, motivo: d.motivo });
        }
      }
    }
  }
}

/* ------------------------------------------------------------------------------------------------
   Resultados
------------------------------------------------------------------------------------------------ */

const porId = new Map(chats.map((ch) => [ch.id, ch]));
const lineas = [];
const p = (l = "") => lineas.push(l);
const fmt = (d) => new Date(d.getTime() - 5 * H).toISOString().slice(0, 16).replace("T", " ");

/** De quién era el turno (código nuevo) al empezar un episodio del código viejo. */
function turnoEn(id, cuando) {
  const ch = porId.get(id);
  return turnoLib.turnoDelChat(ch.mensajes.filter((m) => m.en <= cuando).map(delTurno), { ahora: cuando });
}
function seSolapa(lista, ep) {
  return (lista ?? []).some((o) => o.desde <= ep.hasta && o.hasta >= ep.desde);
}

p(`SIMULACIÓN DEL TURNO ÚNICO · ${fmt(desde)} → ${fmt(hasta)} (Bogotá) · ${chats.length} chats, ${chats.reduce((s, c) => s + c.mensajes.length, 0)} mensajes`);
p("");

// 1. Avisos del Supervisor por tipo.
const tipos = new Set([...R.antes.episodios.keys(), ...R.ahora.episodios.keys()].map((k) => k.split("|")[1]));
const quitados = [];
const agregados = [];
const seguidos = [];
p("1. AVISOS DEL SUPERVISOR (episodios chat × tipo de alerta; un episodio = el chat alertado sin cortes de más de 15 min)");
p("tipo | antes | ahora | desaparecen | aparecen | siguen");
const totales = { antes: 0, ahora: 0, quitados: 0, agregados: 0, siguen: 0 };
for (const tipo of [...tipos].sort()) {
  let antes = 0;
  let ahora = 0;
  let q = 0;
  let a = 0;
  let s = 0;
  for (const [clave, lista] of R.antes.episodios) {
    if (!clave.endsWith(`|${tipo}`)) continue;
    for (const ep of lista) {
      antes += 1;
      if (seSolapa(R.ahora.episodios.get(clave), ep)) {
        s += 1;
        seguidos.push({ clave, ep });
      } else {
        q += 1;
        quitados.push({ clave, ep, turno: turnoEn(clave.split("|")[0], ep.desde) });
      }
    }
  }
  for (const [clave, lista] of R.ahora.episodios) {
    if (!clave.endsWith(`|${tipo}`)) continue;
    for (const ep of lista) {
      ahora += 1;
      if (!seSolapa(R.antes.episodios.get(clave), ep)) {
        a += 1;
        agregados.push({ clave, ep, turno: turnoEn(clave.split("|")[0], ep.desde) });
      }
    }
  }
  totales.antes += antes;
  totales.ahora += ahora;
  totales.quitados += q;
  totales.agregados += a;
  totales.siguen += s;
  p(`${tipo} | ${antes} | ${ahora} | ${q} | ${a} | ${s}`);
}
p(`TOTAL | ${totales.antes} | ${totales.ahora} | ${totales.quitados} | ${totales.agregados} | ${totales.siguen}`);
const chatsAntes = new Set([...R.antes.episodios.keys()].map((k) => k.split("|")[0]));
const chatsAhora = new Set([...R.ahora.episodios.keys()].map((k) => k.split("|")[0]));
p(`Chats con algún aviso: antes ${chatsAntes.size}, ahora ${chatsAhora.size}.`);
const porMotivo = {};
for (const q of quitados) porMotivo[q.turno.motivo] = (porMotivo[q.turno.motivo] ?? 0) + 1;
p(`Por qué desaparecen (turno al empezar el aviso): ${Object.entries(porMotivo).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}`);
p("");
p("Supervisor accionable (avisos a la asesora / supervisora y escaladas a Alexander):");
p(`  antes: ${R.antes.acc.avisos} avisos (${R.antes.acc.acciones} chats), ${R.antes.acc.segundo} segundos avisos, ${R.antes.acc.escaladas} escaladas (${R.antes.acc.escaladasAlexander} con push a Alexander)`);
p(`  ahora: ${R.ahora.acc.avisos} avisos (${R.ahora.acc.acciones} chats), ${R.ahora.acc.segundo} segundos avisos, ${R.ahora.acc.escaladas} escaladas (${R.ahora.acc.escaladasAlexander} con push a Alexander)`);
p("");

// 2. Tareas.
p("2. TAREAS HUMANAS DEL SEGUIMIENTO INTELIGENTE (conversación + motivo + toque)");
const tareasPorMotivo = (r) => {
  const salida = {};
  for (const t of r.tareas.values()) salida[t.motivo] = (salida[t.motivo] ?? 0) + 1;
  return salida;
};
const ta = tareasPorMotivo(R.antes);
const tn = tareasPorMotivo(R.ahora);
p("motivo | antes | ahora");
for (const m of [...new Set([...Object.keys(ta), ...Object.keys(tn)])].sort()) p(`${m} | ${ta[m] ?? 0} | ${tn[m] ?? 0}`);
p(`TOTAL | ${R.antes.tareas.size} | ${R.ahora.tareas.size}`);
const sinDuena = (r) => [...r.tareas.values()].filter((t) => t.sinDuena).length;
p(`De esas, sin asesora (van a la supervisora): antes ${sinDuena(R.antes)}, ahora ${sinDuena(R.ahora)}.`);
const tareasQuitadas = [...R.antes.tareas.values()].filter((t) => ![...R.ahora.tareas.values()].some((n) => n.chat === t.chat && Math.abs(n.primera - t.primera) <= 2 * H));
p(`Tareas de antes sin una tarea del código nuevo en el mismo chat (±2 h): ${tareasQuitadas.length}.`);
const tqm = {};
for (const t of tareasQuitadas) {
  const k = `${t.motivo} (${turnoEn(t.chat, t.primera).motivo})`;
  tqm[k] = (tqm[k] ?? 0) + 1;
}
p(`  por motivo (y turno en ese momento): ${Object.entries(tqm).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}`);
p(`Descartes que propondría (con su interruptor; en la simulación, en sombra): antes ${R.antes.descartes.size}, ahora ${R.ahora.descartes.size}.`);
p("");

// 3. Intención fuerte.
p("3. INTENCIÓN FUERTE DE COMPRA (cada mensaje del cliente con señal fuerte en el período)");
const eventos = [];
for (const ch of chats) {
  const visibles = ch.mensajes.filter((m) => !m.sistema);
  for (const m of visibles) {
    if (m.direccion !== "IN" || m.en < desde || m.en > hasta) continue;
    const frase = turnoLib.senalFuerteDe(m.texto);
    if (!frase) continue;
    // Una señal por tanda: si la anterior del cliente sin persona en medio ya era fuerte, es la misma.
    const anterior = eventos.at(-1);
    if (anterior && anterior.chat === ch.id && !visibles.some((x) => x.direccion === "OUT" && (x.origen === "manual" || x.origen === "instance") && x.en > anterior.en && x.en <= m.en)) continue;
    const persona = visibles.find((x) => x.direccion === "OUT" && (x.origen === "manual" || x.origen === "instance") && x.en > m.en) ?? null;
    eventos.push({ chat: ch.id, en: m.en, frase, texto: m.texto, persona: persona?.en ?? null });
  }
}
let aTiempo = 0;
let cubiertos = 0;
const sinCubrir = [];
const etapaCerrada = [];
for (const e of eventos) {
  const ch = porId.get(e.chat);
  const espera = (e.persona ?? hasta) - e.en;
  // Ganado / Perdido desde ese momento: ya no es tarea (la simulación no sabe cuándo cambió la etapa).
  if ((ch.c.e === "GANADO" || ch.c.e === "PERDIDO") && e.en >= ch.mensajes.at(-1).en) {
    etapaCerrada.push(e);
    continue;
  }
  if (e.persona && espera <= 15 * MIN) {
    aTiempo += 1;
    continue;
  }
  const limite = e.persona ?? hasta;
  const alertado = (R.ahora.alertaPorChat.get(e.chat) ?? []).some((f) => f >= e.en && f <= limite);
  const tarea = [...R.ahora.tareas.values()].some((t) => t.chat === e.chat && t.primera >= e.en && t.primera <= new Date(limite.getTime() + 15 * MIN));
  if (alertado || tarea) cubiertos += 1;
  else sinCubrir.push({ ...e, turno: turnoEn(e.chat, new Date(Math.min(limite.getTime(), e.en.getTime() + 30 * MIN))) });
}
p(`Señales fuertes: ${eventos.length}. Atendidas por una persona en ≤ 15 min: ${aTiempo}. Con aviso o tarea del código nuevo antes de que escriba una persona: ${cubiertos}. En chats ya cerrados (Ganado/Perdido): ${etapaCerrada.length}.`);
p(`SIN atención humana ni aviso/tarea del código nuevo: ${sinCubrir.length}.`);
for (const e of sinCubrir.slice(0, 30)) {
  p(`  - ${ref(porId.get(e.chat))} ${fmt(e.en)} «${(e.texto ?? "").slice(0, 90)}» · persona: ${e.persona ? fmt(e.persona) : "nunca"} · turno: ${e.turno.de}/${e.turno.motivo}`);
}
p("");

// 4. Ejemplos.
p("4. EJEMPLOS");
p("Avisos que desaparecen (turno del cliente):");
const vistos = new Set();
for (const q of quitados) {
  const [id, tipo] = q.clave.split("|");
  if (vistos.has(id) || vistos.size >= 12) continue;
  vistos.add(id);
  const ch = porId.get(id);
  const previos = ch.mensajes.filter((m) => !m.sistema && m.en <= q.ep.desde).slice(-3);
  p(`  - ${ref(ch)} ${tipo} ${fmt(q.ep.desde)} · ${q.turno.motivo} · ${previos.map((m) => `${m.direccion === "IN" ? "cliente" : m.origen ? "persona" : "bot"}: «${(m.texto ?? "").slice(0, 60)}»`).join(" → ")}`);
}
p("Avisos que siguen (turno de Magilus):");
const vistos2 = new Set();
for (const s of seguidos) {
  const [id, tipo] = s.clave.split("|");
  if (vistos2.has(id) || vistos2.size >= 12) continue;
  vistos2.add(id);
  const t = turnoEn(id, s.ep.desde);
  const ch = porId.get(id);
  const previos = ch.mensajes.filter((m) => !m.sistema && m.en <= s.ep.desde).slice(-2);
  p(`  - ${ref(ch)} ${tipo} ${fmt(s.ep.desde)} · ${t.motivo} · ${previos.map((m) => `${m.direccion === "IN" ? "cliente" : m.origen ? "persona" : "bot"}: «${(m.texto ?? "").slice(0, 60)}»`).join(" → ")}`);
}
if (agregados.length) {
  p("Avisos nuevos (no estaban antes):");
  for (const a of agregados.slice(0, 12)) p(`  - ${ref(porId.get(a.clave.split("|")[0]))} ${a.clave.split("|")[1]} ${fmt(a.ep.desde)} · ${a.turno.motivo}`);
}
console.log(lineas.join("\n"));

if (opcion("json", null)) {
  const salida = {
    periodo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    chats: chats.length,
    avisos: totales,
    porMotivoQuitados: porMotivo,
    accionable: { antes: { ...R.antes.acc, estado: undefined, porChat: undefined }, ahora: { ...R.ahora.acc, estado: undefined, porChat: undefined } },
    tareas: { antes: ta, ahora: tn, totalAntes: R.antes.tareas.size, totalAhora: R.ahora.tareas.size, sinDuenaAntes: sinDuena(R.antes), sinDuenaAhora: sinDuena(R.ahora), quitadas: tqm },
    descartes: { antes: R.antes.descartes.size, ahora: R.ahora.descartes.size },
    intencionFuerte: { total: eventos.length, aTiempo, cubiertos, cerrados: etapaCerrada.length, sinCubrir: sinCubrir.map((e) => ({ ref: ref(porId.get(e.chat)), en: e.en, texto: e.texto, persona: e.persona, turno: e.turno })) },
    quitados: quitados.map((q) => ({ ref: ref(porId.get(q.clave.split("|")[0])), tipo: q.clave.split("|")[1], desde: q.ep.desde, hasta: q.ep.hasta, turno: q.turno.motivo })),
    seguidos: seguidos.map((s) => ({ ref: ref(porId.get(s.clave.split("|")[0])), tipo: s.clave.split("|")[1], desde: s.ep.desde, hasta: s.ep.hasta })),
    agregados: agregados.map((a) => ({ ref: ref(porId.get(a.clave.split("|")[0])), tipo: a.clave.split("|")[1], desde: a.ep.desde, turno: a.turno.motivo })),
    tareasQuitadas: tareasQuitadas.map((t) => ({ ref: ref(porId.get(t.chat)), motivo: t.motivo, toque: t.toque, prioridad: t.prioridad, primera: t.primera, sinDuena: t.sinDuena, turno: turnoEn(t.chat, t.primera).motivo })),
    tareasAhora: [...R.ahora.tareas.values()].map((t) => ({ ref: ref(porId.get(t.chat)), motivo: t.motivo, prioridad: t.prioridad, primera: t.primera, sinDuena: t.sinDuena })),
  };
  fs.writeFileSync(opcion("json"), JSON.stringify(salida, null, 2), "utf8");
}
