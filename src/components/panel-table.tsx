import { isOutOfRange, type Flag, type PanelReport } from "../panel";

const FLAG_LABEL: Record<Flag, string> = {
  high: "High",
  low: "Low",
  normal: "OK",
  unknown: "Unknown",
};

export function PanelTable({ report }: { report: PanelReport }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-background">
      <table className="w-full text-sm">
        <caption className="text-left text-xs text-muted-foreground px-3 py-2 border-b border-border">
          {report.summary}
        </caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">
              Marker
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Value
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Unit
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Range
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Flag
            </th>
          </tr>
        </thead>
        <tbody>
          {report.markers.map((row, index) => {
            const alert = isOutOfRange(row.flag);
            return (
              <tr
                key={`${row.name}-${row.value}-${index}`}
                className={alert ? "bg-destructive/5" : undefined}
              >
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {row.name}
                  {row.note ? (
                    <div className="text-xs font-normal text-muted-foreground whitespace-normal">
                      {row.note}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 tabular-nums">{row.value}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.unit}</td>
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {row.range}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={alert ? "font-medium" : "text-muted-foreground"}
                  >
                    {FLAG_LABEL[row.flag]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
