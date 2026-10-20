/*
  Dónde va cada tarjeta en el mapa del Tablero IA: RADIAL, como el tablero "Tareas Magilus".

  El mapa se recorre por niveles (services/niveles.ts). En cada nivel hay uno o más GRUPOS: una
  tarjeta en el centro (la del nivel, o cada raíz en el nivel de entrada) y sus hijas directas
  ALREDEDOR, en UN SOLO anillo:
  - ángulos iguales empezando arriba; el radio crece con la cantidad para que dos vecinas nunca se
    encimen (la cuerda entre vecinas alcanza para dos etiquetas) y nunca baja de RADIO_INICIAL
    (lo justo para no tocar la etiqueta del centro, que es más grande);
  - si son más de MAX_PRIMER_ANILLO, un SEGUNDO anillo más afuera, intercalado (corrido medio paso);
  - en la raíz, los grupos (cada raíz con sus hijas, o una raíz suelta sola) van en filas, uno al lado
    del otro, sin pisarse.
  Determinista (mismo tablero, mismo dibujo, sin azar).

  Las que YA tienen posición en ese nivel (`previas`: las que el dueño arrastró o las que ya estaban
  dibujadas) NO se mueven. Una nueva busca su lugar ideal alrededor de su centro y, si está ocupado,
  el siguiente hueco libre (más afuera si hace falta). Las posiciones NO se guardan en la base: se
  calculan cada vez y, mientras el dueño está en ese nivel, se recuerdan en la pantalla.

  La posición es el CENTRO de la etiqueta (el mapa usa nodeOrigin [0.5, 0.5]): así una etiqueta
  angosta o ancha queda igual de centrada en su lugar.
*/

export type Punto = { x: number; y: number };

/**
 * Lo MÁS que ocupa una etiqueta hija (NodoTarjeta no pasa de estas medidas: 160 x 88 px): el título
 * en hasta 3 líneas (text-xs) y dos líneas de contadores.
 */
export const ANCHO_TARJETA = 160;
export const ALTO_TARJETA = 88;
/** Lo más que ocupa la etiqueta del centro (título de hasta 3 líneas en text-sm y dos de contadores). */
export const ANCHO_CENTRO = 220;
export const ALTO_CENTRO = 112;
/** Aire mínimo entre dos etiquetas. */
export const SEPARACION = 20;

/**
 * Radio mínimo: una hija no toca la etiqueta del centro en NINGÚN ángulo (la diagonal de las dos
 * medias etiquetas con aire). Con títulos de 3 líneas las etiquetas son altas: mirar solo el ancho
 * dejaba que una hija en diagonal tocara el centro.
 */
export const RADIO_INICIAL = Math.ceil(
  Math.hypot((ANCHO_CENTRO + ANCHO_TARJETA) / 2 + SEPARACION, (ALTO_CENTRO + ALTO_TARJETA) / 2 + SEPARACION),
);
/** Más de estas hijas: segundo anillo intercalado. */
export const MAX_PRIMER_ANILLO = 16;
/** Distancia mínima entre los centros de dos hijas vecinas (la diagonal de una etiqueta con aire). */
const CUERDA_MINIMA = Math.ceil(Math.hypot(ANCHO_TARJETA + SEPARACION, ALTO_TARJETA + SEPARACION));
/** Ancho máximo de una fila de grupos en la raíz. */
const ANCHO_FILA = 2400;
const AIRE_GRUPOS = 60;

/** true si dos etiquetas hijas (por su centro) se pisan o quedan a menos de `aire` px. */
export function sePisan(p: Punto, q: Punto, aire = SEPARACION): boolean {
  return Math.abs(p.x - q.x) < ANCHO_TARJETA + aire && Math.abs(p.y - q.y) < ALTO_TARJETA + aire;
}

/** El radio de un anillo con `cuantas` hijas repartidas parejo, para que las vecinas no se encimen. */
export function radioParaAnillo(cuantas: number): number {
  if (cuantas <= 1) return RADIO_INICIAL;
  return Math.max(RADIO_INICIAL, Math.ceil(CUERDA_MINIMA / (2 * Math.sin(Math.PI / cuantas))));
}

type Anillo = { cuantas: number; radio: number; corrimiento: number };

/** Los anillos de un grupo: uno solo hasta MAX_PRIMER_ANILLO; si no, dos (el de afuera intercalado). */
function anillosDe(cuantas: number): Anillo[] {
  if (cuantas <= 0) return [];
  if (cuantas <= MAX_PRIMER_ANILLO) return [{ cuantas, radio: radioParaAnillo(cuantas), corrimiento: 0 }];
  const adentro = Math.ceil(cuantas / 2);
  const afuera = cuantas - adentro;
  const r1 = radioParaAnillo(adentro);
  // Afuera, al menos una diagonal más lejos: ni pegado al de adentro ni encimado.
  const r2 = Math.max(radioParaAnillo(afuera), r1 + CUERDA_MINIMA);
  return [
    { cuantas: adentro, radio: r1, corrimiento: 0 },
    { cuantas: afuera, radio: r2, corrimiento: Math.PI / adentro },
  ];
}

const enAnillo = (anillo: Anillo, i: number): Punto => {
  const angulo = -Math.PI / 2 + anillo.corrimiento + (2 * Math.PI * i) / anillo.cuantas;
  return { x: Math.cos(angulo) * anillo.radio, y: Math.sin(angulo) * anillo.radio };
};

