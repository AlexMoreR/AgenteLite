import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Medicion de Chats (fase 0 de "Chats instantaneo").
 *
 * El navegador junta los tiempos de la bandeja (abrir un chat, enviar, cambiar de pestaña, bajar
 * en la lista, mensaje que llega) y los manda cada 10 s con `sendBeacon`. Aca solo se validan por
 * encima y se escriben en el log con el prefijo `[metricas-chats]`, una linea JSON por lote: no hay
 * tabla. La sesion es JWT, asi que validarla no toca la base.
 */

// Un lote normal pesa 1-3 KB. Lo que pase de esto se descarta entero.
const MAX_BYTES = 16 * 1024;
const MAX_MEDICIONES = 100;

type Medicion = {
  m: string;
  ms: number;
  [extra: string]: unknown;
};

function limpiarMedicion(valor: unknown): Medicion | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  const fila = valor as Record<string, unknown>;
  if (typeof fila.m !== "string" || fila.m.length > 40 || typeof fila.ms !== "number" || !Number.isFinite(fila.ms)) {
    return null;
  }
  const limpia: Medicion = { m: fila.m, ms: Math.max(0, Math.round(fila.ms)) };
  for (const [clave, extra] of Object.entries(fila)) {
    if (clave === "m" || clave === "ms" || clave.length > 20) {
      continue;
    }
    if (typeof extra === "boolean" || (typeof extra === "number" && Number.isFinite(extra))) {
      limpia[clave] = extra;
    } else if (typeof extra === "string") {
      limpia[clave] = extra.slice(0, 40);
    }
  }
  return limpia;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 });
  }

  const largo = Number(request.headers.get("content-length") ?? "0");
  if (largo > MAX_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let texto: string;
  try {
    texto = await request.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (texto.length > MAX_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const datos = cuerpo && typeof cuerpo === "object" ? (cuerpo as Record<string, unknown>) : {};
  const mediciones = Array.isArray(datos.mediciones)
    ? datos.mediciones.slice(0, MAX_MEDICIONES).map(limpiarMedicion).filter((fila): fila is Medicion => fila !== null)
    : [];
  if (mediciones.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  console.log(
    `[metricas-chats] ${JSON.stringify({
      userId: session.user.id,
      dispositivo: datos.dispositivo === "movil" ? "movil" : "escritorio",
      mediciones,
    })}`,
  );

  return new NextResponse(null, { status: 204 });
}
