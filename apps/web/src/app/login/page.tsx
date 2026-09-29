'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Orb } from '@/components/orb';
import { Button, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email, password });
      await qc.invalidateQueries();
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-4">
      <Field label="Email">
        {(id) => (
          <Input
            id={id}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        )}
      </Field>
      <Field label="Password" error={error}>
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" loading={busy} className="mt-2">
        Sign in <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="relative grid min-h-full place-items-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(600px_260px_at_50%_-40px,rgba(161,149,255,0.12),transparent_70%)]" />
      <div className="relative flex w-full max-w-[380px] animate-rise flex-col items-center gap-6">
        <Orb size={180} />
        <div className="text-center">
          <h1 className="text-[26px] font-semibold tracking-tight">List Software</h1>
          <p className="mt-1 text-[14px] text-muted">Agentic engineering platform</p>
        </div>
        <div className="w-full rounded-[20px] border border-line-2 bg-panel p-6">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="text-center text-[12px] text-faint">
          Accounts are created by a workspace administrator.
        </p>
      </div>
    </main>
  );
}
