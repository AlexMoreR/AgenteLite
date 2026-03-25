import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <AuthShell eyebrow="Acceso" title="Entra a tu panel" description="Mismo inicio. Acceso rapido.">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Acceso"
        errorTitle="No se pudo completar"
      />
      <LoginForm />
    </AuthShell>
  );
}
