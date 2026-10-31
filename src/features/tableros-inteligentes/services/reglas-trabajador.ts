/*
  REGLAS DEL TRABAJADOR Y DE LAS APROBACIONES del Tablero IA (fase 2, 20-oct-2026, spec aprobada por
  Alexander).

  Funciones puras, sin base ni Next (pruebas: npm run test:tableros). Las usan el servicio
  (tableros.ts y trabajador.ts), el MCP y la pantalla.

  El flujo de una tarjeta con repo (solo tipos con aprobación):
    POR_APROBAR --(aprobar tarea)--> APROBADO --(el Coordinador la toma)--> PLANEANDO --> PLAN_LISTO
    --(aprobar plan)--> PLAN_APROBADO --(la toma)--> EN_CURSO --> SUBIENDO --(la toma enseguida)--> HECHO.
    Si algo falla: ERROR con motivo.   Desde ERROR el dueño reintenta: vuelve a APROBADO (planear de nuevo)
    o a PLAN_APROBADO (construir de nuevo con el plan).

  Subir solo (21-oct-2026, decisión de Alexander: Planear -> Aprobar plan -> Hacer): EN_CURSO pasa
  directo a SUBIENDO pendiente si todo pasó, el Coordinador dice que sube solo (su interruptor
  `subirSolo` del repo) y la tarjeta no tiene zona protegida (destinoDelResultado). Si el
  interruptor está apagado o toca una zona que no esté en ZONAS_QUE_SUBEN_SOLAS, queda POR_REVISAR con la zona
  marcada y espera el sí final del dueño (momento 'subir'). El bot de ventas, Meta Ads, el libro V3 y los chats
  ya NO piden ese sí (24-oct-2026; chats, 26-oct-2026, ZONAS_QUE_SUBEN_SOLAS): suben solos, con pruebas extra y vigilancia de 30 minutos. Si el despliegue falla después
  de subir, el Coordinador hace revert del commit en main y la deja ERROR.
  CHATS y BOT_VENTAS nunca esperan el sí final (30-oct-2026): si la tarjeta construyó bien y no puede subir sola,
  pasa a ERROR con el motivo en una línea ("construido, no sube: ..."). Solo siguen esperando al dueño el dinero de
  Gestión y el gasto en Meta Ads (esperaPor). 'revisar_de_nuevo' saca las que ya estaban esperando en POR_REVISAR.

  Lo que no se negocia:
  1. Las transiciones del Coordinador (PLANEANDO, PLAN_LISTO, EN_CURSO, POR_REVISAR, SUBIENDO, HECHO,
     ERROR) solo las hace el Coordinador, con su clave (API /api/trabajador/tablero). Nadie las pone
     moviendo el estado.
  2. Aprobar es su propia acción con tres momentos: 'tarea', 'plan' y 'subir'. Cada aprobación deja en
     el historial quién (nombre y userId), el momento, por dónde ('pantalla' o 'voz') y el texto de
     confirmación.
  3. Por el MCP (via 'voz') se aprueba solo si la persona lo dijo explícitamente: el texto tiene que
     decir "sí" y "apruebo". Las tarjetas con zona protegida se aprueban solo por el dueño; las de bot de
     ventas, Meta Ads, libro V3 y chats también se aprueban por voz (ZONAS_QUE_SUBEN_SOLAS). Para que el
     Coordinador TOME una tarjeta con zona (28-oct-2026, laAprobacionDejaArrancar = el filtro SQL de /tomar): la
     voz cuenta igual que la pantalla si las zonas son solo CHATS y/o BOT_VENTAS; con LIBRO_V3 o META_ADS se
     vuelve a aprobar en la pantalla (y queda una alerta del Coordinador hasta que se haga).
  4. El sí final ('subir') lo da solo el DUEÑO del negocio (SI_FINAL_SOLO_DUENO), y solo si el
     Coordinador dijo que todo pasó (resultado.paso = true). Hoy solo hace falta para las tarjetas sin zona de un
     repo con `subirSolo` apagado, las de Libro V3, el gasto en Meta Ads y las que ya estaban POR_REVISAR (las de
     CHATS y BOT_VENTAS ya no esperan: suben o quedan en ERROR).
  4b. EXCEPCIÓN DE PRUEBA (30-oct-2026, decisión del dueño): un aprobador con alcance SISTEMAS (Emanuel) aprueba la tarea,
     el plan y TAMBIÉN el sí final, pero solo de tarjetas de Tecnología (CRM Ventas, Gestión, CRM Marketplace, Coordinador,
     General), nunca las que tocan dinero de Gestión o Meta Ads (vetoDeSistemas) ni las de zona protegida, y solo hasta el
     29-nov-2026 (PRUEBA_SISTEMAS_HASTA). Pasada la fecha vuelve a valer lo de antes sin que nadie lo toque.
  5. Un aprobador (AprobadorTablero) con alcance DESARROLLO aprueba la tarea y el plan solo de
     tarjetas con repo de desarrollo (gestion, aizencrm); con alcance TODO, cualquiera.
  6. La zona protegida se puede PONER desde el MCP (y la pone el Coordinador si el cambio toca una de
     esas rutas), pero quitarla lo hace solo el dueño en la pantalla.
  7. Por el MCP, una tarjeta PLAN_LISTO o ERROR se borra solo si el dueño lo pidió por voz: texto con
     "sí" y "borrar" (textoDeConfirmacionParaBorrar) y la cuenta de la clave es la dueña. Las que tiene
     el Coordinador en la mano y las de zona protegida no se borran (puedeBorrarTarjeta en reglas.ts).
  8. HECHO A MANO (22-oct-2026): cuando un cambio se termina por fuera del Coordinador, el dueño marca
     la tarjeta con repo HECHO desde ERROR, FALLIDO o POR_REVISAR (puedeMarcarHechoAMano): nota
     obligatoria, commit opcional, y por voz el texto "sí, márcala hecha" con la clave de la cuenta
     dueña. Nunca mientras el Coordinador la tiene. Queda en el historial (registroDeHechoAMano). La
     regla general no cambia: en el camino normal el HECHO lo pone solo el Coordinador.
*/

import {
  COMO_MARCAR_HECHO_A_MANO,
  type EstadoTarjetaTablero,
  type OrigenCambio,
  type Veredicto,
  claveDeNombre,
  estaTrabajando,
  sePuedeMarcarHechoAMano,
} from "./reglas";
import { type AreaDeAlerta, leerAreaDeAlerta, tocaDineroOMetaAds } from "@/features/alertas/dominio/reglas";
import { type ModelosDelResultado, esLinkDeSesion, modelosDeEntrada } from "./modelos-del-coordinador";
import { archivosDeEntrada, migracionDestructivaDeEntrada, porQueElPlanEsperaTuSi, porQueLaTareaEsperaTuSi } from "./reglas-riesgo";

/* ───────────────────────────────────────────────────────────────────── repos ── */

/** Los repositorios en que trabaja el Coordinador (lista fija: sumar uno es cambiar el código). */
export const REPOS_DEL_TRABAJADOR = ["gestion", "aizencrm"] as const;
export type RepoDelTrabajador = (typeof REPOS_DEL_TRABAJADOR)[number];

export const NOMBRE_DEL_REPO: Record<RepoDelTrabajador, string> = {
  gestion: "Gestión",
  aizencrm: "AizenCRM",
};

/** Los repos "de desarrollo": los que puede aprobar un aprobador con alcance DESARROLLO. */
export const REPOS_DE_DESARROLLO: readonly RepoDelTrabajador[] = ["gestion", "aizencrm"];

export function esRepo(valor: unknown): valor is RepoDelTrabajador {
  return typeof valor === "string" && (REPOS_DEL_TRABAJADOR as readonly string[]).includes(valor);
}

/** repo como lo mandan: clave de la lista, "" / null para quitarlo, undefined si no vino. */
export function repoDeEntrada(valor: unknown): RepoDelTrabajador | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || (typeof valor === "string" && valor.trim() === "")) return null;
  const limpio = typeof valor === "string" ? claveDeNombre(valor) : valor;
  if (!esRepo(limpio)) {
    throw new Error(`Ese repo no existe. Van: ${REPOS_DEL_TRABAJADOR.join(", ")}.`);
  }
  return limpio;
}

/* ───────────────────────────────────────────────────────────────────── zonas protegidas ── */

/** CHATS (21-oct-2026): envío y recepción de WhatsApp, Evolution API, webhooks y la bandeja de las asesoras. */
export const ZONAS_PROTEGIDAS = ["META_ADS", "BOT_VENTAS", "LIBRO_V3", "CHATS"] as const;
export type ZonaProtegida = (typeof ZONAS_PROTEGIDAS)[number];

export const NOMBRE_DE_LA_ZONA: Record<ZonaProtegida, string> = {
  META_ADS: "Meta Ads",
  BOT_VENTAS: "Bot de ventas",
  LIBRO_V3: "Libro V3",
  CHATS: "Chats",
};

/**
 * Zonas que suben solas (decisión del dueño, 24-oct-2026, por voz: "que sea igual que las otras"): si compiló y
 * pasó las pruebas, la tarjeta pasa a SUBIENDO sin el sí final. CHATS se sumó el 26-oct-2026 (Coordinador de
 * Sistemas autónomo, parte 2): sube sola solo con la confirmación de que no manda mensajes nuevos a clientes; cualquier
 * envío nuevo en sus archivos la deja esperando el sí. Es la lista que lee todo lo
 * demás (destino del resultado, aprobación por voz, el Coordinador): se agrega una zona en un solo lugar.
 * META_ADS tiene una excepción: lo que gasta plata (presupuesto, prender, crear) sigue pidiendo el sí.
 */
export const ZONAS_QUE_SUBEN_SOLAS: readonly ZonaProtegida[] = ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"];

/** De estas zonas, las que TODAVÍA piden el sí final del dueño (las que no están en ZONAS_QUE_SUBEN_SOLAS). */
export function zonasQuePidenTuSi(zonas: readonly string[]): string[] {
  return zonas.filter((zona) => !(ZONAS_QUE_SUBEN_SOLAS as readonly string[]).includes(zona));
}

/**
 * Zonas que ARRANCAN solas (regla del dueño, 25-oct-2026): su tarea y su plan se aprueban solos y el Coordinador las
 * toma sin esperar el sí de la pantalla. La subida no cambia (ZONAS_QUE_SUBEN_SOLAS, pruebas y vigilancia de 30 min).
 * META_ADS y LIBRO_V3 no están: su tarea sigue esperando el sí del dueño.
 */
export const ZONAS_QUE_ARRANCAN_SOLAS: readonly ZonaProtegida[] = ["CHATS", "BOT_VENTAS"];

/** De estas zonas, las que NO arrancan solas (vacío = todas arrancan solas, o no hay zona). */
export function zonasQueNoArrancanSolas(zonas: readonly string[]): string[] {
  return zonas.filter((zona) => !(ZONAS_QUE_ARRANCAN_SOLAS as readonly string[]).includes(zona));
}

/**
 * Vías con las que una tarjeta de zona SOLO CHATS / BOT_VENTAS arranca (regla del dueño 28-oct-2026): la automática (25-oct)
 * y la voz cuentan igual que la pantalla. LIBRO_V3 y META_ADS siguen pidiendo la pantalla: la voz no basta.
 */
export const VIAS_QUE_ARRANCAN_ZONAS_SOLAS = ["automatica", "voz"] as const;

/**
 * ¿La última aprobación deja que el Coordinador tome esta tarjeta? Es la MISMA regla que el filtro de /candidatas y
 * /tomar (condicionDeLaVia en sql-trabajador.ts): sin zona, siempre; en la pantalla, siempre; con zona SOLO CHATS y/o
 * BOT_VENTAS, también por voz o automática; con LIBRO_V3 o META_ADS, solo en la pantalla.
 */
export function laAprobacionDejaArrancar(zonas: readonly string[], via: string | null | undefined): boolean {
  if (!zonas.length || via === "pantalla") return true;
  if (zonasQueNoArrancanSolas(zonas).length) return false;
  return (VIAS_QUE_ARRANCAN_ZONAS_SOLAS as readonly string[]).includes(via ?? "");
}

/**
 * Las zonas por las que una tarjeta aprobada espera la pantalla ([] = la vía alcanza). Solo las que no arrancan solas
 * (LIBRO_V3, META_ADS); si la vía no es conocida y todas arrancan solas, todas las de la tarjeta.
 */
export function zonasQueEsperanLaPantalla(zonas: readonly string[], via: string | null | undefined): string[] {
  if (laAprobacionDejaArrancar(zonas, via)) return [];
  const faltan = zonasQueNoArrancanSolas(zonas);
  return faltan.length ? faltan : [...zonas];
}

const COMO_SE_APROBO: Record<string, string> = { voz: "por voz", automatica: "automáticamente", pantalla: "en pantalla" };

