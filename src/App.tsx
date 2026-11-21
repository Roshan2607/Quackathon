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
  ExternalLink,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Terminal,
  UserCircle,
  Users,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import {
  apiFetch,
  setApiClientAuthToken,
} from './lib/apiClient';
import { startPesuOAuthSignIn } from './services/adapters';
import { isHackathonEligibleForMatching } from './services/matchingEngine';
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
  TeamProposal,
  TeamRegistration,
  TeamRegistrationStatus,
  User,
} from './types/domain';

import { DiscoverView } from './components/DiscoverView';
import { HackathonsView } from './components/HackathonsView';
import { MatchesAndChatView } from './components/MatchesAndChatView';
import { TeamsAndRequestsView } from './components/TeamsAndRequestsView';
import { OnboardingAndProfileModal } from './components/OnboardingAndProfileModal';
import { AdminReviewQueueView } from './components/AdminReviewQueueView';
import { IntegrationTestingView } from './components/IntegrationTestingView';
import { LoginPage } from './components/LoginPage';
import { QuickOnboardingView } from './components/QuickOnboardingView';
import { StudentAvatar } from './components/StudentAvatar';

type NavTab =
  | 'discover'
  | 'hackathons'
  | 'matches'
  | 'my_team'
  | 'profile'
  | 'admin'
  | 'integrations';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

const POST_AUTH_HASH_KEY = 'quackathon_post_auth_hash';

function logClientAuthTiming(
  stage: string,
  durationMs: number,
  meta?: Record<string, string | number | boolean>
): void {
  if (!import.meta.env.DEV) return;
  console.info('[quackathon-auth-timing]', {
    stage,
    durationMs: Math.round(durationMs),
    ...(meta ?? {}),
  });
}

const GUEST_USER: User = {
  uid: 'guest_unauthenticated',
  displayName: 'Guest Student',
  personaLabel: 'Sign in with PESU or Google',
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
  profiles: Record<string, Profile> | Profile[];
  hackathons: Hackathon[];
  eventCandidates: EventCandidate[];
  participations: Participation[];
  teams: Team[];
  memberships: Membership[];
  joinRequests: JoinRequest[];
  teamProposals?: TeamProposal[];
  teamRegistrations?: TeamRegistration[];
  interests: Interest[];
  conversations: Conversation[];
  messages: Message[];
  blocks?: string[];
}

