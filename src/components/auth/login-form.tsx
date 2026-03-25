"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { loginAction } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionState } from "@/lib/validations/auth";

const initialState: ActionState = { ok: false, message: "" };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  useEffect(() => {
    if (!state.message) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  return (
    <Card className="w-full max-w-sm rounded-[1.8rem] border-white/10 bg-[#0c1828] p-6 text-white shadow-[0_30px_80px_-45px_rgba(0,0,0,0.9)]">
      <div className="mb-6 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8deedc]">Login</p>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-white">Iniciar sesion</h1>
      </div>
      <form action={formAction} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[#d9e4f0]">Correo</span>
          <Input
            type="email"
            name="email"
            placeholder="correo@empresa.com"
            className="h-11 rounded-xl border-white/10 bg-[#08111c] text-white placeholder:text-[#6f879f] focus-visible:border-[#2ed3b7]/40 focus-visible:bg-[#0b1522] focus-visible:ring-[#2ed3b7]/15"
            required
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[#d9e4f0]">Contrasena</span>
          <Input
            type="password"
            name="password"
            placeholder="Tu contrasena"
            className="h-11 rounded-xl border-white/10 bg-[#08111c] text-white placeholder:text-[#6f879f] focus-visible:border-[#2ed3b7]/40 focus-visible:bg-[#0b1522] focus-visible:ring-[#2ed3b7]/15"
            required
          />
        </label>
        <Button
          type="submit"
          className="mt-2 h-11 w-full rounded-full bg-[#2ed3b7] font-semibold text-[#04131d] hover:bg-[#58e4cc]"
          disabled={pending}
        >
          {pending ? "Entrando..." : "Entrar"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-[#9fb1c7]">
        No tienes cuenta?{" "}
        <Link href="/register" className="font-semibold text-[#8deedc] hover:text-[#b4f7ea]">
          Registrate
        </Link>
      </p>
    </Card>
  );
}
