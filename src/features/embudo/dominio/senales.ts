/**
 * SEÑALES DE COMPRA en lo que escribe la clienta (Embudo F1).
 *
 * Detector por palabras, sin IA y sin base: lo mismo entra, lo mismo sale. Sirve para MEDIR qué
 * pregunta la gente en cada paso y para calcular un puntaje "en sombra" que en F1 no decide nada
 * (se guarda en EmbudoLead.puntaje para comparar antes de que F2 lo use).
 *
 * Los pesos son los del diseño (CRM-Gestion/2026-10-09-diseno-modulo-metricas-embudo):
 * fuertes +4 (cualquiera pone Caliente), medias +2, débiles +1, negativas -2/-1, "no me
 * interesa" deja en Frío.
 *
 * Código puro: se prueba con `npm run test:embudo` (scripts/check-embudo.mjs).
 */

export type GrupoDeSenal = "fuerte" | "media" | "debil" | "negativa";

export type TipoDeSenal =
  // fuertes
  | "separar"
  | "anticipo_pago"
  | "acepta_precio"
  | "pide_cotizacion"
  | "direccion_fecha"
  | "comprobante"
  | "decision_proxima"
  // medias
  | "envio_ciudad"
  | "tiempo_fabricacion"
  | "color_medidas"
  | "garantia"
  | "forma_pago"
  // débiles
  | "precio"
  | "fotos_video"
  // negativas
  | "solo_mirando"
  | "muy_caro"
  | "no_interesa";

export type Senal = {
  tipo: TipoDeSenal;
  grupo: GrupoDeSenal;
  peso: number;
  /** El pedazo del mensaje donde se vio, tal como lo escribió (recortado). */
  fragmento: string;
};

type Definicion = {
  tipo: TipoDeSenal;
  grupo: GrupoDeSenal;
  peso: number;
  /** En palabras, para el motivo: "preguntó cómo separar". */
  etiqueta: string;
  patrones: RegExp[];
  /** Si va precedida de "no", no cuenta ("no lo quiero" no es aceptar el precio). */
  negable?: boolean;
};

const DIAS = "(lunes|martes|miercoles|jueves|viernes|sabado|domingo)";

