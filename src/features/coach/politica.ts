/**
 * LAS REGLAS DEL COACH DE VENTAS, EN UN SOLO LUGAR.
 *
 * Todo lo que el coach usa para juzgar un chat sale de aca: el horario laboral, la demora que se
 * tolera, los pesos de la rubrica, la politica de envio y de pago y el modelo de IA. El prompt se
 * arma con este archivo y las reglas de codigo (demoras, puntaje) leen los mismos valores: si Alex
 * cambia una politica, se cambia aca y se sube `version`, que queda guardada en cada informe para
 * saber con que reglas se juzgo cada dia (leccion de la Fase A, 07-10-2026).
 *
 * Fuente: boveda de Magilus, Ventas/2026-10-06-tabla-envios-v1.md (decisiones del 7-oct, del
 * 8-oct noche y del 9-oct) y Equipo/2026-10-07-coach-fase-a-resultados.md (rubrica, seccion 6).
 *
 * Este archivo no importa nada: lo usan el servidor, la pantalla y las pruebas sin base.
 */

/** Dia de la semana como en Date#getUTCDay: 0 = domingo ... 6 = sabado. null = no se trabaja. */
export type TramoLaboral = { desde: string; hasta: string } | null;
export type HorarioLaboral = Record<0 | 1 | 2 | 3 | 4 | 5 | 6, TramoLaboral>;

/** Los ejes de la rubrica de la Fase A. "R" (resultado) se guarda pero NO entra al promedio. */
export type EjeDeRubrica = "V" | "N" | "A" | "S" | "C";

