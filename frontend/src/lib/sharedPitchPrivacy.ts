/** Opaque name references written by any app version ("pitch:" or "pitchname:"). */
export function isPitchNameRef(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('pitch:') || value.startsWith('pitchname:'));
}

/** Mask nested roster/substitution/goal names before shared state leaves a device. */
export function maskSharedPitchNames(pitch: Record<string, unknown>, prefix: string) {
  const names = new Map<string, string>();
  function walk(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${path}:${index}`));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [field, child] of Object.entries(record)) {
      if (field === 'name' && typeof child === 'string' && child.trim()) {
        const ref = isPitchNameRef(child) ? child : `${prefix}${typeof record.id === 'string' ? record.id : path}`;
        if (ref !== child) names.set(ref, child.trim());
        result[field] = ref;
      } else result[field] = walk(child, `${path}:${field}`);
    }
    return result;
  }
  return { pitch: walk(pitch, 'state') as Record<string, unknown>, names };
}

export function sharedPitchNameRefs(value: unknown): string[] {
  const refs = new Set<string>();
  function walk(item: unknown) {
    if (Array.isArray(item)) { item.forEach(walk); return; }
    if (!item || typeof item !== 'object') return;
    for (const [field, child] of Object.entries(item)) {
      if (field === 'name' && isPitchNameRef(child)) refs.add(child);
      else walk(child);
    }
  }
  walk(value);
  return [...refs];
}

export function resolveSharedPitchNames(value: unknown, names: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => resolveSharedPitchNames(item, names));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([field, child]) => [field,
    field === 'name' && isPitchNameRef(child)
      ? resolvedName(names.get(child)) : resolveSharedPitchNames(child, names)]));
}
/** A stored value that is itself a reference (older saves) is not a real name. */
function resolvedName(value: string | undefined) {
  return value && value.trim() && !isPitchNameRef(value) ? value : 'Player';
}

/**
 * Replace placeholder names ("Player", empty, or an unread code) on every
 * nested {id, name} record (players, substitutions, swaps) using `lookup`.
 */
export function repairPitchPlaceholderNames<T>(value: T, lookup: (id: string) => string | undefined): T {
  function walk(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [field, child] of Object.entries(record)) next[field] = walk(child);
    const name = record.name;
    if (typeof record.id === 'string' && (name === undefined || typeof name === 'string')
      && (!name || name === 'Player' || isPitchNameRef(name)) && 'name' in record) {
      const real = lookup(record.id);
      if (real && real !== 'Player' && !isPitchNameRef(real)) next.name = real;
    }
    return next;
  }
  return walk(value) as T;
}
