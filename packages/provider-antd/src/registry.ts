import { helpersRegistry } from "@velloo/helpers";
import type { ComponentRegistry } from "@velloo/provider";
import {
  Alert,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Empty,
  Flex,
  Input,
  List,
  Menu,
  Pagination,
  Progress,
  Radio,
  Rate,
  Row,
  Segmented,
  Select,
  Skeleton,
  Slider,
  Space,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { Drawer, Dropdown, Modal, Popover, Tooltip } from "./overlays.ts";

const REUSED_HELPER_IDS = ["Icon", "Image", "Placeholder", "SVG", "Layer", "Gradient"] as const;

/**
 * The runtime registry for antd-native folders: design `$ref` ids → real antd
 * components, SSR'd in-process via the adapter's cssinjs render pass. Dotted
 * antd subcomponents get manifest-friendly flat ids (`Typography.Title` ⇒
 * `TypographyTitle`, `List.Item` ⇒ `ListItem`) — the MCP intro tells the agent
 * how those destructure in emitted code. The overlay surface
 * (Modal/Drawer/Popover/Tooltip/Dropdown) is canvas-safe-wrapped in
 * `overlays.ts` — antd's own overlays portal and render NOTHING in SSR, so the
 * shims render them open + inline instead.
 */
export const registry: ComponentRegistry = {
  Alert,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  Input,
  List,
  ListItem: List.Item,
  ListItemMeta: List.Item.Meta,
  Menu,
  Modal,
  Pagination,
  Popover,
  Progress,
  Radio,
  Rate,
  Row,
  Segmented,
  Select,
  Skeleton,
  Slider,
  Space,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  TypographyParagraph: Typography.Paragraph,
  TypographyText: Typography.Text,
  TypographyTitle: Typography.Title,
  // Framework-neutral velloo helpers antd has no equivalent for — chiefly
  // `Icon` (lucide; @ant-design/icons isn't surfaced) + imagery/composition
  // helpers. Reused verbatim from `@velloo/helpers`, like provider-mui. They
  // size via props (`Icon size`), not Tailwind — the JIT is off on an antd folder.
  ...helpersRegistry(REUSED_HELPER_IDS),
};
