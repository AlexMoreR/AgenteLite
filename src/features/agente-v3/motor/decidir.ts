import {
  normalizar,
  pesoDeLaRegla,
  temaDeLaRegla,
  type Accion,
  type LibroDeReglas,
  type PasoDelEmbudo,
  type ReglaV3,
  type TemaDePregunta,
} from "../domain/reglas";
import {
  REGLA_FOTO_Y_PRECIO_POR_DEFECTO,
  esReglaDeFotoYPrecio,
  pasaAUnaAsesora,
  preguntaPorLaFoto,
  type FotoDelCliente,
} from "./foto-y-precio";

/**
 * EL MOTOR: dado un mensaje y el estado de la conversación, elige UNA regla (o, si la clienta
 * preguntó varias cosas de tema a la vez, junta esas respuestas en un solo mensaje).
 *
 * Es una función pura y sin IA adentro. Eso no es un detalle: significa que la misma entrada da
 * siempre la misma salida, que se puede probar contra conversaciones viejas sin gastar un peso, y
 * que cuando algo sale mal se puede señalar exactamente qué regla lo hizo.
 *
 * La IA entra en dos momentos, y solo en esos: para decir qué intenciones reconoce en el mensaje
 * (se le pasa el resultado ya masticado en `intencionesReconocidas`), y para redactar cuando la
 * acción elegida es "responder con IA". Nunca para elegir qué hacer.
 */

export type EstadoDeLaCharla = {
  /** Producto del que se viene hablando, o null si todavía no eligió. */
  productoActivo: string | null;
  pasoActual: PasoDelEmbudo | null;
  /** Flujos ya enviados en esta conversación: evita mandar el mismo catálogo dos veces. */
  flujosEnviados: string[];
  esPrimerMensaje: boolean;
  /** Minutos desde el último mensaje del cliente. Para las reglas de "si no contesta". */
  minutosSinRespuesta?: number;
  /**
   * Seguimientos ya enviados en ESTE silencio (los minutos de cada regla que ya salió).
   *
   * Se limpia apenas el cliente vuelve a escribir: el silencio se terminó y el próximo empieza de
   * cero. Sin esto, el reloj mandaría el mismo recordatorio cada vez que pasa.
   */
  seguimientosEnviados?: number[];
  /**
   * Ya se avisó "en un momento te contacta una asesora" durante ESTA pausa.
   *
   * Se manda una sola vez: si la clienta escribe cinco veces mientras espera, recibe un aviso, no
   * cinco. Vuelve a cero cuando el agente retoma el chat, que es cuando la pausa terminó.
   */
  avisoDePausaEnviado?: boolean;
};

export type Decision = {
  regla: ReglaV3 | null;
  /** Lo que sale SIEMPRE antes, aunque gane otra regla: hoy, el saludo del primer mensaje. */
  saludo: Accion[];
  acciones: Accion[];
  /** En palabras: por qué ganó ésta. Es lo que se va a poder leer en el chat. */
  porque: string;
  /** Las que también encajaban y perdieron, para poder explicar un desempate. */
  tambienEncajaban: Array<{ id: string; nombre: string }>;
  /**
   * Cuando la clienta preguntó varias cosas a la vez: las reglas de tema que se contestaron JUNTAS
   * en un solo mensaje (ver `juntarVariasPreguntas`). Ausente = ganó una sola, como siempre.
   */
  juntas?: Array<{ id: string; nombre: string }>;
};

/**
 * ¿Se cumplen las condiciones extra de una regla en este momento de la charla?
 *
 * Exportada porque el reloj de seguimientos también la necesita: un recordatorio escrito para el
 * paso de presentación no puede salir cuando el cliente ya vio las fotos.
 */
