import {
  Hackathon,
  Interest,
  Participation,
  Profile,
  User,
} from '../types/domain';

export const DEV_TEST_HACKATHON_ID = 'dev_test_hack_quackhack_2026';

/**
 * Strictly gates development-only testing fixtures so synthetic students and
 * synthetic events NEVER leak to real students or production builds.
 */
export function isDevTestingEnvironment(): boolean {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> })?.env;
    if (metaEnv && typeof metaEnv.DEV === 'boolean') {
      return metaEnv.DEV && metaEnv.MODE !== 'production';
    }
  } catch {
    // Non-Vite runtime (e.g. Node unit tests)
  }
  return (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV !== 'production' &&
    process.env?.QUACKATHON_TEST_MODE === 'true'
  );
}

function addDaysYmd(base: Date, days: number): string {
  const dt = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days)
  );
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface DevTestingFixtureSet {
  hackathon: Hackathon;
  users: User[];
  profiles: Record<string, Profile>;
  participations: Participation[];
  incomingInterests: Interest[];
  /** UIDs of synthetic students who already swiped right on the current user */
  preMatchedUids: string[];
}

/**
 * Generates an isolated development-only sandbox dataset:
 * - 1 synthetic upcoming matchable hackathon (`QuackHack Dev Sandbox 2026`)
 * - 8 clearly labeled synthetic student profiles with realistic, complementary skills & roles
 * - 3 synthetic students who have already swiped right on `viewerUid` so mutual matches,
 *   shortlist updates, automatic 2-person team creation, and unanimous 3rd-member voting
 *   can all be tested locally without writing to production PostgreSQL.
 */
