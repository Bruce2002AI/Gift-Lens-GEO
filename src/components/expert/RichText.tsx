import type { ReactNode } from "react";

/**
 * A small, dependency-free Markdown renderer for the agent's chat prose (the
 * game-plan opener and a presentation's message). It supports the marks the
 * model uses to make an answer scannable — **bold**, *italic*, `code`, bullet
 * and numbered lists WITH nesting, blockquotes (for scripts/quotes it drafts),
 * and light headings — and nothing else.
 *
 * XSS-safe by construction: it only ever emits text nodes and a fixed set of
 * React elements. No raw-HTML path (no dangerouslySetInnerHTML), so model
 * output can never inject markup.
 */

/** **bold** / __bold__, *italic* / _italic_, `code` — in that precedence. */
const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])|`([^`]+)`)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (let m = INLINE.exec(text); m !== null; m = INLINE.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2] != null || m[3] != null) {
      nodes.push(<strong key={key}>{m[2] ?? m[3]}</strong>);
    } else if (m[4] != null || m[5] != null) {
      nodes.push(<em key={key}>{m[4] ?? m[5]}</em>);
    } else if (m[6] != null) {
      nodes.push(
        <code key={key} className="rounded bg-black/5 px-1 py-0.5 text-[0.85em]">
          {m[6]}
        </code>,
      );
    }
    last = INLINE.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ── Block model ──────────────────────────────────────────────────────────────

type ListItem = { indent: number; ordered: boolean; text: string };

const HEADING = /^#{1,4}\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;

/** Leading-whitespace width, tabs counted as two columns. */
function indentOf(ws: string): number {
  let n = 0;
  for (const ch of ws) n += ch === "\t" ? 2 : 1;
  return n;
}

/** Render one contiguous run of list items, nesting deeper-indented ones. */
function renderList(items: ListItem[], keyBase: string): ReactNode {
  let pos = 0;
  let listKey = 0;

  function level(minIndent: number): ReactNode {
    const ordered = items[pos]?.ordered ?? false;
    const lis: ReactNode[] = [];
    while (pos < items.length && items[pos].indent >= minIndent) {
      const cur = items[pos];
      // A deeper item with no shallower parent yet — start a nested list anyway.
      if (cur.indent > minIndent) {
        lis.push(<li key={`${keyBase}-orphan-${pos}`}>{level(cur.indent)}</li>);
        continue;
      }
      pos += 1;
      let child: ReactNode = null;
      if (pos < items.length && items[pos].indent > cur.indent) {
        child = level(items[pos].indent);
      }
      lis.push(
        <li key={`${keyBase}-li-${pos}`}>
          {renderInline(cur.text, `${keyBase}-t${pos}`)}
          {child}
        </li>,
      );
    }
    const cls = ordered ? "list-decimal" : "list-disc";
    const key = `${keyBase}-l${listKey++}`;
    return ordered ? (
      <ol key={key} className={`${cls} space-y-1 pl-5`}>
        {lis}
      </ol>
    ) : (
      <ul key={key} className={`${cls} space-y-1 pl-5`}>
        {lis}
      </ul>
    );
  }

  return level(items[0]?.indent ?? 0);
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: ListItem[] = [];
  let quote: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const buffer = para;
    para = [];
    blocks.push(
      <p key={`b${key++}`} className="leading-relaxed">
        {buffer.flatMap((ln, idx) => {
          const inline = renderInline(ln, `b${key}-l${idx}`);
          return idx === 0 ? inline : [<br key={`b${key}-br${idx}`} />, ...inline];
        })}
      </p>,
    );
  };
  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    blocks.push(<div key={`b${key++}`}>{renderList(items, `b${key}`)}</div>);
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    const buffer = quote;
    quote = [];
    blocks.push(
      <blockquote
        key={`b${key++}`}
        className="border-l-2 border-current/30 pl-3 italic text-current/85"
      >
        {buffer.flatMap((ln, idx) => {
          const inline = renderInline(ln, `b${key}-q${idx}`);
          return idx === 0 ? inline : [<br key={`b${key}-qbr${idx}`} />, ...inline];
        })}
      </blockquote>,
    );
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    const heading = line.match(HEADING);
    const quoteM = line.match(QUOTE);
    const bullet = line.match(BULLET);
    const numbered = line.match(NUMBERED);
    if (heading) {
      flushAll();
      blocks.push(
        <p key={`b${key++}`} className="font-semibold text-ink">
          {renderInline(heading[1], `b${key}-h`)}
        </p>,
      );
    } else if (bullet) {
      flushPara();
      flushQuote();
      list.push({ indent: indentOf(bullet[1]), ordered: false, text: bullet[2] });
    } else if (numbered) {
      flushPara();
      flushQuote();
      list.push({ indent: indentOf(numbered[1]), ordered: true, text: numbered[2] });
    } else if (quoteM) {
      flushPara();
      flushList();
      quote.push(quoteM[1]);
    } else {
      flushList();
      flushQuote();
      para.push(line);
    }
  }
  flushAll();

  return <div className={className ?? "space-y-2"}>{blocks}</div>;
}
