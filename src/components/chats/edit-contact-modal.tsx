"use client";

import { useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { updateContactAction } from "@/app/actions/chats-actions";

type Props = {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
};

const initialState: { error?: string; success?: boolean } = {};

export function EditContactModal({ open, onClose, contactId, contactName }: Props) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(updateContactAction, initialState);

  useEffect(() => {
    if (state.success) {
      router.refresh();
      onClose();
    }
  }, [state.success, onClose, router]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Editar contacto</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form action={formAction} className="space-y-4 p-5">
          <input type="hidden" name="contactId" value={contactId} />
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-slate-500">Nombre</label>
            <input
              key={contactId}
              name="name"
              defaultValue={contactName}
              placeholder="Nombre del contacto"
              autoFocus
              className="h-10 w-full rounded-[14px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition focus:border-[var(--primary)]"
            />
          </div>
          {state.error ? (
            <p className="text-xs text-rose-500">{state.error}</p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[12px] border border-slate-200 px-4 text-[13px] text-slate-600 transition hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="h-9 rounded-[12px] bg-[var(--primary)] px-4 text-[13px] font-semibold text-white transition disabled:opacity-60"
            >
              {isPending ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
