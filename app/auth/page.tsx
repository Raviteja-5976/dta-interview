'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, EyeOff, Lock, Mail, User as UserIcon, CheckCircle2, ArrowLeft, KeyRound, Code2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

function AuthPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, signUpWithEmail, signInWithEmail, signInWithOAuth, sendOtp, verifyEmailOtp } = useAuth();

  // Tab State: 'login' | 'signup'
  const initialTab = searchParams.get('tab') === 'signup' ? 'signup' : 'login';
  const [authTab, setAuthTab] = useState<'login' | 'signup'>(initialTab);

  // Auth Step: 'credentials' | 'otp'
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [otpType, setOtpType] = useState<'signup' | 'email'>('email');

  // Form State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // 6-digit OTP Input State
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Password Visibility Toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Redirect if logged in
  useEffect(() => {
    if (user) {
      router.push('/dashboard');
    }
  }, [user, router]);

  // Sync tab with query params
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'signup' || tabParam === 'login') {
      setAuthTab(tabParam);
    }
  }, [searchParams]);

  const resetForm = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleTabSwitch = (tab: 'login' | 'signup') => {
    setAuthTab(tab);
    setStep('credentials');
    setOtpDigits(['', '', '', '', '', '']);
    resetForm();
    router.replace(`/auth?tab=${tab}`, { scroll: false });
  };

  // Step 1: Submit Credentials
  const handleSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    resetForm();

    if (!email || !password) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }

    if (authTab === 'signup') {
      if (!fullName) {
        setErrorMsg('Please enter your full name.');
        return;
      }
      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match.');
        return;
      }
    }

    setLoading(true);

    try {
      if (authTab === 'signup') {
        const { data, error } = await signUpWithEmail(fullName, email, password);
        if (error) {
          setErrorMsg(error.message);
        } else {
          setOtpType('signup');
          setStep('otp');
          setSuccessMsg(`Password verified! We sent a 6-digit OTP code to ${email}`);
        }
      } else {
        const { data, error } = await signInWithEmail(email, password);
        if (error) {
          setErrorMsg(error.message);
        } else {
          const { error: otpErr } = await sendOtp(email);
          if (otpErr) {
            setSuccessMsg('Logged in successfully!');
            setTimeout(() => {
              router.push('/dashboard');
            }, 800);
          } else {
            setOtpType('email');
            setStep('otp');
            setSuccessMsg(`Password verified! A 6-digit OTP code has been sent to ${email}`);
          }
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // OTP Handlers
  const handleOtpDigitChange = (index: number, value: string) => {
    if (value.length > 1) {
      const pastedDigits = value.slice(0, 6).split('');
      const newDigits = [...otpDigits];
      pastedDigits.forEach((digit, i) => {
        if (i < 6) newDigits[i] = digit;
      });
      setOtpDigits(newDigits);
      otpInputRefs.current[Math.min(pastedDigits.length - 1, 5)]?.focus();
      return;
    }

    const newDigits = [...otpDigits];
    newDigits[index] = value;
    setOtpDigits(newDigits);

    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetForm();

    const fullCode = otpDigits.join('');
    if (fullCode.length < 6) {
      setErrorMsg('Please enter all 6 digits of the OTP code.');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await verifyEmailOtp(email, fullCode, otpType);
      if (error) {
        setErrorMsg(error.message || 'Invalid or expired OTP code. Please try again.');
      } else {
        setSuccessMsg('OTP verified successfully! Redirecting...');
        setTimeout(() => {
          router.push('/dashboard');
        }, 1000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    resetForm();
    setLoading(true);
    try {
      const { error } = await sendOtp(email);
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccessMsg(`New OTP code sent to ${email}`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to resend OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    resetForm();
    setLoading(true);
    try {
      const { error } = await signInWithOAuth(provider);
      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'OAuth sign-in failed.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen lg:h-screen w-full grid grid-cols-1 lg:grid-cols-12 bg-[#FFF8F0] font-[family-name:var(--font-body)] overflow-x-hidden lg:overflow-hidden">
      
      {/* LEFT COLUMN: Deep Navy Branding Panel */}
      <div className="lg:col-span-5 bg-[#1B1F3B] text-[#FFF8F0] p-6 md:p-10 lg:p-12 flex flex-col justify-between relative overflow-hidden h-auto lg:h-full">
        
        {/* Floating Decorative Elements */}
        <div className="absolute top-12 right-8 w-16 h-16 rounded-2xl border-2 border-white/20 bg-white/5 flex items-center justify-center text-white/40 pointer-events-none">
          <Code2 className="w-8 h-8" />
        </div>
        <div className="absolute bottom-24 right-12 w-24 h-10 rounded-xl border border-white/10 bg-white/5 pointer-events-none hidden lg:block" />

        {/* Top Button */}
        <div className="relative z-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#FFC93C]/40 bg-white/5 text-[#FFC93C] font-[family-name:var(--font-mono)] text-xs font-bold uppercase tracking-wider hover:bg-white/10 transition-colors"
          >
            ← BACK TO HOMEPAGE
          </Link>
        </div>

        {/* Huge Headline */}
        <div className="relative z-10 my-auto py-6 space-y-2">
          <h1 className="font-[family-name:var(--font-display)] text-5xl sm:text-6xl lg:text-7xl font-black text-white leading-[0.95] tracking-tight">
            Practice<span className="text-[#FF6B35]">.</span><br />
            Prepare<span className="text-[#FF6B35]">.</span><br />
            Perform<span className="text-[#FF6B35]">.</span><br />
            Repeat<span className="text-[#FF6B35]">.</span>
          </h1>

          <p className="font-[family-name:var(--font-body)] text-xs sm:text-sm text-[#F5EBE0]/80 max-w-md leading-relaxed pt-4 font-medium">
            Join DevTrackAcademy Interview and take part in realistic AI voice mock interviews. Practice your resume trade-offs live before real calls.
          </p>
        </div>

        {/* Footer info inside Left Column */}
        <div className="relative z-10 border-t border-white/10 pt-4">
          <div className="font-[family-name:var(--font-mono)] text-xs text-[#F5EBE0]/60 font-bold">
            DevTrackAcademy.Interview
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Grid Background & Centered Form Card */}
      <div className="lg:col-span-7 bg-[#FFF8F0] p-4 sm:p-6 md:p-8 lg:p-10 flex flex-col justify-center items-center h-auto lg:h-full overflow-y-auto lg:overflow-hidden relative bg-[radial-gradient(#1B1F3B_1px,transparent_1px)] [background-size:24px_24px] [background-position:0_0]">
        
        <div className="w-full max-w-lg my-auto space-y-4 relative z-10">
          
          {/* Top Welcome Title Above Card */}
          <div className="text-center space-y-1">
            <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-black text-[#1B1F3B] tracking-tight">
              Welcome to the Interview
            </h2>
            <p className="font-[family-name:var(--font-body)] text-xs sm:text-sm font-medium text-[#1B1F3B]/70">
              Sign in to manage your mock interviews and diagnostic reports.
            </p>
          </div>

          {/* Neo-Brutalist Form Card */}
          <div className="bg-white border-3 border-[#1B1F3B] rounded-3xl shadow-[8px_8px_0_#1B1F3B] p-6 sm:p-8 space-y-5">
            
            {step === 'credentials' ? (
              /* STEP 1: CREDENTIALS FORM */
              <>
                {/* TAB SELECTOR */}
                <div className="flex border-2 border-[#1B1F3B] rounded-2xl overflow-hidden bg-white p-1">
                  <button
                    type="button"
                    onClick={() => handleTabSwitch('login')}
                    className={`flex-1 py-2 rounded-xl font-[family-name:var(--font-display)] font-extrabold text-sm transition-all ${
                      authTab === 'login'
                        ? 'bg-[#FFC93C] text-[#1B1F3B] border-2 border-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]'
                        : 'text-[#1B1F3B] hover:bg-[#F5EBE0]'
                    }`}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabSwitch('signup')}
                    className={`flex-1 py-2 rounded-xl font-[family-name:var(--font-display)] font-extrabold text-sm transition-all ${
                      authTab === 'signup'
                        ? 'bg-[#FFC93C] text-[#1B1F3B] border-2 border-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]'
                        : 'text-[#1B1F3B] hover:bg-[#F5EBE0]'
                    }`}
                  >
                    Sign Up
                  </button>
                </div>

                {/* FEEDBACK BANNERS */}
                {errorMsg && (
                  <div className="p-2.5 bg-[#FF5C7A]/15 border-2 border-[#FF5C7A] text-[#1B1F3B] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold flex items-center gap-2">
                    <span>⚠️ {errorMsg}</span>
                  </div>
                )}
                {successMsg && (
                  <div className="p-2.5 bg-[#6EE7B7]/20 border-2 border-[#6EE7B7] text-[#1B1F3B] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#6EE7B7] shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                {/* CREDENTIALS FORM */}
                <form onSubmit={handleSubmitCredentials} className="space-y-3.5">
                  {/* Full Name Input (Sign Up only) */}
                  {authTab === 'signup' && (
                    <div>
                      <label className="block font-[family-name:var(--font-mono)] text-[10px] font-bold text-[#1B1F3B] mb-1 uppercase tracking-wider">
                        FULL NAME
                      </label>
                      <div className="relative">
                        <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                        <input
                          type="text"
                          required
                          placeholder="coder@dta.com"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-body)] text-xs text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Email Input */}
                  <div>
                    <label className="block font-[family-name:var(--font-mono)] text-[10px] font-bold text-[#1B1F3B] mb-1 uppercase tracking-wider">
                      EMAIL ADDRESS
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                      <input
                        type="email"
                        required
                        placeholder="coder@dta.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-body)] text-xs text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                      />
                    </div>
                  </div>

                  {/* Password Input */}
                  <div>
                    <label className="block font-[family-name:var(--font-mono)] text-[10px] font-bold text-[#1B1F3B] mb-1 uppercase tracking-wider">
                      PASSWORD
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-10 pr-10 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-body)] text-xs text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/60 hover:text-[#1B1F3B] focus:outline-none"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password Input (Sign Up only) */}
                  {authTab === 'signup' && (
                    <div>
                      <label className="block font-[family-name:var(--font-mono)] text-[10px] font-bold text-[#1B1F3B] mb-1 uppercase tracking-wider">
                        CONFIRM PASSWORD
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          required
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full pl-10 pr-10 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-body)] text-xs text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#1B1F3B]/60 hover:text-[#1B1F3B] focus:outline-none"
                          aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Remember Me & Forgot Password Row */}
                  <div className="flex items-center justify-between text-xs pt-1">
                    <label className="flex items-center gap-2 cursor-pointer font-[family-name:var(--font-body)] text-[#1B1F3B]">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded border-2 border-[#1B1F3B] text-[#FF6B35] focus:ring-[#FF6B35]"
                      />
                      <span>Remember Me</span>
                    </label>

                    <a href="#forgot" className="font-bold text-[#FF6B35] hover:underline">
                      Forgot Password?
                    </a>
                  </div>

                  {/* Orange Submit Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="tactile-btn w-full py-3 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-sm uppercase tracking-wider border-2 border-[#1B1F3B] rounded-xl shadow-[4px_4px_0_#1B1F3B] hover:bg-[#e85a27] flex items-center justify-center gap-2 mt-2"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span>{authTab === 'signup' ? 'SIGN UP' : 'LOGIN'}</span>
                    )}
                  </button>
                </form>

                {/* DIVIDER */}
                <div className="relative flex items-center justify-center pt-2">
                  <div className="border-t-2 border-[#1B1F3B]/20 w-full" />
                  <span className="bg-white border-2 border-[#1B1F3B] rounded-full px-3 py-0.5 font-[family-name:var(--font-mono)] text-[9px] text-[#1B1F3B] font-extrabold uppercase tracking-wider whitespace-nowrap shadow-[1px_1px_0_#1B1F3B]">
                    OR CONTINUE WITH
                  </span>
                  <div className="border-t-2 border-[#1B1F3B]/20 w-full" />
                </div>

                {/* OAUTH BUTTONS (Google & GitHub at Bottom of Card) */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Google Button */}
                  <button
                    type="button"
                    onClick={() => handleOAuth('google')}
                    disabled={loading}
                    className="tactile-btn py-2.5 px-3 bg-white text-[#1B1F3B] text-xs font-bold border-2 border-[#1B1F3B] rounded-xl shadow-[3px_3px_0_#1B1F3B] hover:bg-[#F5EBE0] flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                    <span>Google</span>
                  </button>

                  {/* GitHub Button */}
                  <button
                    type="button"
                    onClick={() => handleOAuth('github')}
                    disabled={loading}
                    className="tactile-btn py-2.5 px-3 bg-[#1B1F3B] text-white text-xs font-bold border-2 border-[#1B1F3B] rounded-xl shadow-[3px_3px_0_#1B1F3B] hover:bg-[#24294A] flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4 fill-current text-white shrink-0" viewBox="0 0 24 24">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    <span>GitHub</span>
                  </button>
                </div>
              </>
            ) : (
              /* STEP 2: OTP VERIFICATION CODE FORM */
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setStep('credentials')}
                  className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Change Email / Password
                </button>

                <div>
                  <div className="w-10 h-10 bg-[#FF6B35] text-white border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center shadow-[3px_3px_0_#1B1F3B] mb-2">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <h3 className="font-[family-name:var(--font-display)] text-xl font-black text-[#1B1F3B]">
                    Enter 6-Digit OTP Code
                  </h3>
                  <p className="font-[family-name:var(--font-body)] text-xs text-[#1B1F3B]/80 mt-0.5">
                    We sent a code to <strong className="text-[#1B1F3B]">{email}</strong>.
                  </p>
                </div>

                {/* FEEDBACK BANNERS */}
                {errorMsg && (
                  <div className="p-2.5 bg-[#FF5C7A]/15 border-2 border-[#FF5C7A] text-[#1B1F3B] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold flex items-center gap-2">
                    <span>⚠️ {errorMsg}</span>
                  </div>
                )}
                {successMsg && (
                  <div className="p-2.5 bg-[#6EE7B7]/20 border-2 border-[#6EE7B7] text-[#1B1F3B] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#6EE7B7] shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                {/* OTP CODE FORM */}
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  {/* 6 Digit Input Boxes */}
                  <div className="flex items-center justify-between gap-1.5">
                    {otpDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          otpInputRefs.current[idx] = el;
                        }}
                        type="text"
                        maxLength={6}
                        value={digit}
                        onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                        className="w-10 h-12 md:w-11 md:h-12 bg-white border-2 border-[#1B1F3B] rounded-xl text-center font-[family-name:var(--font-mono)] text-lg font-bold text-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                      />
                    ))}
                  </div>

                  {/* Verify Submit Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="tactile-btn w-full py-3 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-sm border-2 border-[#1B1F3B] rounded-xl shadow-[4px_4px_0_#1B1F3B] hover:bg-[#e85a27] flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span>VERIFY OTP & LOG IN</span>
                    )}
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={loading}
                      className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/70 underline hover:text-[#FF6B35]"
                    >
                      Didn't receive the code? Resend OTP
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center p-4">
        <div className="w-8 h-8 border-4 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <AuthPageContent />
    </Suspense>
  );
}
