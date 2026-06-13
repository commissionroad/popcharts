import Image from "next/image";

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[var(--radius-sm)] bg-[var(--surface-raised)] shadow-[var(--shadow-tile)]">
        <Image
          alt=""
          height={26}
          priority
          src="/brand/pop-charts-glyph.svg"
          width={26}
        />
      </span>
      <span className="font-display text-xl font-black">
        Pop<span className="text-[var(--accent)]">Charts</span>
      </span>
    </span>
  );
}
