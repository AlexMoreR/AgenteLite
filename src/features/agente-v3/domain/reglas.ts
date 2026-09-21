/**
 * EL LIBRO DE REGLAS DEL AGENTE V3.
 *
 * Es LA fuente de verdad: lo que el agente hace vive acá y en ningún otro lado. El diagrama que
 * se vea en pantalla se dibuja DESDE esto, nunca al revés (Alex, 21-sep-2026).
 *
 * Por qué nace: en el V2 la misma decisión vive en tres lugares que no se conocen —la intención
 * del flujo, la condición del diagrama y el guion del embudo— y gana la que más se parece a lo que
 * el cliente acaba de escribir. Ese mismo día, un cliente pidió fotos del combo y recibió el
 * catálogo general, porque el catálogo decía en su propia descripción "o por el combo de camillas".
 * No fue la IA desobedeciendo: fueron dos órdenes válidas compitiendo.
 *
 * Las tres decisiones de diseño que arreglan eso:
 *
 * 1. UNA sola regla gana por mensaje, y se sabe cuál. Nada de "la IA elige entre 40 instrucciones".
 * 2. El orden de desempate está ESCRITO (ver `pesoDeLaRegla`), no queda a criterio del modelo.
 * 3. La IA redacta, no decide: el motor elige la acción y la IA pone las palabras cuando la acción
 *    lo pide.
 */

export const PASOS_DEL_EMBUDO = [
  { paso: "PRESENTACION", nombre: "Bienvenida" },
  { paso: "IDENTIFICACION", nombre: "Identificación" },
  { paso: "PRODUCTO", nombre: "Presentación del producto" },
  { paso: "OBJECIONES", nombre: "Dudas y objeciones" },
  { paso: "CIERRE", nombre: "Cierre" },
] as const;

export type PasoDelEmbudo = (typeof PASOS_DEL_EMBUDO)[number]["paso"];

/**
 * Cuándo se activa una regla.
 *
 * `frase` es texto literal y se resuelve sin IA: es lo más barato y lo más predecible, y por eso
 * gana. `intencion` la evalúa la IA, pero UNA sola vez por mensaje y eligiendo entre las
 * candidatas, no leyendo un prompt de veinte mil caracteres.
 */
export type Disparador =
  | { tipo: "frase"; frases: string[]; exacta?: boolean }
  | { tipo: "intencion"; descripcion: string }
  | { tipo: "paso"; producto: string; paso: PasoDelEmbudo }
  | { tipo: "sin_respuesta"; minutos: number }
  | { tipo: "siempre" };

/**
 * Lo que tiene que cumplirse ADEMÁS del disparador.
 *
 * Acá vive lo que en el V2 se escribía en prosa dentro de la intención del flujo ("no aplica si ya
 * se está hablando del combo") y que nadie podía verificar. Como dato, el motor sí lo verifica.
 */
export type Condiciones = {
  /** Id del producto, "ninguno" (todavía no eligió) o "cualquiera". */
  productoActivo?: string | "ninguno" | "cualquiera";
  pasoActual?: PasoDelEmbudo;
  /** No vuelve a aplicar si ese flujo ya se envió en esta conversación. */
  noSiYaSeEnvio?: string;
  /** Solo en el primer mensaje del cliente, o solo después del primero. */
  esPrimerMensaje?: boolean;
};

/**
 * Lo que hace la regla. Son las ÚNICAS cosas que el agente puede hacer: una lista cerrada es lo
 * que permite dibujarlas, probarlas y explicarlas. Si mañana hace falta otra, se agrega acá y se
 * agrega su ejecución, no se escribe en prosa esperando que la IA la invente.
 */
export type Accion =
  | { tipo: "mensaje"; texto: string }
  | { tipo: "flujo"; flujoId: string; titulo?: string }
  | { tipo: "responder_con_ia"; guia: string }
  | { tipo: "activar_producto"; productoId: string; nombre?: string }
  | { tipo: "ir_al_paso"; paso: PasoDelEmbudo }
  | { tipo: "cambiar_etapa_crm"; etapa: string }
  | { tipo: "avisar_asesor"; motivo: string }
  | { tipo: "pausar_ia" };