/** "«Título» está aprobada por voz pero toca Libro V3: apruébala en pantalla para que arranque" (alerta y ficha). */
export function textoDeAprobarEnPantalla(titulo: string, zonas: readonly string[], via: string | null | undefined): string {
  const nombres = zonas.map((zona) => (esZona(zona) ? NOMBRE_DE_LA_ZONA[zona] : zona)).join(", ");
  const como = COMO_SE_APROBO[via ?? ""] ?? "por otra vía";
  return `«${titulo.trim()}» está aprobada ${como} pero toca ${nombres}: apruébala en pantalla para que arranque`;
}

export function esZona(valor: unknown): valor is ZonaProtegida {
  return typeof valor === "string" && (ZONAS_PROTEGIDAS as readonly string[]).includes(valor);
}

/** Lista de zonas (sin repetir, en el orden de la lista fija), [] para ninguna, undefined si no vino. */
export function zonasDeEntrada(valor: unknown): ZonaProtegida[] | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return [];
  const lista = Array.isArray(valor) ? valor : [valor];
  const pedidas = new Set<string>();
  for (const zona of lista) {
    const limpia = typeof zona === "string" ? zona.trim().toUpperCase() : zona;
    if (limpia === "") continue;
    if (!esZona(limpia)) throw new Error(`Esa zona protegida no existe. Van: ${ZONAS_PROTEGIDAS.join(", ")}.`);
    pedidas.add(limpia);
  }
  return ZONAS_PROTEGIDAS.filter((zona) => pedidas.has(zona));
}

/** Une dos listas de zonas (para el Coordinador y el MCP, que solo pueden agregar). */
export function unirZonas(a: readonly string[], b: readonly string[]): ZonaProtegida[] {
  const todas = new Set([...a, ...b]);
  return ZONAS_PROTEGIDAS.filter((zona) => todas.has(zona));
}

/**
 * ¿Se puede pasar de `antes` a `despues`? Agregar siempre se puede; quitar, solo el dueño en la pantalla.
 */
export function puedeCambiarZonas(
  origen: OrigenCambio,
  antes: readonly string[],
  despues: readonly string[],
  esDueno: boolean,
): Veredicto {
  const quitadas = antes.filter((zona) => !despues.includes(zona));
  if (!quitadas.length) return null;
  if (origen !== "PANTALLA" || !esDueno) {
    return `La zona protegida (${quitadas.join(", ")}) la quita solo el dueño en la pantalla. Se puede agregar, no quitar.`;
  }
  return null;
}

/* ───────────────────────────────────────────────────────────────────── tiempos y candado ── */

export type EtapaDelTrabajador = "planear" | "construir" | "subir";

/**
 * Tope de cada etapa (minutos). Pasado el tope, la tarjeta pasa a ERROR ("se pasó del tiempo"). Subir
 * tiene 80: el CI de AizenCRM tarda hasta 20, la versión hasta 8, tiene que alcanzar para deshacer y, en las zonas
 * que suben solas, la vigilancia de 30 minutos va dentro de la misma etapa (24-oct-2026).
 */
export const MINUTOS_POR_ETAPA: Record<EtapaDelTrabajador, number> = { planear: 20, construir: 90, subir: 80 };

/** Dónde construye el Coordinador (25-oct-2026): en aizen1 o en la nube (`claude --cloud`). */
export type LugarDeConstruccion = "aizen1" | "nube";

/** Construir en la nube tiene 180 minutos (en aizen1 siguen siendo 90): la sesión tarda más y luego se verifica en aizen1. */
export const MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE = 180;

/** El tope de una etapa en minutos. Solo construir cambia, y solo si el latido dijo que se construye en la nube. */
export function topeDeLaEtapa(etapa: EtapaDelTrabajador, lugar?: LugarDeConstruccion | null): number {
  return etapa === "construir" && lugar === "nube" ? MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE : MINUTOS_POR_ETAPA[etapa];
}

/**
 * Sin latido, el candado vence a los 5 minutos (así un Coordinador que se apagó se nota pronto). Cada
 * latido lo corre otros 5 minutos, nunca más allá del tope de la etapa.
 */
export const MINUTOS_DE_GRACIA_DEL_LATIDO = 5;

/** Qué etapa empieza cuando el Coordinador toma una tarjeta en ese estado, y a qué estado pasa. */
export const AL_TOMAR: Partial<Record<EstadoTarjetaTablero, { etapa: EtapaDelTrabajador; a: EstadoTarjetaTablero }>> = {
  APROBADO: { etapa: "planear", a: "PLANEANDO" },
  PLAN_APROBADO: { etapa: "construir", a: "EN_CURSO" },
  // SUBIENDO "pendiente" (sin trabajoVenceEn) = el dueño dio el sí final (o el Coordinador la construyó y
  // sube sola) y nadie la tomó todavía. /tomar la elige antes que cualquier otra.
  SUBIENDO: { etapa: "subir", a: "SUBIENDO" },
};

export const ETAPA_DEL_ESTADO: Partial<Record<EstadoTarjetaTablero, EtapaDelTrabajador>> = {
  PLANEANDO: "planear",
  EN_CURSO: "construir",
  SUBIENDO: "subir",
};

const MINUTO = 60_000;

/**
 * El vencimiento del candado: ahora + gracia, sin pasar del tope de la etapa contado desde que la tomó.
 * `lugar` = "nube" solo importa al construir (180 min en vez de 90).
 */
export function vencimientoDelCandado(etapa: EtapaDelTrabajador, iniciadoEn: Date, ahora: Date, lugar?: LugarDeConstruccion | null): Date {
  const tope = iniciadoEn.getTime() + topeDeLaEtapa(etapa, lugar) * MINUTO;
  return new Date(Math.min(ahora.getTime() + MINUTOS_DE_GRACIA_DEL_LATIDO * MINUTO, tope));
}

// Tres líneas (qué falló, qué se probó, qué necesita del dueño), igual que el resumen de una escalada.
export const MOTIVO_VENCIDA = [
  "Se pasó del tiempo: el Coordinador dejó de dar señales (sin latido) o la etapa superó su tope.",
  "Se volvió a intentar sola y no avanzó.",
  "Necesita que la veas: pulsa Reintentar o, si es muy grande, pide partirla.",
].join("\n");

/* ───────────────────────────────────────────────────────────────────── transiciones del Coordinador ── */

/**
 * Lo que manda el Coordinador a /tomar (22-oct-2026): `maxParalelo` = cuántas puede tener a la vez (1 si
 * no viene: un Coordinador viejo sigue de a una) y `excluir` = ids que no quiere ahora (chocan con lo que
 * ya tiene corriendo).
 */
/**
 * Cuántas tarjetas a la vez puede tener el Coordinador (lo manda él; tope duro 12). Desde el 25-oct-2026 caben las
 * de aizen1 (máximo 2) más las que se construyen en la nube (tope de seguridad de 8 en el Coordinador).
 */
export const MAXIMO_EN_PARALELO = 12;

/** Un link de sesión de Claude en la nube: solo https://claude.ai/code/session_… (nada de otros sitios ni parámetros). */
export function linkDeSesionDeEntrada(valor: unknown): string | null {
  const link = textoONull(valor, 300);
  return esLinkDeSesion(link) ? link : null;
}

/** Lo que el latido de una tarjeta puede decir al construir: dónde (aizen1 o nube) y el link de la sesión de la nube. */
export function latidoDeEntrada(cuerpo: unknown): { lugar: LugarDeConstruccion | null; linkSesion: string | null } {
  const datos = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const lugar = datos.lugar === "nube" || datos.lugar === "aizen1" ? datos.lugar : null;
  // El link solo vale si la construcción es en la nube.
  return { lugar, linkSesion: lugar === "nube" ? linkDeSesionDeEntrada(datos.sesion) : null };
}

export type PedidoDeTomar = { maxParalelo?: unknown; excluir?: unknown };

export function opcionesDeTomar(pedido: PedidoDeTomar) {
  const numero = Math.floor(Number(pedido.maxParalelo));
  const maxParalelo = Number.isFinite(numero) && numero >= 1 ? Math.min(numero, MAXIMO_EN_PARALELO) : 1;
  const excluir = Array.isArray(pedido.excluir)
    ? pedido.excluir.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64).slice(0, 200)
    : [];
  return { maxParalelo, excluir };
}


export type AccionDelTrabajador =
  | "latido"
  | "plan"
  | "resultado"
  | "subida"
  | "error"
  | "soltar"
  | "reparar"
  | "partir"
  | "depender"
  | "recoger"
  | "revisar_de_nuevo"
  | "ya-hecha"
  | "limpieza"
  | "rescatar"
  | "causa-externa";
export const ACCIONES_DEL_TRABAJADOR: readonly AccionDelTrabajador[] = [
  "latido",
  "plan",
  "resultado",
  "subida",
  "error",
  "soltar",
  "reparar",
  "partir",
  "depender",
  "recoger",
  "revisar_de_nuevo",
  "ya-hecha",
  "limpieza",
  "rescatar",
  "causa-externa",
];

/**
 * Desde qué estados puede llamar el Coordinador cada acción, y a cuál pasa (null = no cambia). El
 * "resultado" figura como POR_REVISAR, pero destinoDelResultado decide: SUBIENDO pendiente si sube sola, o ERROR si es
 * de CHATS / BOT_VENTAS y no puede subir sola (el ERROR lo decide esa función, no esta tabla).
 */
export const TRANSICIONES_DEL_TRABAJADOR: Record<
  AccionDelTrabajador,
  { desde: readonly EstadoTarjetaTablero[]; a: EstadoTarjetaTablero | null }
> = {
  latido: { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: null },
  plan: { desde: ["PLANEANDO"], a: "PLAN_LISTO" },
  resultado: { desde: ["EN_CURSO"], a: "POR_REVISAR" },
  subida: { desde: ["SUBIENDO"], a: "HECHO" },
  error: { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: "ERROR" },
  // Soltar (22-oct-2026): la tarjeta vuelve a esperar su turno sin ERROR y sin gastar el intento, porque
  // Claude llegó a su límite de uso o porque choca con otra que ya corre (misma zona o módulo, o la cola
  // de subida). PLANEANDO -> APROBADO, EN_CURSO -> PLAN_APROBADO, SUBIENDO -> SUBIENDO pendiente (a =
  // null: depende de dónde estaba). Una SUBIENDO se suelta solo antes de empezar, nunca después del push.
  soltar: { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: null },
  // Reparar (24-oct-2026): algo falló y el Coordinador sabe la causa: la tarjeta vuelve a la fila SIN ERROR
  // (PLANEANDO -> APROBADO, EN_CURSO -> PLAN_APROBADO, SUBIENDO -> PLAN_APROBADO: una subida que falló antes
  // del push se arregla reconstruyendo) y cuenta una reparación (tope TOPE_DE_REPARACIONES). a = null: depende de dónde estaba.
  reparar: { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: null },
  // Partir: una tarjeta muy grande se divide en 2 a 4 partes en orden. Desde EN_CURSO (ya hay plan: las hijas
  // quedan PLAN_APROBADO con su parte como plan) y, desde el 26-oct-2026, también desde PLANEANDO: se mide el
  // tamaño ANTES de planear y las hijas quedan APROBADO ("por planear"), sin plan copiado.
  // La madre se queda donde estaba, sin candado (nadie la toma), hasta que todas sus hijas estén HECHO.
  partir: { desde: ["PLANEANDO", "EN_CURSO"], a: null },
  // Depender (26-oct-2026): al medir, la tarjeta nombra a otra como molde o requisito: se pone la flecha de dependencia
  // y, si la otra no está HECHO, la tarjeta vuelve a la fila ("Esperando a «X»") sin ERROR y sin gastar el intento.
  // 27-oct-2026: también desde EN_CURSO (la sesión de construir descubre que falta otra tarjeta): vuelve a PLAN_APROBADO sin gastar intento.
  depender: { desde: ["APROBADO", "PLANEANDO", "EN_CURSO"], a: null },
  // Recoger (26-oct-2026): una vez al día el Coordinador revisa las tarjetas en ERROR; esta acción las reintenta, las
  // parte o deja una línea para el dueño (la tarjeta sigue en ERROR). a = null: depende de la decisión.
  recoger: { desde: ["ERROR"], a: null },
  // Ya hecha (27-oct-2026): al planear o al construir se encuentra que lo pedido ya está en main (el Coordinador comprobó el commit con
  // git): la tarjeta pasa a HECHO con la nota "ya estaba hecho (commit X)", sin pedirle nada al dueño.
  "ya-hecha": { desde: ["PLANEANDO", "EN_CURSO"], a: "HECHO" },
  // Limpieza (27-oct-2026): main trae errores viejos. Crea UNA tarjeta de limpieza por repo (o le agrega los errores a la abierta). Se llama
  // con la tarjeta que los encontró, ya en el estado en que la dejó su resultado; no la mueve.
  limpieza: { desde: ["EN_CURSO", "SUBIENDO", "POR_REVISAR", "HECHO"], a: null },
  // Rescatar (27-oct-2026): el Coordinador vuelve a revisar una tarjeta POR_REVISAR que pasó todo y solo esperaba su prueba extra (o
  // ya traía el sí del dueño): si la comprobó él mismo con el diff real, pasa a SUBIENDO; si no, sigue POR_REVISAR con el motivo.
  rescatar: { desde: ["POR_REVISAR"], a: null },
  // Revisar de nuevo (30-oct-2026): saca de POR_REVISAR a una tarjeta de CHATS / BOT_VENTAS que ya estaba esperando: a SUBIENDO
  // pendiente (subeSolo) o a ERROR con el motivo. La usa el Coordinador, no la pantalla. a = null: depende de `subeSolo`.
  revisar_de_nuevo: { desde: ["POR_REVISAR"], a: null },
  // Causa externa (31-oct-2026): la falla no es de la tarea (la vigilancia revirtió la subida, main ya trae lint o pruebas rotas, choca
  // con otra tarjeta, el servidor no responde). Crea la tarjeta de la causa (o reusa la abierta con el mismo título), pone la flecha de
  // dependencia y suelta la original sin ERROR ni intento: PLANEANDO -> APROBADO, EN_CURSO y SUBIENDO -> PLAN_APROBADO. a = null.
  "causa-externa": { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: null },
};

