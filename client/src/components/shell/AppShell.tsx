import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme, type Theme } from "@/contexts/ThemeContext";
import { fmtAgo, initials } from "@/lib/format";
import { useRefData } from "@/lib/ref";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Code2,
  FileStack,
  CalendarCheck,
  Gauge,
  HardHat,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Receipt,
  Search,
  Settings2,
  Sun,
  Target,
  Timer,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BrandGlyph, Wordmark } from "../brand/Status";

type NavItem = { href: string; label: string; icon: ReactNode; match?: (path: string) => boolean; badge?: number };

function useNav(): { section: string; items: NavItem[] }[] {
  return useMemo(
    () => [
      {
        section: "Operations",
        items: [
          { href: "/", label: "Today", icon: <CalendarCheck className="size-4" />, match: (p: string) => p === "/" },
          { href: "/portfolio", label: "Portfolio", icon: <Gauge className="size-4" /> },
          { href: "/jobs", label: "Jobs", icon: <Briefcase className="size-4" />, match: (p: string) => p.startsWith("/jobs") },
          { href: "/logs", label: "Logs", icon: <FileStack className="size-4" />, match: (p: string) => p.startsWith("/logs") },
          { href: "/bids", label: "Bids", icon: <Target className="size-4" />, match: (p: string) => p.startsWith("/bids") },
          { href: "/resources", label: "Crew & equipment", icon: <Users className="size-4" /> },
        ],
      },
      {
        section: "Time & Cost",
        items: [
          { href: "/timesheet", label: "Hours", icon: <Timer className="size-4" /> },
          { href: "/expenses", label: "Expenses", icon: <Receipt className="size-4" /> },
        ],
      },
      {
        section: "Insight",
        items: [
          { href: "/reports", label: "Reports", icon: <BarChart3 className="size-4" />, match: (p: string) => p.startsWith("/reports") },
          { href: "/dashboards", label: "Dashboards", icon: <LayoutDashboard className="size-4" />, match: (p: string) => p.startsWith("/dashboards") },
        ],
      },
      {
        section: "System",
        items: [{ href: "/admin", label: "Settings", icon: <Settings2 className="size-4" />, match: (p: string) => p.startsWith("/admin") }],
      },
    ],
    []
  );
}

