import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";
import { nombreDelMotivo } from "@/features/seguimiento-inteligente/dominio/motivos-de-tarea";

/**
 * MAPA DEL LEAD: la foto 360° de UN cliente, como un grafo (Alex, 13-10-2026).
 *
 * Al centro el cliente; alrededor sus conversaciones, la cadena de etapas del CRM, el paso del
 * bot V3, los seguimientos, las automatizaciones, las tareas de la asesora, las llamadas y las
 * cotizaciones. Solo lectura.
 *
 * Este archivo es PURO (sin base, sin React): recibe lo que leyó el servidor y devuelve nodos,
 * aristas y posiciones fijas. Sin física: el mismo lead se dibuja siempre igual.
 *
 *   - Arriba, la cadena de etapas (hecha en verde, la actual en naranja, las que faltan en gris).
 *   - A la derecha, una franja por conversación; en la franja, columnas por tipo (bot, seguimientos,
 *     automatizaciones, tareas, cotizaciones).
 *   - A la izquierda, lo que es del cliente y no de un chat (llamadas, cotización ganada,
 *     seguimientos sin chat de su línea).
 *   - Cada grupo muestra hasta `limitePorGrupo` y el resto en un nodo "+N más" que se abre al tocarlo.
 *
 * Pruebas: npm run test:mapa-lead
 */

/* ================================================================================================
   ENTRADA (lo que lee el servidor; fechas en ISO para que viaje igual por la server action)
================================================================================================ */

export type EmbudoDelChat = {
  pasoActual: string | null;
  pasoMaximo: string | null;
  producto: string | null;
  temperatura: string | null;
  accion: string | null;
  motivo: string | null;
  tareaVence: string | null;
  tareaPrioridad: string | null;
  cotizacionRef: string | null;
  cotizacionEn: string | null;
  ventaEn: string | null;
};

export type ConversacionDelLead = {
  id: string;
  /** "agent:<id>" o "official:<id>": lo que abre el chat en la bandeja. */
  chatKey: string;
  canal: "agent" | "official";
  canalId: string | null;
  linea: string | null;
  estado: string;
  ultimoMensajeEn: string | null;
  /** Último mensaje del cliente en este chat (para "respondió"). */
  ultimoClienteEn: string | null;
  asesora: string | null;
  productoActivo: string | null;
  embudo: EmbudoDelChat | null;
};

export type SeguimientoDelLead = {
  id: string;
  nombre: string | null;
  estado: string;
  canalId: string | null;
  programadoPara: string;
  ejecutadoEn: string | null;
  canceladoEn: string | null;
  error: string | null;
  contenido: string | null;
};

export type NotaDelChat = { conversationId: string; en: string; texto: string | null };

export type LlamadaDelLead = {
  id: string;
  intento: number;
  en: string;
  resultado: string;
  resumen: string | null;
  quien: string | null;
  proximoContactoEn: string | null;
};

export type DatosDelLead = {
  contacto: {
    id: string;
    nombre: string | null;
    telefono4: string | null;
    etapa: string;
    motivoDescarte: string | null;
    ganadoEn: string | null;
    cotizacionGanada: string | null;
    creadoEn: string;
  };
  /** Las más recientes primero. */
  conversaciones: ConversacionDelLead[];
  /** Notas de sistema "… cambió/movió la etapa a "X"". */
  cambiosDeEtapa: NotaDelChat[];
  /** Notas de sistema de las automatizaciones ("⚙️ Automatización «X» …"). */
  notasDeAutomatizacion: NotaDelChat[];
  seguimientos: SeguimientoDelLead[];
  /** Recordatorios del bot V3 (mensajes con rawPayload.source = "agente-v3-seguimiento"). */
  recordatoriosBot: NotaDelChat[];
  llamadas: LlamadaDelLead[];
};

/* ================================================================================================
   SALIDA
================================================================================================ */

export const TIPOS = ["conversacion", "etapa", "bot", "seguimiento", "automatizacion", "tarea", "llamada", "cotizacion"] as const;
export type TipoFiltrable = (typeof TIPOS)[number];
export type TipoDeNodo = "cliente" | TipoFiltrable | "mas";

