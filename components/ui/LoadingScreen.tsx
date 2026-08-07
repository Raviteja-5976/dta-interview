'use client';

import { useEffect, useState } from 'react';

export default function LoadingScreen() {
  const [show, setShow] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Skip if visited in session or reduced motion
    const visited = sessionStorage.getItem('dta_interview_visited');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (visited || reducedMotion) {
      return;
    }

    setShow(true);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setHiding(true);
            setTimeout(() => {
              setShow(false);
              sessionStorage.setItem('dta_interview_visited', 'true');
            }, 550);
          }, 150);
          return 100;
        }
        return prev + 15;
      });
    }, 40);

    return () => clearInterval(interval);
  }, []);

  if (!show) return null;

  return (
    <div
      className={`fixed inset-0 z-[10000] bg-[#1B1F3B] text-[#FFF8F0] flex flex-col items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.65,0,0.35,1)] ${
        hiding ? '-translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="text-center px-4">
        <div className="font-[family-name:var(--font-display)] text-3xl md:text-5xl font-extrabold tracking-tight mb-2 flex items-center justify-center gap-3">
          <span>DevTrackAcademy</span>
          <span className="text-xs font-[family-name:var(--font-mono)] font-bold px-2.5 py-1 bg-[#FF6B35] text-white border-2 border-white rounded-full">
            INTERVIEW
          </span>
        </div>
        <p className="font-[family-name:var(--font-mono)] text-xs text-[#F5EBE0]/70 uppercase tracking-widest mb-8">
          Voice AI Mock Interview Platform
        </p>

        {/* Progress Bar */}
        <div className="w-64 max-w-full h-1.5 bg-[#24294A] border border-white/20 rounded-full overflow-hidden mx-auto">
          <div
            className="h-full bg-[#FF6B35] transition-all duration-150 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
