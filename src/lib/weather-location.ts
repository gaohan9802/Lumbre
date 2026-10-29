const placeKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()

export function compactLocationParts(address: Record<string, any>, fallback: Record<string, any> = {}) {
  const road = address.road || address.pedestrian || address.footway || address.neighbourhood || ''
  const houseNumber = address.house_number || ''
  const city = address.city || address.town || address.village || address.county
    || fallback.city || fallback.locality || fallback.principalSubdivision || ''
  const region = address.state || address.region || address.province || fallback.principalSubdivision || ''
  const area = [region, city].filter((value, index, values) => value && values.findIndex(other => placeKey(other) === placeKey(value)) === index)
  return {
    road,
    houseNumber,
    city,
    region,
    displayAddress: [[road, houseNumber].filter(Boolean).join(' '), area.join(' · ')].filter(Boolean).join('\n'),
  }
}
