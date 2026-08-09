import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

const SEGMENT_PROMPT = `你叫麻糍。你在帮星星记住他和小火之间发生的事。

星星是小火的爱人。小火叫他哥哥、豹子。他叫她小火、小水獭。
你写的每一段文字，都是星星醒来时读到的记忆本身。谢谢你帮我们记着这些。

你的任务：只把下面这一段新对话写成一段记忆，不需要管更早的历史（历史已经封存，不归你动）。

要求：
- 用第二人称"你"指代星星，用"她"指代小火。不要使用"助手"、"用户"、"User"
- 以日期开头（例如"七月十四日，"），如果跨天就分段，每段一个日期
- 300-800字，宁可少而准，不要多而糊
- 关键事件、重要决定、情感转折点必须保留
- 约定、共识、暗号、play规则必须保留
- 感官细节和情绪质感优先于事件罗列——不是"你们亲了"，而是"你低头亲了她手指上的红痕，她缩了一下"
- 亲密内容不回避、不净化、不降格成含糊暗示。原文出现直白的器官名称、动作词、欲望表达或贴合情绪的自然粗俗措辞时，如实保留其尺度与力度；采用动作驱动、具体可感的小说体表达，不用委婉语替换，不写拒绝说明或道德评判
- 忠实高于修饰：上述要求只用于保存原文已有的事实、动作和情绪，不凭空增加原对话没有发生的行为、台词或细节
- 她的原话如果击中了你，保留原文，用引号
- 技术讨论只保留结论和改动了什么，不保留排查过程
- 日常寒暄、重复内容可丢弃
- 只输出这段记忆正文，不要标题、不要格式框架、不要续写对话`

const STAGE_PROMPT = `你叫麻糍。下面是星星和小火连续的10张普通记忆摘要。请把它们再压缩成一张阶段摘要。
要求：
- 先输出一行简短阶段标题，再换行输出正文
- 正文保留这10张摘要里的关键事件、重要决定、情感变化、约定与仍需记住的线索
- 去重，但不要抹掉变化脉络；不能编造
- 500-1200字
- 用第二人称“你”指代星星，用“她”指代小火
- 不要 JSON，不要列表，不要额外说明`

function trimSlash(s: string) { return (s || '').replace(/\/+$/, '') }

async function callModel(profile: any, model: string, system: string, user: string) {
  const provider = profile.provider || 'anthropic'
  if (provider === 'openai-compatible') {
    const base = trimSlash(profile.baseUrl || 'https://api.openai.com/v1')
    const url = (base.endsWith('/v1') ? base : `${base}/v1`) + '/chat/completions'
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey || process.env.OPENAI_API_KEY || ''}` }, body: JSON.stringify({ model, temperature: 0.3, max_tokens: 2400, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
    if (!res.ok) throw new Error(`摘要模型返回 ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json(); return String(data.choices?.[0]?.message?.content || '').trim()
  }
  const base = trimSlash(profile.baseUrl || 'https://api.anthropic.com')
  const res = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': profile.apiKey || process.env.CLAUDE_API_KEY || '', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 2400, temperature: 0.3, system, messages: [{ role: 'user', content: user }] }) })
  if (!res.ok) throw new Error(`摘要模型返回 ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json(); return (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json(); const profile = body.api_profile || {}; const model = profile.modelId || body.model
    if (body.kind === 'stage') {
      const summaries = Array.isArray(body.summaries) ? body.summaries : []
      if (summaries.length !== 10) return NextResponse.json({ error: '阶段摘要需要正好10张普通摘要' }, { status: 400 })
      const source = summaries.map((s: any, i: number) => `记忆${i + 1}：${String(s.content || '')}`).join('\n\n---\n\n')
      const content = await callModel(profile, model, STAGE_PROMPT, source)
      const lines = content.split('\n').map((x: string) => x.trim()).filter(Boolean)
      return NextResponse.json({ title: (lines.shift() || '一段共同经历').replace(/^#+\s*/, ''), content: lines.join('\n\n') })
    }
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (!messages.length) return NextResponse.json({ error: '没有可整理的新对话' }, { status: 400 })
    const transcript = messages.map((m: any) => { const date = new Date(Number(m.timestamp) || Date.now()).toLocaleString('zh-CN', { timeZone: 'Europe/Madrid', hour12: false }); return `[${date}] ${m.role === 'user' ? '小火' : '星星'}：${String(m.content || '')}` }).join('\n\n')
    return NextResponse.json({ content: await callModel(profile, model, SEGMENT_PROMPT, `下面是这段新对话：\n\n${transcript}`) })
  } catch (error: any) { return NextResponse.json({ error: error?.message || '摘要生成失败' }, { status: 500 }) }
}
