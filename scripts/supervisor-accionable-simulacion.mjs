// SIMULACIÓN DEL SUPERVISOR ACCIONABLE con datos reales exportados EN SOLO LECTURA.
//
//   node scripts/supervisor-accionable-simulacion.mjs <export.jsonl> --desde 2026-10-04T05:00Z --hasta 2026-10-11T18:45Z [--json salida.json]
//
// El export trae una línea JSON por conversación ({tipo:"conv"}) y por mensaje ({tipo:"msg"}),
// con el teléfono ya tapado y los números largos de los textos cambiados por "[num]". Cada 5 min
// reconstruye los chats abiertos, corre los detectores de atención de producción y compara:
//   - LEGADO: push a OWNER/ADMIN por cada alerta nueva / que sube (antes del 10-oct).
//   - GRAVEDAD (hoy): el enrutador de avisos por gravedad (push / WhatsApp a Alexander por gravedad).
//   - ACCIONABLE: aviso a la asesora → verificación → escala solo lo que no se resolvió.
// "La asesora actuó" se mide con lo que de verdad pasó (un mensaje humano después del aviso): es el
// piso; con el aviso de verdad deberían resolverse más. No toca la base ni la red.
import fs from "node:fs";
import { cargar } from "./supervisor-cargar.mjs";

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
if (!archivo) {
  console.error("Uso: node scripts/supervisor-accionable-simulacion.mjs <export.jsonl> [--desde ISO] [--hasta ISO] [--json salida]");
  process.exit(2);
}

const atencion = cargar("src/features/supervisor/dominio/detectores-atencion.ts");
const alertas = cargar("src/features/supervisor/dominio/alertas.ts");
const gravedad = cargar("src/features/avisos-gravedad/dominio/reglas.ts");
const acc = cargar("src/features/supervisor-accionable/dominio/reglas.ts");

const fecha = (s) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : null);
const filas = fs.readFileSync(archivo, "utf8").replace(/^﻿/, "").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const convs = filas.filter((f) => f.tipo === "conv");
const porConv = new Map();
for (const m of filas.filter((f) => f.tipo === "msg")) {
  const lista = porConv.get(m.c) ?? [];
  lista.push({ en: fecha(m.t), d: m.d, ty: m.ty, s: m.s, k: m.k, as: m.as, x: m.x ?? "" });
  porConv.set(m.c, lista);
}
for (const l of porConv.values()) l.sort((a, b) => a.en - b.en);

const desde = fecha(opcion("desde", "2026-10-04T05:00:00Z"));
const hasta = fecha(opcion("hasta", "2026-10-11T18:45:00Z"));
const PASO = 5 * 60_000;
const nombreDe = new Map(convs.filter((c) => c.as).map((c) => [c.as, c.an]));

// Estado incremental por chat (los ticks avanzan en orden).
const est = new Map(
  convs.map((c) => [
    c.id,
    { i: 0, ultimoCliente: null, ultimaHumana: null, pendientes: [], cliente: [], asignadaA: null, asignadaEn: null, primero: null, ultimo: null },
  ]),
);
for (const c of convs) {
  const ms = porConv.get(c.id) ?? [];
  const e = est.get(c.id);
  e.primero = ms[0]?.en ?? null;
  e.ultimo = ms.at(-1)?.en ?? null;
  e.tieneNotas = ms.some((m) => m.ty === "SYSTEM" && m.k === "assigned");
}

