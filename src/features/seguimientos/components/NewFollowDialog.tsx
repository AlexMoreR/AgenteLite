"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createFollowRuleAction,
  type CreateFollowRuleActionState,
} from "@/app/actions/follow-actions";

type SelectOption = {
  value: string;
  label: string;
  color?: string;
};

type SourceGroup = {
  label: string;
  options: SelectOption[];
};

type SourceType = "FLOW" | "PRODUCT" | "TAG" | "CRM_STAGE" | "MANUAL";
type FollowMessageType = "TEXT" | "AUDIO" | "IMAGE" | "VIDEO" | "DOC";

type NewFollowDialogProps = {
  workspaceName: string;
  channels: SelectOption[];
  contacts: SelectOption[];
  sourceOptions: SourceGroup[];
  crmStages: SelectOption[];
};

function fieldClassName() {
  return "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400";
}

function labelClassName() {
  return "text-xs font-medium uppercase tracking-[0.18em] text-slate-500";
}

function sourceOptionsForType(sourceType: SourceType, sourceOptions: SourceGroup[], crmStages: SelectOption[], contacts: SelectOption[]) {
  if (sourceType === "MANUAL") return contacts;
  if (sourceType === "FLOW") return sourceOptions[0]?.options ?? [];
  if (sourceType === "PRODUCT") return sourceOptions[1]?.options ?? [];
  if (sourceType === "TAG") return sourceOptions[2]?.options ?? [];
  if (sourceType === "CRM_STAGE") return crmStages;
  return [];
}

function sourcePlaceholder(sourceType: SourceType) {
  if (sourceType === "MANUAL") return "Buscar contacto";
  if (sourceType === "FLOW") return "Buscar flujo";
  if (sourceType === "PRODUCT") return "Buscar producto";
  if (sourceType === "TAG") return "Buscar tag";
  return "Buscar estado";
}

function sourceLabel(sourceType: SourceType) {
  if (sourceType === "MANUAL") return "Contacto";
  if (sourceType === "FLOW") return "Flujo";
  if (sourceType === "PRODUCT") return "Producto";
  if (sourceType === "TAG") return "Tag";
  return "Estado CRM";
}

function sourceEmptyText(sourceType: SourceType) {
  if (sourceType === "MANUAL") return "No hay contactos disponibles.";
  if (sourceType === "FLOW") return "No hay flujos disponibles.";
  if (sourceType === "PRODUCT") return "No hay productos disponibles.";
  if (sourceType === "TAG") return "No hay tags disponibles.";
  return "No hay estados CRM disponibles.";
}

const initialActionState: CreateFollowRuleActionState = {
  error: "",
};

