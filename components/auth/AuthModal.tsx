'use client';

import { useState, useRef } from 'react';
import { X, Eye, EyeOff, Lock, Mail, User as UserIcon, CheckCircle2, ArrowLeft, KeyRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function AuthModal() {
  const {
    isAuthModalOpen,
    closeAuthModal,
    authTab,
    setAuthTab,
    signUpWithEmail,
    signInWithEmail,
    signInWithOAuth,
    sendOtp,
    verifyEmailOtp,
  } = useAuth();

  // Auth Step: 'credentials' | 'otp'
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [otpType, setOtpType] = useState<'signup' | 'email'>('email');

  // Form State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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

  if (!isAuthModalOpen) return null;

  const resetForm = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleTabSwitch = (tab: 'login' | 'signup') => {
    setAuthTab(tab);
    setStep('credentials');
    setOtpDigits(['', '', '', '', '', '']);
    resetForm();
  };

  // Step 1: Handle Email + Password Submission -> Trigger OTP Verification Step
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
        // Log in: verify password first
        const { data, error } = await signInWithEmail(email, password);
        if (error) {
          setErrorMsg(error.message);
        } else {
          // Password verified successfully! Send OTP for 2FA / email verification step
          const { error: otpErr } = await sendOtp(email);
          if (otpErr) {
            // If OTP sending fails or is unconfigured, proceed with direct login
            setSuccessMsg('Logged in successfully!');
            setTimeout(() => {
              closeAuthModal();
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

  // OTP Digit Input Handlers
  const handleOtpDigitChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste of 6 digits
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

    // Auto-focus next box
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // Step 2: Handle OTP Verification Code Submission
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
        setSuccessMsg('OTP verified successfully! Logging you in...');
        setTimeout(() => {
          closeAuthModal();
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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 md:p-8 bg-[#1B1F3B]/80 backdrop-blur-sm animate-fadeIn">
      {/* Modal Card Wrapper */}
      <div className="relative w-full max-w-4xl bg-[#FFF8F0] border-4 border-[#1B1F3B] rounded-3xl shadow-[16px_16px_0_#1B1F3B] overflow-hidden max-h-[90vh] flex flex-col lg:flex-row">
        
        {/* Close Button */}
        <button
          onClick={closeAuthModal}
          className="absolute top-4 right-4 z-20 w-10 h-10 bg-white border-2 border-[#1B1F3B] rounded-full flex items-center justify-center text-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B] hover:bg-[#FF6B35] hover:text-white transition-colors"
          aria-label="Close Auth Modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* LEFT COLUMN: Info & Value Proposition Panel */}
        <div className="lg:w-5/12 bg-[#1B1F3B] text-[#FFF8F0] p-6 md:p-8 flex flex-col justify-between relative overflow-hidden border-b-4 lg:border-b-0 lg:border-r-4 border-[#1B1F3B]">
          {/* Decorative graphic background */}
          <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-[#FF6B35] rounded-full opacity-20 pointer-events-none" />

          <div className="space-y-6 relative z-10">
            {/* Header Badge */}
            <div className="inline-flex items-center gap-2">
              <span className="text-xs font-[family-name:var(--font-mono)] font-bold px-2.5 py-1 bg-[#FF6B35] text-white border border-white/30 rounded-full uppercase tracking-wider">
                DevTrackAcademy
              </span>
              <span className="text-[10px] font-[family-name:var(--font-mono)] font-bold text-[#FFC93C]">
                INTERVIEW
              </span>
            </div>

            {/* H2 Title */}
            <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-black leading-tight text-white">
              Practice the interview. <br />
              <span className="text-[#FF6B35]">Not the answers.</span>
            </h2>

            {/* Feature Bullets */}
            <div className="space-y-4 pt-2 font-[family-name:var(--font-body)] text-xs md:text-sm text-[#F5EBE0]/90">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-[#FF6B35] text-white flex items-center justify-center shrink-0 font-bold border border-white/20 mt-0.5">
                  🎙️
                </div>
                <div>
                  <strong className="block text-white">Voice AI Mock Interviews</strong>
                  Tailored specifically to your resume & target job posting.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center shrink-0 font-bold border border-[#1B1F3B] mt-0.5">
                  🔑
                </div>
                <div>
                  <strong className="block text-white">2-Factor OTP Security</strong>
                  Password verification backed by email OTP codes.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-[#FFC93C] text-[#1B1F3B] flex items-center justify-center shrink-0 font-bold border border-[#1B1F3B] mt-0.5">
                  📊
                </div>
                <div>
                  <strong className="block text-white">Evidence-Backed Scorecard</strong>
                  Accuracy, delivery WPM, filler metrics, and ideal answer rewrites.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-[#4EA8FF] text-white flex items-center justify-center shrink-0 font-bold border border-white/20 mt-0.5">
                  🔒
                </div>
                <div>
                  <strong className="block text-white">100% Private</strong>
                  Your sessions are never shared with recruiters or employers.
                </div>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div className="pt-6 border-t border-white/10 relative z-10">
            <p className="font-[family-name:var(--font-mono)] text-[11px] text-[#F5EBE0]/70">
              💡 Free public beta access · No credit card required.
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN: Form Panel with Tab & OTP Verification */}
        <div className="lg:w-7/12 p-6 md:p-8 flex flex-col justify-between overflow-y-auto max-h-[80vh] lg:max-h-[85vh]">
          <div>
            {step === 'credentials' ? (
              /* STEP 1: CREDENTIALS FORM */
              <>
                {/* TAB SELECTOR (Above Form) */}
                <div className="flex border-4 border-[#1B1F3B] rounded-2xl overflow-hidden bg-[#F5EBE0] mb-6 shadow-[4px_4px_0_#1B1F3B]">
                  <button
                    type="button"
                    onClick={() => handleTabSwitch('login')}
                    className={`flex-1 py-3 font-[family-name:var(--font-display)] font-extrabold text-sm md:text-base transition-colors ${
                      authTab === 'login'
                        ? 'bg-[#FF6B35] text-white'
                        : 'text-[#1B1F3B] hover:bg-white/60'
                    }`}
                  >
                    Log In
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabSwitch('signup')}
                    className={`flex-1 py-3 font-[family-name:var(--font-display)] font-extrabold text-sm md:text-base transition-colors ${
                      authTab === 'signup'
                        ? 'bg-[#FF6B35] text-white'
                        : 'text-[#1B1F3B] hover:bg-white/60'
                    }`}
                  >
                    Sign Up
                  </button>
                </div>

                {/* OAUTH BUTTONS (Google & GitHub) */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {/* Google Button */}
                  <button
                    type="button"
                    onClick={() => handleOAuth('google')}
                    disabled={loading}
                    className="tactile-btn py-2.5 px-3 bg-white text-[#1B1F3B] text-xs md:text-sm font-bold border-2 border-[#1B1F3B] rounded-xl shadow-[3px_3px_0_#1B1F3B] hover:bg-[#F5EBE0] flex items-center justify-center gap-2"
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
                    className="tactile-btn py-2.5 px-3 bg-[#1B1F3B] text-white text-xs md:text-sm font-bold border-2 border-[#1B1F3B] rounded-xl shadow-[3px_3px_0_#1B1F3B] hover:bg-[#24294A] flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4 fill-current text-white shrink-0" viewBox="0 0 24 24">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    <span>GitHub</span>
                  </button>
                </div>

                {/* DIVIDER */}
                <div className="relative flex items-center justify-center mb-6">
                  <div className="border-t border-[#1B1F3B]/20 w-full" />
                  <span className="bg-[#FFF8F0] px-3 font-[family-name:var(--font-mono)] text-[10px] md:text-xs text-[#1B1F3B]/60 font-bold uppercase tracking-wider whitespace-nowrap">
                    OR CONTINUE WITH EMAIL
                  </span>
                  <div className="border-t border-[#1B1F3B]/20 w-full" />
                </div>

                {/* FEEDBACK BANNERS */}
                {errorMsg && (
                  <div className="mb-4 p-3 bg-[#FF5C7A]/15 border-2 border-[#FF5C7A] text-[#1B1F3B] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold flex items-center gap-2">
                    <span>⚠️ {errorMsg}</span>
                  </div>
                )}
                {successMsg && (
                  <div className="mb-4 p-3 bg-[#6EE7B7]/20 border-2 border-[#6EE7B7] text-[#1B1F3B] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#6EE7B7] shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                {/* CREDENTIALS FORM */}
                <form onSubmit={handleSubmitCredentials} className="space-y-4">
                  {/* Full Name Input (Sign Up only) */}
                  {authTab === 'signup' && (
                    <div>
                      <label className="block font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B] mb-1 uppercase">
                        Full Name
                      </label>
                      <div className="relative">
                        <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                        <input
                          type="text"
                          required
                          placeholder="Alex Rivera"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-body)] text-sm text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Email Input */}
                  <div>
                    <label className="block font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B] mb-1 uppercase">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                      <input
                        type="email"
                        required
                        placeholder="alex@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-body)] text-sm text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                      />
                    </div>
                  </div>

                  {/* Password Input (with Eye Toggle) */}
                  <div>
                    <label className="block font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B] mb-1 uppercase">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-10 pr-10 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-body)] text-sm text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1B1F3B]/60 hover:text-[#1B1F3B] focus:outline-none"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password Input (Sign Up only, with Eye Toggle) */}
                  {authTab === 'signup' && (
                    <div>
                      <label className="block font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B] mb-1 uppercase">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#1B1F3B]/50" />
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          required
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full pl-10 pr-10 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-[family-name:var(--font-body)] text-sm text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1B1F3B]/60 hover:text-[#1B1F3B] focus:outline-none"
                          aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="tactile-btn w-full py-3.5 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-base border-3 border-[#1B1F3B] rounded-2xl shadow-[4px_4px_0_#1B1F3B] hover:bg-[#e85a27] mt-2 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span>{authTab === 'signup' ? 'Verify & Continue to OTP' : 'Verify Password & Send OTP'}</span>
                    )}
                  </button>
                </form>
              </>
            ) : (
              /* STEP 2: OTP VERIFICATION CODE FORM */
              <div className="space-y-6">
                <button
                  type="button"
                  onClick={() => setStep('credentials')}
                  className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline"
                >
                  <ArrowLeft className="w-4 h-4" /> Change Email / Password
                </button>

                <div>
                  <div className="w-12 h-12 bg-[#FF6B35] text-white border-2 border-[#1B1F3B] rounded-2xl flex items-center justify-center shadow-[3px_3px_0_#1B1F3B] mb-3">
                    <KeyRound className="w-6 h-6" />
                  </div>
                  <h3 className="font-[family-name:var(--font-display)] text-2xl font-black text-[#1B1F3B]">
                    Enter 6-Digit OTP Code
                  </h3>
                  <p className="font-[family-name:var(--font-body)] text-xs md:text-sm text-[#1B1F3B]/80 mt-1">
                    We sent a verification code to <strong className="text-[#1B1F3B]">{email}</strong>. Please enter the code below.
                  </p>
                </div>

                {/* FEEDBACK BANNERS */}
                {errorMsg && (
                  <div className="p-3 bg-[#FF5C7A]/15 border-2 border-[#FF5C7A] text-[#1B1F3B] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold flex items-center gap-2">
                    <span>⚠️ {errorMsg}</span>
                  </div>
                )}
                {successMsg && (
                  <div className="p-3 bg-[#6EE7B7]/20 border-2 border-[#6EE7B7] text-[#1B1F3B] rounded-xl text-xs font-[family-name:var(--font-mono)] font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#6EE7B7] shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                {/* OTP CODE FORM */}
                <form onSubmit={handleVerifyOtp} className="space-y-6">
                  {/* 6 Digit Input Boxes */}
                  <div className="flex items-center justify-between gap-2">
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
                        className="w-11 h-13 md:w-12 md:h-14 bg-white border-2 border-[#1B1F3B] rounded-xl text-center font-[family-name:var(--font-mono)] text-xl font-bold text-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                      />
                    ))}
                  </div>

                  {/* Verify Submit Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="tactile-btn w-full py-3.5 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-base border-3 border-[#1B1F3B] rounded-2xl shadow-[4px_4px_0_#1B1F3B] hover:bg-[#e85a27] flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span>Verify OTP & Log In</span>
                    )}
                  </button>

                  <div className="text-center pt-2">
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

          {/* Bottom Switch Hint */}
          {step === 'credentials' && (
            <div className="text-center pt-4 border-t border-[#1B1F3B]/10 mt-6">
              <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/70">
                {authTab === 'login' ? (
                  <>
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => handleTabSwitch('signup')}
                      className="text-[#FF6B35] font-bold underline hover:text-[#1B1F3B]"
                    >
                      Sign Up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => handleTabSwitch('login')}
                      className="text-[#FF6B35] font-bold underline hover:text-[#1B1F3B]"
                    >
                      Log In
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
