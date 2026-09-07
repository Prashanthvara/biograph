import { describe, it, expect } from "vitest";
import { parsePanelReport, isOutOfRange } from "../src/panel";
import { panelReportSchema } from "../src/panel-schema";

const valid = {
  markers: [
    {
      name: "Fasting glucose",
      value: "112",
      unit: "mg/dL",
      range: "70-99",
      flag: "high",
    },
    {
      name: "TSH",
      value: "2.1",
      unit: "mIU/L",
      range: "0.4-4.0",
      flag: "normal",
    },
  ],
  summary: "1 of 2 markers is out of range.",
  followUps: [
    "Should I repeat the fasting glucose?",
    "What does an HbA1c add here?",
  ],
};

describe("panelReportSchema", () => {
  it("accepts flags and lengths the parser will later normalise", () => {
    const messy = {
      markers: [
        {
          name: "Fasting glucose",
          value: 112,
          flag: "elevated",
        },
      ],
      summary: "x".repeat(300),
      followUps: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    };
    const result = panelReportSchema.safeParse(messy);
    expect(result.success).toBe(true);
  });
});

describe("parsePanelReport", () => {
  it("accepts a well-formed panel", () => {
    const parsed = parsePanelReport(valid);
    expect(parsed).not.toBeNull();
    expect(parsed!.markers).toHaveLength(2);
    expect(parsed!.markers[0].flag).toBe("high");
    expect(parsed!.followUps).toHaveLength(2);
  });

  it("returns null when markers is empty", () => {
    expect(parsePanelReport({ ...valid, markers: [] })).toBeNull();
  });

  it("maps unknown flags to unknown instead of dropping the panel", () => {
    const parsed = parsePanelReport({
      ...valid,
      markers: [{ ...valid.markers[0], flag: "elevated" }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.markers[0].flag).toBe("unknown");
  });

  it("returns null for non-objects", () => {
    expect(parsePanelReport(undefined)).toBeNull();
    expect(parsePanelReport("glucose 112")).toBeNull();
  });

  it("trims and caps follow-ups at 4 × 80 chars", () => {
    const parsed = parsePanelReport({
      ...valid,
      followUps: ["  a  ", "", "b", "c", "d", "e", "x".repeat(90)],
    });
    expect(parsed!.followUps).toEqual(["a", "b", "c", "d"]);
  });

  it("truncates a long summary rather than rejecting the panel", () => {
    const parsed = parsePanelReport({
      ...valid,
      summary: "s".repeat(300),
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toHaveLength(240);
  });

  it("keeps string values so reported forms like <5 survive", () => {
    const parsed = parsePanelReport({
      ...valid,
      markers: [
        {
          name: "hs-CRP",
          value: "<5",
          unit: "mg/L",
          range: "<10",
          flag: "normal",
          note: "assay-dependent",
        },
      ],
    });
    expect(parsed!.markers[0].value).toBe("<5");
    expect(parsed!.markers[0].note).toBe("assay-dependent");
  });

  it("coerces numeric values so a JSON number does not drop the row", () => {
    const parsed = parsePanelReport({
      ...valid,
      markers: [
        {
          name: "Fasting glucose",
          value: 112,
          unit: "mg/dL",
          range: "70-99",
          flag: "high",
        },
      ],
    });
    expect(parsed!.markers[0].value).toBe("112");
  });
});

describe("isOutOfRange", () => {
  it("treats high and low as out of range, nothing else", () => {
    expect(isOutOfRange("high")).toBe(true);
    expect(isOutOfRange("low")).toBe(true);
    expect(isOutOfRange("normal")).toBe(false);
    expect(isOutOfRange("unknown")).toBe(false);
  });
});
