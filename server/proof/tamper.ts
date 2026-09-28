export function tamperClone<T>(events: T[], eventIndex: number, path: (string | number)[], newValue: unknown): T[] {
  const clone = structuredClone(events);
  let cursor: any = clone[eventIndex];
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = newValue;
  return clone;
}
