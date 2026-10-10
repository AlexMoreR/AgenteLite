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
  | "pregunta_uso"
  | "fotos_producto"
  // débiles
  | "precio"
  | "fotos_video"
  | "dijo_servicio"
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
  /**
   * Los patrones se aplican sobre el texto que CONSERVA la ñ ("uñas" no es "unas"). Sirve para los
   * servicios: "Uñas y pestañas" es un servicio, "me mandas unas fotos" no.
   */
  conEnie?: boolean;
};

const DIAS = "(lunes|martes|miercoles|jueves|viernes|sabado|domingo)";

/*
  Productos CONCRETOS (para "fotos / video / catálogo DE un producto"). Un "fotos" suelto no dice qué
  quiere ver; "videos del lavacabezas" o "fotos de la silla" sí (casos reales del 10-oct-2026).
*/
const PRODUCTO_CONCRETO =
  "(sillas?|silletas?|sillon(es)?|camillas?|lava ?cabezas?|butacos?|mesas?|poltronas?|tocador(es)?|combos?|carritos?|espejos?|sofas?|escaleras?|escalerillas?|auxiliar(es)?|recepcion|divan(es)?|lavapies)";
const PIDE_IMAGEN = "(fotos?|foticos?|videos?|imagen(es)?|catalogos?)";

/*
  Servicios que ofrece la clienta (identificación). Van SIN tildes pero CON ñ (ver `conEnie`).
*/
const SERVICIO =
  "(pestañas|uñas|manicure|manicura|pedicure|pedicura|masajes?|faciales|facial|corporales|depilacion(es)?|depilar|cejas|maquillaje|micropigmentacion|microblading|lifting|extensiones|spa|peluqueria|barberia|cortes?|tintes?|keratina|cosmetologia|limpiezas?( facial(es)?)?|drenajes?( linfaticos?)?|reductores?|podologia|tatuajes?|lash(es)?|estetica( facial| corporal)?|tratamientos?( faciales| corporales)?|belleza|nails?|laminado|cepillados?|blower|semipermanente|acrilicas?|esmaltado)";
