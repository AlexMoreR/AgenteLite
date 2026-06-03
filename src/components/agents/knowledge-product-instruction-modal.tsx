"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Save, X } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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

function SubmitButton() {
  return (
    <Button type="submit">Guardar</Button>
  );
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
        placeholder: "Qué debe decir el agente al empezar.",
        value: funnelFields.opening,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, opening: nextValue })),
      },
      {
        key: "qualification" as const,
        emoji: "🧭",
        title: "Paso 2. Calificación",
        placeholder: "Qué pregunta debe hacer para entender la necesidad.",
        value: funnelFields.qualification,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, qualification: nextValue })),
      },
      {
        key: "presentation" as const,
        emoji: "💡",
        title: "Paso 3. Presentación",
        placeholder: "Qué beneficios o datos del producto debe mostrar.",
        value: funnelFields.presentation,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, presentation: nextValue })),
      },
      {
        key: "faq" as const,
        emoji: "❓",
        title: "Paso 4. FAQ / objeciones",
        placeholder: "Precio, peso, medidas, color, envío, disponibilidad.",
        value: funnelFields.faq,
        onChange: (nextValue: string) => setFunnelFields((current) => ({ ...current, faq: nextValue })),
      },
      {
        key: "closing" as const,
        emoji: "✅",
        title: "Paso 5. Cierre",
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
              <Badge
                key={i}
                variant="outline"
                className={`h-5 rounded-full px-2 text-[11px] font-semibold ${
                  known
                    ? "border-[color-mix(in_srgb,var(--primary)_18%,white)] bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {part}
              </Badge>
            );
          }
          return part;
        })}
      </p>
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSlashSearch(null);
          }
        }}
      >
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

        <DialogContent
          className="w-[min(96vw,64rem)] !max-w-[64rem] !flex !flex-col max-h-[calc(100dvh-2rem)] overflow-hidden p-5 sm:p-6"
        >
          <DialogHeader>
              <DialogTitle>
                {productName}
              </DialogTitle>
          </DialogHeader>

          <form action={saveAgentKnowledgeProductInstructionAction} className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

                  <Tabs
                    value={view}
                    onValueChange={(value) => setView(value as "activation" | "funnel" | "preview")}
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1"
                  >
                    <TabsList variant="line">
                      <TabsTrigger value="activation">Activa</TabsTrigger>
                      <TabsTrigger value="funnel">
                        Embudo
                      </TabsTrigger>
                      <TabsTrigger value="preview">
                        Preview
                      </TabsTrigger>
                    </TabsList>

                  <TabsContent value="activation">
                    <Card>
                      <CardHeader className="">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <CardTitle>Activa</CardTitle>
                            <CardDescription>
                              Define como se activa este producto: por defecto, por IA o por palabras clave.
                            </CardDescription>
                          </div>
                          <Badge variant="outline" className="h-5 rounded-full border-slate-200 bg-white px-2.5 text-[10px] font-semibold tracking-[0.08em] text-slate-600">
                            {activationMode === "chatbot" ? "CHATBOT" : activationMode === "ia" ? "IA" : "DEFAULT"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                                className={`min-h-36 rounded-xl border px-4 py-4 text-left transition ${
                                  isSelected
                                    ? "border-[color-mix(in_srgb,var(--primary)_35%,white)] bg-[color-mix(in_srgb,var(--primary)_7%,white)] shadow-sm"
                                    : "border-border bg-background hover:bg-muted/40"
                                }`}
                              >
                                <p className="text-sm font-semibold text-foreground">{option.title}</p>
                                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{option.description}</p>
                              </button>
                            );
                          })}
                        </div>

                        {activationMode === "chatbot" ? (
                          <div className="space-y-3">
                            <label className="block">
                              <span className="text-sm font-medium text-foreground">Tipo de coincidencia</span>
                              <Select
                                value={activationMatchType}
                                onValueChange={(value) =>
                                  setActivationMatchType(value === "contiene" ? "contiene" : "exacta")
                                }
                              >
                                <SelectTrigger className="mt-2 h-10 w-full rounded-xl border-border bg-background px-3 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-border bg-background p-1">
                                  <SelectItem value="exacta">Exacta</SelectItem>
                                  <SelectItem value="contiene">Contiene</SelectItem>
                                </SelectContent>
                              </Select>
                            </label>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-foreground">Palabras clave</span>
                              <span className="text-xs text-muted-foreground">{activationKeywords.length}/20</span>
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
                                className="h-10 shrink-0"
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
                                    className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground"
                                  >
                                    {keyword}
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="funnel">
                    <Card>
                      <CardHeader>
                        <div className="flex items-center gap-2">
                          <CardTitle>Embudo</CardTitle>
                          <Badge variant="outline" className="h-5 rounded-full border-[color-mix(in_srgb,var(--primary)_18%,white)] bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 text-[10px] font-medium text-[var(--primary)]">
                            🪜 Paso a paso
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <Accordion defaultValue={["opening"]} keepMounted className="">
                          {funnelSteps.map((step) => (
                            <AccordionItem key={step.key} value={step.key}>
                              <AccordionTrigger className="py-2 text-[14px] font-semibold text-slate-900 hover:no-underline">
                                {step.emoji} {step.title}
                              </AccordionTrigger>
                              <AccordionContent className="pb-4">
                                <div className="py-2">
                                  <Textarea
                                    value={step.value}
                                    onChange={(event) => step.onChange(event.target.value)}
                                    rows={3}
                                    placeholder={step.placeholder}
                                  />
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                        {slashSearch ? (
                          <div className="overflow-hidden rounded-xl border border-border bg-background">
                            {flows.length === 0 ? (
                              <div className="px-3 py-3 text-sm text-muted-foreground">Todavia no hay flujos creados.</div>
                            ) : filteredFlows.length > 0 ? (
                              filteredFlows.map((flow) => (
                                <button
                                  key={flow.id}
                                  type="button"
                                  onClick={() => insertFlowReference(flow)}
                                  className="flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-left transition last:border-b-0 hover:bg-muted/40"
                                >
                                  <Badge variant="outline" className="mt-0.5 h-5 rounded-full border-[color-mix(in_srgb,var(--primary)_18%,white)] bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 text-[10px] font-semibold text-[var(--primary)]">
                                    {flow.badge}
                                  </Badge>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-medium text-foreground">/{flow.title}</span>
                                    <span className="line-clamp-1 block text-xs text-muted-foreground">{flow.intent || flow.description}</span>
                                  </span>
                                </button>
                              ))
                            ) : (
                              <div className="px-3 py-3 text-sm text-muted-foreground">No hay flujos con ese nombre.</div>
                            )}
                          </div>
                        ) : null}
                        <Textarea
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
                        />

                        <div className="grid gap-4">
                          <label className="block">
                            <span className="text-sm font-semibold text-foreground">Flujo hijo del embudo:</span>
                            <Select
                              value={followUpFlowValue || "__none__"}
                              onValueChange={(value) => setFollowUpFlowValue(value === "__none__" ? "" : value ?? "")}
                            >
                              <SelectTrigger className="mt-2 h-10 w-full rounded-xl border-border bg-background px-3 text-sm">
                                <SelectValue placeholder="Sin flujo hijo" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-border bg-background p-1">
                                <SelectItem value="__none__">Sin flujo hijo</SelectItem>
                                {flows.map((flow) => (
                                  <SelectItem key={flow.id} value={flow.id}>
                                    {flow.badge} · /{flow.title}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              Este flujo se usara como siguiente paso del embudo cuando el contexto lo indique.
                            </p>
                          </label>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="preview" className="mt-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>Conocimiento que recibira el agente sobre este producto</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-start gap-4">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
                            {thumbnailUrl ? (
                              <img src={thumbnailUrl} alt={productName} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                <FileText className="h-6 w-6" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-sm font-medium text-foreground">{productName}</p>
                            <p className="text-xs text-muted-foreground">{categoryName}</p>
                            <p className="text-sm font-medium text-foreground">{price}</p>
                          </div>
                        </div>
                        {description?.trim() ? (
                          <div className="space-y-1 border-t border-border pt-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Descripción</p>
                            <p className="text-sm leading-6 text-muted-foreground">{description}</p>
                          </div>
                        ) : null}
                        <div className="space-y-1 border-t border-border pt-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Embudo para el agente</p>
                          {composedInstructions.trim() ? (
                            renderPreview(composedInstructions)
                          ) : (
                            <p className="text-sm text-muted-foreground">Sin embudo — el agente usará solo los datos del producto.</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                  </Tabs>

            <DialogFooter className="">
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <SubmitButton />
            </DialogFooter>
                </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
