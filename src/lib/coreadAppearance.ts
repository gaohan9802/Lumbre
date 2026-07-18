// Co-reading appearance store (background image + chat bubbles), day/night
// independent. Persisted in localStorage, separate from the 星星 chat module.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CoreadAppearance {
  bgImage: string
  bgOpacity: number
  // Day-mode bubbles
  userBubbleColor: string
  userBubbleOpacity: number
  aiBubbleColor: string
  aiBubbleOpacity: number
  // Night-mode bubbles (independent from day)
  userBubbleColorNight: string
  userBubbleOpacityNight: number
  aiBubbleColorNight: string
  aiBubbleOpacityNight: number
}

export const DEFAULT_COREAD_APPEARANCE: CoreadAppearance = {
  bgImage: '',
  bgOpacity: 0.3,
  userBubbleColor: '',
  userBubbleOpacity: 1,
  aiBubbleColor: '',
  aiBubbleOpacity: 1,
  userBubbleColorNight: '',
  userBubbleOpacityNight: 1,
  aiBubbleColorNight: '',
  aiBubbleOpacityNight: 1,
}

interface Store {
  ap: CoreadAppearance
  set: (patch: Partial<CoreadAppearance>) => void
  reset: () => void
}

export const useCoreadAppearance = create<Store>()(
  persist(
    (set) => ({
      ap: DEFAULT_COREAD_APPEARANCE,
      set: (patch) => set((s) => ({ ap: { ...s.ap, ...patch } })),
      reset: () => set({ ap: { ...DEFAULT_COREAD_APPEARANCE } }),
    }),
    {
      name: 'coread-appearance',
      merge: (persisted: any, current) => ({
        ...current,
        ...(persisted || {}),
        ap: { ...DEFAULT_COREAD_APPEARANCE, ...(persisted?.ap || {}) },
      }),
    },
  ),
)

export async function fileToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
  if (raw.length < 900_000) return raw
  const img = document.createElement('img')
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = raw })
  const scale = Math.min(1, 1920 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}
