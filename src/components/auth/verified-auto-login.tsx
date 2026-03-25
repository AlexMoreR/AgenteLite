"use client";

import { useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";

type VerifiedAutoLoginProps = {
  token: string;
};

export function VerifiedAutoLogin({ token }: VerifiedAutoLoginProps) {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function runAutoLogin() {
      if (!token) {
        router.replace("/login?error=El+enlace+de+acceso+es+invalido");
        return;
      }

      const response = await signIn("credentials", {
        verificationToken: token,
        redirect: false,
        redirectTo: "/cliente",
      });

      if (response?.error) {
        toast.error("No se pudo abrir tu sesion automaticamente");
        router.replace("/login?error=No+se+pudo+abrir+tu+sesion+automaticamente");
        return;
      }

      toast.success("Correo verificado. Entrando a tu cuenta...");
      router.replace(response?.url || "/cliente");
      router.refresh();
    }

    void runAutoLogin();
  }, [router, token]);

  return (
    <Card className="w-full max-w-sm rounded-[1.8rem] !border-white/10 !bg-[#0c1828] p-6 text-white shadow-[0_30px_80px_-45px_rgba(0,0,0,0.9)] sm:max-w-md sm:p-8 lg:max-w-xl lg:rounded-[2.2rem] lg:p-10">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8deedc]">
          Verificacion lista
        </p>
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
          Estamos entrando a tu cuenta
        </h2>
        <p className="text-sm text-[#9fb1c7]">
          Tu correo ya quedo confirmado. En unos segundos te llevamos a tu panel sin pedirte la
          contrasena otra vez.
        </p>
      </div>
    </Card>
  );
}
