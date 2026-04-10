"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { MessageCirclePlus, X } from "lucide-react";

type NewConnectionChannelModalProps = {
  canSeeOfficialApiModule: boolean;
};

export function NewConnectionChannelModal({ canSeeOfficialApiModule }: NewConnectionChannelModalProps) {
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
        className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.45)] transition hover:translate-y-[-1px] hover:bg-[var(--primary-strong)]"
      >
        <MessageCirclePlus className="h-4 w-4" />
        Nuevo canal
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[#02081799] p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Nuevo canal"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-[2rem] border border-[rgba(148,163,184,0.16)] bg-white p-6 shadow-[0_32px_80px_-32px_rgba(15,23,42,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Nuevo canal</p>
                <h2 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Elige el tipo de conexion</h2>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.18)] text-slate-500 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                aria-label="Cerrar modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <ChannelOptionCard
                href="/cliente/conexion/whatsapp-business"
                title="WhatsApp QR Code"
                description="Conecta numeros de whatsapp bussines por QR o Codigo."
                cta="Empezar Ahora"
                icon={<WhatsAppGlyph className="h-8 w-8" />}
                onNavigate={() => setOpen(false)}
              />

              <ChannelOptionCard
                href={canSeeOfficialApiModule ? "/cliente/api-oficial" : undefined}
                title="WhatsApp API (Meta)"
                description="Manejas la api oficial de meta este es para ti."
                cta={canSeeOfficialApiModule ? "Empezar ahora" : "Desactivado"}
                icon={<WhatsAppGlyph className="h-8 w-8" />}
                disabled={!canSeeOfficialApiModule}
                onNavigate={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChannelOptionCard({
  href,
  title,
  description,
  cta,
  icon,
  disabled = false,
  onNavigate,
}: {
  href?: string;
  title: string;
  description: string;
  cta: string;
  icon: ReactNode;
  disabled?: boolean;
  onNavigate: () => void;
}) {
  const baseClassName = "group relative overflow-hidden rounded-[28px] border p-5 text-left transition";

  if (disabled || !href) {
    return (
      <div className={`${baseClassName} border-[rgba(148,163,184,0.16)] bg-slate-50/80 opacity-80`}>
        <ChannelOptionContent title={title} description={description} cta={cta} icon={icon} disabled />
      </div>
    );
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`${baseClassName} border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)] hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-42px_rgba(15,23,42,0.18)]`}
    >
      <ChannelOptionContent title={title} description={description} cta={cta} icon={icon} />
    </Link>
  );
}

function ChannelOptionContent({
  title,
  description,
  cta,
  icon,
  disabled = false,
}: {
  title: string;
  description: string;
  cta: string;
  icon: ReactNode;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.06),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.05),transparent_28%)]" />

      <div className="relative flex h-full flex-col items-center gap-4 text-center">
        <div className="inline-flex h-14 w-14 self-center items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#22c55e_14%,white)] text-[#16a34a]">
          {icon}
        </div>

        <div className="space-y-2">
          <h3 className="text-[1.1rem] font-semibold tracking-[-0.04em] text-slate-950">{title}</h3>
          <p className="text-sm leading-6 text-slate-600">{description}</p>
        </div>

        <div className={`mt-auto text-sm font-medium ${disabled ? "text-slate-500" : "text-[var(--primary)]"}`}>{cta}</div>
      </div>
    </>
  );
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.05 4.94A9.9 9.9 0 0 0 12.02 2C6.51 2 2.02 6.48 2.02 12c0 1.76.46 3.48 1.33 5L2 22l5.15-1.34A9.95 9.95 0 0 0 12.02 22h.01c5.51 0 9.99-4.49 9.99-10 0-2.67-1.04-5.18-2.97-7.06Zm-7.03 15.38h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.06.8.82-2.98-.2-.31a8.27 8.27 0 0 1-1.28-4.43c0-4.58 3.73-8.31 8.32-8.31 2.22 0 4.3.86 5.87 2.43a8.23 8.23 0 0 1 2.43 5.88c0 4.58-3.73 8.31-8.36 8.31Zm4.56-6.2c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8.96-.15.17-.3.19-.55.07-.25-.12-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.39-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.24-.42.08-.17.04-.32-.02-.44-.06-.12-.57-1.37-.78-1.87-.2-.49-.4-.42-.57-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.43 1.02 2.59.12.17 1.77 2.7 4.29 3.78.6.26 1.08.42 1.44.53.61.19 1.17.16 1.61.1.49-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
