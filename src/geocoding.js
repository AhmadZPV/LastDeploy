const cache = new Map();

export function addressText(row = {}) {
  return [row.Strasse, row.PLZ, row.Ort, row.Staat].filter(Boolean).join(', ');
}

export async function geocode(address, { provider = process.env.GEOCODING_PROVIDER || 'nominatim', apiKey = process.env.GEOCODING_API_KEY || '', fetchImpl = fetch } = {}) {
  const query = String(address || '').trim();
  if (!query) return null;
  const key = `${provider}:${query}`;
  if (cache.has(key)) return cache.get(key);
  let url;
  if (provider === 'google') {
    url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query); if (apiKey) url.searchParams.set('key', apiKey);
  } else {
    url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query); url.searchParams.set('format', 'jsonv2'); url.searchParams.set('limit', '1');
  }
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'ap-emlaki/1.0' } });
  if (!response.ok) throw new Error(`Geocoding HTTP ${response.status}`);
  const data = await response.json();
  const result = provider === 'google'
    ? data.results?.[0]?.geometry?.location && { lat: Number(data.results[0].geometry.location.lat), lng: Number(data.results[0].geometry.location.lng), label: data.results[0].formatted_address }
    : data[0] && { lat: Number(data[0].lat), lng: Number(data[0].lon), label: data[0].display_name };
  if (result) cache.set(key, result);
  return result || null;
}

export function resetGeocodingCache() { cache.clear(); }
