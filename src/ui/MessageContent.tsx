import { useMemo } from "react";
import { parseMessageContent } from "../core/rich-response/richResponse";
import { RichFormattingError, RichMarkup } from "./RichMarkup";

interface MessageContentProps {
  content: string;
  role: string;
  isStreaming?: boolean;
}

export function MessageContent({ content, role, isStreaming = false }: MessageContentProps) {
  const blocks = useMemo(
    () => (role === "assistant" ? parseMessageContent(content, isStreaming) : [{ type: "plain" as const, source: content }]),
    [content, isStreaming, role],
  );

  if (role !== "assistant") {
    return <p className="message-plain-text">{content}</p>;
  }

  return (
    <div className="message-content">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case "markdown":
            return block.source ? <RichMarkup key={key} source={block.source} /> : null;
          case "rich":
            return <div className="rich-response" key={key}><RichMarkup source={block.source} isRich /></div>;
          case "rich-pending":
            return <div className="rich-response-pending" key={key} role="status">Thinking...</div>;
          case "rich-error":
            return <RichFormattingError key={key} message={block.message} source={block.source} />;
        }
      })}
    </div>
  );
}