/*
  Los patrones se aplican sobre el texto en minúsculas y SIN tildes (ñ -> n): "mañana" se busca
  como "manana", "envío" como "envio". La normalización conserva la longitud, así que el
  fragmento se recorta del texto original con las mismas posiciones.
*/
const DEFINICIONES: Definicion[] = [
  // ---------------------------------------------------------------- fuertes (+4)
  {
    tipo: "separar",
    grupo: "fuerte",
    peso: 4,
    etiqueta: "preguntó cómo separar",
    negable: true,
    patrones: [
      /\b(separ(ar|o|a|amos|arlo|arla|arme|armela|armelo|en|emos|ado|ada)|apart(ar|o|a|amos|arlo|arla|arme|armelo|armela|en|ado|ada))\b/,
      /\bcomo (hago|hacemos|hago para|seria) (para )?(separ|apart|reserv)/,
      /\breserv(ar|o|arlo|arla|amos)\b/,
    ],
  },
  {
    tipo: "anticipo_pago",
    grupo: "fuerte",
    peso: 4,
    etiqueta: "preguntó cómo pagar el anticipo",
    patrones: [
      /\b(anticipo|abono|abonar|abonarle|abonaria|consignar|consigno|consignacion|transfiero|transferirle)\b/,
      /\ba (que|cual) (cuenta|numero)\b/,
      /\b(numero|datos) de (la )?cuenta\b/,
      /\bdatos (bancarios|para (pagar|consignar|transferir))\b/,
      /\b(nequi|daviplata|bancolombia|davivienda|llave bre-?b)\b/,
    ],
  },
  {
    tipo: "acepta_precio",
    grupo: "fuerte",
    peso: 4,
    etiqueta: "aceptó el precio",
    negable: true,
    patrones: [
      /\b(me sirve|me conviene|me interesa (comprar|llevar)(lo|la)?)\b/,
      /\b(lo|la|los|las) quiero\b/,
      /\bme (lo|la|los|las) llevo\b/,
      /\b(lo|la|los|las) compro\b/,
      /\bquiero (comprar|hacer el pedido|pedir(lo|la)?)\b/,
      /\bvamos con (ese|esa|el|la|eso)\b/,
      /\bhagamos(le)? (el pedido|la compra)\b/,
      /\blisto,? (hagamos|hagamosle|dale|lo quiero|la quiero|me (lo|la) llevo|entonces (lo|la))\b/,
      // "¡De una!" como respuesta, no "de una vez" ni "de una camilla".
      /\bde una\s*(!|\.|,|$)/,
    ],
  },
  {
    tipo: "pide_cotizacion",
    grupo: "fuerte",
    peso: 4,
    etiqueta: "pidió cotización",
    patrones: [
      /\b(cotizacion|cotizaciones|cotizar|cotizame|cotizarme|cotizenme|coticeme|me cotiza|me cotizan|presupuesto formal|proforma)\b/,
    ],
  },
  {
    tipo: "direccion_fecha",
    grupo: "fuerte",
    peso: 4,
    etiqueta: "dio dirección o fecha de entrega",
    patrones: [
      /\b(mi direccion|la direccion es|direccion de entrega|direccion:)/,
      /\b(calle|carrera|cra|cr|cl|avenida|av|diagonal|transversal|manzana|mz)\.? ?\d+/,
      /\bfecha de entrega\b/,
      /\b(lo|la|los|las) necesito (para el|para este|el) (\d|proximo|otro|lunes|martes|miercoles|jueves|viernes|sabado|domingo)/,
      /\b(entregar(lo|la)?|me (lo|la) entregan) (el|este|para el) /,
    ],
  },
  {
    tipo: "comprobante",
    grupo: "fuerte",
    peso: 4,
    etiqueta: "mandó el comprobante",
    patrones: [
      /\b(comprobante|soporte de pago|soporte del pago|recibo de pago)\b/,
      /\bya (pague|consigne|transferi|abone|hice la (transferencia|consignacion)|te (consigne|transferi|pague))\b/,
    ],
  },
  {
    tipo: "decision_proxima",
    grupo: "fuerte",
    peso: 4,
    etiqueta: "decide en pocos días",
    negable: true,
    patrones: [
      new RegExp(
        `\\b(pago|compro|separo|aparto|consigno|confirmo|paso|abono|transfiero|lo pido|la pido)( (hoy|manana|pasado manana|esta semana|este fin de semana|el ${DIAS}|en estos dias))\\b`,
      ),
      /\bmanana (te|le|les) (confirmo|consigno|pago|escribo para (pagar|separar|confirmar)|aviso para (pagar|separar))\b/,
      /\bhoy mismo\b/,
    ],
  },

  // ---------------------------------------------------------------- medias (+2)
  {
    tipo: "envio_ciudad",
    grupo: "media",
    peso: 2,
    etiqueta: "preguntó por el envío a su ciudad",
    patrones: [
      /\b(envio|envios|envian|enviarian|enviaria|despachan|despacho|domicilio|flete|transportadora|interrapidisimo|servientrega|coordinadora|envia)\b/,
      /\bllega(r|n|ria)? (a|hasta) [a-z]/,
      /\bhacen envios?\b/,
      /\b(soy|estoy|vivo) (de|en) [a-z]{4,}/,
    ],
  },
  {
    tipo: "tiempo_fabricacion",
    grupo: "media",
    peso: 2,
    etiqueta: "preguntó el tiempo de fabricación",
    patrones: [
      /\bcuanto (se )?(demora|demoran|tarda|tardan|tiempo)\b/,
      /\btiempo de (entrega|fabricacion|elaboracion|envio)\b/,
      /\ben cuantos dias\b/,
      /\bcuando (me )?(llega|llegaria|estaria|estaria lista|la tienen|lo tienen)\b/,
      /\b(dias habiles|hay stock|tienen stock|disponible para entrega|entrega inmediata)\b/,
    ],
  },
  {
    tipo: "color_medidas",
    grupo: "media",
    peso: 2,
    etiqueta: "preguntó color o medidas",
    patrones: [
      /\b(color|colores|rosad[oa]s?|negr[oa]s?|blanc[oa]s?|beige|gris|dorad[oa]s?|nude|palo de rosa|tapiz|tapizado)\b/,
      /\b(medida|medidas|cuanto mide|tamano|dimensiones|cuanto de (alto|ancho|largo))\b/,
    ],
  },
  {
    tipo: "garantia",
    grupo: "media",
    peso: 2,
    etiqueta: "preguntó la garantía",
    patrones: [/\b(garantia|garantias|garantizan|de que material|que material|cuanto dura|es resistente)\b/],
  },
  {
    tipo: "forma_pago",
    grupo: "media",
    peso: 2,
    etiqueta: "preguntó la forma de pago",
    patrones: [
      /\b(formas? de pago|metodos? de pago|medios de pago)\b/,
      /\bcomo (se )?(paga|pago|seria el pago)\b/,
      /\b(cuotas|a credito|credito|addi|sistecredito|contraentrega|contra entrega|pago al recibir|con tarjeta|en efectivo)\b/,
    ],
  },

  // ---------------------------------------------------------------- débiles (+1)
  {
    tipo: "precio",
    grupo: "debil",
    peso: 1,
    etiqueta: "preguntó el precio",
    patrones: [
      /\b(precio|precios|valor|costo|costos)\b/,
      // "vale" solo no: también es "ok".
      /\b(cuanto|que|q) (vale|valen|cuesta|cuestan)\b/,
      /\bcuanto (es|sale|seria|me sale|queda|me queda)\b/,
    ],
  },
  {
    tipo: "fotos_video",
    grupo: "debil",
    peso: 1,
    etiqueta: "pidió fotos o video",
    patrones: [/\b(foto|fotos|fotico|foticos|video|videos|imagen|imagenes|catalogo)\b/],
  },

  // ---------------------------------------------------------------- negativas
  {
    tipo: "solo_mirando",
    grupo: "negativa",
    peso: -2,
    etiqueta: "dijo que solo está mirando",
    patrones: [
      /\bsolo (estoy )?(mirando|averiguando|preguntando|cotizando|curioseando)\b/,
      /\b(mas adelante|para mas adelante|lo voy a pensar|lo pienso|voy a pensarlo|dejame pensarlo|por ahora no|todavia no|aun no tengo|el otro ano|el proximo ano)\b/,
    ],
  },
  {
    tipo: "muy_caro",
    grupo: "negativa",
    peso: -1,
    etiqueta: "le pareció caro",
    patrones: [/\b(muy caro|muy cara|esta caro|esta cara|que caro|que cara|costoso|costosa|no me alcanza|fuera de mi presupuesto|muy alto el precio|esta muy alto)\b/],
  },
  {
    tipo: "no_interesa",
    grupo: "negativa",
    peso: 0,
    etiqueta: "dijo que no le interesa",
    patrones: [
      /\b(no me interesa|ya no me interesa|no estoy interesad[oa]|no gracias|ya (lo|la) compre|ya compre|no (lo|la) necesito|no me (escriban|vuelvan a escribir)|no (sigan|siga) escribiendo)\b/,
    ],
  },
];