export function cumpleLasCondiciones(regla: ReglaV3, estado: EstadoDeLaCharla): boolean {
  const soloSi = regla.soloSi;
  if (!soloSi) {
    return true;
  }

  if (soloSi.productoActivo === "ninguno" && estado.productoActivo) {
    return false;
  }
  if (soloSi.productoActivo === "cualquiera" && !estado.productoActivo) {
    return false;
  }
  if (
    soloSi.productoActivo &&
    soloSi.productoActivo !== "ninguno" &&
    soloSi.productoActivo !== "cualquiera" &&
    soloSi.productoActivo !== estado.productoActivo
  ) {
    return false;
  }
  if (soloSi.pasoActual && soloSi.pasoActual !== estado.pasoActual) {
    return false;
  }
  if (soloSi.noSiYaSeEnvio && estado.flujosEnviados.includes(soloSi.noSiYaSeEnvio)) {
    return false;
  }
  if (soloSi.esPrimerMensaje !== undefined && soloSi.esPrimerMensaje !== estado.esPrimerMensaje) {
    return false;
  }
  return true;
}

function seDispara(
  regla: ReglaV3,
  mensaje: string,
  estado: EstadoDeLaCharla,
  intencionesReconocidas: string[],
): boolean {
  const texto = normalizar(mensaje);

  switch (regla.cuando.tipo) {
    case "frase": {
      const frases = regla.cuando.frases.map(normalizar).filter(Boolean);
      return regla.cuando.exacta
        ? frases.includes(texto)
        : frases.some((frase) => texto.includes(frase));
    }
    case "intencion":
      // La IA ya dijo qué reconoció; acá solo se mira si esta regla estaba entre esas.
      return intencionesReconocidas.includes(regla.id);
    case "paso":
      /*
        El mensaje de un paso sale AL ENTRAR al paso, no cada vez que el cliente escribe.

        Antes se disparaba con cualquier mensaje mientras uno estuviera parado en ese paso: el
        cliente contestaba "En cali" y recibia de nuevo "¿que servicios vas a ofrecer?", que es
        exactamente lo que hace que un bot parezca roto (visto en la prueba del 21-sep-2026).
        Ahora estas reglas solo salen encadenadas desde la regla que movio el paso; por eso aca
        nunca se disparan solas.
      */
      return false;
    case "sin_respuesta":
      return (estado.minutosSinRespuesta ?? 0) >= regla.cuando.minutos;
    case "siempre":
      return true;
    default:
      return false;
  }
}

function comoSeLee(regla: ReglaV3): string {
  switch (regla.cuando.tipo) {
    case "frase":
      return `el cliente dijo ${regla.cuando.frases.map((frase) => `"${frase}"`).join(" o ")}`;
    case "intencion":
      return `lo que pidió encaja con "${regla.cuando.descripcion}"`;
    case "paso":
      return `viene hablando de ese producto y está en el paso ${regla.cuando.paso}`;
    case "sin_respuesta":
      return `pasaron ${regla.cuando.minutos} minutos sin que contestara`;
    default:
      return "no había ninguna regla más específica";
  }
}

/**
 * Elige la regla que manda.
 *
 * El desempate es el corazón de todo esto: primero las que se disparan, después la de menor peso
 * (lo más específico gana) y, si empatan, la que esté primero en el libro. Nada queda al azar ni
 * al criterio del modelo, que es exactamente lo que hacía que el V2 mandara el catálogo cuando
 * había que mandar las fotos.
 */
