import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Workspace, LegalPage } from '../../../packages/ui/src/shell.js';
import { SignIn, EmailVerification, PasswordRecovery } from '../../../packages/ui/src/auth.js';
import { Loading } from '../../../packages/ui/src/components.js';
import '../../../packages/ui/src/styles.css';
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10000 } },
});
const Dashboard = lazy(() => import('./pages.js').then((m) => ({ default: m.Dashboard })));
const Customers = lazy(() => import('./pages.js').then((m) => ({ default: m.Customers })));
const Plans = lazy(() => import('./commercial.js').then((m) => ({ default: m.Catalog })));
const Payments = lazy(() => import('./commercial.js').then((m) => ({ default: m.Payments })));
const Subscriptions = lazy(() =>
  import('./commercial.js').then((m) => ({ default: m.Subscriptions })),
);
const Codes = lazy(() => import('./commercial.js').then((m) => ({ default: m.Codes })));
const Usage = lazy(() => import('./commercial.js').then((m) => ({ default: m.Usage })));
const Settings = lazy(() => import('./commercial.js').then((m) => ({ default: m.Settings })));
const Audit = lazy(() => import('./pages.js').then((m) => ({ default: m.Audit })));
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<SignIn platform />} />
        <Route path="/verify-email" element={<EmailVerification platform />} />
        <Route path="/forgot-password" element={<PasswordRecovery platform />} />
        <Route path="/reset-password" element={<PasswordRecovery platform reset />} />
        {(['about', 'licence', 'disclaimer', 'copyright'] as const).map((page) => (
          <Route key={page} path={'/' + page} element={<LegalPage page={page} />} />
        ))}
        <Route element={<Workspace platform />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/renewals" element={<Subscriptions renewals />} />
          <Route path="/codes" element={<Codes />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audit" element={<Audit />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<Loading />}>
        <App />
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
