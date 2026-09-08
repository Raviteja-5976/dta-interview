/**
 * /auth/reset-password — set a new password.
 *
 * Only reachable with a live recovery session, which /auth/confirm establishes
 * from the link in the email. Arriving without one is the normal failure (links
 * expire in an hour by default), so that case gets a real explanation and a way
 * back rather than a redirect to a login screen that would leave someone
 * wondering whether the reset worked.
 *
 * No "current password" field: possession of the recovery link IS the proof, and
 * asking for a password the person has just told us they forgot would be absurd.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase/client';

type Phase = 'checking' | 'ready' | 'no-session' | 'saving' | 'done';

const MIN_PASSWORD = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const { updatePassword } = useAuth();

  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // getUser(), not getSession() — only getUser revalidates against the auth
      // server, and a cookie is not proof on its own.
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setPhase(data.user ? 'ready' : 'no-session');
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Those two passwords do not match.');
      return;
    }

    setPhase('saving');

    const { error: updateError } = await updatePassword(password);

    if (updateError) {
      // Supabase rejects a password identical to the current one, among others.
      setError(updateError.message || 'That did not save. Try again.');
      setPhase('ready');
      return;
    }

    setPhase('done');
    // Long enough to read the confirmation, short enough not to feel stuck.
    setTimeout(() => router.push('/dashboard'), 1600);
  };

  return (
    <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center p-4 bg-[radial-gradient(#1B1F3B_1px,transparent_1px)] [background-size:24px_24px]">
      <div className="w-full max-w-md">
        <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl shadow-[8px_8px_0_#1B1F3B] p-6 sm:p-8">
          {phase === 'checking' && (
            <div className="flex items-center justify-center py-10">
              <div className="w-8 h-8 border-4 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {phase === 'no-session' && (
            <>
              <div className="w-11 h-11 bg-[#FF5C7A] text-white border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center shadow-[3px_3px_0_#1B1F3B] mb-4">
                <Lock className="w-5 h-5" />
              </div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-black text-[#1B1F3B]">
                This reset link has expired
              </h1>
              <p className="text-sm text-[#1B1F3B]/75 mt-2 leading-relaxed">
                Reset links are good for one hour and one use. Nothing has changed on your account —
                your old password still works.
              </p>
              <Link
                href="/auth?tab=forgot"
                className="tactile-btn mt-6 w-full py-3 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-sm uppercase tracking-wider border-2 border-[#1B1F3B] rounded-xl shadow-[4px_4px_0_#1B1F3B] hover:bg-[#e85a27] flex items-center justify-center"
              >
                Send me a new link
              </Link>
            </>
          )}

          {phase === 'done' && (
            <>
              <div className="w-11 h-11 bg-[#6EE7B7] text-[#1B1F3B] border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center shadow-[3px_3px_0_#1B1F3B] mb-4">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-black text-[#1B1F3B]">
                Password changed
              </h1>
              <p className="text-sm text-[#1B1F3B]/75 mt-2">
                You are signed in. Taking you to your dashboard…
              </p>
            </>
          )}

          {(phase === 'ready' || phase === 'saving') && (
            <>
              <div className="w-11 h-11 bg-[#FF6B35] text-white border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center shadow-[3px_3px_0_#1B1F3B] mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-black text-[#1B1F3B]">
                Choose a new password
              </h1>
              <p className="text-sm text-[#1B1F3B]/75 mt-1.5 mb-6">
                At least {MIN_PASSWORD} characters. You will stay signed in afterwards.
              </p>

              {error && (
                <div className="mb-4 p-2.5 bg-[#FF5C7A]/15 border-2 border-[#FF5C7A] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B]">
                  ⚠️ {error}
                </div>
              )}

              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="block font-[family-name:var(--font-mono)] text-[10px] font-bold text-[#1B1F3B] mb-1 uppercase tracking-wider">
                    New password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                    <input
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl text-xs text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                    />
                    <button
                      type="button"
                      onClick={() => setShow(!show)}
                      aria-label={show ? 'Hide password' : 'Show password'}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/60 hover:text-[#1B1F3B]"
                    >
                      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-[family-name:var(--font-mono)] text-[10px] font-bold text-[#1B1F3B] mb-1 uppercase tracking-wider">
                    Confirm new password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                    <input
                      type={show ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl text-xs text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={phase === 'saving'}
                  className="tactile-btn w-full py-3 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-sm uppercase tracking-wider border-2 border-[#1B1F3B] rounded-xl shadow-[4px_4px_0_#1B1F3B] hover:bg-[#e85a27] flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {phase === 'saving' ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Save new password</span>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