const POR_TIPO = new Map(DEFINICIONES.map((definicion) => [definicion.tipo, definicion]));

/**
 * Minúsculas y sin tildes, CONSERVANDO la longitud (una letra por una letra), para poder recortar
 * el fragmento del texto original con las mismas posiciones.
 */
export function normalizarConservando(texto: string): string {
  let salida = "";
  for (const letra of texto) {
    const base = letra.normalize("NFD").toLowerCase();
    const primera = base.length ? base[0] : letra;
    // Un emoji ocupa dos unidades: se conserva tal cual para no correr las posiciones.
    salida += letra.length === 1 ? primera : letra;
  }
  return salida;
}

function recortar(original: string, inicio: number, fin: number): string {
  const desde = Math.max(0, inicio - 25);
  const hasta = Math.min(original.length, fin + 25);
  const pedazo = original.slice(desde, hasta).replace(/\s+/g, " ").trim();
  return `${desde > 0 ? "…" : ""}${pedazo}${hasta < original.length ? "…" : ""}`.slice(0, 120);
}

/** ¿El match va precedido de "no "? ("no lo quiero", "no me sirve"). */
function vieneNegado(normalizado: string, inicio: number): boolean {
  const antes = normalizado.slice(Math.max(0, inicio - 4), inicio);
  return /\bno ?$/.test(antes) || /\bno\s$/.test(antes);
}

/**
 * Las señales de compra de un texto de la clienta. Una por tipo (la primera que aparece).
 * Un "no me interesa" anula "me interesa"; un "no lo quiero" no es aceptar el precio.
 */
