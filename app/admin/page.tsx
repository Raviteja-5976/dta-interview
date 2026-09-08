/**
 * /admin — every user, what they have spent, and what they have done.
 *
 * The table answers one question per column and nothing is derived in the
 * browser: it all arrives from `admin_user_overview` (migration 020), so sorting
 * by "interviews completed" sorts the whole table rather than the current page.
 *
 * Granting credits lives here rather than on its own screen because it is always
 * a response to a specific person in this list.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search, Zap } from 'lucide-react';

import { Button, Card, Chip, EmptyState, ErrorCard, Skeleton, StatTile } from '@/components/app/ui';
import GrantCreditsDialog from '@/components/admin/GrantCreditsDialog';

export interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'student' | 'admin';
  credits_balance: number;
  created_at: string;
  interviews_completed: number;
  interviews_started: number;
  last_interview_at: string | null;
  coding_questions: number;
  skill_questions: number;
  credits_purchased: number;
  credits_granted: number;
  credits_spent: number;
  paid_paise: number;
  feedback_count: number;
  avg_rating: number | null;
}

interface Totals {
  users: number;
  users_last_7d: number;
  interviews_completed: number;
  coding_questions: number;
  skill_questions: number;
  credits_outstanding: number;
  revenue_paise: number;
  feedback_count: number;
  avg_rating: number | null;
}

const PAGE_SIZE = 50;

/** Label, and the view column it sorts by. Kept in step with SORTABLE in the route. */
const COLUMNS = [
  { key: 'created_at', label: 'Joined' },
  { key: 'credits_balance', label: 'Credits' },
  { key: 'interviews_completed', label: 'Interviews' },
  { key: 'coding_questions', label: 'Coding' },
  { key: 'skill_questions', label: 'Skill' },
  { key: 'paid_paise', label: 'Paid' },
] as const;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [total, setTotal] = useState(0);

  const [q, setQ] = useState('');
  const [sort, setSort] = useState<string>('created_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState<AdminUserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort,
        dir,
      });
      if (q.trim()) params.set('q', q.trim());

      const res = await fetch(`/api/admin/users?${params}`);
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? 'Could not load users.');
        return;
      }

      setUsers(body.users);
      setTotals(body.totals);
      setTotal(body.total);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [q, sort, dir, offset]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const t = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const toggleSort = (key: string) => {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir('desc');
    }
    setOffset(0);
  };

  return (
    <>
      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {totals ? (
          <>
            <StatTile
              label="Users"
              value={totals.users}
              accent="orange"
              hint={`+${totals.users_last_7d} this week`}
            />
            <StatTile label="Interviews" value={totals.interviews_completed} accent="sky" hint="completed" />
            <StatTile label="Coding Qs" value={totals.coding_questions} accent="mint" hint="graded" />
            <StatTile label="Skill Qs" value={totals.skill_questions} accent="yellow" hint="graded" />
            <StatTile
              label="Credits out"
              value={totals.credits_outstanding}
              accent="coral"
              hint="unspent balances"
            />
            <StatTile
              label="Revenue"
              value={`₹${Math.round(totals.revenue_paise / 100).toLocaleString('en-IN')}`}
              accent="orange"
              hint={
                totals.avg_rating != null
                  ? `${totals.avg_rating}★ from ${totals.feedback_count}`
                  : 'no feedback yet'
              }
            />
          </>
        ) : (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
        )}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1B1F3B]/40" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            placeholder="Search by name or email…"
            className="w-full pl-11 pr-4 py-3 bg-white border-4 border-[#1B1F3B] rounded-2xl shadow-[4px_4px_0_#1B1F3B] font-[family-name:var(--font-body)] text-sm focus:outline-none focus:shadow-[6px_6px_0_#FF6B35]"
          />
        </div>
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/60 tabular-nums">
          {total} {total === 1 ? 'user' : 'users'}
        </span>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorCard
            heading="Could not load the user list"
            body={error}
            action={
              <Button variant="secondary" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
        </div>
      )}

      {loading && users.length === 0 ? (
        <Skeleton className="h-96" />
      ) : users.length === 0 ? (
        <EmptyState
          heading={q ? 'Nobody matches that search.' : 'No users yet.'}
          body={
            q
              ? 'Try part of an email address instead.'
              : 'Signups will appear here the moment the first one lands.'
          }
          action={q ? <Button variant="secondary" onClick={() => setQ('')}>Clear search</Button> : undefined}
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {/* The table scrolls inside its own box — the page never scrolls sideways. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="bg-[#1B1F3B] text-white">
                  <th className="text-left px-5 py-3 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest">
                    User
                  </th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className="text-right px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest cursor-pointer select-none hover:text-[#FFC93C]"
                    >
                      {col.label}
                      {sort === col.key && <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b-2 border-[#1B1F3B]/10 last:border-0 hover:bg-[#FFF8F0]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-[family-name:var(--font-display)] font-bold text-sm text-[#1B1F3B]">
                          {u.full_name || '—'}
                        </span>
                        {u.role === 'admin' && <Chip accent="coral">Admin</Chip>}
                      </div>
                      <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/55">
                        {u.email ?? 'no email'}
                      </span>
                    </td>

                    <Num>{new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Num>

                    <td className="px-4 py-3 text-right">
                      <span className="font-[family-name:var(--font-display)] font-extrabold tabular-nums text-[#1B1F3B]">
                        {u.credits_balance}
                      </span>
                      {u.credits_granted > 0 && (
                        <span
                          title={`${u.credits_granted} granted, ${u.credits_purchased} purchased`}
                          className="block font-[family-name:var(--font-mono)] text-[10px] text-[#1B1F3B]/45 tabular-nums"
                        >
                          {u.credits_granted} free
                        </span>
                      )}
                    </td>

                    <Num>
                      {u.interviews_completed}
                      {u.interviews_started > u.interviews_completed && (
                        <span className="text-[#1B1F3B]/40">/{u.interviews_started}</span>
                      )}
                    </Num>
                    <Num>{u.coding_questions}</Num>
                    <Num>{u.skill_questions}</Num>
                    <Num>{u.paid_paise > 0 ? `₹${Math.round(u.paid_paise / 100)}` : '—'}</Num>

                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setGranting(u)}
                        title={`Grant credits to ${u.email ?? u.full_name ?? 'this user'}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-display)] font-bold text-xs shadow-[2px_2px_0_#1B1F3B] hover:-translate-y-0.5 active:translate-y-0.5 transition-all whitespace-nowrap"
                      >
                        <Zap className="w-3.5 h-3.5 text-[#FF6B35] fill-[#FF6B35]" />
                        Grant
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-3 border-t-2 border-[#1B1F3B]/10 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
            </div>
          )}
        </Card>
      )}

      {/* Pagination — only once there is a second page to go to. */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 mt-5">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            ← Previous
          </Button>
          <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 tabular-nums">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next →
          </Button>
        </div>
      )}

      {granting && (
        <GrantCreditsDialog
          user={granting}
          onClose={() => setGranting(null)}
          onGranted={() => {
            setGranting(null);
            void load();
          }}
        />
      )}
    </>
  );
}

/** Right-aligned numeric cell. tabular-nums so the columns line up. */
function Num({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-sm font-bold tabular-nums text-[#1B1F3B]">
      {children}
    </td>
  );
}
