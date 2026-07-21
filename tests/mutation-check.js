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
    find: "{gameRoster.map(p => {",
    replace: "{gameRoster.slice(0, 8).map(p => {",
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
    id: "MUT-105", mutates: "team selection's roster copy reads the hardcoded seed, not the stored team (ignores edits)",
    find: "    const roster = team.players\n      .filter((p) => !p.deletedAt && !p.needsJersey && p.jersey !== null)",
    replace: "    const roster = buildSeedEnvelope().teams[0].players\n      .filter((p) => !p.deletedAt && !p.needsJersey && p.jersey !== null)",
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
    id: "MUT-108", mutates: "game-in-flight regresses to live-only (start5 saves invisible on the landing again)",
    find: "        setGameInFlight(true);\n        savedScreenRef.current = s.screen;",
    replace: "        if (s.screen === \"game\") setGameInFlight(true);\n        savedScreenRef.current = s.screen;",
    mustFail: "S-111",
  },
  {
    // NOTE: the milestone fix added a grid-SHAPE check (M-010) that now ALSO
    // catches S-117's ragged-order-vs-grid state, so removing the older
    // post-sanitization order check alone is an equivalent mutant (defence in
    // depth). This case targets the grid-shape check, which uniquely fires for
    // S-117's scenario (a 2-entry order against a wider grid).
    id: "MUT-109", mutates: "grid-shape validation removed (ragged/wrong-width grid hydrates)",
    find: "            if (s.editableGrid.length !== s.gameConfig.halfMins * 2 ||\n                !s.editableGrid.every(row => Array.isArray(row) && row.length === width && row.every(c => typeof c === \"boolean\"))) { fail(\"plan grid malformed\"); break restoreattempt; }",
    replace: "            if (false) { fail(\"plan grid malformed\"); break restoreattempt; }",
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
    find: "      selectedTeamId: gameIdentityRef.current.selectedTeamId,\n      teamNameAtGameTime: gameIdentityRef.current.teamNameAtGameTime,",
    replace: "      selectedTeamId: getActiveTeam().id,\n      teamNameAtGameTime: getActiveTeam().name,",
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
    find: "            const hasCore = t.name !== undefined || t.grid !== undefined || t.playerCount !== undefined || t.halfMins !== undefined;\n            if (hasCore && !validTemplateEntry({ ...t, deletedAt: null })) { showToast(\"File contains damaged template data — nothing imported\"); return; }",
    replace: "            const hasCore = false;\n            if (hasCore && !validTemplateEntry({ ...t, deletedAt: null })) { showToast(\"File contains damaged template data — nothing imported\"); return; }",
    mustFail: "S-128",
  },
  {
    id: "MUT-123", mutates: "roster playerId requirement removed from v2 validation",
    find: "          typeof p.playerId === \"string\" && p.playerId &&\n          finiteNum(p.rating) && p.rating >= 1 && p.rating <= 5 &&",
    replace: "          finiteNum(p.rating) && p.rating >= 1 && p.rating <= 5 &&",
    mustFail: "S-126",
  },
  // ── Wave 2 cases (one planted bug per new behaviour — spec §4 Wave 2) ──
  {
    id: "MUT-201", mutates: "landing screen skipped — app boots straight into setup again",
    find: "const [appMode, setAppMode] = useState(\"landing\");",
    replace: "const [appMode, setAppMode] = useState(\"app\");",
    mustFail: "S-201",
  },
  {
    // NOTE: with the sync selection write skipped, the ordinary save effect
    // still persists an identical snapshot moments later — an equivalent mutant
    // on the happy path (verified 20 Jul, same class as MUT-109). The gate's
    // observable layer is the FAILURE path: without it, setup opens on
    // memory-only state when the write throws — which S-220 catches.
    id: "MUT-202", mutates: "team selection enters setup without persisting (gate skipped — failure path exposed)",
    find: "    const ok = persistSnapshotNow({\n      screen: \"setup\",",
    replace: "    const ok = true || persistSnapshotNow({\n      screen: \"setup\",",
    mustFail: "S-220",
  },
  {
    id: "MUT-203", mutates: "hydration re-reads the saved team instead of adopting the snapshot's pinned roster",
    find: "        const snapRoster = s.gameRosterSnapshot;",
    replace: "        const snapRoster = getActiveTeam().players.filter(p => !p.deletedAt && p.jersey !== null);",
    mustFail: "S-203",
  },
  {
    id: "MUT-204", mutates: "landing's Manage Teams lock ignores snapshot existence",
    find: "    const snapExists = gameInFlight || blockedSave;",
    replace: "    const snapExists = false;",
    mustFail: "S-204",
  },
  {
    id: "MUT-205", mutates: "commit-time snapshot re-check removed from Manage Teams mutations",
    find: "  function manageGuardBlocked() {\n    return gameSnapshotExists() ? \"Finish or discard the current game first\" : null;\n  }",
    replace: "  function manageGuardBlocked() {\n    return null;\n  }",
    mustFail: "S-207",
  },
  {
    id: "MUT-206", mutates: "active team-name uniqueness check removed",
    find: "    if (others.some((t) => normalizeTeamName(t.name) === normalizeTeamName(name)))\n      errors.push(`A team called \"${name}\" already exists`);",
    replace: "    ;",
    mustFail: "S-206",
  },
  {
    id: "MUT-207", mutates: "jersey uniqueness check removed from the Manage player dialog",
    find: "                        const clash = kept.some((p, i) => manageDraft.players.indexOf(p) !== managePlayerEdit.index && p.jersey === v.player.jersey);",
    replace: "                        const clash = false;",
    mustFail: "S-206",
  },
  {
    id: "MUT-208", mutates: "team delete stops tombstoning (record left active in storage)",
    find: "teams: [{ ...team, deletedAt: ts, rev: team.rev + 1, updatedAt: ts }] })",
    replace: "teams: [{ ...team, deletedAt: null, rev: team.rev + 1, updatedAt: ts }] })",
    mustFail: "S-208",
  },
  {
    id: "MUT-209", mutates: "last-active-team delete guard removed",
    find: "    if (listActiveTeams().filter((t) => t.id !== team.id).length === 0) {",
    replace: "    if (false) {",
    mustFail: "S-208",
  },
  {
    id: "MUT-210", mutates: "guest jersey uniqueness shrinks to selected players only (deselected #8 loses her number)",
    find: "    if (v.player.jersey !== null && gameRoster.some((p) => p.jersey === v.player.jersey))\n      errors.push(`#${v.player.jersey} is already taken in this game — pick a free number`);",
    replace: "    if (v.player.jersey !== null && gameRoster.some((p) => selected.has(p.jersey) && p.jersey === v.player.jersey))\n      errors.push(`#${v.player.jersey} is already taken in this game — pick a free number`);",
    mustFail: "S-209",
  },
  {
    id: "MUT-211", mutates: "a >10 roster auto-selects everyone (Codex R12 regression)",
    find: "    const selInit = roster.length <= MAX_PARTICIPANTS ? roster.map((p) => p.jersey) : [];",
    replace: "    const selInit = roster.map((p) => p.jersey);",
    mustFail: "S-210",
  },
  {
    id: "MUT-212", mutates: "the 11th participant is admitted without the cap message",
    find: "    if (!selected.has(jersey) && selected.size >= MAX_PARTICIPANTS) {\n      setCapMsg(`Up to ${MAX_PARTICIPANTS} girls can play in one game — untick someone first`);\n      return;\n    }",
    replace: "    if (false) {\n      setCapMsg(`Up to ${MAX_PARTICIPANTS} girls can play in one game — untick someone first`);\n      return;\n    }",
    mustFail: "S-210",
  },
  {
    id: "MUT-213", mutates: "repair-on-load stops replaying committed ops",
    find: "    const post = replayCommittedOp(cur);",
    replace: "    const post = null;",
    mustFail: "S-213",
  },
  {
    id: "MUT-214", mutates: "prepared-op recovery rolls FORWARD unconditionally (ghost half-edits applied)",
    find: "      if (opEffectInSnapshot(cur, snap)) {",
    replace: "      if (true || opEffectInSnapshot(cur, snap)) {",
    mustFail: "S-214",
  },
  {
    id: "MUT-215", mutates: "availability toggles stop marking the plan stale",
    find: "    // §4 W2 plan staleness: an availability toggle changes the participating\n    // count — a pre-game plan built on the old count is stale (round-5 widening).\n    if (!(screen === \"game\" || (gameSecs > 0 && !gameOver)) && (rotationPlan || editableGrid)) setPlanStale(true);",
    replace: "    ;",
    mustFail: "S-215",
  },
  {
    id: "MUT-216", mutates: "reconciliation loses playerId identity (renumbered girl dropped from selections)",
    find: "    const nextSelected = remapArr([...selected]);",
    replace: "    const nextSelected = [...selected].filter((j) => newRoster.some((p) => p.jersey === j));",
    mustFail: "S-216",
  },
  {
    id: "MUT-217", mutates: "a removed girl's grid column survives (grid/order divergence)",
    find: "      if (editableGrid) nextGrid = editableGrid.map((row) => keptIdx.map((i) => row[i]));",
    replace: "      if (false) nextGrid = editableGrid.map((row) => keptIdx.map((i) => row[i]));",
    mustFail: "S-217",
  },
  {
    id: "MUT-218", mutates: "empty state lost — New Game offered with zero active teams",
    find: "          ) : activeTeams.length > 0 ? (",
    replace: "          ) : true ? (",
    mustFail: "S-218",
  },
  {
    id: "MUT-219", mutates: "New Game silently discards the saved game (no save/discard prompt)",
    find: "    if (gameInFlight || blockedSave || gameSnapshotExists()) { setNewGamePrompt(true); return; }",
    replace: "    if (false) { setNewGamePrompt(true); return; }",
    mustFail: "S-219",
  },
  {
    id: "MUT-220", mutates: "selection persist-gate ignores write failure (setup editable on memory-only state)",
    find: "    if (!ok) {\n      // Persist-gate failure: there is NO path onto the setup screen without a\n      // persisted pending snapshot — block with banner + retry.\n      setSelectionError({ teamId, reason: \"save\" });\n      return;\n    }",
    replace: "    if (false) {\n      setSelectionError({ teamId, reason: \"save\" });\n      return;\n    }",
    mustFail: "S-220",
  },
  {
    id: "MUT-221", mutates: "permanent edits stop replaying into the saved team (journal decorative)",
    find: "      const post = replayCommittedOp(committed);",
    replace: "      const post = null;",
    mustFail: "S-212",
  },
  // ── Wave 2 audit round 1 (Codex-found coverage gaps + fixes) ──
  {
    id: "MUT-222", mutates: "landing Manage-Teams lock ignores the blockedSave (future-schema) branch",
    find: "    const snapExists = gameInFlight || blockedSave;",
    replace: "    const snapExists = gameInFlight;",
    mustFail: "S-221",
  },
  {
    id: "MUT-223", mutates: "gameIsLive falls back to the clock proxy — a live game at 0:00 reads as pre-game",
    find: "  const gameIsLive = screen === \"game\" || ((gameStarted || gameSecs > 0) && !gameOver);",
    replace: "  const gameIsLive = screen === \"game\" || (gameSecs > 0 && !gameOver);",
    mustFail: "S-222",
  },
  {
    id: "MUT-224", mutates: "flag-absent hydration stops deriving gameStarted from tip-off state (old saves resume as pre-game)",
    find: "        else setGameStarted(Array.isArray(s.onCourt) && s.onCourt.length > 0);",
    replace: "        else setGameStarted(false);",
    mustFail: "S-223",
  },
  // ── Milestone audit fix cases (MUT-225+) ──
  {
    id: "MUT-225", mutates: "M-006: merge writer nulls a corrupt stored value and overwrites it (no quarantine)",
    find: "    if (raw !== null && (parseFailed || (stored && !validTeamsEnvelope(stored)))) {\n      // Mid-session corruption: preserve-then-recover, never null-and-overwrite.\n      const healed = quarantineAndHeal(TEAMS_KEY, raw, JSON.stringify(canonicalizeEnvelope(buildSeedEnvelope())), \"Saved team data was damaged.\");\n      if (healed !== \"healed\") return false; // key blocked; §5.1 banner is up\n      try { stored = JSON.parse(safeGet(TEAMS_KEY)); } catch (e) { return false; }\n    }",
    replace: "    if (stored && !validTeamsEnvelope(stored)) stored = null;",
    mustFail: "S-224",
  },
  {
    id: "MUT-226", mutates: "M-037: repair envelope validator accepts any schemaVersion (future journal replays)",
    find: "  return env && typeof env === \"object\" && env.schemaVersion === 1 &&\n    Array.isArray(env.ops) && env.ops.every(validRepairOp);",
    replace: "  return env && typeof env === \"object\" && typeof env.schemaVersion === \"number\" &&\n    Array.isArray(env.ops) && env.ops.every(validRepairOp);",
    mustFail: "S-225",
  },
  {
    id: "MUT-227", mutates: "M-046: repair op payload not whitelisted (tombstone-via-edit smuggling)",
    find: "  const allowed = OP_PAYLOAD_FIELDS[o.type];\n  return Object.keys(o.payload).every((k) => allowed.includes(k));",
    replace: "  return true;",
    mustFail: "S-226",
  },
  {
    id: "MUT-228", mutates: "M-039: teams read state stops refusing future-version envelopes",
    find: "      if (parsed && ((typeof parsed.schemaVersion === \"number\" && parsed.schemaVersion > 1) ||\n          (Array.isArray(parsed.teams) && parsed.teams.some((t) => t && typeof t.schemaVersion === \"number\" && t.schemaVersion > 1)))) {\n        return { state: \"future\", teams: [] };\n      }",
    replace: "      if (false) { return { state: \"future\", teams: [] }; }",
    mustFail: "S-227",
  },
  {
    id: "MUT-229", mutates: "M-076: teams read state has no in-memory fallback (blocked key locks out games)",
    find: "    return { state: \"fallback\", teams: [getActiveTeam()] };",
    replace: "    return { state: \"empty\", teams: [] };",
    mustFail: "S-228",
  },
  {
    id: "MUT-230", mutates: "M-060: live hydration accepts duplicate/NaN/non-participant accounting state",
    find: "          if (new Set(sanOnCourt).size !== sanOnCourt.length) { fail(\"duplicate players on court\"); break restoreattempt; }",
    replace: "          if (false) { fail(\"duplicate players on court\"); break restoreattempt; }",
    mustFail: "S-229",
  },
  {
    id: "MUT-231", mutates: "M-011: rotationPlan content validation removed (malformed plan hydrates)",
    find: "          if (!rpOk) { fail(\"rotation plan malformed\"); break restoreattempt; }",
    replace: "          if (false) { fail(\"rotation plan malformed\"); break restoreattempt; }",
    mustFail: "S-230",
  },
  {
    id: "MUT-232", mutates: "M-053: New Game skips the fresh snapshot-existence re-read",
    find: "    if (gameInFlight || blockedSave || gameSnapshotExists()) { setNewGamePrompt(true); return; }",
    replace: "    if (gameInFlight || blockedSave) { setNewGamePrompt(true); return; }",
    mustFail: "S-231",
  },
  {
    id: "MUT-233", mutates: "M-012: half-length change no longer marks an existing plan stale",
    find: "    if (rotationPlan || editableGrid) setPlanStale(true);\n    setPlannedTimeouts((prev) => new Set([...prev].filter((m) => m < next * 2)));",
    replace: "    if (false) setPlanStale(true);\n    setPlannedTimeouts((prev) => new Set([...prev].filter((m) => m < next * 2)));",
    mustFail: "S-232",
  },
  {
    id: "MUT-234", mutates: "M-041: added player gets no grid column (kept plan leaves her unschedulable)",
    find: "      const inOrder = new Set(nextOrder.map((p) => p.playerId));\n      for (const np of newRoster) {\n        if (!inOrder.has(np.playerId)) {\n          nextOrder = [...nextOrder, np];\n          if (nextGrid) nextGrid = nextGrid.map((row) => [...row, false]);\n        }\n      }",
    replace: "      ;",
    mustFail: "S-233",
  },
  {
    id: "MUT-235", mutates: "M-049: score panel reverts to hardcoded ROADIES",
    find: "                <div style={{ color: \"#4ade80\", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: \"uppercase\", overflow: \"hidden\", textOverflow: \"ellipsis\", whiteSpace: \"nowrap\" }}>{gameIdentityRef.current.teamNameAtGameTime || \"Our Team\"}</div>",
    replace: "                <div style={{ color: \"#4ade80\", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>ROADIES</div>",
    mustFail: "S-234",
  },
  {
    id: "MUT-236", mutates: "M-086: rewind correction reverts to snap-without-accumulated (phantom minutes)",
    find: "  function applyRewindCourtTime(prevSecs, clamped) {\n    if (clamped >= prevSecs || onCourt.length === 0) return;",
    replace: "  function applyRewindCourtTime(prevSecs, clamped) {\n    if (true || clamped >= prevSecs || onCourt.length === 0) return;",
    mustFail: "S-235",
  },
  {
    id: "MUT-237", mutates: "M-013: export stops filtering out damaged entries (un-restorable backup)",
    find: "      return validTemplateEntry(t);\n    });\n    const skipped = allEntries.length - exportable.length;",
    replace: "      return true;\n    });\n    const skipped = allEntries.length - exportable.length;",
    mustFail: "S-236",
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
  // --only MUT-001,MUT-2xx filter: run a subset in FOREGROUND chunks. The wave
  // gate is still the FULL suite (run every chunk); this only bounds one
  // invocation's wall-clock.
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--only");
  let cases = CASES;
  if (onlyIdx >= 0) {
    const wanted = args[onlyIdx + 1].split(",");
    cases = CASES.filter((c) => wanted.some((w) => w.endsWith("x") ? c.id.startsWith(w.slice(0, -1)) : c.id === w));
    if (!cases.length) { console.error("no case matches " + args[onlyIdx + 1]); process.exit(2); }
  }
  let caught = 0, missed = 0;
  for (const c of cases) {
    const dir = makeMutatedCopy(c);
    try {
      const res = runSentinel(dir, c.mustFail);
      if (res.failed) { caught++; console.log(`CAUGHT  ${c.id}  (${c.mustFail} failed as required) — ${c.mutates}`); }
      else { missed++; console.log(`MISSED  ${c.id}  (${c.mustFail} stayed green with the mutation applied) — ${c.mutates}`); }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(`\n${caught} CAUGHT / ${missed} MISSED of ${cases.length}`);
  process.exit(missed ? 1 : 0);
}

main();