/** La nota de una tarjeta que ya estaba hecha (27-oct-2026): "ya estaba hecho (commit X)". */
export function notaDeYaHecha(commit: string): string {
  return `ya estaba hecho (commit ${commit})`;
}

/** El título de la tarjeta única de limpieza de un repo. Las tareas de limpieza se buscan por este título exacto. */
export function tituloDeLimpieza(repo: string): string {
  return `Limpieza: main trae errores viejos (${repo})`;
}

/** Los tipos de causa externa (31-oct-2026) y el comienzo fijo del título de su tarjeta. "choque" no crea tarjeta: espera a la otra. */
export const PREFIJOS_DE_CAUSA_EXTERNA = { vigilancia: "Vigilancia:", main_roto: "Main roto:", servidor: "Servidor:" } as const;
export type TipoDeCausaExterna = keyof typeof PREFIJOS_DE_CAUSA_EXTERNA | "choque";

/**
 * Lo que manda el Coordinador en /causa-externa, validado: { tipo, titulo, detalle, referencia } o un texto con el problema.
 * El título de una tarjeta de causa empieza con su prefijo fijo (así el Coordinador no puede crear tarjetas con cualquier título) y
 * tiene máximo 200 letras; "choque" trae `referencia` (id o título de la otra tarjeta) y no crea nada.
 */
export function causaExternaDeEntrada(
  cuerpo: Record<string, unknown>,
): { tipo: TipoDeCausaExterna; titulo: string; detalle: string; referencia: string | null } | string {
  const tipo = cuerpo.tipo;
  const texto = (valor: unknown, n: number) => (typeof valor === "string" ? valor.trim().slice(0, n) : "");
  if (tipo === "choque") {
    const referencia = texto(cuerpo.referencia, 200);
    if (!referencia) return "Falta la referencia: el id o el título de la tarjeta con la que choca.";
    return { tipo, titulo: referencia, detalle: texto(cuerpo.detalle, 4000), referencia };
  }
  if (typeof tipo !== "string" || !(tipo in PREFIJOS_DE_CAUSA_EXTERNA)) return "El tipo de causa externa no existe (vigilancia, main_roto, servidor o choque).";
  const prefijo = PREFIJOS_DE_CAUSA_EXTERNA[tipo as keyof typeof PREFIJOS_DE_CAUSA_EXTERNA];
  const titulo = typeof cuerpo.titulo === "string" ? cuerpo.titulo.replace(/\s+/g, " ").trim() : "";
  if (!titulo.startsWith(prefijo) || titulo.length <= prefijo.length || titulo.length > 200) return `El título de la tarjeta de causa tiene que empezar con "${prefijo}" (máximo 200 letras).`;
  const detalle = texto(cuerpo.detalle, 4000);
  if (!detalle) return "Falta el detalle de la causa.";
  return { tipo: tipo as TipoDeCausaExterna, titulo, detalle, referencia: null };
}

/** ¿Puede el Coordinador hacer `accion` con una tarjeta en `estado`? */
export function puedeElTrabajador(accion: AccionDelTrabajador, estado: EstadoTarjetaTablero): Veredicto {
  const regla = TRANSICIONES_DEL_TRABAJADOR[accion];
  if (!regla) return "Esa acción del Coordinador no existe.";
  if (!regla.desde.includes(estado)) {
    return `La tarjeta está ${estado}: "${accion}" solo vale desde ${regla.desde.join(" o ")}.`;
  }
  return null;
}

/** Hay al menos una zona y todas son CHATS o BOT_VENTAS (las que nunca esperan el sí final del dueño). */
export function soloChatsOBot(zonas: readonly string[]): boolean {
  return zonas.length > 0 && zonas.every((zona) => zona === "CHATS" || zona === "BOT_VENTAS");
}

/** ¿El motivo de espera habla de gasto en Meta Ads? (sin importar mayúsculas ni tildes). Ese sí sigue siendo del dueño. */
export function esGastoEnMetaAds(esperaPor: string | null | undefined): boolean {
  if (typeof esperaPor !== "string") return false;
  const limpio = esperaPor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return limpio.includes("gasto") && limpio.includes("meta ads");
}

/**
 * A qué estado pasa la tarjeta con el /resultado: SUBIENDO (pendiente: el Coordinador la sube enseguida)
 * solo si todo pasó, el Coordinador dice que sube solo y la tarjeta no tiene una zona que pida el sí (ni la
 * que ya tenía ni la que marcó el Coordinador; BOT_VENTAS, META_ADS, LIBRO_V3 y CHATS ya suben solas, ver
 * ZONAS_QUE_SUBEN_SOLAS). Si no sube y la tarjeta es solo de CHATS / BOT_VENTAS (y no espera por gasto en Meta Ads),
 * pasa a ERROR: esas zonas nunca esperan el sí final. En lo demás, POR_REVISAR: espera el sí final del dueño.
 */
export function destinoDelResultado(datos: {
  paso: boolean;
  subeSolo: boolean;
  zonaProtegida: readonly string[];
  /** El dueño ya aprobó esta tarjeta y nada nuevo toca dinero ni Meta Ads (heredaAprobacionDelDueno): sube aunque el Coordinador no lo dijera. */
  aprobacionHeredada?: boolean;
  /** Lo que el Coordinador dejó como motivo de espera (resultado.esperaPor). */
  esperaPor?: string | null;
}): "SUBIENDO" | "POR_REVISAR" | "ERROR" {
  if (!datos.paso || zonasQuePidenTuSi(datos.zonaProtegida).length > 0) return "POR_REVISAR";
  if (datos.subeSolo || datos.aprobacionHeredada) return "SUBIENDO";
  return soloChatsOBot(datos.zonaProtegida) && !esGastoEnMetaAds(datos.esperaPor) ? "ERROR" : "POR_REVISAR";
}

/* ───────────────────────────────────────────── el sí del dueño se hereda (27-oct-2026) ── */

/** Lo que queda en el historial cuando el sí del dueño se hereda al reconstruir la tarea. */
export const TEXTO_APROBACION_HEREDADA = "sube sola: el dueño ya la había aprobado (regla del dueño 27-oct)";

/**
 * ¿El historial de la tarjeta trae un sí del dueño? Una fila "aprobar" hecha por una persona (en pantalla o por voz): las
 * aprobaciones automáticas (via "automatica") no cuentan. Sirve para tarea, plan o subir. Sin base.
 */
export function aprobacionDelDuenoEnElHistorial(filas: readonly { accion: string; despues: unknown }[]): boolean {
  return filas.some((fila) => {
    if (fila.accion !== "aprobar") return false;
    const via = (fila.despues as { via?: unknown } | null)?.via;
    return via === "pantalla" || via === "voz";
  });
}

/**
 * ¿El dueño aprobó la TAREA (30-oct-2026)? Una fila "aprobar" con momento "tarea" y via "pantalla" o "voz" (como las
 * escribe registroDeAprobacion). La aprobación automática (via "automatica") o una fila sin via no cuentan. Una hija que
 * heredó el sí de su madre con via "pantalla" cuenta. Sin base.
 */
export function tareaAprobadaPorElDuenoEnElHistorial(filas: readonly { accion: string; despues: unknown }[]): boolean {
  return filas.some((fila) => {
    if (fila.accion !== "aprobar") return false;
    const despues = fila.despues as { momento?: unknown; via?: unknown } | null;
    return despues?.momento === "tarea" && (despues.via === "pantalla" || despues.via === "voz");
  });
}

/**
 * ¿La ÚLTIMA aprobación del plan la dio una persona (pantalla o voz) y no la aprobación automática? (29-oct-2026) El
 * Coordinador no construye un plan con preguntas abiertas que se aprobó solo; si el dueño lo aprobó tal cual, sí.
 * `filas`: las filas "aprobar" del historial, de la más nueva a la más vieja.
 */
export function planAprobadoPorElDuenoEnElHistorial(filas: readonly { accion: string; despues: unknown }[]): boolean {
  const ultima = filas.find((fila) => fila.accion === "aprobar" && (fila.despues as { momento?: unknown } | null)?.momento === "plan");
  const via = (ultima?.despues as { via?: unknown } | null | undefined)?.via;
  return via === "pantalla" || via === "voz";
}

/** ¿Lo que dejó el Coordinador en `esperaPor` es solo que faltaba su prueba extra (no un envío ni un gasto)? */
export function esperaSoloPorLaPruebaExtra(esperaPor: string | null | undefined): boolean {
  return typeof esperaPor === "string" && /^falta la prueba de que/i.test(esperaPor.trim());
}

/**
 * Regla del dueño (27-oct-2026): lo que él ya aprobó vale aunque la tarea se reconstruya o se repare; no se le pide dos veces.
 * Hereda solo si el historial trae su sí, el Coordinador no dejó un motivo para esperar (un envío nuevo en chats, gasto en
 * Meta Ads...), el plan y la tarjeta no tocan dinero ni gasto en Meta Ads y la migración no es destructiva. Devuelve el
 * motivo de por qué NO hereda, o null si hereda.
 */
export function porQueNoHeredaLaAprobacion(datos: {
  historial: readonly { accion: string; despues: unknown }[];
  titulo: string;
  detalle: string;
  plan: string | null;
  esperaPor?: string | null;
  migracionDestructiva?: readonly string[] | null;
}): string | null {
  if (!aprobacionDelDuenoEnElHistorial(datos.historial)) return "no hay un sí del dueño en el historial";
  if (datos.esperaPor && !esperaSoloPorLaPruebaExtra(datos.esperaPor)) return `el Coordinador dejó un motivo para esperar (${datos.esperaPor})`;
  if (datos.migracionDestructiva?.length) return "la migración tiene cambios destructivos";
  const plan = porQueElPlanEsperaTuSi(datos.plan ?? "");
  if (plan) return plan;
  const tarea = porQueLaTareaEsperaTuSi({ titulo: datos.titulo, detalle: datos.detalle, zonaProtegida: [], zonasQueEsperan: [] });
  return tarea;
}

/* ───────────────────────────────────────────────────────────────────── aprobaciones ── */

export const MOMENTOS_DE_APROBACION = ["tarea", "plan", "subir"] as const;
export type MomentoDeAprobacion = (typeof MOMENTOS_DE_APROBACION)[number];

export const NOMBRE_DEL_MOMENTO: Record<MomentoDeAprobacion, string> = {
  tarea: "la tarea",
  plan: "el plan",
  subir: "subir a producción",
};

export type ViaDeAprobacion = "pantalla" | "voz";

/**
 * El sí final (subir a producción) lo da SOLO el dueño del negocio. Si algún día se quiere que un
 * aprobador con `puedeSubir` también pueda, se cambia esto a false (y nada más).
 */
export const SI_FINAL_SOLO_DUENO = true;

/* ──────────────────────────────────────────────────────────── aprobador de Sistemas (prueba) ── */

/** El alcance de Emanuel como responsable de Sistemas. */
export const ALCANCE_SISTEMAS = "SISTEMAS";
/** Las áreas de Tecnología que puede aprobar (las demás, como Ventas o Marketing, son del dueño). */
export const AREAS_DE_TECNOLOGIA: readonly AreaDeAlerta[] = ["CRM Ventas", "Gestión", "CRM Marketplace", "Coordinador", "General"];
/** Último día (incluido, día de Bogotá) del periodo de prueba. Prorrogar = cambiar este valor o el ajuste del negocio. */
export const PRUEBA_SISTEMAS_HASTA = "2026-11-29";
export const MENSAJE_DINERO_O_META = "Esta tarjeta toca dinero o Meta Ads: la aprueba Alexander.";

/** ¿Sigue vigente el permiso de prueba? Compara el día de Bogotá (UTC-5 todo el año) con el último día. */
export function permisoDeSistemasVigente(ahora: Date, hasta: string = PRUEBA_SISTEMAS_HASTA): boolean {
  const hoy = new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(hasta) && hoy <= hasta;
}

