/**
 * RELLENO HISTÓRICO DEL EMBUDO: la parte pura (sin base, sin Next).
 *
 * Reconstruye, para UN chat, los mismos eventos que hoy se registran en vivo (ENTRADA, BIENVENIDA,
 * RESPONDIÓ, PASO, RECOMENDACIÓN, SEÑAL, TURNO, ESCALADO, ASIGNADA, ASESORA_RESPONDIÓ, SEGUIMIENTO,
 * ETAPA_CRM, VENTA) a partir de lo que ya está en la base: los mensajes del chat, las notas del
 * agente ("Agente V3: Ganó "regla" porque…"), las de asignación y de etapa, el libro V3 vigente en
 * cada momento y la venta del contacto. Todo con origen = "backfill" y claveUnica.
 *
 * Lo usan el relleno de la app (servicios/relleno.ts, botón "Guardar historia" del panel), el
 * script scripts/embudo-backfill.mjs y las pruebas. Las reglas son las de dominio/eventos.ts.
 */

import { CLAVE_COMBO, productoDeEntrada, type ConfigEmbudo } from "./combo";
import { eventosDeSenales, eventosDelTurno, type EventoDelEmbudo } from "./eventos";

export const ORIGEN_RELLENO = "backfill" as const;

const FUENTES_DE_PERSONA = new Set(["manual", "instance"]);
const FUENTES_DE_SEGUIMIENTO = new Set(["agente-v3-seguimiento", "follow"]);

/** Claves que el registro en vivo usa igual: el relleno no las duplica nunca. */
export const CLAVES_COMO_EN_VIVO = /^(ENTRADA|BIENVENIDA|RESPONDIO|PASO|RECOMENDACION|ASESORA_RESPONDIO|SENAL|VENTA):/;

export type AccionDelLibro = { tipo?: string; productoId?: string | null; paso?: string | null };
export type ReglaDelLibro = { id?: string | null; nombre?: string; entonces?: AccionDelLibro[] };
export type LibroV3 = { version?: number | null; reglas?: ReglaDelLibro[] };
export type FilaDelHistorial = { version?: number | null; at?: string; libro?: LibroV3 | null };

export type MensajeDelRelleno = {
  id: string;
  direction: string;
  type: string;
  content: string | null;
  transcripcion: string | null;
  externalId: string | null;
  createdAt: Date;
  source: string | null;
  kind: string | null;
  assigneeUserId: string | null;
  actorUserId: string | null;
  origen: string | null;
  enviadoPorUserId: string | null;
};

export type ContactoDelRelleno = {
  metadata: Record<string, unknown> | null;
  crmStage: string | null;
  wonQuoteRef: string | null;
  wonAt: Date | null;
};

export type LineaDeLibros = { enElMomento(cuando: Date): { version: number | null; libro: LibroV3 } };

export function parsearJson<T>(texto: unknown, porDefecto: T): T {
  if (texto === null || texto === undefined || texto === "") return porDefecto;
  if (typeof texto !== "string") return texto as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return porDefecto;
  }
}

/**
 * Las versiones del libro con su vigencia. El historial guarda cada versión ANTERIOR con la hora
 * en que se reemplazó (`at`); la actual rige desde entonces.
 */
export function armarLineaDeLibros(libroActual: LibroV3 | null, historial: unknown): LineaDeLibros {
  const versiones = (Array.isArray(historial) ? (historial as FilaDelHistorial[]) : [])
    .filter((fila) => fila && typeof fila.at === "string" && fila.libro)
    .map((fila) => ({
      version: fila.version ?? fila.libro?.version ?? null,
      hasta: new Date(fila.at as string),
      libro: fila.libro as LibroV3,
    }))
    .sort((a, b) => a.hasta.getTime() - b.hasta.getTime());
  return {
    enElMomento(cuando: Date) {
      const vigente = versiones.find((fila) => fila.hasta.getTime() > cuando.getTime());
      if (vigente) return { version: vigente.version, libro: vigente.libro };
      return { version: libroActual?.version ?? null, libro: libroActual ?? { reglas: [] } };
    },
  };
}

