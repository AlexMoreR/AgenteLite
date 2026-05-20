"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Eye, FileText, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveAgentKnowledgeProductInstructionAction } from "@/app/actions/agent-actions";

type FlowOption = {
  id: string;
  title: string;
  badge: string;
  intent: string;
  description: string;
};

type FunnelFields = {
  opening: string;
  qualification: string;
  presentation: string;
  faq: string;
  closing: string;
};

type ProductActivationMode = "default" | "ia" | "chatbot";
type ProductActivationMatchType = "exacta" | "contiene";

function buildFunnelTemplate(productName: string) {
  const safeName = productName.trim() || "el producto";
  return [
    "EMBUDO DE VENTAS",
    "",
    "1. Apertura",
    `- Presenta ${safeName} de forma breve y cercana.`,
    "- Haz una sola pregunta de calificacion para entender la necesidad.",
    "",
    "2. Calificacion",
    "- Identifica el uso real, el espacio y la urgencia de compra.",
    "- Si el cliente ya dijo lo que necesita, avanza sin repetir.",
    "",
    "3. Presentacion",
    "- Resalta solo los beneficios y datos que ayuden a vender.",
    "- No inventes informacion ni adelantes pasos.",
    "",
    "4. Preguntas frecuentes / objeciones",
    "- Responde precio, peso, medidas, color, envio o disponibilidad segun la base.",
    "- Si no existe el dato, deriva o confirma.",
    "",
    "5. Cierre",
    "- Pide el siguiente paso concreto: fotos, reserva, color o asesor.",
  ].join("\n");
}

function parseProductActivationMode(instructions: string) {
  const match = instructions.match(/ACTIVACION:\s*(default|ia|chatbot)/i);
  return (match?.[1]?.toLowerCase() as ProductActivationMode | undefined) ?? "default";
}

