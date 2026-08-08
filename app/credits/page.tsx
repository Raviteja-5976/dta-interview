/**
 * /credits — balance, packs, checkout, and the ledger (sitemap-workflow.md §12).
 *
 * Refunds are shown explicitly, because a visible refund builds more trust than
 * a silent one. That matters more under metered billing than it did before:
 * every finished interview produces a refund row for the unused hold, and a user
 * who does not understand why would assume they were double-charged.
 */

'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Check, Loader2, Zap } from 'lucide-react';

import AppHeader from '@/components/layout/AppHeader';
import { Button, Card, Chip, ErrorCard, Eyebrow, SectionTitle, Skeleton } from '@/components/app/ui';
import { paymentsEnabled, useRazorpayCheckout } from '@/components/app/useRazorpayCheckout';
import {
  CODING_MODULE_CREDITS,
  CREDITS_PER_MINUTE,
  CREDIT_PACKS,
  SYSTEM_DESIGN_MODULE_CREDITS,
} from '@/lib/credits';
import { supabase } from '@/lib/supabase/client';

interface LedgerRow {
  id: number;
  kind: 'purchase' | 'grant' | 'spend' | 'refund' | 'expiry';
  amount: number;
  balance_after: number;
  session_id: string | null;
  meta: { reason?: string; breakdown?: Record<string, number>; charged?: number } | null;
  created_at: string;
}

interface PaymentRow {
  razorpay_order_id: string;
  pack_id: string;
  credits: number;
  amount_paise: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
}

const KIND_LABEL: Record<LedgerRow['kind'], string> = {
  purchase: 'Purchased',
  grant: 'Free credits',
  spend: 'Interview',
  refund: 'Refunded',
  expiry: 'Expired',
};

export default function CreditsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FFF8F0]">
          <AppHeader />
          <main className="max-w-[900px] mx-auto px-4 md:px-8 py-8">
            <Skeleton className="h-64" />
          </main>
        </div>
      }
    >
      <CreditsContent />
    </Suspense>
  );
}

