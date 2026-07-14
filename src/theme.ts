import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0b57d0", dark: "#0842a0", light: "#d3e3fd" },
    secondary: { main: "#146c2e", light: "#c4eed0" },
    warning: { main: "#b06000", light: "#ffddb7" },
    error: { main: "#b3261e", light: "#f9dedc" },
    background: { default: "#f8f9fa", paper: "#ffffff" },
    text: { primary: "#1f1f1f", secondary: "#5f6368" },
    divider: "#dadce0",
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily:
      'Inter, "Google Sans", "Noto Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontSize: 28, fontWeight: 500, lineHeight: 1.25 },
    h2: { fontSize: 20, fontWeight: 600, lineHeight: 1.35 },
    h3: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
    button: { fontWeight: 600, textTransform: "none", letterSpacing: 0 },
    body1: { fontSize: 14, letterSpacing: 0 },
    body2: { fontSize: 13, letterSpacing: 0 },
    caption: { letterSpacing: 0 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiCard: {
      styleOverrides: {
        root: { border: "1px solid #e0e3e7", boxShadow: "none" },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 6 } },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiTableCell: {
      styleOverrides: { root: { borderColor: "#eceff1" } },
    },
  },
});