export function App() {
  const getInitialTab = (): NavTab => {
    const hash = window.location.hash;
    if (hash === '#/admin') return 'admin';
    if (hash === '#/dev/integrations') return 'integrations';
    if (hash === '#/profile') return 'profile';
    if (hash === '#/hackathons' || hash === '#/events') return 'hackathons';
    if (hash === '#/matches') return 'matches';
    if (hash === '#/team' || hash === '#/my-team') return 'my_team';
    return 'discover';
  };

  const [activeTab, setActiveTab] = useState<NavTab>(getInitialTab);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('live');
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(null);
  const [selectedHackathonId, setSelectedHackathonId] = useState<string>('');
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('people');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Real Domain State (Zero Synthetic Seed Data)
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [hackathons, setHackathons] = useState<Hackathon[]>([]);
  const [eventCandidates, setEventCandidates] = useState<EventCandidate[]>([]);
  const [participations, setParticipations] = useState<Participation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [teamProposals, setTeamProposals] = useState<TeamProposal[]>([]);
  const [teamRegistrations, setTeamRegistrations] = useState<
    TeamRegistration[]
  >([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [blocks, setBlocks] = useState<BlockRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [unregisteredRedirectInfo, setUnregisteredRedirectInfo] = useState<{
    redirectUri: string;
    clientId: string;
    portalUrl: string;
  } | null>(null);
  const [copiedRedirectUri, setCopiedRedirectUri] = useState(false);
  const [canonicalAppOrigin, setCanonicalAppOrigin] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const isEmbeddedPreview = useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const pesuPopupRef = useRef<Window | null>(null);
  const pesuPopupPollRef = useRef<number | null>(null);
  const activeOAuthStateRef = useRef<string | null>(null);
  const handledOAuthStatesRef = useRef<Set<string>>(new Set());
  const fullBootstrapLoadedRef = useRef<boolean>(false);
  const appBootTimeRef = useRef<number>(
    typeof performance !== 'undefined' ? performance.now() : 0
  );
  const loggedTtiRef = useRef<boolean>(false);

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

  const restoreSavedDeepLink = useCallback(() => {
    try {
      const savedHash = sessionStorage.getItem(POST_AUTH_HASH_KEY);
      if (!savedHash) return;
      sessionStorage.removeItem(POST_AUTH_HASH_KEY);
      const allowedHashes: Record<string, NavTab> = {
        '#/discover': 'discover',
        '#/hackathons': 'hackathons',
        '#/events': 'hackathons',
        '#/matches': 'matches',
        '#/my-team': 'my_team',
        '#/team': 'my_team',
        '#/profile': 'profile',
      };
      const targetTab = allowedHashes[savedHash];
      if (targetTab) {
        setActiveTab(targetTab);
        window.history.replaceState(null, '', savedHash);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const refreshBootstrap = useCallback(
    async (scope: 'initial' | 'full' = 'full') => {
      const startMs =
        typeof performance !== 'undefined' ? performance.now() : 0;
      const endpoint =
        scope === 'initial' ? '/api/bootstrap?scope=initial' : '/api/bootstrap';
      const res = await apiFetch<BootstrapPayload>(endpoint);
      if (res.ok && res.data?.ok) {
        setUsers(res.data.users ?? []);
        const rawProfiles = res.data.profiles;
        if (Array.isArray(rawProfiles)) {
          const map: Record<string, Profile> = {};
          for (const p of rawProfiles) {
            map[p.uid] = p;
          }
          setProfiles(map);
        } else {
          setProfiles(rawProfiles ?? {});
        }
        setHackathons(res.data.hackathons ?? []);
        setParticipations(res.data.participations ?? []);
        setTeams(res.data.teams ?? []);
        setMemberships(res.data.memberships ?? []);
        setInterests(res.data.interests ?? []);

        if (scope === 'full') {
          fullBootstrapLoadedRef.current = true;
          setEventCandidates(res.data.eventCandidates ?? []);
          setJoinRequests(res.data.joinRequests ?? []);
          setTeamProposals(res.data.teamProposals ?? []);
          setTeamRegistrations(res.data.teamRegistrations ?? []);
          setConversations(res.data.conversations ?? []);
          setMessages(res.data.messages ?? []);
        }

        if (Array.isArray(res.data.blocks)) {
          setBlocks(
            res.data.blocks.map((targetUid) => ({
              id: `block_${targetUid}`,
              blockerUid: authenticatedUser?.uid ?? 'self',
              blockedUid: targetUid,
              createdAt: new Date().toISOString(),
            }))
          );
        }
        setSelectedHackathonId((prev) => {
          if (prev && res.data!.hackathons.some((h) => h.id === prev)) {
            return prev;
          }
          const firstEligible = res.data!.hackathons.find((h) =>
            isHackathonEligibleForMatching(h)
          );
          return firstEligible?.id ?? res.data!.hackathons[0]?.id ?? '';
        });

        if (typeof performance !== 'undefined') {
          const elapsed = performance.now() - startMs;
          logClientAuthTiming(`bootstrap_${scope}`, elapsed, {
            hackathons: (res.data.hackathons ?? []).length,
            users: (res.data.users ?? []).length,
          });
          if (!loggedTtiRef.current) {
            loggedTtiRef.current = true;
            logClientAuthTiming(
              'time_to_interactive',
              performance.now() - appBootTimeRef.current,
              { scope }
            );
          }
        }
      }
    },
    [authenticatedUser?.uid]
  );

  const restoreAuthSession = useCallback(async (): Promise<User | null> => {
    const startMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const res = await apiFetch<{
      ok: boolean;
      authenticated: boolean;
      user: User | null;
      profile: Profile | null;
      canonicalAppOrigin?: string;
    }>('/api/auth/session');

    if (res.ok && res.data?.canonicalAppOrigin) {
      setCanonicalAppOrigin(res.data.canonicalAppOrigin);
    }

    if (typeof performance !== 'undefined') {
      logClientAuthTiming('session_restore', performance.now() - startMs, {
        authenticated: Boolean(res.ok && res.data?.authenticated && res.data.user),
      });
    }

    if (res.ok && res.data?.authenticated && res.data.user) {
      setAuthenticatedUser(res.data.user);
      setAuthStatus('authenticated');
      setAuthError(null);
      if (res.data.profile) {
        setProfiles((prev) => ({
          ...prev,
          [res.data!.user!.uid]: res.data!.profile!,
        }));
      }
      return res.data.user;
    }

    setAuthenticatedUser(null);
    setAuthStatus('unauthenticated');
    return null;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shouldAutoRedirect = params.get('start_pesu_oauth') === 'redirect';
    const wantAnnouncementsScope = params.get('pesu_scope') === 'announcements';
    if (shouldAutoRedirect) {
      params.delete('start_pesu_oauth');
      params.delete('pesu_scope');
      const remaining = params.toString();
      const cleanUrl =
        window.location.pathname +
        (remaining ? `?${remaining}` : '') +
        window.location.hash;
      window.history.replaceState(null, '', cleanUrl);
    }

    void restoreAuthSession().then(async (restoredUser) => {
      if (restoredUser) {
        restoreSavedDeepLink();
        const needsFullImmediately =
          activeTab === 'matches' ||
          activeTab === 'my_team' ||
          activeTab === 'admin';
        void refreshBootstrap(needsFullImmediately ? 'full' : 'initial');
      }

      if (shouldAutoRedirect && (!restoredUser || wantAnnouncementsScope)) {
        const scopesToRequest = wantAnnouncementsScope
          ? ['openid', 'name', 'profile', 'email', 'announcements:read']
          : ['openid', 'name', 'profile', 'email'];
        const startRes = await startPesuOAuthSignIn(
          scopesToRequest,
          'redirect'
        );
        if (startRes.ok && startRes.authUrl) {
          if (startRes.state) {
            activeOAuthStateRef.current = startRes.state;
            try {
              sessionStorage.setItem('quackathon_oauth_state', startRes.state);
            } catch {
              // ignore storage error
            }
          }
          window.location.assign(startRes.authUrl);
        } else if (startRes.errorMessage) {
          setAuthError(startRes.errorMessage);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load conversations, team proposals, join requests, and admin queue only when needed
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    if (fullBootstrapLoadedRef.current) return;
    if (
      activeTab === 'matches' ||
      activeTab === 'my_team' ||
      activeTab === 'admin'
    ) {
      void refreshBootstrap('full');
    }
  }, [activeTab, authStatus, refreshBootstrap]);

  // Listen for PESU OAuth2 Popup Callback, Same-Origin BroadcastChannel, or Redirect Return
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
        setAuthStatus('checking');
        void restoreAuthSession().then((restoredUser) => {
          if (restoredUser) {
            restoreSavedDeepLink();
            fullBootstrapLoadedRef.current = false;
            void refreshBootstrap('initial');
            showToast(`Signed in as ${restoredUser.displayName}.`);
          }
        });
      } else {
        activeOAuthStateRef.current = null;
        try {
          sessionStorage.removeItem('quackathon_oauth_state');
        } catch {
          // ignore storage errors
        }
        setAuthError(
          queryMessage ||
            'PESU sign-in did not complete. Click Continue with PESU to start a fresh sign-in.'
        );
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
        setAuthError(null);
        const payloadUser =
          data.user && typeof data.user === 'object' ? (data.user as User) : null;
        const payloadProfile =
          data.profile && typeof data.profile === 'object'
            ? (data.profile as Profile)
            : null;

        if (payloadUser) {
          // Fast path: apply verified user & profile immediately without redundant /api/auth/session round-trip
          setAuthenticatedUser(payloadUser);
          setAuthStatus('authenticated');
          if (payloadProfile) {
            setProfiles((prev) => ({
              ...prev,
              [payloadUser.uid]: payloadProfile,
            }));
          }
          restoreSavedDeepLink();
          fullBootstrapLoadedRef.current = false;
          void refreshBootstrap('initial');
          showToast(`Signed in as ${payloadUser.displayName}.`);
        } else {
          void restoreAuthSession().then((restoredUser) => {
            if (restoredUser) {
              restoreSavedDeepLink();
              fullBootstrapLoadedRef.current = false;
              void refreshBootstrap('initial');
              showToast(`Signed in as ${restoredUser.displayName}.`);
            }
          });
        }
      } else {
        const errMsg =
          (typeof data.error === 'string' && data.error) ||
          (typeof data.userMessage === 'string' && data.userMessage) ||
          'PESU sign-in failed. Please try again.';
        setAuthError(errMsg);
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
  }, [
    clearPesuPopupMonitor,
    restoreAuthSession,
    restoreSavedDeepLink,
    refreshBootstrap,
    showToast,
  ]);

  // Sync URL hash for routes
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#/admin') setActiveTab('admin');
      else if (hash === '#/dev/integrations') setActiveTab('integrations');
      else if (hash === '#/profile') setActiveTab('profile');
      else if (hash === '#/hackathons' || hash === '#/events')
        setActiveTab('hackathons');
      else if (hash === '#/matches') setActiveTab('matches');
      else if (hash === '#/team' || hash === '#/my-team')
        setActiveTab('my_team');
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
    } else if (tab === 'my_team') {
      window.history.replaceState(null, '', '#/my-team');
    } else if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Authentication Handlers
  const handleSignInWithPesu = useCallback(
    async (
      mode: 'popup' | 'redirect' = isEmbeddedPreview ? 'popup' : 'redirect',
      requestedScopes: string[] = ['openid', 'name', 'profile', 'email']
    ) => {
      setAuthError(null);

      // Save safe deep-link hash so we restore the intended view after authentication
      try {
        if (window.location.hash && window.location.hash.startsWith('#/')) {
          sessionStorage.setItem(POST_AUTH_HASH_KEY, window.location.hash);
        }
      } catch {
        // ignore storage errors
      }

      // If full-page redirect mode is explicitly requested from inside an embedded iframe,
      // launch the canonical application URL in a top-level tab so cookies are 1st-party.
      if (mode === 'redirect' && isEmbeddedPreview) {
        const targetBase = canonicalAppOrigin || window.location.origin;
        const scopeParam = requestedScopes.includes('announcements:read')
          ? '&pesu_scope=announcements'
          : '';
        const topLevelAuthUrl = `${targetBase}/?start_pesu_oauth=redirect${scopeParam}${window.location.hash || ''}`;
        const opened = window.open(topLevelAuthUrl, '_blank', 'noopener');
        if (!opened) {
          setAuthError(
            'Your browser blocked opening a new tab. Please allow popups and try again.'
          );
        }
        return;
      }

      // Prevent duplicate login launches if a popup is already open or a request is in flight
      if (
        mode === 'popup' &&
        pesuPopupRef.current &&
        !pesuPopupRef.current.closed
      ) {
        pesuPopupRef.current.focus();
        return;
      }
      if (isSigningIn) {
        return;
      }

      setIsSigningIn(true);
      clearPesuPopupMonitor();

      const initiateStartMs =
        typeof performance !== 'undefined' ? performance.now() : 0;

      try {
        const res = await startPesuOAuthSignIn(requestedScopes, mode);
        if (typeof performance !== 'undefined') {
          logClientAuthTiming(
            'oauth_initiate',
            performance.now() - initiateStartMs,
            { mode }
          );
        }
        if (res.canonicalAppOrigin) {
          setCanonicalAppOrigin(res.canonicalAppOrigin);
        }
        if (res.providerRedirectUriRegistered === false && res.redirectUri) {
          setUnregisteredRedirectInfo({
            redirectUri: res.redirectUri,
            clientId: res.publicClientId || 'configured client',
            portalUrl:
              res.portalManageUrl || 'https://pesu-oauth2.onrender.com/portal',
          });
          setIsSigningIn(false);
          setAuthError(
            'PESU sign-in is temporarily unavailable for this preview URL. Please try again shortly.'
          );
          return;
        } else if (res.providerRedirectUriRegistered === true) {
          setUnregisteredRedirectInfo(null);
        }
        if (!res.ok || !res.authUrl) {
          setIsSigningIn(false);
          setAuthError(
            res.errorMessage || 'Could not start PESU sign-in. Please try again.'
          );
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

        if (mode === 'redirect') {
          window.location.assign(res.authUrl);
          return;
        }

        const popup = window.open(
          res.authUrl,
          'pesu_oauth_popup',
          'width=520,height=660,menubar=no,toolbar=no'
        );

        if (!popup) {
          setIsSigningIn(false);
          setAuthError(
            'Sign-in window was blocked by your browser. Please allow popups for this site and click Continue with PESU again.'
          );
          return;
        }

        pesuPopupRef.current = popup;
        const launchedState = res.state || '';

        // Monitor popup closure to distinguish user cancellation from completed callback
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
                restoreSavedDeepLink();
                fullBootstrapLoadedRef.current = false;
                await refreshBootstrap('initial');
                showToast(`Signed in as ${restored.displayName}.`);
              } else {
                setAuthError('PESU sign-in was cancelled before completion.');
              }
            }, 350);
          }
        }, 400);
      } catch {
        setIsSigningIn(false);
        setAuthError('Could not connect to PESU authentication. Please try again.');
      }
    },
    [
      canonicalAppOrigin,
      clearPesuPopupMonitor,
      isEmbeddedPreview,
      isSigningIn,
      refreshBootstrap,
      restoreAuthSession,
      restoreSavedDeepLink,
      showToast,
    ]
  );

  const handleContinueWithPesu = useCallback(() => {
    void handleSignInWithPesu(isEmbeddedPreview ? 'popup' : 'redirect');
  }, [handleSignInWithPesu, isEmbeddedPreview]);

  const handleSignOut = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    try {
      await signOut(auth);
    } catch {
      // ignore if not signed in via Firebase
    }
    setApiClientAuthToken(null);
    fullBootstrapLoadedRef.current = false;
    setAuthenticatedUser(null);
    setAuthStatus('unauthenticated');
    setAuthError(null);
    setShowAccountMenu(false);
    setUsers([]);
    setProfiles({});
    setConversations([]);
    setMessages([]);
    setJoinRequests([]);
    setTeamProposals([]);
    setInterests([]);
    setBlocks([]);
    window.history.replaceState(null, '', window.location.pathname);
    setActiveTab('discover');
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
        showToast('Sign in with PESU or Google to save your event participation.');
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
        showToast('Sign in with PESU or Google to connect with students.');
        return;
      }

      const res = await apiFetch<{
        ok: boolean;
        interest?: Interest;
        matchedConversation?: Conversation;
        createdJoinRequest?: JoinRequest;
        initialMessage?: Message;
        autoCreatedTeam?: Team;
        autoCreatedMemberships?: Membership[];
        teamRosterConversation?: Conversation;
        teamProposal?: TeamProposal;
      }>('/api/swipes', {
        method: 'POST',
        body: {
          hackathonId: card.hackathonId,
          targetType: 'user',
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

      if (res.data.autoCreatedTeam) {
        const newTeam = res.data.autoCreatedTeam;
        setTeams((prev) => [
          newTeam,
          ...prev.filter((t) => t.id !== newTeam.id),
        ]);
        if (res.data.autoCreatedMemberships) {
          setMemberships((prev) => [
            ...prev.filter(
              (m) =>
                !res.data!.autoCreatedMemberships!.some(
                  (nm) => nm.id === m.id
                )
            ),
            ...res.data!.autoCreatedMemberships!,
          ]);
        }
        if (res.data.teamRosterConversation) {
          const tc = res.data.teamRosterConversation;
          setConversations((prev) => [
            tc,
            ...prev.filter((c) => c.id !== tc.id),
          ]);
        }
      }

      if (res.data.teamProposal) {
        const tp = res.data.teamProposal;
        setTeamProposals((prev) => [
          tp,
          ...prev.filter((p) => p.id !== tp.id),
        ]);
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
        if (res.data.autoCreatedTeam) {
          showToast(
            `Mutual match with ${card.title}! A 2-person team "${res.data.autoCreatedTeam.name}" was automatically created in My Team.`
          );
        } else if (res.data.teamProposal) {
          showToast(
            `Mutual match with ${card.title}! Team proposal created — check My Team for unanimous member voting.`
          );
        } else {
          showToast(`Mutual match with ${card.title}! Open Matches to chat.`);
        }
      } else {
        showToast(`Interested in ${card.title} — added to your Shortlist.`);
      }
    },
    [authenticatedUser, showToast]
  );

  const handleSwipeBack = useCallback(
    async (targetUid: string, hackathonId: string) => {
      if (!authenticatedUser) {
        showToast('Sign in with PESU or Google to match back.');
        return;
      }
      const targetUser = users.find((u) => u.uid === targetUid);
      const targetName = targetUser?.displayName ?? 'Student';
      const res = await apiFetch<{
        ok: boolean;
        interest?: Interest;
        matchedConversation?: Conversation;
        initialMessage?: Message;
        autoCreatedTeam?: Team;
        autoCreatedMemberships?: Membership[];
        teamRosterConversation?: Conversation;
        teamProposal?: TeamProposal;
      }>('/api/swipes', {
        method: 'POST',
        body: {
          hackathonId,
          targetType: 'user',
          targetId: targetUid,
          decision: 'interested',
          proposedRole: 'Builder',
        },
      });

      if (!res.ok || !res.data?.interest) {
        showToast(res.errorMessage || 'Could not match back.');
        return;
      }

      await refreshBootstrap();
      if (res.data.autoCreatedTeam) {
        showToast(
          `Mutual match with ${targetName}! Created 2-person team "${res.data.autoCreatedTeam.name}".`
        );
      } else if (res.data.teamProposal) {
        showToast(
          `Mutual match with ${targetName}! Team candidate proposal created in My Team.`
        );
      } else {
        showToast(`Matched with ${targetName}!`);
      }
    },
    [authenticatedUser, refreshBootstrap, showToast, users]
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
    async (targetUid: string) => {
      setBlocks((prev) => [
        ...prev,
        {
          id: `${currentUser.uid}_${targetUid}`,
          blockerUid: currentUser.uid,
          blockedUid: targetUid,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (authenticatedUser) {
        await apiFetch('/api/blocks', {
          method: 'POST',
          body: { targetUid },
        });
      }
      showToast('Student hidden from your Discover feed.');
    },
    [authenticatedUser, currentUser.uid, showToast]
  );

  const handleSaveProfile = useCallback(
    async (
      updatedProfile: Profile,
      updatedPrivacy: User['privacyPreferences'],
      updatedDisplayName?: string
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
          displayName: updatedDisplayName,
          profile: updatedProfile,
          privacyPreferences: updatedPrivacy,
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
        showToast('Profile saved.');
      } else {
        showToast(res.errorMessage || 'Could not save profile.');
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
        showToast('Sign in with PESU or Google to create a team.');
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

  const handleUpdateTeamDetails = useCallback(
    async (
      teamId: string,
      updates: {
        name?: string;
        pitch?: string;
        projectIdea?: string | null;
        rolesNeeded?: string[];
        targetSize?: number;
      }
    ) => {
      if (!authenticatedUser) return;
      const res = await apiFetch<{ ok: boolean; team?: Team }>(
        `/api/teams/${encodeURIComponent(teamId)}`,
        {
          method: 'PATCH',
          body: updates,
        }
      );
      if (res.ok && res.data?.team) {
        const updatedTeam = res.data.team;
        setTeams((prev) =>
          prev.map((t) => (t.id === updatedTeam.id ? updatedTeam : t))
        );
        showToast('Team details updated.');
      } else {
        showToast(res.errorMessage || 'Could not update team details.');
      }
    },
    [authenticatedUser, showToast]
  );

  const handleVoteTeamProposal = useCallback(
    async (proposalId: string, vote: 'approve' | 'reject') => {
      if (!authenticatedUser) return;
      const res = await apiFetch<{
        ok: boolean;
        proposal?: TeamProposal;
        unanimouslyApproved?: boolean;
      }>(`/api/teams/proposals/${encodeURIComponent(proposalId)}/vote`, {
        method: 'POST',
        body: { vote },
      });
      if (res.ok && res.data?.proposal) {
        const updatedProposal = res.data.proposal;
        setTeamProposals((prev) =>
          prev.map((p) => (p.id === updatedProposal.id ? updatedProposal : p))
        );
        if (vote === 'reject') {
          showToast('Proposal rejected.');
        } else if (res.data.unanimouslyApproved) {
          showToast(
            'All team members approved! Official invitation sent to candidate.'
          );
        } else {
          showToast('Approval vote recorded.');
        }
      } else {
        showToast(res.errorMessage || 'Could not record vote.');
      }
    },
    [authenticatedUser, showToast]
  );

  const handleRespondTeamProposal = useCallback(
    async (proposalId: string, decision: 'accept' | 'decline') => {
      if (!authenticatedUser) return;
      const res = await apiFetch<{
        ok: boolean;
        proposal?: TeamProposal;
        membership?: Membership;
        team?: Team;
      }>(`/api/teams/proposals/${encodeURIComponent(proposalId)}/accept`, {
        method: 'POST',
        body: { decision },
      });
      if (res.ok) {
        await refreshBootstrap();
        if (decision === 'accept') {
          showToast(
            res.data?.team
              ? `Joined team "${res.data.team.name}"!`
              : 'Team invitation accepted!'
          );
        } else {
          showToast('Invitation declined.');
        }
      } else {
        showToast(res.errorMessage || 'Could not respond to team invitation.');
      }
    },
    [authenticatedUser, refreshBootstrap, showToast]
  );

  const handleLeaveTeam = useCallback(
    async (teamId: string) => {
      if (!authenticatedUser) return;
      const res = await apiFetch<{
        ok: boolean;
        remainingMembers?: number;
        dissolved?: boolean;
      }>(`/api/teams/${encodeURIComponent(teamId)}/leave`, {
        method: 'POST',
      });
      if (res.ok) {
        await refreshBootstrap();
        showToast(
          res.data?.dissolved
            ? 'You left the team and it was dissolved.'
            : 'You left the team. Recruitment reopened for remaining members.'
        );
      } else {
        showToast(res.errorMessage || 'Could not leave team.');
      }
    },
    [authenticatedUser, refreshBootstrap, showToast]
  );

  const handleUpdateTeamRegistration = useCallback(
    async (
      teamId: string,
      updates: {
        registrationStatus: TeamRegistrationStatus;
        externalRegistrationReference?: string | null;
        confirmationNotes?: string | null;
      }
    ) => {
      if (!authenticatedUser) return;
      const res = await apiFetch<{
        ok: boolean;
        registration?: TeamRegistration;
      }>(`/api/teams/${encodeURIComponent(teamId)}/registration`, {
        method: 'POST',
        body: updates,
      });
      if (res.ok && res.data?.registration) {
        const reg = res.data.registration;
        setTeamRegistrations((prev) => [
          reg,
          ...prev.filter((r) => r.teamId !== reg.teamId),
        ]);
        showToast('Hackathon registration status updated.');
      } else {
        showToast(
          res.errorMessage || 'Could not update hackathon registration status.'
        );
      }
    },
    [authenticatedUser, showToast]
  );

  const handleSendTeamMessage = useCallback(
    async (teamId: string, body: string) => {
      if (!authenticatedUser) {
        showToast('Sign in to send team messages.');
        return;
      }
      const res = await apiFetch<{
        ok: boolean;
        message?: Message;
        conversationId?: string;
      }>(`/api/teams/${encodeURIComponent(teamId)}/messages`, {
        method: 'POST',
        body: { body },
      });
      if (res.ok && res.data?.message) {
        const msg = res.data.message;
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== msg.id),
          msg,
        ]);
      } else {
        showToast(res.errorMessage || 'Could not send team message.');
      }
    },
    [authenticatedUser, showToast]
  );

  const handleRefreshTeamMessages = useCallback(
    async (teamId: string) => {
      if (!authenticatedUser) return;
      const res = await apiFetch<{
        ok: boolean;
        conversation?: Conversation;
        messages?: Message[];
      }>(`/api/teams/${encodeURIComponent(teamId)}/messages`);
      if (res.ok && res.data?.messages) {
        const fetchedMsgs = res.data.messages;
        setMessages((prev) => {
          const map = new Map(prev.map((m) => [m.id, m]));
          for (const m of fetchedMsgs) {
            map.set(m.id, m);
          }
          return Array.from(map.values());
        });
        if (res.data.conversation) {
          const conv = res.data.conversation;
          setConversations((prev) => [
            conv,
            ...prev.filter((c) => c.id !== conv.id),
          ]);
        }
      }
    },
    [authenticatedUser]
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
        showToast('Sign in with PESU or Google to submit a campus event.');
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

  const myActiveTeamIds = useMemo(
    () =>
      new Set(
        memberships
          .filter((m) => m.uid === currentUser.uid && m.status === 'active')
          .map((m) => m.teamId)
      ),
    [currentUser.uid, memberships]
  );

  const pendingProposalsOrInvitesCount = useMemo(
    () =>
      teamProposals.filter(
        (p) =>
          (p.status === 'pending_votes' && myActiveTeamIds.has(p.teamId)) ||
          (p.status === 'invited' && p.candidateUid === currentUser.uid)
      ).length,
    [currentUser.uid, myActiveTeamIds, teamProposals]
  );

  const myConversationsCount = conversations.filter((c) =>
    c.participantUids.includes(currentUser.uid)
  ).length;

  // Determine whether a newly authenticated student needs minimal first-time setup
  const hasExistingProfileData =
    (currentProfile.skillTags?.length ?? 0) > 0 ||
    (currentProfile.interestTags?.length ?? 0) > 0 ||
    (currentProfile.preferredRoles?.length ?? 0) > 0 ||
    Boolean(currentProfile.headline?.trim()) ||
    (currentProfile.featuredProjects?.length ?? 0) > 0;

  const needsQuickOnboarding =
    authStatus === 'authenticated' &&
    Boolean(authenticatedUser) &&
    currentUser.privacyPreferences?.onboardingCompleted !== true &&
    (!hasExistingProfileData || Boolean(currentUser.needsDisplayNameSetup));

  // Gate 1: Session Restoration Loading State (never flash a signed-out screen!)
  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src="/assets/aistudio/mini_7f313967.png"
            alt="Quackathon"
            className="w-12 h-12 rounded-xl object-contain"
          />
          <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
            <span>Loading Quackathon...</span>
          </div>
        </div>
      </div>
    );
  }

  // Gate 2: Dedicated Unauthenticated Login Page (NO application navbar)
  if (authStatus === 'unauthenticated' || !authenticatedUser) {
    return (
      <LoginPage
        onContinueWithPesu={handleContinueWithPesu}
        isSigningIn={isSigningIn}
        errorMessage={authError}
        onDismissError={() => setAuthError(null)}
      />
    );
  }

  // Gate 3: Minimal First-Time Quick Setup
  if (needsQuickOnboarding) {
    return (
      <QuickOnboardingView
        currentUser={currentUser}
        existingProfile={currentProfile}
        onComplete={async ({ displayName, profile, privacyPreferences, skipped }) => {
          await handleSaveProfile(profile, privacyPreferences, displayName);
          if (skipped) {
            showToast(
              'You can add interests and skills anytime under Profile to improve recommendations.'
            );
          }
        }}
      />
    );
  }

  const navItems: {
    id: NavTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }[] = [
    { id: 'discover', label: 'Discover', icon: <Compass className="w-[19px] h-[19px]" /> },
    { id: 'hackathons', label: 'Hackathons', icon: <Calendar className="w-[19px] h-[19px]" /> },
    {
      id: 'matches',
      label: 'Matches & Shortlist',
      icon: <MessageSquare className="w-[19px] h-[19px]" />,
      count: myConversationsCount > 0 ? myConversationsCount : undefined,
    },
    {
      id: 'my_team',
      label: 'My Team',
      icon: <Users className="w-[19px] h-[19px]" />,
      count:
        pendingProposalsOrInvitesCount > 0
          ? pendingProposalsOrInvitesCount
          : myActiveTeamIds.size > 0
            ? myActiveTeamIds.size
            : undefined,
    },
    { id: 'profile', label: 'Profile', icon: <UserCircle className="w-[19px] h-[19px]" /> },
  ];

  return (
    <div className="min-h-screen bg-[#faf8f2] text-[#1c1b1b] flex antialiased">
      {/* 256px Canary Minimal Unified Sidebar */}
      <aside className="quack-sidebar" aria-label="Primary navigation">
        <div className="quack-sidebar-top">
          <button
            type="button"
            onClick={() => navigateToTab('discover')}
            className="quack-brand cursor-pointer border-0 bg-transparent"
            aria-label="Quackathon home"
          >
            <span className="quack-brand-mark">
              <svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true" focusable="false">
                <ellipse cx="24" cy="27" rx="15.5" ry="14.5" fill="#ffdc63" />
                <path d="M13 17c2-10 18-12 22 0" fill="#ffdc63" />
                <circle cx="19" cy="25" r="1.7" fill="#25221c" />
                <circle cx="28.5" cy="25" r="1.7" fill="#25221c" />
                <path d="M19 30h10c0 5-10 5-10 0z" fill="#eba64a" />
              </svg>
            </span>
            <span className="quack-brand-name">quackathon</span>
          </button>

          <nav className="quack-side-nav" aria-label="Main pages">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToTab(item.id)}
                aria-current={activeTab === item.id ? 'page' : undefined}
                title={item.label}
                className={`quack-nav-link ${activeTab === item.id ? 'is-active' : ''}`}
              >
                {item.icon}
                <span className="quack-nav-label">{item.label}</span>
                {item.count !== undefined && (
                  <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#f1ede6] text-[#4d4634]">
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="quack-sidebar-footer" ref={accountMenuRef}>
          <button
            type="button"
            onClick={() => setShowAccountMenu((prev) => !prev)}
            aria-label={`Account menu for ${currentUser.displayName}`}
            aria-haspopup="menu"
            aria-expanded={showAccountMenu}
            className="quack-account-chip"
          >
            <span className="quack-account-avatar">
              <svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true" focusable="false">
                <ellipse cx="24" cy="27" rx="15.5" ry="14.5" fill="#ffdc63" />
                <path d="M13 17c2-10 18-12 22 0" fill="#ffdc63" />
                <circle cx="19" cy="25" r="1.7" fill="#25221c" />
                <circle cx="28.5" cy="25" r="1.7" fill="#25221c" />
                <path d="M19 30h10c0 5-10 5-10 0z" fill="#eba64a" />
              </svg>
            </span>
            <span className="quack-user-info">
              <span className="quack-user-name">{currentUser.displayName}</span>
              <span className="quack-user-sub">Student profile</span>
            </span>
            <span className="quack-account-chevron" aria-hidden="true">⌄</span>
          </button>

          {showAccountMenu && (
            <div
              role="menu"
              className="absolute bottom-16 left-0 right-0 rounded-xl bg-white border border-[#e9e5dd] shadow-xl p-2 z-50 text-xs"
            >
              {/* Current User Summary */}
              <div className="px-3 py-2 border-b border-[#f1ede6]">
                <div className="font-bold text-sm text-[#1c1b1b] truncate">
                  {currentUser.displayName}
                </div>
                <div className="text-xs text-[#746e65] truncate mt-0.5">
                  {currentUser.campus} · {currentUser.program}
                </div>
              </div>

              {/* Student Actions */}
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowAccountMenu(false);
                    setShowProfileModal(true);
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-medium text-[#27221c] hover:bg-[#fff5d6] rounded-lg cursor-pointer"
                >
                  Profile &amp; Settings
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="w-full px-3 py-2 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg flex items-center justify-between cursor-pointer"
                >
                  <span>Sign Out</span>
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Moderator & Developer Routes */}
              {isAuthorizedStaff && (
                <div className="pt-1 border-t border-[#f1ede6]">
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#746e65]">
                    Moderator Controls
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setShowAccountMenu(false);
                      navigateToTab('admin');
                    }}
                    className={`w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[#fff5d6] rounded-lg cursor-pointer ${
                      activeTab === 'admin'
                        ? 'font-semibold text-[#725c00] bg-[#fff5d6]'
                        : 'text-[#27221c]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#725c00]" />
                      Admin Event Review
                    </span>
                    <span className="font-mono text-[10px] text-[#746e65]">
                      {pendingAdminCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowAccountMenu(false);
                      navigateToTab('integrations');
                    }}
                    className={`w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[#fff5d6] rounded-lg cursor-pointer ${
                      activeTab === 'integrations'
                        ? 'font-semibold text-[#725c00] bg-[#fff5d6]'
                        : 'text-[#27221c]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-[#725c00]" />
                      Integration Diagnostics
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Page Shell */}
      <div className="quack-page-shell">
        {/* Toast Notification */}
        {toastMessage && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-4 right-4 z-50 max-w-md bg-[#24211c] text-white px-4 py-3 rounded-xl shadow-lg border border-[#e9e5dd]/30 flex items-center gap-2.5 text-xs font-medium"
          >
            <Bell className="w-4 h-4 text-[#ffd84d] shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Main Content Workspace */}
        <main className="quack-page-main">
        {unregisteredRedirectInfo && (
          <div className="mb-6 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 p-4 text-xs text-slate-800 dark:text-slate-200 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2 flex-1">
                <div className="font-bold text-sm text-amber-900 dark:text-amber-300">
                  PESU OAuth2 Redirect URI Registration Required
                </div>
                <p className="leading-relaxed text-slate-700 dark:text-slate-300">
                  The PESU OAuth2 provider rejected sign-in with{' '}
                  <span className="font-mono font-semibold">
                    &ldquo;Redirect URI is not registered for this client application.&rdquo;
                  </span>{' '}
                  for client{' '}
                  <code className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 font-mono">
                    {unregisteredRedirectInfo.clientId}
                  </code>
                  . Register the exact callback URL below in the PESU OAuth2 Developer Portal:
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <code className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 font-mono text-xs select-all break-all">
                    {unregisteredRedirectInfo.redirectUri}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        unregisteredRedirectInfo.redirectUri
                      );
                      setCopiedRedirectUri(true);
                      setTimeout(() => setCopiedRedirectUri(false), 2000);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold cursor-pointer"
                  >
                    {copiedRedirectUri ? 'Copied URI!' : 'Copy Callback URI'}
                  </button>
                  <a
                    href={unregisteredRedirectInfo.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  >
                    <span>Open PESU Developer Portal</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <p className="text-[11px] text-amber-900/90 dark:text-amber-300/90 pt-1">
                  Important: In the PESU Developer Portal, paste the URI under{' '}
                  <strong>Redirect URIs</strong>, click <strong>+ Add</strong>, and then click{' '}
                  <strong>Save Changes</strong> (clicking + Add alone does not persist the URI).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUnregisteredRedirectInfo(null)}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-semibold px-2 py-1 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
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
              onOpenMyTeam={() => navigateToTab('my_team')}
              onOpenProfile={() => navigateToTab('profile')}
            />
          )}

          {activeTab === 'hackathons' && (
            <HackathonsView
              currentUser={currentUser}
              currentProfile={currentProfile}
              executionMode={executionMode}
              hackathons={hackathons}
              privateAcademyHints={[]}
              onSelectHackathonForDiscovery={(id) => {
                setSelectedHackathonId(id);
                navigateToTab('discover');
              }}
              onSubmitEventCandidate={handleSubmitEventCandidate}
              onSaveProfile={handleSaveProfile}
              onConnectPesuAcademy={(mode) =>
                void handleSignInWithPesu(mode, [
                  'openid',
                  'name',
                  'profile',
                  'email',
                  'announcements:read',
                ])
              }
              onRefreshCatalog={refreshBootstrap}
              onNotify={showToast}
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
              interests={interests}
              selectedHackathonId={selectedHackathonId}
              onSendMessage={handleSendMessage}
              onResolveJoinRequest={handleResolveJoinRequest}
              onCreateTeam={handleCreateTeam}
              onReportTarget={handleReportTarget}
              onSwipeBack={handleSwipeBack}
              onOpenMyTeam={() => navigateToTab('my_team')}
            />
          )}

          {activeTab === 'my_team' && (
            <TeamsAndRequestsView
              currentUser={currentUser}
              hackathons={hackathons}
              selectedHackathonId={selectedHackathonId}
              onSelectHackathon={setSelectedHackathonId}
              teams={teams}
              memberships={memberships}
              joinRequests={joinRequests}
              teamProposals={teamProposals}
              teamRegistrations={teamRegistrations}
              conversations={conversations}
              messages={messages}
              users={users}
              profiles={profiles}
              onResolveJoinRequest={handleResolveJoinRequest}
              onUpdateTeamDetails={handleUpdateTeamDetails}
              onVoteTeamProposal={handleVoteTeamProposal}
              onRespondTeamProposal={handleRespondTeamProposal}
              onLeaveTeam={handleLeaveTeam}
              onUpdateTeamRegistration={handleUpdateTeamRegistration}
              onSendTeamMessage={handleSendTeamMessage}
              onRefreshTeamMessages={handleRefreshTeamMessages}
              onOpenDiscover={() => navigateToTab('discover')}
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
                onRefreshCatalog={() => refreshBootstrap('full')}
                onNotify={showToast}
                onBackToApp={() => navigateToTab('discover')}
              />
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-md mx-auto my-8 space-y-3">
                <Lock className="w-7 h-7 text-slate-400 mx-auto" />
                <h2 className="text-base font-bold">Admin Access Required</h2>
                <p className="text-xs text-slate-500">
                  Event moderation is restricted to authorized moderators.
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
            (isAuthorizedStaff ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => navigateToTab('discover')}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    ← Back to Student App
                  </button>
                </div>
                <IntegrationTestingView
                  executionMode={executionMode}
                  onChangeExecutionMode={setExecutionMode}
                />
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-md mx-auto my-8 space-y-3">
                <Lock className="w-7 h-7 text-slate-400 mx-auto" />
                <h2 className="text-base font-bold">Access Restricted</h2>
                <p className="text-xs text-slate-500">
                  This diagnostics view is restricted to authorized administrators.
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
      </div>

      {/* Builder Profile Modal (if opened from Account menu) */}
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
