import { useAuth } from "@/_core/hooks/useAuth";
import { Loading } from "@/components/brand/Layout";
import { AppShell } from "@/components/shell/AppShell";
import { AccessBlocked, SignIn } from "@/components/shell/SignIn";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

const Today = lazy(() => import("./pages/Today"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobLayout = lazy(() => import("./pages/job/JobLayout"));
const LogsIndex = lazy(() => import("./pages/LogsIndex"));
const Bids = lazy(() => import("./pages/Bids"));
const Resources = lazy(() => import("./pages/Resources"));
const Timesheet = lazy(() => import("./pages/Timesheet"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Reports = lazy(() => import("./pages/Reports"));
const ReportEditor = lazy(() => import("./pages/ReportEditor"));
const Dashboards = lazy(() => import("./pages/Dashboards"));
const DashboardView = lazy(() => import("./pages/DashboardView"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const Account = lazy(() => import("./pages/Account"));
const LiftPlan = lazy(() => import("./pages/print/LiftPlan"));
const TmTicket = lazy(() => import("./pages/print/TmTicket"));
const Lookahead = lazy(() => import("./pages/print/Lookahead"));
const GcWeekly = lazy(() => import("./pages/print/GcWeekly"));

function Routes() {
  return (
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route path="/" component={Today} />
        <Route path="/portfolio" component={Portfolio} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/jobs/:id">{p => <JobLayout params={p} />}</Route>
        <Route path="/jobs/:id/:tab">{p => <JobLayout params={p} />}</Route>
        <Route path="/jobs/:id/:tab/:a">{p => <JobLayout params={p} />}</Route>
        <Route path="/jobs/:id/:tab/:a/:b">{p => <JobLayout params={p} />}</Route>
        <Route path="/logs" component={LogsIndex} />
        <Route path="/logs/:appKey" component={LogsIndex} />
        <Route path="/logs/:appKey/:itemId" component={LogsIndex} />
        <Route path="/bids" component={Bids} />
        <Route path="/bids/:id" component={Bids} />
        <Route path="/resources" component={Resources} />
        <Route path="/timesheet" component={Timesheet} />
        <Route path="/expenses" component={Expenses} />
        <Route path="/reports" component={Reports} />
        <Route path="/reports/new" component={ReportEditor} />
        <Route path="/reports/:id" component={ReportEditor} />
        <Route path="/dashboards" component={Dashboards} />
        <Route path="/dashboards/:id" component={DashboardView} />
        <Route path="/admin" component={AdminLayout} />
        <Route path="/admin/:section" component={AdminLayout} />
        <Route path="/account" component={Account} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function PrintRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route path="/print/lift/:pickId">{p => <LiftPlan params={p} />}</Route>
        <Route path="/print/tm/:ticketId">{p => <TmTicket params={p} />}</Route>
        <Route path="/print/lookahead/:projectId/:from">{p => <Lookahead params={p} />}</Route>
        <Route path="/print/gc/:projectId/:weekStart">{p => <GcWeekly params={p} />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function Gate() {
  const { user, loading, logout } = useAuth();
  const [path] = useLocation();
  const ref = trpc.ref.all.useQuery(undefined, { enabled: !!user, staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  if (loading) return <Loading label="Starting SteelBuild Pro TopOut…" className="h-dvh" />;
  if (!user) return <SignIn />;
  if (ref.error) {
    const code = (ref.error.data as { code?: string } | undefined)?.code;
    if (code === "FORBIDDEN") return <AccessBlocked message={ref.error.message} onSignOut={() => logout()} />;
  }
  if (ref.isLoading) return <Loading label="Loading your jobs…" className="h-dvh" />;
  // Printable documents render without the app chrome.
  if (path.startsWith("/print/")) return <PrintRoutes />;
  return (
    <AppShell>
      <Routes />
    </AppShell>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider delayDuration={250}>
          <Toaster position="bottom-right" />
          <Gate />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
