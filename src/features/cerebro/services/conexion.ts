import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl } from "@/lib/app-url";
import { cifrar, descifrar, firmarEstado, verificarEstado } from "./cifrado";
import { crearBuscadorDeDrive, crearClienteDeDrive, type BuscadorDeDrive, type ClienteDeDrive } from "./drive";
import { cuentaDeServicioConfigurada, datosDeCuentaDeServicio, tokenDeCuentaDeServicio } from "./cuenta-servicio";
import { MIME_CARPETA } from "./reglas";

/*
  CEREBRO: la conexión con Google de cada negocio. Dos caminos:
  - OAuth con la cuenta de Google del negocio (Magilus): si el dueño ya dio el permiso ("Permitir que el CRM cree
    notas en Drive"), driveDelNegocio entra SIEMPRE con él. Es el único que puede crear archivos nuevos en un Drive
    personal: los archivos quedan a nombre de la cuenta del negocio.
  - CUENTA DE SERVICIO (si GOOGLE_SERVICE_ACCOUNT_EMAIL y _PRIVATE_KEY están): solo de respaldo, mientras falte el
    permiso OAuth o si ese permiso falla. Lee y reemplaza textos, pero Google no la deja crear archivos nuevos en un
    Drive personal (no tiene espacio propio): crear pide el permiso OAuth (ver enlaceParaConectarGoogle).
  modoDelCerebro dice qué está configurado en el servidor; el camino que se usó de verdad lo devuelve driveDelNegocio.

  Quién inicia sesión en Google es siempre el dueño, en su navegador: el CRM nunca ve la contraseña.
  Se guarda solo el permiso de larga duración (refresh token), cifrado. Se pide el permiso "drive"
  porque la carpeta ya existe y es de la cuenta del negocio; el código solo lee, crea textos y
  reemplaza textos (drive.ts no tiene ninguna función de borrar).
*/

const PERMISOS = "openid email https://www.googleapis.com/auth/drive";
export const MENSAJE_RECONECTAR = "Hay que reconectar Google: el permiso se perdió o se venció.";

export function datosDeGoogle() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const oauthConfigurado = () => Boolean(datosDeGoogle()) && Boolean(process.env.CEREBRO_CLAVE_CIFRADO?.trim());

/**
 * Cómo entra el cerebro al Drive. Si está la cuenta de servicio del servidor, se usa ELLA (no vence y no
 * necesita OAuth ni cifrado). Si no, el camino de antes: "Conectar Google" con OAuth.
 */
export type ModoDelCerebro = "cuenta-servicio" | "oauth" | null;
export function modoDelCerebro(): ModoDelCerebro {
  if (cuentaDeServicioConfigurada()) return "cuenta-servicio";
  return oauthConfigurado() ? "oauth" : null;
}

export const googleConfigurado = () => modoDelCerebro() !== null;

/** El correo de la cuenta de servicio, para mostrarlo y para decirle al dueño con quién compartir la carpeta. */
export const correoDeCuentaDeServicio = () => datosDeCuentaDeServicio()?.correo ?? null;

/** Si el negocio tiene con qué entrar al Drive: la cuenta de servicio, o el permiso OAuth guardado. */
export function tieneAccesoAlDrive(conexion: { tokenCifrado: string | null } | null | undefined): boolean {
  if (modoDelCerebro() === "cuenta-servicio") return true;
  return Boolean(conexion?.tokenCifrado);
}

/**
 * El link para que el dueño dé el permiso OAuth (entra con la cuenta de Google del negocio y pulsa Permitir).
 * Va en los mensajes de error cuando falta el permiso para crear notas. Sin dirección pública configurada, la ruta sola.
 */
export function enlaceParaConectarGoogle(origen: string = getPublicBaseUrl()) {
  return `${origen.replace(/\/+$/, "")}/api/cerebro/google/conectar`;
}

