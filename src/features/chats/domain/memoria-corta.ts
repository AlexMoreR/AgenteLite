/*
  UNA MEMORIA CORTA QUE TAMBIEN COMPARTE EL PEDIDO EN CURSO.

  Guardar solo la respuesta no alcanza: la pagina, /list y las dos cuentas de /counts piden a la
  vez, y como ninguna respuesta habia llegado todavia, las cuatro hacian la misma consulta. Aca se
  guarda la PROMESA mientras corre: el que llega despues espera la misma. Si falla, se borra (el
  siguiente vuelve a intentar) y no queda un error guardado.
*/

export type GuardadoEnMemoria<T> = { vence: number; valor: Promise<T> };

export function leerConMemoria<T>(
  mapa: Map<string, GuardadoEnMemoria<T>>,
  clave: string,
  vidaMs: number,
  leer: () => Promise<T>,
  ahora: () => number = Date.now,
): Promise<T> {
  const guardado = mapa.get(clave);
  if (guardado && guardado.vence > ahora()) {
    return guardado.valor;
  }

  const valor = leer();
  // La vida vuelve a contar cuando llega la respuesta. Mientras corre vence igual a su hora: una
  // consulta colgada no deja esperando para siempre a los que llegan despues.
  const entrada: GuardadoEnMemoria<T> = { vence: ahora() + vidaMs, valor };
  mapa.set(clave, entrada);
  valor.then(
    () => {
      if (mapa.get(clave) === entrada) entrada.vence = ahora() + vidaMs;
    },
    () => {
      if (mapa.get(clave) === entrada) mapa.delete(clave);
    },
  );
  return valor;
}
