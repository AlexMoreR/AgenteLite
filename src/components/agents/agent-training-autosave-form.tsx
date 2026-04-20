"use client";

import { type ReactNode, useActionState, useEffect, useRef } from "react";
import {
  autosaveAgentTrainingAction,
  type AgentTrainingAutosaveState,
} from "@/app/actions/agent-actions";

type AgentTrainingAutosaveFormProps = {
  agentId: string;
  className?: string;
  children: ReactNode;
};

export function AgentTrainingAutosaveForm({
  agentId,
  className,
  children,
}: AgentTrainingAutosaveFormProps) {
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

    if (!form.checkValidity()) {
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

      if (form.checkValidity()) {
        form.requestSubmit();
      }
    }, 220);
  }, [pending]);

  useEffect(() => () => clearAutosaveTimer(), []);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
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
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {pending
          ? "Guardando entrenamiento"
          : state.ok && state.savedAt
            ? "Entrenamiento guardado"
            : state.message}
      </div>
      {children}
    </form>
  );
}
