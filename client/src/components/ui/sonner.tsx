import { useTheme } from "@/contexts/ThemeContext";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--tp-green-soft)",
          "--success-text": "var(--tp-green)",
          "--success-border": "var(--tp-green)",
          "--warning-bg": "var(--tp-amber-soft)",
          "--warning-text": "var(--tp-amber)",
          "--warning-border": "var(--tp-amber)",
          "--error-bg": "var(--tp-red-soft)",
          "--error-text": "var(--tp-red-strong)",
          "--error-border": "var(--tp-red-strong)",
          "--info-bg": "var(--tp-blue-soft)",
          "--info-text": "var(--tp-blue)",
          "--info-border": "var(--tp-blue)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