const OFICIO =
  "(manicurista|esteticista|cosmetologa|cosmetologo|cosmiatra|peluquer[oa]|estilista|barber[oa]|masajista|lashista|cejista|depiladora|podologa|fisioterapeuta|maquilladora|micropigmentadora|tatuador[a]?)";

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
      // "me sirve para pestañas?" / "me sirve?" es una PREGUNTA de uso (pregunta_uso), no un sí.
      /\b(me sirve(?!\s*(para|pa)\b|\s*\?)|me conviene|me interesa (comprar|llevar)(lo|la)?)\b/,
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
  {
    // Caso real cv16c1a0 (10-oct): "Sirve para pestañas?" quedó Frío. Preguntar si el producto
    // sirve para SU servicio es una pregunta concreta, como el envío o el color.
    tipo: "pregunta_uso",
    grupo: "media",
    peso: 2,
    etiqueta: "preguntó si sirve para su servicio",
    patrones: [
      /\b(sirve|sirven|serviria|servirian|servira|funciona|funcionan|funcionaria|aplica|se puede usar|se pueden usar|puedo usar(la|lo|las|los)?|se usa|se utiliza|es apt[oa]|son apt[oa]s|es apropiad[oa]|es recomendad[oa]|es ideal|esta hech[oa]) (para|pa)\b/,
      /\bpara (que|q) (sirve|sirven|es|son|se usa|se utiliza|seria)\b/,
      /\b(sirve|sirven|serviria|funciona)\s*\?/,
    ],
  },
  {
    // Caso real cv3639b6 (10-oct): "Videos del lavacabezas" quedó Frío. Pedir fotos, video o el
    // catálogo DE UN PRODUCTO CONCRETO es interés por ese producto (un "fotos" suelto no: ver abajo).
    tipo: "fotos_producto",
    grupo: "media",
    peso: 2,
    etiqueta: "pidió fotos o video de un producto concreto",
    patrones: [
      new RegExp(`\\b${PIDE_IMAGEN}\\b[^.!\\n]{0,35}?\\b${PRODUCTO_CONCRETO}\\b`),
      new RegExp(`\\b${PRODUCTO_CONCRETO}\\b[^.!\\n]{0,35}?\\b${PIDE_IMAGEN}\\b`),
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
  {
    // Contesta la pregunta de identificación ("¿Qué servicios vas a ofrecer?"): solo no alcanza para
    // Tibio, pero sumado a un pedido de información sí (ver pisoTibio).
    tipo: "dijo_servicio",
    grupo: "debil",
    peso: 1,
    etiqueta: "dijo su servicio",
    conEnie: true,
    patrones: [
      // Mensaje que SOLO nombra servicios: "Uñas y pestañas", "Masajes y faciales", "Para masajes".
      new RegExp(
        `^(?=[^\\n]{1,80}$)\\W*(yo |nosotros )?(hago|hacemos|ofrezco|ofrecemos|ofrecere|voy a (ofrecer|hacer|trabajar)( con)?|trabajo( con| en)?|seria para|es para|para|servicios? de|solo|mas que todo|principalmente)?\\W*(${SERVICIO}(\\W+(y|e|o|de|para|con|tambien|todo|etc|mas|en general))*\\W*)+$`,
      ),
      new RegExp(`\\b(soy|somos) (un[oa]? )?${OFICIO}\\b`),
      new RegExp(
        `\\b(hago|hacemos|ofrezco|ofrecemos|ofrecere|ofrecer|voy a hacer|voy a trabajar|trabajo|trabajamos|me dedico a|nos dedicamos a|realizo|realizamos|atiendo|es para|seria para|lo necesito para|la necesito para|para hacer|para mis|para mi servicio de)\\b[^.?!\\n]{0,25}?\\b${SERVICIO}\\b`,
      ),
      /\btengo (un|una|mi) (spa|peluqueria|salon|barberia|centro de estetica|consultorio|gabinete|estudio|negocio de)\b/,
    ],
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
export function normalizarConservando(texto: string, conservarEnie = false): string {
  let salida = "";
  for (const letra of texto) {
    if (conservarEnie && (letra === "ñ" || letra === "Ñ")) {
      salida += "ñ";
      continue;
    }
    const base = letra.normalize("NFD").toLowerCase();
    const primera = base.length ? base[0] : letra;
    // Un emoji ocupa dos unidades: se conserva tal cual para no correr las posiciones.
    salida += letra.length === 1 ? primera : letra;
  }
  return salida;
}

/**
 * PISO DE TIBIO por combinación (recalibración del 10-oct-2026 con los casos reales): quien dijo su
 * servicio (o preguntó si sirve para él) y además pide información —fotos, video, catálogo, precio—
 * ya es Tibio aunque cada señal sola sea débil ("Uñas" + "Fotos").
 */
export function pisoTibio(tipos: Iterable<TipoDeSenal | string>): boolean {
  const unicos = new Set<string>(tipos);
  if (unicos.has("no_interesa") || unicos.has("solo_mirando")) return false;
  const servicio = unicos.has("dijo_servicio") || unicos.has("pregunta_uso");
  const pideInfo = ["fotos_video", "fotos_producto", "precio", "precio_producto"].some((t) => unicos.has(t));
  return servicio && pideInfo;
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
  const sinEnie = normalizarConservando(original);
  const conEnie = normalizarConservando(original, true);
  const senales: Senal[] = [];

  for (const definicion of DEFINICIONES) {
    const normalizado = definicion.conEnie ? conEnie : sinEnie;
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
  // "Videos del lavacabezas" ya es "fotos de un producto concreto": no se cuenta además como "fotos".
  if (tipos.has("fotos_producto")) return senales.filter((senal) => senal.tipo !== "fotos_video");
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
  if (pisoTibio(unicos)) suma = Math.max(suma, UMBRAL_TIBIO);
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

/**
 * ¿Cuenta como SEÑAL DE COMPRA para el Supervisor (indicadores y alertas)? "Dijo su servicio" es
 * identificación, no compra: suma en la calificación pero no dispara alertas solo.
 */
export function esSenalDeCompra(senal: Pick<Senal, "tipo" | "grupo">): boolean {
  return senal.grupo !== "negativa" && senal.tipo !== "dijo_servicio";
}

export function etiquetaDeSenal(tipo: string): string {
  return POR_TIPO.get(tipo as TipoDeSenal)?.etiqueta ?? tipo;
}

export function grupoDeSenal(tipo: string): GrupoDeSenal | null {
  return POR_TIPO.get(tipo as TipoDeSenal)?.grupo ?? null;
}

export const TIPOS_DE_SENAL: ReadonlyArray<{ tipo: TipoDeSenal; grupo: GrupoDeSenal; etiqueta: string; peso: number }> =
  DEFINICIONES.map(({ tipo, grupo, etiqueta, peso }) => ({ tipo, grupo, etiqueta, peso }));