/**
 * Los lugares alrededor de un centro (0,0), en orden: los `cuantas` ideales y, después, lugares de
 * reserva (anillos completos más afuera) para buscar huecos.
 */
function lugaresAlrededor(cuantas: number, extra: number): Punto[] {
  const anillos = anillosDe(cuantas);
  const lugares: Punto[] = [];
  for (const anillo of anillos) for (let i = 0; i < anillo.cuantas; i += 1) lugares.push(enAnillo(anillo, i));
  let radio = (anillos.at(-1)?.radio ?? RADIO_INICIAL - CUERDA_MINIMA) + CUERDA_MINIMA;
  let reserva = extra;
  let vuelta = 0;
  while (reserva > 0) {
    const enEste = Math.max(6, Math.floor((2 * Math.PI * radio) / CUERDA_MINIMA));
    const anillo = { cuantas: enEste, radio, corrimiento: vuelta % 2 ? Math.PI / enEste : 0 };
    for (let i = 0; i < enEste; i += 1) lugares.push(enAnillo(anillo, i));
    reserva -= enEste;
    radio += CUERDA_MINIMA;
    vuelta += 1;
  }
  return lugares;
}

/** El radio más grande de un grupo con `cuantas` hijas (0 si no tiene). */
function radioDelGrupo(cuantas: number) {
  return anillosDe(cuantas).at(-1)?.radio ?? 0;
}

export type GrupoRadial = { centro: string; hijas: string[] };

export function disponerRadial(grupos: GrupoRadial[], previas: ReadonlyMap<string, Punto> = new Map()): Map<string, Punto> {
  const posicion = new Map<string, Punto>();
  const ocupadas: Punto[] = [];
  const vistas = new Set<string>();
  const libre = (p: Punto) => ocupadas.every((q) => !sePisan(p, q));
  const redondo = (p: Punto): Punto => ({ x: Math.round(p.x), y: Math.round(p.y) });

  // Una tarjeta aparece una sola vez (si llegara repetida, vale la primera).
  const limpios = grupos
    .filter((grupo) => {
      if (vistas.has(grupo.centro)) return false;
      vistas.add(grupo.centro);
      return true;
    })
    .map((grupo) => ({
      centro: grupo.centro,
      hijas: grupo.hijas.filter((id) => {
        if (vistas.has(id)) return false;
        vistas.add(id);
        return true;
      }),
    }));

  // 1. Las fijas primero: no se mueven nunca.
  for (const id of vistas) {
    const previa = previas.get(id);
    if (previa) {
      posicion.set(id, { ...previa });
      ocupadas.push(previa);
    }
  }

  // 2. Dónde va el centro de cada grupo: en filas, cada grupo en su caja.
  const origenes = new Map<string, Punto>();
  let x = 0;
  let y = 0;
  let altoFila = 0;
  for (const grupo of limpios) {
    const radio = radioDelGrupo(grupo.hijas.length);
    const lado = radio ? 2 * radio + ANCHO_TARJETA : ANCHO_CENTRO;
    const alto = radio ? 2 * radio + ALTO_TARJETA : ALTO_CENTRO;
    if (x > 0 && x + lado > ANCHO_FILA) {
      x = 0;
      y += altoFila + AIRE_GRUPOS;
      altoFila = 0;
    }
    origenes.set(grupo.centro, { x: x + lado / 2, y: y + alto / 2 });
    x += lado + AIRE_GRUPOS;
    altoFila = Math.max(altoFila, alto);
  }

  // 3. Los centros nuevos, y alrededor de cada centro sus hijas nuevas.
  for (const grupo of limpios) {
    if (!posicion.has(grupo.centro)) {
      const origen = origenes.get(grupo.centro)!;
      let lugar = redondo(origen);
      // Si su lugar ya lo ocupa una fija, se busca hueco alrededor de donde iba.
      if (!libre(lugar)) {
        lugar =
          lugaresAlrededor(0, 400)
            .map((p) => redondo({ x: origen.x + p.x, y: origen.y + p.y }))
            .find(libre) ?? lugar;
      }
      posicion.set(grupo.centro, lugar);
      ocupadas.push(lugar);
    }
    const centro = posicion.get(grupo.centro)!;
    const lugares = lugaresAlrededor(grupo.hijas.length, grupo.hijas.length + 60).map((l) =>
      redondo({ x: centro.x + l.x, y: centro.y + l.y }),
    );
    const usados = new Set<number>();
    grupo.hijas.forEach((id, ideal) => {
      if (posicion.has(id)) return;
      // Su lugar ideal; si está ocupado, el siguiente libre (primero los ideales, luego la reserva).
      let elegido = -1;
      for (let i = ideal; i < lugares.length && elegido < 0; i += 1) {
        if (!usados.has(i) && libre(lugares[i])) elegido = i;
      }
      for (let i = 0; i < ideal && elegido < 0; i += 1) {
        if (!usados.has(i) && libre(lugares[i])) elegido = i;
      }
      const lugar = elegido >= 0 ? lugares[elegido] : debajoDeTodo(ocupadas, centro);
      if (elegido >= 0) usados.add(elegido);
      posicion.set(id, lugar);
      ocupadas.push(lugar);
    });
  }
  return posicion;
}

/** Último recurso (un nivel enorme y muy arrastrado): debajo de todo, que seguro está libre. */
function debajoDeTodo(ocupadas: Punto[], centro: Punto): Punto {
  const fondo = Math.max(...ocupadas.map((q) => q.y)) + ALTO_TARJETA + SEPARACION;
  return { x: Math.round(centro.x), y: Math.round(fondo) };
}
