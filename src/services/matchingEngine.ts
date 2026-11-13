/**
 * Quackathon (PES Hackathon Team Finder) — Three-Pass Matching & Discovery Engine
 *
 * Pass 1: Deterministic Hard Constraints (same event, verified/matchable, capacity, no blocks, no active double-team, not swiped)
 * Pass 2: Canonicalized Multi-Hot Tag Vectors + Custom Specializations Normalization + Controlled-Vocabulary TF-IDF Cosine Similarity
 * Pass 3: Transparent Re-Ranking (Peer vs. Team-Recruiting objectives, Cold-Start weight redistribution, 1-3 grounded reasons)
 *
 * Strictly zero Gemini/LLM API calls per swipe or card render.
 */

import {
  BlockRecord,
  CandidateCard,
  Hackathon,
  Interest,
  InterestCircle,
  Membership,
  Participation,
  Profile,
  Team,
  User,
} from '../types/domain';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over', 'across', 'using', 'built',
  'building', 'looking', 'team', 'student', 'campus', 'pes', 'demo', 'synthetic', 'project', 'app',
]);

function tokenizeControlled(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#/-\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

const SPECIALIZATION_SYNONYMS: Record<string, string[]> = {
  'computer vision': ['cv', 'opencv', 'yolo', 'yolov8', 'image processing', 'vision', 'slam'],
  'nlp / llm engineering': ['nlp', 'llm', 'rag', 'transformers', 'langchain', 'genai', 'applied ai/ml', 'pytorch'],
  'embedded systems': ['esp32', 'arduino', ' microcontroller', 'firmware', 'rtos', 'uart', 'ros2', 'hardware/embedded', 'c++'],
  'reinforcement learning': ['rl', 'policy gradient', 'q-learning', 'gym', 'control loops', 'robotics'],
  'blockchain': ['web3', 'solidity', 'smart contracts', 'zero-knowledge', 'zk', 'ledger', 'fintech'],
  'scientific computing': ['numpy', 'scipy', 'time-series', 'simulation', 'matlab', 'julia', 'forecasting'],
  '3d modelling': ['blender', 'three.js', 'webgl', 'cad', 'mesh', '3d', 'spatial'],
  'geospatial visualization': ['d3.js', 'deck.gl', 'geojson', 'gis', 'maps', 'gtfs', 'canopy', 'data visualization'],
};

/**
 * Matches custom free-text specializations against a candidate's profile & participation
 * using normalization, synonym expansion, and token stem similarity while preserving original labels.
 * Zero LLM calls per match.
 */
export function matchCustomSpecializations(
  customSpecs: string[] | undefined,
  candidateProfile: Profile | undefined,
  candidateParticipation?: Participation
): { matchedOriginalLabels: string[]; score: number } {
  if (!customSpecs || customSpecs.length === 0 || !candidateProfile) {
    return { matchedOriginalLabels: [], score: 0 };
  }

  const candidateCorpus = [
    ...candidateProfile.skillTags,
    ...candidateProfile.interestTags,
    ...candidateProfile.projectDomains,
    ...candidateProfile.topicsToExplore,
    ...candidateProfile.preferredRoles,
    ...candidateProfile.rolesWantToLearn,
    ...(candidateParticipation?.skillsOffered ?? []),
    candidateProfile.headline,
    ...candidateProfile.featuredProjects.map((p) => `${p.title} ${p.description} ${p.tags.join(' ')}`),
  ]
    .join(' ')
    .toLowerCase();

  const candidateTokens = new Set(tokenizeControlled(candidateCorpus));
  const matchedOriginalLabels: string[] = [];

  for (const originalLabel of customSpecs) {
    const normSpec = originalLabel.toLowerCase().trim();
    if (!normSpec) continue;

    // 1. Direct substring match
    if (candidateCorpus.includes(normSpec)) {
      matchedOriginalLabels.push(originalLabel);
      continue;
    }

    // 2. Synonym expansion lookup
    const synonyms = SPECIALIZATION_SYNONYMS[normSpec] ?? [];
    if (synonyms.some((syn) => candidateCorpus.includes(syn.trim()))) {
      matchedOriginalLabels.push(originalLabel);
      continue;
    }

    // 3. Token overlap / prefix similarity
    const specTokens = tokenizeControlled(normSpec);
    if (specTokens.length > 0) {
      const hits = specTokens.filter((st) => {
        if (candidateTokens.has(st)) return true;
        if (st.length >= 4) {
          for (const ct of candidateTokens) {
            if (ct.startsWith(st.slice(0, 4)) || st.startsWith(ct.slice(0, 4))) {
              return true;
            }
          }
        }
        return false;
      });
      if (hits.length / specTokens.length >= 0.5) {
        matchedOriginalLabels.push(originalLabel);
      }
    }
  }

  return {
    matchedOriginalLabels,
    score: matchedOriginalLabels.length / customSpecs.length,
  };
}

/**
 * Computes TF-IDF cosine similarity between two documents within a small corpus of candidate texts.
 */
export function computeTfIdfCosineSimilarity(
  docA: string,
  docB: string,
  corpusDocs: string[]
): number {
  const tokensA = tokenizeControlled(docA);
  const tokensB = tokenizeControlled(docB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const allDocsTokens = [tokensA, tokensB, ...corpusDocs.map(tokenizeControlled)];
  const docCount = allDocsTokens.length;

  const vocab = Array.from(new Set([...tokensA, ...tokensB]));
  const dfMap = new Map<string, number>();

  for (const term of vocab) {
    let df = 0;
    for (const d of allDocsTokens) {
      if (d.includes(term)) df += 1;
    }
    dfMap.set(term, df);
  }

  const buildTfIdfVector = (tokens: string[]): number[] => {
    const counts = new Map<string, number>();
    for (const t of tokens) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return vocab.map((term) => {
      const tf = (counts.get(term) ?? 0) / tokens.length;
      const df = dfMap.get(term) ?? 1;
      const idf = Math.log(1 + docCount / df);
      return tf * idf;
    });
  };

  const vecA = buildTfIdfVector(tokensA);
  const vecB = buildTfIdfVector(tokensB);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vocab.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return Math.min(1, Math.max(0, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

function jaccardOverlap(listA: string[], listB: string[]): { score: number; shared: string[] } {
  const normA = new Map(listA.map((item) => [item.toLowerCase().trim(), item]));
  const normB = new Map(listB.map((item) => [item.toLowerCase().trim(), item]));
  if (normA.size === 0 || normB.size === 0) return { score: 0, shared: [] };

  const shared: string[] = [];
  for (const [k, original] of normA.entries()) {
    if (normB.has(k)) {
      shared.push(original);
    }
  }
  const unionSize = new Set([...normA.keys(), ...normB.keys()]).size;
  return {
    score: unionSize > 0 ? shared.length / unionSize : 0,
    shared,
  };
}

/**
 * Generates safe, editable template-based technical icebreakers from approved projects & interests.
 */
export function generateTechnicalIcebreakerDrafts(options: {
  viewerProfile: Profile;
  targetTitle: string;
  targetProjects: { title: string; description: string }[];
  sharedInterests: string[];
  complementaryRoles: string[];
  customPrompt?: string;
}): string[] {
  const drafts: string[] = [];
  const { viewerProfile, targetTitle, targetProjects, sharedInterests, complementaryRoles, customPrompt } = options;

  if (customPrompt) {
    drafts.push(`Re "${customPrompt}" — I can cover ${viewerProfile.preferredRoles.join('/')} if we team up!`);
  }

  if (targetProjects.length > 0) {
    const topProj = targetProjects[0];
    const sharedTopic = sharedInterests[0] ?? viewerProfile.interestTags[0] ?? 'this track';
    drafts.push(
      `Your "${topProj.title}" project caught my eye — want to combine that with my ${viewerProfile.preferredRoles[0] ?? 'builder'} setup for ${sharedTopic}?`
    );
  }

  if (complementaryRoles.length > 0) {
    drafts.push(
      `I see you need ${complementaryRoles.join(' + ')}. I have worked with ${viewerProfile.skillTags.slice(0, 3).join(', ')} and would love to own that slice.`
    );
  }

  if (sharedInterests.length > 0) {
    drafts.push(
      `Both of us marked ${sharedInterests.slice(0, 2).join(' & ')}. What problem statement would you most want to ship in 24 hours?`
    );
  }

  if (drafts.length === 0) {
    drafts.push(
      `Hi ${targetTitle.split(' ')[0]}! Looking for focused collaborators for this hackathon — my main stack is ${viewerProfile.skillTags.slice(0, 3).join(', ')}.`
    );
  }

  return drafts.slice(0, 3);
}

/**
 * Computes thematic Interest Circles within a selected hackathon from explicit participant tags.
 */
export function computeInterestCircles(
  hackathon: Hackathon,
  participations: Participation[],
  profiles: Record<string, Profile>
): InterestCircle[] {
  const eventParts = participations.filter((p) => p.hackathonId === hackathon.id && p.discoverable);

  const circleDefinitions: { id: string; label: string; description: string; matchingTags: string[] }[] = [
    {
      id: 'circle_applied_ml',
      label: 'Applied ML & Data',
      description: 'Inference pipelines, forecasting, RAG & domain analytics',
      matchingTags: ['Applied AI/ML', 'Data Visualization'],
    },
    {
      id: 'circle_cv_robotics',
      label: 'Computer Vision + Robotics',
      description: 'Edge sensors, ESP32/ROS2 hardware, and real-time vision',
      matchingTags: ['Computer Vision', 'Robotics/IoT'],
    },
    {
      id: 'circle_civic_climate',
      label: 'Climate & Civic Systems',
      description: 'Urban transit, power grids, healthcare & public infrastructure',
      matchingTags: ['Climate/Civic Tech', 'Healthcare Tech'],
    },
    {
      id: 'circle_systems_sec',
      label: 'Systems, DevTools & Security',
      description: 'Open-source tooling, cloud infra, CTFs & fintech reliability',
      matchingTags: ['Open-Source Systems', 'Systems/Cloud', 'Developer Tools', 'Security/CTFs', 'Fintech'],
    },
  ];

  return circleDefinitions.map((def) => {
    const count = eventParts.filter((part) => {
      const prof = profiles[part.uid];
      if (!prof) return false;
      return prof.interestTags.some((tag) => def.matchingTags.includes(tag));
    }).length;

    return {
      ...def,
      participantCount: count,
    };
  });
}

/**
 * Ranks People cards for a viewer within a selected hackathon.
 */
export function rankPeopleForHackathon(params: {
  viewerUid: string;
  hackathon: Hackathon;
  users: User[];
  profiles: Record<string, Profile>;
  participations: Participation[];
  teams: Team[];
  memberships: Membership[];
  interests: Interest[];
  blocks: BlockRecord[];
  activeCircleTags?: string[];
  roleFilter?: string;
  onlyFirstTimeHackers?: boolean;
}): { cards: CandidateCard[]; internalScores: Map<string, number> } {
  const {
    viewerUid,
    hackathon,
    users,
    profiles,
    participations,
    teams,
    memberships,
    interests,
    blocks,
    activeCircleTags,
    roleFilter,
    onlyFirstTimeHackers,
  } = params;

  if (!hackathon.matchable) {
    return { cards: [], internalScores: new Map() };
  }

  const viewerProfile = profiles[viewerUid];
  const viewerParticipation = participations.find(
    (p) => p.hackathonId === hackathon.id && p.uid === viewerUid
  );
  const viewerTeam = teams.find(
    (t) => t.hackathonId === hackathon.id && t.leaderId === viewerUid && t.status === 'open'
  );

  const blockedUids = new Set(
    blocks
      .filter((b) => b.blockerUid === viewerUid || b.blockedUid === viewerUid)
      .map((b) => (b.blockerUid === viewerUid ? b.blockedUid : b.blockerUid))
  );

  const swipedUserIds = new Set(
    interests
      .filter(
        (i) => i.hackathonId === hackathon.id && i.fromUid === viewerUid && i.targetType === 'user'
      )
      .map((i) => i.targetId)
  );

  const activeMemberUidsInEvent = new Set(
    memberships
      .filter((m) => m.hackathonId === hackathon.id && m.status === 'active')
      .map((m) => m.uid)
  );

  const eligibleParticipations = participations.filter((part) => {
    if (part.hackathonId !== hackathon.id) return false;
    if (part.uid === viewerUid) return false;
    if (!part.discoverable) return false;
    if (blockedUids.has(part.uid)) return false;
    if (swipedUserIds.has(part.uid)) return false;
    if (activeMemberUidsInEvent.has(part.uid)) return false;

    const candidateUser = users.find((u) => u.uid === part.uid);
    const candidateProfile = profiles[part.uid];
    if (!candidateUser || candidateUser.accountStatus !== 'active') return false;
    if (candidateUser.verificationStatus === 'unverified') return false;
    if (!candidateProfile || candidateProfile.visibility !== 'public_verified_students') return false;

    if (onlyFirstTimeHackers && !candidateProfile.isFirstTimeHacker) return false;

    if (roleFilter && roleFilter !== 'ALL') {
      const hasRole =
        part.desiredRoles.includes(roleFilter) ||
        candidateProfile.preferredRoles.includes(roleFilter) ||
        candidateProfile.rolesWantToLearn.includes(roleFilter);
      if (!hasRole) return false;
    }

    if (activeCircleTags && activeCircleTags.length > 0) {
      const inCircle = candidateProfile.interestTags.some((t) => activeCircleTags.includes(t));
      if (!inCircle) return false;
    }

    return true;
  });

  const buildProfileAbstract = (prof: Profile, part?: Participation): string => {
    const projText = prof.featuredProjects.map((p) => `${p.title} ${p.description} ${p.tags.join(' ')}`).join(' ');
    return [
      prof.headline,
      prof.about,
      prof.skillTags.join(' '),
      prof.interestTags.join(' '),
      prof.projectDomains.join(' '),
      prof.topicsToExplore.join(' '),
      projText,
      part ? part.skillsOffered.join(' ') : '',
    ].join(' ');
  };

  const corpusDocs = eligibleParticipations.map((p) => buildProfileAbstract(profiles[p.uid], p));
  const viewerAbstract = viewerTeam
    ? `${viewerTeam.name} ${viewerTeam.pitch} ${viewerTeam.projectIdea ?? ''} ${viewerTeam.desiredDomains.join(' ')} ${viewerTeam.rolesNeeded.join(' ')} ${(viewerTeam.customSpecializations ?? []).join(' ')}`
    : viewerProfile
    ? buildProfileAbstract(viewerProfile, viewerParticipation)
    : hackathon.themes.join(' ');

  const internalScores = new Map<string, number>();
  const scoredCards: { card: CandidateCard; score: number }[] = [];

  for (const part of eligibleParticipations) {
    const user = users.find((u) => u.uid === part.uid)!;
    const prof = profiles[part.uid]!;
    const candidateAbstract = buildProfileAbstract(prof, part);

    const tfidfSim = computeTfIdfCosineSimilarity(viewerAbstract, candidateAbstract, corpusDocs);

    const viewerInterests = viewerTeam
      ? viewerTeam.desiredDomains
      : viewerProfile?.interestTags ?? hackathon.themes;
    const { score: interestSim, shared: sharedInterests } = jaccardOverlap(
      viewerInterests,
      prof.interestTags
    );

    const viewerAvail = viewerParticipation?.availabilityWindows ?? [];
    const { score: availSim, shared: sharedAvail } = jaccardOverlap(
      viewerAvail,
      part.availabilityWindows
    );

    const viewerWorkStyle = viewerTeam
      ? viewerTeam.workStyleTags
      : viewerParticipation?.workPreferences ?? viewerProfile?.workingStyleTags ?? [];
    const { score: collabSim, shared: sharedWorkStyle } = jaccardOverlap(
      viewerWorkStyle,
      part.workPreferences.length > 0 ? part.workPreferences : prof.workingStyleTags
    );

    const rolesNeededByViewer = viewerTeam
      ? viewerTeam.rolesNeeded
      : viewerProfile
      ? ['Frontend', 'Backend', 'ML/Data', 'Product/UI Design', 'Hardware/Embedded'].filter(
          (r) => !viewerProfile.preferredRoles.includes(r)
        )
      : [];

    const candidateOfferedRoles = Array.from(
      new Set([...part.desiredRoles, ...prof.preferredRoles])
    );
    const complementaryRoles = candidateOfferedRoles.filter((r) =>
      rolesNeededByViewer.includes(r)
    );

    // Match custom specializations when recruiting for a team
    const customSpecMatch = matchCustomSpecializations(
      viewerTeam?.customSpecializations,
      prof,
      part
    );

    const baseRoleScore =
      rolesNeededByViewer.length > 0
        ? Math.min(1, complementaryRoles.length / Math.min(2, rolesNeededByViewer.length))
        : 0.5;

    const combinedRoleAndSpecScore =
      viewerTeam?.customSpecializations && viewerTeam.customSpecializations.length > 0
        ? 0.65 * baseRoleScore + 0.35 * customSpecMatch.score
        : baseRoleScore;

    const isColdStart = Boolean(prof.isFirstTimeHacker && !prof.githubUsername);
    const explorationBonus = prof.isFirstTimeHacker ? 0.85 : 0.5;

    let totalScore = 0;
    const isRecruitingMode = Boolean(
      viewerTeam || viewerParticipation?.intent === 'recruiting'
    );

    if (isRecruitingMode) {
      const skillComplement = isColdStart ? interestSim : Math.max(tfidfSim, customSpecMatch.score);
      totalScore =
        0.35 * combinedRoleAndSpecScore +
        0.25 * interestSim +
        0.20 * (viewerAvail.length > 0 ? availSim : 0.6) +
        0.15 * skillComplement +
        0.05 * explorationBonus;
    } else {
      const effectiveThemeSim = isColdStart ? Math.max(tfidfSim, interestSim) : tfidfSim;
      totalScore =
        0.35 * interestSim +
        0.25 * effectiveThemeSim +
        0.20 * (viewerAvail.length > 0 ? availSim : 0.6) +
        0.15 * collabSim +
        0.05 * explorationBonus;
    }

    const reasons: string[] = [];
    if (customSpecMatch.matchedOriginalLabels.length > 0) {
      reasons.push(
        `Matches team specialization: ${customSpecMatch.matchedOriginalLabels.join(' & ')}`
      );
    }

    if (complementaryRoles.length > 0) {
      reasons.push(
        viewerTeam
          ? `Fills open ${complementaryRoles.join(' / ')} role on ${viewerTeam.name.split(' (')[0]}`
          : `Complements your stack with ${complementaryRoles.join(' & ')}`
      );
    } else if (prof.rolesWantToLearn.length > 0 && prof.isFirstTimeHacker) {
      reasons.push(
        `First-time hacker eager to contribute in ${candidateOfferedRoles.join('/')} and explore ${prof.rolesWantToLearn.join('/')}`
      );
    }

    if (sharedInterests.length > 0) {
      reasons.push(`Shared interest in ${sharedInterests.slice(0, 2).join(' & ')}`);
    }

    if (sharedAvail.length > 0 && reasons.length < 3) {
      reasons.push(`Available during ${sharedAvail.slice(0, 2).join(' and ')}`);
    } else if (sharedWorkStyle.length > 0 && reasons.length < 3) {
      reasons.push(`Matches your ${sharedWorkStyle[0].toLowerCase()} collaboration style`);
    }

    if (prof.featuredProjects.length > 0 && reasons.length < 3) {
      reasons.push(`Has built "${prof.featuredProjects[0].title}"`);
    }

    const icebreakerDrafts = viewerProfile
      ? generateTechnicalIcebreakerDrafts({
          viewerProfile,
          targetTitle: user.displayName,
          targetProjects: prof.featuredProjects,
          sharedInterests,
          complementaryRoles: [
            ...complementaryRoles,
            ...customSpecMatch.matchedOriginalLabels,
          ],
          customPrompt: prof.icebreakerPrompt,
        })
      : [];

    internalScores.set(user.uid, totalScore);

    scoredCards.push({
      score: totalScore,
      card: {
        id: user.uid,
        type: 'person',
        hackathonId: hackathon.id,
        title: user.displayName,
        subtitle: `${prof.headline} · ${user.campus}`,
        campus: user.campus,
        isFirstTimeHacker: prof.isFirstTimeHacker,
        skills: Array.from(new Set([...part.skillsOffered, ...prof.skillTags])).slice(0, 7),
        rolesOfferedOrNeeded: candidateOfferedRoles,
        matchedSpecializations: customSpecMatch.matchedOriginalLabels,
        rolesWantToLearn: prof.rolesWantToLearn,
        featuredEvidence: prof.featuredProjects.map((fp) => ({
          title: fp.title,
          description: fp.description,
          url: fp.sourceUrl,
          isCoursework: fp.isCourseworkOrIdea,
        })),
        compatibilityReasons: reasons.slice(0, 3),
        availabilitySummary: part.availabilityWindows.join(' · '),
        commitmentLevel: part.commitmentLevel,
        workingStyle: part.workPreferences.length > 0 ? part.workPreferences : prof.workingStyleTags,
        sharedInterests,
        complementaryRoles,
        icebreakerDrafts,
        featureBreakdown: {
          mode: isRecruitingMode ? 'team_candidate' : 'peer',
          primaryFitLabel: isRecruitingMode ? 'Missing-Role & Spec Fit' : 'Interest & Project Affinity',
          interestOrRoleSim: Math.round((isRecruitingMode ? combinedRoleAndSpecScore : interestSim) * 100),
          tfidfThemeSim: Math.round(tfidfSim * 100),
          availabilitySim: Math.round((viewerAvail.length > 0 ? availSim : 0.6) * 100),
          collabOrSkillSim: Math.round(collabSim * 100),
          coldStartRedistributed: isColdStart,
        },
      },
    });
  }

  scoredCards.sort((a, b) => b.score - a.score);
  return {
    cards: scoredCards.map((s) => s.card),
    internalScores,
  };
}

/**
 * Ranks open Teams for a viewer within a selected hackathon, including customSpecializations matching.
 */
export function rankTeamsForHackathon(params: {
  viewerUid: string;
  hackathon: Hackathon;
  profiles: Record<string, Profile>;
  participations: Participation[];
  teams: Team[];
  interests: Interest[];
  blocks: BlockRecord[];
  activeCircleTags?: string[];
  roleFilter?: string;
}): CandidateCard[] {
  const {
    viewerUid,
    hackathon,
    profiles,
    participations,
    teams,
    interests,
    blocks,
    activeCircleTags,
    roleFilter,
  } = params;

  if (!hackathon.matchable) return [];

  const viewerProfile = profiles[viewerUid];
  const viewerParticipation = participations.find(
    (p) => p.hackathonId === hackathon.id && p.uid === viewerUid
  );

  const blockedUids = new Set(
    blocks
      .filter((b) => b.blockerUid === viewerUid || b.blockedUid === viewerUid)
      .map((b) => (b.blockerUid === viewerUid ? b.blockedUid : b.blockerUid))
  );

  const swipedTeamIds = new Set(
    interests
      .filter(
        (i) => i.hackathonId === hackathon.id && i.fromUid === viewerUid && i.targetType === 'team'
      )
      .map((i) => i.targetId)
  );

  const eligibleTeams = teams.filter((team) => {
    if (team.hackathonId !== hackathon.id) return false;
    if (team.status !== 'open') return false;
    if (team.memberCount >= team.targetSize) return false;
    if (blockedUids.has(team.leaderId)) return false;
    if (swipedTeamIds.has(team.id)) return false;

    if (roleFilter && roleFilter !== 'ALL') {
      const inStandardRole = team.rolesNeeded.includes(roleFilter);
      const inCustomSpec = (team.customSpecializations ?? []).some(
        (s) => s.toLowerCase() === roleFilter.toLowerCase()
      );
      if (!inStandardRole && !inCustomSpec) return false;
    }

    if (activeCircleTags && activeCircleTags.length > 0) {
      const inCircle = team.desiredDomains.some((d) => activeCircleTags.includes(d));
      if (!inCircle) return false;
    }

    return true;
  });

  const corpusDocs = eligibleTeams.map(
    (t) =>
      `${t.name} ${t.pitch} ${t.projectIdea ?? ''} ${t.desiredDomains.join(' ')} ${(
        t.customSpecializations ?? []
      ).join(' ')}`
  );
  const viewerDoc = viewerProfile
    ? `${viewerProfile.headline} ${viewerProfile.about} ${viewerProfile.skillTags.join(' ')} ${viewerProfile.interestTags.join(' ')} ${viewerProfile.projectDomains.join(' ')}`
    : hackathon.themes.join(' ');

  const scored: { card: CandidateCard; score: number }[] = [];

  for (const team of eligibleTeams) {
    const teamDoc = `${team.name} ${team.pitch} ${team.projectIdea ?? ''} ${team.desiredDomains.join(' ')} ${(
      team.customSpecializations ?? []
    ).join(' ')}`;
    const tfidfSim = computeTfIdfCosineSimilarity(viewerDoc, teamDoc, corpusDocs);

    const viewerRoles = Array.from(
      new Set([
        ...(viewerParticipation?.desiredRoles ?? []),
        ...(viewerProfile?.preferredRoles ?? []),
        ...(viewerProfile?.rolesWantToLearn ?? []),
      ])
    );

    const matchingRoles = team.rolesNeeded.filter((r) => viewerRoles.includes(r));
    const baseRoleScore =
      team.rolesNeeded.length > 0 ? matchingRoles.length / team.rolesNeeded.length : 0.5;

    // Match team's custom specializations against the viewer's profile
    const specMatch = matchCustomSpecializations(
      team.customSpecializations,
      viewerProfile,
      viewerParticipation
    );

    const combinedRoleSpecScore =
      team.customSpecializations && team.customSpecializations.length > 0
        ? 0.6 * baseRoleScore + 0.4 * specMatch.score
        : baseRoleScore;

    const { score: domainSim, shared: sharedDomains } = jaccardOverlap(
      viewerProfile?.interestTags ?? [],
      team.desiredDomains
    );

    const score = 0.45 * combinedRoleSpecScore + 0.3 * domainSim + 0.25 * tfidfSim;

    const reasons: string[] = [];
    if (specMatch.matchedOriginalLabels.length > 0) {
      reasons.push(
        `Matches your specialization in ${specMatch.matchedOriginalLabels.join(' & ')}`
      );
    }
    if (matchingRoles.length > 0) {
      reasons.push(`Looking for your ${matchingRoles.join(' / ')} role`);
    } else {
      reasons.push(`Open slots for ${team.rolesNeeded.join(' / ')}`);
    }
    if (sharedDomains.length > 0 && reasons.length < 3) {
      reasons.push(`Aligned on ${sharedDomains.slice(0, 2).join(' & ')}`);
    }
    if (reasons.length < 3) {
      reasons.push(`${team.targetSize - team.memberCount} of ${team.targetSize} roster slots open`);
    }

    const icebreakerDrafts = viewerProfile
      ? generateTechnicalIcebreakerDrafts({
          viewerProfile,
          targetTitle: team.name,
          targetProjects: team.projectIdea
            ? [{ title: team.projectIdea, description: team.pitch }]
            : [],
          sharedInterests: sharedDomains,
          complementaryRoles: [...matchingRoles, ...specMatch.matchedOriginalLabels],
        })
      : [];

    scored.push({
      score,
      card: {
        id: team.id,
        type: 'team',
        hackathonId: hackathon.id,
        title: team.name,
        subtitle: team.pitch,
        skills: team.desiredDomains,
        rolesOfferedOrNeeded: team.rolesNeeded,
        customSpecializations: team.customSpecializations,
        matchedSpecializations: specMatch.matchedOriginalLabels,
        featuredEvidence: team.projectIdea
          ? [{ title: 'Planned Build Idea', description: team.projectIdea }]
          : [],
        compatibilityReasons: reasons.slice(0, 3),
        remainingSlots: team.targetSize - team.memberCount,
        targetSize: team.targetSize,
        memberCount: team.memberCount,
        leaderUid: team.leaderId,
        availabilitySummary: team.availabilitySummary,
        workingStyle: team.workStyleTags,
        sharedInterests: sharedDomains,
        complementaryRoles: matchingRoles,
        icebreakerDrafts,
        featureBreakdown: {
          mode: 'team_candidate',
          primaryFitLabel: 'Role & Specialization Fit',
          interestOrRoleSim: Math.round(combinedRoleSpecScore * 100),
          tfidfThemeSim: Math.round(tfidfSim * 100),
          availabilitySim: 80,
          collabOrSkillSim: Math.round(domainSim * 100),
          coldStartRedistributed: Boolean(viewerProfile?.isFirstTimeHacker),
        },
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.card);
}
