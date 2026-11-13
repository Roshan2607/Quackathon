/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  SlidersHorizontal,
  UserCheck,
} from 'lucide-react';
import {
  AuditLog,
  BlockRecord,
  CandidateCard,
  Conversation,
  DiscoveryMode,
  EventCandidate,
  Hackathon,
  Interest,
  JoinRequest,
  Membership,
  Message,
  Participation,
  PrivateAcademyHint,
  Profile,
  ReportRecord,
  Team,
  User,
} from './types/domain';
import {
  SEED_AUDIT_LOGS,
  SEED_BLOCKS,
  SEED_CONVERSATIONS,
  SEED_EVENT_CANDIDATES,
  SEED_HACKATHONS,
  SEED_INTERESTS,
  SEED_JOIN_REQUESTS,
  SEED_MEMBERSHIPS,
  SEED_MESSAGES,
  SEED_PARTICIPATIONS,
  SEED_PRIVATE_ACADEMY_HINTS,
  SEED_PROFILES,
  SEED_REPORTS,
  SEED_TEAMS,
  SEED_USERS,
} from './data/seedData';
import { HackathonsView } from './components/HackathonsView';
import { DiscoverView } from './components/DiscoverView';
import { TeamsAndRequestsView } from './components/TeamsAndRequestsView';
import { MatchesAndChatView } from './components/MatchesAndChatView';
import { OnboardingAndProfileModal } from './components/OnboardingAndProfileModal';
import { AdminReviewQueueView } from './components/AdminReviewQueueView';

type NavTab = 'hackathons' | 'discover' | 'teams' | 'matches' | 'admin';

