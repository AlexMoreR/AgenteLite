/**
 * AGENTES DE ÁREA: las reglas, en código puro (sin base, sin Next).
 *
 * Es un molde: un agente por área (hoy "ventas", "marketing" y "sistemas") que piensa en el PC aizen1 y reparte el trabajo
 * a subagentes. El CRM no piensa: guarda el resumen, muestra la pantalla y entrega los WhatsApp
 * INTERNOS. Las pruebas están en scripts/check-agentes-de-area.mjs.
 */

export const AREAS = ["ventas", "marketing", "sistemas"] as const;
export type Area = (typeof AREAS)[number];

export const ETIQUETA_DE_AREA: Record<Area, string> = {
  ventas: "Agente de Ventas",
  marketing: "Agente de Marketing",
  sistemas: "Agente de Sistemas",
};

export function esArea(valor: unknown): valor is Area {
  return typeof valor === "string" && (AREAS as readonly string[]).includes(valor);
}

/** Interruptor: AppSetting `agente-area:<area>:<workspaceId>` = {"activo": true}. Sin fila = apagado. */
export const claveInterruptorDelAgente = (area: Area, workspaceId: string) => `agente-area:${area}:${workspaceId}`;

export function interpretarInterruptor(valor: string | null | undefined): boolean {
  if (!valor) return false;
  const limpio = valor.trim().toLowerCase();
  if (limpio === "true" || limpio === "1" || limpio === "si" || limpio === "sí") return true;
  try {
    const leido = JSON.parse(valor) as { activo?: unknown } | boolean;
    if (typeof leido === "boolean") return leido;
    return Boolean(leido && typeof leido === "object" && leido.activo === true);
  } catch {
    return false;
  }
}

export type TipoDeEnvio = "ALEXANDER" | "ASESORA";
export type EstadoDeEnvio = "PENDIENTE" | "ENVIADO" | "BLOQUEADO" | "FALLIDO";

export const MAX_TEXTO_DEL_MENSAJE = 4000;

export const MOTIVO_NO_ES_DEL_EQUIPO = "ese número no es del equipo";
export const MOTIVO_INTERRUPTOR_APAGADO = "interruptor apagado: no se mandó";
export const MOTIVO_YA_SE_MANDO = "ya se le mandó hoy";
export const MOTIVO_SIN_LINEA = "sin línea interna (Admin) para mandar";

/** Solo dígitos; "+57 300 111 2233" → "573001112233". */
export function soloDigitos(valor: unknown): string {
  return typeof valor === "string" ? valor.replace(/\D/g, "") : "";
}

/** Un número celular colombiano de 10 dígitos que empieza en 3 se compara con el prefijo 57. */
export function numeroCanonico(valor: unknown): string {
  const digitos = soloDigitos(valor);
  if (digitos.length === 10 && digitos.startsWith("3")) return `57${digitos}`;
  return digitos;
}

export function esTipoDeEnvio(valor: unknown): valor is TipoDeEnvio {
  return valor === "ALEXANDER" || valor === "ASESORA";
}

export type PedidoDeEnvio = { tipo: TipoDeEnvio; numero: string; texto: string; destinatario: string | null };

/** Valida lo que manda el agente. Devuelve el pedido limpio o el error legible. */
export function leerPedidoDeEnvio(args: Record<string, unknown>): { ok: true; pedido: PedidoDeEnvio } | { ok: false; error: string } {
  const tipo = typeof args.tipo === "string" ? args.tipo.trim().toUpperCase() : "";
  if (!esTipoDeEnvio(tipo)) return { ok: false, error: 'El tipo tiene que ser "alexander" o "asesora".' };
  const numero = numeroCanonico(args.numero);
  if (numero.length < 10) return { ok: false, error: "Falta el número de WhatsApp (con indicativo, solo dígitos)." };
  const texto = typeof args.texto === "string" ? args.texto.trim() : "";
  if (!texto) return { ok: false, error: "Falta el texto del mensaje." };
  if (texto.length > MAX_TEXTO_DEL_MENSAJE) return { ok: false, error: `El mensaje pasa de ${MAX_TEXTO_DEL_MENSAJE} caracteres: hay que acortarlo.` };
  const destinatario = typeof args.destinatario === "string" && args.destinatario.trim() ? args.destinatario.trim().slice(0, 120) : null;
  return { ok: true, pedido: { tipo, numero, texto, destinatario } };
}

