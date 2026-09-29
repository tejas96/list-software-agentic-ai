'use client';

import { UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import type { UserDto } from '@lsa/contracts';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  Pill,
  Toggle,
  errorText,
  useToast,
} from '@/components/ui';
import { ago } from '@/lib/format';
import { keys, patch, post, useAction, useMe, useUsers } from '@/lib/queries';

export default function UsersPage() {
  const me = useMe().data;
  const users = useUsers(!!me?.isAdmin);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);

  if (me && !me.isAdmin)
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="Workspace admins only"
        body="Ask a workspace administrator to manage users."
      />
    );

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-6 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Workspace</div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Users</h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">
            Everyone who can sign in. Add people to projects from each project’s People tab to decide what
            they can see and do.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> Add user
        </Button>
      </div>
      <Card>
        <CardHeader title={`${users.data?.length ?? 0} ${users.data?.length === 1 ? 'user' : 'users'}`} />
        {users.isLoading ? (
          <Loading />
        ) : users.error ? (
          <ErrorBox error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {(users.data ?? []).map((u) => (
              <button
                key={u.id}
                onClick={() => setEditing(u)}
                className="flex flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.02]"
              >
                <Avatar name={u.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 text-[12px] text-faint">(you)</span>}
                  </div>
                  <div className="truncate text-[12px] text-faint">{u.email}</div>
                </div>
                <span className="text-[12px] text-faint">
                  {u.lastLoginAt ? `signed in ${ago(u.lastLoginAt)}` : 'never signed in'}
                </span>
                {u.isAdmin && <Pill tone="accent">Admin</Pill>}
                {u.status === 'disabled' && <Pill tone="bad">Disabled</Pill>}
              </button>
            ))}
          </div>
        )}
      </Card>
      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <EditUserModal user={editing} self={editing?.id === me?.id} onClose={() => setEditing(null)} />
    </div>
  );
}

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const create = useAction((b: unknown) => post<UserDto>('/users', b), [keys.users, keys.directory]);
  const valid = name.trim().length > 0 && /.+@.+\..+/.test(email) && password.length >= 10;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add user"
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({ name: name.trim(), email: email.trim(), password, isAdmin });
                toast(`${name.trim()} can now sign in`);
                setName('');
                setEmail('');
                setPassword('');
                setIsAdmin(false);
                onClose();
              } catch (err) {
                toast(errorText(err), 'bad');
              }
            }}
          >
            Add user
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          label="Temporary password"
          hint="At least 10 characters. Share it privately; they can change it under Account."
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Toggle
          checked={isAdmin}
          onChange={setIsAdmin}
          label="Workspace admin"
          description="Can manage users and every project."
        />
      </div>
    </Modal>
  );
}

function EditUserModal({
  user,
  self,
  onClose,
}: {
  user: UserDto | null;
  self: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [active, setActive] = useState(true);
  const [password, setPassword] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);
  if (user && loaded !== user.id) {
    setLoaded(user.id);
    setName(user.name);
    setIsAdmin(user.isAdmin);
    setActive(user.status === 'active');
    setPassword('');
  }
  const save = useAction(
    (b: unknown) => patch<UserDto>(`/users/${user?.id}`, b),
    [keys.users, keys.directory],
  );
  if (!user) return null;
  const body = {
    ...(name.trim() !== user.name && { name: name.trim() }),
    ...(isAdmin !== user.isAdmin && { isAdmin }),
    ...(active !== (user.status === 'active') && { status: active ? 'active' : 'disabled' }),
    ...(password && { password }),
  };
  const dirty = Object.keys(body).length > 0;
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={user.name}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || (password.length > 0 && password.length < 10) || !name.trim()}
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync(body);
                toast('User updated');
                onClose();
              } catch (err) {
                toast(errorText(err), 'bad');
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="text-[12.5px] text-faint">
          {user.email} · added {ago(user.createdAt)}
        </div>
        <Field label="Name">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Toggle
          checked={isAdmin}
          onChange={(v) => !self && setIsAdmin(v)}
          label="Workspace admin"
          description={
            self ? 'You cannot remove your own admin access.' : 'Can manage users and every project.'
          }
        />
        <Toggle
          checked={active}
          onChange={(v) => !self && setActive(v)}
          label="Can sign in"
          description={
            self ? 'You cannot disable yourself.' : 'Disabling signs them out everywhere immediately.'
          }
        />
        {!self && (
          <Field
            label="Reset password"
            hint="Leave empty to keep the current one. Resetting signs them out everywhere."
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            )}
          </Field>
        )}
      </div>
    </Modal>
  );
}
