/*
  Dónde va cada tarjeta en el mapa (estilo Obsidian: lo conectado queda cerca).

  Una simulación de fuerzas chiquita, sin dependencias: las tarjetas se repelen, las flechas tiran
  como resortes y todo se centra suavemente. Es determinista (sin azar) para que el mismo tablero
  se vea igual cada vez.

  Lo que importa para el refresco de 5 s: las tarjetas que ya tenían lugar NO se mueven. Solo se
  acomodan las nuevas (empiezan al lado de una tarjeta conectada que ya estaba). Así el mapa no
  "salta" cada vez que Claude agrega algo.

  Y ninguna tarjeta nueva queda ENCIMA de otra: después de la simulación, cada nueva que pise a
  alguna (una que ya estaba o una nueva ya acomodada) se corre al hueco libre más cercano. Las que
  ya tenían lugar no se tocan nunca, aunque entre ellas se pisen (eso lo decidió quien las arrastró).
  La posición es la esquina de arriba a la izquierda, como en React Flow.
*/

export type Punto = { x: number; y: number };

const ANGULO_DORADO = Math.PI * (3 - Math.sqrt(5));
const DISTANCIA_RESORTE = 220;
const REPULSION = 90_000;
const VUELTAS = 220;

/** Lo que ocupa una tarjeta en el mapa (NodoTarjeta: 200 px de ancho y hasta 3 renglones de título). */
export const ANCHO_TARJETA = 200;
export const ALTO_TARJETA = 110;
/** Aire mínimo entre dos tarjetas. */
export const SEPARACION = 24;

const PASO_HUECO = 24;
const ANILLOS_MAXIMOS = 120;

/** true si dos tarjetas (esquina arriba-izquierda) se pisan o quedan a menos de `aire` px. */
export function sePisan(p: Punto, q: Punto, aire = SEPARACION): boolean {
  return Math.abs(p.x - q.x) < ANCHO_TARJETA + aire && Math.abs(p.y - q.y) < ALTO_TARJETA + aire;
}

/**
 * El lugar libre más cercano a `deseado` que no pisa a ninguna de `ocupadas`. Busca en anillos
 * cuadrados cada vez más grandes y, dentro de cada anillo, el punto más cercano (empates por orden
 * fijo: determinista).
 */
function huecoLibre(deseado: Punto, ocupadas: Punto[]): Punto {
  const libre = (p: Punto) => ocupadas.every((q) => !sePisan(p, q));
  if (libre(deseado)) return deseado;
  for (let anillo = 1; anillo <= ANILLOS_MAXIMOS; anillo += 1) {
    const candidatos: Punto[] = [];
    for (let i = -anillo; i <= anillo; i += 1) {
      candidatos.push(
        { x: deseado.x + i * PASO_HUECO, y: deseado.y - anillo * PASO_HUECO },
        { x: deseado.x + i * PASO_HUECO, y: deseado.y + anillo * PASO_HUECO },
      );
      if (i !== -anillo && i !== anillo) {
        candidatos.push(
          { x: deseado.x - anillo * PASO_HUECO, y: deseado.y + i * PASO_HUECO },
          { x: deseado.x + anillo * PASO_HUECO, y: deseado.y + i * PASO_HUECO },
        );
      }
    }
    candidatos.sort(
      (a, b) =>
        Math.hypot(a.x - deseado.x, a.y - deseado.y) - Math.hypot(b.x - deseado.x, b.y - deseado.y) ||
        a.y - b.y ||
        a.x - b.x,
    );
    const encontrado = candidatos.find(libre);
    if (encontrado) return encontrado;
  }
  // Tablero enorme y apretado: debajo de todo, que seguro está libre.
  const fondo = Math.max(...ocupadas.map((q) => q.y)) + ALTO_TARJETA + SEPARACION;
  return { x: deseado.x, y: fondo };
}

