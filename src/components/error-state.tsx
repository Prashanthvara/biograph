import { Button } from "./ui/button";

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2"
      role="alert"
    >
      <p className="text-sm text-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
