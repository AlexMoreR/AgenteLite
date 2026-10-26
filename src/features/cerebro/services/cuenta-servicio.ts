import { createSign } from "node:crypto";

/*
  CEREBRO: la CUENTA DE SERVICIO de Google (la misma de src/lib/google-sheets.ts:
  GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).

  Si está configurada, el cerebro entra al Drive con ella y no hace falta "Conectar Google" (OAuth en modo
  prueba vence cada 7 días). El dueño comparte la carpeta del cerebro con el correo de la cuenta como EDITOR
  (para que el cerebro también escriba textos). Permiso pedido: drive; drive.ts no tiene funciones de borrar.
  No hay tokens guardados en la base: se firma un JWT y Google devuelve un permiso de una hora (en memoria).
*/

/** Permiso "drive": el cerebro lee y también escribe textos (crear .md, agregar, reemplazar). Nunca borra. */
export const PERMISO_DRIVE = "https://www.googleapis.com/auth/drive";

type Entorno = Record<string, string | undefined>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function datosDeCuentaDeServicio(entorno: Entorno = process.env) {
  const correo = entorno.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const clave = entorno.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  // Los .env traen los saltos de línea como "\n" literal.
  return correo && clave ? { correo, clave: clave.replace(/\\n/g, "\n") } : null;
}

export const cuentaDeServicioConfigurada = (entorno: Entorno = process.env) => Boolean(datosDeCuentaDeServicio(entorno));

const b64url = (valor: Buffer | string) =>
  (typeof valor === "string" ? Buffer.from(valor) : valor).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

/** El JWT firmado que se cambia por un permiso de Google (igual que google-sheets.ts, con otro permiso). */
export function firmarJwt(datos: { correo: string; clave: string }, ahoraSegundos: number, permiso = PERMISO_DRIVE) {
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const reclamos = b64url(
    JSON.stringify({ iss: datos.correo, scope: permiso, aud: "https://oauth2.googleapis.com/token", iat: ahoraSegundos, exp: ahoraSegundos + 3600 }),
  );
  const entrada = `${cabecera}.${reclamos}`;
  const firmador = createSign("RSA-SHA256");
  firmador.update(entrada);
  return `${entrada}.${b64url(firmador.sign(datos.clave))}`;
}

let enMemoria: { correo: string; token: string; vence: number } | null = null;

/** El permiso de una hora de la cuenta de servicio. Se reutiliza hasta 5 minutos antes de vencer. */
export async function tokenDeCuentaDeServicio(opciones: { entorno?: Entorno; fetchFn?: Fetch; ahora?: number } = {}): Promise<string> {
  const datos = datosDeCuentaDeServicio(opciones.entorno);
  if (!datos) throw new Error("Falta configurar la cuenta de servicio de Google en el servidor.");
  const ahora = opciones.ahora ?? Date.now();
  if (enMemoria && enMemoria.correo === datos.correo && enMemoria.vence - 5 * 60_000 > ahora) return enMemoria.token;
  let jwt: string;
  try {
    jwt = firmarJwt(datos, Math.floor(ahora / 1000));
  } catch {
    throw new Error("La clave privada de la cuenta de servicio no es válida (GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).");
  }
  const respuesta = await (opciones.fetchFn ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
  });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!respuesta.ok || !cuerpo.access_token) {
    throw new Error(`Google no aceptó la cuenta de servicio (${cuerpo.error ?? respuesta.status}).`);
  }
  enMemoria = { correo: datos.correo, token: cuerpo.access_token, vence: ahora + (cuerpo.expires_in ?? 3600) * 1000 };
  return cuerpo.access_token;
}

/** Solo para las pruebas: olvida el permiso guardado en memoria. */
export function olvidarTokenDeCuentaDeServicio() {
  enMemoria = null;
}
