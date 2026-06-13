import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-7">
      <p className="font-mono text-xs tracking-[0.16em] text-[var(--pc-cyan)] uppercase">
        404
      </p>
      <h1 className="font-display mt-3 text-3xl font-black">Market not found.</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
        That market may have been removed, refunded, or not indexed yet.
      </p>
      <Button className="mt-6" href="/">
        Browse markets
      </Button>
    </div>
  );
}
