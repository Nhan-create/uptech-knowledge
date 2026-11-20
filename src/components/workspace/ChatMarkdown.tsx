import { Fragment, type ReactNode } from "react";

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|https?:\/\/[^\s)<>]+)/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `inline-${keyIdx++}`;
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      tokens.push(
        <strong key={key} className="font-semibold text-[#0D1321]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      tokens.push(
        <code
          key={key}
          className="rounded bg-[#F3F4F8] px-1.5 py-0.5 font-mono text-[13px] text-[#0D1321]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      tokens.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      tokens.push(
        <a
          key={key}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#1635C7] underline underline-offset-2 hover:text-[#1B44FF]"
        >
          {token}
        </a>,
      );
    } else {
      tokens.push(token);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

export function ChatMarkdown({ content }: Readonly<{ content: string }>) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const segments = normalized.split(/(```[\s\S]*?```)/gu);
  const blocks: ReactNode[] = [];
  let blockKey = 0;

  for (const segment of segments) {
    if (!segment) continue;
    if (segment.startsWith("```") && segment.endsWith("```") && segment.length >= 6) {
      const inner = segment.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/u, "");
      blocks.push(
        <pre
          key={`code-${blockKey++}`}
          className="overflow-x-auto rounded-xl border border-[#0D1321]/10 bg-[#0B1220] p-3.5 font-mono text-[13px] leading-6 [color:#F9FAFB]"
        >
          <code>{inner.trimEnd()}</code>
        </pre>,
      );
      continue;
    }

    const lines = segment.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();
      if (!trimmed) {
        i += 1;
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/u);
      if (headingMatch) {
        blocks.push(
          <h4
            key={`h-${blockKey++}`}
            className="pt-1 text-[15px] font-semibold text-[#0D1321]"
          >
            {renderInlineMarkdown(headingMatch[2]!)}
          </h4>,
        );
        i += 1;
        continue;
      }

      if (/^[-*•]\s+/u.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*•]\s+/u.test((lines[i] ?? "").trim())) {
          items.push((lines[i] ?? "").trim().replace(/^[-*•]\s+/u, ""));
          i += 1;
        }
        blocks.push(
          <ul
            key={`ul-${blockKey++}`}
            className="list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-[#1F2937]"
          >
            {items.map((item, idx) => (
              <li key={`li-${idx}`}>{renderInlineMarkdown(item)}</li>
            ))}
          </ul>,
        );
        continue;
      }

      if (/^\d+\.\s+/u.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/u.test((lines[i] ?? "").trim())) {
          items.push((lines[i] ?? "").trim().replace(/^\d+\.\s+/u, ""));
          i += 1;
        }
        blocks.push(
          <ol
            key={`ol-${blockKey++}`}
            className="list-decimal space-y-1.5 pl-5 text-[15px] leading-7 text-[#1F2937]"
          >
            {items.map((item, idx) => (
              <li key={`oli-${idx}`}>{renderInlineMarkdown(item)}</li>
            ))}
          </ol>,
        );
        continue;
      }

      const paragraphLines: string[] = [trimmed];
      i += 1;
      while (i < lines.length) {
        const nextTrimmed = (lines[i] ?? "").trim();
        if (
          !nextTrimmed ||
          /^(#{1,3})\s+/u.test(nextTrimmed) ||
          /^[-*•]\s+/u.test(nextTrimmed) ||
          /^\d+\.\s+/u.test(nextTrimmed)
        ) {
          break;
        }
        paragraphLines.push(nextTrimmed);
        i += 1;
      }
      blocks.push(
        <p key={`p-${blockKey++}`} className="text-[15px] leading-7 text-[#1F2937]">
          {paragraphLines.map((pLine, idx) => (
            <Fragment key={`pl-${idx}`}>
              {idx > 0 ? <br /> : null}
              {renderInlineMarkdown(pLine)}
            </Fragment>
          ))}
        </p>,
      );
    }
  }

  return <div className="space-y-2.5">{blocks}</div>;
}
