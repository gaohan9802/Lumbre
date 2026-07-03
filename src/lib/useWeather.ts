'use client'

/**
 * Weather + city for the top bar.
 * Geolocation → /api/weather (open-meteo + reverse geocode) → 30min sessionStorage cache.
 */
import { useEffect, useState } from 'react'

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

  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null')
      if (cached && Date.now() - cached.at < CACHE_MS) {
        setData(cached.data)
        return
      }
    } catch {}

    if (typeof navigator === 'undefined' || !navigator.geolocation) return

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
      },
      () => {},
      { timeout: 10000, maximumAge: 600000 }
    )
  }, [])

  return data
}
