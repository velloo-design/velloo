import { ArrowLeft, LibraryBig } from "lucide-react";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Breadcrumb as UIBreadcrumb,
} from "./ui/breadcrumb.tsx";
import { Button } from "./ui/button.tsx";

export function DetailBreadcrumb({ category, name }: { category: string; name: string }) {
  return (
    <UIBreadcrumb>
      <BreadcrumbList className="text-xs">
        <BreadcrumbItem>
          <LibraryBig size={12} strokeWidth={2} />
          <BreadcrumbLink href="#">Library</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <span>{category}</span>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </UIBreadcrumb>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="-ml-2 text-muted-foreground">
      <ArrowLeft />
      Library
    </Button>
  );
}