/** Lo que se mira de una tarjeta para saber si Emanuel la puede aprobar. */
export type TarjetaParaSistemas = {
  titulo: string;
  detalle: string;
  plan: string | null;
  area: string | null;
  /** Lo que no se puede editar a mano (el resumen y las pruebas del Coordinador, el motivo del riesgo): también cuenta para el límite. */
  extra?: string | null;
};

/** ¿La tarjeta toca dinero de Gestión o Meta Ads? Mira el título, la descripción, el plan, el área y la zona. Ante la duda, sí. */
export function tarjetaTocaDineroOMetaAds(tarjeta: TarjetaParaSistemas, zonaProtegida: readonly string[]): boolean {
  if (zonaProtegida.includes("META_ADS")) return true;
  return tocaDineroOMetaAds([tarjeta.titulo, tarjeta.detalle, tarjeta.plan ?? "", tarjeta.area ?? "", tarjeta.extra ?? ""].join("\n"));
}

/**
 * ¿Por qué un aprobador SISTEMAS NO puede con esta tarjeta? null = puede. Sin saber la tarjeta, no puede.
 * Un área desconocida solo se acepta si la tarjeta es de un repo de desarrollo (es trabajo técnico).
 */
export function vetoDeSistemas(
  persona: PersonaQueAprueba,
  tarjeta: TarjetaParaSistemas | null | undefined,
  repo: string | null,
  zonaProtegida: readonly string[],
  ahora: Date,
): string | null {
  if (!permisoDeSistemasVigente(ahora, persona.sistemasHasta)) {
    return "El permiso de prueba de Sistemas ya venció: aprueba el dueño del negocio.";
  }
  if (!tarjeta) return "No se pudo comprobar de qué área es la tarjeta: la aprueba el dueño del negocio.";
  if (zonaProtegida.length) return "Esta tarjeta toca una zona protegida: la aprueba solo el dueño, en la pantalla.";
  if (tarjetaTocaDineroOMetaAds(tarjeta, zonaProtegida)) return MENSAJE_DINERO_O_META;
  const area = leerAreaDeAlerta(tarjeta.area ?? "");
  const esTecnologia = area
    ? AREAS_DE_TECNOLOGIA.includes(area)
    : Boolean(repo) && (REPOS_DE_DESARROLLO as readonly string[]).includes(repo as string);
  return esTecnologia ? null : "Tu permiso de Sistemas cubre solo tarjetas de Tecnología (CRM Ventas, Gestión, CRM Marketplace, Coordinador y General).";
}

export function esMomento(valor: unknown): valor is MomentoDeAprobacion {
  return typeof valor === "string" && (MOMENTOS_DE_APROBACION as readonly string[]).includes(valor);
}

/** Texto en minúsculas, sin tildes y con espacios simples, para comparar lo que dijo la persona. */
function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿El texto de confirmación dice de verdad "sí, apruebo"? Al menos 8 caracteres, con la palabra "sí"
 * (o "si") y la palabra "apruebo", sin importar tildes ni mayúsculas. "No apruebo" no vale.
 */
export function textoDeConfirmacionValido(texto: unknown): Veredicto {
  const COMO = 'Tiene que ser lo que dijo la persona, por ejemplo: "sí, apruebo".';
  if (typeof texto !== "string" || texto.trim().length < 8) {
    return `Falta el texto de confirmación (mínimo 8 caracteres). ${COMO}`;
  }
  const limpio = normalizar(texto);
  if (!/(^|[^a-z])si([^a-z]|$)/.test(limpio) || !/(^|[^a-z])apruebo([^a-z]|$)/.test(limpio)) {
    return `El texto de confirmación tiene que decir "sí" y "apruebo". ${COMO}`;
  }
  if (/(^|[^a-z])no (lo )?apruebo([^a-z]|$)/.test(limpio)) {
    return 'El texto dice "no apruebo": no se aprueba.';
  }
  return null;
}

/**
 * ¿El texto de confirmación dice de verdad "sí, bórrala"? Al menos 8 caracteres, con la palabra "sí"
 * (o "si") y una palabra de borrar ("borra", "bórrala", "bórralo", "elimínala"...), sin importar
 * tildes ni mayúsculas. "No la borres" no vale. Lo usa borrar_tarjeta (borrado por voz).
 */
export function textoDeConfirmacionParaBorrar(texto: unknown): Veredicto {
  const COMO = 'Tiene que ser lo que dijo la persona, por ejemplo: "sí, bórrala".';
  if (typeof texto !== "string" || texto.trim().length < 8) {
    return `Falta el texto de confirmación (mínimo 8 caracteres). ${COMO}`;
  }
  const limpio = normalizar(texto);
  if (!/(^|[^a-z])si([^a-z]|$)/.test(limpio) || !/(^|[^a-z])(borr|elimin)[a-z]*/.test(limpio)) {
    return `El texto de confirmación tiene que decir "sí" y "borrar" (bórrala, elimínala). ${COMO}`;
  }
  if (/(^|[^a-z])no (la |lo )?(borr|elimin)/.test(limpio)) {
    return 'El texto dice "no la borres": no se borra.';
  }
  return null;
}

/**
 * ¿El texto de confirmación dice de verdad "sí, márcala hecha"? Al menos 8 caracteres, con la palabra
 * "sí" (o "si") y "hecha" o "hecho", sin importar tildes ni mayúsculas. "No la marques hecha" no vale.
 * Lo usa cambiar_estado_tarjeta para el HECHO a mano por voz.
 */
export function textoDeConfirmacionParaHecho(texto: unknown): Veredicto {
  const COMO = 'Tiene que ser lo que dijo la persona, por ejemplo: "sí, márcala hecha".';
  if (typeof texto !== "string" || texto.trim().length < 8) {
    return `Falta el texto de confirmación (mínimo 8 caracteres). ${COMO}`;
  }
  const limpio = normalizar(texto);
  if (!/(^|[^a-z])si([^a-z]|$)/.test(limpio) || !/(^|[^a-z])hech[ao]([^a-z]|$)/.test(limpio)) {
    return `El texto de confirmación tiene que decir "sí" y "hecha" (o "hecho"). ${COMO}`;
  }
  // Cualquier "no" o una pregunta (¿sí la marco hecha?) no es una orden del dueño.
  if (/(^|[^a-z])(no|nunca|tampoco)([^a-z]|$)/.test(limpio) || /[?¿]/.test(texto)) {
    return 'El texto tiene un "no" o es una pregunta: no es una orden clara de marcarla hecha.';
  }
  if (!/(^|[^a-z])(marc|pon|dej|cierr|pas|dal)[a-z]*/.test(limpio)) {
    return `El texto de confirmación tiene que decir "márcala" (o "ponla", "déjala") además de "sí" y "hecha". ${COMO}`;
  }
  return null;
}

/**
 * ¿El texto de confirmación dice de verdad "sí, escríbelo en el cerebro"? Al menos 8 caracteres, con la
 * palabra "sí" (o "si") y un verbo de escribir ("escribe", "escríbelo", "guárdalo", "anótalo", "agrégalo",
 * "pásalo"), sin importar tildes ni mayúsculas. Cualquier "no" o una pregunta no es una orden del dueño.
 * Lo usa cerebro_escribir (escribir en el Drive por voz).
 */
export function textoDeConfirmacionParaCerebro(texto: unknown): Veredicto {
  const COMO = 'Tiene que ser lo que dijo la persona, por ejemplo: "sí, escríbelo en el cerebro".';
  if (typeof texto !== "string" || texto.trim().length < 8) {
    return `Falta el texto de confirmación (mínimo 8 caracteres). ${COMO}`;
  }
  const limpio = normalizar(texto);
  if (!/(^|[^a-z])si([^a-z]|$)/.test(limpio) || !/(^|[^a-z])(escrib|guard|anot|agreg|pas|document)[a-z]*/.test(limpio)) {
    return `El texto de confirmación tiene que decir "sí" y escribir/guardar ("escríbelo", "guárdalo"). ${COMO}`;
  }
  if (/(^|[^a-z])(no|nunca|tampoco)([^a-z]|$)/.test(limpio) || /[?¿]/.test(texto)) {
    return 'El texto tiene un "no" o es una pregunta: no es una orden clara de escribirlo en el cerebro.';
  }
  return null;
}

/** Lo que se sabe de la cuenta que aprueba para decidir si es la dueña del negocio. */
export type CuentaQueAprueba = {
  nombre: string;
  correo: string | null;
  /** User.role: ADMIN (de la plataforma), EMPLEADO o CLIENTE. */
  tipoCuenta: string | null;
  /** Es miembro activo de este negocio. */
  miembroActivo: boolean;
  /** Su rol en el negocio (WorkspaceMember.role), si es miembro activo. */
  rolEnNegocio: string | null;
  /** Es la cuenta dueña registrada de este negocio (Workspace.ownerId). */
  esDuenaRegistrada: boolean;
  /** La dueña registrada del negocio, para decirla en el error. */
  duena: { nombre: string; correo: string | null } | null;
};

/**
 * ¿Esta cuenta es la dueña del negocio para el Tablero IA? Tiene que ser miembro activo y, además:
 *  - la cuenta dueña registrada de ESE negocio (Workspace.ownerId), sea CLIENTE o ADMIN de la
 *    plataforma (Alexander usa una cuenta ADMIN para su negocio); o
 *  - una cuenta CLIENTE con rol OWNER en el negocio (la regla de siempre).
 * Ser ADMIN de la plataforma por sí solo no da poder de dueño: un ADMIN que no es la dueña registrada
 * de este negocio no lo es. Solo para el Tablero IA: client-workspace-access.ts no cambia.
 */
export function esDuenoDelNegocio(cuenta: CuentaQueAprueba): boolean {
  if (!cuenta.miembroActivo) return false;
  if (cuenta.esDuenaRegistrada && (cuenta.tipoCuenta === "CLIENTE" || cuenta.tipoCuenta === "ADMIN")) return true;
  return cuenta.tipoCuenta === "CLIENTE" && cuenta.rolEnNegocio === "OWNER";
}

/**
 * Por qué esta cuenta no cuenta como dueña del negocio, con su nombre y correo, y qué hacer. null si
 * es la dueña. Por voz, la cuenta es la de la clave de Claude: la que la creó.
 */
export function motivoNoEsDueno(cuenta: CuentaQueAprueba, via: ViaDeAprobacion): string | null {
  if (esDuenoDelNegocio(cuenta)) return null;
  const quien = `${cuenta.nombre}${cuenta.correo ? ` (${cuenta.correo})` : ""}`;
  const duena = cuenta.duena
    ? `la dueña es ${cuenta.duena.nombre}${cuenta.duena.correo ? `, ${cuenta.duena.correo}` : ""}`
    : "el negocio no tiene cuenta dueña registrada";
  let motivo: string;
  if (!cuenta.miembroActivo) {
    motivo = cuenta.esDuenaRegistrada
      ? "está registrada como dueña, pero no es miembro activo de este negocio"
      : `no es miembro activo de este negocio (${duena})`;
  } else if (cuenta.tipoCuenta === "ADMIN") {
    motivo = `es ADMIN de la plataforma, pero no es la cuenta dueña de este negocio (${duena})`;
  } else if (cuenta.tipoCuenta === "CLIENTE") {
    motivo = `es CLIENTE, pero no es dueña de este negocio (${duena})`;
  } else {
    motivo = `es una cuenta ${cuenta.tipoCuenta ?? "sin tipo"}, no la dueña de este negocio (${duena})`;
  }
  if (via === "voz") {
    const queHacer =
      !cuenta.miembroActivo && cuenta.esDuenaRegistrada
        ? "Hay que volver a activarla como miembro del negocio."
        : "Crea la clave de Claude entrando con la cuenta dueña y cámbiala en Claude.";
    return `La conexión llegó con la cuenta ${quien}: ${motivo}. ${queHacer}`;
  }
  return `Entraste con la cuenta ${quien}: ${motivo}.`;
}

export type PersonaQueAprueba = {
  /** Dueña del negocio (esDuenoDelNegocio). Aprueba todo implícitamente y es la única con el sí final. */
  esDueno: boolean;
  /** ADMIN de la plataforma: como en la fase 1, aprueba la tarea y el plan en la pantalla. */
  esAdminPlataforma: boolean;
  /** Su fila en AprobadorTablero, si la tiene. */
  aprobador: { alcance: string; puedeSubir: boolean } | null;
  /** Último día (AAAA-MM-DD) del permiso de un aprobador SISTEMAS; sin valor, PRUEBA_SISTEMAS_HASTA. */
  sistemasHasta?: string;
  /** La cuenta, para decir en el error con quién llegó y por qué no es la dueña. */
  cuenta?: CuentaQueAprueba;
};

/** " " + el motivo de por qué no es la dueña, si se sabe la cuenta; "" si no. */
function conLaCuenta(persona: PersonaQueAprueba, via: ViaDeAprobacion) {
  const motivo = persona.cuenta ? motivoNoEsDueno(persona.cuenta, via) : null;
  return motivo ? ` ${motivo}` : "";
}

