// A small TOML reader: enough for Cargo.toml, Cargo.lock, pyproject.toml,
// poetry.lock and uv.lock. Tables, arrays of tables, dotted and quoted keys,
// basic, literal and multi-line strings, numbers, booleans, dates as text,
// arrays and inline tables. Pure: no I/O.

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable
export type TomlTable = { [key: string]: TomlValue }

export function parseToml(text: string): TomlTable {
  const root: TomlTable = {}
  let table = root
  let i = 0
  const s = text

  const fail = (what: string): never => {
    throw new Error(`TOML: ${what} at offset ${i}`)
  }
  const skipInline = () => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++
    if (s[i] === '#') while (i < s.length && s[i] !== '\n') i++
  }
  const skipAll = () => {
    for (;;) {
      skipInline()
      if (s[i] === '\r' || s[i] === '\n') i++
      else return
    }
  }

  const readString = (): string => {
    const quote = s[i] as string
    const triple = s.startsWith(quote.repeat(3), i)
    if (triple) {
      i += 3
      if (s[i] === '\r') i++
      if (s[i] === '\n') i++
      const end = s.indexOf(quote.repeat(3), i)
      if (end < 0) fail('unclosed string')
      const raw = s.slice(i, end)
      i = end + 3
      return quote === '"' ? unescape(raw.replace(/\\\r?\n\s*/g, '')) : raw
    }
    i++
    let out = ''
    while (i < s.length && s[i] !== quote) {
      if (s[i] === '\n') fail('newline in string')
      if (quote === '"' && s[i] === '\\') {
        out += s.slice(i, i + 2)
        i += 2
        if (s[i - 1] === 'u') {
          out += s.slice(i, i + 4)
          i += 4
        } else if (s[i - 1] === 'U') {
          out += s.slice(i, i + 8)
          i += 8
        }
        continue
      }
      out += s[i]
      i++
    }
    if (s[i] !== quote) fail('unclosed string')
    i++
    return quote === '"' ? unescape(out) : out
  }

  const readKeyPart = (): string => {
    skipInline()
    if (s[i] === '"' || s[i] === "'") return readString()
    const start = i
    while (i < s.length && /[A-Za-z0-9_-]/.test(s[i] as string)) i++
    if (i === start) fail('key')
    return s.slice(start, i)
  }
  const readKey = (): string[] => {
    const parts = [readKeyPart()]
    skipInline()
    while (s[i] === '.') {
      i++
      parts.push(readKeyPart())
      skipInline()
    }
    return parts
  }

  const readValue = (): TomlValue => {
    skipInline()
    const c = s[i]
    if (c === '"' || c === "'") return readString()
    if (c === '[') {
      i++
      const list: TomlValue[] = []
      for (;;) {
        skipAll()
        if (s[i] === ']') {
          i++
          return list
        }
        list.push(readValue())
        skipAll()
        if (s[i] === ',') i++
        else if (s[i] !== ']') fail('array')
      }
    }
    if (c === '{') {
      i++
      const inline: TomlTable = {}
      skipInline()
      if (s[i] === '}') {
        i++
        return inline
      }
      for (;;) {
        const key = readKey()
        skipInline()
        if (s[i] !== '=') fail('=')
        i++
        setPath(inline, key, readValue())
        skipInline()
        if (s[i] === ',') i++
        else if (s[i] === '}') {
          i++
          return inline
        } else fail('inline table')
      }
    }
    // A bare value runs to a delimiter: true, false, a number or a date.
    const start = i
    while (i < s.length && !/[,\]}\r\n#]/.test(s[i] as string)) i++
    const raw = s.slice(start, i).trim()
    if (raw === 'true') return true
    if (raw === 'false') return false
    const n = Number(raw.replace(/_/g, ''))
    return raw !== '' && Number.isFinite(n) ? n : raw
  }

  while (i < s.length) {
    skipAll()
    if (i >= s.length) break
    if (s[i] === '[') {
      const isArray = s[i + 1] === '['
      i += isArray ? 2 : 1
      const key = readKey()
      skipInline()
      if (s[i] !== ']' || (isArray && s[i + 1] !== ']')) fail('table header')
      i += isArray ? 2 : 1
      table = isArray ? appendTable(root, key) : tableAt(root, key)
      continue
    }
    const key = readKey()
    skipInline()
    if (s[i] !== '=') fail('=')
    i++
    setPath(table, key, readValue())
    skipInline()
  }
  return root
}

function unescape(text: string): string {
  return text.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (_, e: string) => {
    if (e.length > 1) return String.fromCodePoint(parseInt(e.slice(1), 16))
    return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\' } as Record<string, string>)[e] ?? e
  })
}

function tableAt(root: TomlTable, path: string[]): TomlTable {
  let t = root
  for (const part of path) {
    const next = t[part]
    if (Array.isArray(next)) {
      const last = next[next.length - 1]
      t = (last && typeof last === 'object' && !Array.isArray(last) ? last : {}) as TomlTable
    } else if (next && typeof next === 'object') t = next
    else {
      const made: TomlTable = {}
      t[part] = made
      t = made
    }
  }
  return t
}

function appendTable(root: TomlTable, path: string[]): TomlTable {
  const parent = tableAt(root, path.slice(0, -1))
  const last = path[path.length - 1] as string
  const list = Array.isArray(parent[last]) ? (parent[last] as TomlValue[]) : []
  parent[last] = list
  const made: TomlTable = {}
  list.push(made)
  return made
}

function setPath(table: TomlTable, path: string[], value: TomlValue): void {
  tableAt(table, path.slice(0, -1))[path[path.length - 1] as string] = value
}

// A table's own value at `key`, when it is a table.
export function tableOf(value: TomlValue | undefined): TomlTable | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}