/** Colores de la leyenda (borde y punto). Los nodos de etapa además se pintan por estado. */
export const LEYENDA: Record<TipoFiltrable, { nombre: string; color: string }> = {
  conversacion: { nombre: "Conversaciones", color: "#2563eb" },
  etapa: { nombre: "Etapas", color: "#16a34a" },
  bot: { nombre: "Bot V3", color: "#7c3aed" },
  seguimiento: { nombre: "Seguimientos", color: "#0891b2" },
  automatizacion: { nombre: "Automatizaciones", color: "#db2777" },
  tarea: { nombre: "Tareas", color: "#dc2626" },
  llamada: { nombre: "Llamadas", color: "#059669" },
  cotizacion: { nombre: "Cotizaciones", color: "#ca8a04" },
};

export type EstadoDeNodo = "hecho" | "actual" | "pendiente" | "programado" | "enviado" | "cancelado" | "fallo" | "vencida" | "normal";

export type FilaDeDetalle = { etiqueta: string; valor: string };

export type DetalleDeNodo = {
  titulo: string;
  filas: FilaDeDetalle[];
  texto?: string | null;
  /** Solo en conversaciones: abre el chat. */
  chatKey?: string;
};

export type NodoDelMapa = {
  id: string;
  tipo: TipoDeNodo;
  x: number;
  y: number;
  titulo: string;
  subtitulo: string | null;
  estado: EstadoDeNodo;
  /** "respondió", "vencida"… */
  insignia: string | null;
  detalle: DetalleDeNodo | null;
  /** Nodo "+N más": qué grupo abre y cuántos esconde. */
  grupo?: string;
  restantes?: number;
};

export type AristaDelMapa = { id: string; desde: string; hasta: string; punteada: boolean };

export type MapaDelLead = {
  nodos: NodoDelMapa[];
  aristas: AristaDelMapa[];
  /** Cuántos hay de cada tipo (sin filtrar ni recortar): para los chips. */
  conteos: Record<TipoFiltrable, number>;
};

export type OpcionesDelMapa = {
  ahora: Date;
  ocultos?: ReadonlySet<TipoFiltrable>;
  /** Grupos abiertos con "+N más". */
  expandidos?: ReadonlySet<string>;
  limitePorGrupo?: number;
  /** Días hacia atrás de seguimientos y recordatorios (los pendientes salen siempre). */
  diasDeSeguimientos?: number;
};

/* ================================================================================================
   DICCIONARIOS
================================================================================================ */

/** Orden de la cadena. GANADO y PERDIDO son las dos salidas de NEGOCIACION. */
export const ETAPAS_DEL_MAPA = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"] as const;
const LINEAL = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO"];

/** Como la bandeja: Frio / Tibio / Caliente / Ganado / Descartado. NUEVO se ve "---": acá "Sin etapa". */
export function nombreDeEtapa(etapa: string | null | undefined): string {
  if (!etapa) return "Sin etapa";
  if (etapa === "NUEVO") return "Sin etapa";
  return (CRM_STAGE_META as Record<string, { label: string } | undefined>)[etapa]?.label ?? etapa;
}

/** Copia local de los pasos del libro V3 (no se importa del agente para no arrastrar su motor). */
const PASOS_V3: Record<string, string> = {
  PRESENTACION: "Bienvenida",
  IDENTIFICACION: "Identificación",
  PRODUCTO: "Presentación del producto",
  OBJECIONES: "Dudas y objeciones",
  CIERRE: "Cierre",
};

export function nombreDePaso(paso: string | null | undefined): string {
  if (!paso) return "Sin paso";
  return PASOS_V3[paso] ?? paso;
}

export function nombreDeTemperatura(t: string | null | undefined): string | null {
  if (!t) return null;
  const v = t.trim().toUpperCase();
  if (v === "FRIO") return "Frío";
  if (v === "TIBIO") return "Tibio";
  if (v === "CALIENTE") return "Caliente";
  return t;
}

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** "Fulana cambió la etapa a "Tibio" (motivo: …)" → "PROPUESTA". También acepta el valor crudo. */
export function etapaDeLaNota(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = /etapa a\s+"?([^"(]+?)"?\s*(?:\(|$)/i.exec(texto.trim());
  if (!m) return null;
  const buscado = sinAcentos(m[1]);
  for (const etapa of ETAPAS_DEL_MAPA) {
    const meta = (CRM_STAGE_META as Record<string, { label: string } | undefined>)[etapa];
    if (sinAcentos(etapa) === buscado || (meta && sinAcentos(meta.label) === buscado)) return etapa;
  }
  if (buscado === "nuevo" || buscado === "---" || buscado === "sin etapa") return "NUEVO";
  return null;
}