export function disponer(
  ids: string[],
  aristas: { origenId: string; destinoId: string }[],
  previas: ReadonlyMap<string, Punto> = new Map(),
): Map<string, Punto> {
  const posicion = new Map<string, Punto>();
  const fijas = new Set<string>();
  for (const id of ids) {
    const previa = previas.get(id);
    if (previa) {
      posicion.set(id, { ...previa });
      fijas.add(id);
    }
  }

  const presentes = new Set(ids);
  const validas = aristas.filter(
    (arista) => presentes.has(arista.origenId) && presentes.has(arista.destinoId) && arista.origenId !== arista.destinoId,
  );
  const vecinos = new Map<string, string[]>();
  for (const { origenId, destinoId } of validas) {
    vecinos.set(origenId, [...(vecinos.get(origenId) ?? []), destinoId]);
    vecinos.set(destinoId, [...(vecinos.get(destinoId) ?? []), origenId]);
  }

  // Lugar inicial de las nuevas: junto a un vecino con lugar, o en una espiral alrededor del centro.
  let indice = 0;
  for (const id of ids) {
    if (posicion.has(id)) continue;
    const ancla = (vecinos.get(id) ?? []).map((otro) => posicion.get(otro)).find(Boolean);
    const angulo = indice * ANGULO_DORADO;
    if (ancla) {
      posicion.set(id, { x: ancla.x + Math.cos(angulo) * DISTANCIA_RESORTE, y: ancla.y + Math.sin(angulo) * DISTANCIA_RESORTE });
    } else {
      const radio = 160 * Math.sqrt(indice + fijas.size);
      posicion.set(id, { x: Math.cos(angulo) * radio, y: Math.sin(angulo) * radio });
    }
    indice += 1;
  }

  const moviles = ids.filter((id) => !fijas.has(id));
  if (!moviles.length) {
    return posicion;
  }

  for (let vuelta = 0; vuelta < VUELTAS; vuelta += 1) {
    const enfriamiento = 1 - vuelta / VUELTAS;
    const fuerza = new Map<string, Punto>(moviles.map((id) => [id, { x: 0, y: 0 }]));

    for (const id of moviles) {
      const p = posicion.get(id)!;
      const f = fuerza.get(id)!;
      for (const otro of ids) {
        if (otro === id) continue;
        const q = posicion.get(otro)!;
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // Encimadas: se separan en una dirección fija según el orden, sin azar.
          dx = id < otro ? 1 : -1;
          dy = 0.5;
          d2 = 1.25;
        }
        const d = Math.sqrt(d2);
        const empuje = REPULSION / d2;
        f.x += (dx / d) * empuje;
        f.y += (dy / d) * empuje;
      }
      for (const otro of vecinos.get(id) ?? []) {
        const q = posicion.get(otro)!;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const tiron = (d - DISTANCIA_RESORTE) * 0.05;
        f.x += (dx / d) * tiron;
        f.y += (dy / d) * tiron;
      }
      // Gravedad suave al centro para que las islas sueltas no se vayan lejos.
      f.x -= p.x * 0.002;
      f.y -= p.y * 0.002;
    }

    const paso = 40 * enfriamiento + 1;
    for (const id of moviles) {
      const p = posicion.get(id)!;
      const f = fuerza.get(id)!;
      const largo = Math.sqrt(f.x * f.x + f.y * f.y);
      if (largo > 0) {
        const mover = Math.min(paso, largo);
        p.x += (f.x / largo) * mover;
        p.y += (f.y / largo) * mover;
      }
    }
  }

  for (const p of posicion.values()) {
    p.x = Math.round(p.x);
    p.y = Math.round(p.y);
  }

  // Ninguna nueva encima de otra: se acomodan de a una, en el orden de `ids`.
  const ocupadas = [...fijas].map((id) => posicion.get(id)!);
  for (const id of moviles) {
    const lugar = huecoLibre(posicion.get(id)!, ocupadas);
    posicion.set(id, lugar);
    ocupadas.push(lugar);
  }
  return posicion;
}