export function decidir(input: {
  libro: LibroDeReglas;
  mensaje: string;
  estado: EstadoDeLaCharla;
  /** Ids de las reglas de intención que la IA reconoció en este mensaje. */
  intencionesReconocidas?: string[];
  /**
   * La clienta mandó una foto hace poco (ver `fotoDelClienteReciente`). Solo cuentan las fotos
   * que mandó ELLA, no las que le enviamos nosotros.
   */
  fotoDelCliente?: FotoDelCliente | null;
}): Decision {
  const intenciones = input.intencionesReconocidas ?? [];

  /*
    El saludo del primer mensaje sale SIEMPRE, aunque gane otra regla.

    No compite: se suma. Si compitiera, un cliente que escribe "quiero el combo de estetica" en su
    primer mensaje entraria directo al embudo y nunca recibiria la bienvenida, que es obligatoria
    (Alex, 21-sep-2026). Son las reglas de tipo "siempre" atadas al primer mensaje.
  */
  const saludo = input.estado.esPrimerMensaje
    ? input.libro.reglas
        .filter((regla) => regla.activa && regla.cuando.tipo === "siempre" && regla.soloSi?.esPrimerMensaje === true)
        .flatMap((regla) => regla.entonces)
    : [];
  const esDelSaludo = new Set(
    input.libro.reglas
      .filter((regla) => regla.cuando.tipo === "siempre" && regla.soloSi?.esPrimerMensaje === true)
      .map((regla) => regla.id),
  );

  const candidatas = input.libro.reglas
    .filter((regla) => !esDelSaludo.has(regla.id))
    .map((regla, orden) => ({ regla, orden }))
    .filter(({ regla }) => regla.activa)
    .filter(({ regla }) => cumpleLasCondiciones(regla, input.estado))
    .filter(({ regla }) => seDispara(regla, input.mensaje, input.estado, intenciones));

  /*
    FOTO + PRECIO, antes que las frases (caso del 08-10-2026, ver foto-y-precio.ts).

    Si la clienta acaba de mandar la foto de un producto y pregunta "¿qué valor tiene así?", las
    reglas genéricas de precio NO aplican: contestarían el precio del producto activo por una
    referencia que puede ser otra. Gana la regla de intención "foto + precio" del libro si está
    activa y cumple sus condiciones; si el libro no la tiene, el motor avisa, pausa y no da precio.
  */
  const fotoYPrecio = decidirFotoYPrecio({
    ...input,
    intenciones,
    esDelSaludo,
    saludo,
    candidatas: candidatas.map(({ regla }) => regla),
  });
  if (fotoYPrecio) {
    return fotoYPrecio;
  }

  if (candidatas.length === 0) {
    return {
      regla: null,
      saludo,
      acciones: [],
      porque: saludo.length
        ? "Sale el saludo del primer mensaje; ninguna otra regla encajó."
        : "Ninguna regla encajó con este mensaje.",
      tambienEncajaban: [],
    };
  }

  const ordenadas = [...candidatas].sort((a, b) => {
    const peso = pesoDeLaRegla(a.regla) - pesoDeLaRegla(b.regla);
    return peso !== 0 ? peso : a.orden - b.orden;
  });

  const ganadora = ordenadas[0].regla;

  /*
    VARIAS PREGUNTAS EN UN MENSAJE (caso del 26-10-2026, ver `juntarVariasPreguntas`).

    Solo si la que ganaría es una regla de tema (garantía, envío, materiales...). Si gana una que
    cambia la charla -catálogo, mover de paso, tomar un producto- todo sigue igual que antes. El
    saludo va aparte y sale igual; la foto + precio ya se resolvió arriba.
  */
  const juntas = juntarVariasPreguntas({
    libro: input.libro,
    mensaje: input.mensaje,
    estado: input.estado,
    esDelSaludo,
    saludo,
    ordenadas: ordenadas.map(({ regla }) => regla),
  });
  if (juntas) {
    return juntas;
  }

  /*
    Si la regla mueve de paso, el mensaje de ESE paso sale en el mismo turno.

    Sin esto, "me interesa el combo de estetica" elegia el producto y lo dejaba en el paso 1... en
    silencio: la pregunta del paso 1 esperaba al mensaje siguiente, que nunca llega porque el
    cliente esta esperando que le hablen. Se vio en la primera prueba por WhatsApp (21-sep-2026).

    Encadena UN solo salto, no en cascada: si el paso al que llega mueve a otro paso, eso ya se
    resuelve con el proximo mensaje. Un encadenado sin limite es como se arma una avalancha de
    mensajes de golpe, que es justo lo que no queremos.
  */
  const despues = siguienteEstado(input.estado, ganadora.entonces);
  const reglaDelPaso =
    despues.pasoActual && despues.pasoActual !== input.estado.pasoActual
      ? input.libro.reglas.find(
          (regla) =>
            regla.activa &&
            regla.id !== ganadora.id &&
            regla.cuando.tipo === "paso" &&
            regla.cuando.producto === despues.productoActivo &&
            regla.cuando.paso === despues.pasoActual,
        )
      : undefined;

  return {
    regla: ganadora,
    saludo,
    acciones: reglaDelPaso ? [...ganadora.entonces, ...reglaDelPaso.entonces] : ganadora.entonces,
    porque: reglaDelPaso
      ? `Ganó "${ganadora.nombre}" porque ${comoSeLee(ganadora)}. Y como pasó al paso ${despues.pasoActual}, sigue con "${reglaDelPaso.nombre}".`
      : `Ganó "${ganadora.nombre}" porque ${comoSeLee(ganadora)}.`,
    tambienEncajaban: ordenadas.slice(1).map(({ regla }) => ({ id: regla.id, nombre: regla.nombre })),
  };
}