/** ¿Este número está en la lista del equipo (Mi empresa → Equipo)? Compara por número canónico. */
export function estaEnElEquipo(numero: string, equipo: Iterable<string>): boolean {
  const buscado = numeroCanonico(numero);
  if (!buscado) return false;
  for (const candidato of equipo) {
    if (numeroCanonico(candidato) === buscado) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
   RESUMEN DEL DÍA
------------------------------------------------------------------------------------------------ */

export const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function fechaValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !FECHA_ISO.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

/** El día de hoy en Colombia (sin horario de verano: desfase fijo de 5 h). */
export function hoyEnBogota(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export function diaAnterior(fecha: string): string {
  const base = new Date(`${fecha}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}

/** Un cliente sugerido a una asesora (para medirlo al día siguiente). */
export type Sugerido = { asesora: string; conversacionId: string | null; numero: string | null; cliente: string | null };

export type ResumenAGuardar = {
  fecha: string;
  esPrueba: boolean;
  salioTarde: boolean;
  notaDeRetraso: string | null;
  numeros: unknown;
  meta: unknown;
  subagentes: Record<string, unknown>;
  sugeridos: Sugerido[];
  mensajes: Array<{ tipo: TipoDeEnvio; numero: string; destinatario: string | null; texto: string }>;
  resumen: string | null;
};

const esObjeto = (valor: unknown): valor is Record<string, unknown> => Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

const textoCorto = (valor: unknown, max: number): string | null =>
  typeof valor === "string" && valor.trim() ? valor.trim().slice(0, max) : null;

/** Valida y limpia lo que manda el agente al guardar el resumen. Lanza un error legible si no sirve. */
export function leerResumenAGuardar(args: Record<string, unknown>, hoy: string, area: Area = "ventas"): ResumenAGuardar {
  const fecha = args.fecha === undefined || args.fecha === null || args.fecha === "" ? hoy : args.fecha;
  if (!fechaValida(fecha)) throw new Error("La fecha tiene que ir como AAAA-MM-DD.");
  const subagentes: Record<string, unknown> = {};
  if (args.subagentes !== undefined && args.subagentes !== null) {
    if (!esObjeto(args.subagentes)) throw new Error('"subagentes" tiene que ser un objeto: una clave por subagente (cerrador, cobrador, analista-de-perdidos).');
    for (const [nombre, entrega] of Object.entries(args.subagentes)) subagentes[nombre.slice(0, 60)] = entrega;
  }
  const sugeridos: Sugerido[] = [];
  if (Array.isArray(args.sugeridos)) {
    for (const crudo of args.sugeridos.slice(0, 200)) {
      if (!esObjeto(crudo)) continue;
      const asesora = textoCorto(crudo.asesora, 120);
      if (!asesora) continue;
      sugeridos.push({
        asesora,
        conversacionId: textoCorto(crudo.conversacionId, 64),
        numero: soloDigitos(crudo.numero) || null,
        cliente: textoCorto(crudo.cliente, 120),
      });
    }
  }
  const mensajes: ResumenAGuardar["mensajes"] = [];
  if (Array.isArray(args.mensajes)) {
    for (const crudo of args.mensajes.slice(0, 50)) {
      if (!esObjeto(crudo)) continue;
      const leido = leerPedidoDeEnvio(crudo);
      if (leido.ok) mensajes.push(leido.pedido);
    }
  }
  // Marketing nunca manda WhatsApp ni sugiere clientes: su línea y su recomendación viajan dentro de `meta`.
  let meta: unknown = args.meta ?? null;
  if (area === "marketing") {
    const linea = textoCorto(args.linea, 400);
    const recomendacion = leerRecomendacionDeMarketing(args.recomendacion);
    meta = { ...(esObjeto(args.meta) ? args.meta : {}), linea, recomendacion };
    sugeridos.length = 0;
    mensajes.length = 0;
  }
  // Sistemas tampoco manda WhatsApp: su línea, sus revisiones, la salud y las tarjetas de arreglo viajan dentro de `meta`.
  if (area === "sistemas") {
    meta = {
      ...(esObjeto(args.meta) ? args.meta : {}),
      linea: textoCorto(args.linea, 400),
      revisiones: leerRevisionesDeSistemas(args.revisiones),
      salud: args.salud ?? null,
      arreglos: leerArreglosDeSistemas(args.arreglos),
    };
    sugeridos.length = 0;
    mensajes.length = 0;
  }
  return {
    fecha,
    esPrueba: args.es_prueba === true,
    salioTarde: args.salio_tarde === true,
    notaDeRetraso: textoCorto(args.nota_de_retraso, 300),
    numeros: args.numeros ?? null,
    meta,
    subagentes,
    sugeridos,
    mensajes,
    resumen: textoCorto(args.resumen, 20_000),
  };
}

/* ------------------------------------------------------------------------------------------------
   MEDIR LOS SUGERIDOS DE AYER
------------------------------------------------------------------------------------------------ */

export type ActividadDelSugerido = {
  /** La asesora (o alguien del equipo) le escribió después de la hora de corte. */
  leEscribieron: boolean;
  /** El cliente mandó un mensaje después de eso. */
  respondio: boolean;
  /** El cliente quedó en etapa GANADO. */
  compro: boolean;
};

export type MedidaDeLosSugeridos = {
  sugeridos: number;
  leEscribieron: number;
  respondieron: number;
  compraron: number;
};

export function medirSugeridos(actividades: ActividadDelSugerido[]): MedidaDeLosSugeridos {
  return {
    sugeridos: actividades.length,
    leEscribieron: actividades.filter((a) => a.leEscribieron).length,
    respondieron: actividades.filter((a) => a.leEscribieron && a.respondio).length,
    compraron: actividades.filter((a) => a.compro).length,
  };
}

/** Tasa de cierre en porcentaje con un decimal; null si no hay chats. */
export function tasaDeCierre(ventas: number, chats: number): number | null {
  if (!Number.isFinite(ventas) || !Number.isFinite(chats) || chats <= 0) return null;
  return Math.round((ventas / chats) * 1000) / 10;
}

/* ------------------------------------------------------------------------------------------------
   AGENTE DE MARKETING: la recomendación, la línea para Alexander y el cruce por anuncio
------------------------------------------------------------------------------------------------ */

export const ACCIONES_DE_MARKETING = ["subir", "bajar", "cambiar"] as const;
export type AccionDeMarketing = (typeof ACCIONES_DE_MARKETING)[number];

export type RecomendacionDeMarketing = { accion: AccionDeMarketing; texto: string; dato: string };

/** Decisión del dueño: pausar una campaña para que "reaprenda" sube el costo. Nunca se recomienda. */
export const PAUSAR_PARA_REAPRENDER = /(paus|apag|detener|parar).{0,80}(reaprend|re-aprend|aprendizaje)|(reaprend|re-aprend).{0,80}(paus|apag|detener|parar)/i;

/**
 * Valida la recomendación del Agente de Marketing: MÁXIMO UNA, de subir, bajar o cambiar un anuncio, con el
 * dato que la sustenta, y jamás "pausar para que reaprenda". Lanza un error legible si no sirve.
 */
export function leerRecomendacionDeMarketing(valor: unknown): RecomendacionDeMarketing | null {
  if (valor === undefined || valor === null || valor === "") return null;
  if (Array.isArray(valor)) {
    if (valor.length > 1) throw new Error("Máximo UNA recomendación de marketing por día.");
    return leerRecomendacionDeMarketing(valor[0]);
  }
  if (!esObjeto(valor)) throw new Error('La recomendación tiene que ser un objeto: { accion: "subir"|"bajar"|"cambiar", texto, dato }.');
  const accion = typeof valor.accion === "string" ? valor.accion.trim().toLowerCase() : "";
  if (!(ACCIONES_DE_MARKETING as readonly string[]).includes(accion)) {
    throw new Error('La acción de la recomendación tiene que ser "subir", "bajar" o "cambiar" un anuncio (nunca pausar ni prender).');
  }
  const texto = textoCorto(valor.texto, 500);
  const dato = textoCorto(valor.dato, 500);
  if (!texto) throw new Error("Falta el texto de la recomendación.");
  if (!dato) throw new Error("La recomendación necesita el dato que la sustenta.");
  if (PAUSAR_PARA_REAPRENDER.test(`${texto} ${dato}`)) {
    throw new Error("No se recomienda pausar una campaña para que reaprenda: decisión del dueño, sube el costo.");
  }
  return { accion: accion as AccionDeMarketing, texto, dato };
}

/**
 * La línea de marketing que va en el mensaje de las 7:30 a Alexander. Null = no va nada (interruptor apagado).
 * Prendido: la línea del agente + su recomendación; si no corrió, "Marketing: sin resumen hoy".
 */
export function lineaDeMarketingParaAlexander(entrada: {
  interruptorPrendido: boolean;
  resumen: { linea: string | null; recomendacion: RecomendacionDeMarketing | null; salioTarde: boolean; notaDeRetraso: string | null } | null;
}): string | null {
  if (!entrada.interruptorPrendido) return null;
  const { resumen } = entrada;
  if (!resumen || !resumen.linea) return "Marketing: sin resumen hoy";
  const partes = [resumen.linea.startsWith("Marketing") ? resumen.linea : `Marketing: ${resumen.linea}`];
  if (resumen.recomendacion) partes.push(`Recomendación: ${resumen.recomendacion.texto} (${resumen.recomendacion.dato})`);
  if (resumen.salioTarde) partes.push(`(salió tarde${resumen.notaDeRetraso ? `: ${resumen.notaDeRetraso}` : ""})`);
  return partes.join(" ");
}

/** Una conversación nueva con su anuncio de origen (lo que sale de la base, ya plano). */
export type ConversacionDeAnuncio = {
  anuncioId: string | null;
  anuncioTitulo: string | null;
  /** Etapa que pone la asesora (CrmStage). */
  etapa: string;
  /** Temperatura que calcula el sistema (TIBIO, CALIENTE…). */
  temperatura: string | null;
  exterior: boolean;
  /** Minutos hasta la primera respuesta de la asesora; null = nadie respondió. */
  minutosPrimeraRespuesta: number | null;
};

export type NumerosDeAnuncio = {
  anuncioId: string | null;
  anuncioTitulo: string | null;
  conversaciones: number;
  /** La temperatura que calcula el sistema es Tibio o Caliente. */
  tibioOCaliente: number;
  /** La asesora la pasó a Propuesta, Negociación o Ganado. */
  etapaAvanzada: number;
  /** Cualquiera de las dos anteriores (sin contar dos veces). */
  conInteres: number;
  ventas: number;
  sinRespuesta: number;
  fueraDeColombia: number;
  /** Mediana, en minutos, de la primera respuesta; null si nadie respondió. */
  primeraRespuestaMin: number | null;
};

function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return Math.round(orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2);
}

/**
 * Agrupa las conversaciones nuevas por anuncio de origen. Las que no tienen anuncio NO se inventan: se cuentan
 * aparte con su porcentaje, para saber qué tan completo es el cruce del costo por venta.
 */
export function agruparPorAnuncio(conversaciones: ConversacionDeAnuncio[]): {
  porAnuncio: NumerosDeAnuncio[];
  total: number;
  sinAnuncio: { conversaciones: number; porCiento: number | null };
} {
  const grupos = new Map<string, { fila: NumerosDeAnuncio; tiempos: number[] }>();
  let sinAnuncio = 0;
  for (const chat of conversaciones) {
    const id = chat.anuncioId?.trim() || null;
    if (!id) {
      sinAnuncio += 1;
      continue;
    }
    let grupo = grupos.get(id);
    if (!grupo) {
      grupo = {
        fila: { anuncioId: id, anuncioTitulo: chat.anuncioTitulo, conversaciones: 0, tibioOCaliente: 0, etapaAvanzada: 0, conInteres: 0, ventas: 0, sinRespuesta: 0, fueraDeColombia: 0, primeraRespuestaMin: null },
        tiempos: [],
      };
      grupos.set(id, grupo);
    }
    const { fila } = grupo;
    if (!fila.anuncioTitulo && chat.anuncioTitulo) fila.anuncioTitulo = chat.anuncioTitulo;
    fila.conversaciones += 1;
    const temperatura = (chat.temperatura ?? "").toUpperCase();
    const porTemperatura = temperatura === "TIBIO" || temperatura === "CALIENTE";
    const porEtapa = chat.etapa === "PROPUESTA" || chat.etapa === "NEGOCIACION" || chat.etapa === "GANADO";
    if (porTemperatura) fila.tibioOCaliente += 1;
    if (porEtapa) fila.etapaAvanzada += 1;
    if (porTemperatura || porEtapa) fila.conInteres += 1;
    if (chat.etapa === "GANADO") fila.ventas += 1;
    if (chat.exterior) fila.fueraDeColombia += 1;
    if (chat.minutosPrimeraRespuesta === null) fila.sinRespuesta += 1;
    else grupo.tiempos.push(chat.minutosPrimeraRespuesta);
  }
  const porAnuncio = [...grupos.values()].map(({ fila, tiempos }) => ({ ...fila, primeraRespuestaMin: mediana(tiempos) }));
  porAnuncio.sort((a, b) => b.conversaciones - a.conversaciones);
  const total = conversaciones.length;
  return { porAnuncio, total, sinAnuncio: { conversaciones: sinAnuncio, porCiento: total > 0 ? Math.round((sinAnuncio / total) * 1000) / 10 : null } };
}

/* ------------------------------------------------------------------------------------------------
   AGENTE DE SISTEMAS: revisión al día siguiente de cada subida (solo lectura)
------------------------------------------------------------------------------------------------ */

export const RESULTADOS_DE_REVISION = ["FUNCIONA", "FALLA", "NO SE PUEDE PROBAR"] as const;
export type ResultadoDeRevision = (typeof RESULTADOS_DE_REVISION)[number];

/** Horas que una tarjeta puede estar PLANEANDO / EN_CURSO / SUBIENDO antes de contarse como atascada. */
export const HORAS_PARA_ATASCADA = 2;
/** Minutos sin usar su clave a partir de los cuales el trabajador se considera sin señal. */
export const MINUTOS_SIN_SENAL = 30;
/** Horas hacia atrás de las tarjetas HECHO que se revisan cada día. */
export const HORAS_DE_REVISION = 24;
export const ESTADOS_QUE_SE_ATASCAN = ["PLANEANDO", "EN_CURSO", "SUBIENDO"] as const;

/** "no se puede probar", "NO_SE_PUEDE_PROBAR" o "Falla" → el valor canónico; null si no es ninguno. */
export function leerResultadoDeRevision(valor: unknown): ResultadoDeRevision | null {
  if (typeof valor !== "string") return null;
  const limpio = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim()
    .toUpperCase();
  return (RESULTADOS_DE_REVISION as readonly string[]).includes(limpio) ? (limpio as ResultadoDeRevision) : null;
}

export type RevisionDeSistemas = {
  tarjetaId: string | null;
  titulo: string;
  repo: string | null;
  commit: string | null;
  resultado: ResultadoDeRevision;
  /** FALLA: el error exacto. NO SE PUEDE PROBAR: el porqué. FUNCIONA: lo que se abrió. */
  detalle: string | null;
};

/** Valida la lista de revisiones por tarjeta. Una sin resultado válido es un error legible (no se adivina). */
export function leerRevisionesDeSistemas(valor: unknown): RevisionDeSistemas[] {
  if (valor === undefined || valor === null || valor === "") return [];
  if (!Array.isArray(valor)) throw new Error('"revisiones" tiene que ser una lista: una por tarjeta HECHO { titulo, repo, commit, resultado, detalle }.');
  const revisiones: RevisionDeSistemas[] = [];
  for (const crudo of valor.slice(0, 100)) {
    if (!esObjeto(crudo)) continue;
    const titulo = textoCorto(crudo.titulo, 200);
    if (!titulo) throw new Error("Cada revisión necesita el título de la tarjeta.");
    const resultado = leerResultadoDeRevision(crudo.resultado);
    if (!resultado) throw new Error(`El resultado de "${titulo}" tiene que ser FUNCIONA, FALLA o NO SE PUEDE PROBAR.`);
    const detalle = textoCorto(crudo.detalle, 2000);
    if (resultado !== "FUNCIONA" && !detalle) {
      throw new Error(`"${titulo}": ${resultado === "FALLA" ? "FALLA necesita el error exacto" : "NO SE PUEDE PROBAR necesita el porqué"} en "detalle".`);
    }
    revisiones.push({
      tarjetaId: textoCorto(crudo.tarjetaId, 64),
      titulo,
      repo: textoCorto(crudo.repo, 20),
      commit: textoCorto(crudo.commit, 80),
      resultado,
      detalle,
    });
  }
  return revisiones;
}

export type ArregloDeSistemas = { titulo: string; commit: string | null; estado: "creada" | "se_crearia"; tarjetaId: string | null };

/** Las tarjetas de arreglo POR_APROBAR: las creadas (interruptor prendido) o las que "se crearía" (apagado o en prueba). */
export function leerArreglosDeSistemas(valor: unknown): ArregloDeSistemas[] {
  if (valor === undefined || valor === null || valor === "") return [];
  if (!Array.isArray(valor)) throw new Error('"arreglos" tiene que ser una lista { titulo, commit, estado: "creada"|"se_crearia" }.');
  const arreglos: ArregloDeSistemas[] = [];
  for (const crudo of valor.slice(0, 50)) {
    if (!esObjeto(crudo)) continue;
    const titulo = textoCorto(crudo.titulo, 300);
    if (!titulo) continue;
    const estado = crudo.estado === "creada" ? "creada" : "se_crearia";
    arreglos.push({ titulo, commit: textoCorto(crudo.commit, 80), estado, tarjetaId: textoCorto(crudo.tarjetaId, 64) });
  }
  return arreglos;
}

/** La marca que lleva el título de la tarjeta de arreglo, para no repetirla todos los días. */
export const marcaDeArreglo = (commit: string) => `[sistemas:${commit.trim().slice(0, 12)}]`;

/** ¿Ya hay una tarjeta de arreglo (de cualquier estado, sin borrar) para este commit? */
export function yaExisteArreglo(titulos: Iterable<string>, commit: string): boolean {
  const marca = marcaDeArreglo(commit);
  for (const titulo of titulos) if (titulo.includes(marca)) return true;
  return false;
}

/** Una tarjeta en PLANEANDO / EN_CURSO / SUBIENDO por más de 2 h está atascada. `desde` = cuándo arrancó o su último movimiento. */
export function estaAtascada(estado: string, desde: Date | null, ahora: Date, horas = HORAS_PARA_ATASCADA): boolean {
  if (!(ESTADOS_QUE_SE_ATASCAN as readonly string[]).includes(estado) || !desde) return false;
  return ahora.getTime() - desde.getTime() > horas * 3_600_000;
}

/** ¿Quedó HECHO dentro de las últimas 24 h? */
export function quedoHechoRecien(hechoEn: Date | null, ahora: Date, horas = HORAS_DE_REVISION): boolean {
  if (!hechoEn) return false;
  const edad = ahora.getTime() - hechoEn.getTime();
  return edad >= 0 && edad <= horas * 3_600_000;
}

export type VidaDelTrabajador = { vivo: boolean; minutosSinSenal: number | null; texto: string };

/** El trabajador está vivo si usó su clave en los últimos 30 minutos. */
export function vidaDelTrabajador(ultimoUsoEn: Date | null, ahora: Date): VidaDelTrabajador {
  if (!ultimoUsoEn) return { vivo: false, minutosSinSenal: null, texto: "sin señal: la clave del trabajador nunca se ha usado" };
  const minutos = Math.max(0, Math.round((ahora.getTime() - ultimoUsoEn.getTime()) / 60_000));
  if (minutos > MINUTOS_SIN_SENAL) return { vivo: false, minutosSinSenal: minutos, texto: `sin señal desde ${ultimoUsoEn.toISOString()} (hace ${minutos} min)` };
  return { vivo: true, minutosSinSenal: minutos, texto: `vivo: última señal hace ${minutos} min` };
}

export type HallazgosDeSistemas = {
  fallas: number;
  sinProbar: number;
  funcionan: number;
  atascadas: number;
  enError: number;
  trabajadorVivo: boolean;
};

/** La línea de UNA frase para Alexander: "Sistemas: todo funciona" o lo que está roto o atascado. */
export function lineaDeSistemas(h: HallazgosDeSistemas): string {
  const partes: string[] = [];
  if (h.fallas > 0) partes.push(`${h.fallas} ${h.fallas === 1 ? "subida falla" : "subidas fallan"} en producción`);
  if (h.atascadas > 0) partes.push(`${h.atascadas} ${h.atascadas === 1 ? "tarjeta atascada" : "tarjetas atascadas"} más de ${HORAS_PARA_ATASCADA} h`);
  if (h.enError > 0) partes.push(`${h.enError} en ERROR`);
  if (!h.trabajadorVivo) partes.push("el trabajador no da señal");
  return partes.length ? `Sistemas: ${partes.join(", ")}` : "Sistemas: todo funciona";
}

/**
 * La línea de sistemas para el mensaje de las 7:30 a Alexander. Null = no va nada (interruptor apagado).
 * Prendido: la línea del agente ("Sistemas: todo funciona" o lo roto / atascado). Sin resumen: "Sistemas: sin revisión hoy".
 */
export function lineaDeSistemasParaAlexander(entrada: {
  interruptorPrendido: boolean;
  resumen: { linea: string | null; salioTarde: boolean; notaDeRetraso: string | null } | null;
}): string | null {
  if (!entrada.interruptorPrendido) return null;
  const { resumen } = entrada;
  if (!resumen || !resumen.linea) return "Sistemas: sin revisión hoy";
  const partes = [resumen.linea.startsWith("Sistemas") ? resumen.linea : `Sistemas: ${resumen.linea}`];
  if (resumen.salioTarde) partes.push(`(salió tarde${resumen.notaDeRetraso ? `: ${resumen.notaDeRetraso}` : ""})`);
  return partes.join(" ");
}

/* ------------------------------------------------------------------------------------------------
   CONTADOR DE USO
------------------------------------------------------------------------------------------------ */

export const TIPOS_DE_USO = ["pantalla", "herramienta"] as const;
export type TipoDeUso = (typeof TIPOS_DE_USO)[number];

/** La pantalla `/cliente/crm/agente-de-sistemas` y sus herramientas no se cuentan: inflarían el uso. */
export const PANTALLA_PROPIA_DE_SISTEMAS = "/cliente/crm/agente-de-sistemas";
export const HERRAMIENTAS_PROPIAS_DE_SISTEMAS = new Set(["agente_de_sistemas", "revision_de_sistemas"]);

/** La ruta que se cuenta: solo `/cliente/...`, sin parámetros y a lo más tres niveles (no se cuentan ids de chats). Null = no se cuenta. */
export function clavePantallaParaContar(ruta: unknown): string | null {
  if (typeof ruta !== "string") return null;
  const limpia = ruta.split(/[?#]/)[0].trim().replace(/\/+$/, "");
  if (limpia !== "/cliente" && !limpia.startsWith("/cliente/")) return null;
  const niveles = limpia.split("/").filter(Boolean).slice(0, 3);
  const clave = `/${niveles.join("/")}`;
  if (clave === PANTALLA_PROPIA_DE_SISTEMAS) return null;
  return clave.slice(0, 120);
}

export function claveHerramientaParaContar(nombre: unknown): string | null {
  if (typeof nombre !== "string") return null;
  const limpio = nombre.trim().slice(0, 80);
  if (!limpio || HERRAMIENTAS_PROPIAS_DE_SISTEMAS.has(limpio)) return null;
  return limpio;
}

/** Las pantallas que una subida tocó: `src/app/cliente/crm/pauta/page.tsx` → `/cliente/crm/pauta` (a lo más tres niveles, como el contador). */
export function pantallasDeArchivos(archivos: unknown): string[] {
  if (!Array.isArray(archivos)) return [];
  const rutas = new Set<string>();
  for (const archivo of archivos) {
    if (typeof archivo !== "string") continue;
    const encontrado = archivo.replace(/\\/g, "/").match(/^src\/app\/(cliente(?:\/[^/]+)*)\/page\.tsx$/);
    if (!encontrado) continue;
    const ruta = clavePantallaParaContar(`/${encontrado[1]}`);
    if (ruta) rutas.add(ruta);
  }
  return [...rutas];
}