export const POLITICA_COACH = {
  /** Se guarda en cada informe. Subirla cada vez que cambie una regla de abajo. */
  version: "2026-10-10 tabla-envios-v1 + 8-oct-noche + contraentrega suspendida + habilidad-v1",

  /** Colombia no cambia de hora: desfase fijo. */
  desfaseBogotaMin: -5 * 60,

  /** Lunes a viernes de 8 a 18; sabado de 9 a 14; domingo no se cuenta. */
  horario: {
    0: null,
    1: { desde: "08:00", hasta: "18:00" },
    2: { desde: "08:00", hasta: "18:00" },
    3: { desde: "08:00", hasta: "18:00" },
    4: { desde: "08:00", hasta: "18:00" },
    5: { desde: "08:00", hasta: "18:00" },
    6: { desde: "09:00", hasta: "14:00" },
  } satisfies HorarioLaboral as HorarioLaboral,

  /** Minutos LABORALES que un cliente puede esperar a una persona antes de contar como demora. */
  demoraMaximaMin: 15,

  /** Un descarte (Perdido) antes de estas horas desde el ultimo mensaje del cliente es prematuro. */
  horasMinimasParaDescartar: 72,

  /**
   * Pesos de la rubrica (Fase A: 20/20/20/15/15/10). Resultado se quita del promedio de la asesora
   * porque inflaba las ganadas; los demas se reparten en proporcion.
   */
  pesos: { V: 20, N: 20, A: 20, S: 15, C: 15 } satisfies Record<EjeDeRubrica, number>,

  envio: {
    /** Con pago 50 % + 50 % el envio es gratis en estas ciudades (decision del 8-oct noche). */
    gratis: [
      "Cali",
      "Bogotá",
      "Soacha",
      "Chía",
      "Mosquera",
      "Funza",
      "Cota",
      "La Calera",
      "Cajicá",
      "Madrid",
      "Tocancipá",
      "Zipaquirá",
      "Facatativá",
      "Sopó",
      "La Mesa",
      "Ibagué",
      "Armenia",
      "Manizales",
      "Neiva",
      "Pereira",
      "Bucaramanga",
      "Medellín",
      "Tunja",
      "Villavicencio",
    ],
    /** Ciudades lejanas del interior: adicional fijo. */
    adicional: {
      valor: 100_000,
      ciudades: [
        "Yopal",
        "Girardota",
        "Barbosa",
        "Pamplona",
        "Santa Rosa de Osos",
        "Yarumal",
        "Cúcuta",
        "Los Patios",
        "Villa del Rosario",
        "Buenaventura",
        "Ocaña",
        "Popayán",
        "Caucasia",
        "La Unión (Nariño)",
        "Túquerres",
        "Ipiales",
        "Tumaco",
      ],
    },
    /** Se cotiza antes de cerrar. */
    seCotiza: ["Costa Caribe", "Chocó", "Urabá (Apartadó, Turbo, Necoclí)", "Arauca", "Saravena"],
    /** Solo avion: no se cotiza ni se persigue (decision del 7-oct). */
    noLlegamos: ["San Andrés", "Leticia", "Inírida", "Mitú", "Bahía Solano"],
  },

  pago: {
    unicaForma: "50 % de anticipo para fabricar y 50 % al terminar, antes de despachar",
    /**
     * Contraentrega SUSPENDIDA (9-oct). Ya el 8-oct en la noche: "nadie ofrece nuevas". Se respetan
     * las que ya estaban ofrecidas: en esos chats repetirla no es error de la asesora.
     */
    contraentregaPermitida: false,
    contraentregasRespetadas: ["8948", "6011", "3806", "5210", "7651"],
  },

  /**
   * Lo que la IA debe saber del negocio y que no es una lista. Las listas de ciudades, la forma de
   * pago, la contraentrega y el horario se agregan al prompt DESDE los campos de arriba
   * (`reglasParaElPrompt` en reglas.ts): no se repiten aca.
   */
  reglasDelNegocio: [
    "Magilus fabrica y vende muebles para peluquerías, spas y barberías desde Cali, Colombia. Vende por WhatsApp.",
    "Producto estrella: combo de camilla a $989.000; se separa con el 50 % ($494.500). No inventes otros precios: si en el chat hay un precio distinto para lo mismo, anótalo como falla del sistema, no como error de la asesora.",
    "Ciudad que no está en ninguna lista: no supongas; si la asesora dio una cifra, anótalo como falla del sistema (falta la regla), no como error.",
    "El primer mensaje del bot dice 'envío gratis a ciudades principales': es válido con la lista de envío gratis.",
    "Tono de la marca: cercano, de tú, corto, sin presionar, un solo total claro en texto (no varias cifras seguidas), siempre con la siguiente pregunta (color, ciudad o datos).",
    "El coach enseña, no castiga: no premies mandar más mensajes ni perseguir a quien no tiene intención.",
  ],

  ia: {
    /** El mismo proveedor y la misma llave del repo (OPENAI_API_KEY). Se puede cambiar con COACH_MODEL. */
    modelo: "gpt-4.1-mini",
    /** US$ por millon de tokens. Para estimar el costo de cada corrida. */
    precios: {
      "gpt-4.1-mini": { entrada: 0.4, salida: 1.6 },
      "gpt-4o-mini": { entrada: 0.15, salida: 0.6 },
      "gpt-4.1-nano": { entrada: 0.1, salida: 0.4 },
    } as Record<string, { entrada: number; salida: number }>,
    /** Tope de chats leidos por corrida (control de costo). */
    maxChats: 150,
    /** Chats quietos (sin mensajes hoy) en Caliente/Tibio que se revisan solo para pendientes. */
    maxChatsQuietos: 40,
    chatsPorLote: 8,
    maxCaracteresPorTurno: 400,
    /** Turnos anteriores al dia que se mandan como contexto. */
    turnosDeContexto: 20,
    /** Tope de turnos del dia por chat (los ultimos). */
    maxTurnosDelDia: 60,
  },

  /**
   * El reloj: a partir de esta hora de Bogota (y hasta las 23:58) se genera el coach del dia.
   * maxIntentosPorDia: el reloj no reintenta un ERROR mas de esto (cada intento paga IA).
   * minutosColgado: un EN_CURSO de mas de esto se da por caido (reinicio del servidor).
   */
  reloj: { hora: 23, minuto: 30, maxIntentosPorDia: 2, minutosColgado: 30 },

  /**
   * LA HABILIDAD DEL DIA DE CADA ASESORA (habilidad-v1, 10-oct-2026). La elige el CODIGO, no la IA.
   *
   * Por que: hasta el 9-oct la "una cosa a mejorar" la escribia la IA en cada lote de 8 chats y
   * otra llamada la resumia sin ver los conteos; el prompt dedica casi todas sus reglas a envio y
   * contraentrega y le prohibe repetir demoras y sin respuesta como errores. Resultado: las tres
   * asesoras recibieron "no ofrezcas contraentrega / cotiza el envio" con metricas muy distintas.
   *
   * FORMULA (todo con los errores de ELLA en el dia; los del equipo se apartan, ver abajo):
   *
   *   puntaje(error)    = peso[tipo]
   *                       + extraDemoraLarga        (solo demoras de mas de demoraLargaMin)
   *                     x multiplicadorTemperatura[temperatura del chat]   (cliente caliente pesa mas)
   *                     x confianza[medido | ia]   (demora, sin respuesta y descarte se miden con
   *                                                 reloj; lo demas lo lee la IA y se equivoca mas)
   *   etapaCritica      = la etapa de venta con mas puntaje sumado (antes del precio, despues del
   *                       precio, despues de cotizar, seguimiento)
   *   impacto(habilidad)= suma de puntaje(error) de sus tipos
   *                     + puntosPorPuntoDeEje x max(0, ejeMinimo - el eje mas bajo de la habilidad)
   *                     + bonoEtapaCritica x (puntaje de sus errores que caen en la etapa critica)
   *   habilidad         = la de mayor impacto con al menos 1 error propio (empate: orden del catalogo)
   *
   * PROBLEMA DEL EQUIPO: un tipo de error es del equipo si (a) esta en un cambio de politica vigente
   * ese dia (`cambiosDePolitica`) o (b) lo tienen TODAS las asesoras del dia (2 o mas) y parejo
   * (el que mas tiene no pasa de maxDispersionEquipo veces al que menos). Se muestra UNA vez en el
   * resumen del equipo y no entra al impacto individual, salvo que en una asesora su habilidad con
   * esos errores supere factorDominante veces a la mejor habilidad sin ellos.
   * La contraentrega de los chats respetados (pago.contraentregasRespetadas) no cuenta como error.
   */
  habilidad: {
    version: "habilidad-v1 2026-10-10",
    peso: {
      sin_respuesta: 5,
      descarte_prematuro: 4,
      sin_cotizacion: 3,
      promesa_sin_cumplir: 3,
      sin_total_claro: 2.5,
      demora: 2,
      cobro_envio_gratis: 2,
      contraentrega: 2,
      dato_errado: 1.5,
      otro: 0,
    } as Record<string, number>,
    demoraLargaMin: 60,
    extraDemoraLarga: 1,
    multiplicadorTemperatura: { caliente: 1.5, tibio: 1.2, frio: 1, cerrado: 1, no_perseguir: 0.5 } as Record<string, number>,
    confianza: { medido: 1, ia: 0.75 },
    ejeMinimo: 7,
    puntosPorPuntoDeEje: 1,
    bonoEtapaCritica: 0.1,
    factorDominante: 1.5,
    maxDispersionEquipo: 2,
    /** Metas del dia siguiente: los conteos se bajan a la mitad; lo que no tiene excusa, a 0. */
    metaMitad: 0.5,
    /**
     * Cambios de politica o del sistema: en estos dias ese tipo de error es del equipo (todas
     * venian de la regla vieja), no de una asesora.
     */
    cambiosDePolitica: [
      {
        desde: "2026-10-08",
        hasta: "2026-10-16",
        tipos: ["contraentrega"],
        texto: "La contraentrega se suspendió el 9-oct (desde el 8-oct en la noche nadie ofrece nuevas).",
      },
    ] as Array<{ desde: string; hasta: string; tipos: string[]; texto: string }>,
  },
} as const;

export type PoliticaCoach = typeof POLITICA_COACH;