/**
 * El desvío de "foto + precio". Devuelve null si no aplica (la clienta no está preguntando por la
 * foto), y entonces el motor sigue con el desempate de siempre.
 */
function decidirFotoYPrecio(input: {
  libro: LibroDeReglas;
  mensaje: string;
  estado: EstadoDeLaCharla;
  fotoDelCliente?: FotoDelCliente | null;
  intenciones: string[];
  esDelSaludo: Set<string>;
  saludo: Accion[];
  candidatas: ReglaV3[];
}): Decision | null {
  if (!input.fotoDelCliente) return null;

  const reglasDeFoto = input.libro.reglas.filter(
    (regla) =>
      regla.activa &&
      !input.esDelSaludo.has(regla.id) &&
      esReglaDeFotoYPrecio(regla) &&
      cumpleLasCondiciones(regla, input.estado),
  );
  // Pregunta por la foto si lo dice con palabras ("valor", "así", "esta"...) o si la IA reconoció
  // la intención de foto + precio sabiendo que hubo una foto.
  const laIaLaReconocio = reglasDeFoto.some((regla) => input.intenciones.includes(regla.id));
  if (!preguntaPorLaFoto(input.mensaje) && !laIaLaReconocio) return null;

  // Si hay varias: primero la que reconoció la IA, después la que pasa a una asesora, después el orden del libro.
  const puntaje = (regla: ReglaV3) =>
    (input.intenciones.includes(regla.id) ? 2 : 0) + (pasaAUnaAsesora(regla) ? 1 : 0);
  const delLibro = [...reglasDeFoto].sort((a, b) => puntaje(b) - puntaje(a))[0];
  const ganadora = delLibro ?? REGLA_FOTO_Y_PRECIO_POR_DEFECTO;
  const pie = input.fotoDelCliente.pie ? ` (con el texto "${input.fotoDelCliente.pie.slice(0, 80)}")` : "";

  return {
    regla: ganadora,
    saludo: input.saludo,
    acciones: ganadora.entonces,
    porque: delLibro
      ? `Ganó "${ganadora.nombre}" porque la clienta mandó una foto${pie} y ahora pregunta por ella: no se aplican las reglas genéricas de precio.`
      : `La clienta mandó una foto${pie} y ahora pregunta por ella; el libro no tiene una regla activa de "foto + precio", así que el agente no dio ningún precio, avisó a una asesora y pausó la IA.`,
    tambienEncajaban: input.candidatas
      .filter((regla) => regla.id !== ganadora.id)
      .map((regla) => ({ id: regla.id, nombre: regla.nombre })),
  };
}

