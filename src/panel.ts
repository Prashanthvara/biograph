export const FLAG_VALUES = ["high", "low", "normal", "unknown"] as const;
export type Flag = (typeof FLAG_VALUES)[number];

export type BiomarkerRow = {
  name: string;
  value: string;
  unit: string;
  range: string;
  flag: Flag;
  note?: string;
};

export type PanelReport = {
  markers: BiomarkerRow[];
  summary: string;
  followUps: string[];
};

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asFlag(value: unknown): Flag {
  const normalized = asText(value).trim().toLowerCase();
  if ((FLAG_VALUES as readonly string[]).includes(normalized)) {
    return normalized as Flag;
  }
  return "unknown";
}

/**
 * Turns a tool result (or anything else) into a panel, or null.
 * Never throws — a bad payload must not crash the message list.
 */
export function parsePanelReport(value: unknown): PanelReport | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.markers)) return null;

  const markers: BiomarkerRow[] = [];
  for (const raw of record.markers) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = asText(row.name).trim().slice(0, 80);
    const measured = asText(row.value).trim().slice(0, 40);
    if (!name || !measured) continue;
    const note = asText(row.note).trim().slice(0, 160);
    markers.push({
      name,
      value: measured,
      unit: asText(row.unit).trim().slice(0, 24) || "—",
      range: asText(row.range).trim().slice(0, 80) || "not stated",
      flag: asFlag(row.flag),
      note: note || undefined,
    });
  }
  if (markers.length === 0) return null;

  const followUps = Array.isArray(record.followUps)
    ? record.followUps
        .map((item) => asText(item).trim())
        .filter((item) => item.length > 0)
        .map((item) => item.slice(0, 80))
        .slice(0, 4)
    : [];

  const summary =
    asText(record.summary).trim().slice(0, 240) ||
    `${markers.length} marker${markers.length === 1 ? "" : "s"} reported.`;

  return { markers, summary, followUps };
}

export function isOutOfRange(flag: Flag): boolean {
  return flag === "high" || flag === "low";
}
