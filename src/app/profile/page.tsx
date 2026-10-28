import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/auth/profile-form";
import { AvisosDelTablero } from "@/components/auth/avisos-del-tablero";
import { personaRecibeAvisos } from "@/features/tableros-inteligentes/services/avisos-al-equipo";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, image: true, email: true, role: true, chatSignature: true },
  });

  if (!user) {
    redirect("/login");
  }

  // La casilla de avisos del Tablero IA solo la ve quien es persona activa de un negocio.
  const esDelEquipo = (await prisma.workspaceMember.count({ where: { userId: session.user.id, isActive: true } })) > 0;
  const recibeAvisos = esDelEquipo ? await personaRecibeAvisos(session.user.id) : false;

  return (
    <section className="w-full py-3 md:py-5">
      <div className="w-full">
      <ProfileForm
        defaultName={user.name ?? ""}
        defaultImage={user.image ?? ""}
        email={user.email}
        role={user.role}
        defaultChatSignature={user.chatSignature ?? ""}
      />
      {esDelEquipo ? (
        <div className="mt-4">
          <AvisosDelTablero defaultActivo={recibeAvisos} />
        </div>
      ) : null}
      </div>
    </section>
  );
}
