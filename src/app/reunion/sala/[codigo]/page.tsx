import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { ESTADOS_PARA_ENTRAR } from "@/features/reuniones/estados";
import { EntradaALaSala } from "@/features/reuniones/components/EntradaALaSala";
import { puedeIniciarLaSala } from "@/features/reuniones/servicios/permisos";

export const metadata: Metadata = {
  title: "Sala de reuniones",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
  EL LINK FIJO DE UNA SALA: /reunion/sala/<codigo> (sale del nombre: sistemas-emanuel).

  - Si la sala tiene una reunión Esperando o En vivo, manda a /reunion/<codigo de esa reunión>: abrir
    el link dos veces lleva a la misma reunión.
  - Si no hay ninguna, quien tiene el módulo Reuniones en el negocio de la sala ve «Iniciar reunión»;
    los demás (invitados) esperan y la página se refresca sola hasta que alguien la inicie.
*/
export default async function SalaFijaPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const sala =
    codigo.length <= 100
      ? await prisma.salaDeReuniones.findUnique({ where: { codigo }, select: { id: true, nombre: true, workspaceId: true } })
      : null;
  if (!sala) {
    notFound();
  }

  const abierta = await prisma.reunion.findFirst({
    where: { salaFijaId: sala.id, estado: { in: ESTADOS_PARA_ENTRAR } },
    orderBy: { createdAt: "desc" },
    select: { codigo: true },
  });
  if (abierta) {
    redirect(`/reunion/${encodeURIComponent(abierta.codigo)}`);
  }

  const session = await auth();
  const access = session?.user?.id ? await getClientWorkspaceAccessForUser(session.user.id) : null;

  return <EntradaALaSala salaId={sala.id} nombre={sala.nombre} puedeIniciar={puedeIniciarLaSala(access, sala)} />;
}
