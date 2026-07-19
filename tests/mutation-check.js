// Mutation-testing runner — verifies the sentinel suite detects known defects (test-effectiveness check).
// Copies the app to a TEMP dir, applies ONE mutation at a time, and requires the targeted
// sentinel to FAIL. The live tree is NEVER mutated. Run in FOREGROUND only.
// Run: node tests/mutation-check.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");

// Each case: unique exact match on the LF-normalized source (match count is verified
// first — a non-match means STALE case, which is a loud error, never a skip).
const CASES = [
  {
    id: "MUT-001", mutates: "restore ignores the saved screen (refresh loses the live game)",
    find: "if (s.screen) setScreen(s.screen);",
    replace: "if (false && s.screen) setScreen(s.screen);",
    mustFail: "S-004",
  },
  {
    id: "MUT-002", mutates: "future-schema guard removed (newer save gets clobbered)",
    find: "if (sv > SUPPORTED_SCHEMA) {",
    replace: "if (false) {",
    mustFail: "S-005",
  },
  {
    id: "MUT-003", mutates: "saveTemplate silently drops the new entry",
    find: "if (persistTemplateChange([entry], `Saved \"${entry.name}\" (${playerCount} players)`)) {",
    replace: "if (persistTemplateChange([], `Saved \"${entry.name}\" (${playerCount} players)`)) {",
    mustFail: "S-006",
  },
  {
    id: "MUT-004", mutates: "one player vanishes from the setup roster",
    find: "{ROSTER.map(p => {",
    replace: "{ROSTER.slice(0, 8).map(p => {",
    mustFail: "S-002",
  },
  // ── Wave 1 cases (one  bug per new behaviour) ──
  {
    id: "MUT-101", mutates: "seed migration uses live timestamps (breaks byte-identical determinism)",
    find: "rev: 1, createdAt: SEED_TS, updatedAt: SEED_TS, deletedAt: null, restoredAt: null,",
    replace: "rev: 1, createdAt: nowIso(), updatedAt: SEED_TS, deletedAt: null, restoredAt: null,",
    mustFail: "S-101",
  },
  {
    id: "MUT-102", mutates: "v1→v2 adapter drops the legacy game's halfMins (16-min game resumes as 20)",
    find: "            halfMins: s.halfMins,",
    replace: "            halfMins: 20,",
    mustFail: "S-103",
  },
  {
    id: "MUT-103", mutates: "template migration keeps the abolished playerOrder/attendanceSignature fields",
    find: "  const { playerOrder, attendanceSignature, ...rest } = t;\n  return rest;",
    replace: "  const { playerOrder, attendanceSignature, ...rest } = t;\n  return t;",
    mustFail: "S-104",
  },
  {
    id: "MUT-104", mutates: "quarantine heals WITHOUT preserving the damaged payload first",
    find: "  const copied = quarantineRaw(key, raw);\n  if (copied) {",
    replace: "  const copied = true;\n  if (copied) {",
    mustFail: "S-105",
  },
  {
    id: "MUT-105", mutates: "roster silently falls back to the hardcoded seed (ignores stored team edits)",
    find: "const ACTIVE_TEAM = getActiveTeam();",
    replace: "const ACTIVE_TEAM = buildSeedEnvelope().teams[0];",
    mustFail: "S-102",
  },
  {
    id: "MUT-106", mutates: "template delete regresses to a splice (no tombstone in storage)",
    find: "    persistTemplateChange([{ ...t, deletedAt: nowIso(), rev: (t.rev || 0) + 1, updatedAt: nowIso() }], \"Template deleted\");",
    replace: "    persistTemplateChange([{ ...t, deletedAt: null, rev: (t.rev || 0) + 1, updatedAt: nowIso() }], \"Template deleted\");",
    mustFail: "S-107",
  },
  {
    id: "MUT-107", mutates: "D-9 participant cap removed from hydration validation",
    find: "        if (s.selected.length > MAX_PARTICIPANTS) { fail(\"too many participants\"); break restoreattempt; }",
    replace: "        if (false) { fail(\"too many participants\"); break restoreattempt; }",
    mustFail: "S-108",
  },
  {
    id: "MUT-108", mutates: "hasSavedGame regresses to plan-only (start5 saves invisible again)",
    find: "        if (s.screen && s.screen !== \"setup\") { setHasSavedGame(true); savedScreenRef.current = s.screen; }",
    replace: "        if (s.plan && s.screen && s.screen !== \"setup\") { setHasSavedGame(true); savedScreenRef.current = s.screen; }",
    mustFail: "S-111",
  },
  {
    // NOTE: removing the STAGE-1 order check alone is an equivalent mutant — the
    // post-sanitization layer still quarantines the same states (defence in depth,
    // verified 19 Jul). This case therefore targets the sanitized-check layer,
    // whose removal IS observable (S-117).
    id: "MUT-109", mutates: "post-sanitization order/grid mismatch check removed",
    find: "          if (sanOrder.length !== s.gridPlayerOrderJerseys.length || sanOrder.length !== gridCols) { fail(\"plan player order does not match its grid\"); break restoreattempt; }",
    replace: "          if (false) { fail(\"plan player order does not match its grid\"); break restoreattempt; }",
    mustFail: "S-117",
  },
  {
    id: "MUT-110", mutates: "future-version game save blocks silently again (no banner)",
    find: "          storageNotices.push({ text: \"A game saved by a NEWER app version is stored here. NOT SAVING games this session to protect it — update the app or discard from the newer version.\" });",
    replace: "          ;",
    mustFail: "S-113",
  },
  {
    id: "MUT-111", mutates: "future per-Team schema detection removed (reset-to-seed returns)",
    find: "  const hasFutureTeam = parsed && Array.isArray(parsed.teams) &&\n    parsed.teams.some((t) => t && typeof t.schemaVersion === \"number\" && t.schemaVersion > 1);",
    replace: "  const hasFutureTeam = false && parsed && Array.isArray(parsed.teams) &&\n    parsed.teams.some((t) => t && typeof t.schemaVersion === \"number\" && t.schemaVersion > 1);",
    mustFail: "S-114",
  },
  {
    id: "MUT-112", mutates: "settings/history deep validation dropped (object-ness accepted again)",
    find: "  if (!parsed || typeof parsed !== \"object\" || (validator && !validator(parsed))) {",
    replace: "  if (!parsed || typeof parsed !== \"object\") {",
    mustFail: "S-115",
  },
  {
    id: "MUT-113", mutates: "post-sanitization participant check removed",
    find: "        if (scr === \"game\" && sanSelected.length < 5) { fail(\"live game participant count impossible after sanitization\"); break restoreattempt; }",
    replace: "        if (false) { fail(\"live game participant count impossible after sanitization\"); break restoreattempt; }",
    mustFail: "S-116",
  },
  {
    id: "MUT-114", mutates: "v2 identity re-stamped by the current team on every save",
    find: "        selectedTeamId: gameIdentityRef.current.selectedTeamId,\n        teamNameAtGameTime: gameIdentityRef.current.teamNameAtGameTime,",
    replace: "        selectedTeamId: ACTIVE_TEAM.id,\n        teamNameAtGameTime: ACTIVE_TEAM.name,",
    mustFail: "S-118",
  },
  {
    id: "MUT-115", mutates: "legacy same-id conflict copy dropped from the merge",
    find: "      if (!byId.has(copyId)) byId.set(copyId, { ...loser, id: copyId });",
    replace: "      ;",
    mustFail: "S-119",
  },
  {
    id: "MUT-116", mutates: "import version gate removed (newer backups import again)",
    find: "        if (parsed && !Array.isArray(parsed) && typeof parsed.schemaVersion === \"number\" && parsed.schemaVersion > 1) {\n          showToast(\"Backup is from a newer app version — nothing imported\"); return;\n        }",
    replace: "        if (false) {\n          showToast(\"Backup is from a newer app version — nothing imported\"); return;\n        }",
    mustFail: "S-121",
  },
  {
    id: "MUT-117", mutates: "settings/history future-schema refusal goes silent again",
    find: "    storageNotices.push({ text: label + \" data was saved by a newer app version — its saving is off to protect it.\" });",
    replace: "    ;",
    mustFail: "S-122",
  },
  {
    id: "MUT-118", mutates: "envelope-path template entries skip validation (crashable entry listed)",
    find: "        : (parsed && Array.isArray(parsed.templates)) ? parsed.templates.filter(t => t && !t.deletedAt && validTemplateEntry(t)) : [];",
    replace: "        : (parsed && Array.isArray(parsed.templates)) ? parsed.templates : [];",
    mustFail: "S-123",
  },
  {
    id: "MUT-119", mutates: "teams write-path future-schema guard removed (mid-session downgrade returns)",
    find: "    if (stored && ((typeof stored.schemaVersion === \"number\" && stored.schemaVersion > 1) ||\n        (Array.isArray(stored.teams) && stored.teams.some((t) => t && typeof t.schemaVersion === \"number\" && t.schemaVersion > 1)))) {",
    replace: "    if (false) {",
    mustFail: "S-124",
  },
  {
    id: "MUT-120", mutates: "tracking-toggle completeness check removed from v2 validation",
    find: "            ![\"individualFouls\", \"teamFouls\", \"rebounds\", \"points\", \"gameNotes\"].every(k => typeof s.gameConfig.trackingToggles[k] === \"boolean\")) { fail(\"game settings malformed\"); break restoreattempt; }",
    replace: "            false) { fail(\"game settings malformed\"); break restoreattempt; }",
    mustFail: "S-125",
  },
  {
    id: "MUT-121", mutates: "v1 adapter regresses to today's edited team roster",
    find: "          s.gameRosterSnapshot = buildSeedEnvelope().teams[0].players;",
    replace: "          s.gameRosterSnapshot = getActiveTeam().players.filter(p => !p.deletedAt && p.jersey !== null);",
    mustFail: "S-127",
  },
  {
    id: "MUT-122", mutates: "tombstone core-field validation removed from import",
    find: "            const hasCore = t.grid !== undefined || t.playerCount !== undefined || t.halfMins !== undefined;\n            if (hasCore && !validTemplateEntry({ ...t, deletedAt: null })) { showToast(\"File contains damaged template data — nothing imported\"); return; }",
    replace: "            ;",
    mustFail: "S-128",
  },
  {
    id: "MUT-123", mutates: "roster playerId requirement removed from v2 validation",
    find: "            !s.gameRosterSnapshot.every(p => p && typeof p.jersey === \"number\" && typeof p.name === \"string\" && typeof p.playerId === \"string\" && p.playerId)) { fail(\"roster copy malformed\"); break restoreattempt; }",
    replace: "            !s.gameRosterSnapshot.every(p => p && typeof p.jersey === \"number\" && typeof p.name === \"string\")) { fail(\"roster copy malformed\"); break restoreattempt; }",
    mustFail: "S-126",
  },
];

