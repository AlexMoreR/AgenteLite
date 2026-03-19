"use client";

import { useEffect, useState } from "react";
import { adminCreateUserAction } from "@/app/actions/auth-actions";
import { Input } from "@/components/ui/input";

export function CreateUserModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
      >
        Crear usuario
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Crear usuario"
          onClick={() => setOpen(false)}
        >
          <div
            className="saas-card w-full max-w-md rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Crear usuario</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>

            <form action={adminCreateUserAction} className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Nombre</span>
                <Input type="text" name="name" placeholder="Nombre completo" required />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Correo</span>
                <Input type="email" name="email" placeholder="correo@empresa.com" required />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Contrasena</span>
                <Input type="password" name="password" placeholder="Minimo 8 caracteres" required />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Rol</span>
                <select
                  name="role"
                  defaultValue="CLIENTE"
                  className="field-select"
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="EMPLEADO">EMPLEADO</option>
                  <option value="CLIENTE">CLIENTE</option>
                </select>
              </label>
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                Guardar usuario
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
