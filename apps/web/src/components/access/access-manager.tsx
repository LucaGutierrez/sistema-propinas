'use client';

import { EyeIcon, MailPlusIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { nativeSelectClass } from '@/components/ui/native-select';
import { ROLES, inviteMember, removeMember, updateMember } from '@/lib/demo-store/members';
import type { Member, Role, Venue } from '@/lib/demo-store/model';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/lib/demo-store/permissions';
import { newId, useDemoStore } from '@/lib/demo-store/store';
import { setViewAs } from '@/lib/demo-store/workspace';
import { cn } from '@/lib/utils';

const ROLE_BADGE: Record<Role, string> = {
  ENCARGADO: 'border-primary/30 bg-primary/10 text-primary',
  EDITOR: 'border-amber-200 bg-amber-100 text-amber-800',
  LECTOR: 'border-sky-200 bg-sky-100 text-sky-800',
  PROPIO: 'border-stone-300 bg-stone-100 text-stone-700',
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant="outline" className={ROLE_BADGE[role]}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

export function AccessManager() {
  return (
    <AccessGate need="manageAccess">
      <AccessContent />
    </AccessGate>
  );
}

function AccessContent() {
  const { venue } = useDemoStore();
  if (!venue) return null;

  return (
    <>
      <PageHeader
        title="Acceso"
        description={`Quién puede entrar a ${venue.name} y qué puede hacer.`}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="gap-0 pb-0">
            <CardHeader className="pb-4">
              <CardTitle>Personas con acceso</CardTitle>
              <CardDescription>
                Además de vos, que sos el encargado y dueño de la cuenta.
              </CardDescription>
            </CardHeader>
            {venue.members.length === 0 ? (
              <p className="border-t px-5 py-8 text-center text-sm text-muted-foreground">
                Todavía no invitaste a nadie a {venue.name}.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {venue.members.map((member) => (
                  <MemberRow key={member.id} venue={venue} member={member} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheckIcon className="size-4 text-primary" />
                Permisos
              </CardTitle>
              <CardDescription>Se asignan por persona y por local.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ROLES.map((role) => (
                  <div key={role} className="rounded-lg border p-3">
                    <dt>
                      <RoleBadge role={role} />
                    </dt>
                    <dd className="mt-1.5 text-sm text-muted-foreground">
                      {ROLE_DESCRIPTION[role]}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>

        <InviteForm venue={venue} />
      </div>
    </>
  );
}

function MemberRow({ venue, member }: { venue: Venue; member: Member }) {
  const { apply, applyWorkspace } = useDemoStore();
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staff = venue.staff.find((s) => s.id === member.staffId);

  function viewAs() {
    const failure = applyWorkspace((ws) => setViewAs(ws, member.id));
    if (failure) {
      setError(failure);
      return;
    }
    router.push(member.role === 'PROPIO' ? '/mis-sobres' : '/');
  }

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{member.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {member.email || 'sin email'}
            {staff ? ` · en el personal como ${staff.name}` : ''}
          </p>
        </div>
        <Badge variant="warning">Invitación pendiente</Badge>
        <select
          aria-label={`Permiso de ${member.name}`}
          className={cn(nativeSelectClass, 'w-36')}
          value={member.role}
          onChange={(event) =>
            setError(apply((v) => updateMember(v, member.id, { role: event.target.value as Role })))
          }
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={viewAs}>
          <EyeIcon />
          Ver como {member.name}
        </Button>
        {confirmRemove ? (
          <>
            <span className="text-sm text-muted-foreground">¿Quitarle el acceso?</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setError(apply((v) => removeMember(v, member.id)))}
            >
              Sí, quitar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2Icon />
            Quitar acceso
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function InviteForm({ venue }: { venue: Venue }) {
  const { apply } = useDemoStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('LECTOR');
  const [staffId, setStaffId] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const linkedIds = new Set(venue.members.map((m) => m.staffId));
  const available = venue.staff.filter((s) => s.active && !linkedIds.has(s.id));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const error = apply((v) =>
      inviteMember(v, {
        id: newId('miembro'),
        name,
        email,
        role,
        staffId: staffId || null,
        invitedAt: new Date().toISOString(),
      }),
    );
    if (error) {
      setMessage({ error: true, text: error });
      return;
    }
    setMessage({ error: false, text: `Invitaste a ${name.trim()} como ${ROLE_LABEL[role]}.` });
    setName('');
    setEmail('');
    setStaffId('');
  }

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailPlusIcon className="size-4 text-primary" />
          Invitar
        </CardTitle>
        <CardDescription>A un camarero, al de cocina o a otro encargado.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invitado-personal">¿Es parte del personal?</Label>
            <select
              id="invitado-personal"
              className={nativeSelectClass}
              value={staffId}
              onChange={(event) => {
                const id = event.target.value;
                setStaffId(id);
                const person = venue.staff.find((s) => s.id === id);
                if (person && name.trim() === '') setName(person.name);
                setMessage(null);
              }}
            >
              <option value="">No, no cobra propina</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invitado-nombre">Nombre</Label>
            <Input
              id="invitado-nombre"
              value={name}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                setMessage(null);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invitado-email">Email (opcional)</Label>
            <Input
              id="invitado-email"
              type="email"
              value={email}
              autoComplete="off"
              placeholder="nombre@ejemplo.com"
              onChange={(event) => {
                setEmail(event.target.value);
                setMessage(null);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invitado-permiso">Permiso</Label>
            <select
              id="invitado-permiso"
              className={nativeSelectClass}
              value={role}
              onChange={(event) => {
                setRole(event.target.value as Role);
                setMessage(null);
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION[role]}</p>
          </div>
          {message ? (
            <p
              role={message.error ? 'alert' : 'status'}
              className={cn('text-sm', message.error ? 'text-destructive' : 'text-primary')}
            >
              {message.text}
            </p>
          ) : null}
          <Button type="submit" className="w-full">
            <MailPlusIcon />
            Invitar
          </Button>
          <p className="text-xs text-muted-foreground">
            Demo: la invitación queda pendiente. Con el login, la persona va a recibir un enlace
            para crear su cuenta y entrar solo a este local.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
