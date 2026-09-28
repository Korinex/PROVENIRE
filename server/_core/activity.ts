export const MAX_ACTIVITY_ENTRIES = 50;

export function prependActivity<T>(entries: T[], entry: T): void {
  entries.unshift(entry);
  if (entries.length > MAX_ACTIVITY_ENTRIES) {
    entries.length = MAX_ACTIVITY_ENTRIES;
  }
}