export type ReglaV3 = {
  id: string;
  /** En palabras del negocio: "Cuando pide fotos del combo, mandar las fotos". */
  nombre: string;
  cuando: Disparador;
  soloSi?: Condiciones;
  entonces: Accion[];
  activa: boolean;
  /** Para el historial: quién la escribió y cuándo. */
  autor?: string;
  creadaEl?: string;
};

export type LibroDeReglas = {
  version: number;
  actualizadoEl: string;
  /** Lo que el negocio ES, en texto: tono, qué vende, qué nunca decir. La IA lo usa para redactar. */
  comoHablamos: string;
  reglas: ReglaV3[];
};

export const LIBRO_VACIO: LibroDeReglas = {
  version: 1,
  actualizadoEl: new Date(0).toISOString(),
  comoHablamos: "",
  reglas: [],
};

/**
 * El orden de desempate, escrito de una vez.
 *
 * Menor peso gana. La idea es simple y es la que faltaba: **lo más específico manda**. Una frase
 * literal es más específica que una intención; lo que ya está en curso (el producto activo y su
 * paso) es más específico que un catálogo general.
 *
 * Con esto, el caso del 21-sep-2026 se resuelve solo: "mandá las fotos del combo" (regla del paso
 * del producto activo) le gana al catálogo general de camillas, sin que nadie tenga que escribir
 * "no apliques si...". Y si dos reglas empatan, gana la que esté primero en el libro, que es una
 * decisión visible y que se puede reordenar.
 */
export function pesoDeLaRegla(regla: ReglaV3): number {
  if (regla.cuando.tipo === "frase") {
    return regla.cuando.exacta ? 10 : 20;
  }
  if (regla.cuando.tipo === "paso") {
    return 30;
  }
  if (regla.cuando.tipo === "sin_respuesta") {
    return 40;
  }
  if (regla.cuando.tipo === "intencion") {
    // Una intención con producto exigido es más específica que una suelta.
    return regla.soloSi?.productoActivo && regla.soloSi.productoActivo !== "cualquiera" ? 50 : 60;
  }
  return 90;
}

/** Texto sin tildes ni mayúsculas, para comparar frases como las escribe la gente. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Revisa el libro antes de guardarlo.
 *
 * Devuelve problemas en lenguaje de negocio, no errores de programa: quien los va a leer es quien
 * dictó la regla. No inventa arreglos: avisa y deja decidir.
 */
export function revisarLibro(libro: LibroDeReglas): string[] {
  const problemas: string[] = [];
  const vistos = new Set<string>();

  for (const regla of libro.reglas) {
    if (vistos.has(regla.id)) {
      problemas.push(`Hay dos reglas con el mismo id (${regla.id}).`);
    }
    vistos.add(regla.id);

    if (!regla.nombre.trim()) {
      problemas.push(`Una regla no tiene nombre (${regla.id}).`);
    }
    if (regla.entonces.length === 0) {
      problemas.push(`"${regla.nombre}" no hace nada: le falta qué tiene que pasar.`);
    }
    if (regla.cuando.tipo === "frase" && regla.cuando.frases.length === 0) {
      problemas.push(`"${regla.nombre}" no tiene frases: nunca se va a disparar.`);
    }
    if (regla.cuando.tipo === "frase") {
      /*
        Una frase de menos de 4 letras engancha adentro de otras palabras.

        Pasó de verdad: un "si" suelto matcheaba "silla" y cambiaba de producto en medio de otra
        charla. Se avisa en vez de prohibirlo: puede haber un código corto legítimo.
      */
      const cortas = regla.cuando.frases.filter((frase) => normalizar(frase).length < 4);
      if (cortas.length > 0) {
        problemas.push(
          `"${regla.nombre}" usa frases muy cortas (${cortas.join(", ")}): van a enganchar dentro de otras palabras.`,
        );
      }
    }
    if (regla.cuando.tipo === "intencion" && regla.cuando.descripcion.trim().length < 15) {
      problemas.push(`"${regla.nombre}" describe la intención en muy pocas palabras: va a disparar de más.`);
    }
  }

  return problemas;
}