export type PedidoDeAprobacion = {
  momento: unknown;
  via: ViaDeAprobacion;
  origen: OrigenCambio;
  estado: EstadoTarjetaTablero;
  requiereAprobacion: boolean;
  usaEstados: boolean;
  repo: string | null;
  zonaProtegida: readonly string[];
  tienePlan: boolean;
  /** resultado.paso del Coordinador (solo cuenta true). */
  resultadoPaso: boolean;
  textoConfirmacion?: unknown;
  persona: PersonaQueAprueba;
  /**
   * La vía de la última aprobación vigente (del historial; null si no hay). Con ella, una APROBADO o PLAN_APROBADO que
   * espera la pantalla (aprobada por voz y toca LIBRO_V3 / META_ADS, 28-oct-2026) se puede volver a aprobar en la pantalla.
   */
  viaDeLaUltimaAprobacion?: string | null;
  /** La tarjeta (para el aprobador SISTEMAS: su área y si toca dinero o Meta Ads). */
  tarjeta?: TarjetaParaSistemas | null;
  /** El momento de la aprobación (solo cambia la vigencia del permiso de prueba; por defecto, ahora). */
  ahora?: Date;
};

/** ¿Esta persona puede aprobar este momento de esta tarjeta? (sin mirar el estado) */
export function personaPuedeAprobarMomento(
  persona: PersonaQueAprueba,
  momento: MomentoDeAprobacion,
  via: ViaDeAprobacion,
  repo: string | null,
  zonaProtegida: readonly string[],
  tarjeta?: TarjetaParaSistemas | null,
  ahora: Date = new Date(),
): Veredicto {
  const esSistemas = !persona.esDueno && persona.aprobador?.alcance === ALCANCE_SISTEMAS;
  if (momento === "subir") {
    // Emanuel (prueba): da el sí final solo en lo suyo; todo lo demás sigue siendo del dueño.
    if (esSistemas) return vetoDeSistemas(persona, tarjeta, repo, zonaProtegida, ahora);
    const puede = persona.esDueno || (!SI_FINAL_SOLO_DUENO && Boolean(persona.aprobador?.puedeSubir));
    return puede ? null : `El sí final (subir a producción) lo da solo el dueño del negocio.${conLaCuenta(persona, via)}`;
  }
  if (zonaProtegida.length && !persona.esDueno) {
    return `Esta tarjeta toca una zona protegida: la aprueba solo el dueño, en la pantalla.${conLaCuenta(persona, via)}`;
  }
  if (persona.esDueno) return null;
  if (via === "pantalla" && persona.esAdminPlataforma) return null;
  const alcance = persona.aprobador?.alcance;
  if (alcance === ALCANCE_SISTEMAS) return vetoDeSistemas(persona, tarjeta, repo, zonaProtegida, ahora);
  if (alcance === "TODO") return null;
  if (alcance === "DESARROLLO") {
    return repo && (REPOS_DE_DESARROLLO as readonly string[]).includes(repo)
      ? null
      : "Tu alcance es DESARROLLO: apruebas solo tarjetas con repo gestion o aizencrm.";
  }
  return `No puedes aprobar en este tablero: aprueba el dueño del negocio o un aprobador que él agregue.${conLaCuenta(persona, via)}`;
}

/**
 * ¿A qué estado pasa la tarjeta al aprobar ese momento desde ese estado? Error si no corresponde.
 *  - tarea: POR_APROBAR -> APROBADO; desde ERROR (reintentar) -> APROBADO, y el Coordinador planea de nuevo.
 *  - plan:  PLAN_LISTO -> PLAN_APROBADO; desde ERROR (reintentar con el mismo plan) -> PLAN_APROBADO.
 *  - subir: POR_REVISAR con resultado.paso = true -> SUBIENDO (pendiente: lo toma el Coordinador).
 *  - `esperaLaPantalla` (28-oct-2026): una APROBADO / PLAN_APROBADO que el Coordinador no toma por la vía de su aprobación
 *    se vuelve a aprobar (queda en el mismo estado, con la aprobación nueva en el historial).
 */
export function destinoDeLaAprobacion(
  momento: MomentoDeAprobacion,
  estado: EstadoTarjetaTablero,
  datos: { repo: string | null; tienePlan: boolean; resultadoPaso: boolean; esperaLaPantalla?: boolean },
): { a: EstadoTarjetaTablero } | { error: string } {
  if (momento === "tarea") {
    if (estado === "POR_APROBAR") return { a: "APROBADO" };
    if (estado === "ERROR") return { a: "APROBADO" };
    if (estado === "APROBADO" && datos.esperaLaPantalla) return { a: "APROBADO" };
    if (estado === "APROBADO") return { error: "La tarea ya está aprobada." };
    return { error: `La tarea se aprueba cuando está POR_APROBAR (o se reintenta desde ERROR). Está ${estado}.` };
  }
  if (!datos.repo) {
    return { error: "Esta tarjeta no tiene repo: no la ejecuta el Coordinador, así que no tiene plan ni subida. Se aprueba la tarea." };
  }
  if (momento === "plan") {
    if (estado === "PLAN_APROBADO" && datos.esperaLaPantalla && datos.tienePlan) return { a: "PLAN_APROBADO" };
    if (estado !== "PLAN_LISTO" && estado !== "ERROR") {
      return { error: `El plan se aprueba cuando está PLAN_LISTO (o se reintenta desde ERROR). Está ${estado}.` };
    }
    if (!datos.tienePlan) return { error: "La tarjeta no tiene plan todavía: no hay plan que aprobar." };
    return { a: "PLAN_APROBADO" };
  }
  if (estado !== "POR_REVISAR") {
    return { error: `Subir a producción se aprueba cuando está POR_REVISAR. Está ${estado}.` };
  }
  if (!datos.resultadoPaso) {
    return { error: "El Coordinador no dijo que todo pasó (resultado.paso no es sí): no se sube. Revisa el resultado." };
  }
  return { a: "SUBIENDO" };
}

/** La regla completa de una aprobación (la pantalla y aprobar_tarjeta del MCP). */
export function puedeAprobarMomento(pedido: PedidoDeAprobacion): { a: EstadoTarjetaTablero; momento: MomentoDeAprobacion } | { error: string } {
  if (!esMomento(pedido.momento)) {
    return { error: `Momento desconocido. Van: ${MOMENTOS_DE_APROBACION.join(", ")}.` };
  }
  const momento = pedido.momento;
  if (!pedido.requiereAprobacion || !pedido.usaEstados) {
    return { error: "Ese tipo de tarjeta no pide aprobación: no hay nada que aprobar." };
  }
  if (pedido.origen === "TRABAJADOR") {
    return { error: "El Coordinador nunca aprueba." };
  }
  if ((pedido.origen === "MCP") !== (pedido.via === "voz")) {
    return { error: "Por el MCP se aprueba solo con la confirmación de la persona (via voz); en la pantalla, con el botón." };
  }
  if (pedido.via === "voz") {
    // Bot de ventas, Meta Ads, libro V3 y chats se aprueban también por voz (chats desde el 26-oct-2026).
    const soloPantalla = zonasQuePidenTuSi(pedido.zonaProtegida);
    if (soloPantalla.length) {
      return {
        error: `Esta tarjeta toca una zona protegida (${soloPantalla.join(", ")}): se aprueba solo en la pantalla.`,
      };
    }
    const texto = textoDeConfirmacionValido(pedido.textoConfirmacion);
    if (texto) return { error: texto };
  }
  const quien = personaPuedeAprobarMomento(pedido.persona, momento, pedido.via, pedido.repo, pedido.zonaProtegida, pedido.tarjeta, pedido.ahora);
  if (quien) return { error: quien };
  const destino = destinoDeLaAprobacion(momento, pedido.estado, {
    repo: pedido.repo,
    tienePlan: pedido.tienePlan,
    resultadoPaso: pedido.resultadoPaso,
    // Solo en la pantalla: volver a aprobar por voz no la destraba (para LIBRO_V3 / META_ADS la voz no basta).
    esperaLaPantalla:
      pedido.via === "pantalla" &&
      pedido.viaDeLaUltimaAprobacion !== undefined &&
      !laAprobacionDejaArrancar(pedido.zonaProtegida, pedido.viaDeLaUltimaAprobacion),
  });
  if ("error" in destino) return destino;
  return { a: destino.a, momento };
}

/** Lo que queda en `HistorialTarjeta.despues` de una aprobación. */
export type RegistroDeAprobacion = {
  estado: EstadoTarjetaTablero;
  momento: MomentoDeAprobacion;
  via: ViaDeAprobacion;
  quienNombre: string;
  userId: string;
  textoConfirmacion: string | null;
  /** "aprobado por voz" o "aprobado en pantalla". */
  como: string;
  /** true cuando aprobó Emanuel con el permiso de prueba de Sistemas (queda marcado en el historial). */
  periodoDePrueba?: true;
};

export function registroDeAprobacion(datos: Omit<RegistroDeAprobacion, "como">): RegistroDeAprobacion {
  const como = datos.via === "voz" ? "aprobado por voz" : "aprobado en pantalla";
  return { ...datos, como: datos.periodoDePrueba ? `${como} (periodo de prueba)` : como };
}

/* ───────────────────────────────────────────────────────────────────── hecho a mano ── */

export const MAXIMO_NOTA_HECHO_A_MANO = 500;

/**
 * El commit de un HECHO a mano: el código del cambio (de 7 a 40 letras y números) o un link de GitHub.
 * null si no vino (es opcional); el texto limpio si está bien; { error } si está mal escrito.
 */
export function commitDeEntrada(valor: unknown): string | null | { error: string } {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "string") return { error: "El commit tiene que ser texto: el código (7 a 40 letras y números) o un link de GitHub." };
  const limpio = valor.trim();
  if (!limpio) return null;
  if (/^[0-9a-f]{7,40}$/i.test(limpio)) return limpio;
  if (/^https:\/\/github\.com\/\S+$/i.test(limpio) && limpio.length <= 300) return limpio;
  return { error: "El commit está mal escrito: tiene que ser el código del cambio (7 a 40 letras y números, como abc1234) o un link de GitHub (https://github.com/...)." };
}

export type PedidoDeHechoAMano = {
  via: ViaDeAprobacion;
  origen: OrigenCambio;
  estado: EstadoTarjetaTablero;
  usaEstados: boolean;
  repo: string | null;
  textoConfirmacion?: unknown;
  nota: unknown;
  commit?: unknown;
  persona: PersonaQueAprueba;
};

/**
 * La regla de "marcar hecho a mano": una tarjeta CON repo en ERROR, FALLIDO o POR_REVISAR (nunca
 * mientras el Coordinador la tiene) la pasa a HECHO solo el dueño del negocio, con una nota obligatoria
 * (hasta 500 letras) y el commit opcional. Por voz (MCP), además, el texto "sí, márcala hecha". Devuelve
 * la nota y el commit ya limpios, o el error.
 */
export function puedeMarcarHechoAMano(
  pedido: PedidoDeHechoAMano,
): { nota: string; commit: string | null } | { error: string } {
  if (!pedido.usaEstados) return { error: "Las tarjetas de ese tipo (como Área) son carpetas: no tienen estado." };
  if (pedido.origen === "TRABAJADOR") return { error: "El Coordinador no marca hecho a mano." };
  if ((pedido.origen === "MCP") !== (pedido.via === "voz")) {
    return { error: "Por el MCP se marca solo con la confirmación del dueño (via voz); en la pantalla, con el botón." };
  }
  if (!pedido.repo) return { error: "Esta tarjeta no tiene repo: el HECHO a mano es solo para las que ejecuta el Coordinador." };
  if (estaTrabajando(pedido.estado)) {
    return { error: `El Coordinador tiene esta tarjeta en este momento (${pedido.estado}): no se marca hecha hasta que termine o falle.` };
  }
  if (!sePuedeMarcarHechoAMano(pedido.estado)) {
    return { error: `Solo se marca hecha a mano una tarjeta en ERROR, FALLIDO o POR_REVISAR. Está ${pedido.estado}.` };
  }
  if (pedido.via === "voz") {
    const texto = textoDeConfirmacionParaHecho(pedido.textoConfirmacion);
    if (texto) return { error: `${texto} ${COMO_MARCAR_HECHO_A_MANO}` };
  }
  if (!pedido.persona.esDueno) {
    return { error: `Marcar hecho a mano lo hace solo el dueño del negocio.${conLaCuenta(pedido.persona, pedido.via)}` };
  }
  const nota = typeof pedido.nota === "string" ? pedido.nota.trim() : "";
  if (!nota) return { error: "Falta la nota: escribe en pocas palabras qué se hizo por fuera." };
  if (nota.length > MAXIMO_NOTA_HECHO_A_MANO) {
    return { error: `La nota es muy larga (máximo ${MAXIMO_NOTA_HECHO_A_MANO} letras).` };
  }
  const commit = commitDeEntrada(pedido.commit);
  if (commit !== null && typeof commit === "object") return commit;
  return { nota, commit };
}

