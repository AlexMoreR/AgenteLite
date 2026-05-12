"use client";

import {
  createContext,
  type ReactNode,
  useActionState,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import {
  autosaveAgentTrainingAction,
  type AgentTrainingAutosaveState,
} from "@/app/actions/agent-actions";

type AgentTrainingAutosaveFormProps = {
  agentId: string;
  className?: string;
  children: ReactNode;
};

type AgentTrainingAutosaveContextValue = {
  pending: boolean;
  state: AgentTrainingAutosaveState;
};

const AgentTrainingAutosaveContext =
  createContext<AgentTrainingAutosaveContextValue | null>(null);

function useAgentTrainingAutosaveContext() {
  const context = useContext(AgentTrainingAutosaveContext);

  if (!context) {
    throw new Error(
      "AgentTrainingAutosaveStatus must be used inside AgentTrainingAutosaveForm.",
    );
  }

  return context;
}

export function AgentTrainingAutosaveStatus() {
  const { pending, state } = useAgentTrainingAutosaveContext();

  return (
    <div
      className={`flex items-center rounded-[16px] border px-3.5 py-2 text-[12px] shadow-[0_12px_24px_-18px_rgba(15,23,42,0.18)] ${
        pending
          ? "border-[color-mix(in_srgb,var(--primary)_24%,white)] bg-[color-mix(in_srgb,var(--primary)_8%,white)] text-[var(--primary)]"
          : state.ok && state.savedAt
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : state.message
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-[rgba(148,163,184,0.14)] bg-white text-slate-500"
      }`}
      aria-live="polite"
      aria-atomic="true"
    >
      <span>
        {pending
          ? "Guardando..."
          : state.ok && state.savedAt
            ? "Guardado."
            : state.message ||
              "Guardado"}
      </span>
    </div>
  );
}

export function AgentTrainingAutosaveForm({
  agentId,
  className,
  children,
}: AgentTrainingAutosaveFormProps) {
  const router = useRouter();
  const initialState: AgentTrainingAutosaveState = {
    ok: true,
    message: "",
    savedAt: null,
  };
  const [state, formAction, pending] = useActionState(
    autosaveAgentTrainingAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const timeoutRef = useRef<number | null>(null);
  const shouldResubmitRef = useRef(false);

  const clearAutosaveTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const submitAutosave = () => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    if (pending) {
      shouldResubmitRef.current = true;
      return;
    }

    form.requestSubmit();
  };

  const scheduleAutosave = (delay = 700) => {
    clearAutosaveTimer();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      submitAutosave();
    }, delay);
  };

  useEffect(() => {
    if (pending || !shouldResubmitRef.current) {
      return;
    }

    shouldResubmitRef.current = false;
    clearAutosaveTimer();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      const form = formRef.current;
      if (!form) {
        return;
      }

      form.requestSubmit();
    }, 220);
  }, [pending]);

  useEffect(() => () => clearAutosaveTimer(), []);

  useEffect(() => {
    if (state.ok && state.savedAt) {
      router.refresh();
    }
  }, [router, state.ok, state.savedAt]);

  return (
    <AgentTrainingAutosaveContext.Provider value={{ pending, state }}>
      <form
        ref={formRef}
        action={formAction}
        className={className}
        noValidate
        onInputCapture={() => scheduleAutosave()}
        onChangeCapture={() => scheduleAutosave()}
        onClickCapture={(event) => {
          if (!(event.target instanceof HTMLElement)) {
            return;
          }

          if (event.target.closest("[data-autosave-trigger='true']")) {
            scheduleAutosave(120);
          }
        }}
      >
        <input type="hidden" name="agentId" value={agentId} />
        {children}
      </form>
    </AgentTrainingAutosaveContext.Provider>
  );
}
