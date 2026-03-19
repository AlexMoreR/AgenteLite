import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/auth/profile-form";

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
    select: { name: true, image: true, email: true, role: true },
  });

  if (!user) {
    redirect("/login");
  }

  return (
    <section className="w-full py-3 md:py-5">
      <div className="w-full">
      <ProfileForm
        defaultName={user.name ?? ""}
        defaultImage={user.image ?? ""}
        email={user.email}
        role={user.role}
      />
      </div>
    </section>
  );
}
