/**
 * The admin shell.
 *
 * A Server Component on purpose: the role check runs before a byte of console
 * markup is generated, so a student never receives the page and then gets it
 * hidden from them. `notFound()` rather than a redirect, matching the app's
 * 404-not-403 rule (lib/api/respond.ts) — /admin should look like it does not
 * exist to anyone who is not an admin.
 *
 * This gate is not load-bearing on its own. Every /api/admin/* handler repeats
 * the check, because the data lives behind those handlers and a page guard is
 * not a guard against curl.
 */

import { notFound } from 'next/navigation';

import AppHeader from '@/components/layout/AppHeader';
import AdminNav from '@/components/admin/AdminNav';
import { isAdmin } from '@/lib/admin/guard';

export const metadata = {
  title: 'Admin · DevTrackAcademy',
};

/** Roles change in the Supabase table editor, so this page cannot be cached. */
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) notFound();

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <AppHeader />
      <main className="max-w-[1320px] mx-auto px-4 md:px-8 py-8">
        <AdminNav />
        {children}
      </main>
    </div>
  );
}
