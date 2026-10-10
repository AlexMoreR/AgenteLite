// SIMULACIÓN HISTÓRICA DEL SUPERVISOR: reproduce hora a hora (y cada 5 min para el libro y la
// atención) lo que el Supervisor habría visto y avisado, con datos exportados EN SOLO LECTURA.
//
//   node scripts/supervisor-simulacion.mjs <carpeta> [--desde 2026-09-22] [--hasta 2026-10-10T05:00Z] [--json]
//
// La carpeta (fuera del repo) trae: convs.jsonl, msgs.jsonl, libro.json, historial.json y,
// opcional, flujos.json. Ver el informe en el cerebro de Magilus para cómo se exportaron.
// No toca la base ni la red: todo corre en memoria.
import fs from "node:fs";
import path from "node:path";
import { cargar, leerJson } from "./supervisor-cargar.mjs";

const args = process.argv.slice(2);
const carpeta = args.find((a) => !a.startsWith("--"));
if (!carpeta) {
  console.error("Uso: node scripts/supervisor-simulacion.mjs <carpeta> [--desde AAAA-MM-DD] [--hasta ISO] [--json]");
  process.exit(2);
}
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

const lead = cargar("src/features/supervisor/dominio/lead.ts");
const analisis = cargar("src/features/supervisor/dominio/analisis.ts");
const alertas = cargar("src/features/supervisor/dominio/alertas.ts");
const guardian = cargar("src/features/supervisor/dominio/guardian.ts");
const { escenariosDelCombo } = cargar("src/features/supervisor/dominio/escenarios.ts");
const { diffDelLibro } = cargar("src/features/supervisor/dominio/libro-diff.ts");
const atencion = cargar("src/features/supervisor/dominio/detectores-atencion.ts");

const fecha = (s) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : null);
const lineas = (archivo) =>
  fs.readFileSync(path.join(carpeta, archivo), "utf8").replace(/^﻿/, "").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// ------------------------------------------------------------------ datos
const convs = lineas("convs.jsonl");
const porConv = new Map();
for (const m of lineas("msgs.jsonl")) {
  const lista = porConv.get(m.c) ?? [];
  lista.push({
    id: m.id,
    direction: m.d,
    type: m.ty,
    content: m.x || null,
    transcripcion: m.tr || null,
    createdAt: fecha(m.t),
    source: m.s ?? null,
    kind: m.k ?? null,
    assigneeUserId: m.as ?? null,
    enviadoPorUserId: m.ep ?? null,
  });
  porConv.set(m.c, lista);
}
for (const lista of porConv.values()) lista.sort((a, b) => a.createdAt - b.createdAt);

const libroActual = leerJson(path.join(carpeta, "libro.json"));
const historial = leerJson(path.join(carpeta, "historial.json"));
const flujos = fs.existsSync(path.join(carpeta, "flujos.json")) ? leerJson(path.join(carpeta, "flujos.json")) : {};
const libros = new Map(historial.map((f) => [f.version, f.libro]));
libros.set(libroActual.version, libroActual);
const cambiosCrudos = historial
  .map((f) => ({ version: f.version + 1, anterior: f.version, en: new Date(f.at), autor: f.autor ?? null, resumen: f.resumen ?? null }))
  .filter((c) => libros.has(c.version))
  .sort((a, b) => a.en - b.en);
const cambios = analisis.agruparCambios(cambiosCrudos);
const versionEn = (cuando) => {
  let v = null;
  for (const c of cambiosCrudos) if (c.en <= cuando) v = c.version;
  return v ?? (cambiosCrudos[0] ? cambiosCrudos[0].anterior : null);
};

const fichas = [];
for (const c of convs) {
  const ficha = lead.fichaDelLead(c.id, porConv.get(c.id) ?? [], {
    anuncio: c.adTitle || c.adSourceId ? { titulo: c.adTitle, id: c.adSourceId } : null,
    asesoraId: c.assignedTo ?? null,
    versionEn,
  });
  if (ficha) {
    ficha.etapa = c.stage;
    fichas.push(ficha);
  }
}
const combo = fichas.filter((f) => f.producto === "combo-camilla");

// ------------------------------------------------------------------ vueltas
const desde = new Date(`${opcion("desde", "2026-09-22")}T05:00:00Z`);
const hasta = fecha(opcion("hasta", "2026-10-10T05:00:00Z"));
const PRODUCTOS = [{ clave: "combo-camilla", nombre: "Combo de Camilla" }];
const PRODUCTO_COMBO = "cmp7lojx700bj2hn6z2vrv0i9";
const escenarios = escenariosDelCombo({ productoComboId: PRODUCTO_COMBO, flujoFotosCombo: "evolution:cmre8u9r9002g2gp1fqlzrsdj:workflow-1784124366501-74i1b" });

