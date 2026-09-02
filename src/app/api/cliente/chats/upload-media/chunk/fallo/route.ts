import { NextResponse } from "next/server";

import { auth } from "@/auth";

/**
 * Deja constancia de una subida que se corto en el celular.
 *
 * Una asesora reporto "a veces manda fotos y a veces no". Revisando el 2-sep-2026 quedo descartado
 * todo lo que si deja rastro: cero envios fallidos en el servidor en 72 h, cero mensajes de foto en
 * estado fallido en la base, y nada en los registros de WAHA. O sea que cuando "no envia", el
 * archivo NUNCA llego aca: se corta la subida desde el telefono.
 *
 * Y de eso no quedaba ningun rastro. El aviso salia en la pantalla de ella y se desvanecia; del
 * lado del servidor no habia forma de saber si pasaba una vez al dia o veinte, ni con que archivos,
 * ni en que parte se cortaba. Esto es exactamente eso: el rastro que faltaba.
 *
 * No guarda nada en la base a proposito. Es una linea en el registro, que es donde se va a mirar
 * cuando alguien vuelva a decir "no me deja mandar fotos", y no vale la pena una tabla para eso.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const cuerpo = (await request.json().catch(() => null)) as {
    fileName?: unknown;
    size?: unknown;
    mimeType?: unknown;
    trozo?: unknown;
    total?: unknown;
    motivo?: unknown;
  } | null;

  const texto = (valor: unknown, max: number) =>
    typeof valor === "string" ? valor.slice(0, max) : "";
  const numero = (valor: unknown) => (typeof valor === "number" && Number.isFinite(valor) ? valor : 0);

  const trozo = numero(cuerpo?.trozo);
  const total = Math.max(1, numero(cuerpo?.total));

  console.warn("[chats] se corto la subida de un archivo", {
    usuario: session.user.email ?? session.user.id,
    archivo: texto(cuerpo?.fileName, 120),
    // En MB porque es como se piensa el problema: "el catalogo de 15 MB no sube".
    pesoMb: Math.round((numero(cuerpo?.size) / (1024 * 1024)) * 10) / 10,
    tipo: texto(cuerpo?.mimeType, 60),
    // Donde se corto: si siempre es en el primer trozo es una cosa, y si es al 90% es otra.
    corteEn: `${trozo + 1}/${total} (${Math.round((trozo / total) * 100)}%)`,
    motivo: texto(cuerpo?.motivo, 200),
  });

  return NextResponse.json({ ok: true });
}
