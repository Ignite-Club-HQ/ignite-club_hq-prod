// Pure rule: settings that existed before a merge upgrade must survive it.
// Anything present before wins; settings newly added by the upgrade are kept.
const canon = rows => rows.map(r => ({ name: r.name, value: r.value })).sort((a, b) => a.name.localeCompare(b.name));

export function restoredSettings(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) throw new Error('Settings could not be read');
  const merged = new Map(after.map(r => [r.name, r.value]));
  for (const r of before) merged.set(r.name, r.value);
  const next = canon([...merged].map(([name, value]) => ({ name, value })));
  return { next, changed: JSON.stringify(next) !== JSON.stringify(canon(after)) };
}
