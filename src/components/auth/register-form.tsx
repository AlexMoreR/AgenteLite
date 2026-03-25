"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { registerAction } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionState } from "@/lib/validations/auth";

const initialState: ActionState = { ok: false, message: "" };

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);

  useEffect(() => {
    if (!state.message) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  return (
    <Card className="w-full max-w-sm rounded-[1.8rem] !border-white/10 !bg-[#0c1828] p-6 text-white shadow-[0_30px_80px_-45px_rgba(0,0,0,0.9)]">
      <div className="mb-6 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8deedc]">Registro</p>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-white">Crear cuenta</h1>
      </div>
      <form action={formAction} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[#d9e4f0]">Nombre</span>
          <Input
            type="text"
            name="name"
            placeholder="Nombre completo"
            className="h-11 rounded-xl border-white/10 bg-[#08111c] text-white placeholder:text-[#6f879f] focus-visible:border-[#2ed3b7]/40 focus-visible:bg-[#0b1522] focus-visible:ring-[#2ed3b7]/15"
            required
          />
        </label>
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
            placeholder="Crea tu contrasena"
            className="h-11 rounded-xl border-white/10 bg-[#08111c] text-white placeholder:text-[#6f879f] focus-visible:border-[#2ed3b7]/40 focus-visible:bg-[#0b1522] focus-visible:ring-[#2ed3b7]/15"
            required
          />
        </label>

        {state.message ? (
          <p
            className={`rounded-xl border px-3 py-2 text-sm ${
              state.ok
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                : "border-red-400/20 bg-red-400/10 text-red-100"
            }`}
          >
            {state.ok ? "Revisa tu correo para activar la cuenta." : state.message}
          </p>
        ) : null}

        <Button
          type="submit"
          className="mt-2 h-11 w-full rounded-full bg-[#2ed3b7] font-semibold text-[#04131d] hover:bg-[#58e4cc]"
          disabled={pending}
        >
          {pending ? "Creando..." : "Registrarme"}
        </Button>
        <p className="text-xs text-[#8fa4ba]">
          Te enviaremos un correo de confirmacion.
        </p>
      </form>
      <p className="mt-5 text-center text-sm text-[#9fb1c7]">
        Ya tienes cuenta?{" "}
        <Link href="/login" className="font-semibold text-[#8deedc] hover:text-[#b4f7ea]">
          Inicia sesion
        </Link>
      </p>
    </Card>
  );
}
