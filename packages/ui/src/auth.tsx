import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck, Building2 } from 'lucide-react';
import { loginSchema, registerSchema, passwordSchema, type Me } from '../../types/src/index.js';
import { api, post } from './api.js';
import { Button, Field, Card, Notice } from './components.js';
function AuthFrame({
  children,
  platform = false,
}: {
  children: React.ReactNode;
  platform?: boolean;
}) {
  return (
    <div className={'auth-page ' + (platform ? 'platform-theme' : '')}>
      <aside className="auth-story">
        <Link to="/" className="brand">
          <span className="brand-mark">Q</span>
          <span>
            Qwik<span className="brand-sub">BUSINESS SOLUTIONS™</span>
          </span>
        </Link>
        <div>
          <span className="eyebrow">
            {platform ? 'QWIK CONTROL CENTRE' : 'BUILT FOR JAMAICAN BUSINESSES'}
          </span>
          <h1>
            {platform
              ? 'A clear view of every subscription.'
              : 'Your people.\nOne connected workspace.'}
          </h1>
          <p>
            {platform
              ? 'Secure commercial administration for Qwik staff. Customer licensing stays separate from private HR records.'
              : 'Bring your team, HR operations and Jamaican payroll together in a secure, company-branded workspace.'}
          </p>
          <div className="auth-benefits">
            <span>
              <ShieldCheck size={18} /> Tenant-isolated data
            </span>
            <span>
              <Building2 size={18} /> Company-specific access
            </span>
          </div>
        </div>
        <small>© 2026 Qwik Business Solutions. All rights reserved.</small>
      </aside>
      <main className="auth-main">
        <Card className="auth-card">{children}</Card>
      </main>
    </div>
  );
}
export function SignIn({ platform = false }: { platform?: boolean }) {
  const navigate = useNavigate(),
    client = useQueryClient();
  const form = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', portal: platform ? 'platform' : 'hrms' },
  });
  const mutation = useMutation({
    mutationFn: (v: z.output<typeof loginSchema>) => post('/auth/login', v),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['me'] });
      navigate('/dashboard');
    },
  });
  return (
    <AuthFrame platform={platform}>
      <span className="eyebrow">{platform ? 'STAFF SIGN IN' : 'WELCOME BACK'}</span>
      <h1>{platform ? 'Qwik Licence Manager' : 'Sign in to YardHRMS'}</h1>
      <p className="muted">Use your verified email and company credentials.</p>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <Field
          label="Email address"
          type="email"
          autoComplete="username"
          {...form.register('email')}
          error={form.formState.errors.email?.message}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        {mutation.error && <Notice tone="error">{mutation.error.message}</Notice>}
        <Button disabled={mutation.isPending} type="submit">
          {mutation.isPending ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} />
        </Button>
      </form>
      <Link to="/forgot-password">Forgot your password?</Link>
      {!platform && (
        <p className="auth-footer">
          New to YardHRMS? <Link to="/register">Start Free</Link>
        </p>
      )}
    </AuthFrame>
  );
}
export function Register() {
  const form = useForm<z.infer<typeof registerSchema>>({ resolver: zodResolver(registerSchema) });
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof registerSchema>) =>
      post<{ message: string }>('/auth/register', v),
  });
  return (
    <AuthFrame>
      <span className="eyebrow">START WITH FREE</span>
      <h1>A home for your team.</h1>
      <p className="muted">
        Create a company with your configured Free employee and user capacity.
      </p>
      {mutation.data ? (
        <Notice tone="success">
          {mutation.data.message} <Link to="/login">Go to sign in</Link>
        </Notice>
      ) : (
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
          <Field
            label="Your full name"
            autoComplete="name"
            {...form.register('name')}
            error={form.formState.errors.name?.message}
          />
          <Field
            label="Company name"
            autoComplete="organization"
            {...form.register('companyName')}
            error={form.formState.errors.companyName?.message}
          />
          <Field
            label="Work email"
            type="email"
            autoComplete="email"
            {...form.register('email')}
            error={form.formState.errors.email?.message}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
            error={form.formState.errors.password?.message}
          />
          <small className="muted">
            At least 12 characters. Administrator MFA enrollment follows email verification.
          </small>
          {mutation.error && <Notice tone="error">{mutation.error.message}</Notice>}
          <Button disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating company…' : 'Create Free company'}{' '}
            <ArrowRight size={17} />
          </Button>
        </form>
      )}
      <p className="auth-footer">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
export function EmailVerification({ platform = false }: { platform?: boolean }) {
  const [params] = useSearchParams();
  const mutation = useMutation({
    mutationFn: () =>
      post<{ message: string }>('/auth/verify-email', { token: params.get('token') || '' }),
  });
  return (
    <AuthFrame platform={platform}>
      <h1>Verify your email</h1>
      <p className="muted">Confirm that this mailbox belongs to you.</p>
      {mutation.data ? (
        <Notice tone="success">{mutation.data.message}</Notice>
      ) : (
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !params.get('token')}
        >
          Verify email
        </Button>
      )}
      {!params.get('token') && (
        <Notice tone="error">Open the complete link in your verification email.</Notice>
      )}
      {mutation.error && <Notice tone="error">{mutation.error.message}</Notice>}
      <Link to="/login">Back to sign in</Link>
    </AuthFrame>
  );
}
export function PasswordRecovery({
  reset = false,
  platform = false,
}: {
  reset?: boolean;
  platform?: boolean;
}) {
  const [params] = useSearchParams();
  const schema = z
    .object({ email: z.email().optional(), password: passwordSchema.optional() })
    .refine((v) => (reset ? Boolean(v.password) : Boolean(v.email)), {
      message: reset ? 'Enter a new password' : 'Enter your email',
      path: [reset ? 'password' : 'email'],
    });
  const form = useForm<{ email?: string; password?: string }>({ resolver: zodResolver(schema) });
  const mutation = useMutation({
    mutationFn: (b: { email?: string; password?: string }) =>
      post<{ message: string }>(
        reset ? '/auth/reset-password' : '/auth/forgot-password',
        reset
          ? { password: b.password, token: params.get('token') || '' }
          : { email: b.email, portal: platform ? 'platform' : 'hrms' },
      ),
  });
  return (
    <AuthFrame platform={platform}>
      <h1>{reset ? 'Set your password' : 'Reset your password'}</h1>
      <p className="muted">
        {reset
          ? 'Choose a strong password to protect your account.'
          : 'We’ll send a one-time link to your mailbox.'}
      </p>
      {mutation.data ? (
        <Notice tone="success">{mutation.data.message}</Notice>
      ) : (
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
          {reset ? (
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
              error={form.formState.errors.password?.message}
            />
          ) : (
            <Field
              label="Email address"
              type="email"
              autoComplete="email"
              {...form.register('email')}
              error={form.formState.errors.email?.message}
            />
          )}
          <Button disabled={mutation.isPending}>
            {reset ? 'Save password' : 'Send reset link'}
          </Button>
        </form>
      )}
      {mutation.error && <Notice tone="error">{mutation.error.message}</Notice>}
      <Link to="/login">Back to sign in</Link>
    </AuthFrame>
  );
}
export function MfaChallenge({ me }: { me: Me }) {
  const client = useQueryClient(),
    [code, setCode] = useState('');
  const setup = useMutation({
    mutationFn: () => post<{ secret: string; uri: string }>('/auth/mfa/setup', {}),
  });
  const verify = useMutation({
    mutationFn: () => post('/auth/mfa/verify', { code }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <div className="mfa-page">
      <Card className="auth-card">
        <ShieldCheck size={36} />
        <span className="eyebrow">ACCOUNT SECURITY</span>
        <h1>
          {me.mfaEnabled ? 'Verify your authenticator' : 'Set up multi-factor authentication'}
        </h1>
        <p className="muted">
          Privileged HR and Qwik accounts require an authenticator before accessing company data.
        </p>
        {!me.mfaEnabled && !setup.data && (
          <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
            Set up authenticator
          </Button>
        )}
        {setup.data && (
          <div className="mfa-secret">
            <p>Add this key to your authenticator as a time-based code:</p>
            <code>{setup.data.secret}</code>
            <details>
              <summary>Authenticator URI</summary>
              <code>{setup.data.uri}</code>
            </details>
          </div>
        )}
        {(me.mfaEnabled || setup.data) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify.mutate();
            }}
          >
            <Field
              label="Six-digit authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
            />
            <Button disabled={verify.isPending}>Verify and continue</Button>
          </form>
        )}
        {(verify.error || setup.error) && (
          <Notice tone="error">{(verify.error || setup.error)?.message}</Notice>
        )}
        <Button
          variant="secondary"
          onClick={async () => {
            await post('/auth/logout', {});
            client.clear();
            location.assign('/login');
          }}
        >
          Sign out
        </Button>
      </Card>
    </div>
  );
}
export const getMe = () => api<Me>('/me');
