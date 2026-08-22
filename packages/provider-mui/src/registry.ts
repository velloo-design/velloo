import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ComponentRegistry } from "@velloo/provider";
import { registry as snapshotRegistry } from "@velloo/shadcn-snapshot";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  Menu,
  Popover,
  Snackbar,
} from "./overlays.ts";

const REUSED_HELPER_IDS = ["Icon", "Image", "Placeholder", "SVG", "Layer", "Gradient"] as const;

function reusedHelpers(): ComponentRegistry {
  const out: ComponentRegistry = {};
  for (const id of REUSED_HELPER_IDS) {
    const component = snapshotRegistry[id];
    if (component) out[id] = component;
  }
  return out;
}

/**
 * The runtime registry for MUI-native folders: design `$ref` ids → real MUI
 * components. SSR'd in-process via the adapter's emotion render pass. The
 * overlay surface (Dialog/Menu/Popover/Drawer/Snackbar) is canvas-safe-wrapped
 * in `overlays.ts` — rendered open + inline so a screenshot shows it; their
 * sub-parts (DialogTitle/Content/Actions) are MUI's real inline components.
 * Tooltip is a passthrough (it renders its child inline in SSR).
 */
export const registry: ComponentRegistry = {
  Alert,
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  // Framework-neutral velloo helpers MUI has no equivalent for — chiefly `Icon`
  // (lucide; MUI's own @mui/icons-material isn't bundled) + imagery/composition
  // helpers. Reused verbatim from the snapshot, like provider-none. They size
  // via props (`Icon size`), not Tailwind — the JIT is off on a MUI folder.
  ...reusedHelpers(),
};
