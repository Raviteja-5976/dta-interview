/**
 * "I have a coupon" — the student half of the coupon system.
 *
 * Calls `redeem_promo_code()` directly (migration 020). No route handler in
 * between, because the RPC *is* the security boundary: it reads auth.uid()
 * itself, locks the code row so a lecture hall submitting at once cannot push
 * the count past its cap, and writes the balance and the ledger entry in one
 * transaction. A handler wrapping it would add a hop and check nothing extra.
 *
 * The RPC returns a message rather than raising, so every failure — expired,
 * already used, all claimed — arrives as a sentence to show, not a Postgres
 * error string to parse.
 *
 * Two shells, same innards: `card` for a page that is a stack of cards
 * (/credits, /dashboard), `inline` for somewhere already inside a bordered
 * panel (the profile page's Credits tab), where a second 4px border would read
 * as a box inside a box.
 */

'use client';

import { useState } from 'react';
import { Check, Loader2, Ticket } from 'lucide-react';

import { Button, Card } from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

interface RedeemResult {
  ok: boolean;
  error?: string;
  message?: string;
  credits?: number;
  balance?: number;
  code?: string;
}

export default function RedeemCode({
  onRedeemed,
  variant = 'card',
  className = 'p-5 mb-8',
}: {
  onRedeemed: () => void;
  variant?: 'card' | 'inline';
  /** Card shell only — the parent owns padding and spacing. */
  className?: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<number | null>(null);

  const redeem = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('redeem_promo_code', { p_code: code });

    setBusy(false);

    if (rpcError) {
      setError('Could not reach the server. Try again in a moment.');
      return;
    }

    const result = data as RedeemResult;
    if (!result?.ok) {
      setError(result?.message ?? 'That code is not valid.');
      return;
    }

    setGranted(result.credits ?? 0);
    setCode('');
    onRedeemed();
  };

  const success = (
    <div className="flex items-center gap-3">
      <Check className="w-6 h-6 shrink-0 text-[#1B1F3B]" />
      <div>
        <p className="font-[family-name:var(--font-display)] font-extrabold text-[#1B1F3B]">
          {granted} credits added.
        </p>
        <p className="text-sm text-[#1B1F3B]/70">
          They are in your balance now — start an interview whenever you like.
        </p>
      </div>
    </div>
  );

  const form = (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Ticket className="w-5 h-5 text-[#FF6B35]" />
          <span className="font-[family-name:var(--font-display)] font-bold text-sm text-[#1B1F3B]">
            I have a coupon
          </span>
        </div>

        <input
          value={code}
          // Uppercased as you type so the field shows the code as it is stored —
          // nobody should wonder whether case matters. It does not.
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // The profile page renders this inside its own <form>. Without this,
            // Enter would save the whole profile instead of redeeming.
            e.preventDefault();
            void redeem();
          }}
          placeholder="DTAWORKSHOP"
          maxLength={32}
          disabled={busy}
          className="flex-1 px-4 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-mono)] font-bold text-sm tracking-wider focus:outline-none focus:shadow-[3px_3px_0_#FF6B35]"
        />

        <Button onClick={() => void redeem()} disabled={busy || !code.trim()} variant="secondary">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? 'Checking…' : 'Redeem'}
        </Button>
      </div>

      {error && (
        <p className="mt-3 font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF5C7A]">{error}</p>
      )}
    </>
  );

  if (variant === 'inline') {
    return (
      <div
        className={`border-2 border-[#1B1F3B] rounded-2xl p-4 ${
          granted != null ? 'bg-[#6EE7B7]/25' : 'bg-[#FFF8F0]'
        }`}
      >
        {granted != null ? success : form}
      </div>
    );
  }

  return (
    <Card className={className} accent={granted != null ? 'mint' : undefined}>
      {granted != null ? success : form}
    </Card>
  );
}