/** Lo que queda en `HistorialTarjeta.despues` de un HECHO a mano (la acción es "estado"). */
export type RegistroDeHechoAMano = {
  estado: "HECHO";
  hechoAMano: true;
  via: ViaDeAprobacion;
  quienNombre: string;
  userId: string;
  nota: string;
  commit: string | null;
  textoConfirmacion: string | null;
  /** "marcado hecho a mano por el dueño (nombre)". */
  como: string;
};

export function registroDeHechoAMano(datos: Omit<RegistroDeHechoAMano, "estado" | "hechoAMano" | "como">): RegistroDeHechoAMano {
  return { ...datos, estado: "HECHO", hechoAMano: true, como: `marcado hecho a mano por el dueño (${datos.quienNombre})` };
}

/** ¿Este cambio del historial es un HECHO a mano? Lo dice su `despues`. */
export function esHechoAMano(cambio: { accion: string; despues: unknown }) {
  const despues = cambio.despues as { hechoAMano?: unknown } | null;
  return cambio.accion === "estado" && despues?.hechoAMano === true;
}

/* ───────────────────────────────────────────────────────────────────── el resultado ── */

export type ResultadoDelTrabajador = {
  resumen: string;
  pruebas: string;
  paso: boolean;
  rama: string | null;
  linkRama: string | null;
  commit: string | null;
  migracion: string | null;
  /** El Coordinador la quiere subir sola (su `subirSolo` está prendido). El CRM decide (destinoDelResultado). */
  subeSolo: boolean;
  /** El commit de main sobre el que construyó: si main no cambió, al subir no vuelve a compilar. */
  base: string | null;
  /** Qué motor hizo cada paso (23-oct-2026): { plan, construir, revisar } = "claude" | "codex". Solo si vino. */
  motor?: MotoresDelResultado;
  /** Qué modelo (Opus, Sonnet...) hizo cada paso. Lo elige el Coordinador con reglas fijas. Solo si vino. */
  modelo?: ModelosDelResultado;
  /** Los archivos que de verdad cambió (para la última revisión de riesgo). Solo si vino. */
  archivos?: string[];
  /** Lo destructivo que encontró en la migración nueva (DROP, UPDATE...). [] = nada. Solo si vino. */
  migracionDestructiva?: string[];
  /** Dónde se construyó (25-oct-2026): "aizen1" o "nube". Solo si vino (un Coordinador viejo no lo manda). */
  construidoEn?: LugarDeConstruccion;
  /** El link de la sesión de Claude en la nube (solo claude.ai/code/session_…). Solo si se construyó en la nube. */
  linkSesion?: string;
  /** Cuántos segundos dijo la nube que tardó (la línea "resultado:" de su commit). */
  segundosNube?: number;
  /** El link de la corrida del workflow de GitHub Actions que probó la rama (solo github.com). Solo si vino. */
  linkWorkflow?: string;
  /** Dónde se compiló y probó: "github-actions" (la corrida de arriba), "aizen1" o "nube". Solo si vino. */
  verificadoEn?: VerificadoEn;
  /**
   * Por qué NO sube sola aunque su zona suba sola (24-oct-2026): "gasto en Meta Ads", "falta la simulación V3",
   * "mensaje nuevo a clientes". Lo escribe el Coordinador; la tarjeta lo muestra como "espera tu sí (motivo)" (solo si es gasto en Meta Ads o una zona que no sea de
   * CHATS / BOT_VENTAS) o, en CHATS / BOT_VENTAS, como el motivo del ERROR "construido, no sube: ...".
   */
  esperaPor?: string;
};

export type VerificadoEn = "github-actions" | "aizen1" | "nube";

export type MotoresDelResultado = Partial<Record<"plan" | "construir" | "revisar", "claude" | "codex">>;

/** Los motores que manda el Coordinador, limpios: solo pasos y motores conocidos. */
function motoresDeEntrada(valor: unknown): MotoresDelResultado | null {
  if (!valor || typeof valor !== "object") return null;
  const motores: MotoresDelResultado = {};
  for (const paso of ["plan", "construir", "revisar"] as const) {
    const motor = (valor as Record<string, unknown>)[paso];
    if (motor === "claude" || motor === "codex") motores[paso] = motor;
  }
  return Object.keys(motores).length ? motores : null;
}

const textoCorto = (valor: unknown, maximo: number) => (typeof valor === "string" ? valor.trim().slice(0, maximo) : "");
const textoONull = (valor: unknown, maximo: number) => textoCorto(valor, maximo) || null;

/** Lo que manda el Coordinador en /resultado, limpio. Un link que no sea https no se guarda. */
export function resultadoDeEntrada(valor: unknown): ResultadoDelTrabajador {
  const datos = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
  const resumen = textoCorto(datos.resumen, 8000);
  if (!resumen) throw new Error("Falta el resumen del resultado.");
  const link = textoONull(datos.linkRama, 500);
  const motor = motoresDeEntrada(datos.motor);
  const modelo = modelosDeEntrada(datos.modelo);
  const archivos = archivosDeEntrada(datos.archivos);
  const destructivo = migracionDestructivaDeEntrada(datos.migracionDestructiva);
  const construidoEn: LugarDeConstruccion | null = datos.construidoEn === "nube" || datos.construidoEn === "aizen1" ? datos.construidoEn : null;
  // El link solo se guarda si se construyó en la nube y es de claude.ai (nada de otros sitios).
  const linkSesion = construidoEn === "nube" ? linkDeSesionDeEntrada(datos.linkSesion) : null;
  const segundosNube = construidoEn === "nube" && typeof datos.segundosNube === "number" && Number.isFinite(datos.segundosNube) && datos.segundosNube >= 0 ? Math.round(datos.segundosNube) : null;
  // El link del workflow solo se guarda si es de github.com (nada de otros sitios).
  const enlaceWorkflow = textoONull(datos.linkWorkflow, 500);
  const linkWorkflow = enlaceWorkflow && /^https:\/\/github\.com\//.test(enlaceWorkflow) ? enlaceWorkflow : null;
  const esperaPor = textoONull(datos.esperaPor, 200);
  const verificadoEn: VerificadoEn | null = datos.verificadoEn === "github-actions" || datos.verificadoEn === "aizen1" || datos.verificadoEn === "nube" ? datos.verificadoEn : null;
  return {
    ...(construidoEn ? { construidoEn } : {}),
    ...(linkWorkflow ? { linkWorkflow } : {}),
    ...(verificadoEn ? { verificadoEn } : {}),
    ...(linkSesion ? { linkSesion } : {}),
    ...(segundosNube !== null ? { segundosNube } : {}),
    ...(motor ? { motor } : {}),
    ...(modelo ? { modelo } : {}),
    // Se guardan 100; la revisión de riesgo (trabajador.ts) mira la lista completa (hasta 300) del cuerpo.
    ...(archivos ? { archivos: archivos.slice(0, 100) } : {}),
    // Un `true` suelto (sin lista) se guarda como ["algo"]: no se pierde la señal de migración destructiva.
    ...(Array.isArray(destructivo) ? { migracionDestructiva: destructivo } : destructivo === true ? { migracionDestructiva: ["algo"] } : {}),
    resumen,
    pruebas: textoCorto(datos.pruebas, 8000),
    paso: datos.paso === true,
    rama: textoONull(datos.rama, 200),
    linkRama: link && /^https:\/\//.test(link) ? link : null,
    commit: textoONull(datos.commit, 80),
    migracion: textoONull(datos.migracion, 300),
    subeSolo: datos.subeSolo === true,
    base: textoONull(datos.base, 80),
    ...(esperaPor ? { esperaPor } : {}),
  };
}

/** Lo que vigiló el Coordinador 30 minutos después de subir una tarjeta de zona que sube sola. */
export type VigilanciaDeLaSubida = {
  zona: string;
  minutos: number;
  ok: boolean;
};

export function vigilanciaDeEntrada(valor: unknown): VigilanciaDeLaSubida | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const datos = valor as Record<string, unknown>;
  const zona = textoCorto(datos.zona, 80);
  if (!zona) return null;
  const minutos = typeof datos.minutos === "number" && Number.isFinite(datos.minutos) && datos.minutos >= 0 ? Math.round(datos.minutos) : 0;
  return { zona, minutos, ok: datos.ok === true };
}

/** La frase de la tarjeta cuando subió sola y se vigiló: "Subió sola (zona X) — vigilancia 30 min OK". */
export function fraseDeLaVigilancia(vigilancia: VigilanciaDeLaSubida): string {
  const zona = vigilancia.zona
    .split(",")
    .map((una) => una.trim())
    .map((una) => (esZona(una) ? NOMBRE_DE_LA_ZONA[una] : una))
    .join(", ");
  return `Subió sola (zona ${zona}) — vigilancia ${vigilancia.minutos} min OK`;
}

/**
 * Las 3 líneas fijas con que el agente termina de construir (26-oct-2026): "Qué se hizo:", "Qué se ve ahora:" y
 * "Qué revisar juntos:". El Coordinador las manda con la subida; cada una se recorta y las vacías se descartan.
 * Sin ninguna, null (el resumen del día se ve como antes).
 */
export type ResumenDeTresLineas = { hizo?: string; ahora?: string; revisar?: string };

export function resumenDeTresLineasDeEntrada(valor: unknown): ResumenDeTresLineas | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const datos = valor as Record<string, unknown>;
  const limpia = (dato: unknown) => textoCorto(dato, 300).replace(/\s+/g, " ").trim();
  const hizo = limpia(datos.hizo);
  const ahora = limpia(datos.ahora);
  const revisar = limpia(datos.revisar);
  if (!hizo && !ahora && !revisar) return null;
  return { ...(hizo ? { hizo } : {}), ...(ahora ? { ahora } : {}), ...(revisar ? { revisar } : {}) };
}

/** Un link https (el del commit en GitHub), o null. */
export function linkDeEntrada(valor: unknown): string | null {
  const link = textoONull(valor, 500);
  return link && /^https:\/\//.test(link) ? link : null;
}

/** El plan como lo manda el trabajador: texto con saltos, no vacío, máximo 20.000 caracteres. */
export function planDeEntrada(valor: unknown): string {
  const plan = typeof valor === "string" ? valor.replace(/\r\n/g, "\n").trim().slice(0, 20_000) : "";
  if (!plan) throw new Error("Falta el plan.");
  return plan;
}

export type ReversionDelTrabajador = {
  /** El commit que se subió y no arrancó. */
  commit: string | null;
  /** El commit del revert en main (null si no se pudo deshacer). */
  revert: string | null;
  /** true = se deshizo; false = no se pudo (URGENTE: revisar a mano). */
  ok: boolean;
};

/** La reversión que manda el Coordinador en /error cuando el despliegue falló después de subir, o null. */
export function reversionDeEntrada(valor: unknown): ReversionDelTrabajador | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const datos = valor as Record<string, unknown>;
  return { commit: textoONull(datos.commit, 80), revert: textoONull(datos.revert, 80), ok: datos.ok === true };
}

/**
 * Lo que se guarda cuando el Coordinador manda a ERROR (o a reparar) sin motivo (30-oct-2026): nunca un texto vacío ni
 * uno sin datos, para que la tarjeta diga al menos en qué etapa y en qué intento pasó.
 */
export function sinMotivoDelCoordinador(etapa: string, intento: number, que: "motivo" | "causa" = "motivo"): string {
  return `El Coordinador no mandó ${que} (etapa ${etapa}, intento ${intento}).`;
}

/** El motivo de un error del Coordinador. */
export function motivoDeEntrada(valor: unknown, porDefecto = "El Coordinador no dijo el motivo."): string {
  const motivo = typeof valor === "string" ? valor.trim().slice(0, 4000) : "";
  return motivo || porDefecto;
}

/* ───────────────────────────────────────────────────────────────────── reparar, partir y esperar ── */

/*
  Cuando algo falla (24-oct-2026), el Coordinador diagnostica (categoría y causa en una línea), repara (no
  repite lo mismo), parte la tarjeta si es muy grande, espera si es el límite de Claude, y escala al dueño
  con un resumen de máximo 3 líneas después de TOPE_DE_REPARACIONES reparaciones. Cada paso deja una fila en
  IntentoTarjeta (el historial que se ve en la tarjeta). Las categorías y acciones son las mismas en el
  Coordinador (trabajador-tablero/lib/diagnostico.mjs).
*/

/** Cuántas reparaciones seguidas se le permiten a una tarjeta; la siguiente falla se escala al dueño. */
export const TOPE_DE_REPARACIONES = 3;
/** Cuántas esperas seguidas (sin contar como intento) aguanta antes de escalar. */
export const TOPE_DE_ESPERAS_SEGUIDAS = 5;
/** En cuántas partes se puede partir una tarjeta (de 2 a 4). */
export const MAXIMO_DE_PARTES = 4;
export const MINIMO_DE_PARTES = 2;

