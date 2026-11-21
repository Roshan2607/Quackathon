import React from 'react';
import { Loader2, ShieldCheck, ArrowRight, AlertCircle, GraduationCap } from 'lucide-react';

interface LoginPageProps {
  onContinueWithPesu: () => void;
  isSigningIn: boolean;
  errorMessage?: string | null;
  onDismissError?: () => void;
}

export const QUACKATHON_MINI_LOGO_SRC = '/assets/aistudio/mini_7f313967.png';

export const LoginPage: React.FC<LoginPageProps> = ({
  onContinueWithPesu,
  isSigningIn,
  errorMessage,
  onDismissError,
}) => {
  return (
    <div className="min-h-screen bg-[#faf8f2] text-[#1c1b1b] flex flex-col justify-between antialiased">
      <main className="flex-1 flex items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-[460px] flex flex-col items-center">
          {/* Top Brand Logo */}
          <div className="flex flex-col items-center text-center mb-7">
            <div className="w-16 h-16 rounded-2xl bg-[#fff3c9] border border-[#f0d98c] flex items-center justify-center mb-3.5 shadow-xs p-2 transition-transform duration-150 hover:scale-[1.03]">
              <img
                src={QUACKATHON_MINI_LOGO_SRC}
                alt="Quackathon"
                className="w-full h-full object-contain"
              />
            </div>
            <h1 className="text-3xl font-bold text-[#1c1b1b] tracking-tight lowercase">
              quackathon
            </h1>
            <p className="text-sm text-[#746e65] mt-1.5">
              Find your flock. Meet PESU builders and form hackathon teams.
            </p>
          </div>

          {/* Main Sign-In Card */}
          <div className="w-full bg-white rounded-2xl shadow-xs border border-[#e9e5dd] p-6 sm:p-8 flex flex-col">
            {errorMessage && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900"
              >
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 leading-snug text-xs sm:text-sm">{errorMessage}</div>
                {onDismissError && (
                  <button
                    type="button"
                    onClick={onDismissError}
                    className="text-xs font-semibold text-amber-800 hover:text-amber-950 underline shrink-0 cursor-pointer"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onContinueWithPesu}
              disabled={isSigningIn}
              aria-label="Continue with PESU"
              className="w-full group bg-[#ffd84d] hover:bg-[#ffe06b] active:scale-[0.99] border border-[#e5be35] transition-all duration-150 py-3.5 px-4 rounded-xl flex items-center justify-between shadow-xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/90 flex items-center justify-center text-[#725c00] shadow-2xs">
                  {isSigningIn ? (
                    <Loader2 className="w-5 h-5 animate-spin text-[#725c00]" />
                  ) : (
                    <GraduationCap className="w-5 h-5 text-[#725c00]" />
                  )}
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-sm font-bold text-[#1c1b1b] leading-tight">
                    {isSigningIn ? 'Connecting to PESU...' : 'Continue with PESU'}
                  </span>
                  <span className="text-xs text-[#564500] leading-tight mt-0.5">
                    Sign in with your verified PES University account
                  </span>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[#1c1b1b] group-hover:translate-x-0.5 transition-transform duration-150" />
            </button>

            <p className="text-center text-xs text-[#746e65] mt-5">
              Your PESU credentials are entered only on the official OAuth provider.
            </p>
          </div>

          <div className="mt-6 flex items-center gap-1.5 text-xs text-[#746e65]">
            <ShieldCheck className="w-4 h-4 text-[#725c00]" />
            <span>Verified student network for PESU hackathons</span>
          </div>
        </div>
      </main>
    </div>
  );
};