/*
  VARIAS PREGUNTAS, UN SOLO MENSAJE CORTO.

  Caso real (26-10-2026, Ventas 1, combo de camillas): la clienta escribió "Materiales garantía y
  envío los costos es gratis??". Encajaban tres reglas y, como el motor dejaba ganar una sola, se
  le contestó solo la garantía: nunca supo de qué está hecho ni cuánto cuesta el envío, y dejó de
  escribir.

  Ahora, si encajan dos o más reglas de TEMA (ver `temaDeLaRegla`), se contestan todas en un solo
  mensaje: una línea corta por tema, con su emoji, y al final UNA pregunta para avanzar. Los datos
  salen del texto que ya está escrito en cada regla, nunca se inventan: de cada una se toma su
  primera frase útil (la que afirma algo, no la pregunta).

  Si además pregunta el precio de OTRO producto ("¿y cuánto vale la silla?"), no se le contesta el
  precio del combo: se contesta lo demás y solo ese precio pasa a una asesora, con el texto de la
  regla de "foto + precio" del libro (o el del motor si el libro no la tiene).
*/

/** Palabras de precio, comparadas enteras: "vale" no engancha en "equivale". */
const PALABRAS_DE_PRECIO_DE_OTRO = ["precio", "valor", "cuanto vale", "cuanto cuesta", "cuesta", "vale", "costo"];
/** Productos que NO son el combo. "camilla" no está: es parte del combo. */
const OTROS_PRODUCTOS = [
  "silla",
  "sillas",
  "sofa",
  "sofas",
  "tocador",
  "tocadores",
  "lavacabezas",
  "espejo",
  "espejos",
  "mueble",
  "muebles",
  "butaco",
  "butacos",
  "poltrona",
  "poltronas",
  "vitrina",
  "vitrinas",
];
const EMOJI_DE_LA_ASESORA = "👨🏻‍💻";
export const MOTIVO_PRECIO_DE_OTRO_PRODUCTO =
  "Preguntó varias cosas a la vez y una es el precio de otro producto (no el del combo): se le contestó lo demás, falta ese precio";

/** ¿Pregunta el precio de un producto que no es el combo? */
export function preguntaPrecioDeOtroProducto(mensaje: string): boolean {
  const texto = ` ${normalizar(mensaje)} `;
  if (texto.includes(" combo ")) return false;
  const preguntaPrecio = PALABRAS_DE_PRECIO_DE_OTRO.some((palabra) => texto.includes(` ${palabra} `));
  return preguntaPrecio && OTROS_PRODUCTOS.some((producto) => texto.includes(` ${producto} `));
}

const INTERJECCIONES = ["claro", "perfecto", "listo", "con gusto", "hola", "genial", "super", "excelente", "que bien", "dale"];

/**
 * ¿Sirve esta frase como respuesta? No sirven las preguntas, los "¡Claro!" sueltos, las que
 * anuncian una lista ("te cuento:") ni las que ofrecen contraentrega (política del 09-10-2026: la
 * mezcla nunca la ofrece; una frase que dice que NO se maneja sí sirve).
 */
function esFraseUtil(frase: string): boolean {
  const texto = normalizar(frase);
  const palabras = texto.split(" ").filter(Boolean);
  if (palabras.length < 3) return false;
  if (/[:,]\s*$/.test(frase.trim())) return false;
  if (palabras.length <= 4 && INTERJECCIONES.some((inicio) => texto.startsWith(inicio))) return false;
  if (/contra ?entrega/.test(texto) && !palabras.includes("no")) return false;
  return true;
}

/** Quita los emojis o viñetas del comienzo, para poner el del tema sin que queden dos. */
function sinEmojiAlComienzo(frase: string): string {
  return frase.replace(/^(?:\p{Extended_Pictographic}|‍|️|[\u{1F3FB}-\u{1F3FF}]|[•·\-–]|\s)+/u, "").trim();
}

