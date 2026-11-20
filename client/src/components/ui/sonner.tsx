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
          "--success-bg": "var(--ks-green-soft)",
          "--success-text": "var(--ks-green)",
          "--success-border": "var(--ks-green)",
          "--warning-bg": "var(--ks-amber-soft)",
          "--warning-text": "var(--ks-amber)",
          "--warning-border": "var(--ks-amber)",
          "--error-bg": "var(--ks-red-soft)",
          "--error-text": "var(--ks-red-strong)",
          "--error-border": "var(--ks-red-strong)",
          "--info-bg": "var(--ks-blue-soft)",
          "--info-text": "var(--ks-blue)",
          "--info-border": "var(--ks-blue)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