export type ClaseDeSeguimiento = "tras_asesora" | "etapa" | "inteligente" | "campana" | "automatizacion" | "bot" | "otro";

export const NOMBRE_DE_CLASE: Record<ClaseDeSeguimiento, string> = {
  tras_asesora: "Tras asesora",
  etapa: "Por etapa",
  inteligente: "Inteligente",
  campana: "Campaña",
  automatizacion: "Automatización",
  bot: "Recordatorio del bot",
  otro: "Otro",
};

/** Por el prefijo del nombre del Follow (ver recuperacion/dominio/semana.ts y automatizaciones). */
export function claseDelFollow(nombre: string | null | undefined): ClaseDeSeguimiento {
  const n = sinAcentos(nombre ?? "");
  if (n.startsWith("tras asesora")) return "tras_asesora";
  if (n.startsWith("etapa")) return "etapa";
  if (n.startsWith("inteligente")) return "inteligente";
  if (n.startsWith("campana")) return "campana";
  if (n.startsWith("automatizacion")) return "automatizacion";
  return "otro";
}

/** "Automatización: Reactivar tibios #ab12cd" → "Reactivar tibios". */
export function nombreDeAutomatizacion(nombreDelFollow: string | null | undefined): string {
  const limpio = (nombreDelFollow ?? "").replace(/^\s*automatizaci[oó]n:\s*/i, "").replace(/\s*#[0-9a-z]{4,}\s*$/i, "").trim();
  return limpio || "Automatización";
}

/** "⚙️ Automatización «Reactivar» (Ana): …" → "Reactivar". */
function nombreEnLaNota(texto: string | null): string {
  const m = /«([^»]+)»/.exec(texto ?? "");
  return m ? m[1].trim() : "Automatización";
}

export function telefonoEnmascarado(ultimos: string | null | undefined): string {
  const digitos = (ultimos ?? "").replace(/\D/g, "").slice(-4);
  return digitos.length === 4 ? `•••• ${digitos}` : "••••";
}

const FORMATO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function fecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : FORMATO.format(d);
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function recortar(texto: string | null | undefined, max = 60): string | null {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/* ================================================================================================
   GEOMETRÍA (fija)
================================================================================================ */

export const ANCHO_NODO = 210;
export const ALTO_NODO = 64;
const PASO_X = 250;
const PASO_Y = 82;
const X_CONVERSACIONES = 340;
const Y_INICIO = -40;
const ESPACIO_ENTRE_FRANJAS = 40;
const Y_ETAPAS = -230;

/** Orden fijo de las columnas a la derecha de cada conversación. */
const COLUMNAS_DEL_CHAT: TipoFiltrable[] = ["bot", "seguimiento", "automatizacion", "tarea", "cotizacion"];
/** Orden fijo de las columnas a la izquierda del cliente. */
const COLUMNAS_DEL_CLIENTE: TipoFiltrable[] = ["llamada", "cotizacion", "seguimiento", "automatizacion"];

/* ================================================================================================
   ARMADO
================================================================================================ */

type Item = {
  id: string;
  tipo: TipoFiltrable;
  /** id de la conversación, o "cliente". */
  padre: string;
  /** Sub-grupo dentro de la columna (clase del seguimiento). */
  subgrupo: string;
  /** Para ordenar: los pendientes primero, después lo más reciente. */
  orden: number;
  titulo: string;
  subtitulo: string | null;
  estado: EstadoDeNodo;
  insignia: string | null;
  detalle: DetalleDeNodo;
};

export function armarMapaDelLead(datos: DatosDelLead, opciones: OpcionesDelMapa): MapaDelLead {
  const ahora = opciones.ahora.getTime();
  const ocultos = opciones.ocultos ?? new Set<TipoFiltrable>();
  const expandidos = opciones.expandidos ?? new Set<string>();
  const limite = Math.max(1, opciones.limitePorGrupo ?? 4);
  const desde = ahora - (opciones.diasDeSeguimientos ?? 30) * 86_400_000;

  const conteos = Object.fromEntries(TIPOS.map((t) => [t, 0])) as Record<TipoFiltrable, number>;
  const nodos: NodoDelMapa[] = [];
  const aristas: AristaDelMapa[] = [];
  const conversaciones = datos.conversaciones;
  const idsDeChats = new Set(conversaciones.map((c) => c.id));

  /* ---- Último mensaje del cliente: por chat y en total (para "respondió"). ---- */
  const ultimoCliente = new Map<string, number>();
  let ultimoClienteTotal = 0;
  for (const c of conversaciones) {
    const t = ms(c.ultimoClienteEn) ?? 0;
    ultimoCliente.set(c.id, t);
    ultimoClienteTotal = Math.max(ultimoClienteTotal, t);
  }
  const respondioDespues = (padre: string, en: number | null) => {
    if (en === null) return false;
    const ultimo = padre === "cliente" ? ultimoClienteTotal : (ultimoCliente.get(padre) ?? 0);
    return ultimo > en;
  };

  /* ---- Cliente ---- */
  const masReciente = conversaciones[0] ?? null;
  const temperatura = nombreDeTemperatura(conversaciones.find((c) => c.embudo?.temperatura)?.embudo?.temperatura ?? null);
  const asesora = conversaciones.find((c) => c.asesora)?.asesora ?? null;
  const etapaActual = (ETAPAS_DEL_MAPA as readonly string[]).includes(datos.contacto.etapa) ? datos.contacto.etapa : "NUEVO";
  const quien = datos.contacto.nombre?.trim() || telefonoEnmascarado(datos.contacto.telefono4);
  nodos.push({
    id: "cliente",
    tipo: "cliente",
    x: 0,
    y: 0,
    titulo: quien,
    subtitulo: [nombreDeEtapa(etapaActual), temperatura, asesora].filter(Boolean).join(" · "),
    estado: "normal",
    insignia: null,
    detalle: {
      titulo: quien,
      filas: [
        { etiqueta: "Teléfono", valor: telefonoEnmascarado(datos.contacto.telefono4) },
        { etiqueta: "Etapa", valor: nombreDeEtapa(etapaActual) },
        { etiqueta: "Temperatura", valor: temperatura ?? "—" },
        { etiqueta: "Asesora", valor: asesora ?? "Sin asignar" },
        { etiqueta: "Línea", valor: masReciente?.linea ?? "—" },
        { etiqueta: "Llegó", valor: fecha(datos.contacto.creadoEn) },
        ...(datos.contacto.motivoDescarte ? [{ etiqueta: "Motivo de descarte", valor: datos.contacto.motivoDescarte }] : []),
        ...(datos.contacto.ganadoEn ? [{ etiqueta: "Ganado", valor: fecha(datos.contacto.ganadoEn) }] : []),
      ],
    },
  });

  /* ---- Cadena de etapas ---- */
  const historial = [...datos.cambiosDeEtapa]
    .map((n) => ({ ...n, etapa: etapaDeLaNota(n.texto), t: ms(n.en) ?? 0 }))
    .filter((n) => n.etapa)
    .sort((a, b) => a.t - b.t);
  const alcanzadas = new Set<string>(historial.map((h) => h.etapa as string));
  conteos.etapa = ETAPAS_DEL_MAPA.length;
  if (!ocultos.has("etapa")) {
    const idxActual = LINEAL.indexOf(etapaActual);
    ETAPAS_DEL_MAPA.forEach((etapa, i) => {
      let estado: EstadoDeNodo;
      if (etapa === etapaActual) estado = "actual";
      else if (etapaActual === "PERDIDO") estado = etapa === "NUEVO" || alcanzadas.has(etapa) ? (etapa === "GANADO" ? "pendiente" : "hecho") : "pendiente";
      else if (etapa === "PERDIDO") estado = "pendiente";
      else estado = LINEAL.indexOf(etapa) < idxActual ? "hecho" : "pendiente";
      const veces = historial.filter((h) => h.etapa === etapa);
      const x = -520 + Math.min(i, 4) * 190;
      const y = etapa === "GANADO" ? Y_ETAPAS - 50 : etapa === "PERDIDO" ? Y_ETAPAS + 50 : Y_ETAPAS;
      nodos.push({
        id: `etapa:${etapa}`,
        tipo: "etapa",
        x,
        y,
        titulo: nombreDeEtapa(etapa),
        subtitulo: estado === "actual" ? "Actual" : estado === "hecho" ? "Pasó" : veces.length ? "Estuvo aquí" : null,
        estado,
        insignia: null,
        detalle: {
          titulo: `Etapa: ${nombreDeEtapa(etapa)}`,
          filas: [
            { etiqueta: "Estado", valor: estado === "actual" ? "Actual" : estado === "hecho" ? "Superada" : "No alcanzada" },
            ...veces.map((v) => ({ etiqueta: fecha(v.en), valor: recortar(v.texto, 90) ?? "" })),
          ],
          texto: veces.length ? null : estado === "hecho" ? "Sin nota de cuándo pasó (cambio anterior al registro o hecho por el sistema)." : null,
        },
      });
    });
    const unir = (a: string, b: string) => aristas.push({ id: `e:etapa:${a}-${b}`, desde: `etapa:${a}`, hasta: `etapa:${b}`, punteada: false });
    unir("NUEVO", "CALIFICADO");
    unir("CALIFICADO", "PROPUESTA");
    unir("PROPUESTA", "NEGOCIACION");
    unir("NEGOCIACION", "GANADO");
    unir("NEGOCIACION", "PERDIDO");
    aristas.push({ id: "e:cliente-etapa", desde: "cliente", hasta: `etapa:${etapaActual}`, punteada: true });
  }

  /* ---- Items (todo lo que cuelga de un chat o del cliente) ---- */
  const items: Item[] = [];
  const padreDeCanal = (canalId: string | null): string => {
    if (canalId) {
      const chat = conversaciones.find((c) => c.canalId === canalId);
      if (chat) return chat.id;
    }
    return conversaciones.length === 1 ? conversaciones[0].id : "cliente";
  };
  const padreDeChat = (conversationId: string) => (idsDeChats.has(conversationId) ? conversationId : "cliente");

  for (const c of conversaciones) {
    const e = c.embudo;
    const producto = e?.producto ?? c.productoActivo;
    if (e || c.productoActivo) {
      items.push({
        id: `bot:${c.id}`,
        tipo: "bot",
        padre: c.id,
        subgrupo: "bot",
        orden: 0,
        titulo: e?.pasoActual ? `Bot: ${nombreDePaso(e.pasoActual)}` : "Bot V3",
        subtitulo: producto ?? "Sin producto",
        estado: e?.pasoActual === "CIERRE" ? "hecho" : "normal",
        insignia: null,
        detalle: {
          titulo: "Bot V3",
          filas: [
            { etiqueta: "Paso actual", valor: nombreDePaso(e?.pasoActual) },
            { etiqueta: "Paso más alto", valor: nombreDePaso(e?.pasoMaximo) },
            { etiqueta: "Producto", valor: producto ?? "—" },
            { etiqueta: "Temperatura", valor: nombreDeTemperatura(e?.temperatura) ?? "—" },
            { etiqueta: "Siguiente acción", valor: e?.accion ? e.accion.replace(/_/g, " ") : "—" },
          ],
        },
      });
    }
    if (e?.accion === "tarea_asesora") {
      const vence = ms(e.tareaVence);
      const vencida = vence !== null && vence <= ahora;
      items.push({
        id: `tarea:${c.id}`,
        tipo: "tarea",
        padre: c.id,
        subgrupo: "tarea",
        orden: 0,
        titulo: nombreDelMotivo(e.motivo),
        subtitulo: e.tareaVence ? `${vencida ? "Venció" : "Vence"} ${fecha(e.tareaVence)}` : "Sin vencimiento",
        estado: vencida ? "vencida" : "programado",
        insignia: vencida ? "vencida" : null,
        detalle: {
          titulo: "Tarea de la asesora",
          filas: [
            { etiqueta: "Motivo", valor: nombreDelMotivo(e.motivo) },
            { etiqueta: "Vence", valor: fecha(e.tareaVence) },
            { etiqueta: "Prioridad", valor: e.tareaPrioridad ?? "—" },
            { etiqueta: "Asesora", valor: c.asesora ?? "Sin asignar" },
          ],
        },
      });
    }
    if (e?.cotizacionRef) {
      items.push({
        id: `cotizacion:${c.id}`,
        tipo: "cotizacion",
        padre: c.id,
        subgrupo: "cotizacion",
        orden: -(ms(e.cotizacionEn) ?? 0),
        titulo: e.cotizacionRef,
        subtitulo: e.ventaEn ? `Venta ${fecha(e.ventaEn)}` : `Cotizada ${fecha(e.cotizacionEn)}`,
        estado: e.ventaEn ? "hecho" : "normal",
        insignia: null,
        detalle: {
          titulo: `Cotización ${e.cotizacionRef}`,
          filas: [
            { etiqueta: "Enviada", valor: fecha(e.cotizacionEn) },
            { etiqueta: "Venta", valor: e.ventaEn ? fecha(e.ventaEn) : "—" },
          ],
        },
      });
    }
  }
  const cotizacionesDeChats = new Set(conversaciones.map((c) => c.embudo?.cotizacionRef).filter(Boolean));
  if (datos.contacto.cotizacionGanada && !cotizacionesDeChats.has(datos.contacto.cotizacionGanada)) {
    items.push({
      id: "cotizacion:ganada",
      tipo: "cotizacion",
      padre: "cliente",
      subgrupo: "cotizacion",
      orden: 0,
      titulo: datos.contacto.cotizacionGanada,
      subtitulo: datos.contacto.ganadoEn ? `Ganada ${fecha(datos.contacto.ganadoEn)}` : "Ganada",
      estado: "hecho",
      insignia: null,
      detalle: {
        titulo: `Cotización ${datos.contacto.cotizacionGanada}`,
        filas: [{ etiqueta: "Ganada", valor: fecha(datos.contacto.ganadoEn) }],
      },
    });
  }

  /* Seguimientos (Follow) de los últimos N días + los pendientes. */
  for (const s of datos.seguimientos) {
    const programado = ms(s.programadoPara) ?? 0;
    const pasado = ms(s.ejecutadoEn) ?? ms(s.canceladoEn) ?? programado;
    if (s.estado !== "PENDING" && pasado < desde) continue;
    const clase = claseDelFollow(s.nombre);
    const esAutomatizacion = clase === "automatizacion";
    const padre = padreDeCanal(s.canalId);
    const enviado = s.estado === "EXECUTED";
    const respondio = enviado && respondioDespues(padre, ms(s.ejecutadoEn));
    const estado: EstadoDeNodo =
      s.estado === "PENDING" ? "programado" : enviado ? "enviado" : s.estado === "CANCELLED" ? "cancelado" : s.estado === "FAILED" ? "fallo" : "normal";
    const cuando =
      s.estado === "PENDING"
        ? `Programado ${fecha(s.programadoPara)}`
        : enviado
          ? `Enviado ${fecha(s.ejecutadoEn)}`
          : s.estado === "CANCELLED"
            ? `Cancelado ${fecha(s.canceladoEn)}`
            : `Falló ${fecha(s.ejecutadoEn ?? s.programadoPara)}`;
    items.push({
      id: `seguimiento:${s.id}`,
      tipo: esAutomatizacion ? "automatizacion" : "seguimiento",
      padre,
      subgrupo: clase,
      orden: s.estado === "PENDING" ? -1e15 + programado : -pasado,
      titulo: esAutomatizacion ? nombreDeAutomatizacion(s.nombre) : NOMBRE_DE_CLASE[clase],
      subtitulo: cuando,
      estado,
      insignia: respondio ? "respondió" : null,
      detalle: {
        titulo: s.nombre?.trim() || NOMBRE_DE_CLASE[clase],
        filas: [
          { etiqueta: "Tipo", valor: NOMBRE_DE_CLASE[clase] },
          { etiqueta: "Estado", valor: { PENDING: "Pendiente", EXECUTED: "Enviado", CANCELLED: "Cancelado", FAILED: "Falló" }[s.estado] ?? s.estado },
          { etiqueta: "Programado", valor: fecha(s.programadoPara) },
          ...(s.ejecutadoEn ? [{ etiqueta: "Enviado", valor: fecha(s.ejecutadoEn) }] : []),
          ...(s.canceladoEn ? [{ etiqueta: "Cancelado", valor: fecha(s.canceladoEn) }] : []),
          ...(s.estado === "CANCELLED" || s.estado === "FAILED" ? [{ etiqueta: "Motivo", valor: s.error?.trim() || "Sin motivo guardado" }] : []),
          ...(enviado ? [{ etiqueta: "Cliente", valor: respondio ? "Respondió después" : "No ha respondido" }] : []),
        ],
        texto: s.contenido,
      },
    });
  }

  /* Recordatorios del bot V3 (no son Follow: son mensajes). */
  for (const r of datos.recordatoriosBot) {
    const en = ms(r.en) ?? 0;
    if (en < desde) continue;
    const padre = padreDeChat(r.conversationId);
    const respondio = respondioDespues(padre, en);
    items.push({
      id: `recordatorio:${r.conversationId}:${r.en}`,
      tipo: "seguimiento",
      padre,
      subgrupo: "bot",
      orden: -en,
      titulo: NOMBRE_DE_CLASE.bot,
      subtitulo: `Enviado ${fecha(r.en)}`,
      estado: "enviado",
      insignia: respondio ? "respondió" : null,
      detalle: {
        titulo: NOMBRE_DE_CLASE.bot,
        filas: [
          { etiqueta: "Enviado", valor: fecha(r.en) },
          { etiqueta: "Cliente", valor: respondio ? "Respondió después" : "No ha respondido" },
        ],
        texto: r.texto,
      },
    });
  }

  /* Notas de automatizaciones (lo que hizo la automatización sobre el chat). */
  for (const n of datos.notasDeAutomatizacion) {
    const en = ms(n.en) ?? 0;
    items.push({
      id: `nota:${n.conversationId}:${n.en}`,
      tipo: "automatizacion",
      padre: padreDeChat(n.conversationId),
      subgrupo: "nota",
      orden: -en,
      titulo: nombreEnLaNota(n.texto),
      subtitulo: `Actuó ${fecha(n.en)}`,
      estado: "hecho",
      insignia: null,
      detalle: { titulo: `Automatización «${nombreEnLaNota(n.texto)}»`, filas: [{ etiqueta: "Cuándo", valor: fecha(n.en) }], texto: n.texto },
    });
  }

  /* Llamadas (del cliente, no de un chat). */
  for (const l of datos.llamadas) {
    items.push({
      id: `llamada:${l.id}`,
      tipo: "llamada",
      padre: "cliente",
      subgrupo: "llamada",
      orden: -(ms(l.en) ?? 0),
      titulo: `Llamada #${l.intento}`,
      subtitulo: `${l.resultado} · ${fecha(l.en)}`,
      estado: /no contest|buz|apagad|ocupad/i.test(l.resultado) ? "cancelado" : "hecho",
      insignia: null,
      detalle: {
        titulo: `Llamada #${l.intento}`,
        filas: [
          { etiqueta: "Cuándo", valor: fecha(l.en) },
          { etiqueta: "Resultado", valor: l.resultado },
          { etiqueta: "Quién llamó", valor: l.quien ?? "—" },
          ...(l.proximoContactoEn ? [{ etiqueta: "Volver a llamar", valor: fecha(l.proximoContactoEn) }] : []),
        ],
        texto: l.resumen,
      },
    });
  }

  conteos.conversacion = conversaciones.length;
  for (const it of items) conteos[it.tipo] += 1;

  /* ---- Recorte por grupo: hasta `limite`, el resto en "+N más" ---- */
  type Columna = { tipo: TipoFiltrable; nodos: NodoDelMapa[] };
  const columnasDe = (padre: string, orden: TipoFiltrable[]): Columna[] => {
    const salida: Columna[] = [];
    for (const tipo of orden) {
      if (ocultos.has(tipo)) continue;
      const delTipo = items.filter((it) => it.padre === padre && it.tipo === tipo);
      if (!delTipo.length) continue;
      const subgrupos = [...new Set(delTipo.map((it) => it.subgrupo))].sort();
      const lista: NodoDelMapa[] = [];
      for (const sub of subgrupos) {
        const grupo = `${padre}|${tipo}|${sub}`;
        const delSub = delTipo.filter((it) => it.subgrupo === sub).sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));
        const abierto = expandidos.has(grupo);
        const visibles = abierto ? delSub : delSub.slice(0, limite);
        for (const it of visibles) {
          lista.push({ id: it.id, tipo: it.tipo, x: 0, y: 0, titulo: it.titulo, subtitulo: it.subtitulo, estado: it.estado, insignia: it.insignia, detalle: it.detalle });
        }
        if (!abierto && delSub.length > limite) {
          const restantes = delSub.length - limite;
          lista.push({
            id: `mas:${grupo}`,
            tipo: "mas",
            x: 0,
            y: 0,
            titulo: `+${restantes} más`,
            subtitulo: tipo === "seguimiento" || tipo === "automatizacion" ? NOMBRE_DE_CLASE[sub as ClaseDeSeguimiento] ?? null : LEYENDA[tipo].nombre,
            estado: "normal",
            insignia: null,
            detalle: null,
            grupo,
            restantes,
          });
        }
      }
      salida.push({ tipo, nodos: lista });
    }
    return salida;
  };

  /* ---- Posiciones: franjas de conversaciones a la derecha ---- */
  let y = Y_INICIO;
  const mostrarChats = !ocultos.has("conversacion");
  for (const c of conversaciones) {
    const columnas = columnasDe(c.id, COLUMNAS_DEL_CHAT);
    const alto = Math.max(1, ...columnas.map((col) => col.nodos.length));
    const centro = y + ((alto - 1) * PASO_Y) / 2;
    if (mostrarChats) {
      nodos.push({
        id: c.id,
        tipo: "conversacion",
        x: X_CONVERSACIONES,
        y: centro,
        titulo: c.linea ?? (c.canal === "official" ? "API oficial" : "WhatsApp"),
        subtitulo: `${nombreDeEstado(c.estado)} · ${fecha(c.ultimoMensajeEn)}`,
        estado: c.estado === "OPEN" || c.estado === "PENDING" ? "actual" : "normal",
        insignia: null,
        detalle: {
          titulo: `Conversación · ${c.linea ?? "WhatsApp"}`,
          filas: [
            { etiqueta: "Estado", valor: nombreDeEstado(c.estado) },
            { etiqueta: "Último mensaje", valor: fecha(c.ultimoMensajeEn) },
            { etiqueta: "Último del cliente", valor: fecha(c.ultimoClienteEn) },
            { etiqueta: "Asesora", valor: c.asesora ?? "Sin asignar" },
            { etiqueta: "Canal", valor: c.canal === "official" ? "API oficial" : "WhatsApp" },
          ],
          chatKey: c.chatKey,
        },
      });
      aristas.push({ id: `e:cliente-${c.id}`, desde: "cliente", hasta: c.id, punteada: false });
    }
    columnas.forEach((col, i) => {
      col.nodos.forEach((n, j) => {
        n.x = X_CONVERSACIONES + (i + 1) * PASO_X;
        n.y = y + j * PASO_Y;
        nodos.push(n);
        aristas.push({ id: `e:${c.id}-${n.id}`, desde: mostrarChats ? c.id : "cliente", hasta: n.id, punteada: n.tipo === "mas" });
      });
    });
    y += alto * PASO_Y + ESPACIO_ENTRE_FRANJAS;
  }

  /* ---- Lo del cliente, a la izquierda ---- */
  columnasDe("cliente", COLUMNAS_DEL_CLIENTE).forEach((col, i) => {
    col.nodos.forEach((n, j) => {
      n.x = -(i + 1) * PASO_X - 60;
      n.y = Y_INICIO + j * PASO_Y;
      nodos.push(n);
      aristas.push({ id: `e:cliente-${n.id}`, desde: "cliente", hasta: n.id, punteada: n.tipo === "mas" });
    });
  });

  return { nodos, aristas, conteos };
}

export function nombreDeEstado(estado: string): string {
  return { OPEN: "Abierta", PENDING: "Pendiente", CLOSED: "Resuelta", ARCHIVED: "Archivada" }[estado] ?? estado;
}