let abiertos = [];
const avisos = [];
const historiaIncidentes = new Map();
const guardianes = [];
const primeraVezHallazgo = new Map();
const SIN_GUARDIAN = args.includes("--sin-guardian");
const atencionPorDia = {};
const INCIDENTE = { cambio: new Date("2026-10-07T02:36:52Z"), arreglo: new Date("2026-10-10T04:35:08Z") };

function registrar(resultado, ahora, tipo) {
  abiertos = resultado.incidentes.filter((i) => i.estado === "ABIERTA" || (i.resueltaEn && ahora - i.resueltaEn < 7 * 24 * 3600_000));
  for (const inc of resultado.incidentes) {
    for (const h of inc.hallazgos) {
      const k = `${inc.clave}|${h.clave}`;
      if (!primeraVezHallazgo.has(k)) primeraVezHallazgo.set(k, { en: ahora, severidad: h.severidad, que: h.que });
    }
    const previo = historiaIncidentes.get(inc.clave);
    historiaIncidentes.set(inc.clave, { ...inc, primerAviso: previo?.primerAviso ?? null, snapshotAviso: previo?.snapshotAviso ?? null });
  }
  for (const a of resultado.avisar) {
    const texto = alertas.textoDeLaAlerta(a.incidente, ahora);
    avisos.push({ en: ahora, tipo, motivo: a.motivo, clave: a.incidente.clave, severidad: a.incidente.severidad, titulo: a.incidente.titulo, texto, push: alertas.textoDelAviso(a.incidente, a.motivo) });
    const h = historiaIncidentes.get(a.incidente.clave);
    if (!h.primerAviso) {
      h.primerAviso = ahora;
      h.snapshotAviso = texto;
    }
  }
}

// Chats "abiertos" a la hora T para el chequeo de atención (aproximado: la asesora es la actual).
function chatsEn(ahora) {
  const salida = [];
  for (const c of convs) {
    const ms = porConv.get(c.id);
    if (!ms || !ms.length || ms[0].createdAt > ahora) continue;
    let ultimoCliente = null;
    let ultimaHumana = null;
    const pendientes = [];
    for (const m of ms) {
      if (m.createdAt > ahora) break;
      if (m.direction === "INBOUND" && m.type !== "SYSTEM") {
        ultimoCliente = m.createdAt;
        pendientes.push(m.transcripcion || m.content || "");
      } else if (m.direction === "OUTBOUND" && m.type !== "SYSTEM" && (m.source === "manual" || m.source === "instance")) {
        ultimaHumana = m.createdAt;
        pendientes.length = 0;
      }
    }
    if (!ultimoCliente || ahora - ultimoCliente > 72 * 3600_000) continue;
    salida.push({
      conversationId: c.id,
      asesoraId: c.assignedTo ?? null,
      etapa: null,
      ultimoClienteEn: ultimoCliente,
      ultimaRespuestaHumanaEn: ultimaHumana,
      textosPendientes: pendientes.slice(-5),
    });
  }
  return salida;
}

