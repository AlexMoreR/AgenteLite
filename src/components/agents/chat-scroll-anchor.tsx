"use client";

import { useEffect, useRef } from "react";

type ChatScrollAnchorProps = {
  dependencyKey: string;
};

export function ChatScrollAnchor({ dependencyKey }: ChatScrollAnchorProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    const messagesScroll = anchor?.closest(".chat-messages-scroll");

    if (messagesScroll) {
      messagesScroll.scrollTo({ top: messagesScroll.scrollHeight, behavior: "smooth" });
      return;
    }

    anchor?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [dependencyKey]);

  return <div ref={anchorRef} aria-hidden="true" />;
}
