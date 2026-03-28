"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { completeWorkspaceOnboardingAction } from "@/app/actions/workspace-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MarketingOnboardingWizardProps = {
  defaultBusinessName: string;
  returnTo: string;
};

const steps = [
  {
    id: 1,
    title: "Tu negocio",
    subtitle: "Define la base del negocio para preparar tu espacio de trabajo.",
    icon: "🏢",
  },
  {
    id: 2,
    title: "Ubicacion",
    subtitle: "Cuentanos desde donde operas para contextualizar mejor la app.",
    icon: "📍",
  },
  {
    id: 3,
    title: "Confirmacion",
    subtitle: "Revisa la informacion y continua al panel con el contexto inicial listo.",
    icon: "✨",
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

export function MarketingOnboardingWizard({
  defaultBusinessName,
  returnTo,
}: MarketingOnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const activeStep = steps[step];

  return (
    <div className="w-full max-w-[1120px] overflow-hidden rounded-none border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,#fdfdfd_0%,#ffffff_100%)] md:rounded-[32px] md:shadow-[0_42px_110px_-52px_rgba(15,23,42,0.5)]">
      <div className="border-b border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfd_100%)] px-5 py-5 md:px-8 md:py-4">
        <div className="space-y-3 text-center">
          <div className="flex justify-center gap-2">
            {steps.map((item, index) => (
              <StepDot key={item.id} active={index === step} done={index < step} />
            ))}
          </div>

          <div className="flex items-center justify-center gap-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[1.2rem]">
              <span aria-hidden="true">{activeStep.icon}</span>
            </div>
            <div className="text-left">
              <h1 className="text-[1.7rem] font-semibold tracking-[-0.06em] text-slate-950 md:text-[2rem]">
                {activeStep.title}
              </h1>
            </div>
          </div>
        </div>
      </div>

      <form
        action={completeWorkspaceOnboardingAction}
        className="flex min-h-0 flex-1 flex-col"
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="returnTo" value={returnTo} />

        <div className="bg-[#f1f3f5] px-5 py-6 md:px-8 md:py-4">
          <div className="mx-auto w-full max-w-[760px]">
            <div className={step === 0 ? "block" : "hidden"}>
              <section className="space-y-4 md:space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-sm font-semibold text-slate-950">Nombre del negocio</span>
                    <Input
                      name="businessName"
                      placeholder="Ej. Clinica Dental Sonrisa"
                      defaultValue={defaultBusinessName}
                      required
                      className="h-16 rounded-[28px] border border-white bg-white px-6 text-[15px] text-slate-950 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] placeholder:text-slate-400 focus-visible:border-[var(--primary)] focus-visible:ring-[color-mix(in_srgb,var(--primary)_16%,white)]"
                    />
                  </label>

                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-sm font-semibold text-slate-950">Tipo de negocio</span>
                    <Input
                      name="businessType"
                      placeholder="Ej. Restaurante, clinica, inmobiliaria"
                      required
                      className="h-16 rounded-[28px] border border-white bg-white px-6 text-[15px] text-slate-950 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] placeholder:text-slate-400 focus-visible:border-[var(--primary)] focus-visible:ring-[color-mix(in_srgb,var(--primary)_16%,white)]"
                    />
                  </label>
                </div>
              </section>
            </div>

            <div className={step === 1 ? "block" : "hidden"}>
              <section className="space-y-4 md:space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-semibold text-slate-950">Pais</span>
                    <Input
                      name="country"
                      placeholder="Ej. Colombia"
                      required
                      className="h-16 rounded-[28px] border border-white bg-white px-6 text-[15px] text-slate-950 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] placeholder:text-slate-400 focus-visible:border-[var(--primary)] focus-visible:ring-[color-mix(in_srgb,var(--primary)_16%,white)]"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-semibold text-slate-950">Ciudad</span>
                    <Input
                      name="city"
                      placeholder="Ej. Bogota"
                      required
                      className="h-16 rounded-[28px] border border-white bg-white px-6 text-[15px] text-slate-950 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.14)] placeholder:text-slate-400 focus-visible:border-[var(--primary)] focus-visible:ring-[color-mix(in_srgb,var(--primary)_16%,white)]"
                    />
                  </label>
                </div>
              </section>
            </div>

            <div className={step === 2 ? "block" : "hidden"}>
              <section className="space-y-4 md:space-y-5">
                <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.18)]">
                  <div className="space-y-4">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--primary)_18%,white)] bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">
                      Paso final
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
                        Tu contexto inicial quedara listo
                      </h2>
                      <p className="max-w-[62ch] text-sm leading-6 text-slate-600">
                        Al continuar crearemos tu espacio de trabajo y guardaremos la informacion base del negocio para los modulos del cliente.
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-[#fbfcff] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Panel cliente
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          Se crea tu negocio y el espacio de trabajo principal.
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-[#fbfcff] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Marketing IA
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          Tendras el contexto base listo para completar la estrategia.
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-[#fbfcff] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Siguiente paso
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          Podras crear agentes y avanzar con los demas modulos.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.92)] px-5 py-4 backdrop-blur md:px-8">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-w-[120px] rounded-2xl"
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
            disabled={step === 0}
          >
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>

          {step < steps.length - 1 ? (
            <Button
              type="button"
              size="lg"
              className="min-w-[186px] rounded-2xl"
              onClick={() => setStep((current) => Math.min(current + 1, steps.length - 1))}
            >
              Continuar
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="lg" className="min-w-[186px] rounded-2xl">
              Continuar
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
