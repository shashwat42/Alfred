import React, { useState } from "react";

// Defensive pattern to strip internal tool protocol markup if any leaks through
const UNSUPPORTED_TOOL_PROTOCOL_REGEX =
  /<\/?(?:dots_function_call|invoke|function_call|tool_call|dispatch)[\s\S]*?>/gi;

interface SafeMarkdownProps {
  content: string;
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{language || "code"}</span>
        <button
          type="button"
          className="markdown-code-copy-btn"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="markdown-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Safely parses inline markdown elements (bold, italic, inline code)
 * into React elements without ever using dangerouslySetInnerHTML.
 * Gracefully handles unclosed/malformed tokens as literal text.
 */
function parseInlineFormatting(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // 1. Inline code: `code`
    const codeMatch = remaining.match(/^`([^`\n]+)`/);
    if (codeMatch && codeMatch[1] !== undefined) {
      nodes.push(
        <code key={`code-${keyIndex++}`} className="markdown-inline-code">
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 2. Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)([\s\S]+?)\1/);
    if (boldMatch && boldMatch[2] !== undefined) {
      nodes.push(
        <strong key={`bold-${keyIndex++}`}>
          {parseInlineFormatting(boldMatch[2])}
        </strong>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 3. Italic: *text* or _text_ (excluding inside words or malformed single stars)
    const italicMatch = remaining.match(/^(\*|_)([^\s*_][\s\S]*?)\1/);
    if (italicMatch && italicMatch[2] !== undefined) {
      nodes.push(
        <em key={`italic-${keyIndex++}`}>
          {parseInlineFormatting(italicMatch[2])}
        </em>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Advance plain text until the next potential markdown trigger (` , * , _)
    const nextSpecial = remaining.slice(1).search(/[`*_]/);
    if (nextSpecial === -1) {
      nodes.push(remaining);
      break;
    } else {
      const plainChunk = remaining.slice(0, nextSpecial + 1);
      nodes.push(plainChunk);
      remaining = remaining.slice(nextSpecial + 1);
    }
  }

  return nodes;
}

/**
 * Parses markdown text blocks outside of code blocks.
 * Supports paragraphs, bullet lists, numbered lists, and line breaks.
 */
function parseTextBlocks(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;
  let elIndex = 0;

  const flushList = () => {
    if (!currentList) return;
    if (currentList.type === "ul") {
      elements.push(
        <ul key={`ul-${elIndex++}`} className="markdown-list">
          {currentList.items.map((item, idx) => (
            <li key={idx}>{parseInlineFormatting(item)}</li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`ol-${elIndex++}`} className="markdown-ordered-list">
          {currentList.items.map((item, idx) => (
            <li key={idx}>{parseInlineFormatting(item)}</li>
          ))}
        </ol>
      );
    }
    currentList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    // Bullet list item: - or *
    const bulletMatch = rawLine.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch && bulletMatch[2]) {
      if (currentList && currentList.type !== "ul") flushList();
      if (!currentList) currentList = { type: "ul", items: [] };
      currentList.items.push(bulletMatch[2]);
      continue;
    }

    // Numbered list item: 1. or 2.
    const orderedMatch = rawLine.match(/^(\s*)\d+\.\s+(.+)$/);
    if (orderedMatch && orderedMatch[2]) {
      if (currentList && currentList.type !== "ol") flushList();
      if (!currentList) currentList = { type: "ol", items: [] };
      currentList.items.push(orderedMatch[2]);
      continue;
    }

    // Non-list line: flush any active list
    flushList();

    if (trimmed.length === 0) {
      continue;
    }

    elements.push(
      <p key={`p-${elIndex++}`} className="markdown-paragraph">
        {parseInlineFormatting(rawLine)}
      </p>
    );
  }

  flushList();
  return elements;
}

/**
 * SafeMarkdown:
 * - Neutralizes unsupported internal protocol markup (<dots_function_call>, <invoke>).
 * - Splits fenced code blocks and renders them in code cards.
 * - Safely formats markdown text nodes via React children.
 * - Zero dangerouslySetInnerHTML usage.
 */
export function SafeMarkdown({ content }: SafeMarkdownProps) {
  // 1. Defensively strip any unhandled protocol tags
  const sanitized = content.replace(UNSUPPORTED_TOOL_PROTOCOL_REGEX, "").trim();

  if (!sanitized) {
    return <span className="markdown-empty">(No response content)</span>;
  }

  // 2. Tokenize by fenced code blocks ```lang\ncode```
  const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)```/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let blockIndex = 0;

  while ((match = codeBlockRegex.exec(sanitized)) !== null) {
    // Content before this code block
    if (match.index > lastIndex) {
      const textChunk = sanitized.slice(lastIndex, match.index);
      elements.push(
        <div key={`text-${blockIndex++}`} className="markdown-text-chunk">
          {parseTextBlocks(textChunk)}
        </div>
      );
    }

    const language = match[1]?.trim() || "";
    const code = (match[2] ?? "").replace(/\r?\n$/, "");

    elements.push(
      <CodeBlock
        key={`code-block-${blockIndex++}`}
        code={code}
        language={language}
      />
    );

    lastIndex = match.index + match[0].length;
  }

  // Trailing text chunk
  if (lastIndex < sanitized.length) {
    const trailingChunk = sanitized.slice(lastIndex);
    elements.push(
      <div key={`text-${blockIndex++}`} className="markdown-text-chunk">
        {parseTextBlocks(trailingChunk)}
      </div>
    );
  }

  return <div className="safe-markdown-wrapper">{elements}</div>;
}

export default SafeMarkdown;
