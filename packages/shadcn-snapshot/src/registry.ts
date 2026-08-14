import type { ComponentType } from "react";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "./components/ui/avatar.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card.tsx";
import { Checkbox } from "./components/ui/checkbox.tsx";
import { Input } from "./components/ui/input.tsx";
import { Label } from "./components/ui/label.tsx";
import { Progress } from "./components/ui/progress.tsx";
import { Separator } from "./components/ui/separator.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { Switch } from "./components/ui/switch.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.tsx";
import { Divider } from "./components/velloo/divider.tsx";
import { Gradient } from "./components/velloo/gradient.tsx";
import { Heading } from "./components/velloo/heading.tsx";
import { Icon } from "./components/velloo/icon.tsx";
import { Image as VImage } from "./components/velloo/image.tsx";
import { Layer } from "./components/velloo/layer.tsx";
import { Placeholder } from "./components/velloo/placeholder.tsx";
import { SVG } from "./components/velloo/svg.tsx";
import { Text } from "./components/velloo/text.tsx";

// biome-ignore lint/suspicious/noExplicitAny: registry is heterogeneous by design
export const registry: Record<string, ComponentType<any>> = {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Divider,
  Gradient,
  Heading,
  Icon,
  Image: VImage,
  Input,
  Label,
  Layer,
  Placeholder,
  Progress,
  SVG,
  Separator,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
};

export type ComponentRef = keyof typeof registry;

export function isKnownComponent(ref: string): boolean {
  return ref in registry;
}