function makeMutatedCopy(caseDef) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subplanner-sab-"));
  fs.mkdirSync(path.join(dir, "vendor"));
  for (const f of fs.readdirSync(path.join(REPO, "vendor"))) {
    fs.copyFileSync(path.join(REPO, "vendor", f), path.join(dir, "vendor", f));
  }
  // EOL-normalize BEFORE matching (Windows CRLF false-STALE lesson).
  const src = fs.readFileSync(path.join(REPO, "index.html"), "utf8").replace(/\r\n/g, "\n");
  const hits = src.split(caseDef.find).length - 1;
  if (hits !== 1) throw new Error(`${caseDef.id} is STALE: expected exactly 1 match for anchor, found ${hits}. Fix the case, do not skip.`);
  fs.writeFileSync(path.join(dir, "index.html"), src.replace(caseDef.find, caseDef.replace));
  return dir;
}

function runSentinel(appDir, sentinelId) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, "sentinels.js"), "--dir", appDir, "--only", sentinelId],
      { stdio: "pipe", timeout: 120000 });
    return { failed: false };
  } catch (e) {
    return { failed: true, out: String(e.stdout || "") };
  }
}

function main() {
  let caught = 0, missed = 0;
  for (const c of CASES) {
    const dir = makeMutatedCopy(c);
    try {
      const res = runSentinel(dir, c.mustFail);
      if (res.failed) { caught++; console.log(`CAUGHT  ${c.id}  (${c.mustFail} failed as required) — ${c.mutates}`); }
      else { missed++; console.log(`MISSED  ${c.id}  (${c.mustFail} stayed green with the mutation applied) — ${c.mutates}`); }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(`\n${caught} CAUGHT / ${missed} MISSED of ${CASES.length}`);
  process.exit(missed ? 1 : 0);
}

main();