export const CATEGORIAS_DE_INTENTO = [
  "limite_claude",
  "pc_sobrecargado",
  "tiempo_agotado",
  "no_compila",
  "fallan_pruebas",
  "lint",
  "choca_con_main",
  "migracion",
  "no_cambio_nada",
  "carpeta_trabada",
  "tarea_muy_grande",
  "coordinador_cortado",
  "sesion_atascada",
  // 29-oct-2026: la nube no dejó resultado (o no dio señal) / dejó un commit "pregunta:" / el plan tiene preguntas abiertas.
  // El Coordinador no las repara solas: van directo a ERROR con el link (diagnostico.mjs: SIN_REPARACION_AUTOMATICA).
  "nube_sin_resultado",
  "nube_pregunta",
  "plan_con_preguntas",
  // 29-oct-2026: los 4 revisores (seguridad, experiencia, diseño, código) siguieron pidiendo cambios tras 2 vueltas de
  // corrección (trabajador-tablero/lib/revisores.mjs). Tampoco se repara sola: va a ERROR con lo que pidió el revisor.
  "revision_no_paso",
  // 29-oct-2026: la sesión de la nube iba a quedar sin el repo conectado (o la sesión fija del proyecto no responde): no puede subir
  // su rama. Tampoco se repara sola (trabajador-tablero/lib/nube.mjs: chequeo previo).
  "nube_sin_acceso_repo",
  // 31-oct-2026: lo nuevo de main y la tarea no encajan aunque el rebase no tuvo conflicto de texto. Siempre escala, no se
  // repara sola (diagnostico.mjs: SIN_REPARACION_AUTOMATICA).
  "choque_de_logica",
  "otra",
] as const;
export type CategoriaDeIntento = (typeof CATEGORIAS_DE_INTENTO)[number];

export const ACCIONES_DE_INTENTO = ["reparar", "partir", "esperar", "escalar"] as const;
export type AccionDeIntento = (typeof ACCIONES_DE_INTENTO)[number];

/** Cómo se dice en la pantalla lo que se hizo en cada intento. */
export const NOMBRE_DE_LA_ACCION_DE_INTENTO: Record<AccionDeIntento, string> = {
  reparar: "Reparó",
  partir: "La partió",
  esperar: "Esperó",
  escalar: "Te la pasó",
};

export const MAXIMO_CAUSA_DEL_INTENTO = 200;
export const MAXIMO_ERROR_DEL_INTENTO = 6000;
export const MAXIMO_LINEAS_DEL_RESUMEN = 3;
const MAXIMO_LINEA_DEL_RESUMEN = 300;
const MAXIMO_TITULO_DE_LA_PARTE = 120;
const MAXIMO_DETALLE_DE_LA_PARTE = 4000;
const MAXIMO_TITULO_DE_LA_TARJETA = 200;

export function esCategoria(valor: unknown): valor is CategoriaDeIntento {
  return typeof valor === "string" && (CATEGORIAS_DE_INTENTO as readonly string[]).includes(valor);
}

/** La categoría que manda el Coordinador: null si no vino, "otra" si no es una de la lista. */
export function categoriaDeEntrada(valor: unknown): CategoriaDeIntento | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const limpia = valor.trim().toLowerCase();
  return esCategoria(limpia) ? limpia : "otra";
}

