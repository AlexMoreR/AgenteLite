import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Button } from "@/components/ui/button";

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
    <section className="app-page min-h-[calc(100vh-9rem)] px-4 py-10">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Acceso"
        errorTitle="No se pudo completar"
      />
      <div className="mx-auto w-full max-w-md space-y-4">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
        </Button>
        <LoginForm />
      </div>
    </section>
  );
}
