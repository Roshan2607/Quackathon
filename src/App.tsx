import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Bell,
  Calendar,
  ChevronDown,
  Compass,
  Lock,
  LogIn,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Terminal,
  UserCircle,
  Users,
} from 'lucide-react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from './lib/firebase';
import {
  apiFetch,
  getApiClientAuthToken,
  setApiClientAuthToken,
} from './lib/apiClient';
import { startPesuOAuthSignIn } from './services/adapters';
import {
  AuditLog,
  BlockRecord,
  CampusType,
  CandidateCard,
  Conversation,
  DiscoveryMode,
  EventCandidate,
  EventType,
  ExecutionMode,
  Hackathon,
  Interest,
  JoinRequest,
  Membership,
  Message,
  Participation,
  Profile,
  ReportRecord,
  Team,
  User,
} from './types/domain';

import { DiscoverView } from './components/DiscoverView';
import { HackathonsView } from './components/HackathonsView';
import { MatchesAndChatView } from './components/MatchesAndChatView';
import { TeamsAndRequestsView } from './components/TeamsAndRequestsView';
import { OnboardingAndProfileModal } from './components/OnboardingAndProfileModal';
import { AdminReviewQueueView } from './components/AdminReviewQueueView';
import { IntegrationTestingView } from './components/IntegrationTestingView';

type NavTab =
  | 'discover'
  | 'hackathons'
  | 'matches'
  | 'teams'
  | 'profile'
  | 'admin'
  | 'integrations';

const GUEST_USER: User = {
  uid: 'guest_unauthenticated',
  displayName: 'PES Student',
  personaLabel: 'PES University Student',
  campus: 'RR Campus',
  program: 'PES University',
  graduationYear: 2028,
  verificationStatus: 'unverified',
  pesuOidcSub: 'UNVERIFIED',
  isAdmin: false,
  createdAt: new Date().toISOString(),
  accountStatus: 'active',
  privacyPreferences: {
    profileVisible: false,
    githubConsent: false,
    aiEnrichmentConsent: false,
    academyAnnouncementsOptIn: false,
    academyTimetableOptIn: false,
  },
};

const GUEST_PROFILE: Profile = {
  uid: 'guest_unauthenticated',
  headline: 'PES University Builder',
  about: '',
  interestTags: [],
  skillTags: [],
  projectDomains: [],
  topicsToExplore: [],
  preferredRoles: ['Generalist'],
  rolesWantToLearn: [],
  workingStyleTags: [],
  hackathonGoals: [],
  portfolioLinks: [],
  featuredProjects: [],
  visibility: 'public_verified_students',
  updatedAt: new Date().toISOString(),
};

const ViewSkeleton: React.FC = () => (
  <div className="space-y-3 animate-pulse">
    <div className="h-14 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800" />
    <div className="h-64 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800" />
  </div>
);

interface BootstrapPayload {
  ok: boolean;
  users: User[];
  profiles: Record<string, Profile>;
  hackathons: Hackathon[];
  eventCandidates: EventCandidate[];
  participations: Participation[];
  teams: Team[];
  memberships: Membership[];
  joinRequests: JoinRequest[];
  interests: Interest[];
  conversations: Conversation[];
  messages: Message[];
}