function CreditsContent() {
  const search = useSearchParams();
  const next = search.get('next');

  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setLoading(false);
      return;
    }

    const [{ data: profile }, { data: rows }, { data: pays }] = await Promise.all([
      supabase.from('profiles').select('credits_balance').eq('id', auth.user.id).maybeSingle(),
      supabase
        .from('credit_ledger')
        .select('id, kind, amount, balance_after, session_id, meta, created_at')
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('payments')
        .select('razorpay_order_id, pack_id, credits, amount_paise, status, failure_reason, created_at')
        .eq('user_id', auth.user.id)
        .neq('status', 'captured')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    setBalance(profile?.credits_balance ?? 0);
    setLedger((rows as LedgerRow[]) ?? []);
    setPayments((pays as PaymentRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const checkout = useRazorpayCheckout(() => {
    void load();
  });

  const busy = checkout.status === 'starting' || checkout.status === 'open' || checkout.status === 'verifying';

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <AppHeader />
      <main className="max-w-[900px] mx-auto px-4 md:px-8 py-8">
        {loading ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            {/* Balance as the hero number */}
            <Card className="p-8 mb-6 text-center" accent="orange">
              <Eyebrow>Your balance</Eyebrow>
              <div className="flex items-center justify-center gap-3 mt-3">
                <Zap className="w-10 h-10 text-[#FF6B35] fill-[#FF6B35]" />
                <span className="font-[family-name:var(--font-display)] text-6xl font-extrabold tabular-nums text-[#1B1F3B]">
                  {balance}
                </span>
              </div>
              <p className="mt-2 text-sm text-[#1B1F3B]/70 tabular-nums">
                About {Math.floor(balance / CREDITS_PER_MINUTE)} minutes of interview.
              </p>
              {next && (
                <p className="mt-4">
                  <Link
                    href={next}
                    className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline"
                  >
                    ← Back to your interview setup
                  </Link>
                </p>
              )}
            </Card>

            {/* Purchase result */}
            {checkout.status === 'success' && (
              <Card className="p-5 mb-6" accent="mint">
                <div className="flex items-center gap-3">
                  <Check className="w-6 h-6 text-[#1B1F3B] shrink-0" />
                  <div>
                    <p className="font-[family-name:var(--font-display)] font-extrabold">
                      {checkout.credited} credits added.
                    </p>
                    <p className="text-sm text-[#1B1F3B]/70">
                      You&apos;re all set — start an interview whenever you&apos;re ready.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {checkout.status === 'error' && checkout.error && (
              <div className="mb-6">
                <ErrorCard
                  heading="That payment didn't complete"
                  body={checkout.error}
                  action={
                    <Button variant="secondary" onClick={checkout.reset}>
                      Try again
                    </Button>
                  }
                />
              </div>
            )}

            {/* Packs */}
            <SectionTitle sub={`${CREDITS_PER_MINUTE} credits per minute · coding round ${CODING_MODULE_CREDITS} · system design ${SYSTEM_DESIGN_MODULE_CREDITS}`}>
              Buy credits
            </SectionTitle>

            <div className="grid md:grid-cols-3 gap-4 mb-8">
              {CREDIT_PACKS.map((pack, i) => (
                <Card
                  key={pack.id}
                  className="p-6 flex flex-col"
                  accent={pack.popular ? 'orange' : undefined}
                  tilt={i === 0 ? -1 : i === 2 ? 1 : 0}
                >
                  {pack.popular && (
                    <div className="mb-2">
                      <Chip accent="yellow">Most popular</Chip>
                    </div>
                  )}

                  <h3 className="font-[family-name:var(--font-display)] text-lg font-extrabold">
                    {pack.name}
                  </h3>
                  <p className="text-xs text-[#1B1F3B]/65 mt-0.5">{pack.tagline}</p>

                  <p className="font-[family-name:var(--font-display)] text-4xl font-extrabold text-[#FF6B35] tabular-nums my-3">
                    {pack.credits}
                    <span className="text-base text-[#1B1F3B]/60 font-bold ml-1">credits</span>
                  </p>

                  <p className="font-[family-name:var(--font-mono)] text-sm font-bold text-[#1B1F3B] mb-5 tabular-nums">
                    ₹{pack.priceInr}
                    <span className="text-[#1B1F3B]/50 font-normal ml-2">
                      ≈ {Math.floor(pack.credits / CREDITS_PER_MINUTE)} min
                    </span>
                  </p>

                  <div className="mt-auto">
                    <Button
                      onClick={() => void checkout.buy(pack.id)}
                      disabled={busy || !paymentsEnabled}
                      variant={pack.popular ? 'primary' : 'secondary'}
                      className="w-full"
                      title={paymentsEnabled ? undefined : 'Payments are not switched on yet'}
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {!paymentsEnabled
                        ? 'Coming soon'
                        : checkout.status === 'verifying'
                          ? 'Confirming…'
                          : `Buy for ₹${pack.priceInr}`}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            {paymentsEnabled ? (
              <p className="text-center font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50 mb-10">
                Payments processed by Razorpay · UPI, cards, netbanking and wallets · Credits never
                expire
              </p>
            ) : (
              <Card className="p-4 mb-10 text-center" accent="yellow">
                <p className="font-[family-name:var(--font-display)] font-bold text-sm">
                  Buying credits isn&apos;t live yet.
                </p>
                <p className="text-xs text-[#1B1F3B]/70 mt-1">
                  Your signup credits still work — start an interview whenever you like.
                </p>
              </Card>
            )}

            {/* Incomplete payments — surfaced rather than hidden */}
            {payments.length > 0 && (
              <>
                <SectionTitle>Incomplete payments</SectionTitle>
                <Card className="p-5 mb-8">
                  <div className="space-y-2">
                    {payments.map((p) => (
                      <div
                        key={p.razorpay_order_id}
                        className="flex items-center justify-between gap-3 p-3 border-2 border-[#1B1F3B] rounded-2xl"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <AlertCircle className="w-4 h-4 text-[#FF5C7A] shrink-0" />
                          <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/70 truncate">
                            {p.credits} credits · ₹{(p.amount_paise / 100).toFixed(0)} ·{' '}
                            {new Date(p.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <Chip accent="coral">{p.failure_reason ?? p.status}</Chip>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/55">
                    Nothing was charged for these. If money did leave your account, it is
                    auto-refunded by your bank within 5-7 working days.
                  </p>
                </Card>
              </>
            )}

            {/* Ledger */}
            <SectionTitle>History</SectionTitle>
            <Card className="p-6">
              {ledger.length === 0 ? (
                <p className="text-sm text-[#1B1F3B]/70">
                  Nothing here yet. Your signup credits will show as your first entry.
                </p>
              ) : (
                <div className="space-y-2">
                  {ledger.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 p-3 border-2 border-[#1B1F3B] rounded-2xl"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Chip
                          accent={
                            row.kind === 'refund'
                              ? 'mint'
                              : row.kind === 'spend'
                                ? 'coral'
                                : row.kind === 'purchase'
                                  ? 'sky'
                                  : 'yellow'
                          }
                        >
                          {row.meta?.reason === 'settlement' ? 'Unused time' : KIND_LABEL[row.kind]}
                        </Chip>
                        <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 truncate">
                          {new Date(row.created_at).toLocaleString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {row.session_id && (
                          <Link
                            href={`/sessions/${row.session_id}/report`}
                            className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline shrink-0"
                          >
                            View →
                          </Link>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`font-[family-name:var(--font-display)] font-extrabold tabular-nums ${
                            row.amount > 0 ? 'text-[#0d9488]' : 'text-[#FF5C7A]'
                          }`}
                        >
                          {row.amount > 0 ? '+' : ''}
                          {row.amount}
                        </span>
                        <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50 tabular-nums w-10 text-right">
                          {row.balance_after}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
