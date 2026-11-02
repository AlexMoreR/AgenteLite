import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

// "¿Olvidaste tu contraseña?": se abre sin sesión desde /login y manda el enlace a /reset-password.
export default function RecuperarContrasenaPage() {
  return (
    <AuthShell
      eyebrow="Recuperacion"
      title="Recupera tu acceso"
      description="Te mandamos un enlace a tu correo para crear una contrasena nueva."
      showMetrics={false}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
