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

interface PrecomputedTfIdfCorpus {
  docCount: number;
  corpusTokenSets: Set<string>[];
}

function precomputeTfIdfCorpus(corpusDocs: string[]): PrecomputedTfIdfCorpus {
  const corpusTokenSets = corpusDocs.map((doc) => new Set(tokenizeControlled(doc)));
  return {
    docCount: corpusTokenSets.length + 2,
    corpusTokenSets,
  };
}

function computeFastTfIdfCosine(
  tokensA: string[],
  countsA: Map<string, number>,
  setA: Set<string>,
  docB: string,
  precomputed: PrecomputedTfIdfCorpus
): number {
  if (tokensA.length === 0) return 0;
  const tokensB = tokenizeControlled(docB);
  if (tokensB.length === 0) return 0;

  const countsB = new Map<string, number>();
  const setB = new Set<string>();
  for (const t of tokensB) {
    countsB.set(t, (countsB.get(t) ?? 0) + 1);
    setB.add(t);
  }

  const vocab = new Set<string>([...setA, ...setB]);
  const { docCount, corpusTokenSets } = precomputed;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const term of vocab) {
    let df = (setA.has(term) ? 1 : 0) + (setB.has(term) ? 1 : 0);
    for (let i = 0; i < corpusTokenSets.length; i++) {
      if (corpusTokenSets[i].has(term)) df += 1;
    }
    const idf = Math.log(1 + docCount / (df || 1));
    const tfA = (countsA.get(term) ?? 0) / tokensA.length;
    const tfB = (countsB.get(term) ?? 0) / tokensB.length;
    const wA = tfA * idf;
    const wB = tfB * idf;
    dot += wA * wB;
    normA += wA * wA;
    normB += wB * wB;
  }

  if (normA === 0 || normB === 0) return 0;
  return Math.min(1, Math.max(0, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
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
  if (tokensA.length === 0) return 0;
  const countsA = new Map<string, number>();
  const setA = new Set<string>();
  for (const t of tokensA) {
    countsA.set(t, (countsA.get(t) ?? 0) + 1);
    setA.add(t);
  }
  const precomputed = precomputeTfIdfCorpus(corpusDocs);
  return computeFastTfIdfCosine(tokensA, countsA, setA, docB, precomputed);
}

const INTEREST_CANONICAL_MAP: Record<string, string> = {
  'ai/ml': 'ai_ml',
  'ai / ml': 'ai_ml',
  'applied ai/ml': 'ai_ml',
  'machine learning': 'ai_ml',
  'generative ai': 'ai_ml',
  'web development': 'web_dev',
  'web dev': 'web_dev',
  'developer tools': 'web_dev',
  'full stack': 'web_dev',
  'cybersecurity': 'cybersecurity',
  'cybersecurity / ctf': 'cybersecurity',
  'security/ctfs': 'cybersecurity',
  'security': 'cybersecurity',
  'robotics': 'robotics_iot',
  'robotics/iot': 'robotics_iot',
  'hardware / iot': 'robotics_iot',
  'embedded': 'robotics_iot',
  'data science': 'data_science',
  'data visualization': 'data_science',
  'analytics': 'data_science',
  'design': 'design_ux',
  'ui/ux': 'design_ux',
  'product & ui/ux': 'design_ux',
  'cloud/systems': 'cloud_systems',
  'systems/cloud': 'cloud_systems',
  'open-source systems': 'cloud_systems',
  'mobile apps': 'mobile',
  'mobile': 'mobile',
};

function canonicalizeInterestKey(tag: string): string {
  const norm = String(tag || '').toLowerCase().trim();
  return INTEREST_CANONICAL_MAP[norm] ?? norm;
}

function jaccardOverlap(listA: string[], listB: string[]): { score: number; shared: string[] } {
  const normA = new Map<string, string>();
  for (const item of listA) {
    const key = canonicalizeInterestKey(item);
    if (key && !normA.has(key)) normA.set(key, item.trim());
  }
  const normB = new Map<string, string>();
  for (const item of listB) {
    const key = canonicalizeInterestKey(item);
    if (key && !normB.has(key)) normB.set(key, item.trim());
  }
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
  const viewerRolesLabel =
    viewerProfile.preferredRoles.length > 0
      ? viewerProfile.preferredRoles.join('/')
      : 'flexible builder';
  const viewerSkillsSnippet =
    viewerProfile.skillTags.length > 0
      ? viewerProfile.skillTags.slice(0, 3).join(', ')
      : '';

  if (customPrompt) {
    drafts.push(`Re "${customPrompt}" — I can cover ${viewerRolesLabel} if we team up!`);
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
      viewerSkillsSnippet
        ? `I see you bring ${complementaryRoles.slice(0, 2).join(' + ')}. I have worked with ${viewerSkillsSnippet} and would love to collaborate.`
        : `I see you bring ${complementaryRoles.slice(0, 2).join(' + ')} — would love to team up and divide the build cleanly.`
    );
  }

  if (sharedInterests.length > 0) {
    drafts.push(
      `Both of us marked ${sharedInterests.slice(0, 2).join(' & ')}. What problem statement would you most want to ship in 24 hours?`
    );
  }

  if (drafts.length === 0) {
    const firstName = targetTitle.split(' ')[0] || 'there';
    drafts.push(
      viewerSkillsSnippet
        ? `Hi ${firstName}! Looking for focused collaborators for this hackathon — my main stack is ${viewerSkillsSnippet}.`
        : `Hi ${firstName}! Looking for teammates for this hackathon — want to compare ideas and see if our roles fit?`
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

const CORE_HACKATHON_ROLES = [
  'Frontend / UI',
  'Backend / APIs',
  'AI / ML',
  'Systems / Cloud',
  'Product & UI/UX',
  'Mobile',
  'Hardware / IoT',
  'Cybersecurity / CTF',
];

function normalizeControlledTag(tag: string): string {
  return String(tag || '').toLowerCase().trim();
}

function normalizeRoleBucket(role: string): string {
  const lower = role.trim().toLowerCase();
  if (/flexible|generalist|any/i.test(lower)) return 'Flexible';
  if (/front|react|ui\s*dev|web|next|tailwind/i.test(lower)) return 'Frontend / UI';
  if (/back|api|node|express|postgres|database|server|golang|rust/i.test(lower)) return 'Backend / APIs';
  if (/ai|ml|machine\s*learning|data|pytorch|llm|nlp|vision/i.test(lower)) return 'AI / ML';
  if (/design|ux|figma|product|pitch/i.test(lower)) return 'Product & UI/UX';
  if (/hardware|iot|embedded|robotics|arduino|ros|fpga/i.test(lower)) return 'Hardware / IoT';
  if (/cyber|ctf|security|crypto|pentest/i.test(lower)) return 'Cybersecurity / CTF';
  if (/mobile|android|ios|flutter|kotlin|react\s*native/i.test(lower)) return 'Mobile';
  if (/system|cloud|devops|docker|kubernetes|infra/i.test(lower)) return 'Systems / Cloud';
  return role.trim();
}

export function isHackathonEligibleForMatching(hackathon: Hackathon): boolean {
  if (typeof hackathon.maxTeamSize === 'number' && hackathon.maxTeamSize < 2) {
    return false;
  }
  return Boolean(
    hackathon.matchable &&
      hackathon.findTeammatesEligible !== false &&
      hackathon.registrationStatus !== 'CLOSED' &&
      hackathon.status !== 'completed' &&
      hackathon.status !== 'archived' &&
      hackathon.status !== 'registration_closed'
  );
}

export function computeTeamCombinedCapabilities(params: {
  viewerUid: string;
  viewerProfile?: Profile;
  hackathon: Hackathon;
  profiles?: Record<string, Profile>;
  allProfiles?: Profile[] | Record<string, Profile>;
  participations?: Participation[];
  teams?: Team[];
  allTeams?: Team[];
  memberships?: Membership[];
  allMemberships?: Membership[];
}): {
  activeTeam: Team | undefined;
  teamMemberUids: string[];
  memberCount: number;
  maxCapacity: number;
  combinedSkills: string[];
  combinedNormalizedSkills: Set<string>;
  combinedRoles: string[];
  combinedNormalizedRoles: Set<string>;
  combinedDomains: string[];
  missingRoles: string[];
  desiredCapabilities: string[];
} {
  const {
    viewerUid,
    viewerProfile,
    hackathon,
    participations = [],
  } = params;
  const teams = params.teams ?? params.allTeams ?? [];
  const memberships = params.memberships ?? params.allMemberships ?? [];
  const profiles: Record<string, Profile> = params.profiles
    ? { ...params.profiles }
    : Array.isArray(params.allProfiles)
      ? Object.fromEntries(params.allProfiles.map((p) => [p.uid, p]))
      : { ...(params.allProfiles ?? {}) };
  if (viewerProfile && viewerUid && !profiles[viewerUid]) {
    profiles[viewerUid] = viewerProfile;
  }

  const hackathonTeamIds = new Set(
    teams.filter((t) => t.hackathonId === hackathon.id).map((t) => t.id)
  );
  const viewerMembership = memberships.find(
    (m) =>
      m.uid === viewerUid &&
      m.status === 'active' &&
      (m.hackathonId === hackathon.id || (!m.hackathonId && hackathonTeamIds.has(m.teamId)))
  );
  const activeTeam = viewerMembership
    ? teams.find((t) => t.id === viewerMembership.teamId && t.hackathonId === hackathon.id)
    : teams.find(
        (t) => t.hackathonId === hackathon.id && t.leaderId === viewerUid && t.status !== 'locked'
      );

  const teamMemberUids = activeTeam
    ? Array.from(
        new Set([
          activeTeam.leaderId,
          ...memberships
            .filter((m) => m.teamId === activeTeam.id && m.status === 'active')
            .map((m) => m.uid),
        ])
      )
    : [viewerUid];

  const combinedSkillsList: string[] = [];
  const combinedNormalizedSkills = new Set<string>();
  const combinedRolesList: string[] = [];
  const combinedNormalizedRoles = new Set<string>();
  const combinedDomainsList: string[] = [];
  const combinedNormalizedDomains = new Set<string>();

  for (const memberUid of teamMemberUids) {
    const prof = profiles[memberUid];
    const part = participations.find(
      (p) => p.hackathonId === hackathon.id && p.uid === memberUid
    );
    const memberSkills = [
      ...(prof?.skillTags ?? []),
      ...(part?.skillsOffered ?? []),
    ];
    for (const sk of memberSkills) {
      const norm = normalizeControlledTag(sk);
      if (norm && !combinedNormalizedSkills.has(norm)) {
        combinedNormalizedSkills.add(norm);
        combinedSkillsList.push(sk.trim());
      }
    }

    const memberRoles = [
      ...(prof?.preferredRoles ?? []),
      ...(part?.desiredRoles ?? []),
    ];
    for (const r of memberRoles) {
      const bucket = normalizeRoleBucket(r);
      if (bucket && !combinedNormalizedRoles.has(bucket.toLowerCase())) {
        combinedNormalizedRoles.add(bucket.toLowerCase());
        combinedRolesList.push(bucket);
      }
    }

    const memberDomains = [
      ...(prof?.interestTags ?? []),
      ...(prof?.projectDomains ?? []),
    ];
    for (const d of memberDomains) {
      const normD = normalizeControlledTag(d);
      if (normD && !combinedNormalizedDomains.has(normD)) {
        combinedNormalizedDomains.add(normD);
        combinedDomainsList.push(d.trim());
      }
    }
  }

  // Determine missing roles & desired capabilities for the hackathon + team
  const targetRoles = new Set<string>([
    'Frontend / UI',
    'Backend / APIs',
    'AI / ML',
    'Product & UI/UX',
  ]);
  for (const theme of hackathon.themes ?? []) {
    if (/ai|ml|data|llm/i.test(theme)) targetRoles.add('AI / ML');
    if (/iot|hardware|robot/i.test(theme)) targetRoles.add('Hardware / IoT');
    if (/cyber|ctf|security/i.test(theme)) targetRoles.add('Cybersecurity / CTF');
    if (/system|cloud|infra/i.test(theme)) targetRoles.add('Systems / Cloud');
    if (/mobile|app/i.test(theme)) targetRoles.add('Mobile');
  }
  if (activeTeam) {
    for (const needed of activeTeam.rolesNeeded ?? []) {
      targetRoles.add(normalizeRoleBucket(needed));
    }
  }

  const missingRoles = Array.from(targetRoles).filter(
    (r) => !combinedNormalizedRoles.has(r.toLowerCase())
  );

  const desiredCapabilities = Array.from(
    new Set([
      ...missingRoles,
      ...(activeTeam?.customSpecializations ?? []),
      ...(activeTeam?.rolesNeeded ?? []).filter(
        (r) => !combinedNormalizedRoles.has(normalizeRoleBucket(r).toLowerCase())
      ),
    ])
  );

  const eventMax =
    hackathon.maxTeamSize && hackathon.maxTeamSize > 0
      ? Math.min(4, hackathon.maxTeamSize)
      : 4;
  const maxCapacity = activeTeam
    ? Math.min(eventMax, activeTeam.targetSize || eventMax)
    : eventMax;

  return {
    activeTeam,
    teamMemberUids,
    memberCount: activeTeam ? Math.max(activeTeam.memberCount, teamMemberUids.length) : 1,
    maxCapacity,
    combinedSkills: combinedSkillsList,
    combinedNormalizedSkills,
    combinedRoles: combinedRolesList,
    combinedNormalizedRoles,
    combinedDomains: combinedDomainsList,
    missingRoles:
      missingRoles.length > 0
        ? missingRoles
        : CORE_HACKATHON_ROLES.filter((r) => !combinedNormalizedRoles.has(r.toLowerCase())).slice(0, 3),
    desiredCapabilities,
  };
}

function getEligibleCandidateUsers(params: {
  viewerUid: string;
  hackathon: Hackathon;
  users: User[];
  profiles: Record<string, Profile>;
  participations: Participation[];
  teams?: Team[];
  memberships: Membership[];
  interests: Interest[];
  blocks: BlockRecord[];
  activeCircleTags?: string[];
  roleFilter?: string;
  onlyFirstTimeHackers?: boolean;
  searchQuery?: string;
}): {
  user: User;
  profile: Profile;
  participation?: Participation;
  candidateTeam?: Team;
}[] {
  const {
    viewerUid,
    hackathon,
    users,
    profiles,
    participations,
    teams = [],
    memberships,
    interests,
    blocks,
    activeCircleTags,
    roleFilter,
    onlyFirstTimeHackers,
    searchQuery,
  } = params;

  if (!isHackathonEligibleForMatching(hackathon)) return [];

  const maxAllowedSize = Math.min(
    4,
    hackathon.maxTeamSize && hackathon.maxTeamSize > 0 ? hackathon.maxTeamSize : 4
  );

  const teamById = new Map<string, Team>();
  for (const t of teams) {
    if (t.hackathonId === hackathon.id) {
      teamById.set(t.id, t);
    }
  }

  // Check if viewer is already in an active team for this hackathon
  const viewerMembership = memberships.find(
    (m) =>
      m.uid === viewerUid &&
      m.status === 'active' &&
      (m.hackathonId === hackathon.id || (!m.hackathonId && teamById.has(m.teamId)))
  );
  const viewerTeam = viewerMembership
    ? teamById.get(viewerMembership.teamId)
    : teams.find(
        (t) => t.hackathonId === hackathon.id && t.leaderId === viewerUid && t.status !== 'locked'
      );

  // If viewer's team is already full or locked, no further recruitment candidates are needed
  if (
    viewerTeam &&
    (viewerTeam.status === 'full' ||
      viewerTeam.status === 'locked' ||
      viewerTeam.memberCount >= Math.min(maxAllowedSize, viewerTeam.targetSize || maxAllowedSize))
  ) {
    return [];
  }

  const viewerTeammateUids = new Set<string>(
    viewerTeam
      ? [
          viewerTeam.leaderId,
          ...memberships
            .filter((m) => m.teamId === viewerTeam.id && m.status === 'active')
            .map((m) => m.uid),
        ]
      : [viewerUid]
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

  const participationByUid = new Map<string, Participation>();
  for (const p of participations) {
    if (p.hackathonId === hackathon.id) {
      participationByUid.set(p.uid, p);
    }
  }

  const activeMembershipByUid = new Map<string, Membership>();
  for (const m of memberships) {
    if (
      m.status === 'active' &&
      (m.hackathonId === hackathon.id || (!m.hackathonId && teamById.has(m.teamId)))
    ) {
      activeMembershipByUid.set(m.uid, m);
    }
  }

  const normQuery = searchQuery?.trim().toLowerCase() ?? '';
  const results: {
    user: User;
    profile: Profile;
    participation?: Participation;
    candidateTeam?: Team;
  }[] = [];

  for (const candidateUser of users) {
    const uid = candidateUser.uid;
    if (uid === viewerUid) continue;
    if (viewerTeammateUids.has(uid)) continue;
    if (candidateUser.accountStatus !== 'active') continue;
    if (candidateUser.verificationStatus === 'unverified') continue;
    if (candidateUser.privacyPreferences?.profileVisible === false) continue;
    if (blockedUids.has(uid)) continue;
    if (swipedUserIds.has(uid)) continue;

    const candidateProfile = profiles[uid];
    if (!candidateProfile || candidateProfile.visibility !== 'public_verified_students') {
      continue;
    }

    const part = participationByUid.get(uid);
    if (part && part.discoverable === false) continue;

    // Check candidate's active team membership in this hackathon
    const candidateMembership = activeMembershipByUid.get(uid);
    const candidateTeam = candidateMembership
      ? teamById.get(candidateMembership.teamId)
      : undefined;

    if (viewerTeam) {
      // Viewer is already on a team -> can only recruit unassigned students (a student cannot belong to 2 teams)
      if (candidateMembership) continue;
    } else if (candidateMembership) {
      // Viewer has no team, candidate is on a team -> only show if candidate's team is open and has capacity < maxAllowedSize
      if (!candidateTeam) continue;
      const cap = Math.min(maxAllowedSize, candidateTeam.targetSize || maxAllowedSize);
      if (candidateTeam.status !== 'open' || candidateTeam.memberCount >= cap) {
        continue;
      }
    }

    if (onlyFirstTimeHackers && !candidateProfile.isFirstTimeHacker) continue;

    if (roleFilter && roleFilter !== 'ALL') {
      const hasRole =
        (part?.desiredRoles ?? []).includes(roleFilter) ||
        candidateProfile.preferredRoles.includes(roleFilter) ||
        candidateProfile.rolesWantToLearn.includes(roleFilter) ||
        candidateProfile.preferredRoles.some(
          (r) => normalizeRoleBucket(r).toLowerCase() === normalizeRoleBucket(roleFilter).toLowerCase()
        );
      if (!hasRole) continue;
    }

    if (activeCircleTags && activeCircleTags.length > 0) {
      const inCircle =
        candidateProfile.interestTags.some((t) => activeCircleTags.includes(t)) ||
        candidateProfile.projectDomains.some((t) => activeCircleTags.includes(t));
      if (!inCircle) continue;
    }

    if (normQuery) {
      const hay = [
        candidateUser.displayName,
        candidateProfile.headline,
        candidateProfile.about,
        candidateProfile.skillTags.join(' '),
        candidateProfile.interestTags.join(' '),
        candidateProfile.projectDomains.join(' '),
        candidateProfile.topicsToExplore.join(' '),
        candidateProfile.preferredRoles.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(normQuery)) continue;
    }

    results.push({
      user: candidateUser,
      profile: candidateProfile,
      participation: part,
      candidateTeam,
    });
  }

  return results;
}

export function countEligiblePeopleForHackathon(params: {
  viewerUid: string;
  hackathon: Hackathon;
  users: User[];
  profiles: Record<string, Profile>;
  participations: Participation[];
  teams?: Team[];
  memberships: Membership[];
  interests: Interest[];
  blocks: BlockRecord[];
  activeCircleTags?: string[];
  roleFilter?: string;
  onlyFirstTimeHackers?: boolean;
  searchQuery?: string;
}): number {
  return getEligibleCandidateUsers(params).length;
}

/**
 * Fast O(N) Pass-1 count of eligible Teams without running TF-IDF when on the People tab.
 */
export function countEligibleTeamsForHackathon(params: {
  viewerUid: string;
  hackathon: Hackathon;
  teams: Team[];
  interests: Interest[];
  blocks: BlockRecord[];
  activeCircleTags?: string[];
  roleFilter?: string;
  searchQuery?: string;
}): number {
  const {
    viewerUid,
    hackathon,
    teams,
    interests,
    blocks,
    activeCircleTags,
    roleFilter,
    searchQuery,
  } = params;

  if (!isHackathonEligibleForMatching(hackathon)) return 0;

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

  const normQuery = searchQuery?.trim().toLowerCase() ?? '';

  let count = 0;
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    if (team.hackathonId !== hackathon.id) continue;
    if (team.status !== 'open') continue;
    if (team.memberCount >= team.targetSize) continue;
    if (blockedUids.has(team.leaderId)) continue;
    if (swipedTeamIds.has(team.id)) continue;

    if (roleFilter && roleFilter !== 'ALL') {
      const inStandardRole = team.rolesNeeded.includes(roleFilter);
      const inCustomSpec = (team.customSpecializations ?? []).some(
        (s) => s.toLowerCase() === roleFilter.toLowerCase()
      );
      if (!inStandardRole && !inCustomSpec) continue;
    }

    if (activeCircleTags && activeCircleTags.length > 0) {
      const inCircle = team.desiredDomains.some((d) => activeCircleTags.includes(d));
      if (!inCircle) continue;
    }

    if (normQuery) {
      const hay = `${team.name} ${team.pitch} ${team.rolesNeeded.join(' ')} ${(team.customSpecializations ?? []).join(' ')}`.toLowerCase();
      if (!hay.includes(normQuery)) continue;
    }

    count += 1;
  }

  return count;
}

/**
 * Computes regularized past swipe affinity (0..1) from the viewer's prior student swipes.
 */
function computePastSwipeAffinity(params: {
  viewerUid: string;
  candidateProfile: Profile;
  candidateSkills: string[];
  candidateRoles: string[];
  profiles: Record<string, Profile>;
  interests: Interest[];
}): {
  hasSwipeHistory: boolean;
  score: number;
  matchedLikedTag: string | null;
} {
  const { viewerUid, candidateProfile, candidateSkills, candidateRoles, profiles, interests } =
    params;

  const viewerUserSwipes = interests.filter(
    (i) => i.fromUid === viewerUid && i.targetType === 'user'
  );

  if (viewerUserSwipes.length === 0) {
    return { hasSwipeHistory: false, score: 0.5, matchedLikedTag: null };
  }

  const tagScoreMap = new Map<string, { pos: number; neg: number; label: string }>();
  const recordSignal = (rawTag: string, isPositive: boolean) => {
    const norm = normalizeControlledTag(rawTag);
    if (!norm) return;
    const prev = tagScoreMap.get(norm) ?? { pos: 0, neg: 0, label: rawTag.trim() };
    if (isPositive) prev.pos += 1;
    else prev.neg += 1;
    tagScoreMap.set(norm, prev);
  };

  for (const sw of viewerUserSwipes) {
    const targetProf = profiles[sw.targetId];
    if (!targetProf) continue;
    const isPos = sw.decision === 'interested';
    for (const sk of targetProf.skillTags) recordSignal(sk, isPos);
    for (const dom of [...targetProf.interestTags, ...targetProf.projectDomains]) {
      recordSignal(dom, isPos);
    }
    for (const role of targetProf.preferredRoles) recordSignal(role, isPos);
  }

  const candidateSignals = [
    ...candidateSkills,
    ...candidateProfile.interestTags,
    ...candidateProfile.projectDomains,
    ...candidateRoles,
  ];

  let netSignal = 0;
  let signalMatches = 0;
  let bestLikedLabel: string | null = null;
  let bestLikedWeight = 0;

  for (const sig of candidateSignals) {
    const norm = normalizeControlledTag(sig);
    const entry = tagScoreMap.get(norm);
    if (!entry) continue;
    signalMatches += 1;
    // Bayesian smoothed affinity per tag: (pos - 0.6 * neg) / (pos + neg + 2)
    const tagAffinity = (entry.pos - 0.6 * entry.neg) / (entry.pos + entry.neg + 2);
    netSignal += tagAffinity;
    if (entry.pos > entry.neg && tagAffinity > bestLikedWeight) {
      bestLikedWeight = tagAffinity;
      bestLikedLabel = entry.label;
    }
  }

  if (signalMatches === 0) {
    return { hasSwipeHistory: true, score: 0.5, matchedLikedTag: null };
  }

  const avgSignal = netSignal / Math.sqrt(signalMatches);
  // Clamp smoothly into [0.15, 0.95] around neutral 0.5
  const clamped = Math.max(0.15, Math.min(0.95, 0.5 + avgSignal * 0.45));
  return {
    hasSwipeHistory: true,
    score: clamped,
    matchedLikedTag: bestLikedLabel,
  };
}

/**
 * Explainable Student-Only Recommendation Engine (Part C):
 * - 45% Skill Complementarity (evaluated against the combined skills & roles of the viewer's active team in the hackathon, or the viewer solo)
 * - 35% Shared Interests & Project Themes (Jaccard + TF-IDF across interests, project domains, topics to explore, past projects, and hackathon themes)
 * - 20% Past Swipe Behavior (regularized affinity from past right/left swipes, with proportional cold-start redistribution when viewer has 0 swipes)
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
  searchQuery?: string;
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
    searchQuery,
  } = params;

  const eligibleCandidates = getEligibleCandidateUsers({
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
    searchQuery,
  });

  if (eligibleCandidates.length === 0) {
    return { cards: [], internalScores: new Map() };
  }

  const viewerProfile = profiles[viewerUid];
  const viewerParticipation = participations.find(
    (p) => p.hackathonId === hackathon.id && p.uid === viewerUid
  );

  // Compute combined team capabilities (across ALL active members if viewer is in a team!)
  const teamCaps = computeTeamCombinedCapabilities({
    viewerUid,
    hackathon,
    profiles,
    participations,
    teams,
    memberships,
  });
  const viewerTeam = teamCaps.activeTeam;
  const isTeamContext = teamCaps.teamMemberUids.length > 1 || Boolean(viewerTeam);

  const buildProfileAbstract = (prof: Profile, part?: Participation): string => {
    const projText = prof.featuredProjects
      .map((p) => `${p.title} ${p.description} ${p.tags.join(' ')}`)
      .join(' ');
    return [
      prof.headline,
      prof.about,
      (prof.skillTags ?? []).join(' '),
      (prof.interestTags ?? []).join(' '),
      (prof.projectDomains ?? []).join(' '),
      (prof.topicsToExplore ?? []).join(' '),
      projText,
      part ? (part.skillsOffered ?? []).join(' ') : '',
    ].join(' ');
  };

  const candidateAbstracts = eligibleCandidates.map((c) =>
    buildProfileAbstract(c.profile, c.participation)
  );
  const precomputedCorpus = precomputeTfIdfCorpus(candidateAbstracts);

  // Build combined viewer/team abstract for TF-IDF theme similarity
  const combinedMemberAbstracts = teamCaps.teamMemberUids
    .map((uid) => {
      const p = profiles[uid];
      const part = participations.find((x) => x.hackathonId === hackathon.id && x.uid === uid);
      return p ? buildProfileAbstract(p, part) : '';
    })
    .filter(Boolean)
    .join(' ');

  const viewerAbstract = [
    combinedMemberAbstracts,
    viewerTeam
      ? `${viewerTeam.name} ${viewerTeam.pitch ?? ''} ${viewerTeam.projectIdea ?? ''} ${(viewerTeam.desiredDomains ?? []).join(' ')} ${(viewerTeam.rolesNeeded ?? []).join(' ')} ${(viewerTeam.customSpecializations ?? []).join(' ')}`
      : '',
    (hackathon.themes ?? []).join(' '),
  ]
    .filter(Boolean)
    .join(' ');

  const viewerTokens = tokenizeControlled(viewerAbstract);
  const viewerCounts = new Map<string, number>();
  const viewerSet = new Set<string>();
  for (const t of viewerTokens) {
    viewerCounts.set(t, (viewerCounts.get(t) ?? 0) + 1);
    viewerSet.add(t);
  }

  // Explicit viewer interests (excluding hackathon themes so we know whether viewer provided preferences)
  const viewerExplicitInterests = Array.from(
    new Set([
      ...teamCaps.teamMemberUids.flatMap((uid) => [
        ...(profiles[uid]?.interestTags ?? []),
        ...(profiles[uid]?.projectDomains ?? []),
        ...(profiles[uid]?.topicsToExplore ?? []),
      ]),
      ...(viewerTeam?.desiredDomains ?? []),
    ])
  );

  // Combined interests & domains of the viewer / viewer's team + hackathon themes
  const viewerCombinedInterests = Array.from(
    new Set([
      ...viewerExplicitInterests,
      ...(hackathon.themes ?? []),
    ])
  );

  const hasViewerSkillsOrRoles =
    teamCaps.combinedSkills.length > 0 ||
    teamCaps.combinedRoles.some((r) => r.toLowerCase() !== 'flexible');
  const hasViewerInterests = viewerExplicitInterests.length > 0;

  const internalScores = new Map<string, number>();
  const scoredCards: { card: CandidateCard; score: number }[] = [];

  for (let idx = 0; idx < eligibleCandidates.length; idx++) {
    const { user, profile: prof, participation: part, candidateTeam } = eligibleCandidates[idx];
    const candidateAbstract = candidateAbstracts[idx];

    const candidateSkills = Array.from(
      new Set([...(part?.skillsOffered ?? []), ...prof.skillTags])
    );
    const candidateOfferedRoles = Array.from(
      new Set([...(part?.desiredRoles ?? []), ...prof.preferredRoles])
    );

    // =========================================================================
    // FACTOR A: SKILL COMPLEMENTARITY (45% base)
    // Evaluated against the combined skills and roles of the viewer's team (or viewer solo).
    // Never treats missing information as a negative preference.
    // =========================================================================
    const complementarySkills = candidateSkills.filter(
      (sk) => !teamCaps.combinedNormalizedSkills.has(normalizeControlledTag(sk))
    );
    const complementaryRoles = candidateOfferedRoles.filter((r) => {
      const bucket = normalizeRoleBucket(r).toLowerCase();
      if (bucket === 'flexible') return false;
      return (
        !teamCaps.combinedNormalizedRoles.has(bucket) ||
        teamCaps.missingRoles.some((mr) => mr.toLowerCase() === bucket)
      );
    });

    const customSpecMatch = matchCustomSpecializations(
      viewerTeam?.customSpecializations,
      prof,
      part
    );

    // How many of the candidate's complementary skills align with the hackathon themes or missing roles?
    const hackathonThemeSet = new Set(
      hackathon.themes.map((t) => normalizeControlledTag(t))
    );
    const themeAlignedNewSkills = complementarySkills.filter((sk) =>
      hackathonThemeSet.has(normalizeControlledTag(sk))
    );

    const newSkillRatio =
      candidateSkills.length > 0
        ? Math.min(1, complementarySkills.length / Math.min(3, Math.max(1, candidateSkills.length)))
        : 0.5; // Neutral baseline when candidate has not added skills yet

    const missingRoleFillRatio =
      candidateOfferedRoles.length === 0
        ? 0.5 // Neutral baseline when candidate has not selected a role yet
        : teamCaps.missingRoles.length > 0
        ? Math.min(
            1,
            complementaryRoles.length / Math.min(2, teamCaps.missingRoles.length)
          )
        : complementaryRoles.length > 0
        ? 0.75
        : 0.5;

    const themeSkillBonus = themeAlignedNewSkills.length > 0 ? 0.15 : 0;

    let skillComplementarityScore = Math.min(
      1,
      0.5 * newSkillRatio + 0.4 * missingRoleFillRatio + 0.1 * customSpecMatch.score + themeSkillBonus
    );
    if (
      viewerTeam?.customSpecializations &&
      viewerTeam.customSpecializations.length > 0 &&
      customSpecMatch.score > 0
    ) {
      skillComplementarityScore = Math.min(
        1,
        0.7 * skillComplementarityScore + 0.3 * customSpecMatch.score
      );
    }

    // =========================================================================
    // FACTOR B: SHARED INTERESTS & PROJECT THEMES (35% base)
    // =========================================================================
    const candidateInterestsAndDomains = Array.from(
      new Set([
        ...prof.interestTags,
        ...prof.projectDomains,
        ...prof.topicsToExplore,
      ])
    );

    const { score: interestSim, shared: sharedInterests } = jaccardOverlap(
      viewerCombinedInterests,
      candidateInterestsAndDomains
    );

    const tfidfSim = computeFastTfIdfCosine(
      viewerTokens,
      viewerCounts,
      viewerSet,
      candidateAbstract,
      precomputedCorpus
    );

    // Neutral fallback if neither side supplied interests or rich text yet
    const hasCandidateInterestData =
      candidateInterestsAndDomains.length > 0 || candidateAbstract.trim().length > 0;
    const sharedInterestsScore =
      !hasCandidateInterestData || viewerCombinedInterests.length === 0
        ? 0.5
        : Math.min(
            1,
            0.6 * interestSim + 0.4 * Math.min(1, tfidfSim * 2.2)
          );

    // =========================================================================
    // FACTOR C: PAST SWIPE BEHAVIOR (20% base)
    // =========================================================================
    const swipeAffinity = computePastSwipeAffinity({
      viewerUid,
      candidateProfile: prof,
      candidateSkills,
      candidateRoles: candidateOfferedRoles,
      profiles,
      interests,
    });

    // Dynamic weight redistribution when inputs are missing (cold-start or sparse quick profile)
    let skillWeight = 0.45;
    let interestWeight = 0.35;
    let swipeWeight = swipeAffinity.hasSwipeHistory ? 0.20 : 0;

    if (!hasViewerSkillsOrRoles && hasViewerInterests) {
      // Viewer only provided interests: lean more heavily on shared interests without penalizing skills
      skillWeight = 0.25;
      interestWeight = 0.55;
    } else if (hasViewerSkillsOrRoles && !hasViewerInterests) {
      // Viewer only provided skills/roles: lean more heavily on complementarity
      skillWeight = 0.58;
      interestWeight = 0.22;
    } else if (!hasViewerSkillsOrRoles && !hasViewerInterests) {
      // Skipped onboarding: balanced neutral weights
      skillWeight = 0.45;
      interestWeight = 0.35;
    }

    const coldStartRedistributed =
      !swipeAffinity.hasSwipeHistory ||
      !hasViewerSkillsOrRoles ||
      !hasViewerInterests;

    const activeWeightSum = skillWeight + interestWeight + swipeWeight;
    const normSkillW = skillWeight / activeWeightSum;
    const normInterestW = interestWeight / activeWeightSum;
    const normSwipeW = swipeWeight / activeWeightSum;

    const totalScore =
      normSkillW * skillComplementarityScore +
      normInterestW * sharedInterestsScore +
      normSwipeW * swipeAffinity.score;

    // =========================================================================
    // EXPLAINABLE RECOMMENDATION REASONS (Grounded, human-readable)
    // =========================================================================
    const reasons: string[] = [];

    if (customSpecMatch.matchedOriginalLabels.length > 0) {
      reasons.push(
        `Complements your team specialization: ${customSpecMatch.matchedOriginalLabels.slice(0, 2).join(', ')}`
      );
    }

    if (complementarySkills.length > 0) {
      const topNewSkills = complementarySkills.slice(0, 3).join(', ');
      reasons.push(
        isTeamContext
          ? `Complements your team: ${topNewSkills}`
          : hasViewerSkillsOrRoles
          ? `Complements your skills: ${topNewSkills}`
          : `Skills: ${topNewSkills}`
      );
    } else if (complementaryRoles.length > 0) {
      reasons.push(
        isTeamContext
          ? `Fills needed ${complementaryRoles.slice(0, 2).join(' & ')} role on your team`
          : `Brings ${complementaryRoles.slice(0, 2).join(' & ')} role coverage`
      );
    }

    if (sharedInterests.length > 0) {
      reasons.push(
        hasViewerInterests
          ? `Both interested in ${sharedInterests.slice(0, 2).join(' & ')}`
          : `Interested in ${sharedInterests.slice(0, 2).join(' & ')}`
      );
    } else if (prof.interestTags.length > 0 && reasons.length < 2) {
      reasons.push(`Interested in ${prof.interestTags.slice(0, 2).join(' & ')}`);
    } else if (prof.projectDomains.length > 0) {
      reasons.push(`Worked on ${prof.projectDomains.slice(0, 2).join(' & ')} projects`);
    }

    if (prof.featuredProjects.length > 0 && reasons.length < 3) {
      reasons.push(`Built "${prof.featuredProjects[0].title}"`);
    } else if (swipeAffinity.matchedLikedTag && reasons.length < 3) {
      reasons.push(`Matches your interest in ${swipeAffinity.matchedLikedTag} builders`);
    }

    if (candidateTeam && reasons.length < 3) {
      const cap = Math.min(4, candidateTeam.targetSize || 4);
      reasons.push(
        `Building with ${candidateTeam.name} (${candidateTeam.memberCount}/${cap} members)`
      );
    }

    if (reasons.length === 0) {
      if (candidateOfferedRoles.length > 0) {
        reasons.push(`Preferred role: ${candidateOfferedRoles[0]}`);
      } else {
        reasons.push(`Verified PESU student on ${user.campus}`);
      }
    }

    const viewerAvail = viewerParticipation?.availabilityWindows ?? [];
    const candidateAvail = part?.availabilityWindows ?? [];
    const { score: availSim } = jaccardOverlap(viewerAvail, candidateAvail);

    const icebreakerDrafts = viewerProfile
      ? generateTechnicalIcebreakerDrafts({
          viewerProfile,
          targetTitle: user.displayName,
          targetProjects: prof.featuredProjects,
          sharedInterests,
          complementaryRoles: [
            ...complementaryRoles,
            ...complementarySkills.slice(0, 2),
          ],
          customPrompt: prof.icebreakerPrompt,
        })
      : [];

    internalScores.set(user.uid, totalScore);

    const subtitlePrefix =
      prof.headline?.trim() ||
      candidateOfferedRoles[0] ||
      user.program ||
      'PESU Student';

    scoredCards.push({
      score: totalScore,
      card: {
        id: user.uid,
        type: 'person',
        hackathonId: hackathon.id,
        title: user.displayName,
        subtitle: `${subtitlePrefix} · ${user.campus}`,
        campus: user.campus,
        isFirstTimeHacker: prof.isFirstTimeHacker,
        skills: candidateSkills.slice(0, 8),
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
        availabilitySummary:
          candidateAvail.length > 0
            ? candidateAvail.join(' · ')
            : prof.workingStyleTags.slice(0, 2).join(' · ') || 'Flexible schedule',
        commitmentLevel: part?.commitmentLevel,
        workingStyle:
          part && part.workPreferences.length > 0
            ? part.workPreferences
            : prof.workingStyleTags,
        sharedInterests,
        complementaryRoles:
          complementaryRoles.length > 0 ? complementaryRoles : complementarySkills.slice(0, 2),
        icebreakerDrafts,
        featureBreakdown: {
          mode: isTeamContext ? 'team_candidate' : 'peer',
          primaryFitLabel:
            skillComplementarityScore >= sharedInterestsScore
              ? isTeamContext
                ? 'Team Skill Complementarity'
                : 'Skill & Role Complementarity'
              : 'Shared Themes & Project Fit',
          interestOrRoleSim: Math.round(skillComplementarityScore * 100),
          tfidfThemeSim: Math.round(sharedInterestsScore * 100),
          availabilitySim: Math.round((viewerAvail.length > 0 ? availSim : 0.75) * 100),
          collabOrSkillSim: Math.round(swipeAffinity.score * 100),
          coldStartRedistributed,
          skillComplementarity: Math.round(skillComplementarityScore * 100),
          skillComplementarityScore: Math.round(skillComplementarityScore * 100),
          sharedInterestsScore: Math.round(sharedInterestsScore * 100),
          pastSwipeAffinityScore: Math.round(swipeAffinity.score * 100),
          totalScore: Math.round(totalScore * 100),
          evaluatedAgainstTeamId: viewerTeam?.id,
          evaluatedAgainstMemberCount: teamCaps.teamMemberUids.length,
          complementarySkills: complementarySkills.slice(0, 5),
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

export function rankStudentsForHackathon(params: {
  viewerUid?: string;
  currentUser?: User;
  currentProfile?: Profile;
  hackathon: Hackathon;
  users?: User[];
  allUsers?: User[];
  profiles?: Record<string, Profile>;
  allProfiles?: Record<string, Profile>;
  participations: Participation[];
  teams: Team[];
  memberships: Membership[];
  interests?: Interest[];
  existingInterests?: Interest[];
  blocks: BlockRecord[];
  activeCircleTags?: string[];
  roleFilter?: string;
  onlyFirstTimeHackers?: boolean;
  searchQuery?: string;
}): Array<
  CandidateCard & {
    overallScore: number;
    reasons: string[];
  }
> & {
  cards: CandidateCard[];
  internalScores: Map<string, number>;
} {
  const viewerUid = params.viewerUid ?? params.currentUser?.uid ?? '';
  const users = params.users ?? params.allUsers ?? [];
  const baseProfiles = params.profiles ?? params.allProfiles ?? {};
  const profiles: Record<string, Profile> =
    params.currentProfile && viewerUid && !baseProfiles[viewerUid]
      ? { ...baseProfiles, [viewerUid]: params.currentProfile }
      : baseProfiles;
  const interests = params.interests ?? params.existingInterests ?? [];

  const { cards, internalScores } = rankPeopleForHackathon({
    viewerUid,
    hackathon: params.hackathon,
    users,
    profiles,
    participations: params.participations,
    teams: params.teams,
    memberships: params.memberships,
    interests,
    blocks: params.blocks,
    activeCircleTags: params.activeCircleTags,
    roleFilter: params.roleFilter,
    onlyFirstTimeHackers: params.onlyFirstTimeHackers,
    searchQuery: params.searchQuery,
  });

  const enriched = cards.map((card) => ({
    ...card,
    overallScore: internalScores.get(card.id) ?? card.featureBreakdown.totalScore ?? 0,
    reasons: card.compatibilityReasons.slice(0, 2),
  }));

  return Object.assign(enriched, {
    cards,
    internalScores,
  });
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
  searchQuery?: string;
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
    searchQuery,
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

  const normQuery = searchQuery?.trim().toLowerCase() ?? '';

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

    if (normQuery) {
      const hay = `${team.name} ${team.pitch} ${team.rolesNeeded.join(' ')} ${(team.customSpecializations ?? []).join(' ')}`.toLowerCase();
      if (!hay.includes(normQuery)) return false;
    }

    return true;
  });

  const teamDocs = eligibleTeams.map(
    (t) =>
      `${t.name} ${t.pitch} ${t.projectIdea ?? ''} ${t.desiredDomains.join(' ')} ${(
        t.customSpecializations ?? []
      ).join(' ')}`
  );
  const precomputedCorpus = precomputeTfIdfCorpus(teamDocs);

  const viewerDoc = viewerProfile
    ? `${viewerProfile.headline} ${viewerProfile.about} ${viewerProfile.skillTags.join(' ')} ${viewerProfile.interestTags.join(' ')} ${viewerProfile.projectDomains.join(' ')}`
    : hackathon.themes.join(' ');

  const viewerTokens = tokenizeControlled(viewerDoc);
  const viewerCounts = new Map<string, number>();
  const viewerSet = new Set<string>();
  for (const t of viewerTokens) {
    viewerCounts.set(t, (viewerCounts.get(t) ?? 0) + 1);
    viewerSet.add(t);
  }

  const scored: { card: CandidateCard; score: number }[] = [];

  for (let idx = 0; idx < eligibleTeams.length; idx++) {
    const team = eligibleTeams[idx];
    const teamDoc = teamDocs[idx];
    const tfidfSim = computeFastTfIdfCosine(
      viewerTokens,
      viewerCounts,
      viewerSet,
      teamDoc,
      precomputedCorpus
    );

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