export function createDevTestingFixtures(
  viewerUid: string,
  referenceDate: Date = new Date()
): DevTestingFixtureSet {
  const startAt = addDaysYmd(referenceDate, 14);
  const endAt = addDaysYmd(referenceDate, 15);
  const registrationDeadline = addDaysYmd(referenceDate, 10);
  const nowIso = referenceDate.toISOString();

  const hackathon: Hackathon = {
    id: DEV_TEST_HACKATHON_ID,
    name: 'QuackHack Dev Sandbox (Test Event)',
    organizer: 'PESU Development Sandbox',
    eventType: 'hackathon',
    matchable: true,
    isHackathon: true,
    teamParticipationVerified: true,
    publicSourceVerified: true,
    findTeammatesEligible: true,
    registrationStatus: 'OPEN',
    registrationStatusDetail: 'open_confirmed',
    registrationStatusLabel: 'Dev Test Event · Open',
    venue: {
      campus: 'RR Campus',
      name: 'Dev Sandbox Auditorium',
    },
    format: 'onsite',
    startAt,
    datePrecision: 'date_only',
    endAt,
    timezone: 'Asia/Kolkata',
    registrationDeadline,
    minTeamSize: 2,
    maxTeamSize: 4,
    teamSize: { min: 2, max: 4 },
    eligibilityNotes: 'Isolated development-only test event for local verification.',
    themes: ['AI/ML', 'Web Development', 'Cloud/Systems', 'Cybersecurity'],
    description:
      'Isolated development-only test hackathon for verifying card swiping, mutual matching, shortlist updates, and team formation locally. Never visible in production.',
    shortDescription:
      'Development-only test event for verifying swiping, matching, and team formation.',
    registrationUrl: 'https://events.pes.edu/',
    verifiedCanonicalUrl: 'https://events.pes.edu/',
    sourceUrlStatus: 'verified',
    sourceType: 'approved_organizer',
    sourceIds: ['dev_sandbox'],
    fieldProvenance: {},
    suggestedByCount: 0,
    classification: {
      category: 'hackathon',
      ruleGatePassed: true,
      mlConfidenceScore: 1,
      reason: 'Isolated development-only testing fixture',
    },
    verificationStatus: 'verified',
    status: 'published',
    lastVerifiedAt: nowIso,
    createdBy: 'dev_sandbox',
  };

  interface RawDevStudent {
    uid: string;
    displayName: string;
    campus: 'RR Campus' | 'EC Campus';
    program: string;
    graduationYear: number;
    headline: string;
    about: string;
    skills: string[];
    interests: string[];
    roles: string[];
    githubUsername: string;
    projectTitle: string;
    projectDesc: string;
    alreadyInterestedInViewer?: boolean;
    note?: string;
  }

  const rawStudents: RawDevStudent[] = [
    {
      uid: 'dev_test_student_1',
      displayName: 'Ananya Rao [Dev Test]',
      campus: 'RR Campus',
      program: 'Computer Science and Engineering',
      graduationYear: 2027,
      headline: 'Full-stack TypeScript & React builder who ships polished demos fast',
      about: 'Love crafting clean UI flows, real-time APIs, and rapid weekend prototypes.',
      skills: ['TypeScript', 'React', 'Node.js', 'SQL', 'Figma'],
      interests: ['Web Development', 'AI/ML', 'Design'],
      roles: ['Frontend'],
      githubUsername: 'ananya-dev-test',
      projectTitle: 'CampusPulse Live',
      projectDesc: 'Real-time timetable and club event dashboard built with React and Postgres.',
      alreadyInterestedInViewer: true,
      note: 'Would love to team up on frontend + product polish!',
    },
    {
      uid: 'dev_test_student_2',
      displayName: 'Karthik Nair [Dev Test]',
      campus: 'RR Campus',
      program: 'Computer Science and Engineering',
      graduationYear: 2027,
      headline: 'Applied ML & Python engineer focused on inference pipelines',
      about: 'Into LLM agents, computer vision, and shipping reproducible backends under 24 hours.',
      skills: ['Python', 'PyTorch', 'FastAPI', 'Docker', 'SQL'],
      interests: ['AI/ML', 'Data Science', 'Cloud/Systems'],
      roles: ['ML/Data'],
      githubUsername: 'karthik-ml-test',
      projectTitle: 'MedScan Triage',
      projectDesc: 'Lightweight multimodal document triage pipeline using PyTorch and FastAPI.',
      alreadyInterestedInViewer: true,
      note: 'Looking for teammates to pair an ML backend with a sharp web client.',
    },
    {
      uid: 'dev_test_student_3',
      displayName: 'Meera Kulkarni [Dev Test]',
      campus: 'EC Campus',
      program: 'Computer Science and Engineering',
      graduationYear: 2028,
      headline: 'Backend systems & distributed APIs in Go, Node, and Postgres',
      about: 'Enjoy designing resilient schemas, WebSockets, and zero-downtime hackathon deploys.',
      skills: ['Node.js', 'Go', 'PostgreSQL', 'Docker', 'TypeScript'],
      interests: ['Cloud/Systems', 'Web Development', 'Cybersecurity'],
      roles: ['Backend'],
      githubUsername: 'meera-sys-test',
      projectTitle: 'EdgeQueue',
      projectDesc: 'Low-latency distributed job queue with live observability metrics.',
      alreadyInterestedInViewer: true,
      note: 'Can handle backend APIs, auth, and cloud deployment.',
    },
    {
      uid: 'dev_test_student_4',
      displayName: 'Devansh Shetty [Dev Test]',
      campus: 'RR Campus',
      program: 'Design & Human-Computer Interaction',
      graduationYear: 2027,
      headline: 'Product designer & frontend prototyper turning rough ideas into pitch winners',
      about: 'Focused on interaction design, pitch decks, and accessible React interfaces.',
      skills: ['Figma', 'React', 'TypeScript', 'CSS', 'JavaScript'],
      interests: ['Design', 'Web Development', 'Mobile Apps'],
      roles: ['Design'],
      githubUsername: 'devansh-ui-test',
      projectTitle: 'FlowKit Studio',
      projectDesc: 'Component library and interactive pitch prototype toolkit for student teams.',
    },
    {
      uid: 'dev_test_student_5',
      displayName: 'Riya Deshmukh [Dev Test]',
      campus: 'EC Campus',
      program: 'Electronics and Communication Engineering',
      graduationYear: 2027,
      headline: 'Embedded systems, ROS2, and edge-AI hardware hacker',
      about: 'Building autonomous sensor rigs, ESP32 telemetry nodes, and robotics demos.',
      skills: ['C++', 'Python', 'ROS2', 'ESP32', 'Docker'],
      interests: ['Robotics', 'AI/ML', 'Cloud/Systems'],
      roles: ['Hardware'],
      githubUsername: 'riya-hw-test',
      projectTitle: 'AgroSense Rover',
      projectDesc: 'Autonomous soil-telemetry rover streaming live sensor data over MQTT.',
    },
    {
      uid: 'dev_test_student_6',
      displayName: 'Siddharth Menon [Dev Test]',
      campus: 'RR Campus',
      program: 'Computer Science and Engineering',
      graduationYear: 2026,
      headline: 'Security researcher & CTF player building defensive developer tools',
      about: 'Interested in AppSec, static analysis, and hardening web/API architectures.',
      skills: ['Python', 'C++', 'Linux', 'Docker', 'JavaScript'],
      interests: ['Cybersecurity', 'Cloud/Systems', 'Web Development'],
      roles: ['Backend'],
      githubUsername: 'sid-sec-test',
      projectTitle: 'VaultLint',
      projectDesc: 'Automated secret and dependency auditor for student hackathon repos.',
    },
    {
      uid: 'dev_test_student_7',
      displayName: 'Niharika Verma [Dev Test]',
      campus: 'EC Campus',
      program: 'Computer Science and Engineering',
      graduationYear: 2028,
      headline: 'Cross-platform mobile developer shipping Flutter & React Native apps',
      about: 'Passionate about offline-first mobile UX, clean state management, and fast API integration.',
      skills: ['Flutter', 'TypeScript', 'React', 'Firebase', 'Figma'],
      interests: ['Mobile Apps', 'Design', 'Web Development'],
      roles: ['Frontend'],
      githubUsername: 'niharika-mob-test',
      projectTitle: 'CommuteBuddy PES',
      projectDesc: 'Student carpool and shuttle tracker with offline route caching.',
    },
    {
      uid: 'dev_test_student_8',
      displayName: 'Arjun Subramanian [Dev Test]',
      campus: 'RR Campus',
      program: 'Computer Science and Engineering',
      graduationYear: 2027,
      headline: 'Flexible generalist bridging data pipelines, APIs, and demo storytelling',
      about: 'Happy jumping between Python data scripts, TypeScript frontends, and final pitch demos.',
      skills: ['Python', 'TypeScript', 'SQL', 'React', 'PyTorch'],
      interests: ['Data Science', 'AI/ML', 'Web Development'],
      roles: ['Flexible'],
      githubUsername: 'arjun-gen-test',
      projectTitle: 'TransitOptima',
      projectDesc: 'Demand-forecasting dashboard for urban bus corridors in Bengaluru.',
    },
  ];

  const users: User[] = rawStudents.map((s) => ({
    uid: s.uid,
    displayName: s.displayName,
    campus: s.campus,
    program: s.program,
    graduationYear: s.graduationYear,
    verificationStatus: 'verified_pesu_oidc',
    pesuOidcSub: `dev_test_sub_${s.uid}`,
    personaLabel: 'Dev Test Profile',
    accountStatus: 'active',
    verified: true,
    privacyPreferences: {
      profileVisible: true,
      githubConsent: false,
      aiEnrichmentConsent: false,
      academyAnnouncementsOptIn: false,
      academyTimetableOptIn: false,
      onboardingCompleted: true,
    },
    createdAt: nowIso,
  }));

  const profiles: Record<string, Profile> = {};
  for (const s of rawStudents) {
    profiles[s.uid] = {
      uid: s.uid,
      headline: s.headline,
      about: s.about,
      skillTags: s.skills,
      interestTags: s.interests,
      projectDomains: s.interests,
      topicsToExplore: s.interests,
      preferredRoles: s.roles,
      rolesWantToLearn: [],
      workingStyleTags: [],
      hackathonGoals: [],
      featuredProjects: [
        {
          id: `dev_proj_${s.uid}`,
          title: s.projectTitle,
          description: s.projectDesc,
          tags: s.skills.slice(0, 3),
        },
      ],
      portfolioLinks: [],
      githubUsername: s.githubUsername,
      isFirstTimeHacker: false,
      visibility: 'public_verified_students',
      updatedAt: nowIso,
    };
  }

  const participations: Participation[] = rawStudents.map((s) => ({
    id: `dev_part_${s.uid}_${DEV_TEST_HACKATHON_ID}`,
    uid: s.uid,
    hackathonId: DEV_TEST_HACKATHON_ID,
    intent: 'looking',
    desiredRoles: s.roles,
    skillsOffered: s.skills,
    availabilityWindows: ['Flexible'],
    commitmentLevel: 'standard',
    workPreferences: [],
    discoverable: true,
    updatedAt: nowIso,
  }));

  const preMatchedUids: string[] = [];
  const incomingInterests: Interest[] = [];
  for (const s of rawStudents) {
    if (s.alreadyInterestedInViewer) {
      preMatchedUids.push(s.uid);
      incomingInterests.push({
        id: `dev_inc_${s.uid}_${viewerUid}`,
        hackathonId: DEV_TEST_HACKATHON_ID,
        fromUid: s.uid,
        targetType: 'user',
        targetId: viewerUid,
        decision: 'interested',
        note: s.note,
        createdAt: nowIso,
      });
    }
  }

  return {
    hackathon,
    users,
    profiles,
    participations,
    incomingInterests,
    preMatchedUids,
  };
}