export function detectarSenales(texto: string | null | undefined): Senal[] {
  const original = (texto ?? "").slice(0, 2000);
  if (!original.trim()) {
    return [];
  }
  const normalizado = normalizarConservando(original);
  const senales: Senal[] = [];

  for (const definicion of DEFINICIONES) {
    for (const patron of definicion.patrones) {
      const global = new RegExp(patron.source, "g");
      let encontrado: RegExpExecArray | null = null;
      let valido: RegExpExecArray | null = null;
      while ((encontrado = global.exec(normalizado)) !== null) {
        if (definicion.negable && vieneNegado(normalizado, encontrado.index)) {
          if (encontrado[0].length === 0) global.lastIndex += 1;
          continue;
        }
        valido = encontrado;
        break;
      }
      if (valido) {
        senales.push({
          tipo: definicion.tipo,
          grupo: definicion.grupo,
          peso: definicion.peso,
          fragmento: recortar(original, valido.index, valido.index + valido[0].length),
        });
        break;
      }
    }
  }

  // "no me interesa" contiene "me interesa": si está, la aceptación por esas palabras no cuenta.
  const tipos = new Set(senales.map((senal) => senal.tipo));
  if (tipos.has("no_interesa")) {
    return senales.filter((senal) => senal.grupo === "negativa" || senal.tipo === "precio" || senal.tipo === "fotos_video");
  }
  return senales;
}

export type Temperatura = "FRIO" | "TIBIO" | "CALIENTE";

/**
 * El puntaje "en sombra" con las señales vistas en TODA la charla (una vez cada tipo).
 * Cualquier fuerte pone Caliente (>= 6). "No me interesa" deja en Frío (0). Nunca negativo.
 * El -1 por cada 24 h de silencio es de F2: acá no se aplica.
 */
export function puntajeSombra(tipos: Iterable<TipoDeSenal>): number {
  const unicos = new Set(tipos);
  if (unicos.has("no_interesa")) {
    return 0;
  }
  let suma = 0;
  let hayFuerte = false;
  for (const tipo of unicos) {
    const definicion = POR_TIPO.get(tipo);
    if (!definicion) continue;
    suma += definicion.peso;
    if (definicion.grupo === "fuerte") hayFuerte = true;
  }
  if (hayFuerte) {
    suma = Math.max(suma, 6);
  }
  return Math.max(0, suma);
}

export const UMBRAL_TIBIO = 3;
export const UMBRAL_CALIENTE = 6;

export function temperaturaDelPuntaje(puntaje: number): Temperatura {
  if (puntaje >= UMBRAL_CALIENTE) return "CALIENTE";
  if (puntaje >= UMBRAL_TIBIO) return "TIBIO";
  return "FRIO";
}

/**
 * El motivo en una línea con las 3 señales que más pesan:
 * "Caliente: preguntó cómo separar ('cómo hago para apartarlo') + preguntó por el envío…".
 */
export function motivoDelPuntaje(senales: Array<Pick<Senal, "tipo" | "fragmento">>, puntaje: number): string {
  const vistas = new Map<TipoDeSenal, string>();
  for (const senal of senales) {
    if (!vistas.has(senal.tipo)) vistas.set(senal.tipo, senal.fragmento);
  }
  const principales = [...vistas.entries()]
    .map(([tipo, fragmento]) => ({ definicion: POR_TIPO.get(tipo), fragmento }))
    .filter((fila): fila is { definicion: Definicion; fragmento: string } => Boolean(fila.definicion))
    .sort((a, b) => Math.abs(b.definicion.peso) - Math.abs(a.definicion.peso))
    .slice(0, 3)
    .map(({ definicion, fragmento }) => `${definicion.etiqueta} ('${fragmento.slice(0, 60)}')`);
  const temperatura = temperaturaDelPuntaje(puntaje);
  const nombre = temperatura === "CALIENTE" ? "Caliente" : temperatura === "TIBIO" ? "Tibio" : "Frío";
  return principales.length ? `${nombre}: ${principales.join(" + ")}` : nombre;
}

export function etiquetaDeSenal(tipo: string): string {
  return POR_TIPO.get(tipo as TipoDeSenal)?.etiqueta ?? tipo;
}

export function grupoDeSenal(tipo: string): GrupoDeSenal | null {
  return POR_TIPO.get(tipo as TipoDeSenal)?.grupo ?? null;
}

export const TIPOS_DE_SENAL: ReadonlyArray<{ tipo: TipoDeSenal; grupo: GrupoDeSenal; etiqueta: string; peso: number }> =
  DEFINICIONES.map(({ tipo, grupo, etiqueta, peso }) => ({ tipo, grupo, etiqueta, peso }));
