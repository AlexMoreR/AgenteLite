/*
  NOMBRES DE LAS PERSONAS de una reunión. En LiveKit la identidad es u_<userId> (con sesión), i_<azar>
  (invitado) o EG_<...> (el grabador de Egress, que no es una persona). Lo que se muestra es siempre el
  nombre; nunca la identidad. Partes puras, sin base de datos.
*/

const PARECE_IDENTIDAD = /^(u_[A-Za-z0-9]{8,}|EG_[A-Za-z0-9_-]+|i_[A-Za-z0-9_-]{10,40})$/;

/** El grabador de LiveKit Egress entra a la sala como un participante más: no es una persona. */
export const esDeEgress = (identidad: string | null | undefined) => Boolean(identidad && identidad.startsWith("EG_"));

export const pareceIdentidad = (texto: string | null | undefined) => Boolean(texto && PARECE_IDENTIDAD.test(texto.trim()));

const userIdDe = (identidad: string) => (identidad.startsWith("u_") ? identidad.slice(2) || null : null);

type Fila = { identidad: string; nombre: string; userId?: string | null };

/** El nombre que se guarda al crear al participante (el `name` del pase), nunca la identidad. */
export function nombreParaGuardar(nombre: string | undefined | null, identidad: string, nombreDelUsuario?: string | null): string {
  const limpio = nombre?.trim().slice(0, 80);
  if (limpio && !pareceIdentidad(limpio)) {
    return limpio;
  }
  const delUsuario = nombreDelUsuario?.trim();
  if (delUsuario) {
    return delUsuario.slice(0, 80);
  }
  return identidad.startsWith("u_") ? "Usuario" : "Invitado";
}

/** Nombre para mostrar: el guardado; si es un registro viejo con la identidad, el del usuario; si no, genérico. */
export function nombreVisible(fila: Fila, nombresPorUserId: Map<string, string>): string {
  if (!pareceIdentidad(fila.nombre)) {
    return fila.nombre;
  }
  const userId = fila.userId || userIdDe(fila.identidad) || userIdDe(fila.nombre);
  return (userId && nombresPorUserId.get(userId)) || (fila.identidad.startsWith("u_") ? "Usuario" : "Invitado");
}

/** Las personas de verdad (sin los grabadores EG_) con su nombre visible. */
export function personasDeLaReunion<T extends Fila>(filas: T[], nombresPorUserId: Map<string, string>): Array<T & { nombreVisible: string }> {
  return filas.filter((fila) => !esDeEgress(fila.identidad)).map((fila) => ({ ...fila, nombreVisible: nombreVisible(fila, nombresPorUserId) }));
}

/** Los userId que hay que buscar en la base para poner nombres a registros viejos. */
export function userIdsPorBuscar(filas: Fila[]): string[] {
  const ids = new Set<string>();
  for (const fila of filas) {
    if (pareceIdentidad(fila.nombre)) {
      const id = fila.userId || userIdDe(fila.identidad);
      if (id) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}
