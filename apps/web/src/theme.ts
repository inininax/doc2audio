import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    primary: { main: "#2563eb", light: "#eff6ff", dark: "#1d4ed8" },
    secondary: { main: "#475569" },
    background: { default: "#f4f6f9", paper: "#ffffff" },
    text: {
      primary: "#1e293b",
      secondary: "#566579",
      disabled: "#66758a",
    },
    divider: "#e2e8f0",
    success: { main: "#167647", dark: "#116339", light: "#edf8f1" },
    warning: { main: "#965f0d", dark: "#7a4b08" },
    error: { main: "#c53030" },
    info: { main: "#2563eb" },
    action: { disabled: "#627086", disabledBackground: "#edf1f6" },
  },
  typography: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
    fontSize: 14,
    h4: {
      fontSize: 28,
      fontWeight: 700,
      lineHeight: 1.3,
      letterSpacing: "-0.7px",
      "@media (max-width: 599px)": { fontSize: 24 },
    },
    h5: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px" },
    h6: { fontSize: 18, fontWeight: 650, lineHeight: 1.5 },
    subtitle1: { fontSize: 16 },
    subtitle2: { fontSize: 14, fontWeight: 650 },
    body1: { fontSize: 15, lineHeight: 1.65 },
    body2: { fontSize: 14, lineHeight: 1.6 },
    caption: { fontSize: 13, lineHeight: 1.6 },
    overline: { fontSize: 12, lineHeight: 1.6, letterSpacing: "0.5px" },
    button: { fontSize: 14, textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCssBaseline: {
      styleOverrides: { body: { overflowWrap: "break-word" } },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: {
          "&.Mui-focusVisible": {
            outline: "3px solid #2563eb",
            outlineOffset: 3,
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 44,
          paddingInline: 16,
          "@media (max-width: 599px)": { minHeight: 48 },
        },
        sizeSmall: { fontSize: 13, paddingInline: 12 },
        outlined: { borderColor: "#cbd5e1" },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          minWidth: 44,
          minHeight: 44,
          "@media (max-width: 599px)": { minWidth: 48, minHeight: 48 },
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { outlined: { borderColor: "#e2e8f0" } },
    },
    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiInputLabel: {
      // MUI shrinks labels to 75%; 16px keeps the visible label at 12px.
      styleOverrides: {
        root: {
          fontSize: 16,
          "&.MuiInputLabel-outlined:not(.MuiInputLabel-shrink)": {
            transform: "translate(14px, 11px) scale(1)",
            "@media (max-width: 599px)": {
              transform: "translate(14px, 13px) scale(1)",
            },
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          fontSize: 15,
          minHeight: 44,
          backgroundColor: "#ffffff",
          "&.Mui-focused": { boxShadow: "0 0 0 3px rgba(37, 99, 235, 0.14)" },
          "@media (max-width: 599px)": { minHeight: 48 },
        },
        input: {
          "&:not(textarea)": {
            boxSizing: "border-box",
            minHeight: 44,
            paddingBlock: 11,
            "@media (max-width: 599px)": { minHeight: 48, paddingBlock: 13 },
          },
        },
        notchedOutline: { borderColor: "#b9c5d4" },
      },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { fontSize: 13, lineHeight: 1.5 } },
    },
    MuiTab: {
      styleOverrides: {
        root: { minHeight: 48, minWidth: 0, fontSize: 14, paddingInline: 16 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: 12, borderRadius: 6 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { fontSize: 14, lineHeight: 1.6, borderRadius: 8 },
        message: { minWidth: 0 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 6, borderRadius: 8 } },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { fontSize: 12 } },
    },
  },
});
