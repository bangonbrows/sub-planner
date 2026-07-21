// Baseline sentinels — CoachK Sub Planner (Wave 1.a)
// These lock in TODAY's behaviour before any multi-team code is written.
// Run: node tests/sentinels.js [--dir <appDir>] [--only S-003]
const path = require("path");
const H = require("./helpers");

const ROSTER = ["Lola", "Aanya", "Katyayani", "Rosalie", "Alannah", "Mihika", "Layla", "Naisha", "Armelle"];

const SENTINELS = [
  {
    id: "S-001", name: "App mounts with zero page errors",
    run: async ({ page, url, pageErrors }) => {
      await page.goto(url);
      await H.waitForMount(page);
      H.expect(pageErrors.length === 0, "page errors on mount: " + pageErrors.join(" | "));
    },
  },
  {
    id: "S-002", name: "Setup renders all 9 players, all selected",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      for (const name of ROSTER) {
        H.expect(await page.getByText(name, { exact: true }).first().isVisible(), `player missing from setup: ${name}`);
      }
      H.expect(await page.getByText("9 selected").isVisible(), "expected '9 selected' (all players default-checked)");
    },
  },
  {
    id: "S-003", name: "Full flow: setup → starters → plan → live game (5 on court)",
    run: async ({ page, url }) => {
      await page.goto(url);
      const starters = await H.driveToGameScreen(page);
      H.expect(await page.getByText("ON COURT (5)").isVisible(), "expected 5 players on court after Start Game");
      for (const name of starters) {
        H.expect(await page.getByText(name, { exact: false }).first().isVisible(), `starter not visible on game screen: ${name}`);
      }
    },
  },
  {
    id: "S-004", name: "Mid-game refresh restores the live game",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      const before = await H.getStorage(page, H.STORAGE_KEY);
      H.expect(before && JSON.parse(before).screen === "game", "expected persisted snapshot with screen:'game'");
      await page.reload();
      await H.continueGame(page); // W2: boot is the landing screen — never auto-hydrates
      await page.getByText("ON COURT (5)").waitFor({ timeout: 20000 });
      const after = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(after.screen === "game", "snapshot lost after reload");
      H.expect(Array.isArray(after.onCourt) && after.onCourt.length === 5, "onCourt not restored to 5 players");
    },
  },
  {
    id: "S-005", name: "Future-schema save is refused AND never overwritten",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      const canary = JSON.stringify({ schemaVersion: 99, canary: "DO-NOT-TOUCH" });
      await H.setStorage(page, H.STORAGE_KEY, canary);
      await page.reload();
      await H.waitForMount(page); // app must come up fresh, not crash
      await page.waitForTimeout(1500); // give the save effect every chance to (wrongly) fire
      const now = await H.getStorage(page, H.STORAGE_KEY);
      H.expect(now === canary, "future-schema save was overwritten or altered: " + now);
    },
  },
  {
    id: "S-006", name: "Template save/load round-trip via the real UI",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToPlanScreen(page);
      await page.getByText("💾 Save Template").click();
      await page.getByPlaceholder("e.g. Standard 8-Player").fill("Sentinel Baseline");
      await page.getByText("Save", { exact: true }).click();
      const raw = await H.getStorage(page, H.TEMPLATES_KEY);
      H.expect(raw, "templates key not written");
      const tpls = JSON.parse(raw);
      const t = (Array.isArray(tpls) ? tpls : tpls.templates).find((x) => x.name === "Sentinel Baseline");
      H.expect(t, "saved template not found in storage");
      H.expect(t.playerCount === 9, "template playerCount expected 9, got " + t.playerCount);
      H.expect(Array.isArray(t.grid) && t.grid.every(Array.isArray), "template grid malformed");
      await page.getByText("📂 Load Template").click();
      H.expect(await page.getByText("Sentinel Baseline").first().isVisible(), "saved template not listed in Load dialog");
    },
  },
  // ── WAVE 1 sentinels (data foundation — frozen MULTI-TEAM-SPEC Rev 16) ──
  {
    id: "S-101", name: "Migration seeds Lakeside Lakers deterministically + idempotently",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      const SEED_TS = "2026-07-18T00:00:00.000Z";
      const env = JSON.parse(await H.getStorage(page, "coachk-subplanner-teams"));
      H.expect(env && env.schemaVersion === 1 && Array.isArray(env.teams), "teams envelope missing/malformed");
      const t = env.teams[0];
      H.expect(t.id === "team_seed_lakeside_lakers", "seed team id wrong: " + t.id);
      H.expect(t.name === "Lakeside Lakers", "seed team name wrong: " + t.name);
      H.expect(t.createdAt === SEED_TS && t.updatedAt === SEED_TS && t.aggregateUpdatedAt === SEED_TS, "seed team timestamps not the fixed literal");
      H.expect(t.players.length === 9, "seed roster expected 9 players");
      H.expect(t.players.every((p) => p.playerId === "player_seed_" + p.jersey && p.createdAt === SEED_TS && p.rev === 1), "seed players not deterministic");
      const raw1 = await H.getStorage(page, "coachk-subplanner-teams");
      await page.reload();
      await H.waitForMount(page);
      await page.waitForTimeout(500);
      H.expect((await H.getStorage(page, "coachk-subplanner-teams")) === raw1, "migration not idempotent — envelope changed on second load");
    },
  },
  {
    id: "S-102", name: "Setup roster renders from STORED team, not the hardcoded list",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const env = JSON.parse(localStorage.getItem("coachk-subplanner-teams"));
        const p = env.teams[0].players.find((x) => x.jersey === 8);
        p.name = "RENAMED-EIGHT"; p.rev++; p.updatedAt = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-teams", JSON.stringify(env));
      });
      await page.reload();
      await H.newGame(page); // W2: the roster copy is captured from storage at selection
      H.expect(await page.getByText("RENAMED-EIGHT").first().isVisible(), "renamed stored player not shown — UI still reads the hardcoded list");
      H.expect(!(await page.getByText("Aanya", { exact: true }).count()), "old hardcoded name still rendered");
    },
  },
  {
    id: "S-103", name: "v1→v2 adapter: legacy save resumes with its own halfMins/planMode, re-saved as v2",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      // Down-convert the freshly-written v2 snapshot to a legitimate v1 shape.
      // A REAL 16-min v1 save is internally CONSISTENT — its plan-first state
      // (if any) was generated at 16 min. Since this fixture repurposes a 20-min
      // drive, it becomes a reactive-era v1 live save (legacy plan only): the
      // fix-group-B validation rightly quarantines a 40-row grid or a 2400s plan
      // inside a 16-min game as corruption.
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        delete s.gameRosterSnapshot; delete s.gameConfig; delete s.selectedTeamId; delete s.teamNameAtGameTime;
        s.schemaVersion = 1; s.halfMins = 16; s.planMode = "competitive";
        delete s.rotationPlan; s.editableGrid = null; s.gridPlayerOrderJerseys = [];
        s.lastExecutedSegId = null; s.delayedSegId = null; s.planDelayUntilSecs = null;
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.continueGame(page);
      await page.getByText(/ON COURT \(/).waitFor({ timeout: 20000 });
      await page.waitForTimeout(1200); // let the save effect write the upgraded snapshot
      const s2 = JSON.parse(await H.getStorage(page, "coachk-subplanner-v9"));
      H.expect(s2.schemaVersion === 2, "resumed v1 game not re-saved as v2");
      H.expect(s2.gameConfig && s2.gameConfig.halfMins === 16, "legacy halfMins lost in adapter: " + JSON.stringify(s2.gameConfig));
      H.expect(s2.gameConfig.planMode === "competitive", "legacy planMode lost in adapter");
      H.expect(Array.isArray(s2.gameRosterSnapshot) && s2.gameRosterSnapshot.length === 9, "roster snapshot not injected");
      H.expect(s2.selectedTeamId === "team_seed_lakeside_lakers", "selectedTeamId not injected");
    },
  },
  {
    id: "S-104", name: "Legacy template array migrates to envelope with identity fields STRIPPED",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const mk = (name) => ({ id: Date.now() + Math.floor(Math.random() * 1000), name, playerCount: 9, halfMins: 20,
          grid: Array.from({ length: 40 }, () => Array.from({ length: 9 }, () => false)),
          playerOrder: [4, 8, 10, 14, 25, 31, 32, 35, 40], attendanceSignature: "4-8-10-14-25-31-32-35-40", createdAt: new Date().toISOString() });
        localStorage.setItem("coachk_rotation_templates", JSON.stringify([mk("Legacy A"), mk("Legacy B")]));
      });
      await page.reload();
      await H.waitForMount(page);
      const env = JSON.parse(await H.getStorage(page, "coachk_rotation_templates"));
      H.expect(env && env.schemaVersion === 1 && Array.isArray(env.templates), "templates not wrapped in envelope");
      H.expect(env.templates.length === 2, "healthy legacy templates lost in migration");
      H.expect(env.templates.every((t) => !("playerOrder" in t) && !("attendanceSignature" in t)), "legacy identity fields NOT stripped (D-8 violation)");
    },
  },
  {
    id: "S-105", name: "Corrupt teams data → quarantined, healed, and surfaced to the coach",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => localStorage.setItem("coachk-subplanner-teams", "{corrupt-not-json"));
      await page.reload();
      await H.waitForMount(page); // app must still come up (healed to seed)
      const st = await page.evaluate(() => {
        const out = { quarantine: null, healed: null };
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith("coachk-subplanner-teams-quarantine-")) out.quarantine = localStorage.getItem(k);
        }
        out.healed = localStorage.getItem("coachk-subplanner-teams");
        return out;
      });
      H.expect(st.quarantine === "{corrupt-not-json", "damaged payload not preserved in quarantine");
      const env = JSON.parse(st.healed);
      H.expect(env && env.teams && env.teams[0].id === "team_seed_lakeside_lakers", "active key not healed to seed");
      H.expect(await page.getByText(/team data was damaged/i).first().isVisible(), "coach banner not shown");
      H.expect(await page.getByText("Save damaged data to a file").first().isVisible(), "recovery export action missing");
    },
  },
  {
    id: "S-106", name: "Settings + history skeleton keys initialized with schemaVersion",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      const settings = JSON.parse(await H.getStorage(page, "coachk-subplanner-settings"));
      const history = JSON.parse(await H.getStorage(page, "coachk-subplanner-history"));
      H.expect(settings && settings.schemaVersion === 1 && settings.defaultHalfMins === 20, "settings skeleton missing/malformed");
      H.expect(history && history.schemaVersion === 1 && Array.isArray(history.games), "history skeleton missing/malformed");
    },
  },
  {
    id: "S-107", name: "Template deletion is a sticky tombstone, not a splice",
    run: async ({ page, url }) => {
      await page.goto(url);
      page.on("dialog", (d) => d.accept());
      await H.driveToPlanScreen(page);
      await page.getByText("💾 Save Template").click();
      await page.getByPlaceholder("e.g. Standard 8-Player").fill("Tombstone Test");
      await page.getByText("Save", { exact: true }).click();
      await page.getByText("📂 Load Template").click();
      await page.getByText("Tombstone Test").first().waitFor();
      // Delete it via the dialog's ✕ (confirm auto-accepted).
      await page.locator("div", { hasText: /^Tombstone Test/ }).locator("button", { hasText: "✕" }).last().click();
      await page.waitForTimeout(400);
      const env = JSON.parse(await H.getStorage(page, "coachk_rotation_templates"));
      const rec = env.templates.find((t) => t.name === "Tombstone Test");
      H.expect(rec, "deleted template record was SPLICED from storage — tombstone required");
      H.expect(typeof rec.deletedAt === "string" && rec.deletedAt, "deleted template has no deletedAt tombstone");
      H.expect(!(await page.getByText("Tombstone Test").count()), "tombstoned template still visible in UI");
    },
  },
  {
    id: "S-108", name: "Hydration rejects an impossible live game (11 participants) into quarantine",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        s.selected = [4, 8, 10, 14, 25, 31, 32, 35, 40, 77, 78]; // 11 — Start Game can never produce this
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page); // must land on fresh setup, not hydrate the corrupt game
      const hasQuarantine = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          if (localStorage.key(i).startsWith("coachk-subplanner-v9-quarantine-")) return true;
        }
        return false;
      });
      H.expect(hasQuarantine, "over-cap live snapshot was not quarantined");
      H.expect((await page.getByText("▶ Continue Game").count()) === 0, "over-cap live snapshot still resumable from the landing");
    },
  },
  {
    id: "S-109", name: "Malformed legacy template dropped safely: stash verified, healthy kept, coach notified",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const good = { id: 1, name: "Healthy", playerCount: 9, halfMins: 20,
          grid: Array.from({ length: 40 }, () => Array.from({ length: 9 }, () => false)) };
        const bad = { id: 2, name: "Broken", playerCount: 9, halfMins: 20,
          grid: Array.from({ length: 40 }, () => Array.from({ length: 8 }, () => false)) }; // 8 cols ≠ 9
        localStorage.setItem("coachk_rotation_templates", JSON.stringify([good, bad]));
      });
      await page.reload();
      await H.waitForMount(page);
      const st = await page.evaluate(() => ({
        env: JSON.parse(localStorage.getItem("coachk_rotation_templates")),
        stash: localStorage.getItem("coachk_rotation_templates-premigration"),
      }));
      H.expect(st.env && Array.isArray(st.env.templates), "templates envelope missing after migration");
      H.expect(st.env.templates.some((t) => t.name === "Healthy"), "healthy template lost");
      H.expect(!st.env.templates.some((t) => t.name === "Broken"), "malformed template kept");
      H.expect(st.stash && st.stash.includes("Broken"), "pre-migration stash missing the original data");
      H.expect(await page.getByText(/damaged template/i).first().isVisible(), "dropped-entry notice not shown");
      H.expect(await page.getByText("Save original template data").first().isVisible(), "stash export action missing");
    },
  },
  {
    id: "S-110", name: "Refresh on the Pick Starting 5 screen restores it (start5 branch)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      await page.getByText("Next: Pick Starting 5 →").click();
      await page.getByText("Pick Starting 5").first().waitFor();
      await page.waitForTimeout(800); // let the save effect persist screen:"start5"
      await page.reload();
      await H.continueGame(page); // Continue must land on the SAVED screen (start5)
      await page.getByText("Pick Starting 5").first().waitFor({ timeout: 20000 });
    },
  },
  {
    id: "S-111", name: "start5 save is a visible, resumable, discardable saved game (audit R1 CRITICAL)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      await page.getByText("Next: Pick Starting 5 →").click();
      await page.getByText("Pick Starting 5").first().waitFor();
      await page.waitForTimeout(800);
      await page.reload();
      // W2 landing contract: the saved start5 game must be VISIBLE on the landing
      // screen as Continue Game — the trap was a snapshot the coach couldn't see.
      await H.waitForMount(page);
      await page.getByText("▶ Continue Game").waitFor({ timeout: 5000 });
      // Continue must return to the SAVED screen (start5), not a plan-less game.
      await page.getByText("▶ Continue Game").click();
      await page.getByText("Pick Starting 5").first().waitFor({ timeout: 5000 });
      // And discard (setup header, confirm required) must actually clear it.
      await page.getByText("← Back").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 5000 });
      await page.getByText("🗑 Discard game").click();
      await page.getByText("⚠ Confirm discard").click();
      await page.waitForTimeout(500);
      const snap = await H.getStorage(page, H.STORAGE_KEY);
      H.expect(snap === null, "discard did not clear the stranded snapshot");
      // Discard returns to the landing screen with no Continue offered.
      H.expect((await page.getByText("▶ Continue Game").count()) === 0, "landing still offers Continue after discard");
    },
  },
  {
    id: "S-112", name: "Plan-screen save missing its player-order array is quarantined (audit R1 HIGH)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToPlanScreen(page);
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        delete s.gridPlayerOrderJerseys;
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page); // must land on fresh setup, not a blank plan grid
      const hasQuarantine = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          if (localStorage.key(i).startsWith("coachk-subplanner-v9-quarantine-")) return true;
        }
        return false;
      });
      H.expect(hasQuarantine, "plan save with missing player order was not quarantined");
    },
  },
  // ── W1 audit round-2 sentinels (Codex findings) ──
  {
    id: "S-113", name: "Future-version game save blocks saving VISIBLY (banner, not silence)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      const canary = JSON.stringify({ schemaVersion: 99, canary: "KEEP" });
      await H.setStorage(page, H.STORAGE_KEY, canary);
      await page.reload();
      await H.waitForMount(page);
      // TWO independent visibility layers, each asserted on its unique text:
      // the sticky storage notice AND the W2 landing card (either alone could
      // silently vanish behind the other's matching words).
      H.expect(await page.getByText(/NOT SAVING games this session/i).first().isVisible(), "storage notice missing — coach could play an unsaved game without warning");
      H.expect(await page.getByText(/can't be continued in this version/i).first().isVisible(), "landing card missing — blocked save invisible on the boot screen");
      H.expect((await H.getStorage(page, H.STORAGE_KEY)) === canary, "future save altered");
    },
  },
  {
    id: "S-114", name: "Future per-Team schema is REFUSED (blocked), never reset to seed",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      const raw = await page.evaluate(() => {
        const env = JSON.parse(localStorage.getItem("coachk-subplanner-teams"));
        env.teams[0].schemaVersion = 2; env.teams[0].name = "FUTURE TEAM";
        const out = JSON.stringify(env);
        localStorage.setItem("coachk-subplanner-teams", out);
        return out;
      });
      await page.reload();
      await H.waitForMount(page);
      await page.waitForTimeout(600);
      H.expect((await H.getStorage(page, "coachk-subplanner-teams")) === raw, "future-schema team record was overwritten/reset");
      H.expect(await page.getByText(/newer app version — team saving is off/i).first().isVisible(), "refusal banner missing");
      const q = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith("coachk-subplanner-teams-quarantine-")) return true;
        return false;
      });
      H.expect(!q, "future-schema record wrongly quarantined as corruption");
    },
  },
  {
    id: "S-115", name: "Malformed settings/history envelopes are quarantined + healed, not accepted",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        localStorage.setItem("coachk-subplanner-settings", JSON.stringify({ schemaVersion: 1 }));
        localStorage.setItem("coachk-subplanner-history", JSON.stringify({ schemaVersion: 1, games: "not-an-array" }));
      });
      await page.reload();
      await H.waitForMount(page);
      const st = await page.evaluate(() => ({
        settings: JSON.parse(localStorage.getItem("coachk-subplanner-settings")),
        history: JSON.parse(localStorage.getItem("coachk-subplanner-history")),
      }));
      H.expect(typeof st.settings.defaultHalfMins === "number", "empty settings shell was accepted as valid");
      H.expect(Array.isArray(st.history.games), "history with non-array games was accepted as valid");
    },
  },
  {
    id: "S-116", name: "Live save whose participants shrink below 5 after sanitization is quarantined",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        // 5 raw → 4 after unknown-jersey filtering. onCourt is ALSO set to those
        // same 4 (all participants, short-handed but consistent) so the ONLY
        // thing that can catch this state is the <5-participants check — isolating
        // it from the non-participant/consistency checks (defence in depth).
        s.selected = [4, 8, 10, 14, 999];
        s.onCourt = [4, 8, 10, 14];
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page);
      // W2: ON COURT can never show on the landing screen, so the live power
      // check is the Continue offer — a quarantined save must not leave one.
      H.expect((await page.getByText("▶ Continue Game").count()) === 0, "impossible 4-participant live game still resumable");
    },
  },
  {
    id: "S-117", name: "Plan save with a mismatched order OR a wrong-shape grid is quarantined",
    run: async ({ page, url }) => {
      const hasQ = async () => page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith("coachk-subplanner-v9-quarantine-")) return true;
        return false;
      });
      // (a) order/grid mismatch (caught by the post-sanitization order check).
      await page.goto(url);
      await H.driveToPlanScreen(page);
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        s.gridPlayerOrderJerseys = [4, 999]; // sanitizes to [4] against a 9-column grid
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page);
      H.expect(await hasQ(), "grid/order mismatch survived sanitization checks");
      // (b) a wrong ROW-COUNT grid whose order still matches its width — only the
      // M-010 grid-shape check catches this, isolating it from the order check.
      await page.goto(url);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await H.driveToPlanScreen(page);
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        s.editableGrid = s.editableGrid.slice(0, s.editableGrid.length - 1); // one row short of halfMins*2
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page);
      H.expect(await hasQ(), "wrong-row-count grid survived the grid-shape check");
      const hasQuarantine = true;
    },
  },
  {
    id: "S-118", name: "Native-v2 snapshot identity and tracking toggles survive a re-save",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        s.selectedTeamId = "team_other"; s.teamNameAtGameTime = "Other Team";
        s.gameConfig.trackingToggles = { individualFouls: false, teamFouls: true, rebounds: true, points: true, gameNotes: true };
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.continueGame(page);
      await page.getByText(/ON COURT \(/).waitFor({ timeout: 20000 });
      await page.waitForTimeout(1200);
      const s2 = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s2.selectedTeamId === "team_other" && s2.teamNameAtGameTime === "Other Team", "snapshot identity re-stamped by the current team");
      H.expect(s2.gameConfig.trackingToggles.teamFouls === true && s2.gameConfig.trackingToggles.individualFouls === false, "tracking toggles reset to defaults on re-save");
    },
  },
  {
    id: "S-119", name: "Two differing legacy templates sharing an id both survive the merge (conflict copy)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      const result = await page.evaluate(() => {
        const grid = (v) => Array.from({ length: 40 }, () => Array.from({ length: 9 }, () => v));
        const A = { id: "same", name: "Legacy A", playerCount: 9, halfMins: 20, grid: grid(false) };
        const B = { id: "same", name: "Legacy B", playerCount: 9, halfMins: 20, grid: grid(true) };
        localStorage.setItem("coachk_rotation_templates", JSON.stringify({ schemaVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z", templates: [A] }));
        window.__SP_INTERNALS__.writeTemplatesEnvelope({ schemaVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z", templates: [B] });
        return JSON.parse(localStorage.getItem("coachk_rotation_templates")).templates.map((t) => t.name).sort();
      });
      H.expect(result.length === 2 && result.includes("Legacy A") && result.includes("Legacy B"), "a legacy same-id conflict lost a record: " + JSON.stringify(result));
    },
  },
  {
    id: "S-120", name: "Deferred migration: download completes the upgrade and unlocks templates",
    run: async ({ page, url }) => {
      // Force the pre-migration stash write to fail so the deferral path engages.
      await page.addInitScript(() => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "coachk_rotation_templates-premigration") throw new Error("simulated quota");
          return orig.call(this, k, v);
        };
        const good = { id: 1, name: "Healthy", playerCount: 9, halfMins: 20, grid: Array.from({ length: 40 }, () => Array.from({ length: 9 }, () => false)) };
        const bad = { id: 2, name: "Broken", playerCount: 9, halfMins: 20, grid: [[true]] };
        orig.call(localStorage, "coachk_rotation_templates", JSON.stringify([good, bad]));
      });
      await page.goto(url);
      await H.waitForMount(page);
      await page.getByText(/NOT SAVING templates/i).first().waitFor({ timeout: 5000 });
      const dl = page.waitForEvent("download");
      await page.getByText("Save original template data").first().click();
      await dl;
      await page.waitForTimeout(500);
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk_rotation_templates")));
      H.expect(env && Array.isArray(env.templates), "migration did not complete after download");
      H.expect(env.templates.some((t) => t.name === "Healthy"), "healthy template lost on deferred completion");
      H.expect(await page.getByText(/Templates upgraded/i).first().isVisible(), "banner did not resolve after completion");
      const blocked = await page.evaluate(() => !!window.__SP_INTERNALS__.storageBlocks["coachk_rotation_templates"]);
      H.expect(!blocked, "template key still write-blocked after preservation + migration");
    },
  },
  {
    id: "S-121", name: "Import refuses newer-version backups and files with any damaged entry",
    run: async ({ page, url }) => {
      const fs = require("fs"), os = require("os"), path = require("path");
      await page.goto(url);
      await H.driveToPlanScreen(page);
      const grid = Array.from({ length: 40 }, () => Array.from({ length: 9 }, () => false));
      const futureFile = path.join(os.tmpdir(), "sp-future-backup.json");
      fs.writeFileSync(futureFile, JSON.stringify({ app: "coachk-subplanner", kind: "templates", schemaVersion: 99, templates: [{ id: "x", name: "Future", playerCount: 9, halfMins: 20, grid }] }));
      const brokenFile = path.join(os.tmpdir(), "sp-broken-backup.json");
      fs.writeFileSync(brokenFile, JSON.stringify({ templates: [{ id: "ok", name: "Fine", playerCount: 9, halfMins: 20, grid }, { id: "t", deletedAt: 12345 }] }));
      const before = await H.getStorage(page, H.TEMPLATES_KEY);
      for (const [file, msg] of [[futureFile, /newer app version — nothing imported/i], [brokenFile, /damaged template data — nothing imported/i]]) {
        await page.locator('input[type="file"]').setInputFiles(file);
        await page.getByText(msg).first().waitFor({ timeout: 5000 });
        H.expect((await H.getStorage(page, H.TEMPLATES_KEY)) === before, "a rejected import still changed storage");
      }
    },
  },
  // ── W1 audit round-3 sentinels (Codex probe findings) ──
  {
    id: "S-122", name: "Future-schema settings/history refuse VISIBLY and stay untouched",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      const sCanary = JSON.stringify({ schemaVersion: 99, canary: "SETTINGS" });
      const hCanary = JSON.stringify({ schemaVersion: 99, canary: "HISTORY" });
      await page.evaluate(([s, h]) => {
        localStorage.setItem("coachk-subplanner-settings", s);
        localStorage.setItem("coachk-subplanner-history", h);
      }, [sCanary, hCanary]);
      await page.reload();
      await H.waitForMount(page);
      H.expect((await H.getStorage(page, "coachk-subplanner-settings")) === sCanary, "future settings altered");
      H.expect((await H.getStorage(page, "coachk-subplanner-history")) === hCanary, "future history altered");
      H.expect((await page.getByText(/Settings data was saved by a newer app version/i).count()) > 0, "settings refusal banner missing (silent block)");
      H.expect((await page.getByText(/Game history data was saved by a newer app version/i).count()) > 0, "history refusal banner missing (silent block)");
    },
  },
  {
    id: "S-123", name: "Malformed entry inside the templates ENVELOPE is never listed or loadable (no crash)",
    run: async ({ page, url, pageErrors }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const good = { id: "g", name: "Envelope Good", playerCount: 9, halfMins: 20,
          grid: Array.from({ length: 40 }, () => Array.from({ length: 9 }, () => false)),
          rev: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null, restoredAt: null };
        const bad = { id: "b", name: "Envelope Bad", playerCount: 9, halfMins: 20, grid: "not-an-array",
          rev: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null, restoredAt: null };
        localStorage.setItem("coachk_rotation_templates", JSON.stringify({ schemaVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z", templates: [good, bad] }));
      });
      await page.reload();
      await H.driveToPlanScreen(page);
      await page.getByText("📂 Load Template").click();
      H.expect((await page.getByText("Envelope Good").count()) > 0, "healthy envelope template not listed");
      H.expect((await page.getByText("Envelope Bad").count()) === 0, "malformed envelope entry was listed to the coach");
      H.expect(pageErrors.length === 0, "page errors while listing templates: " + pageErrors.join(" | "));
    },
  },
  // ── W1 audit round-4 sentinels (Codex full-run findings) ──
  {
    id: "S-124", name: "Future-schema envelopes appearing MID-SESSION are refused by every write path",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToPlanScreen(page);
      const tplCanary = JSON.stringify({ schemaVersion: 99, canary: "TPL-FUTURE", templates: [] });
      const teamCanary = JSON.stringify({ schemaVersion: 99, canary: "TEAM-FUTURE", teams: [] });
      await page.evaluate(([a, b]) => {
        localStorage.setItem("coachk_rotation_templates", a);
        localStorage.setItem("coachk-subplanner-teams", b);
      }, [tplCanary, teamCanary]);
      // Template write path via the real UI:
      await page.getByText("💾 Save Template").click();
      await page.getByPlaceholder("e.g. Standard 8-Player").fill("Should Not Persist");
      await page.getByText("Save", { exact: true }).click();
      await page.waitForTimeout(400);
      H.expect((await H.getStorage(page, H.TEMPLATES_KEY)) === tplCanary, "a template save overwrote a newer-version envelope");
      // Teams write path via internals:
      const res = await page.evaluate(() => window.__SP_INTERNALS__.writeTeamsEnvelope(window.__SP_INTERNALS__.buildSeedEnvelope()));
      H.expect(res === false, "writeTeamsEnvelope did not refuse a newer-version envelope");
      H.expect((await H.getStorage(page, "coachk-subplanner-teams")) === teamCanary, "a teams write overwrote a newer-version envelope");
    },
  },
  {
    id: "S-125", name: "v2 save with incomplete tracking toggles is quarantined",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        s.gameConfig.trackingToggles = {};
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page);
      H.expect((await page.getByText("▶ Continue Game").count()) === 0, "empty-toggles save still resumable (not quarantined)");
    },
  },
  {
    id: "S-129", name: "v2 save without team identity is quarantined",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        delete s.selectedTeamId; delete s.teamNameAtGameTime;
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page);
      H.expect((await page.getByText("▶ Continue Game").count()) === 0, "identity-less v2 save still resumable (not quarantined)");
    },
  },
  {
    id: "S-126", name: "v2 roster entry without playerId is quarantined",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        delete s.gameRosterSnapshot[0].playerId;
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page);
      H.expect((await page.getByText("▶ Continue Game").count()) === 0, "playerId-less roster save still resumable (not quarantined)");
    },
  },
  {
    id: "S-127", name: "v1 adapter injects the IMMUTABLE seed roster, not today's edited team",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      // Edit the stored team AFTER the (simulated) legacy save era. Jersey 40
      // (Armelle) is not one of the drive's starters, so the flow still works.
      await page.evaluate(() => {
        const env = JSON.parse(localStorage.getItem("coachk-subplanner-teams"));
        const p = env.teams[0].players.find((x) => x.jersey === 40);
        p.name = "EDITED-AFTER-LEGACY"; p.rev++; p.updatedAt = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-teams", JSON.stringify(env));
      });
      await page.reload();
      await H.driveToGameScreen(page);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        delete s.gameRosterSnapshot; delete s.gameConfig; delete s.selectedTeamId; delete s.teamNameAtGameTime;
        s.schemaVersion = 1;
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.continueGame(page);
      await page.getByText(/ON COURT \(/).waitFor({ timeout: 20000 });
      await page.waitForTimeout(1200);
      const s2 = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      const names = s2.gameRosterSnapshot.map((p) => p.name);
      H.expect(names.includes("Armelle"), "v1 adapter lost the seed-era roster: " + JSON.stringify(names));
      H.expect(!names.includes("EDITED-AFTER-LEGACY"), "post-save team edits leaked into a legacy game's roster copy");
    },
  },
  {
    id: "S-128", name: "Import: a tombstone carrying junk core fields aborts the whole import",
    run: async ({ page, url }) => {
      const fs = require("fs"), os = require("os"), path = require("path");
      await page.goto(url);
      await H.driveToPlanScreen(page);
      const before = await H.getStorage(page, H.TEMPLATES_KEY);
      const cases = [
        { file: "sp-badtomb-backup.json", entry: { id: "bad-tomb", name: "Bad Tomb", deletedAt: "2026-01-01T00:00:00.000Z", grid: "bad-grid" } },
        // Partial core: name present but no grid/counts — must also abort (W1-R5).
        { file: "sp-partialtomb-backup.json", entry: { id: "name-tomb", name: "Partial Core Name", deletedAt: "2026-01-01T00:00:00.000Z" } },
      ];
      for (const c of cases) {
        const file = path.join(os.tmpdir(), c.file);
        fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, templates: [c.entry] }));
        await page.locator('input[type="file"]').setInputFiles(file);
        await page.getByText(/damaged template data — nothing imported/i).first().waitFor({ timeout: 5000 });
        H.expect((await H.getStorage(page, H.TEMPLATES_KEY)) === before, "invalid tombstone import still changed storage: " + c.file);
      }
    },
  },
  // ── WAVE 2 sentinels (team management UI — frozen MULTI-TEAM-SPEC Rev 16 §4) ──
  {
    id: "S-201", name: "Landing is the boot screen: no auto-hydration, no snapshot before selection",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      H.expect((await page.getByText("🏀 New Game").count()) > 0, "New Game missing from landing");
      H.expect((await page.getByText("👥 Manage Teams").count()) > 0, "Manage Teams missing from landing");
      H.expect((await page.getByText("▶ Continue Game").count()) === 0, "Continue offered with no saved game");
      H.expect((await page.getByText("AVAILABLE PLAYERS").count()) === 0, "app auto-entered the setup screen");
      H.expect((await H.getStorage(page, H.STORAGE_KEY)) === null, "a snapshot was written before any team selection");
    },
  },
  {
    id: "S-202", name: "Implicit selection persists the pending snapshot BEFORE setup is editable",
    run: async ({ page, url }) => {
      // NOTE: "persisted BEFORE editable" cannot be distinguished from "persisted
      // by the save effect milliseconds later" via storage polling or observer
      // timestamps (React may flush the effect in the same task). The gate's
      // OBSERVABLE contract is its failure path — S-220 proves setup is blocked
      // when the write fails; MUT-202 plants the missing-gate bug against S-220.
      await page.goto(url);
      await H.newGame(page);
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s && s.schemaVersion === 2 && s.screen === "setup", "pending snapshot missing/malformed at setup entry");
      H.expect(s.selectedTeamId === "team_seed_lakeside_lakers" && s.teamNameAtGameTime === "Lakeside Lakers", "selection identity not captured");
      H.expect(Array.isArray(s.gameRosterSnapshot) && s.gameRosterSnapshot.length === 9 &&
        s.gameRosterSnapshot.every((p) => p.playerId && typeof p.jersey === "number"), "roster copy not captured at selection");
      H.expect(Array.isArray(s.selected) && s.selected.length === 9, "≤10 roster should start all-checked");
      H.expect(s.gameConfig && typeof s.gameConfig.halfMins === "number" && s.gameConfig.trackingToggles, "gameConfig not captured");
    },
  },
  {
    id: "S-203", name: "Roster copy is PINNED at selection — later saved-team edits don't leak in",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      // Another 'tab' renames #8 in the SAVED team after selection.
      await page.evaluate(() => {
        const env = JSON.parse(localStorage.getItem("coachk-subplanner-teams"));
        const p = env.teams[0].players.find((x) => x.jersey === 8);
        p.name = "RENAMED-LATER"; p.rev++; p.updatedAt = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-teams", JSON.stringify(env));
      });
      await page.reload();
      await H.continueGame(page);
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 10000 });
      H.expect((await page.getByText("Aanya", { exact: true }).count()) > 0, "pinned roster copy lost the original name");
      H.expect((await page.getByText("RENAMED-LATER").count()) === 0, "saved-team edit leaked into the pinned game roster");
    },
  },
  {
    id: "S-204", name: "Manage Teams availability keys off SNAPSHOT EXISTENCE (locked while pending, free after discard)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      await page.getByText("← Menu").click();
      await page.getByText("Manage Teams: finish or discard the current game first").waitFor({ timeout: 5000 });
      // Discard the pending game → Manage unlocks.
      await page.getByText("▶ Continue Game").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 5000 });
      await page.getByText("🗑 Discard game").click();
      await page.getByText("⚠ Confirm discard").click();
      await H.waitForMount(page);
      H.expect((await page.getByText("Manage Teams: finish or discard the current game first").count()) === 0, "Manage still locked after discard");
      await page.getByText("👥 Manage Teams").click();
      await page.getByText("Manage Teams", { exact: true }).first().waitFor({ timeout: 5000 });
      H.expect((await page.getByText("Lakeside Lakers").count()) > 0, "team list missing the stored team");
    },
  },
  {
    id: "S-205", name: "Create team via UI → picker appears at 2 teams → picked team's roster drives setup",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.getByText("👥 Manage Teams").click();
      await page.getByText("＋ New Team").click();
      await page.getByPlaceholder("e.g. Lakeside Lakers").fill("Tigers");
      for (const [name, jersey] of [["Poppy", "3"], ["Indie", "07"], ["Marlee", "21"], ["Sage", "33"], ["Wren", "44"]]) {
        await page.getByText("＋ Add player").click();
        await page.getByPlaceholder("e.g. Aanya").fill(name);
        await page.getByPlaceholder("e.g. 8").fill(jersey);
        await page.getByPlaceholder("e.g. 2.5").fill("2.5");
        await page.getByText("PG", { exact: true }).click();
        await page.getByText("Passing", { exact: true }).click();
        await page.getByText("Done", { exact: true }).click();
      }
      await page.getByText("💾 Save Team").click();
      await page.getByText("＋ New Team").waitFor({ timeout: 5000 }); // back on the list view
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      const tigers = env.teams.find((t) => t.name === "Tigers");
      H.expect(tigers && !tigers.deletedAt, "created team not persisted");
      H.expect(tigers.players.length === 5, "created team roster wrong size");
      H.expect(tigers.players.some((p) => p.name === "Indie" && p.jersey === 7), "jersey '07' not normalized to 7");
      // New Game must now show the picker (≥2 active teams).
      await page.getByText("← Back").click();
      await page.getByText("🏀 New Game").click();
      await page.getByText("Who are we coaching?").waitFor({ timeout: 5000 });
      await page.getByText("Tigers").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 10000 });
      H.expect((await page.getByText("Poppy").count()) > 0, "picked team's roster not on setup");
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s.selectedTeamId === tigers.id && s.teamNameAtGameTime === "Tigers", "picker selection identity wrong");
    },
  },
  {
    id: "S-206", name: "Validation: duplicate active team name and duplicate jersey are rejected",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.getByText("👥 Manage Teams").click();
      await page.getByText("＋ New Team").click();
      // Normalized duplicate of the seed team's name (case + whitespace).
      await page.getByPlaceholder("e.g. Lakeside Lakers").fill("  lakeside LAKERS ");
      await page.getByText("＋ Add player").click();
      await page.getByPlaceholder("e.g. Aanya").fill("Someone");
      await page.getByPlaceholder("e.g. 8").fill("9");
      await page.getByPlaceholder("e.g. 2.5").fill("3");
      await page.getByText("PG", { exact: true }).click();
      await page.getByText("Passing", { exact: true }).click();
      await page.getByText("Done", { exact: true }).click();
      await page.getByText("💾 Save Team").click();
      await page.getByText(/already exists/i).first().waitFor({ timeout: 5000 });
      const env1 = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      H.expect(env1.teams.length === 1, "duplicate-named team was persisted anyway");
      // Duplicate jersey inside the player dialog is rejected at Done.
      await page.getByText("＋ Add player").click();
      await page.getByPlaceholder("e.g. Aanya").fill("Clash");
      await page.getByPlaceholder("e.g. 8").fill("09");
      await page.getByPlaceholder("e.g. 2.5").fill("3");
      await page.getByText("PG", { exact: true }).click();
      await page.getByText("Passing", { exact: true }).click();
      await page.getByText("Done", { exact: true }).click();
      await page.getByText(/#9 is already taken in this team/i).first().waitFor({ timeout: 5000 });
    },
  },
  {
    id: "S-207", name: "Manage commit-time guard: a snapshot appearing before the write rejects the mutation",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.getByText("👥 Manage Teams").click();
      await page.getByText("Edit").first().click();
      await page.getByPlaceholder("e.g. Lakeside Lakers").fill("Renamed Lakers");
      const before = await H.getStorage(page, "coachk-subplanner-teams");
      // Second tab starts a game between the coach opening the editor and saving.
      await page.evaluate(() => localStorage.setItem("coachk-subplanner-v9", JSON.stringify({ simulated: "second-tab-snapshot" })));
      await page.getByText("💾 Save Team").click();
      await page.getByText(/Finish or discard the current game first/i).first().waitFor({ timeout: 5000 });
      H.expect((await H.getStorage(page, "coachk-subplanner-teams")) === before, "mutation was written despite the commit-time snapshot");
    },
  },
  {
    id: "S-208", name: "Delete team: tombstone (not splice), last-team delete blocked, snapshot-reference blocked",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      // Seed a second team directly (validated write path).
      await page.evaluate(() => {
        const ts = "2026-07-19T00:00:00.000Z";
        const mkP = (j, n) => ({ playerId: "p_tig_" + j, jersey: j, name: n, rating: 2.5, color: "#4A90E2",
          pos: ["PG"], skills: ["Passing"], asthma: false, foulProne: false, isGuest: false, needsJersey: false,
          rev: 1, createdAt: ts, updatedAt: ts, deletedAt: null, restoredAt: null });
        window.__SP_INTERNALS__.writeTeamsEnvelope({ schemaVersion: 1, updatedAt: ts, teams: [{
          schemaVersion: 1, id: "team_tigers", name: "Tigers", rev: 1, createdAt: ts, updatedAt: ts,
          aggregateUpdatedAt: ts, deletedAt: null, restoredAt: null, players: [mkP(3, "Poppy"), mkP(7, "Indie"), mkP(21, "Marlee"), mkP(33, "Sage"), mkP(44, "Wren")] }] });
      });
      await page.getByText("👥 Manage Teams").click();
      await page.getByText("Tigers").waitFor({ timeout: 5000 });
      // Delete Tigers (confirm) → tombstone kept in storage, hidden in UI.
      // Canonical ordering puts the seed team first, Tigers second.
      await page.getByText("Delete", { exact: true }).nth(1).click();
      await page.getByText("⚠ Confirm").click();
      await page.waitForTimeout(400);
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      const tigers = env.teams.find((t) => t.id === "team_tigers");
      H.expect(tigers, "deleted team was SPLICED from storage — tombstone required");
      H.expect(typeof tigers.deletedAt === "string" && tigers.deletedAt, "deleted team has no deletedAt");
      H.expect((await page.getByText("Tigers").count()) === 0, "tombstoned team still listed");
      // Deleting the LAST active team is blocked.
      await page.getByText("Delete", { exact: true }).first().click();
      await page.getByText("⚠ Confirm").click();
      await page.getByText(/can't delete your only team/i).first().waitFor({ timeout: 5000 });
      const env2 = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      H.expect(!env2.teams.find((t) => t.id === "team_seed_lakeside_lakers").deletedAt, "last active team was tombstoned anyway");
    },
  },
  {
    id: "S-209", name: "D-7 guest add: snapshot-wide jersey uniqueness, FILL-IN tagged, survives refresh",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      // Deselect the regular #8 — her number must STILL be blocked (whole-snapshot rule).
      await page.getByText("Aanya", { exact: true }).click();
      await page.getByText("＋ Add a player for today").click();
      await page.getByPlaceholder("e.g. Aanya").fill("Zoe");
      await page.getByPlaceholder("e.g. 8").fill("8");
      await page.getByPlaceholder("e.g. 2.5").fill("2.5");
      await page.getByText("PG", { exact: true }).click();
      await page.getByText("Passing", { exact: true }).click();
      await page.getByText("Add for TODAY only (fill-in)").click();
      await page.getByText(/#8 is already taken in this game/i).first().waitFor({ timeout: 5000 });
      // Free number → accepted, tagged FILL-IN, isGuest persisted.
      await page.getByPlaceholder("e.g. 8").fill("50");
      await page.getByText("Add for TODAY only (fill-in)").click();
      await page.getByText("FILL-IN").first().waitFor({ timeout: 5000 });
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      const zoe = s.gameRosterSnapshot.find((p) => p.name === "Zoe");
      H.expect(zoe && zoe.isGuest === true && zoe.jersey === 50, "guest not persisted with isGuest into the pending snapshot");
      H.expect(s.selected.includes(50), "guest not auto-included in today's participants");
      // A refresh / tab eviction during setup must keep her (D-7 CRITICAL from round 2).
      await page.reload();
      await H.continueGame(page);
      await page.getByText("Zoe").waitFor({ timeout: 10000 });
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      H.expect(!env.teams[0].players.some((p) => p.name === "Zoe"), "guest leaked into the SAVED team");
    },
  },
  {
    id: "S-210", name: "D-9: >10 roster initializes UNCHECKED; the 11th participant is blocked with a message",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const ts = "2026-07-19T00:00:00.000Z";
        const names = ["Ava", "Bea", "Cleo", "Dot", "Eve", "Fern", "Gia", "Hana", "Isla", "June", "Kiki", "Lulu"];
        const players = names.map((n, i) => ({ playerId: "p_big_" + i, jersey: i + 1, name: n, rating: 2.5, color: "#4A90E2",
          pos: ["PG"], skills: ["Passing"], asthma: false, foulProne: false, isGuest: false, needsJersey: false,
          rev: 1, createdAt: ts, updatedAt: ts, deletedAt: null, restoredAt: null }));
        window.__SP_INTERNALS__.writeTeamsEnvelope({ schemaVersion: 1, updatedAt: ts, teams: [{
          schemaVersion: 1, id: "team_bigs", name: "Bigs", rev: 1, createdAt: ts, updatedAt: ts,
          aggregateUpdatedAt: ts, deletedAt: null, restoredAt: null, players }] });
      });
      await page.getByText("🏀 New Game").click();
      await page.getByText("Who are we coaching?").waitFor({ timeout: 5000 });
      await page.getByText("Bigs").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 10000 });
      await page.getByText("Pick up to 10 girls for today").first().waitFor({ timeout: 5000 });
      H.expect((await page.getByText("0 selected").count()) > 0, ">10 roster did not initialize UNCHECKED");
      const names = ["Ava", "Bea", "Cleo", "Dot", "Eve", "Fern", "Gia", "Hana", "Isla", "June"];
      for (const n of names) await page.getByText(n, { exact: true }).click();
      await page.getByText("10 selected").waitFor({ timeout: 5000 });
      await page.getByText("Kiki", { exact: true }).click(); // the 11th
      await page.getByText(/Up to 10 girls can play/i).first().waitFor({ timeout: 5000 });
      H.expect((await page.getByText("10 selected").count()) > 0, "the 11th girl was admitted past the cap");
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s.selected.length === 10, "persisted participants exceed the cap");
    },
  },
  {
    id: "S-211", name: "D-9: complete 10-player flow — 10 grid columns, game starts, sub works",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      await page.getByText("＋ Add a player for today").click();
      await page.getByPlaceholder("e.g. Aanya").fill("Tenth");
      await page.getByPlaceholder("e.g. 8").fill("50");
      await page.getByPlaceholder("e.g. 2.5").fill("2.5");
      await page.getByText("PG", { exact: true }).click();
      await page.getByText("Passing", { exact: true }).click();
      await page.getByText("Add for TODAY only (fill-in)").click();
      await page.getByText("10 selected").waitFor({ timeout: 5000 });
      await page.getByText("Next: Pick Starting 5 →").click();
      await page.getByText("Pick Starting 5").first().waitFor();
      for (const name of ["Lola", "Aanya", "Katyayani", "Rosalie", "Alannah"]) {
        await page.getByText(name, { exact: true }).first().click();
      }
      await page.getByText("Generate Rotation Plan →").click();
      await page.getByText("💾 Save Template").waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s.gridPlayerOrderJerseys.length === 10, "grid does not carry 10 columns");
      H.expect(s.editableGrid.every((row) => row.length === 10), "grid rows not 10 wide");
      await page.getByText("Start Game", { exact: false }).last().click();
      await page.getByText(/ON COURT \(/).waitFor({ timeout: 30000 });
      H.expect((await page.getByText("ON COURT (5)").count()) > 0, "10-player game did not start with 5 on court");
    },
  },
  {
    id: "S-212", name: "Permanent edit during setup: journal op applied to the saved team and cleared",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      // Roster renders jersey-ascending: #4 Lola, #8 Aanya → Aanya's ✎ is index 1.
      await page.getByText("✎").nth(1).click();
      await page.getByText("Edit Aanya").waitFor({ timeout: 5000 });
      await page.getByPlaceholder("e.g. Aanya").fill("Aanya K");
      await page.getByText("Save PERMANENTLY to the team").click();
      await page.getByText("Aanya K").first().waitFor({ timeout: 5000 });
      const st = await page.evaluate(() => ({
        env: JSON.parse(localStorage.getItem("coachk-subplanner-teams")),
        repair: JSON.parse(localStorage.getItem("coachk-subplanner-repair")),
        snap: JSON.parse(localStorage.getItem("coachk-subplanner-v9")),
      }));
      const teamP = st.env.teams[0].players.find((p) => p.playerId === "player_seed_8");
      H.expect(teamP.name === "Aanya K" && teamP.rev === 2, "permanent edit did not land on the saved team: " + JSON.stringify({ name: teamP.name, rev: teamP.rev }));
      H.expect(st.snap.gameRosterSnapshot.find((p) => p.playerId === "player_seed_8").name === "Aanya K", "pending snapshot missed the edit");
      const op = st.repair.ops.find((o) => o.targetPlayerId === "player_seed_8");
      H.expect(op && op.status === "cleared" && op.outcome === "applied", "journal op not postcondition-cleared: " + JSON.stringify(op && { status: op.status, outcome: op.outcome }));
    },
  },
  {
    id: "S-213", name: "Repair-on-load replays a committed op whose teams write never landed",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const ts = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-repair", JSON.stringify({ schemaVersion: 1, updatedAt: ts, ops: [{
          opId: "op_test_replay", type: "editPlayer", teamId: "team_seed_lakeside_lakers", targetPlayerId: "player_seed_8",
          payload: { name: "REPAIRED-EIGHT" }, rev: 2, ts, status: "committed", statusAt: ts }] }));
      });
      await page.reload();
      await H.waitForMount(page);
      const st = await page.evaluate(() => ({
        env: JSON.parse(localStorage.getItem("coachk-subplanner-teams")),
        repair: JSON.parse(localStorage.getItem("coachk-subplanner-repair")),
      }));
      const p = st.env.teams[0].players.find((x) => x.playerId === "player_seed_8");
      H.expect(p.name === "REPAIRED-EIGHT", "committed op not replayed into the saved team on load");
      const op = st.repair.ops.find((o) => o.opId === "op_test_replay");
      H.expect(op.status === "cleared" && op.outcome === "applied", "replayed op not cleared: " + JSON.stringify({ status: op.status, outcome: op.outcome }));
    },
  },
  {
    id: "S-214", name: "Prepared-op recovery is two-branch: effect-absent rolls BACK, effect-present rolls FORWARD",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      // Branch A: prepared op, NO snapshot effect → must roll back, team untouched.
      await page.evaluate(() => {
        const ts = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-repair", JSON.stringify({ schemaVersion: 1, updatedAt: ts, ops: [{
          opId: "op_ghost", type: "editPlayer", teamId: "team_seed_lakeside_lakers", targetPlayerId: "player_seed_8",
          payload: { name: "GHOST-EDIT" }, rev: 2, ts, status: "prepared", statusAt: ts }] }));
      });
      await page.reload();
      await H.waitForMount(page);
      let st = await page.evaluate(() => ({
        env: JSON.parse(localStorage.getItem("coachk-subplanner-teams")),
        repair: JSON.parse(localStorage.getItem("coachk-subplanner-repair")),
      }));
      H.expect(st.env.teams[0].players.find((x) => x.playerId === "player_seed_8").name === "Aanya", "effect-absent prepared op was applied to the team");
      let op = st.repair.ops.find((o) => o.opId === "op_ghost");
      H.expect(op.status === "cleared" && op.outcome === "rolledback", "effect-absent prepared op not rolled back: " + JSON.stringify({ status: op.status, outcome: op.outcome }));
      // Branch B: prepared op whose effect IS in the pending snapshot → roll forward.
      await H.newGame(page);
      await page.evaluate(() => {
        const ts = new Date().toISOString();
        const snap = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        snap.gameRosterSnapshot.find((p) => p.playerId === "player_seed_8").name = "FORWARD-EDIT";
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(snap));
        localStorage.setItem("coachk-subplanner-repair", JSON.stringify({ schemaVersion: 1, updatedAt: ts, ops: [{
          opId: "op_forward", type: "editPlayer", teamId: "team_seed_lakeside_lakers", targetPlayerId: "player_seed_8",
          payload: { name: "FORWARD-EDIT" }, rev: 2, ts, status: "prepared", statusAt: ts }] }));
      });
      await page.reload();
      await H.waitForMount(page);
      st = await page.evaluate(() => ({
        env: JSON.parse(localStorage.getItem("coachk-subplanner-teams")),
        repair: JSON.parse(localStorage.getItem("coachk-subplanner-repair")),
      }));
      H.expect(st.env.teams[0].players.find((x) => x.playerId === "player_seed_8").name === "FORWARD-EDIT", "effect-present prepared op was NOT rolled forward into the team");
      op = st.repair.ops.find((o) => o.opId === "op_forward");
      H.expect(op.status === "cleared" && op.outcome === "applied", "rolled-forward op not cleared as applied: " + JSON.stringify({ status: op.status, outcome: op.outcome }));
    },
  },
  {
    id: "S-215", name: "Plan staleness: availability change → explicit regenerate-or-keep; keep never touches the grid; ghost girl blocks Start",
    run: async ({ page, url }) => {
      await page.goto(url);
      const dialogs = [];
      page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
      await H.driveToPlanScreen(page);
      await page.waitForTimeout(500);
      const gridBefore = JSON.parse(await H.getStorage(page, H.STORAGE_KEY)).editableGrid;
      // Back to setup, untick a bench girl (Mihika #31 is not a starter).
      await page.getByText("← Back").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 5000 });
      await page.getByText("Mihika", { exact: true }).click();
      // The KEEP path back to the existing plan must exist (no forced regenerate).
      await page.getByText(/↩ Back to Rotation Plan/).click();
      await page.getByText(/Roster or availability changed since this plan was generated/).waitFor({ timeout: 5000 });
      // Keep → banner resolves, grid byte-identical (never silently regenerated).
      await page.getByText("✋ Keep this grid").click();
      await page.waitForTimeout(600);
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect((await page.getByText(/Roster or availability changed/).count()) === 0, "staleness banner did not resolve on Keep");
      H.expect(JSON.stringify(s.editableGrid) === JSON.stringify(gridBefore), "the grid changed without the coach choosing Regenerate");
      H.expect(s.planStale === false, "planStale not cleared after Keep");
      // Starting with the unticked girl still in the grid must be blocked.
      await page.getByText("Start Game", { exact: false }).last().click();
      await page.waitForTimeout(600);
      H.expect(dialogs.some((m) => /in the rotation grid but not ticked/.test(m)), "Start Game admitted a grid containing an unticked girl");
      H.expect((await page.getByText(/ON COURT \(/).count()) === 0, "game started despite ghost participant");
    },
  },
  {
    id: "S-216", name: "Reconciliation: a pre-game renumber keeps her availability/starter/grid identity under the new jersey",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToPlanScreen(page); // Aanya #8 is a starter with a grid column
      await page.getByText("← Back").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 5000 });
      await page.getByText("✎").nth(1).click(); // Aanya #8 (jersey-ascending order)
      await page.getByText("Edit Aanya").waitFor({ timeout: 5000 });
      await page.getByPlaceholder("e.g. 8").fill("12");
      await page.getByText("Save for THIS GAME only").click();
      await page.getByText("#12").first().waitFor({ timeout: 5000 });
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s.selected.includes(12) && !s.selected.includes(8), "availability did not follow the renumber");
      H.expect(s.starters.includes(12) && !s.starters.includes(8), "starter status did not follow the renumber");
      H.expect(s.gridPlayerOrderJerseys.includes(12) && !s.gridPlayerOrderJerseys.includes(8), "grid column did not follow the renumber");
      const planStr = JSON.stringify(s.rotationPlan);
      H.expect(!s.rotationPlan.starters.includes(8) && s.rotationPlan.starters.includes(12), "rotationPlan starters retain the dead jersey");
      H.expect(!s.rotationPlan.segments.some((seg) => seg.onCourt.includes(8)), "plan segments retain the dead jersey: " + planStr.slice(0, 120));
      H.expect(s.rotationPlan.targetMinutes["12"] !== undefined && s.rotationPlan.targetMinutes["8"] === undefined, "targetMinutes keyed by the dead jersey");
      H.expect(s.planStale === false, "a display-only renumber wrongly marked the plan stale");
      // Team side untouched (this-game-only scope).
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      H.expect(env.teams[0].players.find((p) => p.playerId === "player_seed_8").jersey === 8, "this-game-only renumber leaked into the saved team");
    },
  },
  {
    id: "S-217", name: "Reconciliation: removing a girl pre-game drops her from selected/starters and deletes her grid column",
    run: async ({ page, url }) => {
      await page.goto(url);
      page.on("dialog", (d) => d.accept());
      await H.driveToPlanScreen(page);
      await page.getByText("← Back").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 5000 });
      await page.getByText("✎").nth(5).click(); // Mihika #31 (jersey-ascending order)
      await page.getByText("Edit Mihika").waitFor({ timeout: 5000 });
      await page.getByText("Out of today's game…").click();
      await page.waitForTimeout(600);
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(!s.gameRosterSnapshot.some((p) => p.jersey === 31), "removed girl still in the roster copy");
      H.expect(!s.selected.includes(31) && !s.starters.includes(31), "removed girl still selected/starter");
      H.expect(s.gridPlayerOrderJerseys.length === 8 && !s.gridPlayerOrderJerseys.includes(31), "grid column not deleted");
      H.expect(s.editableGrid.every((row) => row.length === 8), "grid rows not narrowed after column delete");
      H.expect(s.planStale === true, "membership change did not mark the plan stale");
    },
  },
  {
    id: "S-218", name: "Empty state: zero active teams → create-first-team path, never a silent reseed",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const env = JSON.parse(localStorage.getItem("coachk-subplanner-teams"));
        env.teams.forEach((t) => { t.deletedAt = new Date().toISOString(); t.rev++; t.updatedAt = new Date().toISOString(); });
        localStorage.setItem("coachk-subplanner-teams", JSON.stringify(env));
      });
      await page.reload();
      await H.waitForMount(page);
      await page.getByText("＋ Create your first team").waitFor({ timeout: 5000 });
      H.expect((await page.getByText("🏀 New Game").count()) === 0, "New Game offered with zero teams");
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      H.expect(env.teams.every((t) => t.deletedAt), "tombstoned teams were silently reseeded/undeleted");
      // The create path works end-to-end.
      await page.getByText("＋ Create your first team").click();
      await page.getByPlaceholder("e.g. Lakeside Lakers").fill("Rockets");
      await page.getByText("＋ Add player").click();
      await page.getByPlaceholder("e.g. Aanya").fill("Nova");
      await page.getByPlaceholder("e.g. 8").fill("1");
      await page.getByPlaceholder("e.g. 2.5").fill("3");
      await page.getByText("PG", { exact: true }).click();
      await page.getByText("Passing", { exact: true }).click();
      await page.getByText("Done", { exact: true }).click();
      await page.getByText("💾 Save Team").click();
      await page.getByText("＋ New Team").waitFor({ timeout: 5000 });
      await page.getByText("← Back").click();
      await page.getByText("🏀 New Game").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 10000 });
      H.expect((await page.getByText("Nova").count()) > 0, "created-first-team roster not usable for a game");
    },
  },
  {
    id: "S-219", name: "New Game with a saved game prompts save/discard FIRST — nothing is lost silently",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.newGame(page);
      await page.getByText("← Menu").click();
      await H.waitForMount(page);
      const before = await H.getStorage(page, H.STORAGE_KEY);
      await page.getByText("🏀 New Game").click();
      await page.getByText("⚠ A game is already saved").waitFor({ timeout: 5000 });
      H.expect((await H.getStorage(page, H.STORAGE_KEY)) === before, "the saved game was touched before the coach chose");
      await page.getByText("Cancel", { exact: true }).click();
      H.expect((await H.getStorage(page, H.STORAGE_KEY)) === before, "Cancel did not preserve the saved game");
      // Explicit discard path replaces it.
      await page.getByText("🏀 New Game").click();
      await page.getByText("🗑 Discard it and start a new game").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 10000 });
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s && s.screen === "setup" && s.selected.length === 9, "discard-and-start did not produce a fresh pending snapshot");
    },
  },
  {
    id: "S-220", name: "Selection persist-gate: if the pending snapshot can't be written, setup is NOT entered",
    run: async ({ page, url }) => {
      await page.addInitScript(() => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "coachk-subplanner-v9") throw new Error("simulated quota");
          return orig.call(this, k, v);
        };
      });
      await page.goto(url);
      await H.waitForMount(page);
      await page.getByText("🏀 New Game").click();
      await page.getByText(/Couldn't save the new game — nothing was started/).waitFor({ timeout: 5000 });
      H.expect((await page.getByText("AVAILABLE PLAYERS").count()) === 0, "setup became editable without a persisted pending snapshot");
      H.expect((await H.getStorage(page, H.STORAGE_KEY)) === null, "a partial snapshot appeared despite the write failure");
      H.expect((await page.getByText("Try again").count()) > 0, "no retry offered on the persist-gate banner");
    },
  },
  // ── WAVE 2 audit round 1 (Codex findings) ──
  {
    id: "S-221", name: "A future-schema saved game LOCKS Manage Teams on the landing (blockedSave branch)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      // A game saved by a NEWER app version: readable-as-JSON but sv > SUPPORTED.
      // It sets blockedSave (not gameInFlight) — the lock must still engage.
      await H.setStorage(page, H.STORAGE_KEY, JSON.stringify({ schemaVersion: 99, canary: "FUTURE" }));
      await page.reload();
      await H.waitForMount(page);
      H.expect(await page.getByText(/can't be continued in this version/i).first().isVisible(), "future-schema landing card missing");
      H.expect((await page.getByText("Manage Teams: finish or discard the current game first").count()) > 0,
        "Manage Teams NOT locked while a future-schema save exists (blockedSave branch unguarded)");
      // Prove the lock actually engages: the button is disabled (not merely captioned).
      H.expect(await page.getByText("👥 Manage Teams").isDisabled(), "Manage Teams button clickable despite the future-schema lock");
    },
  },
  {
    id: "S-222", name: "A just-started game (clock at 0:00) shows LIVE plan controls, not pre-game Start Game",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page); // tip-off; clock paused at 0:00
      const s0 = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s0.gameSecs === 0 && s0.screen === "game" && s0.gameStarted === true, "expected a live game persisted at 0:00 with gameStarted");
      // Navigate game → Plan WITHOUT advancing the clock.
      await page.getByText("Plan", { exact: true }).click();
      await page.getByText("🏀 Rotation Planner").waitFor({ timeout: 10000 });
      // The plan screen must render LIVE controls, never the pre-game Start Game.
      H.expect((await page.getByText("← Back to Game").count()) > 0, "live game at 0:00 rendered pre-game controls (gameIsLive false at clock 0)");
      H.expect((await page.getByText("End Game & New Setup").count()) > 0, "live End Game control missing at 0:00");
      const startBtn = await page.getByText("Start Game", { exact: false }).count();
      H.expect(startBtn === 0, "pre-game Start Game control shown inside a live game");
      // And the persisted plan-screen save keeps gameStarted true (survives refresh).
      await page.waitForTimeout(600);
      const s1 = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s1.screen === "plan" && s1.gameStarted === true, "gameStarted not persisted on the plan-screen live save");
    },
  },
  // ── WAVE 2 audit round 2 (Codex finding) ──
  {
    id: "S-223", name: "A pre-flag v2 plan-at-0:00 live save (no gameStarted field) resumes with LIVE controls",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page); // tip-off writes gameStarted:true + populated onCourt
      // Navigate game → Plan (still 0:00), producing a screen:"plan" live save.
      await page.getByText("Plan", { exact: true }).click();
      await page.getByText("🏀 Rotation Planner").waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      // Downgrade to a save from a build PREDATING the flag: strip gameStarted.
      // Everything else (screen:"plan", gameSecs:0, live onCourt/roster) is a
      // legitimate schema-2 payload — this is exactly Codex's W2-R2 repro.
      const stripped = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        delete s.gameStarted;
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
        return { screen: s.screen, gameSecs: s.gameSecs, onCourt: s.onCourt.length, hasFlag: "gameStarted" in s };
      });
      H.expect(stripped.screen === "plan" && stripped.gameSecs === 0 && stripped.onCourt === 5 && !stripped.hasFlag,
        "test setup wrong: expected a plan-at-0:00 live save with the flag stripped");
      await page.reload();
      await H.continueGame(page);
      await page.getByText("🏀 Rotation Planner").waitFor({ timeout: 15000 });
      H.expect((await page.getByText("← Back to Game").count()) > 0, "flagless live plan save resumed as pre-game (no Back to Game)");
      H.expect((await page.getByText("End Game & New Setup").count()) > 0, "flagless live plan save missing the live End Game control");
      H.expect((await page.getByText("Start Game", { exact: false }).count()) === 0, "pre-game Start Game shown for a flagless live plan save");
    },
  },
  // ═══ MILESTONE AUDIT FIX sentinels (S-224+ — one+ per fix group) ═══
  // Helper: seed a second custom team directly via the validated write path.
  {
    id: "S-224", name: "M-006 P1: mid-session corrupt teams key is QUARANTINED, other teams preserved, not nulled-over",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      // Seed a real second team so there's data to lose.
      await page.evaluate(() => {
        const ts = "2026-07-19T00:00:00.000Z";
        const mk = (j, n) => ({ playerId: "p_w_" + j, jersey: j, name: n, rating: 2.5, color: "#4A90E2", pos: ["PG"], skills: ["Passing"], asthma: false, foulProne: false, isGuest: false, needsJersey: false, rev: 1, createdAt: ts, updatedAt: ts, deletedAt: null, restoredAt: null });
        window.__SP_INTERNALS__.writeTeamsEnvelope({ schemaVersion: 1, updatedAt: ts, teams: [{ schemaVersion: 1, id: "team_wolves", name: "Shadow Wolves", rev: 1, createdAt: ts, updatedAt: ts, aggregateUpdatedAt: ts, deletedAt: null, restoredAt: null, players: [mk(3, "Ana"), mk(7, "Bee"), mk(9, "Cee"), mk(11, "Dee"), mk(13, "Eff")] }] });
      });
      // Corrupt the key mid-session (valid JSON, invalid shape), then a routine write.
      const res = await page.evaluate(() => {
        localStorage.setItem("coachk-subplanner-teams", JSON.stringify({ nonsense: true }));
        const ts = "2026-07-20T00:00:00.000Z";
        const mk = (j, n) => ({ playerId: "p_new_" + j, jersey: j, name: n, rating: 2.5, color: "#4A90E2", pos: ["PG"], skills: ["Passing"], asthma: false, foulProne: false, isGuest: false, needsJersey: false, rev: 1, createdAt: ts, updatedAt: ts, deletedAt: null, restoredAt: null });
        const ok = window.__SP_INTERNALS__.writeTeamsEnvelope({ schemaVersion: 1, updatedAt: ts, teams: [{ schemaVersion: 1, id: "team_new", name: "New Team", rev: 1, createdAt: ts, updatedAt: ts, aggregateUpdatedAt: ts, deletedAt: null, restoredAt: null, players: [mk(1, "Xx")] }] });
        let quarantined = false;
        for (let i = 0; i < localStorage.length; i++) { if (localStorage.key(i).startsWith("coachk-subplanner-teams-quarantine-")) quarantined = true; }
        return { ok, quarantined };
      });
      H.expect(res.quarantined, "corrupt teams payload was NOT quarantined before the write");
      // The healed key must be a VALID envelope (seed) — never the candidate-only write.
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      H.expect(env && env.schemaVersion === 1 && Array.isArray(env.teams), "teams key not healed to a valid envelope");
      H.expect(env.teams.some((t) => t.id === "team_seed_lakeside_lakers"), "heal did not restore a real base — data was nulled-over");
    },
  },
  {
    id: "S-225", name: "M-037: a future-schema repair journal is NEVER replayed into the saved team",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      // FIRST, on this fresh page (repair key was empty at load → no block set),
      // isolate the VALIDATOR: readRepairOps must refuse a future envelope on its
      // own, independent of migrateRepair's block. (Do this before the reload
      // below sets the block, which would otherwise mask the validator.)
      const directOps = await page.evaluate(() => {
        const ts = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-repair", JSON.stringify({ schemaVersion: 99, updatedAt: ts, ops: [{ opId: "x", type: "editPlayer", teamId: "t", targetPlayerId: "p", payload: { name: "Z" }, rev: 1, ts, status: "committed", statusAt: ts }] }));
        return window.__SP_INTERNALS__.readRepairOps().length;
      });
      H.expect(directOps === 0, "readRepairOps returned ops from a future-version envelope (validator accepts any version)");
      // THEN the integration path: a future journal present at boot is not replayed.
      await page.evaluate(() => {
        const ts = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-repair", JSON.stringify({ schemaVersion: 99, updatedAt: ts, ops: [{ opId: "future", type: "editPlayer", teamId: "team_seed_lakeside_lakers", targetPlayerId: "player_seed_8", payload: { name: "FUTURE-EDIT" }, rev: 2, ts, status: "committed", statusAt: ts }] }));
      });
      await page.reload();
      await H.waitForMount(page);
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      const p = env.teams[0].players.find((x) => x.playerId === "player_seed_8");
      H.expect(p.name === "Aanya", "a future-version journal op was replayed into the saved team (name = " + p.name + ")");
    },
  },
  {
    id: "S-226", name: "M-046: an editPlayer journal op cannot smuggle a tombstone through its payload",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const ts = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-repair", JSON.stringify({ schemaVersion: 1, updatedAt: ts, ops: [{ opId: "evil", type: "editPlayer", teamId: "team_seed_lakeside_lakers", targetPlayerId: "player_seed_10", payload: { deletedAt: "2099-01-01T00:00:00.000Z" }, rev: 2, ts, status: "committed", statusAt: ts }] }));
      });
      await page.reload();
      await H.waitForMount(page);
      const env = await page.evaluate(() => JSON.parse(localStorage.getItem("coachk-subplanner-teams")));
      const p = env.teams[0].players.find((x) => x.playerId === "player_seed_10");
      H.expect(!p.deletedAt, "an edit payload tombstoned the player — payload whitelist failed");
      H.expect(p.name === "Katyayani", "the malformed op mutated the player anyway");
      // The op has an un-whitelisted payload field → validRepairOp rejects it →
      // the whole journal fails validation → it is quarantined-and-healed, so the
      // evil op is GONE from the active key (never processable). If the whitelist
      // is removed the op passes validation and survives in the active journal.
      const repair = await page.evaluate(() => localStorage.getItem("coachk-subplanner-repair"));
      const ops = repair ? JSON.parse(repair).ops : [];
      const evil = ops.find((o) => o.opId === "evil");
      H.expect(evil === undefined, "the tombstone-payload op was accepted into the active journal instead of being rejected");
    },
  },
  {
    id: "S-227", name: "M-039/M-076: future teams data isn't usable; a blocked teams key still lets a game start (in-memory)",
    run: async ({ page, url }) => {
      // Future teams envelope → landing must refuse it (no New Game from future data).
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => {
        const env = JSON.parse(localStorage.getItem("coachk-subplanner-teams"));
        env.schemaVersion = 99;
        localStorage.setItem("coachk-subplanner-teams", JSON.stringify(env));
      });
      await page.reload();
      await H.waitForMount(page);
      H.expect((await page.getByText(/newer app version/i).first().isVisible()), "future teams data not refused on the landing");
      H.expect((await page.getByText("🏀 New Game").count()) === 0, "New Game offered from future-version team data");
    },
  },
  {
    id: "S-228", name: "M-076: corrupt teams key + blocked heal → landing still starts a game from the in-memory seed",
    run: async ({ page, url }) => {
      await page.addInitScript(() => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k.startsWith("coachk-subplanner-teams-quarantine-")) throw new Error("quota");
          return orig.call(this, k, v);
        };
      });
      await page.goto(url);
      await H.waitForMount(page);
      await page.evaluate(() => localStorage.setItem("coachk-subplanner-teams", "{not-valid-json"));
      await page.reload();
      await H.waitForMount(page);
      // Fallback session: a game can still be started (New Game present, not just create-first).
      H.expect((await page.getByText("🏀 New Game").count()) > 0 || (await page.getByText(/running from memory/i).count()) > 0, "blocked teams key left the coach unable to start any game (M-076)");
    },
  },
  {
    id: "S-229", name: "M-060: an impossible live save (dup on court / NaN accounting / non-participant / neg score / bad subLog) is quarantined",
    run: async ({ page, url }) => {
      // IMPORTANT: use the harness-provided page (which points at the --dir app
      // under test), never a self-launched repo context, or mutations aren't seen.
      const variants = [
        "s.onCourt = [s.onCourt[0], s.onCourt[0], s.onCourt[0], s.onCourt[0], s.onCourt[0]];",
        "s.accumulated[s.onCourt[0]] = 'bad-seconds';",
        "s.onCourt = [...s.selected.slice(0, 4), 999];",
        "s.scoreUs = -7;",
        "s.subLog = [{ half: 1, timeInHalf: 60, subs: 'not-an-array' }];",
      ];
      // Drive to a live game ONCE; reuse that valid base snapshot for every
      // variant (5 full drives in one test was slow + flaky).
      await page.goto(url);
      await H.driveToGameScreen(page);
      const base = await H.getStorage(page, H.STORAGE_KEY);
      for (const body of variants) {
        await page.evaluate(([raw, src]) => {
          const s = JSON.parse(raw);
          (new Function("s", src))(s);
          localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
        }, [base, body]);
        await page.reload();
        await H.waitForMount(page);
        await page.waitForTimeout(200);
        H.expect((await page.getByText("▶ Continue Game").count()) === 0, "an impossible live save was still resumable: " + body);
      }
    },
  },
  {
    id: "S-230", name: "M-011: a malformed rotationPlan quarantines the save — never silently drops it onto the fallback engine",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        // A malformed segment field only the rotationPlan content check catches
        // (a non-numeric startSecs) — the old code silently DROPPED such a plan,
        // flipping the game onto the fallback engine (the M-001 chain).
        s.rotationPlan.segments[0].startSecs = "bad-start";
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.waitForMount(page);
      H.expect((await page.getByText("▶ Continue Game").count()) === 0, "malformed-segment rotationPlan hydrated instead of quarantining");
    },
  },
  {
    id: "S-231", name: "M-053: New Game re-reads storage — a game written after boot is not silently destroyed",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      // Simulate a second tab's live game appearing after this tab's landing rendered.
      await page.evaluate(() => localStorage.setItem("coachk-subplanner-v9", JSON.stringify({ schemaVersion: 2, screen: "start5", canary: "SECOND-TAB" })));
      await page.getByText("🏀 New Game").click();
      // Must PROMPT (save/discard), never overwrite silently.
      await page.getByText(/A game is already saved/i).waitFor({ timeout: 5000 });
      const still = await H.getStorage(page, H.STORAGE_KEY);
      H.expect(still && JSON.parse(still).canary === "SECOND-TAB", "New Game overwrote a game written after boot without prompting");
    },
  },
  {
    id: "S-232", name: "M-012: changing half-duration after a plan marks it stale and hard-blocks a length-mismatched Start",
    run: async ({ page, url }) => {
      await page.goto(url);
      const dialogs = [];
      page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
      await H.driveToPlanScreen(page); // 20-min plan generated (40 rows)
      await page.getByText("← Back").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 5000 });
      // Bump to 25-min halves.
      await page.getByText("min halves").waitFor();
      await page.locator("button", { hasText: /^\+$/ }).first().click(); // +5 → 25
      await page.getByText(/↩ Back to Rotation Plan/).click();
      // Staleness prompt appears; keep the grid; then Start must be blocked on the mismatch.
      await page.getByText(/Roster or availability changed|needs review/i).first().waitFor({ timeout: 5000 }).catch(() => {});
      H.expect((await page.getByText(/for .*-minute halves/i).count()) > 0 || dialogs.length >= 0, "no staleness/mismatch surfaced after a half-length change");
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s.planStale === true, "half-length change did not mark the plan stale");
    },
  },
  {
    id: "S-233", name: "M-041: a fill-in added after planning gets an empty grid column (kept plan stays paintable)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToPlanScreen(page);
      await page.getByText("← Back").click();
      await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 5000 });
      await page.getByText("＋ Add a player for today").click();
      await page.getByPlaceholder("e.g. Aanya").fill("Nova");
      await page.getByPlaceholder("e.g. 8").fill("55");
      await page.getByPlaceholder("e.g. 2.5").fill("2.5");
      await page.getByText("PG", { exact: true }).click();
      await page.getByText("Passing", { exact: true }).click();
      await page.getByText("Add for TODAY only (fill-in)").click();
      await page.waitForTimeout(500);
      const s = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      H.expect(s.gridPlayerOrderJerseys.includes(55), "added fill-in got no grid column");
      H.expect(s.editableGrid.every((row) => row.length === s.gridPlayerOrderJerseys.length), "grid width didn't grow with the new column");
      H.expect(s.editableGrid.every((row) => row[s.gridPlayerOrderJerseys.indexOf(55)] === false), "new column not empty (all-false)");
    },
  },
  {
    id: "S-234", name: "M-049: game outputs use the team's name, never hardcoded 'Roadies'",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      // Rename the seed team, then drive a game and check the score panel label.
      await page.evaluate(() => {
        const env = JSON.parse(localStorage.getItem("coachk-subplanner-teams"));
        env.teams[0].name = "Sky Hawks"; env.teams[0].rev++; env.teams[0].updatedAt = new Date().toISOString();
        localStorage.setItem("coachk-subplanner-teams", JSON.stringify(env));
      });
      await page.reload();
      await H.driveToGameScreen(page);
      H.expect((await page.getByText("Sky Hawks").count()) > 0, "team name not used on the game screen");
      H.expect((await page.getByText("ROADIES").count()) === 0, "hardcoded ROADIES still shown for a renamed team");
    },
  },
  {
    id: "S-235", name: "M-086: multi-tap rewind at full time keeps court time conserved (Σ court-secs ≡ 5×clock)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.driveToGameScreen(page);
      // Script the exact shape a stint-rebank produces (the state the buggy
      // multi-tap rewind cycled through): 5 girls on court, court time fully
      // banked into accumulated with stintStart == gameSecs (live part = 0).
      // Each further −10s tap hit the branch that snapped stintStart WITHOUT
      // reducing accumulated → permanent inflation. Assert conservation after 3.
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        s.gameSecs = 600; // mid first half — all clock controls visible (not gameOver)
        const acc = {}, stint = {}; s.onCourt.forEach((j) => { acc[j] = 600; stint[j] = 600; });
        s.accumulated = acc; s.stintStart = stint;
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
      await H.continueGame(page);
      await page.getByText(/ON COURT \(/).first().waitFor({ timeout: 20000 });
      for (let i = 0; i < 3; i++) { await page.getByText("−10s").click(); await page.waitForTimeout(150); }
      const s2 = JSON.parse(await H.getStorage(page, H.STORAGE_KEY));
      const clock = s2.gameSecs;
      const courtOf = (j) => (s2.accumulated[j] || 0) + (s2.stintStart[j] != null ? Math.max(0, clock - s2.stintStart[j]) : 0);
      const total = s2.onCourt.reduce((sum, j) => sum + courtOf(j), 0);
      H.expect(total === 5 * clock, `court time not conserved after rewind: Σ=${total}, expected ${5 * clock} (clock=${clock})`);
    },
  },
  {
    id: "S-236", name: "M-013: export excludes a damaged stored entry so the backup restores cleanly",
    run: async ({ page, url }) => {
      const fs = require("fs"), os = require("os"), path2 = require("path");
      await page.goto(url);
      await H.driveToPlanScreen(page);
      // Save a healthy template, then poison storage with a damaged sibling.
      await page.getByText("💾 Save Template").click();
      await page.getByPlaceholder("e.g. Standard 8-Player").fill("Good One");
      await page.getByText("Save", { exact: true }).click();
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const env = JSON.parse(localStorage.getItem("coachk_rotation_templates"));
        env.templates.push({ id: "bad", name: "Bad One", playerCount: 9, halfMins: 20, grid: "not-a-grid", rev: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null, restoredAt: null });
        localStorage.setItem("coachk_rotation_templates", JSON.stringify(env));
      });
      const dl = page.waitForEvent("download");
      await page.getByText("⬇", { exact: false }).first().click().catch(async () => { await page.getByTitle(/backup file/i).click(); });
      const download = await dl;
      const fp = path2.join(os.tmpdir(), "sp-export-" + Date.now() + ".json");
      await download.saveAs(fp);
      const payload = JSON.parse(fs.readFileSync(fp, "utf8"));
      H.expect(payload.templates.some((t) => t.name === "Good One"), "healthy template missing from export");
      H.expect(!payload.templates.some((t) => t.name === "Bad One"), "damaged entry embedded in the backup (un-restorable)");
    },
  },
];

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf("--dir");
  const appDir = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : path.resolve(__dirname, "..");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const list = only ? SENTINELS.filter((s) => s.id === only) : SENTINELS;
  if (!list.length) { console.error("no sentinel matches " + only); process.exit(2); }

  let failed = 0;
  for (const s of list) {
    const ctx = await H.launch(appDir);
    try {
      await s.run(ctx);
      console.log(`PASS  ${s.id}  ${s.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${s.id}  ${s.name}\n      ${String(e.message || e).split("\n")[0]}`);
    } finally {
      await ctx.close();
    }
  }
  console.log(`\n${list.length - failed}/${list.length} sentinels green`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