/** Las frases que afirman algo, en orden: cada línea partida por oraciones, sin la parte de pregunta. */
function frasesQueAfirman(texto: string): string[] {
  const frases: string[] = [];
  for (const linea of texto.split(/\n+/)) {
    for (const oracion of linea.split(/(?<=[.!?])\s+/)) {
      // Lo que viene desde el "¿" es pregunta; lo de antes puede ser una afirmación.
      const antes = oracion.split("¿")[0].trim();
      if (!antes || antes.endsWith("?")) continue;
      const limpia = sinEmojiAlComienzo(antes);
      if (limpia && esFraseUtil(limpia)) frases.push(limpia);
    }
  }
  return frases;
}

/** La ÚLTIMA pregunta del texto ("¿En qué ciudad estás?"), o null si no tiene ninguna. */
function preguntaDelTexto(texto: string): string | null {
  const preguntas = texto.match(/¿[^¿?]+\?/g) ?? [];
  for (const pregunta of [...preguntas].reverse()) {
    if (/contra ?entrega/.test(normalizar(pregunta))) continue;
    return pregunta.trim().replace(/^¿\s*(\p{Ll})/u, (_, letra: string) => `¿${letra.toUpperCase()}`);
  }
  return null;
}

function textosDeLaRegla(regla: ReglaV3): string[] {
  return regla.entonces
    .filter((accion): accion is Extract<Accion, { tipo: "mensaje" }> => accion.tipo === "mensaje")
    .map((accion) => accion.texto?.trim() ?? "")
    .filter(Boolean);
}

/** Dónde y cuánto encaja la frase de la regla en el mensaje: para ordenar como preguntó y desempatar. */
function encaje(regla: ReglaV3, mensaje: string): { posicion: number; largo: number } {
  if (regla.cuando.tipo !== "frase") return { posicion: Number.POSITIVE_INFINITY, largo: 0 };
  const texto = normalizar(mensaje);
  let posicion = Number.POSITIVE_INFINITY;
  let largo = 0;
  for (const frase of regla.cuando.frases.map(normalizar).filter(Boolean)) {
    const donde = texto.indexOf(frase);
    if (donde < 0) continue;
    posicion = Math.min(posicion, donde);
    largo = Math.max(largo, frase.length);
  }
  return { posicion, largo };
}

/**
 * Junta las reglas de tema que encajaron en UNA respuesta, o devuelve null si no corresponde (y el
 * motor sigue con la ganadora de siempre).
 *
 * Corresponde solo si la ganadora de siempre es de tema y quedan al menos dos temas con algo que
 * decir, o uno más el precio de otro producto. Las reglas que no son de tema y perdieron siguen
 * perdiendo, igual que antes.
 */
