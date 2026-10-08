'use client'

/**
 * Weather + city for the top bar.
 * Geolocation → /api/weather (open-meteo + reverse geocode) → shared server snapshot.
 * Refreshes automatically when the tab regains visibility/focus so weather &
 * location stay current even if the user never opens a specific page.
 * Location is requested silently (no custom prompt) — default authorize.
 *
 * GPS de-jitter: takes 2–3 fixes, drops obvious outliers, keeps the most
 * accurate/clustered one, and rejects fixes that jump absurdly far (>500km)
 * from both Madrid (the user's base) and the last accepted position.
 */
import { useEffect, useState, useRef, useCallback } from 'react'

export interface WeatherInfo {
  temp: number | null
  code: number
  city: string
  lat: number
  lon: number
  accuracy?: number
  road?: string
  houseNumber?: string
  address?: string
  updatedAt: number
}

const LASTPOS_KEY = 'lumbre-lastpos'
const CACHE_MS = 30 * 60 * 1000

// User's base — anything wildly far from here (and from the last good fix) is
// treated as GPS drift and discarded.
const BASE = { lat: 40.4168, lon: -3.7038 } // Madrid
const JUMP_KM = 500

interface Fix { lat: number; lon: number; accuracy: number }

export function weatherEmoji(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code <= 48) return '🌫️'
  if (code <= 57) return '🌦️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '🌨️'
  if (code <= 82) return '🌦️'
  if (code <= 86) return '🌨️'
  return '⛈️'
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function getFix(): Promise<Fix | null> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy || 9999 }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  })
}

function readLastPos(): { lat: number; lon: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LASTPOS_KEY) || 'null')
    if (v && typeof v.lat === 'number' && typeof v.lon === 'number') return v
  } catch {}
  return null
}

/** Take up to 3 fixes, drop drift, and return the most reliable coordinate. */
async function bestPosition(): Promise<Fix | null> {
  const fixes: Fix[] = []
  for (let i = 0; i < 3; i++) {
    const f = await getFix()
    if (f) fixes.push(f)
  }
  if (!fixes.length) return null

  const lastPos = readLastPos()

  // Reject fixes that are absurdly far from BOTH Madrid and the last good fix.
  const plausible = fixes.filter((f) => {
    const farFromBase = haversineKm(f, BASE) > JUMP_KM
    const farFromLast = lastPos ? haversineKm(f, lastPos) > JUMP_KM : farFromBase
    return !(farFromBase && farFromLast)
  })

  const pool = plausible.length ? plausible : fixes

  // Prefer the fix closest to the cluster median, tie-broken by GPS accuracy.
  const medLat = [...pool].sort((a, b) => a.lat - b.lat)[Math.floor(pool.length / 2)].lat
  const medLon = [...pool].sort((a, b) => a.lon - b.lon)[Math.floor(pool.length / 2)].lon
  const median = { lat: medLat, lon: medLon }
  pool.sort((a, b) => {
    const da = haversineKm(a, median)
    const db = haversineKm(b, median)
    if (Math.abs(da - db) > 0.05) return da - db
    return a.accuracy - b.accuracy
  })
  const chosen = pool[0]
  const result = { lat: chosen.lat, lon: chosen.lon, accuracy: chosen.accuracy }
  try { localStorage.setItem(LASTPOS_KEY, JSON.stringify(result)) } catch {}
  return result
}

export function useWeather() {
  const [data, setData] = useState<WeatherInfo | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<Promise<WeatherInfo | null> | null>(null)

  const refresh = useCallback((force = false, maxAgeMs = CACHE_MS): Promise<WeatherInfo | null> => {
    if (pending.current) return pending.current
    pending.current = (async () => {
      setRefreshing(true)
      setError('')
      try {
        const currentRes = await fetch('/api/weather', { cache: 'no-store' })
        const current = currentRes.ok ? await currentRes.json() as WeatherInfo : null
        if (current?.updatedAt) setData(current)
        if (!force && current?.updatedAt && Date.now() - current.updatedAt < maxAgeMs) return current
        if (typeof navigator === 'undefined' || !navigator.geolocation) throw new Error('这台设备不支持定位')

        const pos = await bestPosition()
        if (!pos) throw new Error('没有拿到定位，请检查浏览器定位权限')
        const res = await fetch('/api/weather', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pos),
        })
        if (!res.ok) throw new Error('位置保存失败')
        const next = await res.json() as WeatherInfo
        setData(next)
        return next
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '位置刷新失败')
        return null
      } finally {
        setRefreshing(false)
        pending.current = null
      }
    })()
    return pending.current
  }, [])

  useEffect(() => {
    void refresh()

    // Re-confirm weather + location whenever the tab becomes visible again or
    // regains focus, but only if the cache has gone stale.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void refresh(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const timer = setInterval(() => refresh(true), CACHE_MS)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(timer)
    }
  }, [refresh])

  return { data, refreshing, error, refresh }
}
