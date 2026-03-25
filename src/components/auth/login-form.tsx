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
  const emailErrors = state.errors?.email;
  const passwordErrors = state.errors?.password;
  const formMessage = !emailErrors?.length && !passwordErrors?.length ? state.message : "";

  useEffect(() => {
    if (!state.message) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  return (
    <Card className="w-full max-w-sm rounded-[1.8rem] !border-white/10 !bg-[#0c1828] p-6 text-white shadow-[0_30px_80px_-45px_rgba(0,0,0,0.9)] sm:max-w-md sm:p-8 lg:max-w-xl lg:rounded-[2.2rem] lg:p-10">
      <div className="mb-6 space-y-1.5 lg:mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8deedc]">Acceso</p>
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
          Inicia sesion
        </h2>
      </div>
      <form action={formAction} className="space-y-4 lg:space-y-5">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[#d9e4f0]">Correo</span>
          <Input
            type="email"
            name="email"
            placeholder="correo@empresa.com"
            autoComplete="email"
            aria-invalid={emailErrors?.length ? true : undefined}
            aria-describedby={emailErrors?.length ? "login-email-error" : undefined}
            className="h-11 rounded-xl border-white/10 bg-[#08111c] text-white placeholder:text-[#6f879f] focus-visible:border-[#2ed3b7]/40 focus-visible:bg-[#0b1522] focus-visible:ring-[#2ed3b7]/15 lg:h-13 lg:rounded-2xl lg:px-5 lg:text-base"
            required
          />
          {emailErrors?.length ? (
            <p id="login-email-error" className="text-sm text-rose-200">
              {emailErrors[0]}
            </p>
          ) : null}
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[#d9e4f0]">Contrasena</span>
          <Input
            type="password"
            name="password"
            placeholder="Tu contrasena"
            autoComplete="current-password"
            aria-invalid={passwordErrors?.length ? true : undefined}
            aria-describedby={passwordErrors?.length ? "login-password-error" : undefined}
            className="h-11 rounded-xl border-white/10 bg-[#08111c] text-white placeholder:text-[#6f879f] focus-visible:border-[#2ed3b7]/40 focus-visible:bg-[#0b1522] focus-visible:ring-[#2ed3b7]/15 lg:h-13 lg:rounded-2xl lg:px-5 lg:text-base"
            required
          />
          {passwordErrors?.length ? (
            <p id="login-password-error" className="text-sm text-rose-200">
              {passwordErrors[0]}
            </p>
          ) : null}
        </label>
        {formMessage ? (
          <p
            className={`rounded-xl border px-3 py-2 text-sm ${
              state.ok
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                : "border-red-400/20 bg-red-400/10 text-red-100"
            }`}
          >
            {formMessage}
          </p>
        ) : null}
        <Button
          type="submit"
          className="mt-2 h-11 w-full rounded-full bg-[#2ed3b7] font-semibold text-[#04131d] hover:bg-[#58e4cc] lg:h-14 lg:text-lg"
          disabled={pending}
        >
          {pending ? "Entrando..." : "Entrar"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-[#9fb1c7]">
        No tienes cuenta?{" "}
        <Link href="/register" className="font-semibold text-[#8deedc] hover:text-[#b4f7ea]">
          Crear cuenta
        </Link>
      </p>
    </Card>
  );
}
