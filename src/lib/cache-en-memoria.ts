/**
 * Cache en la memoria del proceso, con vencimiento (TTL) y tamaño acotado.
 *
 * Nace de medir /api/cliente/chats/list en produccion (08-10-2026): en los pedidos lentos el paso
 * "auth" llegaba a 1,3 s (p99) porque cada pedido volvia a leer de la base lo mismo -quien es la
 * persona, de que negocio, que lineas ve- con 5-6 consultas en fila. Eso cambia muy de vez en
 * cuando y se pide varias veces por minuto por asesora.
 *
 * Hay UNA sola replica del contenedor (docker-compose.portainer.yml), asi que un Map alcanza: no
 * hace falta Redis. Si algun dia hay dos replicas, cada una tendria su copia y un cambio de
 * permisos podria tardar hasta el TTL en verse en la otra.
 *
 * - `obtener` comparte la MISMA consulta entre pedidos simultaneos de la misma clave: en una rafaga
 *   (todas las pestañas refrescando a la vez) sale una consulta, no diez.
 * - Si se invalida mientras una consulta esta en vuelo, ese resultado NO se guarda (podria ser el
 *   dato de antes del cambio).
 * - Al llenarse, se va la entrada usada hace mas tiempo.
 *
 * Este archivo no importa la base a proposito: `prisma.ts` lo usa para invalidar.
 */
export type OpcionesCache = {
  ttlMs: number;
  maxEntradas: number;
  /** Para las pruebas. */
  ahora?: () => number;
};

type Entrada<V> = { valor: V; vence: number };

export class CacheConTtl<V> {
  private readonly entradas = new Map<string, Entrada<V>>();
  private readonly enVuelo = new Map<string, { promesa: Promise<V>; epoca: number }>();
  private epoca = 0;
  private readonly ttlMs: number;
  private readonly maxEntradas: number;
  private readonly ahora: () => number;

  constructor(opciones: OpcionesCache) {
    this.ttlMs = opciones.ttlMs;
    this.maxEntradas = Math.max(1, opciones.maxEntradas);
    this.ahora = opciones.ahora ?? Date.now;
  }

  get tamano() {
    return this.entradas.size;
  }

  /** El valor guardado y vigente, o `undefined`. */
  leer(clave: string): V | undefined {
    const entrada = this.entradas.get(clave);
    if (!entrada) {
      return undefined;
    }
    if (entrada.vence <= this.ahora()) {
      this.entradas.delete(clave);
      return undefined;
    }
    // Usada recien: pasa al final (la que se va al llenarse es la primera).
    this.entradas.delete(clave);
    this.entradas.set(clave, entrada);
    return entrada.valor;
  }

  guardar(clave: string, valor: V) {
    this.entradas.delete(clave);
    while (this.entradas.size >= this.maxEntradas) {
      const masVieja = this.entradas.keys().next().value;
      if (masVieja === undefined) break;
      this.entradas.delete(masVieja);
    }
    this.entradas.set(clave, { valor, vence: this.ahora() + this.ttlMs });
  }

  /** Lo guardado si esta vigente; si no, lo carga UNA vez (aunque lo pidan varios a la vez). */
  async obtener(clave: string, cargar: () => Promise<V>): Promise<V> {
    const entrada = this.entradas.get(clave);
    if (entrada && entrada.vence > this.ahora()) {
      return this.leer(clave) as V;
    }

    const enCurso = this.enVuelo.get(clave);
    if (enCurso && enCurso.epoca === this.epoca) {
      return enCurso.promesa;
    }

    const epoca = this.epoca;
    const vuelo: { promesa: Promise<V>; epoca: number } = { promesa: Promise.resolve() as Promise<V>, epoca };
    vuelo.promesa = Promise.resolve()
      .then(cargar)
      .then(
        (valor) => {
          if (this.enVuelo.get(clave) === vuelo) this.enVuelo.delete(clave);
          if (epoca === this.epoca) {
            this.guardar(clave, valor);
          }
          return valor;
        },
        (error: unknown) => {
          // Un error no se guarda: el proximo pedido vuelve a intentar.
          if (this.enVuelo.get(clave) === vuelo) this.enVuelo.delete(clave);
          throw error;
        },
      );
    this.enVuelo.set(clave, vuelo);
    return vuelo.promesa;
  }

  invalidar(clave: string) {
    this.entradas.delete(clave);
    this.enVuelo.delete(clave);
    this.epoca += 1;
  }

  vaciar() {
    this.entradas.clear();
    this.enVuelo.clear();
    this.epoca += 1;
  }
}
