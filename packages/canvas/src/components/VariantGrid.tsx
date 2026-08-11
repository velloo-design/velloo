import type { Page } from "@velloo/schema";
import { VariantFrame } from "./VariantFrame.tsx";

interface Props {
  pageId: string;
  page: Page;
}

export function VariantGrid({ pageId, page }: Props) {
  return (
    <div className="flex-1 overflow-auto bg-[var(--color-bg)]">
      <div className="flex items-start gap-12 p-12 min-w-max">
        {page.variants.map((v) => (
          <VariantFrame
            key={v.id}
            pageId={pageId}
            variantId={v.id}
            variantName={v.name}
            viewport={v.viewport}
          />
        ))}
      </div>
    </div>
  );
}
