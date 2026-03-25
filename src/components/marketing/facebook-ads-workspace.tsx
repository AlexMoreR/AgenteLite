import Image from "next/image";
import Link from "next/link";
import { Captions, FileText, ImagePlus, Megaphone, Sparkles, TextQuote, Trash2 } from "lucide-react";
import { deleteMarketingHistoryAction } from "@/app/actions/marketing-actions";
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

type FacebookAdsInputWithReference = FacebookAdsFormInput & {
  referenceImageUrl?: string | null;
};

function isFacebookAdsInput(value: unknown): value is FacebookAdsInputWithReference {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.productName === "string" &&
    typeof candidate.callToAction === "string" &&
    typeof candidate.aspectRatio === "string"
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function FacebookAdsWorkspace({
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
  const selectedProductName = selectedInput?.productName?.trim() || "Creativo de imagenes ads";

  return (
    <section className="w-full space-y-6">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Marketing IA actualizado"
        errorTitle="No pudimos completar la generacion"
      />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-5 py-4 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.35)]">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--primary)_14%,white)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_10%,white)_0%,#ffffff_100%)] text-[var(--primary)] shadow-[0_16px_34px_-24px_color-mix(in_srgb,var(--primary)_45%,black)]">
              <Megaphone className="h-[18px] w-[18px]" />
            </div>
            <h1 className="text-[1.15rem] font-semibold tracking-[-0.05em] text-slate-950 md:text-[1.35rem]">
              Generador de Imagenes Ads
            </h1>
          </div>
        </div>

        <FacebookAdsForm
          key={`facebook-ads-header-${selectedHistoryId || "draft"}`}
          initialValues={selectedInput}
          okMessage={okMessage}
          selectedHistoryId={selectedHistoryId}
          triggerLabel="Generar anuncio"
          hideHelperText
          triggerClassName="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)]"
        />
      </div>

      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="space-y-4 rounded-[30px] border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] p-5 shadow-[0_30px_80px_-58px_rgba(15,23,42,0.42)]">
            {selectedHistory ? (
              <>
                {selectedHistory.errorMessage ? (
                  <div className="rounded-[22px] border border-rose-200/90 bg-[linear-gradient(180deg,#fff5f5_0%,#fff8f8_100%)] px-4 py-3 text-sm text-rose-700">
                    {selectedHistory.errorMessage}
                  </div>
                ) : null}

                <div className="p-1 md:p-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <ImagePlus className="h-4 w-4 text-[var(--primary)]" />
                        <p className="text-sm font-semibold text-slate-900">Imagen generada</p>
                      </div>
                      <p className="text-sm text-slate-600">
                        Vista principal del creativo para {selectedProductName.toLowerCase()}.
                      </p>
                    </div>
                    <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] px-3 py-1 text-xs font-semibold text-[var(--primary)]">
                      {selectedInput?.aspectRatio ?? "1:1"}
                    </span>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-[26px] border border-[rgba(15,23,42,0.08)] bg-[linear-gradient(180deg,#eff3f8_0%,#e5ebf2_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    {selectedHistory.imageUrl ? (
                      <Image
                        src={selectedHistory.imageUrl}
                        alt="Creativo generado para imagenes ads"
                        width={1024}
                        height={1024}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex min-h-[320px] items-center justify-center px-6 text-center text-sm text-slate-500">
                        Esta generacion aun no tiene imagen disponible.
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-[28px] border border-dashed border-[rgba(148,163,184,0.22)] bg-[linear-gradient(180deg,#f8fbff_0%,#f4f8fc_100%)] px-4 py-12 text-center">
                <div className="mx-auto max-w-md space-y-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-[18px] border border-[color-mix(in_srgb,var(--primary)_14%,white)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_10%,white)_0%,#ffffff_100%)] text-[var(--primary)]">
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

          <div className="space-y-4">
            {selectedHistory ? (
              <div className="rounded-[28px] border border-[rgba(148,163,184,0.12)] bg-[radial-gradient(circle_at_top,rgba(0,76,255,0.05),transparent_34%),linear-gradient(180deg,#f8fbff_0%,#f3f7fb_100%)] p-4 shadow-[0_18px_44px_-40px_rgba(15,23,42,0.28)]">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                    <TextQuote className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-semibold text-slate-950">Texto principal</p>
                </div>
                <div className="mt-4 rounded-[24px] border border-[rgba(148,163,184,0.08)] bg-white/90 px-5 py-5 text-[15px] leading-8 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                  {selectedOutput?.primaryText ?? "Sin copy disponible."}
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                        <Captions className="h-3.5 w-3.5" />
                      </span>
                      <p className="text-sm font-semibold text-slate-900">Titulo</p>
                    </div>
                    <div className="mt-3 rounded-[22px] border border-[rgba(148,163,184,0.08)] bg-white/90 px-4 py-4 text-sm leading-7 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                      {selectedOutput?.headline ?? "Sin titulo disponible."}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                        <FileText className="h-3.5 w-3.5" />
                      </span>
                      <p className="text-sm font-semibold text-slate-900">Descripcion</p>
                    </div>
                    <div className="mt-3 rounded-[22px] border border-[rgba(148,163,184,0.08)] bg-white/90 px-4 py-4 text-sm leading-7 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                      {selectedOutput?.description ?? "Sin descripcion disponible."}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedInput?.referenceImageUrl ? (
              <div className="rounded-[26px] border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fcfdff_100%)] p-4 shadow-[0_20px_50px_-44px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Imagen base
                  </p>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Referencia
                  </span>
                </div>
                <div className="mt-3 overflow-hidden rounded-[22px] border border-[rgba(148,163,184,0.1)] bg-[linear-gradient(180deg,#eff3f8_0%,#e5ebf2_100%)]">
                  <Image
                    src={selectedInput.referenceImageUrl}
                    alt="Imagen base del producto"
                    width={800}
                    height={800}
                    className="h-56 w-full object-contain"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <Card className="space-y-4 rounded-[30px] border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] p-5 shadow-[0_28px_70px_-56px_rgba(15,23,42,0.34)]">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-950">Historial reciente</h2>
          </div>

          <div className="space-y-3">
            {history.length > 0 ? (
              history.map((item) => {
                const input = isFacebookAdsInput(item.input) ? item.input : null;
                const isSelected = selectedHistory?.id === item.id;

                return (
                  <div
                    key={item.id}
                    className={`rounded-[24px] border px-4 py-4 shadow-[0_16px_40px_-38px_rgba(15,23,42,0.28)] transition ${
                      isSelected
                        ? "border-[color-mix(in_srgb,var(--primary)_32%,white)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_7%,white)_0%,#ffffff_100%)]"
                        : "border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fcfdff_100%)] hover:border-[var(--primary)]/26 hover:bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <Link
                        href={`/cliente/marketing-ia/facebook-ads?historyId=${item.id}`}
                        className="min-w-0 flex-1 space-y-1"
                      >
                        <p className="text-sm font-semibold text-slate-950">
                          {input?.productName || "Generacion de imagenes ads"}
                        </p>
                        <p className="text-xs text-slate-500">{formatDate(item.createdAt)}</p>
                      </Link>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${statusToneMap[item.status]}`}
                        >
                          {statusLabelMap[item.status]}
                        </span>
                        <form action={deleteMarketingHistoryAction}>
                          <input type="hidden" name="historyId" value={item.id} />
                          <button
                            type="submit"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200/90 bg-white/90 text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                            aria-label="Eliminar historial"
                            title="Eliminar historial"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </form>
                      </div>
                    </div>
                    <Link href={`/cliente/marketing-ia/facebook-ads?historyId=${item.id}`} className="mt-3 block">
                      <p className="line-clamp-2 text-sm text-slate-600">
                        {input
                          ? `${input.aspectRatio} - ${input.marketingTemplate} - ${input.visualStyle}`
                          : "Sin entrada registrada."}
                      </p>
                    </Link>
                  </div>
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
    </section>
  );
}