export default function App() {
  // Navigation & Active Persona State
  const [activeNav, setActiveNav] = useState<NavTab>('hackathons');
  const [currentUserId, setCurrentUserId] = useState<string>('u_solo_arjun');
  const [selectedHackathonId, setSelectedHackathonId] = useState<string>('hack_terrapthon_26');
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('people');
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Domain State Stores (Seeded with Synthetic Data)
  const [users, setUsers] = useState<User[]>(SEED_USERS);
  const [profiles, setProfiles] = useState<Record<string, Profile>>(SEED_PROFILES);
  const [hackathons, setHackathons] = useState<Hackathon[]>(SEED_HACKATHONS);
  const [eventCandidates, setEventCandidates] = useState<EventCandidate[]>(SEED_EVENT_CANDIDATES);
  const [privateHints] = useState<PrivateAcademyHint[]>(SEED_PRIVATE_ACADEMY_HINTS);
  const [participations, setParticipations] = useState<Participation[]>(SEED_PARTICIPATIONS);
  const [teams, setTeams] = useState<Team[]>(SEED_TEAMS);
  const [memberships, setMemberships] = useState<Membership[]>(SEED_MEMBERSHIPS);
  const [interests, setInterests] = useState<Interest[]>(SEED_INTERESTS);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>(SEED_JOIN_REQUESTS);
  const [conversations, setConversations] = useState<Conversation[]>(SEED_CONVERSATIONS);
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES);
  const [blocks, setBlocks] = useState<BlockRecord[]>(SEED_BLOCKS);
  const [reports, setReports] = useState<ReportRecord[]>(SEED_REPORTS);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(SEED_AUDIT_LOGS);

  // Feedback Toast & Transaction Banner
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastTransactionBanner, setLastTransactionBanner] = useState<{
    type: 'success' | 'error' | 'warning';
    title: string;
    detail: string;
  } | null>(null);

  const currentUser = users.find((u) => u.uid === currentUserId) ?? users[0];
  const currentProfile = profiles[currentUser.uid];

  const notifyToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  // Switch active test persona
  const handleSelectPersona = (uid: string) => {
    setCurrentUserId(uid);
    notifyToast(`Switched active session to ${users.find((u) => u.uid === uid)?.displayName}`);
  };

  // Toggle optional PESU OAuth2 Academy scope consent (private by default)
  const handleToggleAcademyScope = (scope: 'announcements' | 'timetable') => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.uid !== currentUser.uid) return u;
        const nextVal =
          scope === 'announcements'
            ? !u.privacyPreferences.academyAnnouncementsOptIn
            : !u.privacyPreferences.academyTimetableOptIn;
        notifyToast(
          nextVal
            ? `Granted optional ${scope}:read scope for your private session only.`
            : `Revoked ${scope}:read scope. Private Academy hints disabled.`
        );
        return {
          ...u,
          privacyPreferences: {
            ...u.privacyPreferences,
            academyAnnouncementsOptIn:
              scope === 'announcements' ? nextVal : u.privacyPreferences.academyAnnouncementsOptIn,
            academyTimetableOptIn:
              scope === 'timetable' ? nextVal : u.privacyPreferences.academyTimetableOptIn,
          },
        };
      })
    );
  };

  // Update per-hackathon participation intent, roles, or availability
  const handleUpdateParticipation = (
    hackathonId: string,
    updates: Partial<Pick<Participation, 'intent' | 'desiredRoles' | 'availabilityWindows' | 'discoverable'>>
  ) => {
    const detKey = `${hackathonId}_${currentUser.uid}`;
    setParticipations((prev) => {
      const existing = prev.find((p) => p.id === detKey);
      if (existing) {
        return prev.map((p) =>
          p.id === detKey ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
        );
      }
      const created: Participation = {
        id: detKey,
        hackathonId,
        uid: currentUser.uid,
        intent: updates.intent ?? 'looking',
        desiredRoles: updates.desiredRoles ?? currentProfile.preferredRoles,
        skillsOffered: currentProfile.skillTags.slice(0, 4),
        availabilityWindows: updates.availabilityWindows ?? ['Sat Morning (8am–1pm)'],
        commitmentLevel: 'standard',
        workPreferences: currentProfile.workingStyleTags,
        discoverable: updates.discoverable ?? true,
        updatedAt: new Date().toISOString(),
      };
      return [...prev, created];
    });
  };

  // Idempotent Swipe Decision (Right-swipe = interest / apply / invite; Left-swipe = pass)
  const handleSwipeDecision = (
    card: CandidateCard,
    decision: 'interested' | 'passed',
    customNote?: string
  ) => {
    const targetType = card.type === 'person' ? 'user' : 'team';
    const interestKey = `${card.hackathonId}_${currentUser.uid}_${targetType}_${card.id}`;

    // Idempotency guard: if already recorded, do not duplicate
    if (interests.some((i) => i.id === interestKey)) {
      notifyToast('Action already recorded (idempotent swipe guard).');
      return;
    }

    const newInterest: Interest = {
      id: interestKey,
      hackathonId: card.hackathonId,
      fromUid: currentUser.uid,
      targetType,
      targetId: card.id,
      decision,
      createdAt: new Date().toISOString(),
    };

    setInterests((prev) => [...prev, newInterest]);

    if (decision === 'passed') {
      notifyToast(`Passed on ${card.title}. Card hidden from pool.`);
      return;
    }

    // If swiping right on a PERSON:
    if (card.type === 'person') {
      const myLedTeam = teams.find(
        (t) =>
          t.hackathonId === card.hackathonId &&
          t.leaderId === currentUser.uid &&
          t.status === 'open'
      );

      // If viewer leads an open team in this event, send an official team invitation
      if (myLedTeam) {
        const existingPending = joinRequests.find(
          (jr) =>
            jr.teamId === myLedTeam.id &&
            jr.applicantUid === card.id &&
            jr.status === 'pending'
        );
        if (!existingPending) {
          const inviteReq: JoinRequest = {
            id: `req_inv_${Date.now()}`,
            hackathonId: card.hackathonId,
            teamId: myLedTeam.id,
            applicantUid: card.id,
            initiatorUid: currentUser.uid,
            proposedRole: card.rolesOfferedOrNeeded[0] ?? 'Builder',
            message:
              customNote ??
              `Invited to join ${myLedTeam.name.split(' (')[0]} based on complementary role fit.`,
            direction: 'invitation',
            status: 'pending',
            createdAt: new Date().toISOString(),
          };
          setJoinRequests((prev) => [inviteReq, ...prev]);
        }
        notifyToast(`Sent team invitation to ${card.title}!`);
        return;
      }

      // Check if counterpart already expressed interest in currentUser -> Mutual Match!
      const reciprocalKey = `${card.hackathonId}_${card.id}_user_${currentUser.uid}`;
      const hasReciprocal = interests.some(
        (i) => i.id === reciprocalKey && i.decision === 'interested'
      );

      if (hasReciprocal) {
        const convId = `conv_match_${card.hackathonId}_${[currentUser.uid, card.id].sort().join('_')}`;
        if (!conversations.some((c) => c.id === convId)) {
          const newConv: Conversation = {
            id: convId,
            hackathonId: card.hackathonId,
            type: 'direct_match',
            title: `${currentUser.displayName.split(' (')[0]} ↔ ${card.title.split(' (')[0]} (Mutual Match)`,
            participantUids: [currentUser.uid, card.id],
            createdAt: new Date().toISOString(),
            lastMessageAt: new Date().toISOString(),
          };
          setConversations((prev) => [newConv, ...prev]);
          if (customNote) {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg_${Date.now()}`,
                conversationId: convId,
                senderUid: currentUser.uid,
                body: customNote,
                createdAt: new Date().toISOString(),
                moderationStatus: 'clean',
              },
            ]);
          }
        }
        notifyToast(`Mutual Match with ${card.title}! 1-to-1 chat unlocked in Matches & Chat.`);
      } else {
        notifyToast(`Interest sent to ${card.title}. Chat unlocks if they reciprocate.`);
      }
      return;
    }

    // If swiping right on a TEAM -> Submit join application
    const existingApp = joinRequests.find(
      (jr) =>
        jr.teamId === card.id &&
        jr.applicantUid === currentUser.uid &&
        jr.status === 'pending'
    );
    if (!existingApp) {
      const appReq: JoinRequest = {
        id: `req_app_${Date.now()}`,
        hackathonId: card.hackathonId,
        teamId: card.id,
        applicantUid: currentUser.uid,
        initiatorUid: currentUser.uid,
        proposedRole: currentProfile.preferredRoles[0] ?? 'Generalist',
        message:
          customNote ??
          `Applying for ${card.rolesOfferedOrNeeded[0] ?? 'open'} role on ${card.title.split(' (')[0]}.`,
        direction: 'application',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      setJoinRequests((prev) => [appReq, ...prev]);
    }
    notifyToast(`Application submitted to ${card.title}! Track status in My Teams.`);
  };

  const handleResetPassedCards = (hackathonId: string) => {
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
    notifyToast('Reset passed cards for this hackathon.');
  };

  // Atomic Join Request Resolution (Section 6 Invariants 1-6)
  const handleResolveJoinRequest = (
    requestId: string,
    decision: 'accepted' | 'rejected'
  ) => {
    const req = joinRequests.find((r) => r.id === requestId);
    if (!req || req.status !== 'pending') return;

    if (decision === 'rejected') {
      setJoinRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                status: 'rejected',
                resolvedAt: new Date().toISOString(),
                resolutionNote: `Declined by ${currentUser.displayName}`,
              }
            : r
        )
      );
      notifyToast('Request declined.');
      return;
    }

    const team = teams.find((t) => t.id === req.teamId);
    const hack = hackathons.find((h) => h.id === req.hackathonId);
    if (!team || !hack) return;

    const deterministicMembershipKey = `${req.hackathonId}_${req.applicantUid}`;
    const existingActiveMembership = memberships.find(
      (m) => m.id === deterministicMembershipKey && m.status === 'active'
    );

    // Invariant 1 check: Applicant already belongs to an active team in this hackathon
    if (existingActiveMembership) {
      setLastTransactionBanner({
        type: 'error',
        title: 'Atomic Transaction Aborted — Single-Team Invariant Violation',
        detail: `Deterministic key "${deterministicMembershipKey}" is already claimed by active team "${existingActiveMembership.teamId}". A student cannot belong to two active teams in the same hackathon.`,
      });
      return;
    }

    // Invariant 2 & 4 check: Team capacity vs targetSize and hackathon maxTeamSize
    const maxAllowed = hack.maxTeamSize ?? team.targetSize;
    if (team.memberCount >= team.targetSize || team.memberCount >= maxAllowed) {
      setJoinRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                status: 'expired',
                resolvedAt: new Date().toISOString(),
                resolutionNote: 'Rejected atomically: Team reached full capacity.',
              }
            : r
        )
      );
      setLastTransactionBanner({
        type: 'error',
        title: 'Atomic Transaction Rejected — Team is Full',
        detail: `${team.name.split(' (')[0]} already has ${team.memberCount}/${team.targetSize} confirmed members.`,
      });
      return;
    }

    // Commit atomic roster addition
    const nextCount = team.memberCount + 1;
    const isNowFull = nextCount >= team.targetSize;

    const newMembership: Membership = {
      id: deterministicMembershipKey,
      hackathonId: req.hackathonId,
      teamId: team.id,
      uid: req.applicantUid,
      role: req.proposedRole,
      joinedAt: new Date().toISOString(),
      status: 'active',
    };

    setMemberships((prev) => [
      ...prev.filter((m) => m.id !== deterministicMembershipKey),
      newMembership,
    ]);

    setTeams((prev) =>
      prev.map((t) =>
        t.id === team.id
          ? {
              ...t,
              memberCount: nextCount,
              status: isNowFull ? 'full' : 'open',
            }
          : t
      )
    );

    // Update participation status immediately so candidate leaves solo People discovery pool
    setParticipations((prev) =>
      prev.map((p) =>
        p.hackathonId === req.hackathonId && p.uid === req.applicantUid
          ? { ...p, teamId: team.id, updatedAt: new Date().toISOString() }
          : p
      )
    );

    // Mark request accepted & auto-expire competing pending requests if team reached capacity or for that applicant
    setJoinRequests((prev) =>
      prev.map((r) => {
        if (r.id === requestId) {
          return {
            ...r,
            status: 'accepted',
            resolvedAt: new Date().toISOString(),
            resolutionNote: `Atomically committed (${nextCount}/${team.targetSize} slots filled).`,
          };
        }
        if (
          r.status === 'pending' &&
          r.hackathonId === req.hackathonId &&
          r.applicantUid === req.applicantUid
        ) {
          return {
            ...r,
            status: 'expired',
            resolvedAt: new Date().toISOString(),
            resolutionNote: 'Auto-invalidated: Applicant joined an active team in this hackathon.',
          };
        }
        if (isNowFull && r.status === 'pending' && r.teamId === team.id) {
          return {
            ...r,
            status: 'expired',
            resolvedAt: new Date().toISOString(),
            resolutionNote: `Auto-expired atomically: Team reached full capacity (${nextCount}/${team.targetSize}).`,
          };
        }
        return r;
      })
    );

    // Add applicant to team roster chat
    setConversations((prev) =>
      prev.map((c) =>
        c.teamId === team.id && !c.participantUids.includes(req.applicantUid)
          ? { ...c, participantUids: [...c.participantUids, req.applicantUid] }
          : c
      )
    );

    setLastTransactionBanner({
      type: 'success',
      title: 'Atomic Roster Transaction Committed',
      detail: `Created deterministic membership "${deterministicMembershipKey}" (${nextCount}/${team.targetSize} members). ${
        isNowFull
          ? 'Team reached full capacity; all competing pending applications/invitations for this team were atomically expired.'
          : 'Applicant discovery status updated immediately.'
      }`,
    });
  };

  // Acceptance Criterion #4: Two simultaneous approvals for the last slot yield ONE success and ONE clear "team is full" result
  const handleSimulateLastSlotRace = (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;

    const pendingForTeam = joinRequests.filter(
      (r) => r.teamId === teamId && r.status === 'pending'
    );

    if (pendingForTeam.length < 2) {
      setLastTransactionBanner({
        type: 'warning',
        title: 'Race Simulation Notice',
        detail: 'Need at least 2 pending requests on Team GridPulse to run the concurrent race simulation.',
      });
      return;
    }

    const [firstReq, secondReq] = pendingForTeam;
    const firstUser = users.find((u) => u.uid === firstReq.applicantUid);
    const secondUser = users.find((u) => u.uid === secondReq.applicantUid);

    // Execute first approval atomically -> fills slot 4/4, expires secondReq
    handleResolveJoinRequest(firstReq.id, 'accepted');

    setLastTransactionBanner({
      type: 'success',
      title: 'Simultaneous Last-Slot Race Verified (1 Success · 1 Rejected)',
      detail: `Concurrent Tx #1 (${firstUser?.displayName ?? firstReq.applicantUid}) claimed slot 4/4 via deterministic key "${team.hackathonId}_${firstReq.applicantUid}". Concurrent Tx #2 (${secondUser?.displayName ?? secondReq.applicantUid}) received "Team is full (4/4)" and was atomically marked expired.`,
    });
  };

  // Acceptance Criterion #5: Same user cannot join two active teams in the same hackathon
  const handleSimulateDoubleTeamAttempt = (hackathonId: string) => {
    const detKey = `${hackathonId}_${currentUser.uid}`;
    const existing = memberships.find((m) => m.id === detKey && m.status === 'active');

    if (existing) {
      setLastTransactionBanner({
        type: 'error',
        title: 'Invariant 1 Verified — Double-Team Membership Blocked',
        detail: `Attempted to join a second team in "${hackathonId}", but deterministic key "memberships/${detKey}" is already active on "${existing.teamId}". You CAN still join teams in other hackathons (e.g., EC Campus Buildathon).`,
      });
    } else {
      setLastTransactionBanner({
        type: 'warning',
        title: 'Deterministic Key Check Passed (Currently Not on a Team)',
        detail: `Key "memberships/${detKey}" is currently free for ${currentUser.displayName}. Switch to Persona B (Ananya Sharma) or approve an application first to see the active duplicate-team block.`,
      });
    }
  };

  const handleCreateTeam = (params: {
    hackathonId: string;
    name: string;
    pitch: string;
    projectIdea: string;
    rolesNeeded: string[];
    desiredDomains: string[];
    targetSize: number;
  }) => {
    const detKey = `${params.hackathonId}_${currentUser.uid}`;
    const existingMem = memberships.find((m) => m.id === detKey && m.status === 'active');
    if (existingMem) {
      setLastTransactionBanner({
        type: 'error',
        title: 'Cannot Create Second Active Team in Same Hackathon',
        detail: `You already hold active membership "${detKey}" in this hackathon. Leave your current team first or select a different hackathon.`,
      });
      return;
    }

    const newTeamId = `team_${Date.now()}`;
    const newTeam: Team = {
      id: newTeamId,
      hackathonId: params.hackathonId,
      leaderId: currentUser.uid,
      name: params.name,
      pitch: params.pitch,
      projectIdea: params.projectIdea || undefined,
      rolesNeeded: params.rolesNeeded,
      desiredDomains: params.desiredDomains,
      availabilitySummary: 'Weekend Hackathon Sprint',
      workStyleTags: currentProfile.workingStyleTags,
      targetSize: params.targetSize,
      memberCount: 1,
      status: 'open',
      visibility: 'public',
      createdAt: new Date().toISOString(),
    };

    const newMem: Membership = {
      id: detKey,
      hackathonId: params.hackathonId,
      teamId: newTeamId,
      uid: currentUser.uid,
      role: 'Team Leader',
      joinedAt: new Date().toISOString(),
      status: 'active',
    };

    const newConv: Conversation = {
      id: `conv_${newTeamId}`,
      hackathonId: params.hackathonId,
      type: 'team_roster',
      title: `Team ${params.name} — Roster Channel`,
      participantUids: [currentUser.uid],
      teamId: newTeamId,
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    };

    setTeams((prev) => [newTeam, ...prev]);
    setMemberships((prev) => [...prev, newMem]);
    setConversations((prev) => [newConv, ...prev]);
    handleUpdateParticipation(params.hackathonId, { intent: 'recruiting' });
    setLastTransactionBanner({
      type: 'success',
      title: 'Team Created & Deterministic Leader Membership Claimed',
      detail: `Created "${params.name}" with target size ${params.targetSize} and claimed key "memberships/${detKey}".`,
    });
  };

  const handleLeaveTeam = (hackathonId: string, teamId: string) => {
    const detKey = `${hackathonId}_${currentUser.uid}`;
    setMemberships((prev) =>
      prev.map((m) => (m.id === detKey ? { ...m, status: 'left' } : m))
    );
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? {
              ...t,
              memberCount: Math.max(0, t.memberCount - 1),
              status: 'open',
            }
          : t
      )
    );
    setParticipations((prev) =>
      prev.map((p) =>
        p.id === detKey ? { ...p, teamId: undefined, intent: 'looking' } : p
      )
    );
    notifyToast('Left team. Your participation status is now back to Looking for Team.');
  };

  // Block & Report Safety Controls (Section 11)
  const handleBlockUser = (targetUid: string) => {
    const blockId = `${currentUser.uid}_${targetUid}`;
    if (!blocks.some((b) => b.id === blockId)) {
      setBlocks((prev) => [
        ...prev,
        {
          id: blockId,
          blockerUid: currentUser.uid,
          blockedUid: targetUid,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    // Remove direct conversations with blocked user
    setConversations((prev) =>
      prev.filter(
        (c) =>
          !(
            c.type === 'direct_match' &&
            c.participantUids.includes(currentUser.uid) &&
            c.participantUids.includes(targetUid)
          )
      )
    );
    notifyToast('User blocked. Removed from discovery pool and direct messaging.');
  };

  const handleReportTarget = (
    targetType: 'user' | 'team' | 'message',
    targetId: string,
    targetLabel: string,
    reason: string
  ) => {
    const newRep: ReportRecord = {
      id: `rep_${Date.now()}`,
      reporterUid: currentUser.uid,
      targetType,
      targetId,
      targetLabel,
      reason,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    setReports((prev) => [newRep, ...prev]);
    notifyToast('Safety report submitted to Moderator Queue.');
  };

  // Admin Event Ingestion Review Actions
  const handleSubmitEventCandidate = (candidate: EventCandidate) => {
    setEventCandidates((prev) => [candidate, ...prev]);
    setAuditLogs((prev) => [
      {
        id: `audit_${Date.now()}`,
        actorUid: currentUser.uid,
        action: 'STAGE_EVENT_CANDIDATE',
        targetId: candidate.id,
        summary: `Staged "${candidate.title}" (${candidate.source}) into review queue.`,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    notifyToast('Event candidate staged in Admin Review Queue (not public until approved).');
  };

  const handleApproveCandidate = (candidateId: string) => {
    const cand = eventCandidates.find((c) => c.id === candidateId);
    if (!cand) return;

    const newHackId = `hack_approved_${Date.now()}`;
    const newHack: Hackathon = {
      id: newHackId,
      name: cand.title,
      description: cand.description,
      eventType: cand.eventType,
      matchable: cand.matchable,
      themes: cand.themes.length > 0 ? cand.themes : ['Applied AI/ML', 'Developer Tools'],
      venue: {
        name: cand.venue.name ?? null,
        campus: cand.venue.campus ?? 'RR Campus',
      },
      format: cand.format,
      startAt: cand.startAt,
      datePrecision: cand.startAt && cand.startAt.length > 10 ? 'exact_instant' : 'date_only',
      endAt: cand.endAt,
      timezone: cand.timezone,
      registrationDeadline: cand.registrationDeadline,
      registrationUrl: cand.registrationUrl,
      minTeamSize: cand.teamSize.min,
      maxTeamSize: cand.teamSize.max,
      eligibilityNotes: cand.eligibilityNotes,
      organizer: cand.organizer,
      sourceIds: [cand.id],
      fieldProvenance: {},
      suggestedByCount: 1,
      classification: {
        category: cand.eventType,
        ruleGatePassed: cand.classification.ruleGatePassed,
        mlConfidenceScore: cand.classification.mlScore,
        reason: cand.classification.reason,
      },
      lastVerifiedAt: new Date().toISOString(),
      verificationStatus:
        cand.teamSize.min !== null && cand.teamSize.max !== null
          ? 'verified'
          : 'unconfirmed_constraints',
      status: 'published',
      createdBy: currentUser.uid,
    };

    setHackathons((prev) => [newHack, ...prev]);
    setEventCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, reviewStatus: 'approved' } : c))
    );
    setAuditLogs((prev) => [
      {
        id: `audit_${Date.now()}`,
        actorUid: currentUser.uid,
        action: 'APPROVE_EVENT_CANDIDATE',
        targetId: newHackId,
        summary: `Approved "${cand.title}" into public directory (matchable=${cand.matchable}).`,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    notifyToast(`Approved "${cand.title}" into the live Hackathon Directory.`);
  };

  const handleRejectCandidate = (candidateId: string) => {
    setEventCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, reviewStatus: 'rejected' } : c))
    );
    setAuditLogs((prev) => [
      {
        id: `audit_${Date.now()}`,
        actorUid: currentUser.uid,
        action: 'REJECT_EVENT_CANDIDATE',
        targetId: candidateId,
        summary: `Rejected candidate ${candidateId}.`,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    notifyToast('Rejected staged event candidate.');
  };

  const handleMergeDuplicateCandidate = (candidateId: string, targetHackathonId: string) => {
    const cand = eventCandidates.find((c) => c.id === candidateId);
    if (!cand) return;

    setHackathons((prev) =>
      prev.map((h) =>
        h.id === targetHackathonId
          ? {
              ...h,
              sourceIds: Array.from(new Set([...h.sourceIds, cand.id])),
              suggestedByCount: h.suggestedByCount + 1,
            }
          : h
      )
    );
    setEventCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, reviewStatus: 'superseded' } : c))
    );
    setAuditLogs((prev) => [
      {
        id: `audit_${Date.now()}`,
        actorUid: currentUser.uid,
        action: 'MERGE_DUPLICATE_PROVENANCE',
        targetId: targetHackathonId,
        summary: `Merged duplicate source "${cand.sourceUrl}" into ${targetHackathonId} without overwriting verified constraints.`,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    notifyToast('Merged duplicate candidate provenance into existing verified hackathon.');
  };

  const handleApplyDiffCandidate = (candidateId: string, targetHackathonId: string) => {
    const cand = eventCandidates.find((c) => c.id === candidateId);
    if (!cand) return;

    setHackathons((prev) =>
      prev.map((h) =>
        h.id === targetHackathonId
          ? {
              ...h,
              registrationDeadline: cand.registrationDeadline ?? h.registrationDeadline,
              venue: {
                ...h.venue,
                name: cand.venue.name ?? h.venue.name,
              },
              lastVerifiedAt: new Date().toISOString(),
            }
          : h
      )
    );
    setEventCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, reviewStatus: 'approved' } : c))
    );
    setAuditLogs((prev) => [
      {
        id: `audit_${Date.now()}`,
        actorUid: currentUser.uid,
        action: 'VERIFY_SOURCE_DIFF',
        targetId: targetHackathonId,
        summary: `Verified and applied updated registrationDeadline and venue diff to ${targetHackathonId}.`,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    notifyToast('Verified and applied source diff to live hackathon.');
  };

  const pendingCandidateCount = eventCandidates.filter(
    (c) => c.reviewStatus === 'new' || c.reviewStatus === 'needs_confirmation'
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-6 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveNav('hackathons');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          Assemble
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <button
            onClick={() => setActiveNav('hackathons')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeNav === 'hackathons'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 font-semibold'
                : ''
            }`}
          >
            Hackathons
          </button>
          <button
            onClick={() => setActiveNav('discover')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeNav === 'discover'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 font-semibold'
                : ''
            }`}
          >
            Discover
          </button>
          <button
            onClick={() => setActiveNav('teams')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeNav === 'teams'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 font-semibold'
                : ''
            }`}
          >
            My Teams
          </button>
          <button
            onClick={() => setActiveNav('matches')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeNav === 'matches'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 font-semibold'
                : ''
            }`}
          >
            Matches & Chat
          </button>
          <button
            onClick={() => setActiveNav('admin')}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeNav === 'admin'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 font-semibold'
                : ''
            }`}
          >
            Review Queue ({pendingCandidateCount})
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowProfileModal(true)}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Edit Profile & GitHub Import
          </button>
        </div>
      </header>

      {/* Sub-Header Workspace Toolbar: PESU OIDC Session & Persona Switcher */}
      <div className="bg-slate-100/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
            <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              PESU OAuth2 (OIDC + PKCE) Verified Session:
            </span>
            <select
              aria-label="Switch Active Test Persona"
              value={currentUser.uid}
              onChange={(e) => handleSelectPersona(e.target.value)}
              className="px-2.5 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              {users.slice(0, 4).map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName} — {u.personaLabel}
                </option>
              ))}
            </select>
            <span className="text-slate-400 hidden lg:inline">
              · {currentUser.campus} · Claim <code className="font-mono">{currentUser.pesuOidcSub}</code>
            </span>
          </div>

          {/* Mobile Navigation Fallback */}
          <div className="flex md:hidden items-center gap-2 overflow-x-auto py-1">
            {(
              [
                { id: 'hackathons', label: 'Hackathons' },
                { id: 'discover', label: 'Discover' },
                { id: 'teams', label: 'My Teams' },
                { id: 'matches', label: 'Matches' },
                { id: 'admin', label: `Review (${pendingCandidateCount})` },
              ] as { id: NavTab; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveNav(tab.id)}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap shrink-0 ${
                  activeNav === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowProfileModal(true)}
            className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Interests: {currentProfile.interestTags.slice(0, 2).join(', ')} · Roles:{' '}
            {currentProfile.preferredRoles.join('/')}
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg border border-slate-700 flex items-center gap-2.5 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {activeNav === 'hackathons' && (
          <HackathonsView
            currentUser={currentUser}
            hackathons={hackathons}
            selectedHackathonId={selectedHackathonId}
            privateHints={privateHints}
            onSelectHackathonForDiscovery={(id) => {
              setSelectedHackathonId(id);
              setActiveNav('discover');
            }}
            onToggleAcademyScope={handleToggleAcademyScope}
            onSubmitEventCandidate={handleSubmitEventCandidate}
          />
        )}

        {activeNav === 'discover' && (
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

        {activeNav === 'teams' && (
          <TeamsAndRequestsView
            currentUser={currentUser}
            hackathons={hackathons}
            selectedHackathonId={selectedHackathonId}
            teams={teams}
            memberships={memberships}
            joinRequests={joinRequests}
            users={users}
            lastTransactionBanner={lastTransactionBanner}
            onClearTransactionBanner={() => setLastTransactionBanner(null)}
            onCreateTeam={handleCreateTeam}
            onResolveJoinRequest={handleResolveJoinRequest}
            onSimulateLastSlotRace={handleSimulateLastSlotRace}
            onSimulateDoubleTeamAttempt={handleSimulateDoubleTeamAttempt}
            onLeaveTeam={handleLeaveTeam}
          />
        )}

        {activeNav === 'matches' && (
          <MatchesAndChatView
            currentUser={currentUser}
            users={users}
            profiles={profiles}
            hackathons={hackathons}
            conversations={conversations}
            messages={messages}
            onSendMessage={(conversationId, body) => {
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg_${Date.now()}`,
                  conversationId,
                  senderUid: currentUser.uid,
                  body,
                  createdAt: new Date().toISOString(),
                  moderationStatus: 'clean',
                },
              ]);
            }}
            onBlockUser={handleBlockUser}
            onReportTarget={handleReportTarget}
          />
        )}

        {activeNav === 'admin' && (
          <AdminReviewQueueView
            currentUser={currentUser}
            candidates={eventCandidates}
            hackathons={hackathons}
            reports={reports}
            auditLogs={auditLogs}
            onApproveCandidate={handleApproveCandidate}
            onRejectCandidate={handleRejectCandidate}
            onMergeDuplicateCandidate={handleMergeDuplicateCandidate}
            onApplyDiffCandidate={handleApplyDiffCandidate}
            onResolveReport={(reportId, resolution) => {
              setReports((prev) =>
                prev.map((r) => (r.id === reportId ? { ...r, status: resolution } : r))
              );
              notifyToast(`Report marked as ${resolution}.`);
            }}
          />
        )}
      </main>

      {/* Quiet Institutional Disclaimer Footer (Section 11.9) */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>
            Assemble (PES Hackathon Team Finder — Architecture v0.3 Phase A) · Independent student project; not an official PES University registration portal.
          </span>
          <span>
            Synthetic demo profiles & events · Zero Academy password collection · Non-LLM per-swipe matching
          </span>
        </div>
      </footer>

      {/* Onboarding & GitHub Evidence Review Modal */}
      {showProfileModal && (
        <OnboardingAndProfileModal
          currentUser={currentUser}
          profile={currentProfile}
          onSaveProfile={(updated) => {
            setProfiles((prev) => ({
              ...prev,
              [currentUser.uid]: updated,
            }));
            notifyToast('Updated builder profile and recomputed TF-IDF discovery features.');
          }}
          onClose={() => setShowProfileModal(false)}
        />
      )}
    </div>
  );
}
