import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRefData } from "@/lib/ref";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Right slide-over drawer for any record                              */
/* ------------------------------------------------------------------ */
export function RecordDrawer({
  open,
  onOpenChange,
  eyebrow,
  title,
  actions,
  children,
  width = 640,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-[var(--tp-rule)] bg-[var(--tp-paper)] p-0 shadow-[-12px_0_32px_rgba(16,24,40,0.10)] sm:max-w-none"
        style={{ maxWidth: `min(${width}px, 100vw)` }}
      >
        <SheetHeader className="gap-1 border-b border-[var(--tp-rule)] px-5 pb-3.5 pt-4 pr-12 text-left">
          {eyebrow && <div className="label-caps">{eyebrow}</div>}
          <SheetTitle className="text-[21px] leading-tight">{title}</SheetTitle>
          <SheetDescription className="sr-only">Record details</SheetDescription>
          {actions && <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-[var(--tp-rule)] px-5 py-3">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Selects                                                             */
/* ------------------------------------------------------------------ */
const NONE = "__none";

export function SimpleSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  allowNone,
  noneLabel = "— None —",
  className,
  disabled,
  size = "default",
}: {
  value: T | null | undefined;
  onChange: (v: T | null) => void;
  options: { value: T; label: ReactNode }[] | Record<T, string>;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  const opts = Array.isArray(options) ? options : (Object.entries(options) as [T, string][]).map(([v, l]) => ({ value: v, label: l }));
  return (
    <Select value={value ?? (allowNone ? NONE : undefined)} onValueChange={v => onChange(v === NONE ? null : (v as T))} disabled={disabled}>
      <SelectTrigger size={size} className={cn("w-full bg-[var(--tp-paper)]", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {opts.map(o => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function UserSelect({
  value,
  onChange,
  allowNone = true,
  placeholder = "Select person…",
  includePassive = false,
  className,
  filter,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  allowNone?: boolean;
  placeholder?: string;
  includePassive?: boolean;
  className?: string;
  filter?: (u: { id: number; accessType: string; jobRoleId: number | null }) => boolean;
}) {
  const { ref } = useRefData();
  const users = (ref?.users ?? []).filter(u => u.isActive && (includePassive || u.accessType !== "passive") && (!filter || filter(u)));
  return (
    <SimpleSelect
      value={value != null ? String(value) : null}
      onChange={v => onChange(v ? Number(v) : null)}
      options={users.map(u => ({ value: String(u.id), label: u.name ?? `User ${u.id}` }))}
      allowNone={allowNone}
      placeholder={placeholder}
      className={className}
    />
  );
}

export function CompanySelect({
  value,
  onChange,
  type,
  allowNone = true,
  placeholder = "Select company…",
  className,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  type?: string | string[];
  allowNone?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const { ref } = useRefData();
  const types = type ? (Array.isArray(type) ? type : [type]) : null;
  const cos = (ref?.companies ?? []).filter(c => !types || types.includes(c.type));
  return (
    <SimpleSelect
      value={value != null ? String(value) : null}
      onChange={v => onChange(v ? Number(v) : null)}
      options={cos.map(c => ({ value: String(c.id), label: c.name }))}
      allowNone={allowNone}
      placeholder={placeholder}
      className={className}
    />
  );
}

/** Native date input bound to YYYY-MM-DD strings (or null). */
export function DateInput({ value, onChange, className, disabled }: { value: string | null | undefined; onChange: (v: string | null) => void; className?: string; disabled?: boolean }) {
  return (
    <Input
      type="date"
      value={value ?? ""}
      disabled={disabled}
      onChange={e => onChange(e.target.value || null)}
      className={cn("num bg-[var(--tp-paper)]", className)}
    />
  );
}

/** Number input that yields numbers (or null when blank). */
export function NumberInput({
  value,
  onChange,
  className,
  step,
  min,
  placeholder,
  disabled,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  className?: string;
  step?: number | string;
  min?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={value ?? ""}
      step={step}
      min={min}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={cn("num bg-[var(--tp-paper)]", className)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Confirm                                                             */
/* ------------------------------------------------------------------ */
export function ConfirmButton({
  children,
  title,
  body,
  confirmLabel = "Confirm",
  onConfirm,
  destructive,
  variant = "outline",
  size = "sm",
  disabled,
}: {
  children: ReactNode;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  variant?: "outline" | "ghost" | "destructive" | "default" | "secondary";
  size?: "sm" | "default" | "icon" | "lg";
  disabled?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {body && <AlertDialogDescription asChild><div>{body}</div></AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
