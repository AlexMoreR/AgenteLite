// La única regla de versión del CRM: la usan la barra lateral y Equipo.
// La versión se ve como "v1.0.N": el "1.0" va fijo aquí y N es el número de corrida del flujo de
// GitHub que armó la imagen (github.run_number), que sube solo de uno en uno en cada despliegue.
// El Dockerfile lo deja en NEXT_PUBLIC_VERSION_NUMERO. El código de 8 letras sigue solo en /api/version.

const VERSION_BASE = "1.0";

// Solo dígitos, de 1 a 9 cifras: nada de puntos, signos, espacios ni HTML.
const NUMERO_VALIDO = /^[0-9]{1,9}$/;

/** Devuelve el número si es válido (solo dígitos, de 1 a 9 cifras); si no, null. */
export function numeroDeVersionValido(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  return NUMERO_VALIDO.test(valor) ? valor : null;
}

/** "812" da "v1.0.812"; un número vacío o inválido da "v1.0.dev". */
export function etiquetaDeVersion(numero: unknown): string {
  const valido = numeroDeVersionValido(numero);
  return `v${VERSION_BASE}.${valido ?? "dev"}`;
}

/**
 * Dice si la versión abierta es más vieja que la del servidor (comparación numérica).
 * Si falta cualquiera de los dos datos o no es válido, devuelve null: no dice nada.
 */
export function esVersionVieja(abierta: unknown, delServidor: unknown): boolean | null {
  const a = numeroDeVersionValido(abierta);
  const s = numeroDeVersionValido(delServidor);
  if (a === null || s === null) return null;
  return Number.parseInt(a, 10) < Number.parseInt(s, 10);
}

/** El número de versión con el que se armó esta imagen, o null si no viene (desarrollo). */
export function versionDelServidor(): string | null {
  return numeroDeVersionValido(process.env.NEXT_PUBLIC_VERSION_NUMERO);
}