const vistos = new Set();
const PASO = 5 * 60_000;
for (let t = desde.getTime(); t <= hasta.getTime(); t += PASO) {
  const ahora = new Date(t);
  // Cada 5 min: ¿cambió el libro? → diff + Guardian (tiempo real del libro).
  for (const cambio of cambios) {
    if (vistos.has(cambio.version) || cambio.en > ahora || cambio.en < new Date(t - PASO * 2) ) continue;
    vistos.add(cambio.version);
    const anterior = libros.get(cambio.anterior);
    const nuevo = libros.get(cambio.version);
    if (!anterior || !nuevo) continue;
    const informe = guardian.correrGuardian({ candidato: { ...nuevo, version: cambio.version }, anterior: { ...anterior, version: cambio.anterior }, escenarios, flujos });
    const diff = diffDelLibro({ ...anterior, version: cambio.anterior }, { ...nuevo, version: cambio.version });
    guardianes.push({ en: ahora, version: cambio.version, anterior: cambio.anterior, cambioEn: cambio.en, veredicto: informe.veredicto, resumen: informe.resumen, diff: diff.resumen });
    const h = analisis.hallazgoDelCambioDelLibro({ cambio, diff, informe, producto: "combo-camilla" });
    if (SIN_GUARDIAN) continue;
    const arreglos = analisis.hallazgosDeArreglo({ abiertos, cambio, informe });
    registrar(alertas.consolidar({ abiertos, hallazgos: [h, ...arreglos], ahora, cambios: cambios.filter((c) => c.en <= ahora), familiasEvaluadas: [] }), ahora, "libro");
  }
  // Cada 5 min: atención (solo en horario laboral cuenta la espera). Se cuenta, no se imprime.
  if (t % (15 * 60_000) === 0) {
    const hall = atencion.detectarAtencion(chatsEn(ahora), ahora);
    const dia = new Date(t - 5 * 3600_000).toISOString().slice(0, 10);
    const r = alertas.consolidar({ abiertos: abiertos.filter((i) => i.familia === "ATENCION"), hallazgos: hall, ahora, cambios, familiasEvaluadas: ["ATENCION"] });
    abiertos = [...abiertos.filter((i) => i.familia !== "ATENCION"), ...r.incidentes.filter((i) => i.estado === "ABIERTA")];
    atencionPorDia[dia] ??= { avisos: 0, criticos: 0 };
    atencionPorDia[dia].avisos += r.avisar.length;
    atencionPorDia[dia].criticos += r.avisar.filter((a) => a.incidente.severidad === "CRITICO").length;
  }
  // Cada hora: análisis agregado.
  if (t % 3600_000 === 0) {
    const hallazgos = analisis.analizarHora({ fichas: combo, ahora, cambios: cambios.filter((c) => c.en <= ahora), productos: PRODUCTOS });
    const noAtencion = abiertos.filter((i) => i.familia !== "ATENCION");
    const r = alertas.consolidar({ abiertos: noAtencion, hallazgos, ahora, cambios: cambios.filter((c) => c.en <= ahora), familiasEvaluadas: ["BOT", "EMBUDO", "CAMBIO"] });
    const atencionAbiertos = abiertos.filter((i) => i.familia === "ATENCION");
    registrar(r, ahora, "hora");
    abiertos = [...abiertos.filter((i) => i.familia !== "ATENCION"), ...atencionAbiertos];
  }
}

// ------------------------------------------------------------------ informe
const bog = (d) => (d ? `${new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} Bogotá` : "—");
const minutosEntre = (a, b) => Math.round((b - a) / 60_000);
const relativo = (a, b) => {
  const m = minutosEntre(a, b);
  return m >= 0 ? `+${m} min` : `${-m} min ANTES`;
};
const primerAfectado = combo
  .filter((f) => f.entradaEn >= INCIDENTE.cambio && /Nombra las piezas/.test(f.reglaPrimerMensaje ?? ""))
  .sort((a, b) => a.entradaEn - b.entradaEn)[0];

