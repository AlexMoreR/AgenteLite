// Regla única de la versión del CRM: v1.0.N, donde N es el número de corrida de GitHub
// (VERSION_NUMERO en el Dockerfile) y sube solo en cada despliegue. La van a usar la barra
// lateral y Equipo. El aviso de versión nueva sigue con el código de /api/version (no es esto).
// Prueba: npm run test:version-del-crm

// El "1.0" va fijo: solo el último número cambia con cada despliegue.
const PREFIJO_DE_VERSION = "v1.0.";

// Solo dígitos, de 1 a 9 cifras: sin puntos, signos ni letras.
const NUMERO_VALIDO = /^[0-9]{1,9}$/;

/** Devuelve el número limpio si es válido (solo dígitos, 1 a 9 cifras) o null si no lo es. */
export function numeroDeVersionValido(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return NUMERO_VALIDO.test(limpio) ? limpio : null;
}

/** '812' da 'v1.0.812'; un número vacío o inválido da 'v1.0.dev'. */
export function etiquetaDeVersion(numero: unknown): string {
  const valido = numeroDeVersionValido(numero);
  return `${PREFIJO_DE_VERSION}${valido ?? "dev"}`;
}

/**
 * Dice si la versión de una persona es más vieja que la del servidor.
 * Si falta cualquiera de los dos datos o no es válido, devuelve null: no dice nada.
 */
export function esVersionVieja(mia: unknown, servidor: unknown): boolean | null {
  const a = numeroDeVersionValido(mia);
  const b = numeroDeVersionValido(servidor);
  if (a === null || b === null) return null;
  return Number.parseInt(a, 10) < Number.parseInt(b, 10);
}

// Se escribe tal cual (process.env.NEXT_PUBLIC_...) para que Next lo incluya también en el navegador.
export const VERSION_DEL_SERVIDOR: string | null = numeroDeVersionValido(
  process.env.NEXT_PUBLIC_VERSION_NUMERO,
);
