import {
  normalizar,
  pesoDeLaRegla,
  type Accion,
  type LibroDeReglas,
  type PasoDelEmbudo,
  type ReglaV3,
} from "../domain/reglas";

/**
 * EL MOTOR: dado un mensaje y el estado de la conversación, elige UNA regla.
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
};

function cumpleLasCondiciones(regla: ReglaV3, estado: EstadoDeLaCharla): boolean {
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
