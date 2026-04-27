"use client";

import { useEffect, useRef } from "react";

type ChatScrollAnchorProps = {
  dependencyKey: string;
  behavior?: "bottom" | "preserve";
};

export function ChatScrollAnchor({ dependencyKey, behavior = "bottom" }: ChatScrollAnchorProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (behavior === "preserve") {
      return;
    }

    const anchor = anchorRef.current;
    const messagesScroll = anchor?.closest(".chat-messages-scroll");

    if (messagesScroll) {
      messagesScroll.scrollTo({ top: messagesScroll.scrollHeight, behavior: "smooth" });
      return;
    }

    anchor?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [behavior, dependencyKey]);

  return <div ref={anchorRef} aria-hidden="true" />;
}