function parseActivationKeywords(instructions: string) {
  const match = instructions.match(/PALABRAS CLAVE:\s*([^\n]+)/i);
  if (!match?.[1]) {
    return [] as string[];
  }

  return match[1]
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseActivationMatchType(instructions: string) {
  const match = instructions.match(/COINCIDENCIA:\s*(exacta|contiene)/i);
  return (match?.[1]?.toLowerCase() as ProductActivationMatchType | undefined) ?? "exacta";
}

function extractFunnelNotes(instructions: string) {
  const trimmed = instructions.trim();
  if (!trimmed) {
    return "";
  }

  const structuredPrefix = /^(Activacion:|Apertura:|Calificacion:|Presentacion:|Preguntas frecuentes \/ objeciones:|Cierre:)/im;
  if (!structuredPrefix.test(trimmed)) {
    return trimmed;
  }

  const notesMatch = trimmed.match(/Notas heredadas:\s*([\s\S]*)$/i);
  return notesMatch?.[1]?.trim() ?? "";
}

function composeFunnelInstructions(
  fields: FunnelFields,
  notes: string,
  activationMode: ProductActivationMode,
  activationMatchType: ProductActivationMatchType,
  activationKeywords: string[],
) {
  const blocks = [
    `Activacion: ${activationMode}`,
    activationMode === "chatbot" ? `Coincidencia: ${activationMatchType}` : null,
    activationMode === "chatbot" && activationKeywords.length > 0 ? `Palabras clave: ${activationKeywords.join(", ")}` : null,
    fields.opening.trim() ? `Apertura: ${fields.opening.trim()}` : null,
    fields.qualification.trim() ? `Calificacion: ${fields.qualification.trim()}` : null,
    fields.presentation.trim() ? `Presentacion: ${fields.presentation.trim()}` : null,
    fields.faq.trim() ? `Preguntas frecuentes / objeciones: ${fields.faq.trim()}` : null,
    fields.closing.trim() ? `Cierre: ${fields.closing.trim()}` : null,
    notes.trim() ? `Notas heredadas: ${notes.trim()}` : null,
  ].filter(Boolean);

  return blocks.join("\n\n");
}

type KnowledgeProductInstructionModalProps = {
  agentId: string;
  productId: string;
  productName: string;
  categoryName: string;
  description: string | null;
  price: string;
  thumbnailUrl: string | null;
  instructions: string;
  funnelOpening: string | null;
  funnelQualification: string | null;
  funnelPresentation: string | null;
  funnelFaq: string | null;
  funnelClosing: string | null;
  followUpFlowId: string | null;
  isSelected: boolean;
  flows: FlowOption[];
};

function SubmitButton() {
  return (
    <button
      type="submit"
      className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
    >
      Guardar embudo
    </button>
  );
}

export function KnowledgeProductInstructionModal({
  agentId,
  productId,
  productName,
  categoryName,
  description,
  price,
  thumbnailUrl,
  instructions,
  funnelOpening,
  funnelQualification,
  funnelPresentation,
  funnelFaq,
  funnelClosing,
  followUpFlowId,
  isSelected,
  flows,
}: KnowledgeProductInstructionModalProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"activation" | "funnel" | "preview">("activation");
  const [expandedStep, setExpandedStep] = useState<keyof FunnelFields | null>("opening");
  const [activationMode, setActivationMode] = useState<ProductActivationMode>(() => parseProductActivationMode(instructions));
  const [activationMatchType, setActivationMatchType] = useState<ProductActivationMatchType>(() => parseActivationMatchType(instructions));
  const [activationKeywords, setActivationKeywords] = useState<string[]>(() => parseActivationKeywords(instructions));
  const [activationKeywordDraft, setActivationKeywordDraft] = useState("");
  const [instructionValue, setInstructionValue] = useState(() => extractFunnelNotes(instructions));
  const [funnelFields, setFunnelFields] = useState<FunnelFields>({
    opening: funnelOpening ?? "",
    qualification: funnelQualification ?? "",
    presentation: funnelPresentation ?? "",
    faq: funnelFaq ?? "",
    closing: funnelClosing ?? "",
  });
  const [followUpFlowValue, setFollowUpFlowValue] = useState(followUpFlowId ?? "");
  const [slashSearch, setSlashSearch] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const normalizedQuery = slashSearch?.query.trim().toLowerCase() ?? "";
  const composedInstructions = useMemo(
    () => composeFunnelInstructions(funnelFields, instructionValue, activationMode, activationMatchType, activationKeywords),
    [activationKeywords, activationMatchType, activationMode, funnelFields, instructionValue],
  );
  const filteredFlows = useMemo(() => {
    if (!slashSearch) {
      return [];
    }

    return flows
      .filter((flow) => {
        if (!normalizedQuery) {
          return true;
        }

        return `${flow.title} ${flow.intent} ${flow.description} ${flow.badge}`.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 6);
  }, [flows, normalizedQuery, slashSearch]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const updateSlashSearch = (nextValue: string, caretPosition: number | null) => {
    if (caretPosition === null) {
      setSlashSearch(null);
      return;
    }

    const beforeCaret = nextValue.slice(0, caretPosition);
    const slashIndex = beforeCaret.lastIndexOf("/");
    if (slashIndex < 0) {
      setSlashSearch(null);
      return;
    }

    const previousCharacter = slashIndex > 0 ? beforeCaret[slashIndex - 1] : "";
    const query = beforeCaret.slice(slashIndex + 1);
    if ((previousCharacter && !/\s/.test(previousCharacter)) || query.includes("\n")) {
      setSlashSearch(null);
      return;
    }

    setSlashSearch({
      start: slashIndex,
      end: caretPosition,
      query,
    });
  };

  const insertFlowReference = (flow: FlowOption) => {
    if (!slashSearch) {
      return;
    }

    const reference = `/${flow.title}`;
    const prefix = instructionValue.slice(0, slashSearch.start);
    const suffix = instructionValue.slice(slashSearch.end);
    const needsSpace = suffix.startsWith(" ") || suffix.startsWith("\n") || suffix.length === 0 ? "" : " ";
    const nextValue = `${prefix}${reference}${needsSpace}${suffix}`;
    const nextCaret = prefix.length + reference.length + needsSpace.length;

    setInstructionValue(nextValue);
    setSlashSearch(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const flowTitleSet = useMemo(() => new Set(flows.map((f) => f.title)), [flows]);
  const funnelSteps = useMemo(
    () => [
      {
        key: "opening" as const,
        emoji: "👋",
        title: "Paso 1. Apertura",
        subtitle: "Presentación inicial y pregunta de arranque.",
        placeholder: "Qué debe decir el agente al empezar.",
        value: funnelFields.opening,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, opening: nextValue })),
      },
      {
        key: "qualification" as const,
        emoji: "🧭",
        title: "Paso 2. Calificación",
        subtitle: "Pregunta para entender la necesidad real.",
        placeholder: "Qué pregunta debe hacer para entender la necesidad.",
        value: funnelFields.qualification,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, qualification: nextValue })),
      },
      {
        key: "presentation" as const,
        emoji: "💡",
        title: "Paso 3. Presentación",
        subtitle: "Beneficios y datos que ayudan a vender.",
        placeholder: "Qué beneficios o datos del producto debe mostrar.",
        value: funnelFields.presentation,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, presentation: nextValue })),
      },
      {
        key: "faq" as const,
        emoji: "❓",
        title: "Paso 4. FAQ / objeciones",
        subtitle: "Respuestas a dudas frecuentes y objeciones.",
        placeholder: "Precio, peso, medidas, color, envío, disponibilidad.",
        value: funnelFields.faq,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, faq: nextValue })),
      },
      {
        key: "closing" as const,
        emoji: "✅",
        title: "Paso 5. Cierre",
        subtitle: "Siguiente paso para avanzar la venta.",
        placeholder: "Qué debe hacer para avanzar: fotos, reserva, color, visita o asesor.",
        value: funnelFields.closing,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, closing: nextValue })),
      },
    ],
    [funnelFields],
  );

  const renderPreview = (text: string) => {
    if (!text.trim()) {
      return (
      <p className="text-sm text-slate-400">Sin embudo guardado. El agente usara solo la informacion base del producto.</p>
      );
    }
    const parts = text.split(/(\/\S+)/g);
    return (
      <p className="text-sm leading-7 text-slate-700 whitespace-pre-wrap">
        {parts.map((part, i) => {
          if (part.startsWith("/")) {
            const title = part.slice(1);
            const known = flowTitleSet.has(title);
            return (
              <span
                key={i}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                  known
                    ? "bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]"
                    : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                }`}
              >
                {part}
              </span>
            );
          }
          return part;
        })}
      </p>
    );
  };

  return (
    <>
      <button
      type="button"
      onClick={() => {
        setInstructionValue(extractFunnelNotes(instructions));
        setActivationMode(parseProductActivationMode(instructions));
        setActivationMatchType(parseActivationMatchType(instructions));
        setActivationKeywords(parseActivationKeywords(instructions));
        setActivationKeywordDraft("");
        setFunnelFields({
          opening: funnelOpening ?? "",
          qualification: funnelQualification ?? "",
          presentation: funnelPresentation ?? "",
          faq: funnelFaq ?? "",
          closing: funnelClosing ?? "",
        });
        setFollowUpFlowValue(followUpFlowId ?? "");
        setSlashSearch(null);
        setView("activation");
        setOpen(true);
      }}
        className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--primary)_14%,white)]"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[15px] font-semibold text-slate-900">{productName}</p>
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
            {categoryName}
          </span>
          {isSelected ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
              Seleccionado
            </span>
          ) : null}
          {instructions.trim() ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100">
              <FileText className="h-3 w-3" />
              Embudo
            </span>
          ) : null}
        </div>
      </button>

      {portalTarget && open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setOpen(false);
                }
              }}
            >
              <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_32px_90px_-42px_rgba(15,23,42,0.55)]">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--primary)]">Conocimiento del producto</p>
                    <h2 id={titleId} className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                      {productName}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                    aria-label="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form action={saveAgentKnowledgeProductInstructionAction} className="min-h-0 overflow-y-auto px-5 py-5">
                  <input type="hidden" name="agentId" value={agentId} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="activationMode" value={activationMode} />
                  <input type="hidden" name="activationMatchType" value={activationMatchType} />
                  <input type="hidden" name="activationKeywords" value={activationKeywords.join(", ")} />
                  <input type="hidden" name="followUpFlowId" value={followUpFlowValue} />
                  <input type="hidden" name="funnelOpening" value={funnelFields.opening} />
                  <input type="hidden" name="funnelQualification" value={funnelFields.qualification} />
                  <input type="hidden" name="funnelPresentation" value={funnelFields.presentation} />
                  <input type="hidden" name="funnelFaq" value={funnelFields.faq} />
                  <input type="hidden" name="funnelClosing" value={funnelFields.closing} />
                  <input type="hidden" name="instructions" value={instructionValue} />

                  <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit mb-4">
                    <button
                      type="button"
                      onClick={() => setView("activation")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        view === "activation"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      Activa
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("funnel")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        view === "funnel"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <Pencil className="h-3 w-3" />
                      Embudo
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("preview")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        view === "preview"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </button>
                  </div>

                  {view === "activation" ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Activa</p>
                            <p className="mt-1 text-xs leading-5 text-slate-600">
                              Define como se activa este producto: por defecto, por IA o por palabras clave.
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-slate-600 ring-1 ring-slate-200">
                            {activationMode === "chatbot" ? "CHATBOT" : activationMode === "ia" ? "IA" : "DEFAULT"}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          {[
                            {
                              value: "default" as const,
                              title: "Por defecto",
                              description: "Usa título, precio, descripción y categoría.",
                            },
                            {
                              value: "ia" as const,
                              title: "IA",
                              description: "Detecta la intención del embudo.",
                            },
                            {
                              value: "chatbot" as const,
                              title: "CHATBOT",
                              description: "Activa por palabras clave.",
                            },
                          ].map((option) => {
                            const isSelected = activationMode === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                  setActivationMode(option.value);
                                  if (option.value !== "chatbot") {
                                    setActivationKeywords([]);
                                    setActivationKeywordDraft("");
                                    setActivationMatchType("exacta");
                                  }
                                }}
                                className={`rounded-2xl border p-4 text-left transition ${
                                  isSelected
                                    ? "border-[color-mix(in_srgb,var(--primary)_35%,white)] bg-[color-mix(in_srgb,var(--primary)_7%,white)]"
                                    : "border-slate-200 bg-white hover:border-slate-300"
                                }`}
                              >
                                <p className="text-sm font-semibold text-slate-950">{option.title}</p>
                                <p className="mt-1 text-xs leading-5 text-slate-600">{option.description}</p>
                              </button>
                            );
                          })}
                        </div>

                        {activationMode === "chatbot" ? (
                          <div className="mt-4 space-y-3">
                            <label className="block">
                              <span className="text-sm font-medium text-slate-900">Tipo de coincidencia</span>
                              <select
                                value={activationMatchType}
                                onChange={(event) =>
                                  setActivationMatchType(event.target.value === "contiene" ? "contiene" : "exacta")
                                }
                                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
                              >
                                <option value="exacta">Exacta</option>
                                <option value="contiene">Contiene</option>
                              </select>
                            </label>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-slate-900">Palabras clave</span>
                              <span className="text-xs text-slate-500">{activationKeywords.length}/20</span>
                            </div>
                            <div className="flex gap-2">
                              <Input
                                value={activationKeywordDraft}
                                onChange={(event) => setActivationKeywordDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    const keyword = activationKeywordDraft.trim();
                                    if (!keyword) {
                                      return;
                                    }
                                    setActivationKeywords((current) => {
                                      if (current.length >= 20 || current.some((existing) => existing.toLowerCase() === keyword.toLowerCase())) {
                                        return current;
                                      }
                                      return [...current, keyword];
                                    });
                                    setActivationKeywordDraft("");
                                  }
                                }}
                                placeholder="Escribe una palabra o frase y presiona Enter"
                              />
                              <Button
                                type="button"
                                className="h-11 shrink-0 border-[var(--primary)] bg-[var(--primary)] px-4 text-white hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)] hover:text-white"
                                aria-label="Guardar palabra clave"
                                onClick={() => {
                                  const keyword = activationKeywordDraft.trim();
                                  if (!keyword) {
                                    return;
                                  }
                                  setActivationKeywords((current) => {
                                    if (current.length >= 20 || current.some((existing) => existing.toLowerCase() === keyword.toLowerCase())) {
                                      return current;
                                    }
                                    return [...current, keyword];
                                  });
                                  setActivationKeywordDraft("");
                                }}
                              >
                                <Save className="h-4 w-4" />
                              </Button>
                            </div>
                            {activationKeywords.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {activationKeywords.map((keyword) => (
                                  <button
                                    key={keyword}
                                    type="button"
                                    onClick={() => setActivationKeywords((current) => current.filter((item) => item !== keyword))}
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                                  >
                                    {keyword}
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {view === "funnel" ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">Embudo:</span>
                        <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                          🪜 Paso a paso
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3">
                        {funnelSteps.map((step) => {
                          const isExpanded = expandedStep === step.key;
                          return (
                            <div key={step.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_34px_-28px_rgba(15,23,42,0.35)]">
                              <button
                                type="button"
                                onClick={() => setExpandedStep(isExpanded ? null : step.key)}
                                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">{step.emoji}</span>
                                    <span className="text-sm font-semibold text-slate-900">{step.title}</span>
                                  </div>
                                  <p className="mt-1 text-xs leading-5 text-slate-500">{step.subtitle}</p>
                                </div>
                                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              </button>

                              {isExpanded ? (
                                <div className="border-t border-slate-100 px-4 py-4">
                                  <textarea
                                    value={step.value}
                                    onChange={(event) => step.onChange(event.target.value)}
                                    rows={3}
                                    placeholder={step.placeholder}
                                    className="min-h-24 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
                                  />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {slashSearch ? (
                        <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.35)]">
                          {flows.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-slate-500">Todavia no hay flujos creados.</div>
                          ) : filteredFlows.length > 0 ? (
                            filteredFlows.map((flow) => (
                              <button
                                key={flow.id}
                                type="button"
                                onClick={() => insertFlowReference(flow)}
                                className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
                              >
                                <span className="mt-0.5 rounded-full bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                                  {flow.badge}
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold text-slate-900">/{flow.title}</span>
                                  <span className="line-clamp-1 block text-xs text-slate-500">{flow.intent || flow.description}</span>
                                </span>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-3 text-sm text-slate-500">No hay flujos con ese nombre.</div>
                          )}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setInstructionValue(buildFunnelTemplate(productName))}
                          className="inline-flex h-9 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--primary)_18%,white)] bg-[color-mix(in_srgb,var(--primary)_6%,white)] px-3 text-xs font-medium text-[var(--primary)] transition hover:bg-[color-mix(in_srgb,var(--primary)_10%,white)]"
                        >
                          Convertir a embudo
                        </button>
                        <span className="text-xs text-slate-500">
                          Usa esta base para ordenar el producto por pasos.
                        </span>
                      </div>
                      <textarea
                        ref={textareaRef}
                        value={instructionValue}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setInstructionValue(nextValue);
                          updateSlashSearch(nextValue, event.target.selectionStart);
                        }}
                        onClick={(event) => updateSlashSearch(instructionValue, event.currentTarget.selectionStart)}
                        onKeyUp={(event) => updateSlashSearch(instructionValue, event.currentTarget.selectionStart)}
                        rows={10}
                        placeholder="Notas adicionales del producto mientras migras al embudo."
                        className="mt-2 min-h-56 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
                      />

                      <div className="mt-4 grid gap-4">
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-900">Flujo hijo del embudo:</span>
                          <select
                            value={followUpFlowValue}
                            onChange={(event) => setFollowUpFlowValue(event.target.value)}
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
                          >
                            <option value="">Sin flujo hijo</option>
                            {flows.map((flow) => (
                              <option key={flow.id} value={flow.id}>
                                {flow.badge} · /{flow.title}
                              </option>
                            ))}
                          </select>
                          <p className="mt-2 text-xs leading-5 text-slate-500">
                            Este flujo se usara como siguiente paso del embudo cuando el contexto lo indique.
                          </p>
                        </label>
                      </div>
                    </div>
                  ) : null}

                  {view === "preview" ? (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Conocimiento que recibira el agente sobre este producto
                      </p>
                      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                        <div className="flex items-start gap-4 px-4 py-4">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                            {thumbnailUrl ? (
                              <img src={thumbnailUrl} alt={productName} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-slate-300">
                                <FileText className="h-6 w-6" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-sm font-semibold text-slate-950">{productName}</p>
                            <p className="text-xs text-slate-500">{categoryName}</p>
                            <p className="text-sm font-medium text-slate-700">{price}</p>
                          </div>
                        </div>
                        {description?.trim() ? (
                          <div className="border-t border-slate-100 px-4 py-3">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Descripcion</p>
                            <p className="text-sm leading-6 text-slate-600">{description}</p>
                          </div>
                        ) : null}
                        <div className="border-t border-slate-100 px-4 py-3">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Embudo para el agente</p>
                          {composedInstructions.trim() ? (
                            renderPreview(composedInstructions)
                          ) : (
                          <p className="text-sm text-slate-400">Sin embudo — el agente usara solo los datos del producto.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300"
                    >
                      Cancelar
                    </button>
                    <SubmitButton />
                  </div>
                </form>
              </div>
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}

