import { useAuth } from "@/_core/hooks/useAuth";
import { Loading } from "@/components/brand/Layout";
import { AppShell } from "@/components/shell/AppShell";
import { AccessBlocked, SignIn } from "@/components/shell/SignIn";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

const Portfolio = lazy(() => import("./pages/Portfolio"));
const MyWork = lazy(() => import("./pages/MyWork"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobLayout = lazy(() => import("./pages/job/JobLayout"));
const LogsIndex = lazy(() => import("./pages/LogsIndex"));
const Bids = lazy(() => import("./pages/Bids"));
const Resources = lazy(() => import("./pages/Resources"));
const Timesheet = lazy(() => import("./pages/Timesheet"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Approvals = lazy(() => import("./pages/Approvals"));
const Reports = lazy(() => import("./pages/Reports"));
const ReportEditor = lazy(() => import("./pages/ReportEditor"));
const Dashboards = lazy(() => import("./pages/Dashboards"));
const DashboardView = lazy(() => import("./pages/DashboardView"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const ApiDocs = lazy(() => import("./pages/ApiDocs"));
const Account = lazy(() => import("./pages/Account"));

function Routes() {
  return (
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route path="/" component={Portfolio} />
        <Route path="/my-work" component={MyWork} />
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
        <Route path="/approvals" component={Approvals} />
        <Route path="/reports" component={Reports} />
        <Route path="/reports/new" component={ReportEditor} />
        <Route path="/reports/:id" component={ReportEditor} />
        <Route path="/dashboards" component={Dashboards} />
        <Route path="/dashboards/:id" component={DashboardView} />
        <Route path="/admin" component={AdminLayout} />
        <Route path="/admin/:section" component={AdminLayout} />
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/account" component={Account} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function Gate() {
  const { user, loading, logout } = useAuth();
  const ref = trpc.ref.all.useQuery(undefined, { enabled: !!user, staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  if (loading) return <Loading label="Starting SteelBuild Pro TopOut…" className="h-dvh" />;
  if (!user) return <SignIn />;
  if (ref.error) {
    const code = (ref.error.data as { code?: string } | undefined)?.code;
    if (code === "FORBIDDEN") return <AccessBlocked message={ref.error.message} onSignOut={() => logout()} />;
  }
  if (ref.isLoading) return <Loading label="Loading your jobs…" className="h-dvh" />;
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
