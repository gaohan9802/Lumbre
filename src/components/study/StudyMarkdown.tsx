'use client'

import React, { memo } from 'react'
import katex from 'katex'
import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import { Copy } from 'lucide-react'

hljs.registerLanguage('python', python)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)

function formula(source: string, displayMode = false) {
  try { return katex.renderToString(source, { displayMode, throwOnError: false, strict: false }) }
  catch { return '' }
}

function inline(value: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const pattern = /(\$[^$\n]+\$|\{([^{}|]+)\|([^{}]+)\}|`[^`]+`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~)/g
  let last = 0, match: RegExpExecArray | null
  while ((match = pattern.exec(value))) {
    if (match.index > last) nodes.push(value.slice(last, match.index))
    const raw = match[0]
    if (raw.startsWith('$')) nodes.push(<span key={match.index} className="study-inline-math" dangerouslySetInnerHTML={{ __html: formula(raw.slice(1, -1)) }}/>)
    else if (match[2] && match[3]) nodes.push(<ruby key={match.index}>{match[2]}<rt>{match[3]}</rt></ruby>)
    else if (raw.startsWith('`')) nodes.push(<code key={match.index} className="rounded bg-black/[.07] px-1 py-0.5 font-mono text-[.92em] dark:bg-white/10">{raw.slice(1, -1)}</code>)
    else if (match[4] && match[5]) nodes.push(<a key={match.index} href={match[5]} target="_blank" rel="noreferrer" className="underline underline-offset-2">{match[4]}</a>)
    else if (match[6]) nodes.push(<strong key={match.index}>{match[6]}</strong>)
    else if (match[7]) nodes.push(<del key={match.index}>{match[7]}</del>)
    last = pattern.lastIndex
  }
  if (last < value.length) nodes.push(value.slice(last))
  return nodes
}

function codeBlock(language: string, body: string, key: string) {
  const normalized = language.toLowerCase()
  const known = hljs.getLanguage(normalized)
  const html = known ? hljs.highlight(body, { language: normalized }).value : hljs.highlightAuto(body).value
  return <div key={key} className="study-code my-4 overflow-hidden rounded-2xl border border-current/10 bg-[#211f20] text-[#f7eee8]">
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[10px] uppercase tracking-[.16em] text-white/50"><span>{language || 'code'}</span><button type="button" aria-label="复制代码" onClick={() => void navigator.clipboard?.writeText(body)} className="rounded p-1 hover:bg-white/10"><Copy size={12}/></button></div>
    <pre className="max-w-full overflow-x-auto p-4 text-[12px] leading-6"><code className="font-mono" dangerouslySetInnerHTML={{ __html: html }}/></pre>
  </div>
}

function StudyMarkdownView({ content, idPrefix }: { content: string; idPrefix?: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let i = 0, headingIndex = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(), body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      if (i < lines.length) i++
      nodes.push(codeBlock(language, body.join('\n'), `code-${i}`)); continue
    }
    if (line.trim().startsWith('$$')) {
      const body: string[] = []
      const first = line.trim().slice(2)
      if (first.endsWith('$$')) { body.push(first.slice(0, -2)); i++ }
      else {
        if (first) body.push(first)
        i++
        while (i < lines.length && !lines[i].trim().endsWith('$$')) body.push(lines[i++])
        if (i < lines.length) { body.push(lines[i].trim().slice(0, -2)); i++ }
      }
      nodes.push(<div key={`math-${i}`} className="study-display-math my-4 overflow-x-auto py-2 text-center" dangerouslySetInnerHTML={{ __html: formula(body.join('\n'), true) }}/>); continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      nodes.push(<div id={idPrefix ? `study-heading-${idPrefix}-${headingIndex++}` : undefined} key={i} role="heading" aria-level={level} className={`${level === 1 ? 'text-2xl' : level === 2 ? 'text-xl' : level === 3 ? 'text-lg' : 'text-base'} mb-2 mt-6 scroll-mt-20 font-semibold leading-tight first:mt-0`}>{inline(heading[2])}</div>); i++; continue
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
      const callout = /^\[!(定义|定理|例题|注意)\]\s*$/.exec(quote[0] || '')
      if (callout) quote.shift()
      nodes.push(<blockquote key={`quote-${i}`} className={`my-4 rounded-r-2xl border-l-2 px-4 py-3 leading-7 ${callout ? 'study-callout bg-current/[.035]' : 'border-current/25 opacity-80'}`}>{callout && <div className="mb-1 text-[10px] font-semibold tracking-[.2em] opacity-55">{callout[1]}</div>}{quote.map((part, index) => <React.Fragment key={index}>{inline(part)}{index < quote.length - 1 && <br/>}</React.Fragment>)}</blockquote>); continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''))
      nodes.push(<ul key={`list-${i}`} className="my-3 list-disc space-y-1 pl-6">{items.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>); continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))
      nodes.push(<ol key={`ordered-${i}`} className="my-3 list-decimal space-y-1 pl-6">{items.map((item, index) => <li key={index}>{inline(item)}</li>)}</ol>); continue
    }
    if (!line.trim()) { nodes.push(<div key={i} className="h-2"/>); i++; continue }
    const paragraph = [line]
    i++
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !lines[i].trim().startsWith('$$') && !/^(#{1,6})\s+/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])) paragraph.push(lines[i++])
    nodes.push(<p key={`paragraph-${i}`} className="whitespace-pre-wrap break-words leading-8">{paragraph.map((part, index) => <React.Fragment key={index}>{inline(part)}{index < paragraph.length - 1 && <br/>}</React.Fragment>)}</p>)
  }
  return <div className="study-markdown min-w-0">{nodes}</div>
}

export const StudyMarkdown = memo(StudyMarkdownView)
