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
};

export type Decision = {
  regla: ReglaV3 | null;
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
      return estado.productoActivo === regla.cuando.producto && estado.pasoActual === regla.cuando.paso;
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
  const candidatas = input.libro.reglas
    .map((regla, orden) => ({ regla, orden }))
    .filter(({ regla }) => regla.activa)
    .filter(({ regla }) => cumpleLasCondiciones(regla, input.estado))
    .filter(({ regla }) => seDispara(regla, input.mensaje, input.estado, intenciones));

  if (candidatas.length === 0) {
    return {
      regla: null,
      acciones: [],
      porque: "Ninguna regla encajó con este mensaje.",
      tambienEncajaban: [],
    };
  }

  const ordenadas = [...candidatas].sort((a, b) => {
    const peso = pesoDeLaRegla(a.regla) - pesoDeLaRegla(b.regla);
    return peso !== 0 ? peso : a.orden - b.orden;
  });

  const ganadora = ordenadas[0].regla;
  return {
    regla: ganadora,
    acciones: ganadora.entonces,
    porque: `Ganó "${ganadora.nombre}" porque ${comoSeLee(ganadora)}.`,
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
  let siguiente: EstadoDeLaCharla = { ...estado, esPrimerMensaje: false };
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
