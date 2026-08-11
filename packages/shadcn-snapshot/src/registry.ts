import type { ComponentType } from "react";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Label } from "./components/ui/label.tsx";
import { Separator } from "./components/ui/separator.tsx";
import { Heading } from "./components/velloo/heading.tsx";
import { Text } from "./components/velloo/text.tsx";

// biome-ignore lint/suspicious/noExplicitAny: registry is heterogeneous by design
export const registry: Record<string, ComponentType<any>> = {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  Input,
  Label,
  Separator,
  Text,
};

export type ComponentRef = keyof typeof registry;

export function isKnownComponent(ref: string): boolean {
  return ref in registry;
}