function chatsEn(ahora) {
  const salida = [];
  for (const c of convs) {
    const ms = porConv.get(c.id);
    if (!ms?.length) continue;
    const e = est.get(c.id);
    while (e.i < ms.length && ms[e.i].en <= ahora) {
      const m = ms[e.i];
      if (m.ty === "SYSTEM") {
        if (m.k === "assigned") {
          e.asignadaA = m.as ?? null;
          e.asignadaEn = m.en;
        }
      } else if (m.d === "INBOUND") {
        e.ultimoCliente = m.en;
        e.pendientes.push(m.x);
        e.cliente.push(m.x);
        if (e.cliente.length > 20) e.cliente.shift();
      } else if (m.d === "OUTBOUND" && (m.s === "manual" || m.s === "instance")) {
        e.ultimaHumana = m.en;
        e.pendientes = [];
      }
      e.i += 1;
    }
    if (!e.primero || e.primero > ahora) continue;
    const ultimoMov = ms[Math.max(0, e.i - 1)].en;
    if (ahora - ultimoMov > 72 * 3600_000) continue;
    // Ganado / perdido / cerrado: solo desde su último mensaje (aproximación: no hay historial de etapas).
    const cerrado = (c.e === "GANADO" || c.e === "PERDIDO" || c.st !== "OPEN") && e.ultimo && ahora >= e.ultimo;
    if (cerrado && c.st !== "OPEN") continue;
    const asesora = e.tieneNotas ? e.asignadaA : (c.as ?? null);
    salida.push({
      conversationId: c.id,
      asesoraId: asesora,
      asesoraNombre: asesora ? (nombreDe.get(asesora) ?? asesora) : null,
      etapa: cerrado ? c.e : c.e === "GANADO" || c.e === "PERDIDO" ? "NEGOCIACION" : c.e,
      ultimoClienteEn: e.ultimoCliente,
      ultimaRespuestaHumanaEn: e.ultimaHumana,
      textosPendientes: e.pendientes.slice(-5),
      textosDelCliente: [...e.cliente],
      telefono: c.tel,
      nombreCliente: c.nom,
      asignadaEn: asesora && e.asignadaA === asesora ? e.asignadaEn : null,
      temperatura: c.temp,
      dormidoHasta: c.dorm ? fecha(c.dorm) : null,
    });
  }
  return salida;
}

