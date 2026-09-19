import "../src/styles.css";
import { ThemeProvider } from "../src/components/theme";

export default function Preview({ children }) {
  return <ThemeProvider accent="violet">{children}</ThemeProvider>;
}
