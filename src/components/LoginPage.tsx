import React from 'react';
import { Loader2, ShieldCheck, ArrowRight, AlertCircle, GraduationCap } from 'lucide-react';

interface LoginPageProps {
  onContinueWithPesu: () => void;
  isSigningIn: boolean;
  errorMessage?: string | null;
  onDismissError?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onContinueWithPesu,
  isSigningIn,
  errorMessage,
  onDismissError,
}) => {
  return (
    <div className="min-h-screen bg-[#faf8f2] text-[#1c1b1b] flex flex-col justify-between antialiased">
      <main className="flex-1 flex items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-[480px] flex flex-col items-center">
          {/* Top Mascot & Logo */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative w-16 h-16 rounded-full bg-[#ffd84d]/40 flex items-center justify-center mb-3 shadow-sm transition-transform duration-300 hover:scale-105">
              <svg
                className="w-10 h-10 text-[#875200]"
                fill="currentColor"
                viewBox="0 0 36 36"
                aria-hidden="true"
              >
                {/* Duck Silhouette / Friendly geometric duck mascot */}
                <path d="M14.5 7.5C14.5 4.462 16.962 2 20 2C23.038 2 25.5 4.462 25.5 7.5C25.5 8.12 25.4 8.715 25.215 9.27C27.525 9.49 29.5 10.45 30.8 11.25C31.5 11.68 31.2 12.8 30.3 12.9L25.3 13.4C24.45 15.02 22.8 16.2 20.8 16.48C20.65 17.65 21.3 18.7 22.4 19.1C25.8 20.3 29.5 22.1 30.8 25.6C31.4 27.2 30.6 29 29 29.8C26.5 31 21.2 31.5 16 30.5C10.5 29.5 6.5 26.2 6.5 21.5C6.5 17.5 9.5 14.5 13.5 13.8V12.5C11.5 11.5 10.2 9.4 10.2 7C10.2 6.7 10.25 6.4 10.3 6.1C11.4 6.7 12.8 7.1 14.3 7.1C14.4 7.23 14.5 7.36 14.5 7.5Z" />
                <circle cx="21" cy="7" fill="#1c1b1b" r="1.5" />
              </svg>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#fdaa40] opacity-60"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#ffd84d]"></span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 justify-center">
              <h1 className="text-3xl font-bold text-[#1c1b1b] tracking-tight lowercase">
                quackathon
              </h1>
            </div>
            <p className="text-sm text-[#746e65] mt-1">
              Find your flock. Meet PES students and build together.
            </p>
          </div>

          {/* Main Card */}
          <div className="w-full bg-white rounded-2xl shadow-sm border border-[#e9e5dd] p-6 sm:p-8 flex flex-col">
            {/* Inline Auth Error Notice */}
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

            {/* SSO Federated Sign-In Options */}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={onContinueWithPesu}
                disabled={isSigningIn}
                aria-label="Continue with PESU"
                className="w-full group relative overflow-hidden bg-[#f6f3f2] hover:bg-[#f0eded] border border-[#e9e5dd] transition-all duration-200 py-3.5 px-4 rounded-xl flex items-center justify-between shadow-xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center text-[#725c00] shadow-xs">
                    {isSigningIn ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#725c00]" />
                    ) : (
                      <GraduationCap className="w-5 h-5 text-[#725c00]" />
                    )}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-sm font-medium text-[#1c1b1b] leading-tight">
                      {isSigningIn ? 'Connecting to PESU...' : 'Continue with PESU'}
                    </span>
                    <span className="text-xs text-[#746e65] leading-tight mt-0.5">
                      Secure sign-in through PESU OAuth2
                    </span>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-[#746e65] group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>

            <p className="text-center text-xs text-[#746e65] mt-5">
              Your PESU credentials are entered only with the OAuth provider.
            </p>
          </div>

          {/* Community Reassurance Banner */}
          <div className="mt-6 flex flex-col items-center gap-2 text-center max-w-sm px-2">
            <div className="flex items-center gap-1.5 text-xs text-[#746e65]">
              <ShieldCheck className="w-4 h-4 text-[#725c00]" />
              <span>Verified student network for collegiate hackathons</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
