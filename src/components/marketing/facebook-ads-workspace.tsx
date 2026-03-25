import Image from "next/image";
import Link from "next/link";
import { ImagePlus, Megaphone, Sparkles } from "lucide-react";
import { FacebookAdsForm } from "@/components/marketing/facebook-ads-form";
import { Card } from "@/components/ui/card";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import type { FacebookAdsFormInput } from "@/lib/marketing";
import { parseFacebookAdsOutput } from "@/lib/marketing";
import type { MarketingGenerationRecord, MarketingGenerationStatus } from "@/lib/marketing-store";

type MarketingHistoryRecord = Pick<
  MarketingGenerationRecord,
  "id" | "status" | "provider" | "imageUrl" | "errorMessage" | "createdAt" | "updatedAt" | "input" | "output"
>;

type FacebookAdsWorkspaceProps = {
  workspaceName: string;
  okMessage?: string;
  errorMessage?: string;
  history: MarketingHistoryRecord[];
  selectedHistoryId?: string;
};

const statusLabelMap: Record<MarketingGenerationStatus, string> = {
  PENDING: "Procesando",
  SUCCEEDED: "Completado",
  FAILED: "Con observaciones",
};

const statusToneMap: Record<MarketingGenerationStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-200",
  SUCCEEDED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  FAILED: "bg-rose-50 text-rose-700 ring-rose-200",
};

