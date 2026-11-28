/** PostgREST joins may be represented as one object or an array. */
export function joinedRelation<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}