function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const [path] = useLocation();
  const nav = useNav();
  const { ref } = useRefData();
  return (
    <nav className="flex h-full w-[248px] flex-col bg-[var(--tp-graphite)] text-sidebar-foreground">
      <div className="px-4 pb-4 pt-4">
        <Link href="/" onClick={onNavigate} aria-label="SteelBuild Pro TopOut home" className="mx-auto block w-fit rounded-md focus-visible:outline-2 focus-visible:outline-[var(--tp-brand)]">
          <Wordmark size="md" />
        </Link>
        <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--tp-graphite-3)] bg-[var(--tp-graphite-2)] px-3 py-2">
          <span className="size-1.5 shrink-0 rounded-full bg-[var(--tp-brand)]" />
          <span className="truncate text-[12.5px] font-medium text-sidebar-foreground">{ref?.org.name ?? "—"}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {nav.map(sec => (
          <div key={sec.section} className="mt-5 first:mt-1">
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--tp-sidebar-muted)]">{sec.section}</div>
            {sec.items.map(it => {
              const active = isActive(it, path);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={onNavigate}
                  className={cn(
                    "relative flex items-center gap-3 rounded-md px-2.5 py-[7px] text-[13.5px] font-medium transition-colors",
                    active ? "bg-[var(--tp-graphite-3)] text-white" : "text-sidebar-foreground hover:bg-[var(--tp-graphite-2)] hover:text-white"
                  )}
                >
                  {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[var(--tp-brand)]" />}
                  <span className={cn("[&_svg]:size-[17px]", active ? "text-[var(--tp-brand)]" : "text-[var(--tp-sidebar-muted)]")}>{it.icon}</span>
                  {it.label}
                  {it.badge ? (
                    <span className="num ml-auto min-w-5 rounded-full bg-[var(--tp-brand)] px-1.5 text-center text-[11px] font-semibold leading-[18px] text-[var(--tp-graphite)]">{it.badge}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--tp-graphite-3)] px-5 py-3 text-[11.5px] text-[var(--tp-sidebar-muted)]">Erection only · Fabrication by others</div>
    </nav>
  );
}

const isActive = (it: NavItem, path: string) => (it.match ? it.match(path) : path === it.href || path.startsWith(it.href + "/"));

/** Phone bottom bar (below md): the four field destinations + Menu. 56px tall, 48px+ targets. */
function BottomNav({ onMenu }: { onMenu: () => void }) {
  const [path] = useLocation();
  const nav = useNav();
  const all = nav.flatMap(s => s.items);
  const pick = ["/", "/jobs", "/logs", "/timesheet"]
    .map(h => all.find(i => i.href === h))
    .filter((i): i is NavItem => !!i);
  const items = pick.length ? pick : all.slice(0, 4);
  return (
    <nav className="grid h-14 shrink-0 border-t border-[var(--tp-rule)] bg-[var(--tp-paper)] md:hidden" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0,1fr))` }}>
      {items.map(it => {
        const active = isActive(it, path);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "relative flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium",
              active ? "text-[var(--tp-accent-ink)]" : "text-[var(--tp-muted)]"
            )}
          >
            {active && <span className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-[var(--tp-accent-ink)]" />}
            <span className="[&_svg]:size-5">{it.icon}</span>
            {it.label}
            {it.badge ? (
              <span className="num absolute right-[22%] top-1.5 min-w-4 rounded-full bg-[var(--tp-red-fill)] px-1 text-center text-[10px] leading-4 text-white">{it.badge}</span>
            ) : null}
          </Link>
        );
      })}
      <button type="button" onClick={onMenu} className="flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium text-[var(--tp-muted)]">
        <Menu className="size-5" />
        Menu
      </button>
    </nav>
  );
}

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [, navigate] = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const jobs = trpc.projects.list.useQuery({ search: q || undefined }, { enabled: open, staleTime: 30_000 });
  const tasks = trpc.tasks.search.useQuery({ q, leavesOnly: false }, { enabled: open && q.length >= 2, staleTime: 30_000 });
  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-[420px] items-center gap-2 rounded-lg border border-[var(--tp-rule)] bg-[var(--tp-surface)] px-3 text-[13.5px] text-[var(--tp-muted)] transition-colors hover:border-input hover:bg-[var(--tp-paper)]"
      >
        <Search className="size-4 text-[var(--tp-muted)]" />
        <span className="truncate">Search jobs, sequences, tasks…</span>
        <kbd className="ml-auto hidden rounded border border-[var(--tp-rule)] bg-[var(--tp-paper)] px-1.5 text-[10.5px] font-medium text-[var(--tp-muted)] sm:block">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Search jobs and tasks</DialogDescription>
          <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2">
        <CommandInput placeholder="Job number, job name, sequence or task…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {(jobs.data ?? []).length > 0 && (
            <CommandGroup heading="Jobs">
              {(jobs.data ?? []).slice(0, 8).map(j => (
                <CommandItem key={`j${j.id}`} value={`job-${j.id}`} onSelect={() => go(`/jobs/${j.id}`)}>
                  <span className="num w-16 text-[12px] text-muted-foreground">{j.code}</span>
                  {j.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(tasks.data ?? []).length > 0 && (
            <CommandGroup heading="Sequences & tasks">
              {(tasks.data ?? []).slice(0, 20).map(t => (
                <CommandItem key={`t${t.id}`} value={`task-${t.id}`} onSelect={() => go(`/jobs/${t.projectId}/tasks?task=${t.id}`)}>
                  <span className="num w-16 text-[12px] text-muted-foreground">{t.projectCode}</span>
                  <span className="num mr-2 text-[11.5px] text-muted-foreground">{t.wbs}</span>
                  {t.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { ref } = useRefData();
  const { theme, setTheme } = useTheme();
  const [, navigate] = useLocation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--tp-gray-soft)]">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white">
            {initials(user?.name)}
          </span>
          <span className="hidden max-w-[160px] truncate text-[13.5px] font-medium text-[var(--tp-ink)] md:block">{user?.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="truncate text-[13px]">{user?.name}</div>
          <div className="truncate text-[11.5px] font-normal text-muted-foreground">{user?.email}</div>
          <div className="label-caps mt-1">Owner</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/account")}>
          <KeyRound className="size-4" /> Profile & password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11.5px] font-medium text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={value => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light"><Sun className="size-4" /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon className="size-4" /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor className="size-4" /> System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeButton() {
  const { theme, resolvedTheme, toggleTheme } = useTheme();
  const label = `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme${theme === "system" ? " (currently following system)" : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} onClick={toggleTheme} className="flex size-9 items-center justify-center rounded-lg text-[var(--tp-ink-2)] hover:bg-[var(--tp-gray-soft)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
          {resolvedTheme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [path] = useLocation();
  useEffect(() => setMobileOpen(false), [path]);
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden shrink-0 lg:block">
        <Rail />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="h-full shadow-[8px_0_24px_rgba(0,0,0,0.25)]">
            <Rail onNavigate={() => setMobileOpen(false)} />
          </div>
          <button type="button" className="flex-1 bg-black/40" aria-label="Close menu" onClick={() => setMobileOpen(false)}>
            <X className="ml-2 mt-3 size-5 text-white" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--tp-rule)] bg-[var(--tp-paper)] px-3 lg:px-6">
          <button type="button" className="hidden size-10 items-center justify-center md:flex lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <Link href="/" className="md:hidden" aria-label="SteelBuild Pro TopOut home">
            <BrandGlyph size={32} />
          </Link>
          <GlobalSearch />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeButton />
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                </span>
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
            <UserMenu />
          </div>
        </header>
        <main className="tp-touch min-h-0 flex-1 overflow-y-auto">{children}</main>
        <BottomNav onMenu={() => setMobileOpen(true)} />
      </div>
    </div>
  );
}
