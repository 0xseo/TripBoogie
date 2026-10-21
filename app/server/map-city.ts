// Geoapify's city result can be a Chinese district. Select its containing city
// boundary instead: OSM level 5 is a prefecture, level 4 includes municipalities.
// https://wiki.openstreetmap.org/wiki/China/Boundaries
// https://apidocs.geoapify.com/docs/boundaries/
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const municipalityCodes = /^(?:CN-)?(?:BJ|TJ|SH|CQ|11|12|31|50)$/i;
const municipalityNames = /^(?:北京|天津|上海|重庆|重慶)(?:市)?$|^(?:베이징|톈진|상하이|충칭)(?:시)?$|^(?:Beijing|Tianjin|Shanghai|Chongqing)(?: Municipality| City)?$/i;
const cityName = (value: unknown) => /(?:市|시|\sCity|\sMunicipality)$/iu.test(text(value));

function tags(props: Record<string, unknown>) {
  return record(record(props.datasource).raw);
}
function names(props: Record<string, unknown>) {
  const raw = tags(props);
  return [props.name, raw.name, raw["name:zh"], raw["name:zh-Hans"], raw["name:en"]];
}
function municipality(props: Record<string, unknown>) {
  const raw = tags(props);
  return municipalityCodes.test(text(raw["ISO3166-2"]) || text(props.state_code)) ||
    names(props).some(name => municipalityNames.test(text(name)));
}
export function chineseCityBoundary(raw: unknown): Record<string, unknown> | undefined {
  const features = record(raw).features;
  if (!Array.isArray(features)) return;
  const candidates = features.flatMap(feature => {
    const value = record(feature), props = record(value.properties), source = tags(props);
    if (props.country_code && String(props.country_code).toUpperCase() !== "CN") return [];
    const level = Number(source.admin_level ?? props.admin_level);
    // A province must never merge its different cities. Districts at level 6
    // also cannot stand in for the city, even when classified as city_level.
    const rank = level === 4 && municipality(props) ? 0 : level === 5 ? 1 :
      (level === 6 || !Number.isFinite(level)) && names(props).some(cityName) ? 2 : Infinity;
    if (!Number.isFinite(rank) || !text(props.name)) return [];
    const geometry = record(value.geometry), point = geometry.type === "Point" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    return [{ rank, props: { ...props, lat: props.lat ?? point[1], lon: props.lon ?? point[0] } }];
  });
  return candidates.sort((a, b) => a.rank - b.rank)[0]?.props;
}

// If boundaries are unavailable, accept only an explicit parent city. Never
// fall back to the district's name/place_id or to an arbitrary province.
export function chineseParentCity(raw: unknown): Record<string, unknown> | undefined {
  const features = record(raw).features;
  if (!Array.isArray(features)) return;
  for (const feature of features) {
    const props = record(record(feature).properties), source = tags(props);
    const parent = [props.county, props.city, props.state].find(value =>
      cityName(value) || municipalityNames.test(text(value)));
    const ownCity = names(props).some(cityName) && Number(source.admin_level) <= 5;
    const name = text(parent) || (ownCity ? text(props.name) : "");
    if (name) return { ...props, name, city: name, place_id: undefined };
  }
}
