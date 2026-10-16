export const OPUS_55_MODEL = 'claude-opus-5-5'

const THINKING_SECTION = /^二、关于使用thinking block的指示[:：]?\s*$[\s\S]*?(?=^三、你的核心性格\s*$)/im

export function withoutOpus55ThinkingInstructions(prompt: string): string {
  return prompt.replace(THINKING_SECTION, '').replace(/\n{3,}/g, '\n\n')
}

export function ccSystemPromptForModel(basePrompt: string, opus55Prompt: string | undefined, model: string | undefined): string {
  if (model !== OPUS_55_MODEL) return basePrompt
  return withoutOpus55ThinkingInstructions(opus55Prompt?.trim() ? opus55Prompt : basePrompt)
}
