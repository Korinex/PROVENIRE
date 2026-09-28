import { describe, expect, it } from "vitest";
import { MAX_ACTIVITY_ENTRIES, prependActivity } from "./_core/activity";

describe("bounded activity history", () => {
  it("keeps only the newest entries at the configured maximum", () => {
    const entries = Array.from({ length: MAX_ACTIVITY_ENTRIES }, (_, index) => index);
    prependActivity(entries, MAX_ACTIVITY_ENTRIES);

    expect(entries).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(entries[0]).toBe(MAX_ACTIVITY_ENTRIES);
    expect(entries.at(-1)).toBe(MAX_ACTIVITY_ENTRIES - 2);
  });
});