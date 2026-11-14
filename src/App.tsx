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

// Lazy-loaded route views to reduce initial bundle parse & execution latency
const DiscoverView = React.lazy(() =>
  import('./components/DiscoverView').then((m) => ({ default: m.DiscoverView }))
);
const HackathonsView = React.lazy(() =>
  import('./components/HackathonsView').then((m) => ({
    default: m.HackathonsView,
  }))
);
const MatchesAndChatView = React.lazy(() =>
  import('./components/MatchesAndChatView').then((m) => ({
    default: m.MatchesAndChatView,
  }))
);
const OnboardingAndProfileModal = React.lazy(() =>
  import('./components/OnboardingAndProfileModal').then((m) => ({
    default: m.OnboardingAndProfileModal,
  }))
);
const AdminReviewQueueView = React.lazy(() =>
  import('./components/AdminReviewQueueView').then((m) => ({
    default: m.AdminReviewQueueView,
  }))
);
const IntegrationTestingView = React.lazy(() =>
  import('./components/IntegrationTestingView').then((m) => ({
    default: m.IntegrationTestingView,
  }))
);

type NavTab =
  | 'discover'
  | 'hackathons'
  | 'matches'
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

export function App() {
  const getInitialTab = (): NavTab => {
    const hash = window.location.hash;
    if (hash === '#/admin') return 'admin';
    if (hash === '#/dev/integrations') return 'integrations';
    if (hash === '#/profile') return 'profile';
    if (hash === '#/hackathons') return 'hackathons';
    if (hash === '#/matches') return 'matches';
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
  const [interests, setInterests] = useState<Interest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [blocks, setBlocks] = useState<BlockRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

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

  const restoreAuthSession = useCallback(async () => {
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
    }
  }, []);

  useEffect(() => {
    void restoreAuthSession().then(() => refreshBootstrap());
  }, [restoreAuthSession, refreshBootstrap]);

  // Listen for PESU OAuth2 Popup Callback
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'PESU_OAUTH_RESULT') return;

      if (data.status === 'success') {
        if (data.sessionToken) {
          setApiClientAuthToken(String(data.sessionToken));
        }
        if (data.user) {
          setAuthenticatedUser(data.user as User);
        }
        void restoreAuthSession().then(() => refreshBootstrap());
        showToast(
          `Signed in with PESU as ${data.profile?.name || data.user?.displayName || 'Verified Student'}.`
        );
      } else {
        showToast(data.error || 'PESU OAuth sign-in did not complete.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [restoreAuthSession, refreshBootstrap, showToast]);

  // Sync URL hash for routes
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#/admin') setActiveTab('admin');
      else if (hash === '#/dev/integrations') setActiveTab('integrations');
      else if (hash === '#/profile') setActiveTab('profile');
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
    } else if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Authentication Handlers
  const handleSignInWithPesu = useCallback(async () => {
    setIsSigningIn(true);
    try {
      const res = await startPesuOAuthSignIn(['openid', 'profile', 'email']);
      if (!res.ok || !res.authUrl) {
        showToast(res.errorMessage || 'Could not start PESU OAuth2 sign-in.');
        return;
      }
      window.open(
        res.authUrl,
        'pesu_oauth_popup',
        'width=520,height=660,menubar=no,toolbar=no'
      );
    } finally {
      setIsSigningIn(false);
    }
  }, [showToast]);

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
        showToast('Sign in with PESU or Google to connect with students or teams.');
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

          {/* Zone 2: Minimal 4-Item Student Navigation (Discover | Hackathons | Matches | Profile) */}
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
              <span>Hackathons</span>
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
              {(myConversationsCount > 0 || pendingTeamRequestsCount > 0) && (
                <span className="font-mono tabular-nums text-[11px] opacity-80">
                  {myConversationsCount + pendingTeamRequestsCount}
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
                  onClick={handleSignInWithPesu}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>PESU Sign In</span>
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
                            void handleSignInWithPesu();
                          }}
                          className="w-full px-3.5 py-2 text-left font-semibold text-blue-600 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer"
                        >
                          <span>Sign in with PESU OAuth</span>
                          <LogIn className="w-3.5 h-3.5" />
                        </button>
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
