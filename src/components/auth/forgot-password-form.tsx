"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionState } from "@/lib/validations/auth";

const initialState: ActionState = { ok: false, message: "" };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  const emailErrors = state.errors?.email;
  const formMessage = !emailErrors?.length ? state.message : "";

  return (
    <Card className="w-full max-w-sm rounded-[1.8rem] !border-white/10 !bg-[#0c1828] p-6 text-white shadow-[0_30px_80px_-45px_rgba(0,0,0,0.9)] sm:max-w-md sm:p-8 lg:max-w-xl lg:rounded-[2.2rem] lg:p-10">
      <div className="mb-6 space-y-1.5 lg:mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8deedc]">
          Recuperacion
        </p>
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
          ¿Olvidaste tu contraseña?
        </h2>
        <p className="text-sm text-[#9fb1c7]">
          Escribe el correo con el que entras y te mandamos un enlace para crear una nueva.
        </p>
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
            aria-describedby={emailErrors?.length ? "forgot-email-error" : undefined}
            className="h-11 rounded-xl border-white/10 bg-[#08111c] text-white placeholder:text-[#6f879f] focus-visible:border-[#2ed3b7]/40 focus-visible:bg-[#0b1522] focus-visible:ring-[#2ed3b7]/15 lg:h-13 lg:rounded-2xl lg:px-5 lg:text-base"
            required
          />
          {emailErrors?.length ? (
            <p id="forgot-email-error" className="text-sm text-rose-200">
              {emailErrors[0]}
            </p>
          ) : null}
        </label>
        {formMessage ? (
          <p
            role="status"
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
          {pending ? "Enviando..." : "Enviar enlace"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-[#9fb1c7]">
        <Link href="/login" className="font-semibold text-[#8deedc] hover:text-[#b4f7ea]">
          Volver a iniciar sesión
        </Link>
      </p>
    </Card>
  );
}
