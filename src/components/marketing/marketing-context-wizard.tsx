"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronLeft, ChevronRight, Globe, Save, Sparkles, Target, X } from "lucide-react";
import { updateMarketingBusinessContextAction } from "@/app/actions/marketing-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MarketingContextWizardProps = {
  defaultValues: {
    valueProposition: string;
    idealCustomer: string;
    painPoints: string;
    mainOffer: string;
    primaryCallToAction: string;
    websiteUrl: string;
    instagramUrl: string;
    facebookUrl: string;
    tiktokUrl: string;
  };
  openLabel?: string;
};

const steps = [
  {
    id: 1,
    title: "Tu negocio",
    subtitle: "Cuéntale a la IA que hace especial a tu negocio y a quien le vendes.",
    icon: Building2,
  },
  {
    id: 2,
    title: "Lo que ofreces",
    subtitle: "Define que vendes, que problema resuelves y que accion quieres lograr.",
    icon: Target,
  },
  {
    id: 3,
    title: "Canales",
    subtitle: "Agrega redes o pagina web para que la IA entienda mejor tu presencia digital.",
    icon: Globe,
  },
] as const;

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <span
      className={`h-2 rounded-full transition-all ${
        active
          ? "w-9 bg-[var(--primary)] shadow-[0_8px_18px_-10px_color-mix(in_srgb,var(--primary)_65%,black)]"
          : done
            ? "w-4 bg-[color-mix(in_srgb,var(--primary)_58%,white)]"
            : "w-4 bg-slate-200"
      }`}
    />
  );
}

