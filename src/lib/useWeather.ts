'use client'

/**
 * Weather + city for the top bar.
 * Geolocation → /api/weather (open-meteo + reverse geocode) → 30min cache.
 * Refreshes automatically when the tab regains visibility/focus so weather &
 * location stay current even if the user never opens a specific page.
 * Location is requested silently (no custom prompt) — default authorize.
 */
import { useEffect, useState, useRef, useCallback } from 'react'

export interface WeatherInfo {
  temp: number | null
  code: number
  city: string
}

const CACHE_KEY = 'lumbre-weather'
const CACHE_MS = 30 * 60 * 1000

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

export function useWeather(): WeatherInfo | null {
  const [data, setData] = useState<WeatherInfo | null>(null)
  const fetching = useRef(false)

  const refresh = useCallback((force = false) => {
    // serve fresh cache unless forced
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null')
      if (cached && Date.now() - cached.at < CACHE_MS) {
        setData(cached.data)
        if (!force) return
      }
    } catch {}

    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    if (fetching.current) return
    fetching.current = true

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch('/api/weather', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          })
          const d = await res.json()
          if (d && typeof d.code === 'number') {
            setData(d)
            try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: d })) } catch {}
          }
        } catch {}
        fetching.current = false
      },
      () => { fetching.current = false },
      { timeout: 10000, maximumAge: 600000 }
    )
  }, [])

  useEffect(() => {
    refresh()

    // Re-confirm weather + location whenever the tab becomes visible again or
    // regains focus, but only if the cache has gone stale — cheap and avoids
    // the "user never opens the page so it never updates" problem.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      let stale = true
      try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null')
        stale = !cached || Date.now() - cached.at >= CACHE_MS
      } catch {}
      if (stale) refresh(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    // periodic top-up while the app stays open
    const timer = setInterval(() => refresh(true), CACHE_MS)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(timer)
    }
  }, [refresh])

  return data
}
