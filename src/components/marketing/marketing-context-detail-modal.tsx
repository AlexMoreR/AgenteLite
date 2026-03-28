"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type MarketingContextDetailModalProps = {
  items: Array<{
    title: string;
    value: string;
  }>;
};

export function MarketingContextDetailModal({ items }: MarketingContextDetailModalProps) {
  const [open, setOpen] = useState(false);
  const canPortal = typeof document !== "undefined";

  useEffect(() => {
    if (!open || !canPortal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [canPortal, open]);

  return (
    <>
      <Button type="button" size="lg" className="rounded-2xl" onClick={() => setOpen(true)}>
        Ver detalle de marketing
        <ChevronRight className="h-4 w-4" />
      </Button>

      {canPortal && open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#0f172a80] p-0 md:p-6"
              role="dialog"
              aria-modal="true"
              aria-label="Detalle de marketing"
              onClick={() => setOpen(false)}
            >
              <div
                className="flex h-full w-full max-w-[960px] flex-col overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-5 md:px-8 md:py-4">
                  <div className="relative flex items-start justify-center">
                    <div className="space-y-2 text-center">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">
                        Marketing IA
                      </p>
                      <h2 className="text-[1.7rem] font-semibold tracking-[-0.06em] text-slate-950 md:text-[2rem]">
                        Detalle de marketing
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.16)] bg-white text-slate-600 transition hover:bg-slate-50"
                      aria-label="Cerrar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-[#f1f3f5] px-5 py-6 md:px-8 md:py-4">
                  <div className="mx-auto w-full max-w-[760px]">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {items.map((item) => (
                        <div
                          key={item.title}
                          className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)]"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                            {item.title}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-700">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
