import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { VerifiedAutoLogin } from "@/components/auth/verified-auto-login";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifiedLoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  if (!token) {
    redirect("/login?error=El+enlace+de+acceso+es+invalido");
  }

  return (
    <AuthShell
      eyebrow="Verificacion"
      title="Tu cuenta ya esta lista"
      description="Estamos abriendo tu acceso."
      showMetrics={false}
    >
      <VerifiedAutoLogin token={token} />
    </AuthShell>
  );
}
