"use client";

import { useActionState, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { KeyRound, Mail, ShieldCheck, UserPen, X } from "lucide-react";
import { toast } from "sonner";
import {
  changePasswordAction,
  requestPasswordResetAction,
  updateProfileAction,
} from "@/app/actions/auth-actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionState } from "@/lib/validations/auth";

const initialState: ActionState = { ok: false, message: "" };

type ProfileFormProps = {
  defaultName: string;
  defaultImage: string;
  email: string;
  role: string;
};

export function ProfileForm({
  defaultName,
  defaultImage,
  email,
  role,
}: ProfileFormProps) {
  const { update } = useSession();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [profileState, profileAction, profilePending] = useActionState(
    updateProfileAction,
    initialState,
  );
  const [passwordState, passwordAction, passwordPending] = useActionState(
    changePasswordAction,
    initialState,
  );
  const [passwordResetState, passwordResetAction, passwordResetPending] = useActionState(
    requestPasswordResetAction,
    initialState,
  );

  useEffect(() => {
    if (!profileState.message) return;
    if (profileState.ok) toast.success(profileState.message);
    else toast.error(profileState.message);
  }, [profileState]);

  useEffect(() => {
    if (!profileState.ok || !profileState.data) return;

    void update({
      name: profileState.data.name,
      email: profileState.data.email,
      image: profileState.data.image,
    });
  }, [profileState, update]);

  useEffect(() => {
    if (!passwordState.message) return;
    if (passwordState.ok) toast.success(passwordState.message);
    else toast.error(passwordState.message);
  }, [passwordState]);

  useEffect(() => {
    if (!passwordResetState.message) return;
    if (passwordResetState.ok) toast.success(passwordResetState.message);
    else toast.error(passwordResetState.message);
  }, [passwordResetState]);

  useEffect(() => {
    if (!passwordState.ok) return;

    const timeoutId = window.setTimeout(() => {
      setIsPasswordModalOpen(false);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [passwordState.ok]);

  const initials = (defaultName?.trim()?.charAt(0) || email.charAt(0) || "U").toUpperCase();

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="space-y-5 p-5">
        <div className="flex items-center gap-3">
          <Avatar className="h-14 w-14 rounded-xl border border-[var(--line)]">
            <AvatarImage src={defaultImage} alt={defaultName || email} />
            <AvatarFallback className="rounded-xl bg-slate-800 text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">
              {defaultName || "Usuario"}
            </p>
            <p className="truncate text-xs text-slate-600">{email}</p>
          </div>
        </div>

        <div className="space-y-3 border-t border-[var(--line)] pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cuenta</p>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <Mail className="h-4 w-4 text-slate-500" />
            <span className="truncate">{email}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <ShieldCheck className="h-4 w-4 text-slate-500" />
            <span>Rol: {role}</span>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="space-y-4 p-5">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <UserPen className="h-4 w-4 text-slate-500" />
            Informacion personal
          </div>
          <form action={profileAction} className="grid gap-3">
            <Input name="name" defaultValue={defaultName} placeholder="Nombre completo" required />
            <Input
              type="email"
              name="email"
              defaultValue={email}
              placeholder="correo@empresa.com"
              required
            />
            <Input
              name="image"
              defaultValue={defaultImage}
              placeholder="URL de foto de perfil"
            />
            <div className="pt-1">
              <Button type="submit" className="w-full sm:w-auto" disabled={profilePending}>
                {profilePending ? "Guardando..." : "Guardar perfil"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <KeyRound className="h-4 w-4 text-slate-500" />
            Seguridad
          </div>
          <p className="text-sm text-slate-600">
            Gestiona tu acceso desde una ventana separada para mantener esta informacion protegida.
          </p>
          <div className="pt-1">
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => setIsPasswordModalOpen(true)}
            >
              Cambiar contrasena
            </Button>
          </div>
        </Card>
      </div>

      {isPasswordModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
          onClick={() => setIsPasswordModalOpen(false)}
        >
          <Card
            className="w-full max-w-md space-y-4 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <KeyRound className="h-4 w-4 text-slate-500" />
                  Cambiar contrasena
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Ingresa tu contrasena actual y define una nueva clave.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setIsPasswordModalOpen(false)}
              >
                <X className="h-4 w-4 text-slate-500" />
              </Button>
            </div>

            <form action={passwordAction} className="grid gap-3">
              <Input
                type="password"
                name="currentPassword"
                placeholder="Contrasena actual"
                required
              />
              <Input
                type="password"
                name="newPassword"
                placeholder="Nueva contrasena"
                required
              />
              <Input
                type="password"
                name="confirmPassword"
                placeholder="Confirmar nueva contrasena"
                required
              />
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsPasswordModalOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" className="w-full sm:w-auto" disabled={passwordPending}>
                  {passwordPending ? "Actualizando..." : "Actualizar contrasena"}
                </Button>
              </div>
            </form>

            <div className="space-y-3 rounded-xl border border-dashed border-[var(--line)] bg-slate-50/80 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-900">Perdi la contrasena</p>
                <p className="text-sm text-slate-600">
                  Te enviamos un enlace a <span className="font-medium text-slate-900">{email}</span>{" "}
                  para que crees una nueva.
                </p>
              </div>
              <form action={passwordResetAction}>
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={passwordResetPending}
                >
                  {passwordResetPending ? "Enviando..." : "Enviar recuperacion por correo"}
                </Button>
              </form>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
