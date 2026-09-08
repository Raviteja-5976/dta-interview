/**
 * /admin/coupons — create a code, watch it being claimed, switch it off.
 *
 * The workshop tool. One code on a slide beats granting credits by hand to sixty
 * people who all sign up in the same ten minutes — and you cannot grant to an
 * account that does not exist yet.
 *
 * The cap and the expiry are the controls that matter, so the form nudges toward
 * setting them. Per-user uniqueness is enforced in the database but it is not
 * what protects you: the code will end up in a group chat, and a second Google
 * account defeats uniqueness in thirty seconds. A cap does not care.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Ticket } from 'lucide-react';

import { Button, Card, Chip, EmptyState, ErrorCard, SectionTitle, Skeleton } from '@/components/app/ui';
import { CREDIT_PACKS } from '@/lib/credits';

interface Coupon {
  code: string;
  credits: number;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');

  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/coupons');
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body.error ?? 'Could not load coupons.');
        return;
      }
      setCoupons(body.coupons);
    } catch {
      setLoadError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A fetch on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setFormError(null);
    setJustCreated(null);

    try {
      const res = await fetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          credits: Number(credits),
          maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
          // A date input gives a bare day; the code should live to the end of it.
          expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
          note,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setFormError(body.error ?? 'Could not create that code.');
        return;
      }

      setJustCreated(body.coupon.code);
      setCode('');
      setCredits('');
      setMaxRedemptions('');
      setExpiresAt('');
      setNote('');
      void load();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (coupon: Coupon) => {
    // Optimistic: the switch should feel instant, and load() puts it right if
    // the server disagrees.
    setCoupons((cs) => cs.map((c) => (c.code === coupon.code ? { ...c, active: !c.active } : c)));

    await fetch('/api/admin/coupons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: coupon.code, active: !coupon.active }),
    });
    void load();
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard is blocked in some browsers over http. The code is on screen.
    }
  };

  return (
    <>
      {/* Create */}
      <Card className="p-6 md:p-8 mb-8" accent="orange">
        <SectionTitle sub="Anyone signed in can redeem it once. Credits land immediately.">
          New code
        </SectionTitle>

        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Code" hint="Letters, digits and dashes">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              placeholder="DTAWORKSHOP"
              maxLength={32}
              className={INPUT + ' font-[family-name:var(--font-mono)] font-bold tracking-wider'}
            />
          </Field>

          <Field label="Credits per person" hint="What each redemption is worth">
            <input
              value={credits}
              onChange={(e) => setCredits(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="250"
              className={INPUT + ' font-[family-name:var(--font-mono)] font-bold tabular-nums'}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {CREDIT_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  onClick={() => setCredits(String(pack.credits))}
                  className="px-3 py-1 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-full font-[family-name:var(--font-mono)] text-[11px] font-bold hover:bg-[#FFC93C] transition-colors"
                >
                  {pack.name} · {pack.credits}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label="Redemption limit"
            hint="Blank means unlimited. Set it — this is what caps your exposure when the code leaks."
          >
            <input
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="80"
              className={INPUT + ' font-[family-name:var(--font-mono)] font-bold tabular-nums'}
            />
          </Field>

          <Field label="Expires" hint="End of that day. Blank means never.">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={INPUT + ' font-[family-name:var(--font-mono)]'}
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="Note" hint="For you, later — which workshop, which batch">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Intro offer — college workshop, Sept batch"
                maxLength={200}
                className={INPUT}
              />
            </Field>
          </div>
        </div>

        {formError && (
          <p className="mt-4 font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF5C7A]">
            {formError}
          </p>
        )}

        {justCreated && (
          <div className="mt-4 flex items-center gap-3 p-3 bg-[#6EE7B7]/25 border-2 border-[#1B1F3B] rounded-2xl">
            <Check className="w-5 h-5 shrink-0" />
            <p className="font-[family-name:var(--font-display)] font-bold text-sm">
              <span className="font-[family-name:var(--font-mono)] tracking-wider">{justCreated}</span>{' '}
              is live. Put it on the slide.
            </p>
          </div>
        )}

        <div className="mt-6">
          <Button onClick={() => void create()} disabled={creating || !code || !credits}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
            {creating ? 'Creating…' : 'Create code'}
          </Button>
        </div>
      </Card>

      {/* List */}
      <SectionTitle>All codes</SectionTitle>

      {loadError && (
        <div className="mb-6">
          <ErrorCard
            heading="Could not load coupons"
            body={loadError}
            action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}
          />
        </div>
      )}

      {loading && coupons.length === 0 ? (
        <Skeleton className="h-48" />
      ) : coupons.length === 0 ? (
        <EmptyState
          heading="No codes yet."
          body="Create one above. It works the moment it exists — students redeem it on the credits page."
        />
      ) : (
        <div className="space-y-3">
          {coupons.map((c) => {
            const expired = c.expires_at != null && new Date(c.expires_at) <= new Date();
            const exhausted = c.max_redemptions != null && c.redeemed_count >= c.max_redemptions;
            const live = c.active && !expired && !exhausted;
            const pct =
              c.max_redemptions != null
                ? Math.min(100, (c.redeemed_count / c.max_redemptions) * 100)
                : 0;

            return (
              <Card key={c.code} className="p-5" accent={live ? 'mint' : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void copy(c.code)}
                        title="Copy code"
                        className="inline-flex items-center gap-2 font-[family-name:var(--font-mono)] text-lg font-bold tracking-wider text-[#1B1F3B] hover:text-[#FF6B35] transition-colors"
                      >
                        {c.code}
                        {copied === c.code ? (
                          <Check className="w-4 h-4 text-[#0d9488]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 opacity-40" />
                        )}
                      </button>

                      {live ? (
                        <Chip accent="mint">Live</Chip>
                      ) : !c.active ? (
                        <Chip>Switched off</Chip>
                      ) : expired ? (
                        <Chip accent="coral">Expired</Chip>
                      ) : (
                        <Chip accent="yellow">Fully claimed</Chip>
                      )}
                    </div>

                    <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 mt-1.5 tabular-nums">
                      {c.credits} credits each
                      {c.expires_at &&
                        ` · ${expired ? 'expired' : 'expires'} ${new Date(c.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                    </p>
                    {c.note && <p className="text-xs text-[#1B1F3B]/55 mt-1">{c.note}</p>}
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="font-[family-name:var(--font-display)] text-2xl font-extrabold tabular-nums text-[#1B1F3B]">
                        {c.redeemed_count}
                        {c.max_redemptions != null && (
                          <span className="text-base text-[#1B1F3B]/40">/{c.max_redemptions}</span>
                        )}
                      </p>
                      <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-[#1B1F3B]/50">
                        claimed
                      </p>
                    </div>

                    <Button variant="secondary" onClick={() => void toggle(c)}>
                      {c.active ? 'Switch off' : 'Switch on'}
                    </Button>
                  </div>
                </div>

                {/* How close the cap is — the number worth watching mid-workshop. */}
                {c.max_redemptions != null && (
                  <div className="mt-4 h-3 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-full overflow-hidden">
                    <div
                      style={{
                        width: `${pct}%`,
                        backgroundColor: pct >= 100 ? '#FF5C7A' : pct >= 80 ? '#FFC93C' : '#6EE7B7',
                      }}
                      className="h-full transition-all duration-700"
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

const INPUT =
  'w-full px-4 py-3 bg-white border-4 border-[#1B1F3B] rounded-2xl shadow-[3px_3px_0_#1B1F3B] text-sm focus:outline-none focus:shadow-[5px_5px_0_#FF6B35]';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block font-[family-name:var(--font-display)] text-sm font-bold text-[#1B1F3B] mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-[#1B1F3B]/55 mb-2">{hint}</p>}
      {children}
    </div>
  );
}
