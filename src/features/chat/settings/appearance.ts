import type { CSSProperties } from 'react'
import type { ChatAppearance } from '../state/types'

export function bubbleAppearance(ap: ChatAppearance, who: 'user' | 'ai', night: boolean): CSSProperties {
  const suffix = night ? 'Night' : ''
  const read = (name: string) => ap[`${who}Bubble${name}${suffix}` as keyof ChatAppearance]
  const custom = String(read('Color') || '')
  const fallback = who === 'user' ? (night ? '#e2a84b' : '#f3a4ac') : (night ? '#243040' : '#ffffff')
  const color = /^#[0-9a-f]{6}$/i.test(custom) ? custom : fallback
  const rawOpacity = Number(read('Opacity') ?? 1)
  const opacity = (Number.isFinite(rawOpacity) ? Math.max(.1, Math.min(1, rawOpacity)) : 1) * (!custom && who === 'user' && night ? .2 : 1)
  const rawBlur = Number(read('Blur') ?? 2)
  const blur = read('Frosted') === false ? 0 : Number.isFinite(rawBlur) ? Math.max(0, Math.min(20, rawBlur)) : 2
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
  const backdrop = night ? [15, 20, 25] : [255, 249, 245]
  const linear = rgb.map((channel, i) => {
    const c = (channel * opacity + backdrop[i] * (1 - opacity)) / 255
    return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4)
  })
  const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
  return {
    backgroundColor: `rgba(${rgb.join(', ')}, ${opacity})`,
    color: luminance > .38 ? '#4a3428' : '#f3e7dc',
    backdropFilter: blur ? `blur(${blur}px)` : 'none',
    WebkitBackdropFilter: blur ? `blur(${blur}px)` : 'none',
  }
}
