export type TravelCompanion = 'solo' | 'star' | 'other'
export type TravelMapView = 'all' | 'solo' | 'star'

export interface TravelVisit {
  id: string
  place_id: string
  place_name: string
  address: string
  lat: number
  lon: number
  start_date: string
  end_date: string | null
  companion: TravelCompanion
  companion_name: string
  note: string
  album_id: string | null
  created_at: string
  updated_at: string | null
}

export interface TravelPlaceResult {
  place_id: string
  name: string
  address: string
  lat: number
  lon: number
}

export interface TravelPlaceGroup {
  place_id: string
  name: string
  address: string
  lat: number
  lon: number
  visits: TravelVisit[]
}

export function projectTravelPoint(lat: number, lon: number) {
  return {
    x: Math.max(0, Math.min(100, ((lon + 180) / 360) * 100)),
    y: Math.max(0, Math.min(100, ((90 - lat) / 180) * 100)),
  }
}

export function groupTravelVisits(visits: TravelVisit[], view: TravelMapView): TravelPlaceGroup[] {
  const filtered = visits.filter(visit => view === 'all' || visit.companion === view)
  const groups = new Map<string, TravelPlaceGroup>()
  for (const visit of filtered) {
    const current = groups.get(visit.place_id)
    if (current) current.visits.push(visit)
    else groups.set(visit.place_id, {
      place_id: visit.place_id, name: visit.place_name, address: visit.address,
      lat: visit.lat, lon: visit.lon, visits: [visit],
    })
  }
  return Array.from(groups.values())
    .map(group => ({ ...group, visits: group.visits.sort((a, b) => b.start_date.localeCompare(a.start_date)) }))
    .sort((a, b) => b.visits[0].start_date.localeCompare(a.visits[0].start_date))
}
