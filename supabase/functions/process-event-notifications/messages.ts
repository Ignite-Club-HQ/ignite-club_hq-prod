export interface ChangedField {
  field: string;
  old: string | null;
  new: string | null;
}

// Build a human-readable update message from changed fields
export function buildUpdateMessage(title: string, changedFields: ChangedField[]): string {
  const fieldLabels: Record<string, string> = {
    date: 'date',
    start_time: 'kick-off time',
    meet_time: 'meet time',
    location: 'venue',
    address: 'address',
    title: 'title',
    opponent: 'opponent',
  };

  const changedNames = changedFields
    .map(f => fieldLabels[f.field] || f.field)
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  if (changedNames.length === 1) {
    return `📅 ${title} updated: new ${changedNames[0]}`;
  }
  return `📅 ${title} updated: ${changedNames.slice(0, -1).join(', ')} & ${changedNames[changedNames.length - 1]} changed`;
}
