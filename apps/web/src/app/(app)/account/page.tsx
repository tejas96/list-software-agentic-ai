'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ROLE_LABELS } from '@lsa/contracts';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loading,
  Pill,
  errorText,
  useToast,
} from '@/components/ui';
import { dateTime } from '@/lib/format';
import { post, useMe } from '@/lib/queries';

export default function AccountPage() {
  const me = useMe().data;
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  if (!me) return <Loading />;

  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = current.length > 0 && next.length >= 10 && next === confirm;
  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await post('/auth/password', { currentPassword: current, newPassword: next });
      toast('Password changed. Your other sessions were signed out.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      toast(errorText(err), 'bad');
    } finally {
      setSaving(false);
    }
  };
  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    window.location.href = '/login';
  };

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={me.name} size={52} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-semibold tracking-tight">{me.name}</h1>
          <div className="text-[13px] text-muted">
            {me.email}
            {me.lastLoginAt ? ` · last sign-in ${dateTime(me.lastLoginAt)}` : ''}
          </div>
        </div>
        {me.isAdmin && <Pill tone="accent">Workspace admin</Pill>}
        <Button variant="ghost" onClick={logout}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>

      <Card>
        <CardHeader title="Projects" />
        <div className="flex flex-col divide-y divide-line">
          {me.memberships.length === 0 && (
            <p className="px-5 py-4 text-[13px] text-faint">
              {me.isAdmin
                ? 'As a workspace admin you can open every project.'
                : 'You are not in any project yet.'}
            </p>
          )}
          {me.memberships.map((m) => (
            <Link
              key={m.projectId}
              href={`/projects/${m.projectKey}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02]"
            >
              <span className="w-14 font-mono text-[12px] text-accent">{m.projectKey}</span>
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{m.projectName}</span>
              <Pill>{ROLE_LABELS[m.role]}</Pill>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Change password" />
        <form onSubmit={change} className="flex flex-col gap-4 p-5">
          <Field label="Current password">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="New password"
              hint="At least 10 characters"
              error={next.length > 0 && next.length < 10 ? 'Too short' : null}
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                />
              )}
            </Field>
            <Field label="Repeat new password" error={mismatch ? 'Does not match' : null}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              )}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={saving} disabled={!valid}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
