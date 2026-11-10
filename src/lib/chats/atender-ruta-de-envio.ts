import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { procesarPedido, type NombreDeRutaDeEnvio } from "@/lib/chats/ruta-de-envio";

/*
  Lo que comparten las rutas fijas de envio del chat (contrato en src/lib/chats/ruta-de-envio.ts).

  Mismo control de entrada que /api/cliente/chats/enviar: sesion con rol ADMIN, CLIENTE o EMPLEADO y
  el modulo chats. Despues la accion vuelve a controlar todo como siempre (incluido el modo monitoreo).
*/

export async function atenderRutaDeEnvio<Entrada>(
  request: Request,
  nombre: NombreDeRutaDeEnvio,
  accion: (entrada: Entrada) => Promise<unknown>,
) {
  const session = await auth();
  const userId = session?.user?.id;
  const sesionValida = Boolean(userId && session?.user?.role && ["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role));
  let accesoAChats = false;
  if (sesionValida && userId) {
    const access = await getClientWorkspaceAccessForUser(userId);
    accesoAChats = Boolean(access && canAccessClientModule(access, "chats"));
  }

  const { status, cuerpo } = await procesarPedido({
    nombre,
    sesionValida,
    accesoAChats,
    largoDeclarado: request.headers.get("content-length"),
    leerCuerpo: () => request.text(),
    // La accion valida con su propio zod: aca solo se eligen los campos conocidos.
    accion: (entrada) => accion(entrada as unknown as Entrada),
  });
  return NextResponse.json(cuerpo, { status, headers: { "Cache-Control": "no-store" } });
}
