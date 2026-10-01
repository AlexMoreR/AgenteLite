import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      "max-image-preview": "none",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

/*
  La puerta de /admin mira la BASE, no solo la sesion.

  El rol viaja dentro del token de la sesion, que se arma al iniciar sesion y dura hasta 30 dias.
  Hasta hoy /admin solo miraba ese token: a quien se le quitaba el rol de administradora seguia
  entrando hasta que cerrara sesion. Paso al pasar a Stheffani y a Ingrid a supervisoras
  (Alex, 01-10-2026). /admin tiene la configuracion de la plataforma: no puede quedar abierto
  por un token viejo.
*/
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userId = session?.user?.id;
  const usuario = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    : null;
  if (usuario?.role !== "ADMIN") {
    redirect("/unauthorized");
  }
  return children;
}
