export function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError("undefined is not valid for canonical JSON");
  if (typeof value === "function") throw new TypeError("functions are not valid for canonical JSON");
  if (typeof value === "symbol") throw new TypeError("symbols are not valid for canonical JSON");
  if (typeof value === "bigint") throw new TypeError("bigint is not valid for canonical JSON");

  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite numbers are not valid for canonical JSON");
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }

  throw new TypeError(`Unsupported value type: ${typeof value}`);
}
