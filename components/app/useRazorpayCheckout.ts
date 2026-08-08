/**
 * Razorpay Checkout, client side.
 *
 * Loads the Checkout script on demand rather than on every page — it is ~100KB
 * and most sessions never buy anything.
 *
 * The flow deliberately treats a dismissed modal and a failed verification
 * differently from a lost callback: if the browser dies after payment, the
 * webhook still credits the account, so the copy never claims the money is gone.
 */

'use client';

import { useCallback, useState } from 'react';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/**
 * Whether checkout can run at all.
 *
 * Next inlines `NEXT_PUBLIC_*` at build time, so this costs no request — but it
 * only works when referenced as a whole static expression, never `process.env[key]`.
 *
 * The server still enforces this (and checks the secrets the browser cannot
 * see). This exists so the UI never offers a button that is guaranteed to fail:
 * letting someone click Buy and then telling them payments are off is a worse
 * experience than saying so up front.
 */
export const paymentsEnabled = Boolean(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID);

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  prefill: { name: string; email: string };
  notes: Record<string, string>;
  theme: { color: string };
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

let scriptPromise: Promise<boolean> | null = null;

function loadCheckoutScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  // Memoised so two rapid clicks do not inject two script tags.
  scriptPromise ??= new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      scriptPromise = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export type CheckoutStatus = 'idle' | 'starting' | 'open' | 'verifying' | 'success' | 'error';

export interface CheckoutResult {
  status: CheckoutStatus;
  error: string | null;
  credited: number | null;
  balance: number | null;
  buy: (packId: string) => Promise<void>;
  reset: () => void;
}

export function useRazorpayCheckout(onSuccess?: (balance: number) => void): CheckoutResult {
  const [status, setStatus] = useState<CheckoutStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [credited, setCredited] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setCredited(null);
  }, []);

  const buy = useCallback(
    async (packId: string) => {
      if (!paymentsEnabled) {
        setStatus('error');
        setError('Payments are not switched on yet. Nothing was charged.');
        return;
      }

      setStatus('starting');
      setError(null);

      const scriptReady = await loadCheckoutScript();
      if (!scriptReady || !window.Razorpay) {
        setStatus('error');
        setError('We could not load the payment window. Check your connection and try again.');
        return;
      }

      let order;
      try {
        const res = await fetch('/api/payments/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packId }),
        });
        order = await res.json();

        if (!res.ok) {
          setStatus('error');
          setError(order.error ?? 'Could not start the payment. You have not been charged.');
          return;
        }
      } catch {
        setStatus('error');
        setError('Could not reach the server. You have not been charged.');
        return;
      }

      setStatus('open');

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'DevTrackAcademy',
        description: `${order.pack.name} · ${order.pack.credits} credits`,
        order_id: order.orderId,
        prefill: order.prefill,
        notes: { pack_id: order.pack.id },
        theme: { color: '#FF6B35' },
        modal: {
          ondismiss: () => {
            // Closing the window is not an error — say nothing alarming.
            setStatus('idle');
          },
        },
        handler: async (response) => {
          setStatus('verifying');
          try {
            const res = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            });
            const data = await res.json();

            if (!res.ok) {
              setStatus('error');
              // The webhook is still coming, so this is a delay, not a loss.
              setError(
                data.error ??
                  'Your payment went through but we could not confirm it here. Your credits will appear shortly.',
              );
              return;
            }

            setCredited(data.credited ?? order.pack.credits);
            setBalance(data.balance ?? null);
            setStatus('success');
            if (typeof data.balance === 'number') onSuccess?.(data.balance);
          } catch {
            setStatus('error');
            setError(
              'Your payment went through but we could not confirm it here. Your credits will appear shortly.',
            );
          }
        },
      });

      checkout.open();
    },
    [onSuccess],
  );

  return { status, error, credited, balance, buy, reset };
}
