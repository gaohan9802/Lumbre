'use client'

import React, { memo } from 'react'

function inline(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = []
  const pattern = /(`[^`]+`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_))/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) tokens.push(text.slice(last, match.index))
    const raw = match[0]
    if (raw.startsWith('`')) tokens.push(<code key={match.index} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em] dark:bg-white/10">{raw.slice(1, -1)}</code>)
    else if (match[2] && match[3]) tokens.push(<a key={match.index} href={match[3]} target="_blank" rel="noreferrer" className="underline underline-offset-2 opacity-90 hover:opacity-100">{match[2]}</a>)
    else if (match[4] || match[5]) tokens.push(<strong key={match.index}>{match[4] || match[5]}</strong>)
    else if (match[6]) tokens.push(<del key={match.index}>{match[6]}</del>)
    else tokens.push(<em key={match.index}>{match[7] || match[8]}</em>)
    last = pattern.lastIndex
  }
  if (last < text.length) tokens.push(text.slice(last))
  return tokens
}

function MarkdownTextView({ content, cursor = false }: { content: string; cursor?: boolean }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      if (i < lines.length) i++
      nodes.push(<pre key={`code-${i}`} className="my-2 max-w-full overflow-x-auto rounded-xl bg-black/10 p-3 text-[0.88em] leading-relaxed dark:bg-black/25"><code data-language={language || undefined}>{body.join('\n')}</code></pre>)
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      nodes.push(<div key={i} className={`${level === 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-sm'} mb-1 mt-2 font-semibold`}>{inline(heading[2])}</div>)
      i++; continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''))
      nodes.push(<ul key={`ul-${i}`} className="my-1 list-disc space-y-0.5 pl-5">{items.map((item, n) => <li key={n}>{inline(item)}</li>)}</ul>)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))
      nodes.push(<ol key={`ol-${i}`} className="my-1 list-decimal space-y-0.5 pl-5">{items.map((item, n) => <li key={n}>{inline(item)}</li>)}</ol>)
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
      nodes.push(<blockquote key={`q-${i}`} className="my-1 border-l-2 border-current/25 pl-3 opacity-80">{quote.map((q, n) => <React.Fragment key={n}>{inline(q)}{n < quote.length - 1 && <br />}</React.Fragment>)}</blockquote>)
      continue
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      nodes.push(<hr key={i} className="my-3 border-current/15" />); i++; continue
    }
    if (!line.trim()) { nodes.push(<div key={i} className="h-2" />); i++; continue }
    nodes.push(<p key={i} className="whitespace-pre-wrap break-words">{inline(line)}</p>)
    i++
  }
  return <div className="markdown-text space-y-0.5">{nodes}{cursor && <span className="stream-cursor">…</span>}</div>
}

export const MarkdownText = memo(MarkdownTextView)
