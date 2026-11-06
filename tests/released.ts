// The registries' answer to "when was this version published", for tests
// whose upgrades are old enough to go up: each answer has the date where its
// registry puts it. A URL `young` names (by a part of it, such as
// "serde/1.0.229") answers with that date instead.

export const OLD = '2025-01-01T00:00:00.000Z'

type Response = { value: { status: number; ok: boolean; headers: Record<string, string>; text: string } }

const RELEASED = [
  /^https:\/\/pypi\.org\/pypi\/[^/]+\/[^/]+\/json$/,
  /^https:\/\/crates\.io\/api\/v1\/crates\/[^/]+\/[^/]+$/,
  /^https:\/\/proxy\.golang\.org\/.+\/@v\/[^/]+\.info$/,
  /^https:\/\/pub\.dev\/api\/packages\/[^/]+\/versions\/[^/]+$/,
  /^https:\/\/api\.nuget\.org\/v3\/registration5-semver1\//,
  /^https:\/\/rubygems\.org\/api\/v2\/rubygems\//,
  /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/tags\//,
  /\.pom$/,
]

export function released(url: string, young: Record<string, string> = {}): Response | undefined {
  if (!RELEASED.some(re => re.test(url))) return undefined
  // As the Go proxy: a +incompatible version is not served under /vN.
  if (/\/v\d+\/@v\/[^/]+\+incompatible\.info$/.test(url)) return { value: { status: 404, ok: false, headers: {}, text: 'not found' } }
  const at = Object.entries(young).find(([part]) => url.includes(part))?.[1] ?? OLD
  const text = JSON.stringify({
    urls: [{ upload_time_iso_8601: at }],
    version: { created_at: at },
    Time: at,
    published: at,
    created_at: at,
    published_at: at,
  })
  return { value: { status: 200, ok: true, headers: { 'last-modified': new Date(at).toUTCString() }, text } }
}
