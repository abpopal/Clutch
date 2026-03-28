const SPORT_META = {
  basketball: { label: "Basketball", icon: "🏀", accent: "#d7a23d" },
  football: { label: "Football", icon: "🏈", accent: "#d76f3d" },
  baseball: { label: "Baseball", icon: "⚾", accent: "#8cc9ff" },
  track: { label: "Track", icon: "🏃", accent: "#8fe1bc" },
  soccer: { label: "Soccer", icon: "⚽", accent: "#9db7ff" },
};

export const VERIFICATION_BADGES = {
  coach: { key: "coach", label: "Coach Verified", short: "Coach", icon: "✓", tone: "coach" },
  school: { key: "school", label: "School Verified", short: "School", icon: "🏫", tone: "school" },
  video: { key: "video", label: "Video Verified", short: "Video", icon: "🎬", tone: "video" },
  event: { key: "event", label: "Event Verified", short: "Event", icon: "🏆", tone: "event" },
  official: { key: "official", label: "Official", short: "Official", icon: "⭐", tone: "official" },
};

function sportMeta(key) {
  return SPORT_META[key] || { label: key || "Sport", icon: "•", accent: "#d7a23d" };
}

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function initialsFor(name) {
  const parts = String(name || "Untitled Athletic")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "UA";
}

export function athleteIdFor(name, gradYear, sequence = "00100") {
  return `UA-${initialsFor(name)}-${gradYear || "2026"}-${String(sequence).padStart(5, "0")}`;
}

function seededValue(seed, index) {
  let hash = 0;
  const source = `${seed}:${index}`;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 2147483647;
  }
  return hash / 2147483647;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function badgeKeyFromSource(source) {
  if (source === "coach") return "coach";
  if (source === "school") return "school";
  return "official";
}

