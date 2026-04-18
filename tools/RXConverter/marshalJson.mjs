/**
 * JSON-safe serialization for `@hyrious/marshal` loaded values.
 *
 * Goal: preserve *everything* (events, bgm, etc.) in a plain JSON form that can be
 * turned back into the same marshal object graph for `dump()`.
 */

const TYPE = '__mfType'

function symToKey(s) {
  const k = Symbol.keyFor(s)
  return k != null ? k : String(s)
}

function keyToSym(k) {
  // `@hyrious/marshal` uses Symbol.for for Ruby symbols; we mirror that.
  return Symbol.for(k)
}

export function toJsonable(value) {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'number' || t === 'boolean' || t === 'string') return value

  if (value instanceof Uint8Array) {
    return {
      [TYPE]: 'bytes',
      encoding: 'base64',
      data: Buffer.from(value).toString('base64'),
    }
  }

  if (Array.isArray(value)) return value.map(toJsonable)

  // Marshal wrapper objects (RubyObject / RubyStruct / RubyHash, etc.) are regular JS objects.
  // We encode:
  // - symbol keys in objects
  // - `.class` for RubyObject/RubyStruct when present
  // - known special fields (`userDefined`, `wrapped`, `members`, `entries`, `default`, ...)
  if (typeof value === 'object') {
    const out = {}

    // Preserve Ruby class symbol if present.
    if (typeof value.class === 'symbol') {
      out[TYPE] = 'rubyObject'
      out.class = symToKey(value.class)
    }

    // Preserve symbol keys + string keys
    for (const k of Reflect.ownKeys(value)) {
      if (k === 'class') continue
      const v = value[k]
      if (typeof k === 'symbol') {
        out[`$sym:${symToKey(k)}`] = toJsonable(v)
      } else {
        out[k] = toJsonable(v)
      }
    }

    return out
  }

  return value
}

export function fromJsonable(value) {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'number' || t === 'boolean' || t === 'string') return value

  if (Array.isArray(value)) return value.map(fromJsonable)

  if (typeof value === 'object') {
    if (value[TYPE] === 'bytes') {
      if (value.encoding !== 'base64' || typeof value.data !== 'string') {
        throw new Error('Invalid bytes payload in JSON.')
      }
      return new Uint8Array(Buffer.from(value.data, 'base64'))
    }

    // Rehydrate objects; keep `.class` as Symbol.for when present (RubyObject compatible).
    const out = {}
    if (value[TYPE] === 'rubyObject') {
      out.class = keyToSym(value.class)
    }

    for (const [k, v] of Object.entries(value)) {
      if (k === TYPE) continue
      if (k === 'class' && value[TYPE] === 'rubyObject') continue
      if (k.startsWith('$sym:')) {
        const sk = k.slice('$sym:'.length)
        out[keyToSym(sk)] = fromJsonable(v)
      } else {
        out[k] = fromJsonable(v)
      }
    }

    return out
  }

  return value
}

