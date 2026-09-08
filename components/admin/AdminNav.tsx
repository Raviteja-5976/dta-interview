'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Ticket, Users } from 'lucide-react';

const TABS = [
  { href: '/admin', label: 'Users', icon: Users },
  { href: '/admin/feedback', label: 'Feedback', icon: MessageSquare },
  { href: '/admin/coupons', label: 'Coupons', icon: Ticket },
] as const;

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold text-[#1B1F3B]">
          Admin
        </h1>
        <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-[#1B1F3B] text-white rounded-full">
          Staff only
        </span>
      </div>

      <nav className="flex flex-wrap gap-2">
        {TABS.map(({ href, label, icon: Icon }) => {
          // Exact match for /admin — startsWith would light it up on every child.
          const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-[#1B1F3B] font-[family-name:var(--font-display)] font-bold text-sm transition-all ${
                active
                  ? 'bg-[#1B1F3B] text-white shadow-[3px_3px_0_#FF6B35]'
                  : 'bg-white text-[#1B1F3B] hover:bg-[#F5EBE0] shadow-[2px_2px_0_#1B1F3B]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