function juntarVariasPreguntas(input: {
  libro: LibroDeReglas;
  mensaje: string;
  estado: EstadoDeLaCharla;
  esDelSaludo: Set<string>;
  saludo: Accion[];
  /** Las candidatas ya ordenadas por el desempate: la primera es la que ganaría sola. */
  ordenadas: ReglaV3[];
}): Decision | null {
  const ganadora = input.ordenadas[0];
  if (!ganadora || !temaDeLaRegla(ganadora)) return null;

  const precioDeOtro = preguntaPrecioDeOtroProducto(input.mensaje);

  /*
    Una regla por tema: si dos hablan de lo mismo ("envío" y "¿el envío es gratis?"), va la que
    encajó con la frase más larga, que es la más específica; si empatan, la que ya ganaba el
    desempate. Con el precio de otro producto, las de precio se dejan afuera: darían el del combo.
  */
  const porTema = new Map<string, { regla: ReglaV3; tema: TemaDePregunta; orden: number; posicion: number; largo: number }>();
  input.ordenadas.forEach((regla, orden) => {
    const tema = temaDeLaRegla(regla);
    if (!tema) return;
    if (precioDeOtro && tema.tema === "precio") return;
    const { posicion, largo } = encaje(regla, input.mensaje);
    const actual = porTema.get(tema.tema);
    if (!actual || largo > actual.largo) {
      porTema.set(tema.tema, { regla, tema, orden, posicion, largo });
    }
  });

  // En el orden en que la clienta lo preguntó; las de intención (sin posición) al final.
  const elegidas = [...porTema.values()].sort((a, b) =>
    a.posicion !== b.posicion ? a.posicion - b.posicion : a.orden - b.orden,
  );
  const conIa = elegidas.some(({ regla }) => regla.entonces.some((accion) => accion.tipo === "responder_con_ia"));

  // Con textos fijos, cada tema necesita una frase que afirme algo; si no la tiene, no entra.
  const lineas = elegidas
    .map((elegida) => {
      const frase = textosDeLaRegla(elegida.regla).flatMap(frasesQueAfirman)[0];
      return frase ? { ...elegida, linea: `${elegida.tema.emoji} ${frase}` } : null;
    })
    .filter((linea): linea is NonNullable<typeof linea> => linea !== null);
  const juntas = conIa ? elegidas : lineas;

  if (juntas.length === 0 || (juntas.length < 2 && !precioDeOtro)) return null;

  // El precio de otro producto: con el texto y las acciones de la regla de "foto + precio".
  const deLaAsesora = precioDeOtro ? reglaParaElPrecioDeOtro(input) : null;
  const lineaDeLaAsesora = deLaAsesora
    ? (() => {
        const frases = textosDeLaRegla(deLaAsesora).flatMap(frasesQueAfirman);
        return frases.length ? `${EMOJI_DE_LA_ASESORA} ${frases.join(" ")}` : null;
      })()
    : null;
  const accionesDeLaAsesora: Accion[] = deLaAsesora
    ? [
        { tipo: "avisar_asesor", motivo: MOTIVO_PRECIO_DE_OTRO_PRODUCTO },
        ...(deLaAsesora.entonces.some((accion) => accion.tipo === "pausar_ia") ? [{ tipo: "pausar_ia" } as const] : []),
      ]
    : [];

  // UNA sola pregunta al final: la de la ganadora; si no trae, la de otra de las juntas o la de la asesora.
  const pregunta =
    [ganadora, ...juntas.map(({ regla }) => regla), ...(deLaAsesora ? [deLaAsesora] : [])]
      .flatMap(textosDeLaRegla)
      .map(preguntaDelTexto)
      .find((texto): texto is string => Boolean(texto)) ?? null;

  const respuesta: Accion = conIa
    ? { tipo: "responder_con_ia", guia: guiaCombinada(juntas, lineaDeLaAsesora, pregunta) }
    : {
        tipo: "mensaje",
        texto: [...lineas.map(({ linea }) => linea), ...(lineaDeLaAsesora ? [lineaDeLaAsesora] : []), ...(pregunta ? [pregunta] : [])].join("\n"),
      };

  const nombres = juntas.map(({ regla }) => `"${regla.nombre}"`);
  const enLista = nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}` : nombres[0];
  const idsJuntas = new Set(juntas.map(({ regla }) => regla.id));

  return {
    regla: juntas[0].regla,
    saludo: input.saludo,
    acciones: [respuesta, ...accionesDeLaAsesora],
    porque:
      `Preguntó varias cosas a la vez: se contestaron juntas, en un solo mensaje corto, ${enLista}.` +
      (deLaAsesora ? " También preguntó el precio de otro producto: ese lo confirma una asesora." : ""),
    tambienEncajaban: input.ordenadas
      .filter((regla) => !idsJuntas.has(regla.id))
      .map((regla) => ({ id: regla.id, nombre: regla.nombre })),
    juntas: juntas.map(({ regla }) => ({ id: regla.id, nombre: regla.nombre })),
  };
}

/** La regla de "foto + precio" del libro que pasa el precio a una asesora; si no hay, la del motor. */
function reglaParaElPrecioDeOtro(input: { libro: LibroDeReglas; estado: EstadoDeLaCharla; esDelSaludo: Set<string> }): ReglaV3 {
  const delLibro = input.libro.reglas.filter(
    (regla) =>
      regla.activa &&
      !input.esDelSaludo.has(regla.id) &&
      esReglaDeFotoYPrecio(regla) &&
      cumpleLasCondiciones(regla, input.estado),
  );
  return [...delLibro].sort((a, b) => Number(pasaAUnaAsesora(b)) - Number(pasaAUnaAsesora(a)))[0] ?? REGLA_FOTO_Y_PRECIO_POR_DEFECTO;
}

/**
 * Si alguna de las reglas juntas contesta con IA, no se pega a ciegas un texto fijo con uno de IA:
 * se le pasa a la IA una sola guía con los datos de TODAS, y la orden de contestar en líneas cortas.
 */
function guiaCombinada(
  juntas: Array<{ regla: ReglaV3; tema: TemaDePregunta }>,
  lineaDeLaAsesora: string | null,
  pregunta: string | null,
): string {
  const datos = juntas.map(({ regla, tema }) => {
    const deLaRegla = regla.entonces
      .map((accion) => (accion.tipo === "mensaje" ? accion.texto : accion.tipo === "responder_con_ia" ? accion.guia : ""))
      .filter((texto) => texto?.trim())
      .join(" ");
    return `${tema.emoji} ${tema.etiqueta}: ${deLaRegla}`;
  });
  return [
    "La clienta hizo varias preguntas en el mismo mensaje. Contéstalas TODAS en UN solo mensaje corto: una línea por tema, cada una con su emoji, sin párrafos largos.",
    "Usa SOLO estos datos, sin inventar nada y sin ofrecer contraentrega:",
    ...datos,
    ...(lineaDeLaAsesora
      ? [`También preguntó el precio de otro producto: no lo des. Agrega esta línea tal cual: ${lineaDeLaAsesora}`]
      : []),
    pregunta ? `Termina con esta única pregunta: ${pregunta}` : "Termina con una sola pregunta corta para avanzar la venta.",
  ].join("\n");
}

/**
 * Cómo queda la charla después de ejecutar una decisión.
 *
 * Va acá y no en el webhook para que el simulador y la vida real avancen igual: si el estado se
 * calculara distinto en cada lado, el simulador diría una cosa y el cliente recibiría otra, que es
 * la forma más cara de perder la confianza en una prueba.
 */
export function siguienteEstado(estado: EstadoDeLaCharla, acciones: Accion[]): EstadoDeLaCharla {
  // El saludo tambien cuenta como accion ejecutada: entra por `acciones` desde quien lo ejecuta.
  // Y el cliente acaba de escribir: se termino el silencio, asi que los seguimientos arrancan
  // de cero para la proxima vez que se calle.
  let siguiente: EstadoDeLaCharla = {
    ...estado,
    esPrimerMensaje: false,
    seguimientosEnviados: [],
    // Si el motor esta decidiendo, el chat no esta pausado: el proximo traspaso vuelve a avisar.
    avisoDePausaEnviado: false,
  };
  for (const accion of acciones) {
    if (accion.tipo === "activar_producto") {
      siguiente = { ...siguiente, productoActivo: accion.productoId, pasoActual: siguiente.pasoActual ?? "PRESENTACION" };
    }
    if (accion.tipo === "ir_al_paso") {
      siguiente = { ...siguiente, pasoActual: accion.paso };
    }
    if (accion.tipo === "flujo") {
      siguiente = { ...siguiente, flujosEnviados: [...siguiente.flujosEnviados, accion.flujoId] };
    }
  }
  return siguiente;
}