function numericStatValue(value) {
  const match = String(value || "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function formatMetricLabel(statKey) {
  return String(statKey || "")
    .replace(/_/g, " ")
    .replace(/\bfg\b/i, "FG")
    .replace(/\bppg\b/i, "PPG")
    .replace(/\bapg\b/i, "APG")
    .replace(/\brpg\b/i, "RPG")
    .replace(/\bstl\b/i, "STL")
    .replace(/\bblk\b/i, "BLK")
    .replace(/\bavg\b/i, "AVG")
    .replace(/\btd\b/i, "TD")
    .replace(/\byds\b/i, "YDS")
    .replace(/\bm\b/i, "M");
}

const ATHLETE_PRESETS = [
  {
    athleteId: "UA-MJ-2026-00124",
    barcodeValue: "UA-MJ-2026-00124",
    qrValue: "https://untitledathletic.com/athletes/UA-MJ-2026-00124",
    name: "Marcus Johnson",
    number: "24",
    initials: "MJ",
    position: "Forward / Point Guard",
    school: "Westlake High School",
    gradYear: 2026,
    gpa: "3.7",
    hometown: "Atlanta, GA",
    ranking: "Regional #12",
    bio: "Marcus is a multi-sport athlete whose game profile centers on pace control, downhill creation, and visible year-over-year growth. His film, event history, and coach validation make him a strong recruiting evaluation profile rather than a generic social feed page.",
    playingStyle: "Long, explosive lead creator who can initiate offense, defend multiple spots, and translate pressure possessions into clean scoring chances.",
    strengths: ["Shot Creation", "Transition Pace", "Help-Side Reads", "Explosiveness", "Two-Way Motor"],
    goals: "Targeting high-academic Division I programs where basketball development, sports performance support, and business/communications tracks are strong.",
    coachQuote: {
      text: "Marcus has become the player we trust to organize the floor, settle late-clock possessions, and compete through pressure without changing who he is.",
      author: "Coach Terrence Boyd",
      role: "Head Basketball Coach",
      verified: true,
    },
    offers: [
      { school: "Georgia Tech", sport: "Basketball", date: "2026-01-14", official: true },
      { school: "Vanderbilt", sport: "Basketball", date: "2026-01-28", official: false },
      { school: "Clemson", sport: "Basketball", date: "2026-02-07", official: false },
    ],
    events: [
      { name: "Nike Elite 100", date: "2025-06-18", result: "Standout half-court scoring run" },
      { name: "Under Armour Association", date: "2025-07-08", result: "Multiple scouts in attendance" },
      { name: "Peach Jam", date: "2025-07-21", result: "Top wing matchup win" },
    ],
    recruiters: [
      { school: "Georgia Tech", contact: "Assistant Coach", date: "2026-01-14", interested: true },
      { school: "Vanderbilt", contact: "Recruiting Coordinator", date: "2026-01-28", interested: true },
      { school: "Clemson", contact: "Assistant Coach", date: "2026-02-07", interested: false },
    ],
    measurables: {
      Height: `6'3"`,
      Weight: "189 lbs",
      Wingspan: `6'7"`,
      Vertical: `36"`,
      Speed: "10.74s 100m",
      Reach: `8'2"`,
    },
    readiness: {
      score: 91,
      items: [
        { label: "Coach quote verified", done: true, weight: 15 },
        { label: "School profile validated", done: true, weight: 15 },
        { label: "Game film attached", done: true, weight: 14 },
        { label: "Transcript and GPA added", done: true, weight: 14 },
        { label: "Event history complete", done: true, weight: 12 },
        { label: "Upcoming schedule added", done: true, weight: 11 },
        { label: "Recruiter contact log active", done: true, weight: 10 },
        { label: "Premium badge checklist", done: false, weight: 9 },
      ],
    },
    sports: [
      {
        id: "basketball",
        label: "Basketball",
        icon: "🏀",
        position: "Forward / Point Guard",
        season: "Winter",
        grade: "11th Grade",
        team: "Westlake Lions",
        record: "24-6",
        awards: ["All-District 1st Team", "Team MVP", "Region Final Four"],
        stats: [
          { label: "PPG", value: "24.3", badge: "coach" },
          { label: "APG", value: "5.8", badge: "school" },
          { label: "RPG", value: "8.6", badge: "video" },
          { label: "FG%", value: "48.2", badge: "official" },
          { label: "STL", value: "2.1", badge: "event" },
        ],
        progression: [
          { year: "9th", PPG: 11.4, APG: 2.9, RPG: 4.1 },
          { year: "10th", PPG: 17.8, APG: 4.4, RPG: 6.0 },
          { year: "11th", PPG: 24.3, APG: 5.8, RPG: 8.6 },
        ],
        positionAverages: {
          PPG: [10.2, 13.8, 16.1],
          APG: [2.4, 3.3, 3.7],
          RPG: [3.8, 4.6, 5.2],
        },
        compareRadar: [
          { stat: "Scoring", marcus: 92, avg: 69 },
          { stat: "Playmaking", marcus: 79, avg: 61 },
          { stat: "Length", marcus: 85, avg: 66 },
          { stat: "Defense", marcus: 77, avg: 63 },
          { stat: "Burst", marcus: 88, avg: 64 },
        ],
        timeline: [
          { year: "9th", emoji: "🌱", stats: { PPG: "11.4", APG: "2.9", RPG: "4.1" }, awards: ["Rotation Guard"], rank: "Regional #41", milestone: "Earned varsity minutes early." },
          { year: "10th", emoji: "📈", stats: { PPG: "17.8", APG: "4.4", RPG: "6.0" }, awards: ["All-Region HM"], rank: "Regional #23", milestone: "Became primary perimeter creator." },
          { year: "11th", emoji: "⭐", stats: { PPG: "24.3", APG: "5.8", RPG: "8.6" }, awards: ["All-District 1st Team", "Team MVP"], rank: "Regional #12", milestone: "Turned into a full-court scouting target." },
        ],
      },
      {
        id: "football",
        label: "Football",
        icon: "🏈",
        position: "Wide Receiver",
        season: "Fall",
        grade: "11th Grade",
        team: "Westlake Lions",
        record: "9-3",
        awards: ["All-Region WR", "Team Big Play Award"],
        stats: [
          { label: "YDS", value: "1042", badge: "school" },
          { label: "TD", value: "11", badge: "official" },
          { label: "REC", value: "63", badge: "coach" },
          { label: "YAC", value: "322", badge: "video" },
        ],
        progression: [
          { year: "9th", YDS: 336, TD: 3, REC: 26 },
          { year: "10th", YDS: 718, TD: 7, REC: 44 },
          { year: "11th", YDS: 1042, TD: 11, REC: 63 },
        ],
        positionAverages: {
          YDS: [281, 497, 612],
          TD: [2, 4, 6],
          REC: [18, 29, 36],
        },
        compareRadar: [
          { stat: "Burst", marcus: 88, avg: 67 },
          { stat: "Hands", marcus: 80, avg: 64 },
          { stat: "YAC", marcus: 84, avg: 61 },
          { stat: "Tracking", marcus: 78, avg: 59 },
          { stat: "Physicality", marcus: 74, avg: 58 },
        ],
        timeline: [
          { year: "9th", emoji: "🌱", stats: { YDS: "336", TD: "3", REC: "26" }, awards: ["JV Call-Up"], rank: "Regional WR #51", milestone: "Created vertical threat reps." },
          { year: "10th", emoji: "📈", stats: { YDS: "718", TD: "7", REC: "44" }, awards: ["Breakout Player"], rank: "Regional WR #29", milestone: "Became featured route winner." },
          { year: "11th", emoji: "⭐", stats: { YDS: "1042", TD: "11", REC: "63" }, awards: ["All-Region WR"], rank: "Regional WR #16", milestone: "Crossed the 1,000-yard mark." },
        ],
      },
      {
        id: "baseball",
        label: "Baseball",
        icon: "⚾",
        position: "Center Field",
        season: "Spring",
        grade: "11th Grade",
        team: "Westlake Lions",
        record: "18-8",
        awards: ["All-District CF"],
        stats: [
          { label: "AVG", value: ".347", badge: "coach" },
          { label: "OBP", value: ".411", badge: "school" },
          { label: "SB", value: "17", badge: "official" },
          { label: "RBI", value: "24", badge: "event" },
        ],
        progression: [
          { year: "9th", AVG: 0.262, OBP: 0.312, SB: 7 },
          { year: "10th", AVG: 0.311, OBP: 0.368, SB: 12 },
          { year: "11th", AVG: 0.347, OBP: 0.411, SB: 17 },
        ],
        positionAverages: {
          AVG: [0.245, 0.271, 0.282],
          OBP: [0.301, 0.324, 0.338],
          SB: [5, 8, 10],
        },
        compareRadar: [
          { stat: "Contact", marcus: 81, avg: 65 },
          { stat: "Range", marcus: 86, avg: 64 },
          { stat: "Speed", marcus: 90, avg: 67 },
          { stat: "Arm", marcus: 72, avg: 61 },
          { stat: "Instincts", marcus: 76, avg: 60 },
        ],
        timeline: [
          { year: "9th", emoji: "🌱", stats: { AVG: ".262", OBP: ".312", SB: "7" }, awards: ["Depth Outfielder"], rank: "Regional CF #38", milestone: "Entered lineup for speed value." },
          { year: "10th", emoji: "📈", stats: { AVG: ".311", OBP: ".368", SB: "12" }, awards: ["Lead-Off Trial"], rank: "Regional CF #23", milestone: "Held lead-off role more consistently." },
          { year: "11th", emoji: "⭐", stats: { AVG: ".347", OBP: ".411", SB: "17" }, awards: ["All-District CF"], rank: "Regional CF #14", milestone: "Turned into a top-of-order creator." },
        ],
      },
      {
        id: "track",
        label: "Track",
        icon: "🏃",
        position: "100m",
        season: "Spring",
        grade: "11th Grade",
        team: "Westlake Track",
        record: "State Qualifier",
        awards: ["State Qualifier"],
        stats: [
          { label: "100M", value: "10.74", badge: "official" },
          { label: "200M", value: "21.81", badge: "event" },
          { label: "Long Jump", value: "22'1\"", badge: "school" },
        ],
        progression: [
          { year: "9th", "100M": 11.42, "200M": 22.88, "Long Jump": 20.1 },
          { year: "10th", "100M": 11.03, "200M": 22.19, "Long Jump": 21.4 },
          { year: "11th", "100M": 10.74, "200M": 21.81, "Long Jump": 22.1 },
        ],
        positionAverages: {
          "100M": [11.62, 11.31, 11.08],
          "200M": [23.12, 22.74, 22.45],
          "Long Jump": [18.9, 19.8, 20.4],
        },
        compareRadar: [
          { stat: "Start", marcus: 83, avg: 66 },
          { stat: "Top End", marcus: 86, avg: 67 },
          { stat: "Elasticity", marcus: 80, avg: 61 },
          { stat: "Form", marcus: 76, avg: 63 },
          { stat: "Consistency", marcus: 79, avg: 60 },
        ],
        timeline: [
          { year: "9th", emoji: "🌱", stats: { "100M": "11.42", "200M": "22.88", "Long Jump": `20'1"` }, awards: ["Varsity Relay Alternate"], rank: "Regional Sprint #43", milestone: "Established baseline speed markers." },
          { year: "10th", emoji: "📈", stats: { "100M": "11.03", "200M": "22.19", "Long Jump": `21'4"` }, awards: ["Section Finalist"], rank: "Regional Sprint #25", milestone: "Legit sprint upside became visible." },
          { year: "11th", emoji: "⭐", stats: { "100M": "10.74", "200M": "21.81", "Long Jump": `22'1"` }, awards: ["State Qualifier"], rank: "Regional Sprint #12", milestone: "Hit verified state-qualifying times." },
        ],
      },
    ],
    clutchMoments: [
      { type: "championship", badge: "video", title: "Region title go-ahead three", opponent: "Langston Hughes", date: "2026-02-20", context: "Down 2 with 4.1 seconds left", statLine: "24 PTS • 9 REB • 5 AST", summary: "Buried the right-wing game winner over a late switch." },
      { type: "playoff", badge: "school", title: "Fourth-quarter takeover", opponent: "Mays", date: "2026-02-11", context: "Team trailed by 8 entering the fourth", statLine: "12 fourth-quarter points", summary: "Controlled pace and forced two live-ball steals." },
      { type: "rivalry", badge: "coach", title: "Senior night stop-and-score stretch", opponent: "Tri-Cities", date: "2026-01-31", context: "Back-and-forth rivalry finish", statLine: "8 points in final 90 seconds", summary: "Closed the game on both ends." },
    ],
    highlights: [
      { id: "mj-featured", title: "Feature Mix", sport: "basketball", source: "Hudl", duration: "2:18", season: "2025-26", type: "Highlights", views: 1402, featured: true },
      { id: "mj-full-1", title: "Peach Jam Full Game", sport: "basketball", source: "School Film", duration: "31:04", season: "2025-26", type: "Full Games", views: 884, featured: false },
      { id: "mj-workout", title: "Explosive Guard Workout", sport: "track", source: "Uploaded", duration: "1:12", season: "2025 Offseason", type: "Workouts", views: 499, featured: false },
    ],
    schedule: [
      { id: "mj-sched-1", date: "2026-03-29T18:30:00", sport: "basketball", opponent: "Pace Academy", location: "Atlanta Invitational", type: "game", result: "" },
      { id: "mj-sched-2", date: "2026-04-05T09:15:00", sport: "track", opponent: "Metro Finals", location: "Westlake Stadium", type: "tournament", result: "" },
      { id: "mj-sched-3", date: "2026-04-13T19:00:00", sport: "baseball", opponent: "East Coweta", location: "Westlake Field", type: "game", result: "" },
    ],
  },
  {
    athleteId: "UA-JW-2026-00125",
    barcodeValue: "UA-JW-2026-00125",
    qrValue: "https://untitledathletic.com/athletes/UA-JW-2026-00125",
    name: "Jordan Williams",
    number: "3",
    initials: "JW",
    position: "Point Guard / Midfielder",
    school: "Northside Prep",
    gradYear: 2026,
    gpa: "3.9",
    hometown: "Decatur, GA",
    ranking: "Regional #7",
    bio: "Jordan is a high-IQ creator whose profile is built around organization, assist creation, and verified event visibility. The presentation emphasizes trust, progression, and multi-sport context rather than vanity metrics.",
    playingStyle: "Pass-first initiator with strong tempo control, touch passing in transition, and mature decision-making under pressure.",
    strengths: ["Floor Mapping", "Assist Creation", "Pick-and-Roll Reads", "Leadership", "Motor"],
    goals: "Looking for a high-level program where point-guard development, academic rigor, and immediate role clarity align.",
    coachQuote: {
      text: "Jordan makes the game calmer for everyone else and has grown into the kind of organizer that scouts trust quickly.",
      author: "Coach Melanie Ross",
      role: "Head Girls Basketball Coach",
      verified: true,
    },
    offers: [
      { school: "Georgia", sport: "Basketball", date: "2026-01-06", official: true },
      { school: "Auburn", sport: "Basketball", date: "2026-01-17", official: true },
      { school: "Wake Forest", sport: "Basketball", date: "2026-01-23", official: false },
    ],
    events: [
      { name: "Under Armour Association", date: "2025-06-22", result: "All-Tournament PG" },
      { name: "Adidas 3SSB", date: "2025-07-13", result: "Top 10 PG mention" },
    ],
    recruiters: [
      { school: "Georgia", contact: "Head Coach", date: "2026-01-06", interested: true },
      { school: "Auburn", contact: "Assistant Coach", date: "2026-01-17", interested: true },
      { school: "Wake Forest", contact: "Recruiting Coordinator", date: "2026-01-23", interested: false },
    ],
    measurables: {
      Height: `5'11"`,
      Weight: "164 lbs",
      Wingspan: `6'1"`,
      Vertical: `30"`,
      Speed: "11.28s 100m",
      Reach: `7'6"`,
    },
    readiness: {
      score: 95,
      items: [
        { label: "Coach quote verified", done: true, weight: 15 },
        { label: "School profile validated", done: true, weight: 15 },
        { label: "Game film attached", done: true, weight: 14 },
        { label: "Transcript and GPA added", done: true, weight: 14 },
        { label: "Event history complete", done: true, weight: 12 },
        { label: "Upcoming schedule added", done: true, weight: 11 },
        { label: "Recruiter contact log active", done: true, weight: 10 },
        { label: "Premium badge checklist", done: true, weight: 9 },
      ],
    },
    sports: [
      {
        id: "basketball",
        label: "Basketball",
        icon: "🏀",
        position: "Point Guard",
        season: "Winter",
        grade: "11th Grade",
        team: "Northside Prep",
        record: "27-4",
        awards: ["District Player of the Year", "All-State 2nd Team"],
        stats: [
          { label: "APG", value: "9.2", badge: "coach" },
          { label: "PPG", value: "17.1", badge: "school" },
          { label: "AST/TO", value: "3.1", badge: "official" },
          { label: "3PT%", value: "38.4", badge: "video" },
        ],
        progression: [
          { year: "9th", APG: 4.6, PPG: 9.7, "AST/TO": 1.8 },
          { year: "10th", APG: 7.4, PPG: 13.4, "AST/TO": 2.4 },
          { year: "11th", APG: 9.2, PPG: 17.1, "AST/TO": 3.1 },
        ],
        positionAverages: {
          APG: [3.1, 4.2, 4.9],
          PPG: [8.6, 10.8, 12.4],
          "AST/TO": [1.4, 1.8, 2.1],
        },
        compareRadar: [
          { stat: "Creation", marcus: 94, avg: 66 },
          { stat: "Handle", marcus: 87, avg: 63 },
          { stat: "Vision", marcus: 96, avg: 68 },
          { stat: "Pace", marcus: 90, avg: 65 },
          { stat: "Poise", marcus: 91, avg: 64 },
        ],
        timeline: [
          { year: "9th", emoji: "🌱", stats: { APG: "4.6", PPG: "9.7", "AST/TO": "1.8" }, awards: ["Varsity Rotation"], rank: "Regional PG #22", milestone: "Became second-unit organizer." },
          { year: "10th", emoji: "📈", stats: { APG: "7.4", PPG: "13.4", "AST/TO": "2.4" }, awards: ["All-District HM"], rank: "Regional PG #11", milestone: "Shifted into lead guard role." },
          { year: "11th", emoji: "⭐", stats: { APG: "9.2", PPG: "17.1", "AST/TO": "3.1" }, awards: ["District POY", "All-State 2nd Team"], rank: "Regional PG #7", milestone: "Turned into one of the best facilitators in the region." },
        ],
      },
      {
        id: "soccer",
        label: "Soccer",
        icon: "⚽",
        position: "Midfielder",
        season: "Spring",
        grade: "11th Grade",
        team: "Northside Prep",
        record: "19-3-1",
        awards: ["All-District Midfielder"],
        stats: [
          { label: "Assists", value: "18", badge: "official" },
          { label: "Chances", value: "46", badge: "coach" },
          { label: "Goals", value: "8", badge: "school" },
          { label: "Interceptions", value: "29", badge: "event" },
        ],
        progression: [
          { year: "9th", Assists: 6, Goals: 3, Chances: 18 },
          { year: "10th", Assists: 12, Goals: 5, Chances: 31 },
          { year: "11th", Assists: 18, Goals: 8, Chances: 46 },
        ],
        positionAverages: {
          Assists: [4, 7, 8],
          Goals: [2, 3, 4],
          Chances: [12, 18, 20],
        },
        compareRadar: [
          { stat: "Vision", marcus: 92, avg: 66 },
          { stat: "Engine", marcus: 86, avg: 64 },
          { stat: "Press Resistance", marcus: 83, avg: 61 },
          { stat: "Delivery", marcus: 90, avg: 63 },
          { stat: "Ball Security", marcus: 88, avg: 64 },
        ],
        timeline: [
          { year: "9th", emoji: "🌱", stats: { Assists: "6", Goals: "3", Chances: "18" }, awards: ["Rotation Midfielder"], rank: "Regional MF #33", milestone: "Earned minutes as connector." },
          { year: "10th", emoji: "📈", stats: { Assists: "12", Goals: "5", Chances: "31" }, awards: ["Starter"], rank: "Regional MF #17", milestone: "Became primary chance creator." },
          { year: "11th", emoji: "⭐", stats: { Assists: "18", Goals: "8", Chances: "46" }, awards: ["All-District Midfielder"], rank: "Regional MF #8", milestone: "One of the best midfield playmakers in the area." },
        ],
      },
    ],
    clutchMoments: [
      { type: "championship", badge: "video", title: "Title game dagger assist", opponent: "Pinecrest", date: "2026-02-18", context: "Tie game, under one minute", statLine: "17 PTS • 11 AST", summary: "Rejected the screen, hit the corner on time, and sealed the win." },
      { type: "playoff", badge: "school", title: "Fourth-quarter press break clinic", opponent: "Lovett", date: "2026-02-08", context: "Two-possession game against pressure", statLine: "8 AST • 1 TO", summary: "Calmed the entire floor when the game sped up." },
    ],
    highlights: [
      { id: "jw-featured", title: "Playmaker Tape", sport: "basketball", source: "Hudl", duration: "2:42", season: "2025-26", type: "Highlights", views: 1750, featured: true },
      { id: "jw-full", title: "District Final Full Game", sport: "basketball", source: "YouTube", duration: "28:44", season: "2025-26", type: "Full Games", views: 936, featured: false },
      { id: "jw-soccer", title: "Midfield Build-Up Reel", sport: "soccer", source: "Uploaded", duration: "1:56", season: "2025", type: "Highlights", views: 522, featured: false },
    ],
    schedule: [
      { id: "jw-sched-1", date: "2026-03-30T19:00:00", sport: "basketball", opponent: "Wesleyan", location: "Northside Prep Arena", type: "game", result: "" },
      { id: "jw-sched-2", date: "2026-04-04T14:00:00", sport: "soccer", opponent: "Marist", location: "Decatur Fields", type: "playoff", result: "" },
    ],
  },
];

function presetByName(name) {
  const normalized = normalizeText(name);
  return ATHLETE_PRESETS.find((athlete) => normalizeText(athlete.name) === normalized) || null;
}

function dedupeSports(sports) {
  const seen = new Set();
  return sports.filter((sport) => {
    if (!sport?.id || seen.has(sport.id)) return false;
    seen.add(sport.id);
    return true;
  });
}

function sportsFromStats(stats, position) {
  const bySport = new Map();
  (stats || []).forEach((row) => {
    const key = normalizeText(row.sport) || "basketball";
    if (!bySport.has(key)) bySport.set(key, []);
    bySport.get(key).push(row);
  });

  if (bySport.size === 0) {
    return [
      {
        id: "basketball",
        label: "Basketball",
        icon: "🏀",
        position: position || "Athlete",
        season: "Current",
        grade: "Current",
        team: "Untitled Athletic",
        record: "In Season",
        awards: ["Profile Active"],
        stats: [
          { label: "Impact", value: "Active", badge: "coach" },
          { label: "Readiness", value: "Building", badge: "school" },
        ],
        progression: [
          { year: "9th", Impact: 42, Readiness: 38 },
          { year: "10th", Impact: 56, Readiness: 51 },
          { year: "11th", Impact: 68, Readiness: 63 },
        ],
        positionAverages: { Impact: [35, 42, 49], Readiness: [34, 40, 47] },
        compareRadar: [
          { stat: "Growth", marcus: 72, avg: 52 },
          { stat: "Trust", marcus: 69, avg: 49 },
          { stat: "Film", marcus: 65, avg: 46 },
          { stat: "Academics", marcus: 71, avg: 50 },
          { stat: "Context", marcus: 74, avg: 51 },
        ],
        timeline: [
          { year: "9th", emoji: "🌱", stats: { Impact: "42", Readiness: "38" }, awards: ["Baseline"], rank: "Regional #55", milestone: "Initial varsity exposure." },
          { year: "10th", emoji: "📈", stats: { Impact: "56", Readiness: "51" }, awards: ["Growth"], rank: "Regional #33", milestone: "Consistent contributor." },
          { year: "11th", emoji: "⭐", stats: { Impact: "68", Readiness: "63" }, awards: ["Trusted"], rank: "Regional #19", milestone: "Built a legitimate scouting profile." },
        ],
      },
    ];
  }

  return Array.from(bySport.entries()).map(([key, items]) => {
    const meta = sportMeta(key);
    const currentMetrics = items.slice(0, 4).map((item) => ({
      label: formatMetricLabel(item.stat_key),
      value: item.stat_value,
      badge: badgeKeyFromSource(item.source),
    }));
    const progression = ["9th", "10th", "11th"].map((year, index) => {
      const row = { year };
      currentMetrics.forEach((metric) => {
        const current = numericStatValue(metric.value);
        row[metric.label] = Number((current * (0.58 + index * 0.17)).toFixed(1));
      });
      return row;
    });
    const positionAverages = {};
    currentMetrics.forEach((metric) => {
      const current = numericStatValue(metric.value);
      positionAverages[metric.label] = [
        Number((current * 0.46).toFixed(1)),
        Number((current * 0.58).toFixed(1)),
        Number((current * 0.69).toFixed(1)),
      ];
    });
    const compareRadar = currentMetrics.map((metric, index) => ({
      stat: metric.label,
      marcus: Math.min(97, 60 + index * 7 + Math.round(seededValue(metric.label, index) * 20)),
      avg: 52 + index * 4,
    }));

    return {
      id: key,
      label: meta.label,
      icon: meta.icon,
      position: position || meta.label,
      season: "Current",
      grade: "Current",
      team: "Untitled Athletic",
      record: "Active",
      awards: ["Database Connected"],
      stats: currentMetrics,
      progression,
      positionAverages,
      compareRadar,
      timeline: progression.map((row, index) => ({
        year: row.year,
        emoji: ["🌱", "📈", "⭐"][index] || "•",
        stats: Object.fromEntries(
          Object.entries(row)
            .filter(([keyName]) => keyName !== "year")
            .map(([keyName, value]) => [keyName, String(value)])
        ),
        awards: index === 2 ? ["Current Snapshot"] : ["Growth Marker"],
        rank: `Regional #${30 - index * 7}`,
        milestone: index === 2 ? "Current database-backed athlete snapshot." : "Progression built from connected profile stats.",
      })),
    };
  });
}

function liveHighlightsFromPosts(posts, fallbackName) {
  const items = (posts || [])
    .filter((post) => Array.isArray(post.post_media) && post.post_media.some((item) => item?.media_url))
    .slice(0, 6)
    .map((post, index) => {
      const media = post.post_media.find((item) => item?.media_url);
      const lowerType = normalizeText(post.post_type || media?.media_type || "highlights");
      return {
        id: `live-${post.post_id || index}`,
        title: post.caption || `${fallbackName} post ${index + 1}`,
        sport: "basketball",
        source: media?.media_type === "video" ? "Uploaded" : "School Film",
        duration: media?.media_type === "video" ? "0:45" : "Image",
        season: new Date(post.created_at || Date.now()).getFullYear().toString(),
        type: lowerType === "video" ? "Highlights" : "Highlights",
        views: 120 + index * 31,
        featured: index === 0,
        mediaUrl: media?.media_url || "",
      };
    });
  return items;
}

export function buildAthleteProfile({
  userId,
  directory,
  athleteRow,
  schoolName,
  stats = [],
  posts = [],
  counts = { posts: 0, followers: 0, following: 0 },
  fallbackRole = "athlete",
}) {
  const name = directory?.display_name || "Untitled Athlete";
  const preset = presetByName(name);
  const liveSports = sportsFromStats(stats, athleteRow?.position || preset?.position || fallbackRole);
  const liveHighlights = liveHighlightsFromPosts(posts, name);
  const derivedSequence = String(userId || "").replace(/\D/g, "").slice(0, 5) || "00199";
  const derivedId = athleteIdFor(name, athleteRow?.graduation_year || preset?.gradYear || 2026, derivedSequence);
  const liveShell = {
    athleteId: derivedId,
    barcodeValue: derivedId,
    qrValue: `https://untitledathletic.com/athletes/${derivedId}`,
    name,
    number: preset?.number || String(3 + Math.floor(seededValue(name, 2) * 21)),
    initials: initialsFor(name),
    position: athleteRow?.position || preset?.position || "Athlete",
    school: schoolName || preset?.school || "Untitled Athletic Academy",
    gradYear: athleteRow?.graduation_year || preset?.gradYear || 2026,
    gpa: preset?.gpa || (fallbackRole === "athlete" ? "3.6" : "N/A"),
    hometown: preset?.hometown || "Georgia",
    ranking: preset?.ranking || `Regional #${12 + Math.floor(seededValue(name, 5) * 25)}`,
    bio: preset?.bio || `${name} has an active recruiting presentation built from the current connected profile, visible media, and structured athlete context.`,
    playingStyle: preset?.playingStyle || "Dynamic competitor with a profile centered on growth, trust, and evaluation-ready presentation.",
    strengths: preset?.strengths || ["Competitive Motor", "Coachability", "Growth Trend"],
    goals: preset?.goals || "Looking for an evaluation environment that values development, context, and academic fit.",
    coachQuote: preset?.coachQuote || {
      text: `${name} continues to add credibility to the profile through consistent work and better game-to-game detail.`,
      author: "Staff Evaluation",
      role: "Program Coach",
      verified: true,
    },
    offers: preset?.offers || [],
    events: preset?.events || [],
    recruiters: preset?.recruiters || [],
    measurables: preset?.measurables || {
      Height: `6'1"`,
      Weight: "178 lbs",
      Wingspan: `6'4"`,
      Vertical: `32"`,
      Speed: "11.08s 100m",
      Reach: `8'0"`,
    },
    readiness: preset?.readiness || {
      score: 82,
      items: [
        { label: "Coach quote verified", done: true, weight: 15 },
        { label: "School profile validated", done: true, weight: 15 },
        { label: "Game film attached", done: liveHighlights.length > 0, weight: 14 },
        { label: "Transcript and GPA added", done: true, weight: 14 },
        { label: "Event history complete", done: false, weight: 12 },
        { label: "Upcoming schedule added", done: true, weight: 11 },
        { label: "Recruiter contact log active", done: false, weight: 10 },
        { label: "Premium badge checklist", done: false, weight: 9 },
      ],
    },
    sports: dedupeSports([...(preset?.sports || []), ...liveSports]),
    clutchMoments: preset?.clutchMoments || [],
    highlights: liveHighlights.length ? liveHighlights : (preset?.highlights || []),
    schedule: preset?.schedule || [],
    liveCounts: counts,
    userId,
    email: directory?.email || "",
    role: fallbackRole,
    searchTokens: [
      name,
      derivedId,
      schoolName,
      athleteRow?.position,
      ...(preset?.sports || []).map((sport) => sport.label),
      ...liveSports.map((sport) => sport.label),
    ]
      .filter(Boolean)
      .join(" "),
  };

  if (!preset) return liveShell;

  return {
    ...clone(preset),
    ...liveShell,
    athleteId: preset.athleteId,
    barcodeValue: preset.barcodeValue,
    qrValue: preset.qrValue,
    school: schoolName || preset.school,
    position: athleteRow?.position || preset.position,
    gradYear: athleteRow?.graduation_year || preset.gradYear,
    highlights: liveHighlights.length ? liveHighlights : clone(preset.highlights),
    liveCounts: counts,
    userId,
    email: directory?.email || "",
    role: fallbackRole,
    searchTokens: [
      preset.name,
      preset.athleteId,
      schoolName || preset.school,
      athleteRow?.position || preset.position,
      ...preset.sports.map((sport) => sport.label),
    ].join(" "),
  };
}

export function formatScoutSummary(athlete) {
  const height = athlete?.measurables?.Height || "Verified measurables";
  const topAward = athlete?.sports?.[0]?.awards?.[0] || "Evaluation profile active";
  return `${height} • ${athlete?.position || "Athlete"} • ${athlete?.gpa || "GPA pending"} GPA • ${topAward} • ${athlete?.ranking || "Regional rank pending"}`;
}

export function readinessLabel(score) {
  if (score >= 90) return "Scout Ready";
  if (score >= 75) return "Almost Ready";
  return "Needs Work";
}

export function sportOptionsForCompare(athleteA, athleteB) {
  const aSports = new Set((athleteA?.sports || []).map((sport) => sport.id));
  return (athleteB?.sports || []).filter((sport) => aSports.has(sport.id));
}

export function getSportMeta(sportId) {
  return sportMeta(sportId);
}

export function badgeMeta(key) {
  return VERIFICATION_BADGES[key] || VERIFICATION_BADGES.coach;
}

export function renderPseudoQrSvg(value) {
  const size = 29;
  const cell = 5;
  const finderAnchors = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ];
  const cells = [];
  const finderSet = new Set();

  finderAnchors.forEach(([startX, startY]) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const absoluteX = startX + x;
        const absoluteY = startY + y;
        finderSet.add(`${absoluteX}:${absoluteY}`);
        const isOuter = x === 0 || y === 0 || x === 6 || y === 6;
        const isInner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if (isOuter || isInner) {
          cells.push(`<rect x="${absoluteX * cell}" y="${absoluteY * cell}" width="${cell}" height="${cell}" rx="1" fill="#f8f2df"></rect>`);
        }
      }
    }
  });

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (finderSet.has(`${x}:${y}`)) continue;
      if (seededValue(value, x * size + y) > 0.56) {
        cells.push(`<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" rx="1" fill="#d7a23d"></rect>`);
      }
    }
  }

  return `
    <svg viewBox="0 0 ${size * cell} ${size * cell}" role="img" aria-label="Athlete QR code">
      <rect width="${size * cell}" height="${size * cell}" rx="12" fill="#11100d"></rect>
      ${cells.join("")}
    </svg>
  `;
}

export function renderBarcodeSvg(value) {
  const bars = [];
  let x = 14;
  String(value || "UA-000").split("").forEach((char, index) => {
    const code = char.charCodeAt(0);
    const width = 2 + (code % 3);
    const height = 62 + (code % 22);
    const gap = 2 + ((code + index) % 2);
    bars.push(`<rect x="${x}" y="${96 - height}" width="${width}" height="${height}" fill="#f8f2df"></rect>`);
    x += width + gap;
  });
  return `
    <svg viewBox="0 0 ${Math.max(180, x + 12)} 118" role="img" aria-label="Athlete barcode">
      <rect width="100%" height="100%" rx="14" fill="#11100d"></rect>
      ${bars.join("")}
      <text x="14" y="108" fill="#d7a23d" font-size="13" font-family="monospace">${value}</text>
    </svg>
  `;
}

export { ATHLETE_PRESETS };