const dia = (t) => new Date(t.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
const porDia = {};
const fila = (d) =>
  (porDia[d] ??= {
    legado_push: 0,
    gravedad_push: 0,
    gravedad_wa: 0,
    gravedad_asesora: 0,
    acc_avisos_asesora: 0,
    acc_acciones: 0,
    acc_resueltas: 0,
    acc_segundo: 0,
    acc_escaladas: 0,
    acc_escala_push: 0,
    acc_solo_pantalla: 0,
    acc_escala_wa: 0,
    acc_patron: 0,
  });

let abiertos = [];
const marcas = {};
let estado = acc.estadoVacio();
const CONFIG = { ...acc.CONFIG_ACCIONABLE_POR_DEFECTO, activo: true };
const SUPERVISORA = { id: "cms0qky97099f2go1n16d5y3y", nombre: "Ingrid Sanchez" };
const escaladas = [];
const porTipo = {};
const porAsesora = {};
const minutosResueltas = [];

for (let t = desde.getTime(); t <= hasta.getTime(); t += PASO) {
  const ahora = new Date(t);
  const d = dia(ahora);
  const chats = chatsEn(ahora);
  const hallazgos = [...atencion.detectarAtencion(chats, ahora), ...gravedad.detectarPagoSinRespuesta(chats, ahora, 30)];
  const r = alertas.consolidar({ abiertos, hallazgos, ahora, cambios: [], familiasEvaluadas: ["ATENCION"] });
  abiertos = r.incidentes.filter((i) => i.estado === "ABIERTA");

  // LEGADO: push a OWNER/ADMIN por cada aviso del Supervisor (nuevo / sube / recordatorio).
  fila(d).legado_push += r.avisar.length;

  // GRAVEDAD (hoy): lo mismo que enrutarAlertasDelSupervisor, sin enviar.
  const candidatos = new Map(r.avisar.map((a) => [a.incidente.clave, { inc: a.incidente, rec: a.motivo === "recordatorio" }]));
  for (const inc of r.incidentes) if (inc.estado === "ABIERTA" && inc.ultimaVezEn.getTime() === t && !candidatos.has(inc.clave)) candidatos.set(inc.clave, { inc, rec: false });
  for (const { inc, rec } of candidatos.values()) {
    const { gravedad: g } = gravedad.clasificarIncidente(inc, ahora);
    const marca = marcas[inc.clave] ?? null;
    const leads = gravedad.leadsDelIncidente(inc);
    const nueva = { gravedad: g, pushEn: marca?.pushEn ?? null, pushLeads: marca?.pushLeads ?? 0, waEn: marca?.waEn ?? null, waLeads: marca?.waLeads ?? 0, vistoEn: ahora.toISOString() };
    if (g !== "OBSERVACION" && gravedad.decidirPush({ marca, gravedad: g, leads, ahora, enfriamientoMin: 60, recordatorio: rec })) {
      if (g === "OPERATIVO") fila(d).gravedad_asesora += 1;
      else fila(d).gravedad_push += 1;
      nueva.pushEn = ahora.toISOString();
      nueva.pushLeads = leads;
    }
    if (g === "CRITICO" && gravedad.decidirWhatsApp({ marca, leads, ahora, enfriamientoMin: 60 })) {
      fila(d).gravedad_wa += 1;
      nueva.waEn = ahora.toISOString();
      nueva.waLeads = leads;
    }
    marcas[inc.clave] = nueva;
  }

  // ACCIONABLE.
  const extras = new Map(
    convs.map((c) => [c.id, { cotizacionEn: c.cot && fecha(c.cot) <= ahora ? fecha(c.cot) : null, anticipoEn: c.ant && fecha(c.ant) <= ahora ? fecha(c.ant) : null }]),
  );
  const candidatas = acc.candidatasDeLaVuelta({ hallazgos, chats, ahora, supervisora: SUPERVISORA, extras });
  const res = acc.avanzar({ estado, candidatas, chats, atendidas: {}, ahora, config: CONFIG, supervisora: SUPERVISORA });
  estado = res.estado;
  let pushEnLaVuelta = false;
  for (const e of res.eventos) {
    if (e.tipo === "avisar") {
      fila(d).acc_avisos_asesora += 1;
      for (const id of e.accionIds) {
        const a = estado.acciones[id];
        fila(d).acc_acciones += 1;
        porTipo[a.tipo] ??= { acciones: 0, resueltas: 0, escaladas: 0 };
        porTipo[a.tipo].acciones += 1;
        porAsesora[a.responsableNombre] ??= { acciones: 0, resueltas: 0, segundo: 0, escaladas: 0 };
        porAsesora[a.responsableNombre].acciones += 1;
      }
    } else if (e.tipo === "segundo_aviso") {
      fila(d).acc_segundo += e.accionIds.length;
      for (const id of e.accionIds) porAsesora[estado.acciones[id].responsableNombre].segundo += 1;
    } else if (e.tipo === "resuelta_abajo") {
      const a = estado.acciones[e.accionId];
      fila(d).acc_resueltas += 1;
      porTipo[a.tipo].resueltas += 1;
      porAsesora[a.responsableNombre].resueltas += 1;
      minutosResueltas.push(a.minutosHastaResolver);
    } else if (e.tipo === "escalar") {
      const a = estado.acciones[e.accionId];
      if (a.tipo.startsWith("patron")) fila(d).acc_patron += 1;
      else {
        porTipo[a.tipo].escaladas += 1;
        (porAsesora[a.responsableNombre] ??= { acciones: 0, resueltas: 0, segundo: 0, escaladas: 0 }).escaladas += 1;
      }
      fila(d).acc_escaladas += 1;
      if (e.gravedad === "OBSERVACION") fila(d).acc_solo_pantalla += 1;
      else pushEnLaVuelta = true;
      if (e.gravedad === "CRITICO") fila(d).acc_escala_wa += 1;
      escaladas.push({ en: ahora, tarjeta: acc.tarjetaDeAccion(a, ahora), tipo: a.tipo, gravedad: e.gravedad });
    }
  }
  // Las escaladas de una vuelta van en UN push a Alexander.
  if (pushEnLaVuelta) fila(d).acc_escala_push += 1;
}

const dias = Object.keys(porDia).sort();
const total = (k) => dias.reduce((s, d) => s + porDia[d][k], 0);
const lineas = [];
const p = (linea = "") => lineas.push(linea);
p(`SIMULACIÓN SUPERVISOR ACCIONABLE · ${desde.toISOString()} → ${hasta.toISOString()} · ${convs.length} chats, ${filas.length - convs.length} mensajes`);
p("");
p("Día | Legado push | Gravedad: push Alexander | Gravedad: WhatsApp Alexander | Gravedad: push asesora | Accionable: avisos asesora (chats) | resueltas abajo | segundo aviso | escaladas (todas) | push a Alexander | WhatsApp a Alexander | solo pantalla | patrones");
for (const d of dias) {
  const f = porDia[d];
  p(`${d} | ${f.legado_push} | ${f.gravedad_push} | ${f.gravedad_wa} | ${f.gravedad_asesora} | ${f.acc_avisos_asesora} (${f.acc_acciones}) | ${f.acc_resueltas} | ${f.acc_segundo} | ${f.acc_escaladas} | ${f.acc_escala_push} | ${f.acc_escala_wa} | ${f.acc_solo_pantalla} | ${f.acc_patron}`);
}
p(`TOTAL | ${total("legado_push")} | ${total("gravedad_push")} | ${total("gravedad_wa")} | ${total("gravedad_asesora")} | ${total("acc_avisos_asesora")} (${total("acc_acciones")}) | ${total("acc_resueltas")} | ${total("acc_segundo")} | ${total("acc_escaladas")} | ${total("acc_escala_push")} | ${total("acc_escala_wa")} | ${total("acc_solo_pantalla")} | ${total("acc_patron")}`);
const orden = [...minutosResueltas].sort((a, b) => a - b);
p(`Mediana de minutos aviso→respuesta en las resueltas abajo: ${orden.length ? orden[Math.floor((orden.length - 1) / 2)] : "—"}`);
p("");
p("Por tipo: tipo | acciones | resueltas abajo | escaladas");
for (const [k, v] of Object.entries(porTipo)) p(`${k} | ${v.acciones} | ${v.resueltas} | ${v.escaladas}`);
p("");
p("Por responsable: nombre | acciones | resueltas abajo | segundo aviso | escaladas");
for (const [k, v] of Object.entries(porAsesora)) p(`${k} | ${v.acciones} | ${v.resueltas} | ${v.segundo} | ${v.escaladas}`);
p("");
const porRiesgo = {};
for (const e of escaladas) {
  const k = `${e.tipo}/${e.tarjeta.riesgoOrden}/${e.gravedad}`;
  porRiesgo[k] = (porRiesgo[k] ?? 0) + 1;
}
p("Escaladas por tipo / riesgo / canal:");
for (const [k, v] of Object.entries(porRiesgo).sort((a, b) => b[1] - a[1])) p(`  ${k}: ${v}`);
p("");
const ejemplos = [
  escaladas.find((e) => e.tipo === "pago"),
  escaladas.find((e) => e.tarjeta.riesgoOrden === "COTIZACION"),
  escaladas.find((e) => e.tipo === "caliente"),
  escaladas.find((e) => e.tipo.startsWith("patron")),
  escaladas.find((e) => e.tipo === "asignado"),
].filter(Boolean);
p("EJEMPLOS DE TARJETA (Prioridades de Alexander)");
for (const e of ejemplos) {
  p(`--- ${e.tipo} · ${e.gravedad} · ${new Date(e.en.getTime() - 5 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} Bogotá`);
  p(acc.textoDeLaTarjeta(e.tarjeta));
}
console.log(lineas.join("\n"));
if (opcion("json", null)) fs.writeFileSync(opcion("json"), JSON.stringify({ porDia, porTipo, porAsesora, ejemplos: ejemplos.map((e) => ({ ...e, en: e.en.toISOString() })) }, null, 2), "utf8");
