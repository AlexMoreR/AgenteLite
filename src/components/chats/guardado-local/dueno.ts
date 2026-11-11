/*
  De quien es lo guardado en este celular (P5, T2).

  Antes la copia de los chats vivia en una llave fija, sin negocio ni usuario, y no se borraba al
  cerrar sesion: en un celular compartido la asesora B podia ver un instante los chats que guardo la
  A. Ahora todo lo guardado tiene dueño (negocio + usuario + version). Si el dueño cambia, si no hay
  usuario (login, sesion vencida) o si el guardado esta apagado (CHATS_GUARDADO_LOCAL=apagado), se
  borra TODO y no se muestra nada guardado hasta tener dueño.

  Cualquier error de localStorage se traga: en el peor caso no hay dueño y todo se pide al servidor,
  como antes de existir el guardado.
*/
import { llaveDelDueno } from "./reglas";

const CLAVE_DEL_DUENO = "aglite:dueno-del-guardado";

/** Lo que se borra al cambiar de dueño: todo lo que tiene nombres, telefonos o mensajes de clientes. */
const PREFIJOS_A_BORRAR = [
  "aglite:chat-history-cache",
  "aglite:chat-visited",
  "aglite:lista-guardada",
  "aglite:chat-scroll:",
  "aglite:busqueda:recientes",
  CLAVE_DEL_DUENO,
];

/** Para cuando exista IndexedDB (plan L2): se borra igual, aunque hoy no exista. */
const BASE_INDEXEDDB = "aglite-chats";

let duenoEnMemoria: string | null = null;
let apagadoEnMemoria = false;
let yaFijado = false;
const alCambiar = new Set<() => void>();

function navegador() {
  return typeof window !== "undefined";
}

function leerLaLlave(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_DEL_DUENO);
  } catch {
    return null;
  }
}

function avisarQueCambio() {
  for (const oyente of alCambiar) {
    try {
      oyente();
    } catch {
      // Un oyente roto no frena a los demas ni a la pantalla.
    }
  }
}

/**
 * Lo que tiene que olvidar cada modulo que guarda algo en memoria (la cache de chats, la lista
 * guardada) cuando cambia el dueño. Devuelve como quitarse.
 */
export function alCambiarElDueno(oyente: () => void): () => void {
  alCambiar.add(oyente);
  return () => {
    alCambiar.delete(oyente);
  };
}

/** Borra del navegador todo lo guardado de los chats, sin importar de quien sea. Nunca lanza. */
export function borrarTodoElGuardado() {
  if (!navegador()) {
    return;
  }
  try {
    const almacen = window.localStorage;
    const claves: string[] = [];
    for (let indice = 0; indice < almacen.length; indice += 1) {
      const clave = almacen.key(indice);
      if (clave && PREFIJOS_A_BORRAR.some((prefijo) => clave.startsWith(prefijo))) {
        claves.push(clave);
      }
    }
    for (const clave of claves) {
      try {
        almacen.removeItem(clave);
      } catch {
        // Sigue con las demas.
      }
    }
  } catch {
    // Sin localStorage no hay nada que borrar.
  }
  try {
    window.indexedDB?.deleteDatabase(BASE_INDEXEDDB);
  } catch {
    // No existe o no hay permiso: no importa.
  }
  duenoEnMemoria = null;
  avisarQueCambio();
}

/**
 * Fija el dueño del guardado. Es sincrona y barata: si el dueño no cambio no hace nada, asi se puede
 * llamar en cada render del armazon (AppShell), ANTES de que la bandeja lea el guardado.
 */
export function fijarDuenoDelGuardado({
  workspaceId,
  userId,
  apagado = false,
}: {
  workspaceId: string | null | undefined;
  userId: string | null | undefined;
  apagado?: boolean;
}) {
  if (!navegador()) {
    return;
  }
  const nuevo = apagado ? null : llaveDelDueno(workspaceId, userId);
  if (yaFijado && nuevo === duenoEnMemoria && apagado === apagadoEnMemoria) {
    return;
  }
  yaFijado = true;
  apagadoEnMemoria = apagado;

  try {
    const guardado = leerLaLlave();
    if (!nuevo || guardado !== nuevo) {
      // Otro dueño, sin dueño o apagado: no queda nada de antes.
      borrarTodoElGuardado();
    }
    if (nuevo) {
      try {
        window.localStorage.setItem(CLAVE_DEL_DUENO, nuevo);
      } catch {
        // Sin poder anotarlo, duenoDelGuardado() da null (ver abajo) y no se guarda nada.
      }
    }
  } catch {
    // Nunca rompe la pantalla.
  }
  const cambio = duenoEnMemoria !== nuevo;
  duenoEnMemoria = nuevo;
  if (cambio) {
    avisarQueCambio();
  }
}

/**
 * El dueño del guardado, o null si no hay (sin dueño no se guarda ni se lee nada).
 *
 * Tambien da null si otra pestaña cambio de dueño mientras tanto (la llave del navegador ya no es la
 * de esta pestaña): asi una pestaña con la sesion de A no lee ni escribe sobre lo de B.
 */
export function duenoDelGuardado(): string | null {
  if (!navegador() || !duenoEnMemoria || apagadoEnMemoria) {
    return null;
  }
  return leerLaLlave() === duenoEnMemoria ? duenoEnMemoria : null;
}

/** Solo para las pruebas: vuelve al estado de recien cargado. */
export function reiniciarDuenoParaPruebas() {
  duenoEnMemoria = null;
  apagadoEnMemoria = false;
  yaFijado = false;
}
