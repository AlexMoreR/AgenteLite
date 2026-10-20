/*
  Dónde va cada tarjeta en el mapa del Tablero IA: RADIAL, como carpetas.

  El mapa se recorre por niveles (services/niveles.ts). En cada nivel hay uno o más GRUPOS: una
  tarjeta en el centro (la del nivel, o cada raíz en el nivel de entrada) y sus hijas directas
  ALREDEDOR, en anillos:
  - el primer anillo se llena de a partes iguales empezando arriba; si no caben, se abre otro anillo
    más afuera (la capacidad de cada anillo sale de su circunferencia, así nunca se encima);
  - en la raíz, los grupos (cada raíz con sus hijas, o una raíz suelta sola) van en filas, uno al lado
    del otro, sin pisarse.
  Determinista (mismo tablero, mismo dibujo, sin azar).

  Las que YA tienen posición en ese nivel (`previas`: las que el dueño arrastró o las que ya estaban
  dibujadas) NO se mueven. Una nueva busca su lugar ideal alrededor de su centro y, si está ocupado,
  el siguiente hueco libre de los anillos (más afuera si hace falta). Las posiciones NO se guardan en
  la base: se calculan cada vez y, mientras el dueño está en ese nivel, se recuerdan en la pantalla.
  La posición es la esquina de arriba a la izquierda, como en React Flow.
*/

export type Punto = { x: number; y: number };

/** Lo que ocupa una tarjeta en el mapa (NodoTarjeta usa estas mismas medidas: 152 x 68 px). */
export const ANCHO_TARJETA = 152;
export const ALTO_TARJETA = 68;
/** Aire mínimo entre dos tarjetas. */
export const SEPARACION = 20;

/** Radio del primer anillo y distancia entre anillos (centro a centro). */
export const RADIO_INICIAL = 210;
const PASO_ANILLO = 200;
/** Largo de arco mínimo entre dos hijas vecinas de un mismo anillo. */
const ARCO_MINIMO = 220;
/** Ancho máximo de una fila de grupos en la raíz. */
const ANCHO_FILA = 2000;
const AIRE_GRUPOS = 48;

/** true si dos tarjetas (esquina arriba-izquierda) se pisan o quedan a menos de `aire` px. */
export function sePisan(p: Punto, q: Punto, aire = SEPARACION): boolean {
  return Math.abs(p.x - q.x) < ANCHO_TARJETA + aire && Math.abs(p.y - q.y) < ALTO_TARJETA + aire;
}

const radioDelAnillo = (anillo: number) => RADIO_INICIAL + anillo * PASO_ANILLO;
const capacidadDelAnillo = (anillo: number) => Math.max(6, Math.floor((2 * Math.PI * radioDelAnillo(anillo)) / ARCO_MINIMO));

/**
 * Los lugares alrededor de un centro (centro de la tarjeta = 0,0), en orden: los `cuantas` ideales
 * repartidos parejo por anillos y, después, más lugares de reserva para buscar huecos.
 */
function lugaresAlrededor(cuantas: number, extra: number): Punto[] {
  const lugares: Punto[] = [];
  let restantes = cuantas;
  let anillo = 0;
  // Los ideales: se reparten parejo en cada anillo.
  while (restantes > 0) {
    const enEste = Math.min(restantes, capacidadDelAnillo(anillo));
    const radio = radioDelAnillo(anillo);
    // Anillos alternos corridos medio paso, para que no queden en fila con el de adentro.
    const corrimiento = anillo % 2 ? Math.PI / enEste : 0;
    for (let i = 0; i < enEste; i += 1) {
      const angulo = -Math.PI / 2 + corrimiento + (2 * Math.PI * i) / enEste;
      lugares.push({ x: Math.cos(angulo) * radio, y: Math.sin(angulo) * radio });
    }
    restantes -= enEste;
    anillo += 1;
  }
  // Reserva: anillos completos más afuera.
  let reserva = extra;
  while (reserva > 0) {
    const enEste = capacidadDelAnillo(anillo);
    const radio = radioDelAnillo(anillo);
    for (let i = 0; i < enEste; i += 1) {
      const angulo = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / enEste;
      lugares.push({ x: Math.cos(angulo) * radio, y: Math.sin(angulo) * radio });
    }
    reserva -= enEste;
    anillo += 1;
  }
  return lugares;
}

/** Cuánto mide un grupo de lado a lado (su caja), con `cuantas` hijas alrededor. */
function radioDelGrupo(cuantas: number) {
  if (!cuantas) return 0;
  let restantes = cuantas;
  let anillo = 0;
  while (restantes > capacidadDelAnillo(anillo)) {
    restantes -= capacidadDelAnillo(anillo);
    anillo += 1;
  }
  return radioDelAnillo(anillo);
}

export type GrupoRadial = { centro: string; hijas: string[] };

export function disponerRadial(grupos: GrupoRadial[], previas: ReadonlyMap<string, Punto> = new Map()): Map<string, Punto> {
  const posicion = new Map<string, Punto>();
  const ocupadas: Punto[] = [];
  const vistas = new Set<string>();
  const libre = (p: Punto) => ocupadas.every((q) => !sePisan(p, q));

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
    const lado = 2 * radioDelGrupo(grupo.hijas.length) + ANCHO_TARJETA;
    const alto = 2 * radioDelGrupo(grupo.hijas.length) + ALTO_TARJETA;
    if (x > 0 && x + lado > ANCHO_FILA) {
      x = 0;
      y += altoFila + AIRE_GRUPOS;
      altoFila = 0;
    }
    origenes.set(grupo.centro, { x: x + lado / 2, y: y + alto / 2 });
    x += lado + AIRE_GRUPOS;
    altoFila = Math.max(altoFila, alto);
  }

  const esquina = (centro: Punto): Punto => ({
    x: Math.round(centro.x - ANCHO_TARJETA / 2),
    y: Math.round(centro.y - ALTO_TARJETA / 2),
  });

  // 3. Los centros nuevos, y alrededor de cada centro sus hijas nuevas.
  for (const grupo of limpios) {
    if (!posicion.has(grupo.centro)) {
      let lugar = esquina(origenes.get(grupo.centro)!);
      // Si su caja ya la ocupa una fija, se busca hueco alrededor de donde iba.
      if (!libre(lugar)) {
        const centro = origenes.get(grupo.centro)!;
        lugar =
          lugaresAlrededor(0, 400)
            .map((p) => esquina({ x: centro.x + p.x, y: centro.y + p.y }))
            .find(libre) ?? lugar;
      }
      posicion.set(grupo.centro, lugar);
      ocupadas.push(lugar);
    }
    const p = posicion.get(grupo.centro)!;
    const centro = { x: p.x + ANCHO_TARJETA / 2, y: p.y + ALTO_TARJETA / 2 };
    const lugares = lugaresAlrededor(grupo.hijas.length, grupo.hijas.length + 60).map((l) =>
      esquina({ x: centro.x + l.x, y: centro.y + l.y }),
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
  return { x: Math.round(centro.x - ANCHO_TARJETA / 2), y: fondo };
}
