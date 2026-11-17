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

type NavTab =
  | 'discover'
  | 'hackathons'
  | 'matches'
  | 'my_team'
  | 'profile'
  | 'admin'
  | 'integrations';

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

  const refreshBootstrap = useCallback(async () => {
    const res = await apiFetch<BootstrapPayload>('/api/bootstrap');
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
      setEventCandidates(res.data.eventCandidates ?? []);
      setParticipations(res.data.participations ?? []);
      setTeams(res.data.teams ?? []);
      setMemberships(res.data.memberships ?? []);
      setJoinRequests(res.data.joinRequests ?? []);
      setTeamProposals(res.data.teamProposals ?? []);
      setTeamRegistrations(res.data.teamRegistrations ?? []);
      setInterests(res.data.interests ?? []);
      setConversations(res.data.conversations ?? []);
      setMessages(res.data.messages ?? []);
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
        const firstMatchable = res.data!.hackathons.find((h) => h.matchable);
        return firstMatchable?.id ?? res.data!.hackathons[0]?.id ?? '';
      });
    }
  }, [authenticatedUser?.uid]);

  const restoreAuthSession = useCallback(async (): Promise<User | null> => {
    const res = await apiFetch<{
      ok: boolean;
      authenticated: boolean;
      user: User | null;
      profile: Profile | null;
    }>('/api/auth/session');

    // Also fetch canonical callback origin from /api/pesu-oauth/session
    void apiFetch<{
      ok: boolean;
      canonicalAppOrigin?: string;
    }>('/api/pesu-oauth/session').then((oauthSess) => {
      if (oauthSess.ok && oauthSess.data?.canonicalAppOrigin) {
        setCanonicalAppOrigin(oauthSess.data.canonicalAppOrigin);
      }
    });

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
      void refreshBootstrap();
      if (shouldAutoRedirect && (!restoredUser || wantAnnouncementsScope)) {
        const scopesToRequest = wantAnnouncementsScope
          ? ['openid', 'profile', 'email', 'announcements:read']
          : ['openid', 'profile', 'email'];
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
          showToast(startRes.errorMessage);
        }
      }
    });
  }, [restoreAuthSession, refreshBootstrap, showToast]);

  // Listen for PESU OAuth2 Popup Callback, Same-Origin BroadcastChannel, or Redirect Fallback
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
      mode: 'popup' | 'redirect' = 'popup',
      requestedScopes: string[] = ['openid', 'profile', 'email']
    ) => {
      // If full-page redirect mode is requested from inside an embedded iframe,
      // launch the canonical application URL in a top-level tab so cookies are 1st-party.
      if (mode === 'redirect' && isEmbeddedPreview) {
        const targetBase = canonicalAppOrigin || window.location.origin;
        const scopeParam = requestedScopes.includes('announcements:read')
          ? '&pesu_scope=announcements'
          : '';
        const topLevelAuthUrl = `${targetBase}/?start_pesu_oauth=redirect${scopeParam}${window.location.hash || ''}`;
        const opened = window.open(topLevelAuthUrl, '_blank', 'noopener');
        if (!opened) {
          showToast(
            `Please open ${targetBase} in a new browser tab to complete full-page PESU sign-in.`
          );
        } else {
          showToast(
            'Opened top-level tab for PESU OAuth2 full-page sign-in.'
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

      try {
        const res = await startPesuOAuthSignIn(requestedScopes, mode);
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
          showToast(
            'Register the callback URI in PESU OAuth2 Portal and click "Save Changes" first.'
          );
          return;
        } else if (res.providerRedirectUriRegistered === true) {
          setUnregisteredRedirectInfo(null);
        }
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
          showToast(
            'Sign-in popup was blocked by your browser. Use "Full-Page Sign In" in the account menu or allow popups.'
          );
          return;
        }

        pesuPopupRef.current = popup;
        const launchedState = res.state || '';

        // Monitor popup closure to distinguish user cancellation from completed/failed callback
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
    },
    [
      canonicalAppOrigin,
      clearPesuPopupMonitor,
      isEmbeddedPreview,
      isSigningIn,
      refreshBootstrap,
      restoreAuthSession,
      showToast,
    ]
  );

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
    await refreshBootstrap();
    showToast('Signed out.');
  }, [refreshBootstrap, showToast]);

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
      updatedPrivacy: User['privacyPreferences']
    ) => {
      if (!authenticatedUser) {
        showToast('Sign in with PESU or Google to save your profile.');
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Minimal 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => navigateToTab('discover')}
            className="flex items-center gap-2.5 text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-blue-600 text-amber-400 dark:text-white flex items-center justify-center font-bold text-sm shrink-0">
              Q
            </div>
            <span className="font-bold text-base tracking-tight text-slate-900 dark:text-slate-100">
              Quackathon
            </span>
          </button>

          {/* Zone 2: Minimal 5-Item Student Navigation (Discover | Events | Matches | My Team | Profile) */}
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 overflow-x-auto py-1"
          >
            <button
              type="button"
              onClick={() => navigateToTab('discover')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'discover'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100'
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
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Events</span>
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('matches')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'matches'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Matches</span>
              {myConversationsCount > 0 && (
                <span className="font-mono tabular-nums text-[11px] opacity-80">
                  {myConversationsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('my_team')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'my_team'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>My Team</span>
              {(myActiveTeamIds.size > 0 || pendingProposalsOrInvitesCount > 0) && (
                <span className="font-mono tabular-nums text-[11px] opacity-80">
                  {pendingProposalsOrInvitesCount > 0
                    ? pendingProposalsOrInvitesCount
                    : myActiveTeamIds.size}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('profile')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <UserCircle className="w-3.5 h-3.5" />
              <span>Profile</span>
            </button>
          </nav>

          {/* Zone 3: Real Auth & Account Menu */}
          <div className="flex items-center gap-2">
            {!authenticatedUser && (
              <div className="hidden md:flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isSigningIn}
                  onClick={() => void handleSignInWithPesu('popup')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>PESU Sign In</span>
                </button>
                <button
                  type="button"
                  disabled={isSigningIn}
                  onClick={() => void handleSignInWithPesu('redirect')}
                  title="Full-page OAuth redirect (recommended if embedded preview blocks popup cookies)"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Full-Page</span>
                </button>
                <button
                  type="button"
                  disabled={isSigningIn}
                  onClick={handleSignInWithGoogle}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <span>Google</span>
                </button>
              </div>
            )}

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
                  {/* Current User Header */}
                  <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {currentUser.displayName}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {authenticatedUser
                        ? `${currentUser.personaLabel} · ${currentUser.campus}`
                        : 'Not signed in'}
                    </div>
                  </div>

                  {/* Sign In / Sign Out Actions */}
                  <div className="py-1 border-b border-slate-100 dark:border-slate-800">
                    {!authenticatedUser ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAccountMenu(false);
                            void handleSignInWithPesu('popup');
                          }}
                          className="w-full px-3.5 py-2 text-left font-semibold text-blue-600 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                        >
                          <span>Sign in with PESU (Popup)</span>
                          <LogIn className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAccountMenu(false);
                            void handleSignInWithPesu('redirect');
                          }}
                          className="w-full px-3.5 py-2 text-left font-semibold text-blue-700 dark:text-blue-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                        >
                          <span>Sign in with PESU (Full-Page)</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        {canonicalAppOrigin && (
                          <a
                            href={canonicalAppOrigin}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setShowAccountMenu(false)}
                            className="w-full px-3.5 py-2 text-left font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between"
                          >
                            <span>Open Top-Level App URL</span>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setShowAccountMenu(false);
                            void handleSignInWithGoogle();
                          }}
                          className="w-full px-3.5 py-2 text-left font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                        >
                          <span>Sign in with Google</span>
                          <LogIn className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => navigateToTab('profile')}
                          className="w-full px-3.5 py-2 text-left font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                        >
                          <span>Edit Builder Profile</span>
                          <span className="text-[11px] text-slate-400">
                            Skills & Bio
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
                      </>
                    )}
                  </div>

                  {/* Separated Admin & Developer Routes */}
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
                onBackToApp={() => navigateToTab('discover')}
              />
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center max-w-md mx-auto my-8 space-y-3">
                <Lock className="w-7 h-7 text-slate-400 mx-auto" />
                <h2 className="text-base font-bold">Admin Access Required</h2>
                <p className="text-xs text-slate-500">
                  Route #/admin is restricted to verified event moderators. Sign in with an authorized account to review event candidates.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => navigateToTab('discover')}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium cursor-pointer"
                  >
                    Back to Discover
                  </button>
                  {!authenticatedUser && (
                    <button
                      type="button"
                      onClick={() => void handleSignInWithPesu()}
                      className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                    >
                      Sign In with PESU
                    </button>
                  )}
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
                  Route #/dev/integrations is reserved for authenticated API verification.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => navigateToTab('discover')}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium cursor-pointer"
                  >
                    Back to Discover
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignInWithPesu()}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    Sign In with PESU
                  </button>
                </div>
              </div>
            ))}
        </Suspense>
      </main>

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
