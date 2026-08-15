"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Camera, KeyRound, Loader2, Mail, ShieldCheck, Trash2, UserPen, X } from "lucide-react";
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
  defaultChatSignature: string;
};

export function ProfileForm({
  defaultName,
  defaultImage,
  email,
  role,
  defaultChatSignature,
}: ProfileFormProps) {
  const { update } = useSession();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(defaultImage);
  const [isUploading, setIsUploading] = useState(false);

  async function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reseteamos el input para poder volver a elegir el mismo archivo si hace falta.
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/profile/upload-photo", { method: "POST", body });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; url?: string; error?: string }
        | null;

      if (!response.ok || !result?.ok || !result.url) {
        toast.error(result?.error ?? "No se pudo subir la foto.");
        return;
      }

      setImageUrl(result.url);
      toast.success("Foto lista. Guarda el perfil para aplicarla.");
    } catch {
      toast.error("No se pudo subir la foto. Revisa tu conexion.");
    } finally {
      setIsUploading(false);
    }
  }
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

  /*
   * Se saco la tarjeta de resumen que iba arriba: mostraba el nombre, el correo y otra vez el
   * correo, y justo debajo el formulario pedia exactamente lo mismo. Tres veces el mismo dato en
   * una pantalla que se abre para CAMBIARLO. El unico dato que solo vivia ahi era el rol, que
   * pasa al lado del titulo.
   */
  return (
    <div className="grid gap-4">
      <div className="space-y-4">
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
              <UserPen className="h-4 w-4 text-slate-500" />
              Informacion personal
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
              {role}
            </span>
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
            {/* La foto se sube desde el dispositivo: guardamos la URL resultante en un
                input oculto para que updateProfileAction la persista igual que antes. */}
            <input type="hidden" name="image" value={imageUrl} />
            <div className="flex items-center gap-3">
              <Avatar className="h-16 w-16 rounded-xl border border-[var(--line)]">
                <AvatarImage src={imageUrl} alt={defaultName || email} />
                <AvatarFallback className="rounded-xl bg-slate-800 text-sm">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-900">Foto de perfil</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" data-icon="inline-start" />
                    ) : (
                      <Camera className="h-4 w-4" data-icon="inline-start" />
                    )}
                    {isUploading ? "Subiendo..." : "Subir foto"}
                  </Button>
                  {imageUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setImageUrl("")}
                      disabled={isUploading}
                    >
                      <Trash2 className="h-4 w-4" data-icon="inline-start" />
                      Quitar
                    </Button>
                  ) : null}
                </div>
                <span className="text-xs leading-5 text-slate-500">
                  JPG, PNG, WEBP o GIF. Maximo 8 MB.
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-slate-900">Firma en los chats</span>
              <textarea
                name="chatSignature"
                defaultValue={defaultChatSignature}
                rows={2}
                maxLength={160}
                placeholder="Ej: 👩‍💻 *Ingrid Sánchez*"
                className="min-h-16 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
              />
            </label>
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
