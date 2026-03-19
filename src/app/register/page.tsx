import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function RegisterPage() {
  return (
    <section className="app-page grid min-h-[calc(100vh-9rem)] place-items-center px-4 py-10">
      <RegisterForm />
    </section>
  );
}
