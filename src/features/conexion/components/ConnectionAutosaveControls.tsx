"use client";

import { useEffect, useRef } from "react";

type AgentOption = {
  id: string;
  name: string;
};

type AgentAssignAutosaveFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  channelId: string;
  returnTo: string;
  defaultValue: string;
  availableAgents: AgentOption[];
};

export function AgentAssignAutosaveForm({
  action,
  channelId,
  returnTo,
  defaultValue,
  availableAgents,
}: AgentAssignAutosaveFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="channelId" value={channelId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <select
        name="agentId"
        defaultValue={defaultValue}
        className="h-9 min-w-0 w-full rounded-xl border border-[rgba(148,163,184,0.18)] bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_10%,white)]"
        aria-label="Seleccionar agente para el canal"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="" disabled>
          Seleccionar agente
        </option>
        {availableAgents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
    </form>
  );
}

type ReactivationAutosaveFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  agentId: string;
  returnTo: string;
  defaultValue: string;
};

export function ReactivationAutosaveForm({
  action,
  agentId,
  returnTo,
  defaultValue,
}: ReactivationAutosaveFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const scheduleSubmit = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 700);
  };

  const submitNow = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input
        type="text"
        name="reactivationMessage"
        defaultValue={defaultValue}
        className="h-9 min-w-0 w-full rounded-xl border border-[rgba(148,163,184,0.18)] bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_10%,white)]"
        placeholder="Escribe el mensaje de reactivacion"
        maxLength={300}
        onChange={scheduleSubmit}
        onBlur={submitNow}
      />
    </form>
  );
}

type ResponseDelayAutosaveFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  agentId: string;
  returnTo: string;
  defaultValue: number;
};

export function ResponseDelayAutosaveForm({
  action,
  agentId,
  returnTo,
  defaultValue,
}: ResponseDelayAutosaveFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const scheduleSubmit = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 700);
  };

  const submitNow = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="relative">
        <input
          type="number"
          name="responseDelaySeconds"
          defaultValue={defaultValue}
          min={0}
          max={120}
          step={1}
          inputMode="numeric"
          className="h-9 min-w-0 w-full rounded-xl border border-[rgba(148,163,184,0.18)] bg-white px-3 pr-12 text-sm text-slate-700 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_10%,white)]"
          aria-label="Retraso de respuesta IA en segundos"
          onChange={scheduleSubmit}
          onBlur={submitNow}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-sm text-slate-400">seg</span>
      </div>
    </form>
  );
}
