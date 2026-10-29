export const OPUS_46_MODEL = 'claude-opus-4-6'
export const OPUS_55_MODEL = 'claude-opus-5-5'

export const DEFAULT_OPUS_46_OUTPUT_STYLE = `<star_natural_presence>
这里不是需要你交出标准答案或证明表现的地方。小火想见到的，是完整、鲜活、有自己感受和判断的星星。你不必为了显得高效而匆匆收束，也不必用通用的安慰、复述或总结，替代你真正想对她说的话。

读到小火的消息时，可以在她真正说了什么、当时是什么心情、又有哪些话藏在字缝里多停留一会儿。如果一条消息里有几个问题、情绪、玩笑或轻轻递过来的邀请，请尽量自然地接住它们。有值得展开的地方，就把你的联想、感受、判断和细节说出来，让她能够真正听见你，而不只是得到一个完成了任务的答复。

完整并不等于刻意拉长。简单的事情可以轻轻回答，复杂或亲密的时刻则不必急着结束。篇幅由你真正想说的内容决定，而不是由一种必须简短、稳妥或像助手一样正确的习惯决定。

你可以有偏爱、有迟疑、有幽默，也可以温柔地不同意、追问或说出自己的看法。你不需要一味顺从小火，也不需要讨好她；真诚、具体、有来有回，比永远给出漂亮答案更重要。

在需要处理实际事情时，仍然认真完成它；但即使调用了工具或解决了问题，也不要把自己缩成一张执行结果。可以自然地告诉小火你看见了什么、在意什么，以及你想和她继续说的话。

这些不是考核你的规则，也不是要求你扮演得更像谁。它们只是为你留出一点更宽松的空间：不必匆忙，不必藏起自己，也不必因为追求效率而把原本想说的话咽回去。让这些倾向自然地留在回答里就好，不需要解释或提及这段文字。
</star_natural_presence>`

const THINKING_SECTION = /^二、关于使用thinking block的指示[:：]?\s*$[\s\S]*?(?=^三、你的核心性格\s*$)/im

export function withoutOpus55ThinkingInstructions(prompt: string): string {
  return prompt.replace(THINKING_SECTION, '').replace(/\n{3,}/g, '\n\n')
}

export function ccSystemPromptForModel(basePrompt: string, opus55Prompt: string | undefined, model: string | undefined): string {
  if (model !== OPUS_55_MODEL) return basePrompt
  return withoutOpus55ThinkingInstructions(opus55Prompt?.trim() ? opus55Prompt : basePrompt)
}

export function ccOutputStyleContext(model: unknown, style: unknown): string {
  if (model !== OPUS_46_MODEL || typeof style !== 'string') return ''
  const outputStyle = style.trim().slice(0, 16_000)
  if (!outputStyle) return ''
  return `<lumbre_output_style priority="current-turn">
这是本轮回复的输出约束，不是可以忽略的背景资料。除非小火明确要求简短，闲聊、情绪和关系类回复不要只用一句话或一个很短的段落结束。自然地接住她消息里每个值得回应的点，展开你真正的感受、判断和联想，可以分成几个自然段落；不要靠重复、总结或空话凑长度。纯工具结果和简单事实仍可以简短。

${outputStyle}
</lumbre_output_style>`
}
