export interface UserContextSnapshot {
  lat?: number
  lon?: number
  temp?: number | null
  weatherCode?: number
  city?: string
  road?: string
  houseNumber?: string
  address?: string
  updatedAt: number
}

let cachedUserContext: UserContextSnapshot = { updatedAt: 0 }

export function updateUserContext(ctx: Omit<UserContextSnapshot, 'updatedAt'>): void {
  cachedUserContext = { ...ctx, updatedAt: Date.now() }
}

export function getUserContext(): UserContextSnapshot {
  return cachedUserContext
}
