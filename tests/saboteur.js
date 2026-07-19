// Saboteur — proves the sentinels actually catch bugs (Wave 1.a scoped harness proof).
// Copies the app to a TEMP dir, plants ONE bug at a time, and requires the targeted
// sentinel to FAIL. The live tree is NEVER mutated. Run in FOREGROUND only.
// Run: node tests/saboteur.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");

// Each case: unique exact match on the LF-normalized source (match count is verified
// first — a non-match means STALE case, which is a loud error, never a skip).
const CASES = [
  {
    id: "SAB-001", plants: "restore ignores the saved screen (refresh loses the live game)",
    find: "if (s.screen) setScreen(s.screen);",
    replace: "if (false && s.screen) setScreen(s.screen);",
    mustFail: "S-004",
  },
  {
    id: "SAB-002", plants: "future-schema guard removed (newer save gets clobbered)",
    find: "if (sv > SUPPORTED_SCHEMA) {",
    replace: "if (false) {",
    mustFail: "S-005",
  },
  {
    id: "SAB-003", plants: "saveTemplate silently drops the new entry",
    find: "if (persistTemplateChange([entry], `Saved \"${entry.name}\" (${playerCount} players)`)) {",
    replace: "if (persistTemplateChange([], `Saved \"${entry.name}\" (${playerCount} players)`)) {",
    mustFail: "S-006",
  },
  {
    id: "SAB-004", plants: "one player vanishes from the setup roster",
    find: "{ROSTER.map(p => {",
    replace: "{ROSTER.slice(0, 8).map(p => {",
    mustFail: "S-002",
  },
  // ── Wave 1 cases (one planted bug per new behaviour) ──
  {
    id: "SAB-101", plants: "seed migration uses live timestamps (breaks byte-identical determinism)",
    find: "rev: 1, createdAt: SEED_TS, updatedAt: SEED_TS, deletedAt: null, restoredAt: null,",
    replace: "rev: 1, createdAt: nowIso(), updatedAt: SEED_TS, deletedAt: null, restoredAt: null,",
    mustFail: "S-101",
  },
  {
    id: "SAB-102", plants: "v1→v2 adapter drops the legacy game's halfMins (16-min game resumes as 20)",
    find: "            halfMins: s.halfMins,",
    replace: "            halfMins: 20,",
    mustFail: "S-103",
  },
  {
    id: "SAB-103", plants: "template migration keeps the abolished playerOrder/attendanceSignature fields",
    find: "  const { playerOrder, attendanceSignature, ...rest } = t;\n  return rest;",
    replace: "  const { playerOrder, attendanceSignature, ...rest } = t;\n  return t;",
    mustFail: "S-104",
  },
  {
    id: "SAB-104", plants: "quarantine heals WITHOUT preserving the damaged payload first",
    find: "  const copied = quarantineRaw(key, raw);\n  if (copied) {",
    replace: "  const copied = true;\n  if (copied) {",
    mustFail: "S-105",
  },
  {
    id: "SAB-105", plants: "roster silently falls back to the hardcoded seed (ignores stored team edits)",
    find: "const ACTIVE_TEAM = getActiveTeam();",
    replace: "const ACTIVE_TEAM = buildSeedEnvelope().teams[0];",
    mustFail: "S-102",
  },
  {
    id: "SAB-106", plants: "template delete regresses to a splice (no tombstone in storage)",
    find: "    persistTemplateChange([{ ...t, deletedAt: nowIso(), rev: (t.rev || 0) + 1, updatedAt: nowIso() }], \"Template deleted\");",
    replace: "    persistTemplateChange([{ ...t, deletedAt: null, rev: (t.rev || 0) + 1, updatedAt: nowIso() }], \"Template deleted\");",
    mustFail: "S-107",
  },
  {
    id: "SAB-107", plants: "D-9 participant cap removed from hydration validation",
    find: "        if (s.selected.length > MAX_PARTICIPANTS) { fail(\"too many participants\"); break restoreattempt; }",
    replace: "        if (false) { fail(\"too many participants\"); break restoreattempt; }",
    mustFail: "S-108",
  },
  {
    id: "SAB-108", plants: "hasSavedGame regresses to plan-only (start5 saves invisible again)",
    find: "        if (s.screen && s.screen !== \"setup\") { setHasSavedGame(true); savedScreenRef.current = s.screen; }",
    replace: "        if (s.plan && s.screen && s.screen !== \"setup\") { setHasSavedGame(true); savedScreenRef.current = s.screen; }",
    mustFail: "S-111",
  },
  {
    // NOTE: removing the STAGE-1 order check alone is an equivalent mutant — the
    // post-sanitization layer still quarantines the same states (defence in depth,
    // verified 19 Jul). This case therefore targets the sanitized-check layer,
    // whose removal IS observable (S-117).
    id: "SAB-109", plants: "post-sanitization order/grid mismatch check removed",
    find: "          if (sanOrder.length !== s.gridPlayerOrderJerseys.length || sanOrder.length !== gridCols) { fail(\"plan player order does not match its grid\"); break restoreattempt; }",
    replace: "          if (false) { fail(\"plan player order does not match its grid\"); break restoreattempt; }",
    mustFail: "S-117",
  },
  {
    id: "SAB-110", plants: "future-version game save blocks silently again (no banner)",
    find: "          storageNotices.push({ text: \"A game saved by a NEWER app version is stored here. NOT SAVING games this session to protect it — update the app or discard from the newer version.\" });",
    replace: "          ;",
    mustFail: "S-113",
  },
  {
    id: "SAB-111", plants: "future per-Team schema detection removed (reset-to-seed returns)",
    find: "  const hasFutureTeam = parsed && Array.isArray(parsed.teams) &&\n    parsed.teams.some((t) => t && typeof t.schemaVersion === \"number\" && t.schemaVersion > 1);",
    replace: "  const hasFutureTeam = false && parsed && Array.isArray(parsed.teams) &&\n    parsed.teams.some((t) => t && typeof t.schemaVersion === \"number\" && t.schemaVersion > 1);",
    mustFail: "S-114",
  },
  {
    id: "SAB-112", plants: "settings/history deep validation dropped (object-ness accepted again)",
    find: "  if (!parsed || typeof parsed !== \"object\" || (validator && !validator(parsed))) {",
    replace: "  if (!parsed || typeof parsed !== \"object\") {",
    mustFail: "S-115",
  },
  {
    id: "SAB-113", plants: "post-sanitization participant check removed",
    find: "        if (scr === \"game\" && sanSelected.length < 5) { fail(\"live game participant count impossible after sanitization\"); break restoreattempt; }",
    replace: "        if (false) { fail(\"live game participant count impossible after sanitization\"); break restoreattempt; }",
    mustFail: "S-116",
  },
  {
    id: "SAB-114", plants: "v2 identity re-stamped by the current team on every save",
    find: "        selectedTeamId: gameIdentityRef.current.selectedTeamId,\n        teamNameAtGameTime: gameIdentityRef.current.teamNameAtGameTime,",
    replace: "        selectedTeamId: ACTIVE_TEAM.id,\n        teamNameAtGameTime: ACTIVE_TEAM.name,",
    mustFail: "S-118",
  },
  {
    id: "SAB-115", plants: "legacy same-id conflict copy dropped from the merge",
    find: "      if (!byId.has(copyId)) byId.set(copyId, { ...loser, id: copyId });",
    replace: "      ;",
    mustFail: "S-119",
  },
  {
    id: "SAB-116", plants: "import version gate removed (newer backups import again)",
    find: "        if (parsed && !Array.isArray(parsed) && typeof parsed.schemaVersion === \"number\" && parsed.schemaVersion > 1) {\n          showToast(\"Backup is from a newer app version — nothing imported\"); return;\n        }",
    replace: "        if (false) {\n          showToast(\"Backup is from a newer app version — nothing imported\"); return;\n        }",
    mustFail: "S-121",
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
  let caught = 0, blind = 0;
  for (const c of CASES) {
    const dir = makeMutatedCopy(c);
    try {
      const res = runSentinel(dir, c.mustFail);
      if (res.failed) { caught++; console.log(`CAUGHT  ${c.id}  (${c.mustFail} failed as required) — ${c.plants}`); }
      else { blind++; console.log(`BLIND!  ${c.id}  (${c.mustFail} stayed green with the bug planted) — ${c.plants}`); }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(`\n${caught} CAUGHT / ${blind} BLIND of ${CASES.length}`);
  process.exit(blind ? 1 : 0);
}

main();
