import { describe, expect, it } from "vitest";
import { addDays, hourIn, isDeliveryDateAllowed, isoWeekdayIn, parseDateInput, todayIn } from "@/lib/dates";

describe("dates", () => {
  it("accepts real calendar days only", () => {
    expect(parseDateInput("2026-11-05")).toBe("2026-11-05");
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("5.11.2026")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });
  it("computes today in the given timezone, not UTC", () => {
    const now = new Date("2026-11-04T21:30:00Z"); // 01:30 on the 5th in Tbilisi (UTC+4)
    expect(todayIn("Asia/Tbilisi", now)).toBe("2026-11-05");
    expect(todayIn("UTC", now)).toBe("2026-11-04");
  });
  it("allows today up to 90 days ahead", () => {
    expect(isDeliveryDateAllowed("2026-11-04", "2026-11-04")).toBe(true);
    expect(isDeliveryDateAllowed("2026-11-03", "2026-11-04")).toBe(false);
    expect(isDeliveryDateAllowed(addDays("2026-11-04", 90), "2026-11-04")).toBe(true);
    expect(isDeliveryDateAllowed(addDays("2026-11-04", 91), "2026-11-04")).toBe(false);
  });
  it("gives the local weekday (Mon=1) and hour", () => {
    const now = new Date("2026-11-08T21:30:00Z"); // Sunday 21:30 UTC = Monday 01:30 in Tbilisi
    expect(isoWeekdayIn("UTC", now)).toBe(7);
    expect(isoWeekdayIn("Asia/Tbilisi", now)).toBe(1);
    expect(hourIn("Asia/Tbilisi", now)).toBe(1);
    expect(hourIn("UTC", new Date("2026-11-08T00:05:00Z"))).toBe(0);
  });
});
