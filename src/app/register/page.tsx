import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="Registro"
      title="Crea tu acceso"
      description="Empieza en minutos."
      showIntro={false}
      showMetrics={false}
      showShowcase={false}
      showAccentGlow={false}
    >
      <RegisterForm />
    </AuthShell>
  );
}
