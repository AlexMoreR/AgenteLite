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
  const selectedProductName = selectedInput?.productName?.trim() || "Creativo de Facebook Ads";
  const hasGeneratedImage = Boolean(selectedHistory?.imageUrl);

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

          <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Anuncio activo</p>
                <p className="text-base font-semibold text-slate-950">{selectedProductName}</p>
              </div>
              {selectedHistory ? (
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${statusToneMap[selectedHistory.status]}`}
                >
                  {statusLabelMap[selectedHistory.status]}
                </span>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Formato</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{selectedInput?.aspectRatio ?? "1:1"}</p>
              </div>
              <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Objetivo</p>
                <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-900">
                  {selectedInput?.campaignObjective ?? "Aun no configurado"}
                </p>
              </div>
              <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Imagen base</p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {selectedInput?.referenceImageUrl ? "Cargada" : "No agregada"}
                </p>
              </div>
              <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Resultado</p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {hasGeneratedImage ? "Imagen lista" : "Pendiente por generar"}
                </p>
              </div>
            </div>
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

                <div className="space-y-4">
                  <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] p-4 md:p-5">
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
                        <div className="flex min-h-[360px] items-center justify-center px-6 text-center text-sm text-slate-500">
                          Esta generacion aun no tiene imagen disponible.
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-3 text-sm text-slate-600">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Proveedor</p>
                        <p className="mt-1 font-medium text-slate-900">{selectedHistory.provider}</p>
                      </div>
                      <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-3 text-sm text-slate-600">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">CTA sugerido</p>
                        <p className="mt-1 font-medium text-slate-900">
                          {selectedOutput?.suggestedCallToAction ?? "Sin CTA sugerido"}
                        </p>
                      </div>
                      <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-white px-4 py-3 text-sm text-slate-600">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Ultima actualizacion
                        </p>
                        <p className="mt-1 font-medium text-slate-900">{formatDate(selectedHistory.updatedAt)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
                    <div className="space-y-4">
                      {selectedInput?.referenceImageUrl ? (
                        <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Imagen base
                            </p>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Referencia
                            </span>
                          </div>
                          <div className="mt-3 overflow-hidden rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-100">
                            <Image
                              src={selectedInput.referenceImageUrl}
                              alt="Imagen base del producto"
                              width={800}
                              height={800}
                              className="h-48 w-full object-cover"
                            />
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Prompt visual interno</p>
                        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">
                          {selectedOutput?.imagePrompt ?? "Sin prompt visual disponible."}
                        </p>
                      </div>
                    </div>

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
                          ? `${input.aspectRatio} - ${input.campaignObjective} - ${input.offerDetails}`
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
