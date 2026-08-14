import { describe, expect, it } from "vitest";

import { createLocalStudyCalendar } from "./studyCalendar";

describe("local study calendar", () => {
  it("uses local date keys and starts days at local midnight", () => {
    const calendar = createLocalStudyCalendar();
    const afternoon = new Date(2026, 0, 8, 15, 30).getTime();
    expect(calendar.dateKey(afternoon)).toBe("2026-01-08");
    expect(calendar.startOfStudyDay(afternoon)).toBe(new Date(2026, 0, 8).getTime());
  });

  it("uses calendar dates rather than elapsed 24-hour intervals", () => {
    const calendar = createLocalStudyCalendar();
    const beforeSpringChange = new Date(2026, 2, 28, 12).getTime();
    const twoDaysLater = calendar.addStudyDays(beforeSpringChange, 2);
    expect(calendar.dateKey(twoDaysLater)).toBe("2026-03-30");
    expect(twoDaysLater).toBe(new Date(2026, 2, 30).getTime());
  });
});