export function NewFollowDialog({
  workspaceName,
  channels,
  contacts,
  sourceOptions,
  crmStages,
}: NewFollowDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"intro" | "rule">("intro");
  const [ruleName, setRuleName] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [ruleSourceType, setRuleSourceType] = useState<SourceType>("MANUAL");
  const [ruleSourceValue, setRuleSourceValue] = useState<SelectOption | null>(null);
  const [ruleMessageType, setRuleMessageType] = useState<FollowMessageType>("TEXT");
  const [ruleContent, setRuleContent] = useState("");
  const [actionState, formAction, pending] = useActionState(createFollowRuleAction, initialActionState);

  const ruleSourceOptions = useMemo(
    () => sourceOptionsForType(ruleSourceType, sourceOptions, crmStages, contacts),
    [contacts, crmStages, ruleSourceType, sourceOptions],
  );

  const ruleSourceLabelText = sourceLabel(ruleSourceType);
  const ruleSourcePlaceholderText = sourcePlaceholder(ruleSourceType);
  const ruleSourceEmptyText = sourceEmptyText(ruleSourceType);
  const isManualFollow = ruleSourceType === "MANUAL";
  const stepTitle = isManualFollow ? "Programar seguimiento" : "Crear regla";
  const stepDescription = isManualFollow
    ? `Programa un seguimiento para ${workspaceName}.`
    : `Configura la automatizacion reutilizable para ${workspaceName}.`;

  useEffect(() => {
    if ("success" in actionState && actionState.success) {
      toast.success(actionState.message);
      window.setTimeout(() => {
        setOpen(false);
      }, 0);
      return;
    }

    if ("error" in actionState && actionState.error) {
      toast.error(actionState.error);
    }
  }, [actionState]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
        setStep("intro");
        setRuleName("");
        setSelectedChannelId("");
        setRuleSourceType("MANUAL");
        setRuleSourceValue(null);
        setRuleMessageType("TEXT");
        setRuleContent("");
      }
    }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          Nuevo
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-3xl">
        {step === "intro" ? (
          <>
            <DialogHeader>
              <DialogTitle>Nuevo seguimiento</DialogTitle>
              <DialogDescription>Escribe el nombre y confirma el workspace donde se va a crear.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="flex flex-col gap-2">
                <label className={labelClassName()} htmlFor="new-follow-name">
                  Nombre
                </label>
                <Input
                  id="new-follow-name"
                  value={ruleName}
                  onChange={(event) => setRuleName(event.target.value)}
                  className={fieldClassName()}
                  placeholder="Seguimiento post demo"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className={labelClassName()} htmlFor="new-follow-channel">
                  Canal
                </label>
                <select
                  id="new-follow-channel"
                  value={selectedChannelId}
                  onChange={(event) => setSelectedChannelId(event.target.value)}
                  className={fieldClassName()}
                >
                  <option value="">Canal por defecto</option>
                  {channels.map((channel) => (
                    <option key={channel.value} value={channel.value}>
                      {channel.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!ruleName.trim()) {
                    return;
                  }
                  setStep("rule");
                }}
              >
                Crear
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === "rule" ? (
          <>
            <DialogHeader>
              <DialogTitle>{stepTitle}</DialogTitle>
              <DialogDescription>{stepDescription}</DialogDescription>
            </DialogHeader>

            <form action={formAction} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
              <input type="hidden" name="name" value={ruleName} />
              <input type="hidden" name="channelId" value={selectedChannelId} />
              <input type="hidden" name="sourceId" value={ruleSourceValue?.value ?? ""} />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className={labelClassName()} htmlFor="quick-rule-source-type">
                    Origen
                  </label>
                  <select
                    id="quick-rule-source-type"
                    name="sourceType"
                    className={fieldClassName()}
                    value={ruleSourceType}
                    onChange={(event) => {
                      const nextType = event.target.value as SourceType;
                      setRuleSourceType(nextType);
                      setRuleSourceValue(null);
                    }}
                  >
                    <option value="MANUAL">Manual</option>
                    <option value="FLOW">Flujo</option>
                    <option value="PRODUCT">Producto</option>
                    <option value="TAG">Tag</option>
                    <option value="CRM_STAGE">CRM</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className={labelClassName()} htmlFor="quick-rule-source-id">
                    {ruleSourceLabelText}
                  </label>
                  <Combobox
                    key={ruleSourceType}
                    items={ruleSourceOptions}
                    autoHighlight
                    value={ruleSourceValue}
                    onValueChange={(option) => setRuleSourceValue(option)}
                    itemToStringLabel={(option) => option.label}
                    itemToStringValue={(option) => option.value}
                  >
                    <ComboboxInput
                      id="quick-rule-source-id"
                      placeholder={ruleSourcePlaceholderText}
                      className={fieldClassName()}
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>{ruleSourceEmptyText}</ComboboxEmpty>
                      <ComboboxList>
                        {(option) => (
                          <ComboboxItem key={option.value} value={option}>
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "size-2.5 shrink-0 rounded-full",
                                  ruleSourceType === "TAG" || ruleSourceType === "CRM_STAGE"
                                    ? "opacity-100"
                                    : "bg-slate-300",
                                )}
                                style={
                                  (ruleSourceType === "TAG" || ruleSourceType === "CRM_STAGE") && option.color
                                    ? { backgroundColor: option.color }
                                    : undefined
                                }
                              />
                              <span className="truncate">{option.label}</span>
                            </span>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </div>

                <div className="flex flex-col gap-2">
                  <label className={labelClassName()} htmlFor="quick-rule-time-type">
                    Tipo de tiempo
                  </label>
                  <select id="quick-rule-time-type" name="timeType" className={fieldClassName()}>
                    <option value="MINUTES">Minutos</option>
                    <option value="HOURS">Horas</option>
                    <option value="DAYS">Dias</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className={labelClassName()} htmlFor="quick-rule-time-value">
                    Tiempo
                  </label>
                  <Input id="quick-rule-time-value" name="timeValue" type="number" min={1} defaultValue={1} className={fieldClassName()} />
                </div>

                <div className="flex flex-col gap-2">
                  <label className={labelClassName()} htmlFor="quick-rule-message-type">
                    Tipo de mensaje
                  </label>
                  <select
                    id="quick-rule-message-type"
                    name="messageType"
                    className={fieldClassName()}
                    value={ruleMessageType}
                    onChange={(event) => setRuleMessageType(event.target.value as FollowMessageType)}
                  >
                    <option value="TEXT">Texto</option>
                    <option value="AUDIO">Audio</option>
                    <option value="IMAGE">Imagen</option>
                    <option value="VIDEO">Video</option>
                    <option value="DOC">Documento</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className={labelClassName()} htmlFor="quick-rule-media-url">
                    Media URL
                  </label>
                  <Input id="quick-rule-media-url" name="mediaUrl" className={fieldClassName()} placeholder="https://..." />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className={labelClassName()} htmlFor="quick-rule-content">
                  Contenido / caption
                </label>
                <Textarea
                  id="quick-rule-content"
                  name="content"
                  className={fieldClassName()}
                  rows={4}
                  placeholder={ruleMessageType === "TEXT" ? "Hola, seguimos atentos a tu caso..." : "Opcional"}
                  value={ruleContent}
                  onChange={(event) => setRuleContent(event.target.value)}
                  required={ruleMessageType === "TEXT"}
                />
                <p className="text-xs text-slate-500">
                  {ruleMessageType === "TEXT"
                    ? "El contenido es obligatorio para mensajes de texto."
                    : "Solo es obligatorio si el mensaje es de texto."}
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="cancelOnActivity" defaultChecked className="h-4 w-4 rounded border-slate-300 text-slate-900" />
                Cancelar por actividad
              </label>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStep("intro")}>
                  Volver
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Guardando..." : isManualFollow ? "Programar seguimiento" : "Guardar regla"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
