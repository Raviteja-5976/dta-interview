/**
 * Grant credits to one user.
 *
 * Deliberately a little slow to use: the amount starts blank rather than at a
 * convenient default, and the note is right there. A grant is money, and this is
 * the one screen in the app that creates it out of nothing.
 *
 * The quick amounts are the credit packs, so "give them what the ₹249 plan
 * would have given them" is one click rather than a number remembered wrong.
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, X, Zap } from 'lucide-react';

import { Button } from '@/components/app/ui';
import { CREDIT_PACKS } from '@/lib/credits';
import type { AdminUserRow } from '@/app/admin/page';

export default function GrantCreditsDialog({
  user,
  onClose,
  onGranted,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onGranted: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes. A modal that traps you is worse than no modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const parsed = Math.floor(Number(amount));
  const valid = Number.isFinite(parsed) && parsed > 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, amount: parsed, reason: note.trim() }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? 'The grant did not go through.');
        return;
      }
      onGranted();
    } catch {
      setError('Could not reach the server. No credits were added.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#1B1F3B]/40 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white border-4 border-[#1B1F3B] rounded-3xl shadow-[8px_8px_0_#1B1F3B] p-6"
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold text-[#1B1F3B]">
            Grant credits
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded-lg hover:bg-[#F5EBE0] disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-[#1B1F3B]" />
          </button>
        </div>

        <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 mb-5">
          {user.full_name ? `${user.full_name} · ` : ''}
          {user.email ?? user.id}
          <span className="block mt-0.5 tabular-nums">Balance now: {user.credits_balance}</span>
        </p>

        <label className="block font-[family-name:var(--font-display)] text-sm font-bold text-[#1B1F3B] mb-2">
          How many credits
        </label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          inputMode="numeric"
          autoFocus
          placeholder="250"
          className="w-full px-4 py-3 bg-white border-4 border-[#1B1F3B] rounded-2xl shadow-[3px_3px_0_#1B1F3B] font-[family-name:var(--font-mono)] font-bold tabular-nums focus:outline-none focus:shadow-[5px_5px_0_#FF6B35]"
        />

        <div className="flex flex-wrap gap-2 mt-3">
          {CREDIT_PACKS.map((pack) => (
            <button
              key={pack.id}
              onClick={() => setAmount(String(pack.credits))}
              className="px-3 py-1.5 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-full font-[family-name:var(--font-mono)] text-[11px] font-bold hover:bg-[#FFC93C] transition-colors"
            >
              {pack.credits} · ₹{pack.priceInr}
            </button>
          ))}
        </div>

        <label className="block font-[family-name:var(--font-display)] text-sm font-bold text-[#1B1F3B] mt-5 mb-2">
          Why <span className="font-normal text-[#1B1F3B]/50">(goes on the ledger entry)</span>
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="Workshop — code didn't work"
          maxLength={200}
          className="w-full px-4 py-3 bg-white border-4 border-[#1B1F3B] rounded-2xl shadow-[3px_3px_0_#1B1F3B] text-sm focus:outline-none focus:shadow-[5px_5px_0_#FF6B35]"
        />

        {error && (
          <p className="mt-4 font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF5C7A]">{error}</p>
        )}

        <div className="flex gap-3 mt-6">
          <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1">
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy} className="flex-1">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {busy ? 'Granting…' : `Grant ${valid ? parsed : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