function isFacebookAdsInput(value: unknown): value is FacebookAdsFormInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.productName === "string" && typeof candidate.callToAction === "string";
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function FacebookAdsWorkspace({
  workspaceName,
  okMessage,
  errorMessage,
  history,
  selectedHistoryId,
}: FacebookAdsWorkspaceProps) {
  const selectedHistory =
    history.find((item) => item.id === selectedHistoryId) ??
    history[0] ??
    null;
  const selectedInput = isFacebookAdsInput(selectedHistory?.input) ? selectedHistory.input : null;
  const selectedOutput = parseFacebookAdsOutput(selectedHistory?.output);

  return (
    <section className="w-full space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Marketing IA actualizado"
        errorTitle="No pudimos completar la generacion"
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
              <Megaphone className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-semibold tracking-[-0.04em] text-slate-950 md:text-2xl">
              Generador Facebook Ads
            </h1>
          </div>
          <p className="max-w-3xl text-sm leading-7 text-slate-600">
            Crea 3 variaciones de copy y una imagen publicitaria para {workspaceName} usando OpenAI.
          </p>
        </div>

        <Link
          href="/cliente/marketing-ia"
          className="inline-flex h-11 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Volver al modulo
        </Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="space-y-5 border border-[rgba(148,163,184,0.14)] bg-white p-5">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-950">Configura el anuncio</h2>
            <p className="text-sm text-slate-600">
              Mientras mas claro seas con la oferta y la direccion visual, mejor saldra el creativo.
            </p>
          </div>

          <FacebookAdsForm
            key={selectedHistoryId || "facebook-ads-draft"}
            initialValues={selectedInput}
            okMessage={okMessage}
            selectedHistoryId={selectedHistoryId}
          />
        </Card>

        <div className="space-y-5">
          <Card className="space-y-4 border border-[rgba(148,163,184,0.14)] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-slate-950">Resultado</h2>
                <p className="text-sm text-slate-600">
                  {selectedHistory
                    ? `Seleccion actual: ${formatDate(selectedHistory.createdAt)}`
                    : "Aun no hay generaciones guardadas."}
                </p>
              </div>

              {selectedHistory ? (
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${statusToneMap[selectedHistory.status]}`}
                >
                  {statusLabelMap[selectedHistory.status]}
                </span>
              ) : null}
            </div>

            {selectedHistory ? (
              <>
                {selectedHistory.errorMessage ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {selectedHistory.errorMessage}
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Primary text</p>
                        <div className="mt-3 space-y-3">
                          {selectedOutput?.primaryTexts.map((item, index) => (
                            <div key={`${item}-${index}`} className="rounded-2xl bg-white px-3 py-3 text-sm leading-6 text-slate-700">
                              {item}
                            </div>
                          )) ?? <p className="text-sm text-slate-500">Sin copy disponible.</p>}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Headlines</p>
                          <div className="mt-3 space-y-3">
                            {selectedOutput?.headlines.map((item, index) => (
                              <div key={`${item}-${index}`} className="rounded-2xl bg-white px-3 py-3 text-sm leading-6 text-slate-700">
                                {item}
                              </div>
                            )) ?? <p className="text-sm text-slate-500">Sin headlines disponibles.</p>}
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Descriptions</p>
                          <div className="mt-3 space-y-3">
                            {selectedOutput?.descriptions.map((item, index) => (
                              <div key={`${item}-${index}`} className="rounded-2xl bg-white px-3 py-3 text-sm leading-6 text-slate-700">
                                {item}
                              </div>
                            )) ?? <p className="text-sm text-slate-500">Sin descriptions disponibles.</p>}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">CTA sugerido</p>
                      <p className="mt-3 text-sm font-medium text-slate-900">
                        {selectedOutput?.suggestedCallToAction ?? "Sin CTA sugerido."}
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Prompt visual interno</p>
                      <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">
                        {selectedOutput?.imagePrompt ?? "Sin prompt visual disponible."}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] p-4">
                      <div className="flex items-center gap-2">
                        <ImagePlus className="h-4 w-4 text-[var(--primary)]" />
                        <p className="text-sm font-semibold text-slate-900">Imagen generada</p>
                      </div>
                      <div className="mt-4 overflow-hidden rounded-[24px] border border-[rgba(148,163,184,0.12)] bg-slate-100">
                        {selectedHistory.imageUrl ? (
                          <Image
                            src={selectedHistory.imageUrl}
                            alt="Creativo generado para Facebook Ads"
                            width={1024}
                            height={1024}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex min-h-[320px] items-center justify-center px-6 text-center text-sm text-slate-500">
                            Esta generacion aun no tiene imagen disponible.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4 text-sm text-slate-600">
                      <p>
                        Proveedor: <span className="font-medium text-slate-900">{selectedHistory.provider}</span>
                      </p>
                      <p className="mt-2">
                        Ultima actualizacion: <span className="font-medium text-slate-900">{formatDate(selectedHistory.updatedAt)}</span>
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-[24px] border border-dashed border-[rgba(148,163,184,0.22)] bg-slate-50 px-4 py-12 text-center">
                <div className="mx-auto max-w-md space-y-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <h3 className="text-lg font-semibold text-slate-950">Genera tu primer creativo</h3>
                  <p className="text-sm leading-6 text-slate-600">
                    Aqui veras tus copys, el prompt visual y la imagen publicitaria una vez completes el formulario.
                  </p>
                </div>
              </div>
            )}
          </Card>

          <Card className="space-y-4 border border-[rgba(148,163,184,0.14)] bg-white p-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-950">Historial reciente</h2>
              <p className="text-sm text-slate-600">Cada generacion se guarda por workspace para reutilizarla despues.</p>
            </div>

            <div className="space-y-3">
              {history.length > 0 ? (
                history.map((item) => {
                  const input = isFacebookAdsInput(item.input) ? item.input : null;
                  const isSelected = selectedHistory?.id === item.id;

                  return (
                    <Link
                      key={item.id}
                      href={`/cliente/marketing-ia/facebook-ads?historyId=${item.id}`}
                      className={`block rounded-[24px] border px-4 py-4 transition ${
                        isSelected
                          ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_6%,white)]"
                          : "border-[rgba(148,163,184,0.14)] bg-white hover:border-[var(--primary)]/30"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-950">
                            {input?.productName || "Generacion de Facebook Ads"}
                          </p>
                          <p className="text-xs text-slate-500">{formatDate(item.createdAt)}</p>
                        </div>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${statusToneMap[item.status]}`}
                        >
                          {statusLabelMap[item.status]}
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm text-slate-600">
                        {input
                          ? `${input.campaignObjective} - ${input.offerDetails}`
                          : "Sin entrada registrada."}
                      </p>
                    </Link>
                  );
                })
              ) : (
                <div className="rounded-[24px] border border-dashed border-[rgba(148,163,184,0.22)] bg-slate-50 px-4 py-8 text-sm text-slate-600">
                  Todavia no hay historial de Marketing IA en este workspace.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
