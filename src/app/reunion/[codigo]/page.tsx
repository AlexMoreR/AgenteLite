import type { Metadata } from "next";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ESTADOS_PARA_ENTRAR } from "@/features/reuniones/estados";
import { EntradaALaReunion } from "@/features/reuniones/components/EntradaALaReunion";

export const metadata: Metadata = {
  title: "Reunión",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
  LA SALA PÚBLICA DE UNA REUNIÓN: /reunion/<código largo al azar>.

  Se entra desde el celular o el PC sin instalar nada. El invitado escribe su nombre; quien tiene
  sesión en el CRM entra con el suyo. Antes de entrar se ve el aviso de que se graba.
*/
export default async function ReunionPublicaPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const reunion =
    codigo.length <= 100
      ? await prisma.reunion.findUnique({ where: { codigo }, select: { titulo: true, estado: true, origen: true } })
      : null;

  if (!reunion || reunion.origen !== "VIVO") {
    return <Aviso titulo="Esta reunión no existe" detalle="Revisa que el link esté completo." />;
  }
  if (!ESTADOS_PARA_ENTRAR.includes(reunion.estado)) {
    return <Aviso titulo={reunion.titulo} detalle="Esta reunión ya terminó." />;
  }

  const session = await auth();
  const nombreConSesion = session?.user?.id ? session.user.name?.trim() || session.user.email?.split("@")[0] || "Tú" : null;

  return <EntradaALaReunion codigo={codigo} titulo={reunion.titulo} nombreConSesion={nombreConSesion} />;
}

function Aviso({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-sm space-y-1 text-center">
        <h1 className="text-lg font-semibold">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{detalle}</p>
      </div>
    </div>
  );
}