const LoginPage: React.FC<{
  onSignInWithPesu: () => void;
  isSigningIn: boolean;
  toastMessage: string | null;
}> = ({ onSignInWithPesu, isSigningIn, toastMessage }) => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-12">
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 max-w-md bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg border border-slate-700 flex items-center gap-2.5 text-xs font-medium"
        >
          <Bell className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
      <div className="max-w-md w-full text-center space-y-8 bg-white dark:bg-slate-900 p-8 sm:p-10 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-100 dark:shadow-none">
        {/* Quackathon Logo */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-900 dark:bg-blue-600 text-amber-400 dark:text-white flex items-center justify-center font-black text-2xl shadow-md">
          Q
        </div>

        {/* Heading & One-Sentence Description */}
        <div className="space-y-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Find your next hackathon team.
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
            Connect with complementary builders, join open teams, and discover verified PES University hackathons.
          </p>
        </div>

        {/* Primary Action Button */}
        <div className="pt-2 space-y-4">
          <button
            type="button"
            disabled={isSigningIn}
            onClick={onSignInWithPesu}
            className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogIn className="w-4 h-4" />
            <span>{isSigningIn ? 'Connecting to PESU OAuth...' : 'Continue with PESU'}</span>
          </button>

          {/* Small University Authentication Reassurance */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>Verified PES University student access via PESU OAuth2.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export function App() {
  const getInitialTab = (): NavTab => {
    const hash = window.location.hash;
    if (hash === '#/admin') return 'admin';
    if (hash === '#/dev/integrations') return 'integrations';
    if (hash === '#/profile') return 'profile';
    if (hash === '#/teams') return 'teams';
    if (hash === '#/hackathons') return 'hackathons';
    if (hash === '#/matches') return 'matches';
    return 'discover';
  };

  const [activeTab, setActiveTab] = useState<NavTab>(getInitialTab);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('live');
  const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);
  const [hasDismissedQuickSetup, setHasDismissedQuickSetup] = useState<boolean>(false);
  const [selectedHackathonId, setSelectedHackathonId] = useState<string>('');
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('people');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Real Domain State
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [hackathons, setHackathons] = useState<Hackathon[]>([]);
  const [eventCandidates, setEventCandidates] = useState<EventCandidate[]>([]);
  const [participations, setParticipations] = useState<Participation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [blocks, setBlocks] = useState<BlockRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const pesuPopupRef = useRef<Window | null>(null);
  const pesuPopupPollRef = useRef<number | null>(null);
  const activeOAuthStateRef = useRef<string | null>(null);
  const handledOAuthStatesRef = useRef<Set<string>>(new Set());

  const clearPesuPopupMonitor = useCallback(() => {
    if (pesuPopupPollRef.current !== null) {
      window.clearInterval(pesuPopupPollRef.current);
      pesuPopupPollRef.current = null;
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4200);
  }, []);

  const currentUser = useMemo(() => {
    if (authenticatedUser) {
      return (
        users.find((u) => u.uid === authenticatedUser.uid) ?? authenticatedUser
      );
    }
    return GUEST_USER;
  }, [authenticatedUser, users]);

  const currentProfile = useMemo(() => {
    if (authenticatedUser && profiles[authenticatedUser.uid]) {
      return profiles[authenticatedUser.uid];
    }
    return GUEST_PROFILE;
  }, [authenticatedUser, profiles]);

  const isAuthorizedStaff = Boolean(currentUser.isAdmin);

  const isSparseProfile = useMemo(() => {
    return (
      authenticatedUser !== null &&
      currentProfile.skillTags.length === 0 &&
      currentProfile.interestTags.length === 0
    );
  }, [authenticatedUser, currentProfile]);

  const refreshBootstrap = useCallback(async () => {
    const res = await apiFetch<BootstrapPayload>('/api/bootstrap');
    if (res.ok && res.data?.ok) {
      setUsers(res.data.users ?? []);
      setProfiles(res.data.profiles ?? {});
      setHackathons(res.data.hackathons ?? []);
      setEventCandidates(res.data.eventCandidates ?? []);
      setParticipations(res.data.participations ?? []);
      setTeams(res.data.teams ?? []);
      setMemberships(res.data.memberships ?? []);
      setJoinRequests(res.data.joinRequests ?? []);
      setInterests(res.data.interests ?? []);
      setConversations(res.data.conversations ?? []);
      setMessages(res.data.messages ?? []);
      setSelectedHackathonId((prev) => {
        if (prev && res.data!.hackathons.some((h) => h.id === prev)) {
          return prev;
        }
        return res.data!.hackathons[0]?.id ?? '';
      });
    }
  }, []);

  const restoreAuthSession = useCallback(async (): Promise<User | null> => {
    const res = await apiFetch<{
      ok: boolean;
      authenticated: boolean;
      user: User | null;
      profile: Profile | null;
    }>('/api/auth/session');

    if (res.ok && res.data?.authenticated && res.data.user) {
      setAuthenticatedUser(res.data.user);
      if (res.data.profile) {
        setProfiles((prev) => ({
          ...prev,
          [res.data!.user!.uid]: res.data!.profile!,
        }));
      }
      return res.data.user;
    }
    return null;
  }, []);

  // Initial session restoration without unauthenticated bootstrap flash
  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const restoredUser = await restoreAuthSession();
        if (!isMounted) return;
        if (restoredUser) {
          await refreshBootstrap();
          const savedRoute = sessionStorage.getItem('quackathon_post_auth_route');
          if (savedRoute) {
            sessionStorage.removeItem('quackathon_post_auth_route');
            window.location.hash = savedRoute;
          }
        } else {
          if (
            window.location.hash &&
            window.location.hash !== '#/' &&
            window.location.hash !== '#/discover'
          ) {
            sessionStorage.setItem('quackathon_post_auth_route', window.location.hash);
          }
        }
      } finally {
        if (isMounted) {
          setIsRestoringSession(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [restoreAuthSession, refreshBootstrap]);

  // Listen for PESU OAuth2 Redirect Callback, Popup Message, or BroadcastChannel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthQuery = params.get('pesu_oauth');
    const queryState = params.get('state') || '';
    const queryMessage = params.get('message') || '';

    if (oauthQuery === 'complete' || oauthQuery === 'error') {
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', cleanUrl);
      if (queryState) {
        handledOAuthStatesRef.current.add(queryState);
      }
      setIsSigningIn(false);
      if (oauthQuery === 'complete') {
        void restoreAuthSession().then((restoredUser) => {
          void refreshBootstrap();
          if (restoredUser) {
            showToast(`Signed in with PESU as ${restoredUser.displayName}.`);
            const savedRoute = sessionStorage.getItem('quackathon_post_auth_route');
            if (savedRoute) {
              sessionStorage.removeItem('quackathon_post_auth_route');
              window.location.hash = savedRoute;
            }
          }
        });
      } else {
        showToast(queryMessage || 'PESU OAuth sign-in did not complete.');
      }
    }

    const processOAuthResult = (data: Record<string, unknown>) => {
      if (!data || data.type !== 'PESU_OAUTH_RESULT') return;

      const stateStr = typeof data.state === 'string' ? data.state : '';
      const expectedState =
        activeOAuthStateRef.current ||
        (() => {
          try {
            return sessionStorage.getItem('quackathon_oauth_state');
          } catch {
            return null;
          }
        })();

      if (expectedState && stateStr && stateStr !== expectedState) {
        return;
      }

      if (stateStr && handledOAuthStatesRef.current.has(stateStr)) {
        return;
      }
      if (stateStr) {
        handledOAuthStatesRef.current.add(stateStr);
      }

      clearPesuPopupMonitor();
      setIsSigningIn(false);
      activeOAuthStateRef.current = null;

      const isSuccess = data.status === 'success' && data.ok !== false;
      if (isSuccess) {
        if (data.user && typeof data.user === 'object') {
          setAuthenticatedUser(data.user as User);
        }
        void restoreAuthSession().then((restoredUser) => {
          void refreshBootstrap();
          const identityObj =
            data.identity && typeof data.identity === 'object'
              ? (data.identity as { name?: string })
              : null;
          const userObj =
            data.user && typeof data.user === 'object'
              ? (data.user as { displayName?: string })
              : null;
          const displayLabel =
            restoredUser?.displayName ||
            identityObj?.name ||
            userObj?.displayName ||
            'Verified Student';
          showToast(`Signed in with PESU as ${displayLabel}.`);
          const savedRoute = sessionStorage.getItem('quackathon_post_auth_route');
          if (savedRoute) {
            sessionStorage.removeItem('quackathon_post_auth_route');
            window.location.hash = savedRoute;
          }
        });
      } else {
        const errMsg =
          (typeof data.error === 'string' && data.error) ||
          (typeof data.userMessage === 'string' && data.userMessage) ||
          'PESU OAuth sign-in failed.';
        showToast(errMsg);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data && typeof event.data === 'object') {
        processOAuthResult(event.data as Record<string, unknown>);
      }
    };

    window.addEventListener('message', handleMessage);

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('quackathon_pesu_oauth');
        bc.onmessage = (ev: MessageEvent) => {
          if (ev.data && typeof ev.data === 'object') {
            processOAuthResult(ev.data as Record<string, unknown>);
          }
        };
      }
    } catch {
      // BroadcastChannel optional
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      if (bc) {
        try {
          bc.close();
        } catch {
          // ignore
        }
      }
    };
  }, [clearPesuPopupMonitor, restoreAuthSession, refreshBootstrap, showToast]);

  // Sync URL hash for routes
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#/admin') setActiveTab('admin');
      else if (hash === '#/dev/integrations') setActiveTab('integrations');
      else if (hash === '#/profile') setActiveTab('profile');
      else if (hash === '#/teams') setActiveTab('teams');
      else if (hash === '#/hackathons') setActiveTab('hackathons');
      else if (hash === '#/matches') setActiveTab('matches');
      else setActiveTab('discover');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Close Account Menu on outside click
  useEffect(() => {
    if (!showAccountMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAccountMenu]);

  const navigateToTab = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    setShowAccountMenu(false);
    if (tab === 'admin') {
      window.history.replaceState(null, '', '#/admin');
    } else if (tab === 'integrations') {
      window.history.replaceState(null, '', '#/dev/integrations');
    } else if (tab === 'teams') {
      window.history.replaceState(null, '', '#/teams');
    } else if (tab === 'hackathons') {
      window.history.replaceState(null, '', '#/hackathons');
    } else if (tab === 'matches') {
      window.history.replaceState(null, '', '#/matches');
    } else if (tab === 'profile') {
      window.history.replaceState(null, '', '#/profile');
    } else if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Authentication Handlers
  const handleSignInWithPesu = useCallback(async () => {
    if (isSigningIn) {
      return;
    }
    if (pesuPopupRef.current && !pesuPopupRef.current.closed) {
      pesuPopupRef.current.focus();
      return;
    }

    setIsSigningIn(true);
    clearPesuPopupMonitor();

    try {
      if (
        window.location.hash &&
        window.location.hash !== '#/' &&
        window.location.hash !== '#/discover'
      ) {
        sessionStorage.setItem('quackathon_post_auth_route', window.location.hash);
      }

      const res = await startPesuOAuthSignIn(['openid', 'profile', 'email']);
      if (!res.ok || !res.authUrl) {
        setIsSigningIn(false);
        showToast(res.errorMessage || 'Could not start PESU OAuth2 sign-in.');
        return;
      }

      if (res.state) {
        activeOAuthStateRef.current = res.state;
        try {
          sessionStorage.setItem('quackathon_oauth_state', res.state);
        } catch {
          // ignore storage error
        }
      }

      // Check for embedded iframe/preview environments
      const isEmbedded = window.top !== window.self;
      if (!isEmbedded) {
        // Normal direct top-level redirect
        window.location.href = res.authUrl;
        return;
      }

      // Graceful fallback for embedded previews
      const popup = window.open(
        res.authUrl,
        'pesu_oauth_popup',
        'width=520,height=660,menubar=no,toolbar=no'
      );

      if (!popup) {
        try {
          window.top?.location.assign(res.authUrl);
        } catch {
          setIsSigningIn(false);
          showToast(
            'Sign-in popup was blocked. Please allow popups or open in a full window.'
          );
        }
        return;
      }

      pesuPopupRef.current = popup;
      const launchedState = res.state || '';

      pesuPopupPollRef.current = window.setInterval(() => {
        if (!pesuPopupRef.current || pesuPopupRef.current.closed) {
          clearPesuPopupMonitor();
          pesuPopupRef.current = null;
          window.setTimeout(async () => {
            if (
              launchedState &&
              handledOAuthStatesRef.current.has(launchedState)
            ) {
              return;
            }
            const restored = await restoreAuthSession();
            setIsSigningIn(false);
            if (restored) {
              if (launchedState) {
                handledOAuthStatesRef.current.add(launchedState);
              }
              await refreshBootstrap();
              showToast(`Signed in with PESU as ${restored.displayName}.`);
            } else {
              showToast('PESU sign-in was cancelled before completion.');
            }
          }, 450);
        }
      }, 450);
    } catch {
      setIsSigningIn(false);
      showToast('Could not start PESU OAuth2 sign-in.');
    }
  }, [
    clearPesuPopupMonitor,
    isSigningIn,
    refreshBootstrap,
    restoreAuthSession,
    showToast,
  ]);

  const handleSignInWithGoogle = useCallback(async () => {
    setIsSigningIn(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setApiClientAuthToken(idToken);
      const res = await apiFetch<{
        ok: boolean;
        user?: User;
        profile?: Profile;
        error?: string;
      }>('/api/auth/firebase-sync', {
        method: 'POST',
        body: {
          displayName: cred.user.displayName,
        },
      });
      if (res.ok && res.data?.user) {
        setAuthenticatedUser(res.data.user);
        await refreshBootstrap();
        showToast(`Signed in as ${res.data.user.displayName}.`);
      } else {
        showToast(res.errorMessage || 'Could not sync Google account.');
      }
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Google sign-in popup was closed or blocked.'
      );
    } finally {
      setIsSigningIn(false);
    }
  }, [refreshBootstrap, showToast]);

  const handleSignOut = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    try {
      await signOut(auth);
    } catch {
      // ignore if not signed in via Firebase
    }
    setApiClientAuthToken(null);
    setAuthenticatedUser(null);
    setShowAccountMenu(false);
    setHasDismissedQuickSetup(false);
    showToast('Signed out.');
  }, [showToast]);

  // Real Backend Handlers
  const handleUpdateParticipation = useCallback(
    async (
      hackathonId: string,
      updates: Partial<
        Pick<
          Participation,
          'intent' | 'desiredRoles' | 'availabilityWindows' | 'discoverable'
        >
      >
    ) => {
      if (!authenticatedUser) {
        showToast('Sign in with PESU to save your event participation.');
        return;
      }
      const res = await apiFetch<{
        ok: boolean;
        participation?: Participation;
      }>(`/api/participations/${encodeURIComponent(hackathonId)}`, {
        method: 'PUT',
        body: updates,
      });

      if (res.ok && res.data?.participation) {
        const updated = res.data.participation;
        setParticipations((prev) => {
          const exists = prev.some((p) => p.id === updated.id);
          return exists
            ? prev.map((p) => (p.id === updated.id ? updated : p))
            : [...prev, updated];
        });
      } else {
        showToast(res.errorMessage || 'Could not update participation.');
      }
    },
    [authenticatedUser, showToast]
  );

  const handleSwipeDecision = useCallback(
    async (
      card: CandidateCard,
      decision: 'interested' | 'passed',
      customNote?: string
    ) => {
      if (!authenticatedUser) {
        showToast('Sign in with PESU to connect with students or teams.');
        return;
      }

      const res = await apiFetch<{
        ok: boolean;
        interest?: Interest;
        matchedConversation?: Conversation;
        createdJoinRequest?: JoinRequest;
        initialMessage?: Message;
      }>('/api/swipes', {
        method: 'POST',
        body: {
          hackathonId: card.hackathonId,
          targetType: card.type === 'person' ? 'user' : 'team',
          targetId: card.id,
          decision,
          proposedRole: card.rolesOfferedOrNeeded[0] ?? 'Builder',
          customNote,
        },
      });

      if (!res.ok || !res.data?.interest) {
        showToast(res.errorMessage || 'Could not record decision.');
        return;
      }

      const recordedInterest = res.data.interest;
      setInterests((prev) => [
        ...prev.filter((i) => i.id !== recordedInterest.id),
        recordedInterest,
      ]);

      if (decision === 'passed') return;

      if (res.data.createdJoinRequest) {
        const jr = res.data.createdJoinRequest;
        setJoinRequests((prev) => [
          jr,
          ...prev.filter((r) => r.id !== jr.id),
        ]);
        showToast(
          jr.direction === 'application'
            ? `Application sent to "${card.title}".`
            : `Team invitation sent to ${card.title}.`
        );
        return;
      }

      if (res.data.matchedConversation) {
        const conv = res.data.matchedConversation;
        setConversations((prev) => [
          conv,
          ...prev.filter((c) => c.id !== conv.id),
        ]);
        if (res.data.initialMessage) {
          setMessages((prev) => [...prev, res.data!.initialMessage!]);
        }
        showToast(`Mutual match with ${card.title}! Open Matches to chat.`);
      } else {
        showToast(`Connection sent to ${card.title}.`);
      }
    },
    [authenticatedUser, showToast]
  );

  const handleResetPassedCards = useCallback(
    async (hackathonId: string) => {
      if (!authenticatedUser) {
        showToast('Sign in first to manage your passed profiles.');
        return;
      }
      const res = await apiFetch<{ ok: boolean }>(
        `/api/swipes/passed/${encodeURIComponent(hackathonId)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setInterests((prev) =>
          prev.filter(
            (i) =>
              !(
                i.hackathonId === hackathonId &&
                i.fromUid === currentUser.uid &&
                i.decision === 'passed'
              )
          )
        );
        showToast('Restored passed profiles for this event.');
      } else {
        showToast(res.errorMessage || 'Could not reset passed profiles.');
      }
    },
    [authenticatedUser, currentUser.uid, showToast]
  );

  const handleBlockUser = useCallback(
    (targetUid: string) => {
      setBlocks((prev) => [
        ...prev,
        {
          id: `${currentUser.uid}_${targetUid}`,
          blockerUid: currentUser.uid,
          blockedUid: targetUid,
          createdAt: new Date().toISOString(),
        },
      ]);
      showToast('User hidden from your Discover feed.');
    },
    [currentUser.uid, showToast]
  );

  const handleSaveProfile = useCallback(
    async (
      updatedProfile: Profile,
      updatedPrivacy: User['privacyPreferences'],
      displayName?: string
    ) => {
      if (!authenticatedUser) {
        showToast('Sign in with PESU to save your profile.');
        return;
      }
      const res = await apiFetch<{
        ok: boolean;
        user?: User;
        profile?: Profile;
      }>('/api/profile', {
        method: 'PUT',
        body: {
          profile: updatedProfile,
          privacyPreferences: updatedPrivacy,
          displayName,
        },
      });

      if (res.ok && res.data?.profile && res.data?.user) {
        const savedUser = res.data.user;
        const savedProfile = res.data.profile;
        setAuthenticatedUser(savedUser);
        setProfiles((prev) => ({
          ...prev,
          [savedUser.uid]: savedProfile,
        }));
        setUsers((prev) => {
          const exists = prev.some((u) => u.uid === savedUser.uid);
          return exists
            ? prev.map((u) => (u.uid === savedUser.uid ? savedUser : u))
            : [...prev, savedUser];
        });
        showToast('Builder profile saved.');
      } else {
        showToast(res.errorMessage || 'Could not save builder profile.');
      }
    },
    [authenticatedUser, showToast]
  );

  const handleCreateTeam = useCallback(
    async (params: {
      hackathonId: string;
      name: string;
      pitch: string;
      projectIdea: string;
      rolesNeeded: string[];
      customSpecializations: string[];
      targetSize: number;
    }) => {
      if (!authenticatedUser) {
        showToast('Sign in with PESU to create a team.');
        return;
      }

      const res = await apiFetch<{
        ok: boolean;
        team?: Team;
        membership?: Membership;
        conversation?: Conversation;
      }>('/api/teams', {
        method: 'POST',
        body: params,
      });

      if (res.ok && res.data?.team && res.data?.membership && res.data?.conversation) {
        setTeams((prev) => [res.data!.team!, ...prev]);
        setMemberships((prev) => [...prev, res.data!.membership!]);
        setConversations((prev) => [res.data!.conversation!, ...prev]);
        showToast(`Created team "${res.data.team.name}".`);
      } else {
        showToast(res.errorMessage || 'Could not create team.');
      }
    },
    [authenticatedUser, showToast]
  );

  const handleResolveJoinRequest = useCallback(
    async (requestId: string, decision: 'accept' | 'reject') => {
      if (!authenticatedUser) return;
      const res = await apiFetch<{
        ok: boolean;
        status?: string;
        newMemberCount?: number;
        cap?: number;
        becomesFull?: boolean;
      }>(`/api/join-requests/${encodeURIComponent(requestId)}/resolve`, {
        method: 'POST',
        body: { decision },
      });

      if (!res.ok) {
        showToast(res.errorMessage || 'Could not resolve request.');
        await refreshBootstrap();
        return;
      }

      await refreshBootstrap();
      if (decision === 'reject') {
        showToast('Request declined.');
      } else {
        showToast(
          res.data?.becomesFull
            ? `Accepted member! Team is now full (${res.data.newMemberCount}/${res.data.cap}).`
            : `Accepted member (${res.data?.newMemberCount}/${res.data?.cap} slots filled).`
        );
      }
    },
    [authenticatedUser, refreshBootstrap, showToast]
  );

  const handleSubmitEventCandidate = useCallback(
    async (candidate: EventCandidate) => {
      if (!authenticatedUser) {
        showToast('Sign in with PESU to submit a campus event.');
        return;
      }
      const res = await apiFetch<{
        ok: boolean;
        candidate?: EventCandidate;
      }>('/api/hackathons/candidates', {
        method: 'POST',
        body: candidate,
      });

      if (res.ok && res.data?.candidate) {
        setEventCandidates((prev) => [res.data!.candidate!, ...prev]);
        showToast('Submitted event to Moderator Review Queue.');
      } else {
        showToast(res.errorMessage || 'Could not submit event candidate.');
      }
    },
    [authenticatedUser, showToast]
  );

  const handleApproveCandidate = useCallback(
    async (
      candidateId: string,
      overrides?: {
        minTeamSize: number | null;
        maxTeamSize: number | null;
        eventType: EventType;
        matchable: boolean;
        campus: CampusType | null;
      }
    ) => {
      const res = await apiFetch<{
        ok: boolean;
        hackathon?: Hackathon;
      }>(`/api/admin/candidates/${encodeURIComponent(candidateId)}/approve`, {
        method: 'POST',
        body: overrides ?? {},
      });

      if (res.ok && res.data?.hackathon) {
        const pub = res.data.hackathon;
        setHackathons((prev) => [pub, ...prev]);
        setEventCandidates((prev) =>
          prev.map((c) =>
            c.id === candidateId ? { ...c, reviewStatus: 'approved' } : c
          )
        );
        setSelectedHackathonId((prev) => prev || pub.id);
        setAuditLogs((prev) => [
          {
            id: `audit_${Date.now()}`,
            actorUid: currentUser.uid,
            action: 'APPROVE_EVENT_CANDIDATE',
            targetId: pub.id,
            summary: `Published "${pub.name}".`,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        showToast(`Approved and published "${pub.name}".`);
      } else {
        showToast(res.errorMessage || 'Could not approve candidate.');
      }
    },
    [currentUser.uid, showToast]
  );

  const handleRejectCandidate = useCallback(
    async (candidateId: string) => {
      const res = await apiFetch<{ ok: boolean }>(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/reject`,
        { method: 'POST' }
      );
      if (res.ok) {
        setEventCandidates((prev) =>
          prev.map((c) =>
            c.id === candidateId ? { ...c, reviewStatus: 'rejected' } : c
          )
        );
        showToast('Rejected event candidate.');
      } else {
        showToast(res.errorMessage || 'Could not reject candidate.');
      }
    },
    [showToast]
  );

  const handleMergeDuplicateCandidate = useCallback(
    async (candidateId: string) => {
      await handleRejectCandidate(candidateId);
    },
    [handleRejectCandidate]
  );

  const handleApplySourceDiffCandidate = useCallback(
    async (candidateId: string) => {
      await handleApproveCandidate(candidateId);
    },
    [handleApproveCandidate]
  );

  const handleResolveReport = useCallback(
    (
      reportId: string,
      resolution: 'resolved_dismissed' | 'resolved_actioned'
    ) => {
      setReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, status: resolution } : r))
      );
      showToast(`Report marked as ${resolution.replace('resolved_', '')}.`);
    },
    [showToast]
  );

  const handleSendMessage = useCallback(
    async (conversationId: string, body: string) => {
      if (!authenticatedUser) {
        showToast('Sign in to send messages.');
        return;
      }
      const res = await apiFetch<{
        ok: boolean;
        message?: Message;
      }>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: { body },
      });

      if (res.ok && res.data?.message) {
        const msg = res.data.message;
        setMessages((prev) => [...prev, msg]);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessageAt: msg.createdAt }
              : c
          )
        );
      } else {
        showToast(res.errorMessage || 'Could not send message.');
      }
    },
    [authenticatedUser, showToast]
  );

  const handleReportTarget = useCallback(
    (params: {
      targetType: 'user' | 'team' | 'message';
      targetId: string;
      targetLabel: string;
      reason: string;
    }) => {
      const rep: ReportRecord = {
        id: `rep_${Date.now()}`,
        reporterUid: currentUser.uid,
        ...params,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      setReports((prev) => [rep, ...prev]);
      showToast('Report submitted to moderators.');
    },
    [currentUser.uid, showToast]
  );

  // Badges
  const pendingAdminCount =
    eventCandidates.filter(
      (c) => c.reviewStatus === 'new' || c.reviewStatus === 'needs_confirmation'
    ).length + reports.filter((r) => r.status === 'open').length;

  const pendingTeamRequestsCount = joinRequests.filter((r) => {
    if (r.status !== 'pending') return false;
    const team = teams.find((t) => t.id === r.teamId);
    return (
      team?.leaderId === currentUser.uid || r.applicantUid === currentUser.uid
    );
  }).length;

  const myConversationsCount = conversations.filter((c) =>
    c.participantUids.includes(currentUser.uid)
  ).length;

  // 1. Session Restoration Loading Screen (No navbar or signed-out flash)
  if (isRestoringSession) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-blue-600 text-amber-400 dark:text-white flex items-center justify-center font-bold text-xl shadow-lg mb-4 animate-pulse">
          Q
        </div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
          Checking PESU session...
        </p>
      </div>
    );
  }

  // 2. Unauthenticated Visitor: Dedicated Login Landing Page (No application navbar)
  if (!authenticatedUser) {
    return (
      <LoginPage
        onSignInWithPesu={handleSignInWithPesu}
        isSigningIn={isSigningIn}
        toastMessage={toastMessage}
      />
    );
  }

  // 3. Authenticated Student Workspace
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Concise Authenticated Navigation Bar (No horizontal scrollbar) */}
      <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => navigateToTab('discover')}
            className="flex items-center gap-2.5 text-left cursor-pointer shrink-0"
          >
            <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-blue-600 text-amber-400 dark:text-white flex items-center justify-center font-bold text-sm shrink-0">
              Q
            </div>
            <span className="font-bold text-base tracking-tight text-slate-900 dark:text-slate-100 hidden sm:inline">
              Quackathon
            </span>
          </button>

          {/* Zone 2: Concise 5-Item Student Navigation: Discover | Hackathons | Matches | My Team | Profile */}
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 sm:gap-1.5 py-1"
          >
            <button
              type="button"
              onClick={() => navigateToTab('discover')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'discover'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Discover</span>
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('hackathons')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'hackathons'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Hackathons</span>
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('matches')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'matches'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Matches</span>
              {(myConversationsCount > 0 || pendingTeamRequestsCount > 0) && (
                <span className="font-mono tabular-nums text-[11px] opacity-80">
                  {myConversationsCount + pendingTeamRequestsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('teams')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'teams'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>My Team</span>
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('profile')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <UserCircle className="w-3.5 h-3.5" />
              <span>Profile</span>
            </button>
          </nav>

          {/* Zone 3: Authenticated Account Menu */}
          <div className="flex items-center gap-2">
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setShowAccountMenu((prev) => !prev)}
                aria-expanded={showAccountMenu}
                aria-haspopup="menu"
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserCircle className="w-4 h-4 text-slate-500" />
                <span className="hidden sm:inline">
                  {currentUser.displayName}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showAccountMenu && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg py-2 z-50 text-xs"
                >
                  {/* Current User Header with Verified Display Name */}
                  <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {currentUser.displayName}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {`${currentUser.personaLabel} · ${currentUser.campus}`}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="py-1 border-b border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => navigateToTab('profile')}
                      className="w-full px-3.5 py-2 text-left font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                    >
                      <span>Edit Builder Profile</span>
                      <span className="text-[11px] text-slate-400">
                        Skills & Role
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      className="w-full px-3.5 py-2 text-left font-semibold text-red-600 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                    >
                      <span>Sign Out</span>
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Staff / Moderator Tools only visible if authorized */}
                  {isAuthorizedStaff && (
                    <div className="pt-1">
                      <div className="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Moderator & Diagnostics
                      </div>

                      <button
                        type="button"
                        onClick={() => navigateToTab('admin')}
                        className={`w-full px-3.5 py-2 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer ${
                          activeTab === 'admin'
                            ? 'font-bold text-blue-600 bg-slate-50 dark:bg-slate-800/60'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                          Admin Event Review
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {pendingAdminCount}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => navigateToTab('integrations')}
                        className={`w-full px-3.5 py-2 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer ${
                          activeTab === 'integrations'
                            ? 'font-bold text-blue-600 bg-slate-50 dark:bg-slate-800/60'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Terminal className="w-3.5 h-3.5 text-slate-500" />
                          Integration Diagnostics
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          #/dev/integrations
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 max-w-md bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg border border-slate-700 flex items-center gap-2.5 text-xs font-medium"
        >
          <Bell className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        <Suspense fallback={<ViewSkeleton />}>
          {activeTab === 'discover' && (
            <DiscoverView
              currentUser={currentUser}
              hackathons={hackathons}
              selectedHackathonId={selectedHackathonId}
              onSelectHackathon={setSelectedHackathonId}
              discoveryMode={discoveryMode}
              onChangeDiscoveryMode={setDiscoveryMode}
              users={users}
              profiles={profiles}
              participations={participations}
              teams={teams}
              memberships={memberships}
              interests={interests}
              blocks={blocks}
              onUpdateParticipation={handleUpdateParticipation}
              onSwipeDecision={handleSwipeDecision}
              onResetPassedCards={handleResetPassedCards}
              onBlockUser={handleBlockUser}
            />
          )}

          {activeTab === 'hackathons' && (
            <HackathonsView
              currentUser={currentUser}
              executionMode={executionMode}
              hackathons={hackathons}
              privateAcademyHints={[]}
              onSelectHackathonForDiscovery={(id) => {
                setSelectedHackathonId(id);
                navigateToTab('discover');
              }}
              onSubmitEventCandidate={handleSubmitEventCandidate}
            />
          )}

          {activeTab === 'matches' && (
            <MatchesAndChatView
              currentUser={currentUser}
              conversations={conversations}
              messages={messages}
              users={users}
              profiles={profiles}
              hackathons={hackathons}
              joinRequests={joinRequests}
              teams={teams}
              memberships={memberships}
              onSendMessage={handleSendMessage}
              onResolveJoinRequest={handleResolveJoinRequest}
              onCreateTeam={handleCreateTeam}
              onReportTarget={handleReportTarget}
            />
          )}

          {activeTab === 'teams' && (
            <TeamsAndRequestsView
              currentUser={currentUser}
              hackathons={hackathons}
              teams={teams}
              memberships={memberships}
              joinRequests={joinRequests}
              users={users}
              onCreateTeam={handleCreateTeam}
              onResolveJoinRequest={handleResolveJoinRequest}
              onSimulateConcurrentLastSlotRace={() => {
                showToast('Simulated concurrent last-slot race guarded by DB transaction.');
              }}
              onSimulateDoubleTeamAttempt={() => {
                showToast('Simulated double-team attempt guarded by membership checks.');
              }}
            />
          )}

          {activeTab === 'profile' && (
            <OnboardingAndProfileModal
              currentUser={currentUser}
              profile={currentProfile}
              executionMode={executionMode}
              isInline={true}
              onSaveProfile={handleSaveProfile}
              onClose={() => navigateToTab('discover')}
              onNotify={showToast}
            />
          )}

          {activeTab === 'admin' &&
            (isAuthorizedStaff ? (
              <AdminReviewQueueView
                currentUser={currentUser}
                executionMode={executionMode}
                candidates={eventCandidates}
                hackathons={hackathons}
                reports={reports}
                auditLogs={auditLogs}
                onApproveCandidate={handleApproveCandidate}
                onRejectCandidate={handleRejectCandidate}
                onMergeDuplicateCandidate={handleMergeDuplicateCandidate}
                onApplySourceDiffCandidate={handleApplySourceDiffCandidate}
                onResolveReport={handleResolveReport}
                onBackToApp={() => navigateToTab('discover')}
              />
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center max-w-md mx-auto my-8 space-y-3">
                <Lock className="w-7 h-7 text-slate-400 mx-auto" />
                <h2 className="text-base font-bold">Admin Access Required</h2>
                <p className="text-xs text-slate-500">
                  Route #/admin is restricted to verified event moderators.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => navigateToTab('discover')}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium cursor-pointer"
                  >
                    Back to Discover
                  </button>
                </div>
              </div>
            ))}

          {activeTab === 'integrations' &&
            (isAuthorizedStaff || Boolean(getApiClientAuthToken()) ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => navigateToTab('discover')}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    ← Back to Student App
                  </button>
                  <span className="text-[11px] font-mono text-slate-400">
                    Route: #/dev/integrations
                  </span>
                </div>
                <IntegrationTestingView
                  executionMode={executionMode}
                  onChangeExecutionMode={setExecutionMode}
                />
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center max-w-md mx-auto my-8 space-y-3">
                <Lock className="w-7 h-7 text-slate-400 mx-auto" />
                <h2 className="text-base font-bold">
                  Developer Console Restricted
                </h2>
                <p className="text-xs text-slate-500">
                  Route #/dev/integrations is reserved for authorized staff verification.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => navigateToTab('discover')}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium cursor-pointer"
                  >
                    Back to Discover
                  </button>
                </div>
              </div>
            ))}
        </Suspense>
      </main>

      {/* First-time quick setup modal for sparse profiles */}
      {isSparseProfile && !hasDismissedQuickSetup && activeTab !== 'profile' && (
        <Suspense fallback={<ViewSkeleton />}>
          <OnboardingAndProfileModal
            currentUser={currentUser}
            profile={currentProfile}
            executionMode={executionMode}
            isQuickSetup={true}
            onSaveProfile={(prof, priv, name) => {
              void handleSaveProfile(prof, priv, name);
              setHasDismissedQuickSetup(true);
            }}
            onClose={() => setHasDismissedQuickSetup(true)}
            onNotify={showToast}
          />
        </Suspense>
      )}

      {/* Builder Profile Modal (if opened from Account menu directly) */}
      {showProfileModal && (
        <Suspense fallback={<ViewSkeleton />}>
          <OnboardingAndProfileModal
            currentUser={currentUser}
            profile={currentProfile}
            executionMode={executionMode}
            onSaveProfile={handleSaveProfile}
            onClose={() => setShowProfileModal(false)}
            onNotify={showToast}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