/** La causa en UNA línea (la primera con texto, espacios simples, máximo 200 letras). */
export function causaDeEntrada(valor: unknown, porDefecto = "El Coordinador no dijo la causa."): string {
  const lineas = typeof valor === "string" ? valor.split(/\r?\n/) : [];
  const primera = lineas.map((linea) => linea.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  return primera.slice(0, MAXIMO_CAUSA_DEL_INTENTO) || porDefecto;
}

/** El error técnico de un intento, recortado a 6000 letras; null si no vino. */
export function errorDeIntentoDeEntrada(valor: unknown): string | null {
  const texto = typeof valor === "string" ? valor.trim().slice(0, MAXIMO_ERROR_DEL_INTENTO) : "";
  return texto || null;
}

/** El resumen que escribe el Coordinador al escalar: máximo 3 líneas con texto (cada una hasta 300 letras). */
export function resumenDeEscalada(valor: unknown, porDefecto = "El Coordinador no dijo el motivo."): string {
  const lineas = (typeof valor === "string" ? valor.split(/\r?\n/) : [])
    .map((linea) => linea.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, MAXIMO_LINEAS_DEL_RESUMEN)
    .map((linea) => linea.slice(0, MAXIMO_LINEA_DEL_RESUMEN));
  return lineas.join("\n") || porDefecto;
}

/** La estrategia que sugiere el Coordinador al reparar: solo se anota ("opus" | "partir"); null si no vino o no es una. */
export function estrategiaDeEntrada(valor: unknown): "opus" | "partir" | null {
  const limpia = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  return limpia === "opus" || limpia === "partir" ? limpia : null;
}

/** La causa con la estrategia anotada al final, sin pasar de 200 letras. */
export function causaConEstrategia(causa: string, estrategia: "opus" | "partir" | null): string {
  if (!estrategia) return causa;
  const cola = ` (estrategia: ${estrategia})`;
  return `${causa.slice(0, MAXIMO_CAUSA_DEL_INTENTO - cola.length)}${cola}`;
}

/** La etapa del intento: la que dice el Coordinador si es válida; si no, la que corresponde al estado de la tarjeta. */
export function etapaDeEntrada(valor: unknown, estado: EstadoTarjetaTablero): EtapaDelTrabajador {
  const limpia = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (limpia === "planear" || limpia === "construir" || limpia === "subir") return limpia;
  return ETAPA_DEL_ESTADO[estado] ?? "construir";
}

/** A qué estado de la fila vuelve una tarjeta que se repara (sin ERROR). */
export function estadoTrasReparar(estado: EstadoTarjetaTablero): EstadoTarjetaTablero {
  return estado === "PLANEANDO" ? "APROBADO" : "PLAN_APROBADO";
}

/** ¿Se puede reparar una vez más? Con TOPE_DE_REPARACIONES hechas, no: el Coordinador tiene que escalar (/error). */
export function puedeReparar(reparaciones: number): Veredicto {
  return reparaciones >= TOPE_DE_REPARACIONES
    ? `Ya lleva ${reparaciones} reparaciones (el tope es ${TOPE_DE_REPARACIONES}): escala con /error y un resumen para el dueño.`
    : null;
}

/** Las esperas seguidas: las filas que no cuentan como intento después de la última que sí cuenta (lista del más viejo al más nuevo). */
export function esperasSeguidas(intentos: readonly { cuentaComoIntento: boolean }[]): number {
  let esperas = 0;
  for (let i = intentos.length - 1; i >= 0 && !intentos[i].cuentaComoIntento; i -= 1) esperas += 1;
  return esperas;
}

/**
 * Cuántos choques con main seguidos se reconstruyen sin gastar una reparación (31-oct-2026); el siguiente escala. Igual a
 * TOPE_DE_CHOQUES_SEGUIDOS de trabajador-tablero/lib/diagnostico.mjs.
 */
export const TOPE_DE_CHOQUES_SEGUIDOS = 3;

/** Los choques con main seguidos: las filas choca_con_main entre las que no cuentan después de la última que sí cuenta. */
export function choquesSeguidos(intentos: readonly { cuentaComoIntento: boolean; categoria: string }[]): number {
  let choques = 0;
  for (let i = intentos.length - 1; i >= 0 && !intentos[i].cuentaComoIntento; i -= 1) {
    if (intentos[i].categoria === "choca_con_main") choques += 1;
  }
  return choques;
}

/** ¿Se puede reconstruir un choque con main sin contarlo? Con TOPE_DE_CHOQUES_SEGUIDOS seguidos, no: escala con /error. */
export function puedeReconstruirPorChoque(choques: number): Veredicto {
  return choques >= TOPE_DE_CHOQUES_SEGUIDOS
    ? `Ya chocó con main ${choques} veces seguidas (el tope es ${TOPE_DE_CHOQUES_SEGUIDOS}): escala con /error y un resumen para el dueño.`
    : null;
}

export type ParteDeLaTarjeta = { titulo: string; detalle: string };

/** Las partes que manda el Coordinador en /partir: de 2 a 4, cada una con título y detalle. Lanza si no cumplen. */
export function partesDeEntrada(valor: unknown): ParteDeLaTarjeta[] {
  if (!Array.isArray(valor)) throw new Error(`Faltan las partes: manda de ${MINIMO_DE_PARTES} a ${MAXIMO_DE_PARTES}.`);
  if (valor.length < MINIMO_DE_PARTES || valor.length > MAXIMO_DE_PARTES) {
    throw new Error(`Se parte en ${MINIMO_DE_PARTES} a ${MAXIMO_DE_PARTES} partes (llegaron ${valor.length}).`);
  }
  return valor.map((cruda, indice) => {
    const parte = (cruda && typeof cruda === "object" ? cruda : {}) as Record<string, unknown>;
    const titulo = textoCorto(parte.titulo, MAXIMO_TITULO_DE_LA_PARTE).replace(/\s+/g, " ");
    const detalle = textoCorto(parte.detalle, MAXIMO_DETALLE_DE_LA_PARTE);
    if (!titulo) throw new Error(`A la parte ${indice + 1} le falta el título.`);
    if (!detalle) throw new Error(`A la parte ${indice + 1} le falta el detalle.`);
    return { titulo, detalle };
  });
}

/** "<título de la madre> — parte N: <título>", sin pasar de 200 letras (se recorta el de la madre). */
export function tituloDeLaParte(tituloMadre: string, numero: number, titulo: string): string {
  const cola = ` — parte ${numero}: ${titulo}`;
  if (cola.length >= MAXIMO_TITULO_DE_LA_TARJETA) return `Parte ${numero}: ${titulo}`.slice(0, MAXIMO_TITULO_DE_LA_TARJETA);
  return `${tituloMadre.slice(0, MAXIMO_TITULO_DE_LA_TARJETA - cola.length)}${cola}`;
}

/** El detalle de una parte: empieza con "Parte N de M de «<título de la madre>»." y sigue lo que toca hacer. */
export function detalleDeLaParte(tituloMadre: string, numero: number, total: number, detalle: string): string {
  return `Parte ${numero} de ${total} de «${tituloMadre}».\n\n${detalle}`;
}

export type PartidaDelResultado = { hijas: string[]; causa: string; cuando: string };

/** `resultado.partida` de una madre partida (o null si no está partida). */
export function partidaDelResultado(resultado: unknown): PartidaDelResultado | null {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return null;
  const partida = (resultado as Record<string, unknown>).partida;
  if (!partida || typeof partida !== "object" || Array.isArray(partida)) return null;
  const datos = partida as Record<string, unknown>;
  const hijas = Array.isArray(datos.hijas) ? datos.hijas.filter((id): id is string => typeof id === "string") : [];
  if (!hijas.length) return null;
  return {
    hijas,
    causa: typeof datos.causa === "string" ? datos.causa : "",
    cuando: typeof datos.cuando === "string" ? datos.cuando : "",
  };
}

/** ¿Se puede partir? No si ya está partida ni si es una parte (esParte). */
export function puedePartir(datos: { yaPartida: boolean; esParte: boolean }): Veredicto {
  if (datos.yaPartida) return "La tarjeta ya está partida.";
  if (datos.esParte) return "Esta tarjeta ya es una parte de otra: no se parte más (repárala o escálala).";
  return null;
}

/**
 * ¿Poner `origenId -> destinoId` como dependencia crearía un ciclo? Sí si ya hay un camino de dependencias
 * de destino a origen (o si son la misma tarjeta): entonces ninguna de las dos se podría tomar nunca.
 * `dependencias` son las flechas que ya son dependencia (esDependencia = true).
 */
export function dependenciaHaceCiclo(
  dependencias: readonly { origenId: string; destinoId: string }[],
  origenId: string,
  destinoId: string,
): boolean {
  if (origenId === destinoId) return true;
  const visto = new Set<string>([destinoId]);
  const pendientes = [destinoId];
  while (pendientes.length) {
    const actual = pendientes.pop() as string;
    for (const flecha of dependencias) {
      if (flecha.origenId !== actual || visto.has(flecha.destinoId)) continue;
      if (flecha.destinoId === origenId) return true;
      visto.add(flecha.destinoId);
      pendientes.push(flecha.destinoId);
    }
  }
  return false;
}

/**
 * La madre pasa a HECHO cuando todas sus hijas están HECHO. `hijasVivas` = las hijas de la partida que no
 * están borradas, con su estado. Sin hijas vivas no se cierra sola.
 */
export function madreSeCierra(hijasVivas: readonly { estado: string }[]): boolean {
  return hijasVivas.length > 0 && hijasVivas.every((hija) => hija.estado === "HECHO");
}


/* ───────────────────────────────────────────────── esperando a otra, recoger errores viejos (26-oct-2026) ── */

/** Cuántas veces se recoge una misma tarjeta en ERROR; la tercera falla se queda en ERROR con su línea. */
export const TOPE_DE_RECOGIDAS_POR_TARJETA = 2;
/** Cuántas tarjetas se recogen por día. */
export const TOPE_DE_RECOGIDAS_POR_DIA = 6;

/** Los estados desde los que una dependencia "está trabada": nadie la va a terminar sin que el dueño mire. */
const ESTADOS_QUE_NO_AVANZAN = ["ERROR", "FALLIDO"] as const;

/**
 * La etiqueta "Esperando a «X»" de una tarjeta que depende de otras que no están HECHO. `origenes` son las tarjetas de
 * las que depende (sin borrar y de un tipo con estados). null si no espera a nadie. Si alguna está en ERROR o FALLIDO
 * lo dice: "Esperando a «X», que está en error" (así no se queda trabada para siempre sin que nadie lo sepa).
 */
export function etiquetaEsperando(origenes: readonly { titulo: string; estado: string }[]): string | null {
  const pendientes = origenes.filter((origen) => origen.estado !== "HECHO");
  if (!pendientes.length) return null;
  const nombres = pendientes.map((origen) => `«${origen.titulo}»`);
  const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  const trabadas = pendientes.filter((origen) => (ESTADOS_QUE_NO_AVANZAN as readonly string[]).includes(origen.estado));
  if (!trabadas.length) return `Esperando a ${lista}`;
  if (trabadas.length === 1 && pendientes.length === 1) {
    return `Esperando a ${lista}, que está ${trabadas[0].estado === "ERROR" ? "en error" : "fallida"}`;
  }
  return `Esperando a ${lista}; ${trabadas.map((origen) => `«${origen.titulo}»`).join(" y ")} ${trabadas.length === 1 ? "está" : "están"} en error o fallidas`;
}

export type RecogidaDelResultado = { veces: number; ultima: string | null; linea: string | null };

/** `resultado.recogida` de una tarjeta: cuántas veces se recogió, cuándo y la línea para el dueño (si dejó una). */
export function recogidaDelResultado(resultado: unknown): RecogidaDelResultado {
  const vacia: RecogidaDelResultado = { veces: 0, ultima: null, linea: null };
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return vacia;
  const recogida = (resultado as Record<string, unknown>).recogida;
  if (!recogida || typeof recogida !== "object" || Array.isArray(recogida)) return vacia;
  const datos = recogida as Record<string, unknown>;
  const veces = Number(datos.veces);
  return {
    veces: Number.isFinite(veces) && veces > 0 ? Math.floor(veces) : 0,
    ultima: typeof datos.ultima === "string" ? datos.ultima : null,
    linea: typeof datos.linea === "string" && datos.linea.trim() ? datos.linea : null,
  };
}

export const DECISIONES_DE_RECOGER = ["reintentar", "partir", "dueno"] as const;
export type DecisionDeRecoger = (typeof DECISIONES_DE_RECOGER)[number];

/** La decisión que manda el Coordinador al recoger: null si no es una de la lista. */
export function decisionDeRecogerDeEntrada(valor: unknown): DecisionDeRecoger | null {
  const limpia = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  return (DECISIONES_DE_RECOGER as readonly string[]).includes(limpia) ? (limpia as DecisionDeRecoger) : null;
}

/** ¿Se puede recoger esta tarjeta? Máximo TOPE_DE_RECOGIDAS_POR_TARJETA veces. */
export function puedeRecoger(resultado: unknown): Veredicto {
  const { veces } = recogidaDelResultado(resultado);
  if (veces >= TOPE_DE_RECOGIDAS_POR_TARJETA) {
    return `Ya se recogió ${veces} veces: se queda en ERROR con su línea y no se reintenta sola otra vez.`;
  }
  return null;
}

/**
 * A dónde vuelve una tarjeta en ERROR que se reintenta: con plan ya hecho vuelve a PLAN_APROBADO (a construir); sin plan,
 * a APROBADO (a planear). El dueño ya había aprobado la tarea (y el plan, si lo hay) antes de que fallara.
 */
export function estadoTrasRecoger(plan: string | null | undefined): EstadoTarjetaTablero {
  return plan && plan.trim() ? "PLAN_APROBADO" : "APROBADO";
}

/** El estado en que quedan las hijas de una partida: desde PLANEANDO (aún sin plan) APROBADO; desde EN_CURSO, PLAN_APROBADO. */
export function estadoDeLasHijas(estadoDeLaMadre: EstadoTarjetaTablero): EstadoTarjetaTablero {
  return estadoDeLaMadre === "PLANEANDO" ? "APROBADO" : "PLAN_APROBADO";
}

/** La línea para el dueño: una sola línea, de máximo 300 letras; "" si no vino. */
export function lineaParaElDueno(valor: unknown): string {
  const texto = typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
  return texto.slice(0, 300);
}

/* ─────────────────────────────── madres partidas, huérfanas y "cerrar como fallida" (26-oct-2026) ── */

/*
  Una MADRE PARTIDA (resultado.partida con sus hijas) se queda donde estaba (PLANEANDO o EN_CURSO) sin candado:
  es "partida, esperando a sus partes" y nadie la toma. Se cierra sola cuando TODAS sus partes vivas
  terminaron: HECHO si todas quedaron HECHO, FALLIDO si alguna quedó FALLIDO (cierreDeLaMadre). Antes solo
  se cerraba si todas quedaban HECHO, y solo cuando una parte subía: con una parte FALLIDO quedaba colgada
  para siempre (como «Paralelo de verdad», 26-oct). /tomar también revisa las madres colgadas en cada vuelta.

  HUÉRFANA = una tarjeta con repo en PLANEANDO o EN_CURSO, sin candado (trabajoVenceEn NULL), que no es una
  madre esperando partes vivas: nadie la está trabajando y nunca vencería. /tomar la pasa a ERROR después de
  MINUTOS_PARA_HUERFANA sin cambios. Una SUBIENDO sin candado NO es huérfana: es la SUBIENDO pendiente (el sí
  final ya se dio y espera que el Coordinador la tome).
*/

/** Los estados en que una parte ya terminó (bien o mal): la madre no espera más por ella. */
export const ESTADOS_FINALES_DE_LA_PARTE = ["HECHO", "FALLIDO"] as const;

const esFinalDeLaParte = (estado: string) => (ESTADOS_FINALES_DE_LA_PARTE as readonly string[]).includes(estado);

/**
 * Cómo se cierra una madre partida según sus hijas vivas (no borradas): null si alguna sigue en camino (o no
 * hay ninguna viva: entonces no se cierra sola y, sin partes que esperar, la recoge /tomar como huérfana);
 * HECHO si todas quedaron HECHO; FALLIDO si todas terminaron y alguna quedó FALLIDO.
 */
export function cierreDeLaMadre(hijasVivas: readonly { estado: string }[]): "HECHO" | "FALLIDO" | null {
  if (!hijasVivas.length || !hijasVivas.every((hija) => esFinalDeLaParte(hija.estado))) return null;
  return hijasVivas.every((hija) => hija.estado === "HECHO") ? "HECHO" : "FALLIDO";
}

/** La nota del historial cuando la madre se cierra sola. */
export function notaDelCierreDeLaMadre(hijasVivas: readonly { estado: string }[], cierre: "HECHO" | "FALLIDO"): string {
  if (cierre === "HECHO") return `terminada: sus ${hijasVivas.length} partes están hechas`;
  const fallidas = hijasVivas.filter((hija) => hija.estado === "FALLIDO").length;
  return `cerrada como fallida: ${fallidas} de sus ${hijasVivas.length} partes quedaron fallidas`;
}

/** ¿Una madre partida sigue esperando a sus partes? (tiene partida y al menos una hija viva que no terminó) */
export function esperaASusPartes(resultado: unknown, hijasVivas: readonly { estado: string }[]): boolean {
  return Boolean(partidaDelResultado(resultado)) && hijasVivas.length > 0 && cierreDeLaMadre(hijasVivas) === null;
}

/** Minutos sin cambios que tiene que llevar una PLANEANDO o EN_CURSO sin candado para que /tomar la dé por huérfana. */
export const MINUTOS_PARA_HUERFANA = 30;

// Tres líneas, como MOTIVO_VENCIDA.
export const MOTIVO_HUERFANA = [
  "Quedó huérfana: nadie la estaba trabajando (estaba en planear o construir sin el candado del Coordinador).",
  "No se volvió a intentar sola.",
  "Necesita que la veas: pulsa Reintentar o, si ya no va, Cerrar como fallida.",
].join("\n");

/** Los estados desde los que el dueño cierra una tarjeta con repo como fallida en la pantalla. */
export const ESTADOS_QUE_SE_CIERRAN_COMO_FALLIDA = ["ERROR", "PLANEANDO", "EN_CURSO"] as const;

export type PedidoDeCerrarComoFallida = {
  origen: OrigenCambio;
  estado: EstadoTarjetaTablero;
  usaEstados: boolean;
  repo: string | null;
  /** El candado del Coordinador (null = nadie la tiene). */
  trabajoVenceEn: Date | null;
  ahora: Date;
  /** Es una madre partida con partes vivas que no terminaron (se cierra sola cuando terminen). */
  esperaPartes: boolean;
  persona: PersonaQueAprueba;
};

/**
 * "Cerrar como fallida" (26-oct-2026): el dueño (o el ADMIN de la plataforma), en la pantalla, abandona una
 * tarjeta con repo que está en ERROR o que quedó huérfana (PLANEANDO o EN_CURSO sin candado vigente). Nunca
 * una que el Coordinador tiene con el candado vigente, ni una SUBIENDO (pudo haber empujado a main), ni una
 * madre que espera a sus partes. Queda FALLIDO (desde ahí se puede marcar hecha a mano).
 */
export function puedeCerrarComoFallida(pedido: PedidoDeCerrarComoFallida): Veredicto {
  if (pedido.origen !== "PANTALLA") return "Cerrar como fallida se hace solo en la pantalla, con el botón.";
  if (!pedido.usaEstados) return "Las tarjetas de ese tipo (como Área) son carpetas: no tienen estado.";
  if (!pedido.repo) return "Esta tarjeta no tiene repo: sin repo se marca FALLIDO con el estado de siempre.";
  if (!pedido.persona.esDueno && !pedido.persona.esAdminPlataforma) {
    return `Cerrar como fallida lo hace solo el dueño del negocio (o el ADMIN de la plataforma).${conLaCuenta(pedido.persona, "pantalla")}`;
  }
  if (!(ESTADOS_QUE_SE_CIERRAN_COMO_FALLIDA as readonly string[]).includes(pedido.estado)) {
    return `Solo se cierra como fallida una tarjeta en ERROR o una que quedó huérfana (planeando o en curso sin el Coordinador). Está ${pedido.estado}.`;
  }
  if (pedido.estado !== "ERROR") {
    if (pedido.trabajoVenceEn && pedido.trabajoVenceEn.getTime() > pedido.ahora.getTime()) {
      return `El Coordinador tiene esta tarjeta en este momento (${pedido.estado}): no se cierra hasta que termine o falle.`;
    }
    if (pedido.esperaPartes) {
      return "Esta tarjeta está partida y espera a sus partes: se cierra sola cuando terminen (cierra las partes si ya no van).";
    }
  }
  return null;
}

/** Lo que queda en `HistorialTarjeta.despues` (acción "estado", origen PANTALLA) al cerrar como fallida. */
export type RegistroDeCierreComoFallida = {
  estado: "FALLIDO";
  cerradaComoFallida: true;
  via: "pantalla";
  quienNombre: string;
  userId: string;
  /** "cerrada como fallida por el dueño (nombre)". */
  como: string;
  /** Si estaba huérfana (PLANEANDO o EN_CURSO sin candado), para que el historial lo diga. */
  huerfana: boolean;
};

export function registroDeCierreComoFallida(datos: {
  quienNombre: string;
  userId: string;
  antes: EstadoTarjetaTablero;
  esDueno: boolean;
}): RegistroDeCierreComoFallida {
  return {
    estado: "FALLIDO",
    cerradaComoFallida: true,
    via: "pantalla",
    quienNombre: datos.quienNombre,
    userId: datos.userId,
    como: `cerrada como fallida por ${datos.esDueno ? "el dueño" : "el ADMIN"} (${datos.quienNombre})`,
    huerfana: datos.antes !== "ERROR",
  };
}

/**
 * El estado con que queda una tarjeta EN_CURSO de la fase 1 (sin repo, a mano) cuando le ponen repo: POR_APROBAR.
 * EN_CURSO con repo es un estado del Coordinador (con candado); dejarla ahí la volvía huérfana (nadie la toma
 * y nunca vence: «Retroactivos en Gestión», 26-oct). Desde POR_APROBAR se aprueba (o se aprueba sola) y el
 * Coordinador la toma desde el principio. Cualquier otro caso deja el estado como venía.
 */
export function estadoAlPonerRepo(estado: EstadoTarjetaTablero, repoAntes: string | null, repoFinal: string | null): EstadoTarjetaTablero {
  return !repoAntes && repoFinal && estado === "EN_CURSO" ? "POR_APROBAR" : estado;
}