const RE_GANO = /Gan[oó] [«"“]([^»"”]+)[»"”] porque/;
const RE_SIGUE = /sigue con [«"“]([^»"”]+)[»"”]/;
const RE_RETOMO = /retom[oó] la conversaci[oó]n al volver a encenderse: (.+)$/;
const RE_PIDE_ASESOR = /^El agente pide un asesor: ([\s\S]+)$/;

/** Qué hizo la regla ganadora de una nota del V3: producto, paso y si mandó un flujo. */
function accionesDeLaNota(texto: string, libro: LibroV3) {
  const reglas = Array.isArray(libro?.reglas) ? libro.reglas : [];
  const nombres: string[] = [];
  const gano = texto.match(RE_GANO) ?? texto.match(RE_RETOMO);
  if (gano) nombres.push(gano[1].trim());
  const sigue = texto.match(RE_SIGUE);
  if (sigue) nombres.push(sigue[1].trim());
  const encontradas = nombres
    .map((nombre) => reglas.find((regla) => regla.nombre === nombre))
    .filter((regla): regla is ReglaDelLibro => Boolean(regla));
  const acciones = encontradas.flatMap((regla) => (Array.isArray(regla.entonces) ? regla.entonces : []));
  return {
    regla: encontradas[0] ?? (nombres[0] ? { id: null, nombre: nombres[0] } : null),
    acciones,
    // Las notas sin regla del libro (Catálogo de Gestión, Redactor, Compra por cantidad) igual son turno.
    esTurno: Boolean(gano) || texto.startsWith("Agente V3:"),
  };
}

type Estado = { producto: string | null; paso: string | null };

function aplicarAcciones(estado: Estado, acciones: AccionDelLibro[]): Estado {
  let siguiente = { ...estado };
  for (const accion of acciones) {
    if (accion?.tipo === "activar_producto") {
      siguiente = { ...siguiente, producto: accion.productoId ?? null, paso: siguiente.paso ?? "PRESENTACION" };
    }
    if (accion?.tipo === "ir_al_paso") siguiente = { ...siguiente, paso: accion.paso ?? null };
  }
  return siguiente;
}

function origenDeLaAsignacion(texto: string, actor: string | null, origen: string | null): string {
  if (origen) return origen;
  const t = (texto ?? "").toLowerCase();
  if (t.includes("por la campa")) return "campana";
  if (t.includes("respaldo")) return "respaldo";
  if (t.includes("madrugada")) return "madrugada";
  if (t.includes("al responder")) return "tomo_al_responder";
  if (t.includes("auto-asignado")) return "turno";
  return actor ? "manual" : "automatico";
}

function textoDe(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

/**
 * Los eventos de UN chat, a partir de sus mensajes (del más viejo al más nuevo). Pura.
 * `claveProducto(id)` traduce un producto del V3 a la clave del embudo.
 */
export function reconstruirChat(input: {
  chat: { id: string };
  mensajes: MensajeDelRelleno[];
  contacto: ContactoDelRelleno | null;
  libros: LineaDeLibros;
  config: ConfigEmbudo;
  claveProducto: (id: string | null) => string | null;
}): EventoDelEmbudo[] {
  const { chat, mensajes, contacto, libros, config, claveProducto } = input;
  const salida: EventoDelEmbudo[] = [];
  const id = chat.id;
  const entrantes = mensajes.filter((m) => m.direction === "INBOUND" && m.type !== "SYSTEM");
  if (!entrantes.length) return salida;
  const primero = entrantes[0];

  // ENTRADA
  const meta = contacto?.metadata ?? {};
  const anuncio =
    textoDe(meta.adTitle) || textoDe(meta.adSourceId)
      ? { titulo: textoDe(meta.adTitle) ?? "", id: textoDe(meta.adSourceId) ?? "", red: textoDe(meta.adSourceApp) ?? "" }
      : null;
  const libroEntrada = libros.enElMomento(primero.createdAt);
  salida.push({
    tipo: "ENTRADA",
    origen: ORIGEN_RELLENO,
    producto: productoDeEntrada({ anuncio, primerMensaje: primero.content }, config),
    libroVersion: libroEntrada.version,
    claveUnica: `ENTRADA:${id}`,
    createdAt: primero.createdAt,
    datos: {
      anuncioTitulo: anuncio?.titulo || null,
      anuncioRed: anuncio?.red || null,
      anuncioId: anuncio?.id || null,
      porAnuncio: Boolean(anuncio),
    },
  });

  let estado: Estado = { producto: null, paso: null };
  let ultimoCorte = new Date(0); // hasta dónde ya se miró (la nota anterior)
  let botHablo = false;
  let asesoraRespondio = false;
  const inicio = mensajes[0].createdAt;

  for (const m of mensajes) {
    const fuente = m.source ?? null;
    const texto = (m.content ?? "").trim();

    if (m.type !== "SYSTEM" && m.direction === "INBOUND") {
      // SEÑALES de cada mensaje (con la transcripción si es audio).
      for (const ev of eventosDeSenales({
        conversationId: id,
        texto: m.transcripcion || m.content || "",
        paso: estado.paso,
        producto: claveProducto(estado.producto),
        origen: ORIGEN_RELLENO,
        idDelMensaje: m.externalId || m.id,
        cuando: m.createdAt,
      })) {
        salida.push(ev);
      }
      continue;
    }

    if (m.type !== "SYSTEM" && m.direction === "OUTBOUND") {
      if (fuente && FUENTES_DE_PERSONA.has(fuente)) {
        // Lo que sale del celular en el primer minuto es el automático de la línea, no una persona.
        const automatico = fuente === "instance" && m.createdAt.getTime() - inicio.getTime() < 60_000;
        if (!asesoraRespondio && !automatico) {
          asesoraRespondio = true;
          salida.push({
            tipo: "ASESORA_RESPONDIO",
            origen: ORIGEN_RELLENO,
            claveUnica: `ASESORA_RESPONDIO:${id}`,
            createdAt: m.createdAt,
            datos: { asesora: m.enviadoPorUserId ?? null, via: fuente === "instance" ? "celular" : "crm" },
          });
        }
      } else if (fuente && FUENTES_DE_SEGUIMIENTO.has(fuente)) {
        salida.push({
          tipo: "SEGUIMIENTO_ENVIADO",
          origen: ORIGEN_RELLENO,
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
        origen: ORIGEN_RELLENO,
        claveUnica: `ASIGNADA:${id}:${m.id}`,
        createdAt: m.createdAt,
        datos: { asesora: m.assigneeUserId ?? null, origenReparto: origenDeLaAsignacion(texto, m.actorUserId, m.origen), carga: null },
      });
      continue;
    }
    if (m.kind === "stage_changed") {
      salida.push({
        tipo: "ETAPA_CRM",
        origen: ORIGEN_RELLENO,
        claveUnica: `ETAPA:${id}:${m.id}`,
        createdAt: m.createdAt,
        datos: { nota: texto.slice(0, 200) },
      });
      continue;
    }
    const pide = texto.match(RE_PIDE_ASESOR);
    if (pide) {
      salida.push({
        tipo: "ESCALADO",
        origen: ORIGEN_RELLENO,
        claveUnica: `ESCALADO:${id}:${m.id}`,
        createdAt: m.createdAt,
        datos: { motivo: pide[1].slice(0, 300) },
      });
      continue;
    }
    if (!(texto.startsWith("Agente V3:") || RE_RETOMO.test(texto))) continue;

    // UN TURNO DEL V3: lo que escribió la clienta desde la nota anterior y lo que salió del bot.
    const { version, libro } = libros.enElMomento(m.createdAt);
    const { regla, acciones, esTurno } = accionesDeLaNota(texto, libro);
    if (!esTurno) continue;
    const delTurno = mensajes.filter(
      (x) => x.createdAt.getTime() > ultimoCorte.getTime() && x.createdAt.getTime() <= m.createdAt.getTime() && x.type !== "SYSTEM",
    );
    const delCliente = delTurno.filter((x) => x.direction === "INBOUND");
    const ultimoDelCliente = delCliente.at(-1);
    const delBot = delTurno.filter(
      (x) =>
        x.direction === "OUTBOUND" &&
        !FUENTES_DE_PERSONA.has(x.source ?? "") &&
        !FUENTES_DE_SEGUIMIENTO.has(x.source ?? "") &&
        (!ultimoDelCliente || x.createdAt.getTime() >= ultimoDelCliente.createdAt.getTime()),
    );
    const antes = { ...estado };
    const despues = aplicarAcciones(estado, acciones);
    for (const ev of eventosDelTurno({
      conversationId: id,
      traza: {
        libroVersion: version,
        antes: { pasoActual: antes.paso, producto: antes.producto, esPrimerMensaje: !botHablo },
        despues: { pasoActual: despues.paso, producto: despues.producto },
        intenciones: [],
        tiposDeAccion: acciones.map((accion) => accion.tipo ?? ""),
        conSaludo: !botHablo && delBot.length > 0,
        envioFlujo: acciones.some((accion) => accion.tipo === "flujo"),
        mensajesEnviados: delBot.length,
        reglaId: regla?.id ?? null,
        reglaNombre: regla?.nombre ?? null,
        cuando: (ultimoDelCliente?.createdAt ?? m.createdAt).toISOString(),
      },
      atendido: true,
      mensajeCliente: delCliente.map((x) => x.transcripcion || x.content || "").join("\n"),
      tipoMensaje: ultimoDelCliente?.type ?? "TEXT",
      claveProducto,
      origen: ORIGEN_RELLENO,
      idDelTurno: m.id,
      incluirSenales: false, // ya salieron por mensaje, arriba
    })) {
      salida.push(ev);
    }
    estado = despues;
    if (delBot.length) botHablo = true;
    ultimoCorte = m.createdAt;
  }

  // VENTA: el contacto quedó en Ganado con su cotización de Gestión.
  if (contacto?.crmStage === "GANADO" && contacto.wonQuoteRef) {
    salida.push({
      tipo: "VENTA",
      origen: ORIGEN_RELLENO,
      claveUnica: `VENTA:${id}:${contacto.wonQuoteRef}`,
      createdAt: contacto.wonAt ?? mensajes[mensajes.length - 1].createdAt,
      datos: { cotizacion: contacto.wonQuoteRef },
    });
  }
  return salida;
}

/**
 * Desde que el registro en vivo empezó a anotar un chat, solo se rellena lo que tiene la MISMA
 * claveUnica que en vivo (se descarta solo si ya está). Lo demás (TURNO, ESCALADO, ASIGNADA...)
 * en vivo no lleva clave y quedaría repetido.
 */
export function filtrarContraEnVivo(eventos: EventoDelEmbudo[], vivoDesde: Date | null): EventoDelEmbudo[] {
  if (!vivoDesde) return eventos;
  return eventos.filter(
    (ev) => (ev.createdAt ?? new Date()).getTime() < vivoDesde.getTime() || CLAVES_COMO_EN_VIVO.test(ev.claveUnica ?? ""),
  );
}

/* ------------------------------------------------------------------ resumen */

export type ResumenDelEmbudo = {
  leads: number;
  combo: number;
  bienvenida: number;
  respondio: number;
  identificacion: number;
  recomendacion: number;
  senal: number;
  asesora: number;
  venta: number;
};

export const resumenVacio = (): ResumenDelEmbudo => ({
  leads: 0,
  combo: 0,
  bienvenida: 0,
  respondio: 0,
  identificacion: 0,
  recomendacion: 0,
  senal: 0,
  asesora: 0,
  venta: 0,
});

/** Suma un chat al resumen (cuenta si llegó alguna vez) y a los conteos por tipo. */
export function sumarChat(resumen: ResumenDelEmbudo, porTipo: Record<string, number>, eventos: EventoDelEmbudo[]): void {
  for (const ev of eventos) porTipo[ev.tipo] = (porTipo[ev.tipo] ?? 0) + 1;
  const tipos = new Set(eventos.map((ev) => `${ev.tipo}:${ev.paso ?? ""}`));
  const alguno = (prefijo: string) => [...tipos].some((t) => t.startsWith(prefijo));
  const entrada = eventos.find((ev) => ev.tipo === "ENTRADA");
  resumen.leads += 1;
  if (entrada?.producto === CLAVE_COMBO) resumen.combo += 1;
  if (alguno("BIENVENIDA_ENVIADA")) resumen.bienvenida += 1;
  if (tipos.has("CLIENTE_RESPONDIO:PRESENTACION")) resumen.respondio += 1;
  if (tipos.has("CLIENTE_RESPONDIO:IDENTIFICACION")) resumen.identificacion += 1;
  if (alguno("RECOMENDACION_ENVIADA")) resumen.recomendacion += 1;
  if (alguno("SENAL")) resumen.senal += 1;
  if (alguno("ESCALADO") || alguno("ASIGNADA")) resumen.asesora += 1;
  if (alguno("VENTA")) resumen.venta += 1;
}
