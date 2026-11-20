import React from 'react';
import { Loader2, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';

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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
      <main className="flex-1 flex items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 sm:p-10">
            {/* Quackathon Brand */}
            <div className="flex items-center gap-3 mb-8">
              <div
                className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg tracking-tight shrink-0"
                aria-hidden="true"
              >
                Q
              </div>
              <div>
                <div className="text-lg font-bold tracking-tight text-slate-900 leading-none">
                  Quackathon
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  PES University
                </div>
              </div>
            </div>

            {/* Primary Heading & One-Sentence Description */}
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 leading-tight">
              Find your next hackathon team.
            </h1>
            <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
              Match with verified PES University students across RR and EC campuses based on complementary skills, shared interests, and upcoming hackathons.
            </p>

            {/* Inline Auth Error / Cancellation Notice */}
            {errorMessage && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900"
              >
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 leading-snug">{errorMessage}</div>
                {onDismissError && (
                  <button
                    type="button"
                    onClick={onDismissError}
                    className="text-xs font-medium text-amber-800 hover:text-amber-950 underline shrink-0"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            )}

            {/* Single Primary Action */}
            <div className="mt-8">
              <button
                type="button"
                onClick={onContinueWithPesu}
                disabled={isSigningIn}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm sm:text-base font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {isSigningIn ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting to PESU...</span>
                  </>
                ) : (
                  <>
                    <span>Continue with PESU</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* University Authentication Reassurance */}
            <div className="mt-6 pt-6 border-t border-slate-100 flex items-start gap-2.5 text-xs text-slate-500 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <p>
                Sign in with your verified PES University account. Your credentials are never shared with Quackathon, and your SRN is kept private.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
