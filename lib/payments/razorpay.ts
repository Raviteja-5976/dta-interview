/**
 * Razorpay client — order creation and signature verification.
 *
 * Deliberately no SDK. Order creation is one authenticated POST and signature
 * verification is an HMAC; a dependency here would buy nothing and would pin us
 * to a Node-only runtime.
 *
 * Server-only. `RAZORPAY_KEY_SECRET` must never reach the browser — the client
 * only ever sees `NEXT_PUBLIC_RAZORPAY_KEY_ID`, which is public by design.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.razorpay.com/v1';

export class RazorpayNotConfiguredError extends Error {
  constructor() {
    super(
      'Razorpay is not configured. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, ' +
        'RAZORPAY_WEBHOOK_SECRET and NEXT_PUBLIC_RAZORPAY_KEY_ID in .env.local.',
    );
    this.name = 'RazorpayNotConfiguredError';
  }
}

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RazorpayApiError';
  }
}

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new RazorpayNotConfiguredError();
  return { keyId, keySecret };
}

/**
 * Every variable the purchase flow needs, in the order you set them up.
 *
 * The webhook secret is in this list even though order creation does not use it,
 * and that is deliberate: without it the webhook route cannot verify anything, so
 * the browser callback becomes the only path that grants credits. A user who
 * closes the tab the instant payment succeeds would then pay and get nothing —
 * exactly the failure the webhook exists to prevent. Better to refuse the sale
 * than to take money we cannot reliably credit.
 */
const REQUIRED_ENV = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'NEXT_PUBLIC_RAZORPAY_KEY_ID',
] as const;

/** Which required variables are absent. Names only — never values. */
export function missingRazorpayConfig(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

export function isRazorpayConfigured(): boolean {
  return missingRazorpayConfig().length === 0;
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface CreateOrderInput {
  /** In PAISE. Razorpay rejects fractional currency units. */
  amountPaise: number;
  /** Our own reference. Max 40 chars — Razorpay truncates silently otherwise. */
  receipt: string;
  notes?: Record<string, string>;
}

export async function createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
  const { keyId, keySecret } = credentials();

  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt.slice(0, 40),
      // Capture automatically. Without this a payment sits `authorized` and
      // silently auto-refunds after a few days.
      payment_capture: 1,
      notes: input.notes ?? {},
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new RazorpayApiError(
      `Razorpay order creation failed (${res.status}): ${body.slice(0, 300)}`,
      res.status,
    );
  }

  return (await res.json()) as RazorpayOrder;
}

// ── Signature verification ───────────────────────────────────────────────────

/**
 * Verifies the signature Checkout hands back to the browser.
 *
 * Signed payload is `order_id|payment_id`, keyed with the API secret. This is
 * what proves the browser is not just POSTing us a made-up payment id.
 */
export function verifyCheckoutSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = credentials();
  const expected = createHmac('sha256', keySecret)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest('hex');

  return safeEqual(expected, args.signature);
}

/**
 * Verifies a webhook.
 *
 * The signed message is the RAW request body — parsing and re-serialising it
 * first changes the bytes and the signature will never match. Note this uses the
 * WEBHOOK secret, which is a different value from the API key secret.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new RazorpayNotConfiguredError();

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

/** Constant-time compare, so a wrong signature cannot be brute-forced by timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── Webhook payload ──────────────────────────────────────────────────────────

export interface RazorpayWebhookEvent {
  event: string;
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id: string;
        status: string;
        amount: number;
        error_description?: string;
      };
    };
  };
}

/** The events worth acting on. Everything else is acknowledged and ignored. */
export const HANDLED_EVENTS = ['payment.captured', 'payment.failed'] as const;
