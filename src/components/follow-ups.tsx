export function FollowUps({
  items,
  onSelect,
}: {
  items: string[];
  onSelect: (item: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onSelect(item)}
          className="text-xs rounded-full border border-border bg-background px-3 py-1 text-foreground hover:bg-secondary"
        >
          {item}
        </button>
      ))}
    </div>
  );
}