export function MarketingContextWizard({
  defaultValues,
  openLabel = "Completar informacion",
}: MarketingContextWizardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const canPortal = typeof document !== "undefined";
  const open = searchParams.get("wizard") === "1";

  const openModal = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("wizard", "1");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const closeModal = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("wizard");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeModal, open]);

  useEffect(() => {
    if (!open || !canPortal) {
      return;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [canPortal, open]);

  const activeStep = steps[step];
  const ActiveIcon = activeStep.icon;

  return (
    <>
      <Button type="button" size="lg" className="rounded-2xl" onClick={openModal}>
        <Sparkles className="h-4 w-4" />
        {openLabel}
      </Button>

      {canPortal && open
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-[radial-gradient(circle_at_top,rgba(35,25,57,0.58),rgba(15,23,42,0.74))] p-0 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Completar informacion del negocio"
        >
          <div
            className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-none border border-[rgba(87,72,117,0.14)] bg-[linear-gradient(180deg,#fbf8ff_0%,#ffffff_100%)] md:max-h-[92vh] md:rounded-[36px] md:shadow-[0_50px_120px_-56px_rgba(27,18,56,0.56)]"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[rgba(87,72,117,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(248,244,255,0.9)_100%)] px-5 py-5 md:px-8 md:py-5">
              <div className="relative flex items-start justify-center gap-4">
                <div className="space-y-2 text-center">
                  <div className="flex justify-center gap-2">
                    {steps.map((item, index) => (
                      <StepDot key={item.id} active={index === step} done={index < step} />
                    ))}
                  </div>

                  <div className="flex items-center justify-center gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                      <ActiveIcon className="h-4.5 w-4.5" />
                    </div>
                    <div className="text-left">
                      <h2 className="text-[1.2rem] font-semibold tracking-[-0.05em] text-slate-950 md:text-[1.45rem]">
                        {activeStep.title}
                      </h2>
                      <p className="text-sm text-slate-600">{activeStep.subtitle}</p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(87,72,117,0.12)] bg-white/92 text-slate-600 transition hover:bg-white"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <form
              action={updateMarketingBusinessContextAction}
              className="flex min-h-0 flex-1 flex-col"
              onKeyDownCapture={(event) => {
                if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
                  event.preventDefault();
                }
              }}
            >
              <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f3edf8_0%,#f7f3fb_18%,#f1f3f5_100%)] px-5 py-6 md:px-8 md:py-6">
                <div className="mx-auto w-full max-w-[760px]">
                  <div className={step === 0 ? "block" : "hidden"}>
                    <section className="space-y-4 md:space-y-5">
                      <div className="rounded-[30px] border border-[rgba(87,72,117,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(249,246,255,0.9))] p-4 shadow-[0_24px_54px_-42px_rgba(35,19,71,0.2)] sm:p-5">
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">Que hace especial a tu negocio</span>
                            <textarea
                              name="valueProposition"
                              rows={4}
                              className="field-textarea min-h-28"
                              defaultValue={defaultValues.valueProposition}
                              placeholder="Ej. Tenemos buen servicio, buena imagen y acompañamos al cliente en todo el proceso."
                              required
                            />
                          </label>

                          <label className="space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">A que tipo de cliente le vendes</span>
                            <textarea
                              name="idealCustomer"
                              rows={4}
                              className="field-textarea min-h-28"
                              defaultValue={defaultValues.idealCustomer}
                              placeholder="Ej. Dueños de barberias, salones o negocios que quieren verse mas profesionales."
                              required
                            />
                          </label>
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className={step === 1 ? "block" : "hidden"}>
                    <section className="space-y-4 md:space-y-5">
                      <div className="rounded-[30px] border border-[rgba(87,72,117,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(249,246,255,0.9))] p-4 shadow-[0_24px_54px_-42px_rgba(35,19,71,0.2)] sm:p-5">
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">Que problema le resuelves a tu cliente</span>
                            <textarea
                              name="painPoints"
                              rows={4}
                              className="field-textarea min-h-28"
                              defaultValue={defaultValues.painPoints}
                              placeholder="Ej. Le ayudamos a verse mejor, atender mejor y ahorrar tiempo al montar su negocio."
                              required
                            />
                          </label>

                          <label className="space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">Que vendes o que quieres impulsar primero</span>
                            <textarea
                              name="mainOffer"
                              rows={4}
                              className="field-textarea min-h-28"
                              defaultValue={defaultValues.mainOffer}
                              placeholder="Ej. Sillas barberas, estaciones y mobiliario premium."
                              required
                            />
                          </label>

                          <label className="space-y-1.5 md:col-span-2">
                            <span className="text-sm font-medium text-slate-700">Que quieres que haga la persona interesada</span>
                            <Input
                              name="primaryCallToAction"
                              defaultValue={defaultValues.primaryCallToAction}
                              placeholder="Ej. Escribenos por WhatsApp"
                              required
                            />
                          </label>
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className={step === 2 ? "block" : "hidden"}>
                    <section className="space-y-4 md:space-y-5">
                      <div className="rounded-[30px] border border-[rgba(87,72,117,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(249,246,255,0.9))] p-4 shadow-[0_24px_54px_-42px_rgba(35,19,71,0.2)] sm:p-5">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <label className="space-y-1.5 md:col-span-2 xl:col-span-1">
                            <span className="text-sm font-medium text-slate-700">Pagina web</span>
                            <Input
                              name="websiteUrl"
                              type="text"
                              inputMode="url"
                              autoComplete="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              defaultValue={defaultValues.websiteUrl}
                              placeholder="Si tienes, pegala aqui"
                            />
                          </label>

                          <label className="space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">Instagram</span>
                            <Input
                              name="instagramUrl"
                              type="text"
                              inputMode="url"
                              autoComplete="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              defaultValue={defaultValues.instagramUrl}
                              placeholder="Tu perfil de Instagram"
                            />
                          </label>

                          <label className="space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">Facebook</span>
                            <Input
                              name="facebookUrl"
                              type="text"
                              inputMode="url"
                              autoComplete="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              defaultValue={defaultValues.facebookUrl}
                              placeholder="Tu pagina de Facebook"
                            />
                          </label>

                          <label className="space-y-1.5">
                            <span className="text-sm font-medium text-slate-700">TikTok</span>
                            <Input
                              name="tiktokUrl"
                              type="text"
                              inputMode="url"
                              autoComplete="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              defaultValue={defaultValues.tiktokUrl}
                              placeholder="Tu perfil de TikTok"
                            />
                          </label>
                        </div>

                        <div className="mt-4 rounded-[24px] border border-[rgba(87,72,117,0.12)] bg-white px-4 py-3 text-sm leading-6 text-slate-600">
                          Puedes dejar vacio lo que aun no tengas. La IA usara primero la informacion mas importante del negocio.
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[rgba(87,72,117,0.12)] bg-[rgba(255,255,255,0.9)] px-5 py-4 backdrop-blur md:px-8">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setStep((current) => Math.max(current - 1, 0))}
                  disabled={step === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Volver
                </Button>

                {step < steps.length - 1 ? (
                  <Button
                    type="button"
                    className="rounded-2xl"
                    onClick={() => setStep((current) => Math.min(current + 1, steps.length - 1))}
                  >
                    Continuar
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="submit" className="rounded-2xl">
                    <Save className="h-4 w-4" />
                    Guardar informacion
                  </Button>
                )}
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )
        : null}
    </>
  );
}