const salida = [];
const p = (s = "") => salida.push(s);
p(`SIMULACIÓN DEL SUPERVISOR · ${bog(desde)} → ${bog(hasta)}`);
p(`Leads (todas las líneas exportadas): ${fichas.length}; del Combo de Camilla: ${combo.length}.`);
p(`Cambios del libro en el historial (agrupados a 5 min): ${cambios.map((c) => `v${c.anterior}→v${c.version} ${bog(c.en)}`).join(" | ")}`);
p("");
p("== Change Guardian en cada cambio del libro (corre al verlo, cada 5 min) ==");
for (const g of guardianes) p(`  ${bog(g.en)}  v${g.anterior}→v${g.version}: ${g.veredicto} · ${g.resumen}\n      diff: ${g.diff}`);
p("");
p("== Avisos (push) que habría recibido Alexander, BOT/EMBUDO/CAMBIO ==");
for (const a of avisos) p(`  ${bog(a.en)} [${a.severidad}] (${a.motivo}, ${a.tipo}) ${a.titulo}`);
p("");
const antesDelIncidente = avisos.filter((a) => a.en < INCIDENTE.cambio);
const incidentesAntes = [...historiaIncidentes.values()].filter((i) => i.primeraVezEn < INCIDENTE.cambio);
p(`== Falsos positivos posibles antes del 7-oct (${bog(desde)} a ${bog(INCIDENTE.cambio)}) ==`);
p(`  Avisos push: ${antesDelIncidente.length} · incidentes abiertos (cualquier severidad): ${incidentesAntes.length}`);
for (const i of incidentesAntes) p(`   - ${bog(i.primeraVezEn)} [${i.severidad}] ${i.titulo}`);
p("");
p("== Atención (chequeo cada 15 min en la simulación; aproximado) avisos por día ==");
for (const [d, v] of Object.entries(atencionPorDia)) p(`  ${d}: ${v.avisos} avisos (${v.criticos} críticos)`);
p("");
const delIncidente = [...historiaIncidentes.values()].filter((i) => i.desde >= new Date(INCIDENTE.cambio.getTime() - 3600_000) && i.desde < INCIDENTE.arreglo && i.familia !== "ATENCION");
p("== Incidente del 7-oct ==");
p(`  Cambio del libro: ${bog(INCIDENTE.cambio)}; primer lead afectado: ${primerAfectado ? `${primerAfectado.conversationId} ${bog(primerAfectado.entradaEn)}` : "—"}`);
for (const i of delIncidente) {
  p(`  · ${i.clave} [${i.severidad}] primer aviso ${bog(i.primerAviso)} (${i.primerAviso ? minutosEntre(INCIDENTE.cambio, i.primerAviso) : "—"} min desde el cambio; ${i.primerAviso && primerAfectado ? minutosEntre(primerAfectado.entradaEn, i.primerAviso) : "—"} min desde el primer lead afectado) · estado ${i.estado}${i.resueltaEn ? ` (resuelto ${bog(i.resueltaEn)})` : ""}`);
  p(`    hallazgos: ${i.hallazgos.map((h) => `${h.clave} [${h.severidad}]`).join(", ")}`);
  for (const [k, v] of primeraVezHallazgo) {
    if (!k.startsWith(`${i.clave}|`)) continue;
    p(`      primera vez ${bog(v.en)} (${relativo(INCIDENTE.cambio, v.en)} del cambio${primerAfectado ? `, ${relativo(primerAfectado.entradaEn, v.en)} del primer lead afectado` : ""}) [${v.severidad}] ${k.split("|")[1]}: ${v.que}`);
  }
}
p("");
const cambioDelIncidente = cambios.find((c) => Math.abs(c.en - INCIDENTE.cambio) < 10 * 60_000);
const CLAVE_INC = `INC:libro-v${cambioDelIncidente?.version}:combo-camilla`;
const primerAvisoIncidente = avisos.find((a) => a.en >= INCIDENTE.cambio && a.en < INCIDENTE.arreglo && a.clave === CLAVE_INC);
if (primerAvisoIncidente) {
  p(`== PRIMER AVISO del incidente (${bog(primerAvisoIncidente.en)}) ==`);
  p(`PUSH: ${primerAvisoIncidente.push.title} — ${primerAvisoIncidente.push.body}`);
  p(primerAvisoIncidente.texto);
  p("");
}
const posterior = avisos.filter((a) => a.en > INCIDENTE.cambio && a.en < INCIDENTE.arreglo && a.clave === CLAVE_INC);
const ultimo = posterior.at(-1);
if (ultimo && ultimo !== primerAvisoIncidente) {
  p(`== ÚLTIMA ACTUALIZACIÓN AVISADA del incidente (${bog(ultimo.en)}, ${ultimo.motivo}) ==`);
  p(ultimo.texto);
  p("");
}
const sinGuardian = [...historiaIncidentes.values()].find((i) => i.clave === CLAVE_INC);
if (sinGuardian) {
  const datos = sinGuardian.hallazgos.filter((h) => h.familia !== "CAMBIO" || h.clave.startsWith("CAMBIO:post"));
  p(`== Hallazgos con DATOS (sin el Guardian) en el incidente: ${datos.map((h) => h.clave).join(", ")}`);
}
const despuesArreglo = avisos.filter((a) => a.en >= INCIDENTE.arreglo);
p("");
p(`== Después del arreglo (v191, ${bog(INCIDENTE.arreglo)}) ==`);
for (const a of despuesArreglo) p(`  ${bog(a.en)} [${a.severidad}] ${a.titulo}`);
const v191 = [...historiaIncidentes.values()].filter((i) => /libro-v19[1-5]/.test(i.clave));
for (const i of v191) p(`  incidente ${i.clave} [${i.severidad}] ${i.titulo}`);

const final = [...historiaIncidentes.values()].find((i) => i.clave === CLAVE_INC);
if (final) {
  p("");
  p(`== Estado del incidente al final de la simulación (${bog(hasta)}) ==`);
  p(alertas.textoDeLaAlerta(final, hasta));
}
const texto = salida.join("\n");
console.log(texto);
fs.writeFileSync(path.join(carpeta, "sim-salida.txt"), texto, "utf8");
if (args.includes("--json")) {
  fs.writeFileSync(path.join(carpeta, "sim-avisos.json"), JSON.stringify({ avisos, guardianes, atencionPorDia }, null, 2), "utf8");
}
