import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { anotarLlamadaExterna } from "@/lib/medicion-de-pedido";
import { procesarPedido, type NombreDeRutaDeEnvio } from "@/lib/chats/ruta-de-envio";

/*
  Lo que comparten las rutas fijas de envio del chat (contrato en src/lib/chats/ruta-de-envio.ts).

  Mismo control de entrada que /api/cliente/chats/enviar: sesion con rol ADMIN, CLIENTE o EMPLEADO y
  el modulo chats, con el permiso guardado 45 s (el mismo de /enviar y /live: un permiso quitado tarda
  hasta 45 s aca tambien). Despues la accion vuelve a controlar todo como siempre (incluido el modo
  monitoreo).

  Cada paso (ruta_auth, ruta_cuerpo, ruta_accion) va al Server-Timing de la ruta que la envuelva con
  conServerTiming (hoy enviar-archivo). Sin envoltorio no hace nada.
*/

export async function atenderRutaDeEnvio<Entrada>(
  request: Request,
  nombre: NombreDeRutaDeEnvio,
  accion: (entrada: Entrada) => Promise<unknown>,
) {
  let ultimaMarca = performance.now();
  const marca = (paso: string) => {
    const ahora = performance.now();
    anotarLlamadaExterna(`ruta_${paso}`, ahora - ultimaMarca);
    ultimaMarca = ahora;
  };

  const session = await auth();
  const userId = session?.user?.id;
  const sesionValida = Boolean(userId && session?.user?.role && ["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role));
  let accesoAChats = false;
  if (sesionValida && userId) {
    const access = await getClientWorkspaceAccessForUserCached(userId);
    accesoAChats = Boolean(access && canAccessClientModule(access, "chats"));
  }
  marca("auth");

  const { status, cuerpo } = await procesarPedido({
    nombre,
    sesionValida,
    accesoAChats,
    largoDeclarado: request.headers.get("content-length"),
    leerCuerpo: async () => {
      const texto = await request.text();
      marca("cuerpo");
      return texto;
    },
    // La accion valida con su propio zod: aca solo se eligen los campos conocidos.
    accion: (entrada) => accion(entrada as unknown as Entrada),
  });
  marca("accion");
  return NextResponse.json(cuerpo, { status, headers: { "Cache-Control": "no-store" } });
}