/** La dirección de regreso de Google, según el sitio desde donde entra el dueño. */
export function direccionDeRegreso(origen: string) {
  return `${origen.replace(/\/$/, "")}/api/cerebro/google/volver`;
}

export function urlDeInicioDeSesion(datos: { workspaceId: string; userId: string; origen: string }): string {
  const google = datosDeGoogle();
  if (!google) throw new Error("Falta configurar GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET en el servidor.");
  const parametros = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: direccionDeRegreso(datos.origen),
    response_type: "code",
    scope: PERMISOS,
    access_type: "offline",
    // Para que Google siempre entregue el permiso de larga duración, también al reconectar.
    prompt: "consent",
    state: firmarEstado({ workspaceId: datos.workspaceId, userId: datos.userId }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${parametros.toString()}`;
}

async function pedirToken(cuerpo: Record<string, string>) {
  const respuesta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(cuerpo).toString(),
  });
  const datos = (await respuesta.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!respuesta.ok || !datos.access_token) {
    const error = new Error(datos.error === "invalid_grant" ? MENSAJE_RECONECTAR : `Google no dio el permiso (${datos.error ?? respuesta.status}).`);
    (error as Error & { reconectar?: boolean }).reconectar = datos.error === "invalid_grant";
    throw error;
  }
  return datos as { access_token: string; refresh_token?: string };
}

/** Regreso de Google: cambia el código por el permiso y lo guarda cifrado. Devuelve la cuenta conectada. */
export async function terminarInicioDeSesion(datos: { codigo: string; estado: string | null; origen: string; userIdActual: string }) {
  const estado = verificarEstado(datos.estado);
  if (!estado) throw new Error("El inicio de sesión venció o no es válido. Vuelve a pulsar Conectar Google.");
  if (estado.userId !== datos.userIdActual) throw new Error("Este inicio de sesión lo empezó otra persona.");
  const google = datosDeGoogle();
  if (!google) throw new Error("Falta configurar Google en el servidor.");
  const token = await pedirToken({
    code: datos.codigo,
    client_id: google.clientId,
    client_secret: google.clientSecret,
    redirect_uri: direccionDeRegreso(datos.origen),
    grant_type: "authorization_code",
  });
  if (!token.refresh_token) throw new Error("Google no entregó el permiso de larga duración. Quita el acceso de AizenCRM en tu cuenta de Google y conecta de nuevo.");
  const perfil = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } })
    .then((respuesta) => (respuesta.ok ? (respuesta.json() as Promise<{ email?: string }>) : {}))
    .catch(() => ({}) as { email?: string });
  const correo = (perfil as { email?: string }).email ?? null;
  const tokenCifrado = cifrar(token.refresh_token);
  // Si cambia la cuenta (por ejemplo, de la cuenta de servicio a la de Magilus), la carpeta elegida se conserva
  // solo si la cuenta nueva la puede abrir; si no, se vuelve a elegir.
  const previa = await prisma.cerebroConexion.findUnique({
    where: { workspaceId: estado.workspaceId },
    select: { cuentaGoogle: true, carpetaId: true },
  });
  const mismaCuenta = Boolean(previa?.cuentaGoogle) && previa?.cuentaGoogle === correo;
  const conservarCarpeta = mismaCuenta || (previa?.carpetaId ? await puedeAbrirLaCarpeta(token.access_token, previa.carpetaId) : false);
  await prisma.cerebroConexion.upsert({
    where: { workspaceId: estado.workspaceId },
    create: { workspaceId: estado.workspaceId, cuentaGoogle: correo, tokenCifrado, conectadoPor: estado.userId },
    update: {
      cuentaGoogle: correo,
      tokenCifrado,
      conectadoPor: estado.userId,
      ultimoError: null,
      ...(conservarCarpeta ? {} : { carpetaId: null, carpetaNombre: null }),
    },
  });
  return { workspaceId: estado.workspaceId, correo };
}

/** ¿Con este permiso se puede abrir la carpeta (y es una carpeta)? Cualquier fallo cuenta como que no. */
async function puedeAbrirLaCarpeta(tokenDeAcceso: string, carpetaId: string): Promise<boolean> {
  try {
    return (await crearClienteDeDrive(tokenDeAcceso).metadatos(carpetaId)).tipo === MIME_CARPETA;
  } catch {
    return false;
  }
}

export type ConexionDelCerebro = NonNullable<Awaited<ReturnType<typeof leerConexion>>>;

export function leerConexion(workspaceId: string) {
  return prisma.cerebroConexion.findUnique({ where: { workspaceId } });
}

/** Guarda el último error de la conexión (para la pantalla y la alerta). Si no se puede guardar, no importa. */
async function anotarError(workspaceId: string, mensaje: string) {
  await prisma.cerebroConexion.update({ where: { workspaceId }, data: { ultimoError: mensaje.slice(0, 500) } }).catch(() => undefined);
}

/**
 * El cliente de Drive del negocio, o un error claro si no está conectado o el permiso se perdió.
 * Primero el permiso OAuth guardado (la cuenta del negocio); la cuenta de servicio queda de respaldo.
 */
export async function driveDelNegocio(
  workspaceId: string,
): Promise<{ drive: ClienteDeDrive; buscador: BuscadorDeDrive; conexion: ConexionDelCerebro; modo: "cuenta-servicio" | "oauth" }> {
  const guardada = await leerConexion(workspaceId);
  const hayRespaldo = cuentaDeServicioConfigurada();
  const google = datosDeGoogle();

  if (guardada?.tokenCifrado && oauthConfigurado() && google) {
    try {
      const token = await pedirToken({
        client_id: google.clientId,
        client_secret: google.clientSecret,
        refresh_token: descifrar(guardada.tokenCifrado),
        grant_type: "refresh_token",
      });
      return { drive: crearClienteDeDrive(token.access_token), buscador: crearBuscadorDeDrive(token.access_token), conexion: guardada, modo: "oauth" };
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : MENSAJE_RECONECTAR;
      await anotarError(workspaceId, mensaje);
      // Sin respaldo, el error sube. Con la cuenta de servicio se sigue leyendo y reemplazando mientras se reconecta.
      if (!hayRespaldo) throw new Error(mensaje);
    }
  }

  if (hayRespaldo) {
    // Con la cuenta de servicio no hay permiso que guardar, solo la carpeta: la fila se crea si no existe.
    const conexion =
      guardada ??
      (await prisma.cerebroConexion.upsert({
        where: { workspaceId },
        create: { workspaceId, cuentaGoogle: correoDeCuentaDeServicio() },
        update: {},
      }));
    try {
      const token = await tokenDeCuentaDeServicio();
      return { drive: crearClienteDeDrive(token), buscador: crearBuscadorDeDrive(token), conexion, modo: "cuenta-servicio" };
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : "Google no aceptó la cuenta de servicio.";
      await anotarError(workspaceId, mensaje);
      throw new Error(mensaje);
    }
  }

  if (!guardada?.tokenCifrado) throw new Error("El cerebro no está conectado a Google Drive.");
  throw new Error("Falta configurar Google en el servidor.");
}

export async function elegirCarpeta(workspaceId: string, carpetaId: string, carpetaNombre: string) {
  await prisma.cerebroConexion.update({
    where: { workspaceId },
    data: { carpetaId, carpetaNombre: carpetaNombre.slice(0, 200), ultimoError: null },
  });
  // Otra carpeta: la copia de la anterior se marca como "ya no está" (no se borra nada).
  await prisma.cerebroDocumento.updateMany({ where: { workspaceId }, data: { enDrive: false } });
}

/** Desconectar: se borra el permiso guardado. El Drive no se toca; la copia queda para consultar. */
export async function desconectar(workspaceId: string) {
  await prisma.cerebroConexion.updateMany({
    where: { workspaceId },
    data: { tokenCifrado: null, ultimoError: null },
  });
}
