import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Users, ShieldCheck, Building2, ArrowRight } from 'lucide-react';
import { Workspace, LegalPage } from '../../../packages/ui/src/shell.js';
import {
  SignIn,
  Register,
  EmailVerification,
  PasswordRecovery,
} from '../../../packages/ui/src/auth.js';
import { getMe } from '../../../packages/ui/src/auth.js';
import { Card, Loading } from '../../../packages/ui/src/components.js';
const PayrollSetup = lazy(() => import('./payroll.js').then((m) => ({ default: m.PayrollSetup })));
const PayrollRuns = lazy(() => import('./payroll.js').then((m) => ({ default: m.PayrollRuns })));
const PayrollAdjustments = lazy(() =>
  import('./payroll.js').then((m) => ({ default: m.PayrollAdjustments })),
);
const Payslips = lazy(() => import('./payroll.js').then((m) => ({ default: m.Payslips })));
const EmployeesPage = lazy(() =>
  import('./employees.js').then((m) => ({ default: m.EmployeesPage })),
);
const MyProfile = lazy(() => import('./employees.js').then((m) => ({ default: m.MyProfile })));
const WorkflowPage = lazy(() =>
  import('./workflows.js').then((m) => ({ default: m.WorkflowPage })),
);
const LeaveBalances = lazy(() =>
  import('./workflows.js').then((m) => ({ default: m.LeaveBalances })),
);
const ImportsPage = lazy(() => import('./workflows.js').then((m) => ({ default: m.ImportsPage })));
const MasterData = lazy(() => import('./master-data.js').then((m) => ({ default: m.MasterData })));
const ReportsPage = lazy(() => import('./reports.js').then((m) => ({ default: m.ReportsPage })));
const Dashboard = lazy(() => import('./pages.js').then((m) => ({ default: m.Dashboard })));
const Company = lazy(() => import('./pages.js').then((m) => ({ default: m.Company })));
const UsersPage = lazy(() => import('./pages.js').then((m) => ({ default: m.UsersPage })));
const Subscription = lazy(() => import('./pages.js').then((m) => ({ default: m.Subscription })));
const AuditPage = lazy(() => import('./pages.js').then((m) => ({ default: m.AuditPage })));

import '../../../packages/ui/src/styles.css';
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10000 } },
});
function Landing() {
  const company = useQuery({ queryKey: ['me'], queryFn: getMe, retry: false }).data?.tenant;
  return (
    <div className="landing">
      <header>
        <Link className="brand" to="/">
          <span className="brand-mark">Q</span>
          <span>
            Qwik<span className="brand-sub">BUSINESS SOLUTIONS™</span>
          </span>
        </Link>
        <nav>
          <Link to="/about">About</Link>
          <Link to="/login">Sign in</Link>
          <Link className="button primary" to="/register">
            Start Free <ArrowRight size={15} />
          </Link>
        </nav>
      </header>
      <main>
        <div className="landing-hero">
          <div>
            <span className="eyebrow">
              {company ? company.displayName : 'eQwik YardHRMS™ · JAMAICA'}
            </span>
            <h1>
              A better home
              <br />
              for your people.
            </h1>
            <p>
              Build a secure, connected company workspace. Bring your organization, team access and
              HR operations together with eQwik YardHRMS.
            </p>
            <div className="landing-actions">
              <Link className="button primary" to={company ? '/dashboard' : '/register'}>
                {company ? 'Continue to ' + company.displayName : 'Create your Free company'}{' '}
                <ArrowRight size={17} />
              </Link>
              <Link to="/login">Already a customer?</Link>
            </div>
            <small className="muted">
              Free registration. No payment or activation code required.
            </small>
          </div>
          <aside className="landing-art">
            <div>
              <span className="brand-mark">Q</span>
            </div>
            <div>
              <span className="eyebrow" style={{ color: '#adbf93' }}>
                YOUR COMPANY. YOUR WORKSPACE.
              </span>
              <h2>
                People at the heart.
                <br />
                Control where it counts.
              </h2>
              <p>
                Company branding · Role-based access
                <br />
                Protected records · Central subscriptions
              </p>
            </div>
            <div
              style={{
                borderTop: '1px solid #456552',
                paddingTop: 20,
                fontSize: 11,
                color: '#b9cbb5',
              }}
            >
              Designed for Jamaican organizations
            </div>
          </aside>
        </div>
        <div className="landing-features">
          <Card>
            <Building2 size={24} />
            <h2>Made for your company</h2>
            <p>
              Company identity, timezone and operating policies belong to your organization and
              appear throughout your workspace.
            </p>
          </Card>
          <Card>
            <Users size={24} />
            <h2>Give every role its place</h2>
            <p>
              Invite colleagues and grant defined access. Role permissions and subscription features
              are checked independently.
            </p>
          </Card>
          <Card>
            <ShieldCheck size={24} />
            <h2>Security from the start</h2>
            <p>
              Verified accounts, protected sessions and multi-factor authentication help safeguard
              company access.
            </p>
          </Card>
        </div>
      </main>
      <footer>
        <span>© 2026 Qwik Business Solutions. All rights reserved.</span>
        <nav>
          {['about', 'licence', 'disclaimer', 'copyright'].map((p) => (
            <Link key={p} to={'/' + p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
function Application() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<SignIn />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<EmailVerification />} />
        <Route path="/forgot-password" element={<PasswordRecovery />} />
        <Route path="/reset-password" element={<PasswordRecovery reset />} />
        {(['about', 'licence', 'disclaimer', 'copyright'] as const).map((page) => (
          <Route key={page} path={'/' + page} element={<LegalPage page={page} />} />
        ))}
        <Route element={<Workspace />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/payroll-setup" element={<PayrollSetup />} />
          <Route path="/payroll" element={<PayrollRuns />} />
          <Route path="/payroll-adjustments" element={<PayrollAdjustments />} />
          <Route path="/payslips" element={<Payslips />} />
          <Route path="/profile" element={<MyProfile />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/leave" element={<WorkflowPage key="leave" kind="leave" />} />
          <Route path="/leave-balances" element={<LeaveBalances />} />
          <Route path="/timesheets" element={<WorkflowPage key="timesheets" kind="timesheets" />} />
          <Route path="/overtime" element={<WorkflowPage key="overtime" kind="overtime" />} />
          <Route path="/imports" element={<ImportsPage />} />
          <Route path="/master-data" element={<MasterData />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/company" element={<Company />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/subscription" element={<Subscription />} />
          <Route path="/audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<Loading />}>
        <Application />
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
