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
      await H.waitForMount(page);
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
      await H.waitForMount(page);
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
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("coachk-subplanner-v9"));
        delete s.gameRosterSnapshot; delete s.gameConfig; delete s.selectedTeamId; delete s.teamNameAtGameTime;
        s.schemaVersion = 1; s.halfMins = 16; s.planMode = "competitive";
        localStorage.setItem("coachk-subplanner-v9", JSON.stringify(s));
      });
      await page.reload();
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
      H.expect((await page.getByText(/ON COURT \(/).count()) === 0, "over-cap live snapshot hydrated into the game engine");
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
      await H.waitForMount(page);
      await page.getByText("Next: Pick Starting 5 →").click();
      await page.getByText("Pick Starting 5").first().waitFor();
      await page.waitForTimeout(800); // let the save effect persist screen:"start5"
      await page.reload();
      await page.getByText("Pick Starting 5").first().waitFor({ timeout: 20000 });
    },
  },
  {
    id: "S-111", name: "start5 save is a visible, resumable, discardable saved game (audit R1 CRITICAL)",
    run: async ({ page, url }) => {
      await page.goto(url);
      await H.waitForMount(page);
      await page.getByText("Next: Pick Starting 5 →").click();
      await page.getByText("Pick Starting 5").first().waitFor();
      await page.waitForTimeout(800);
      await page.reload();
      await page.getByText("Pick Starting 5").first().waitFor({ timeout: 20000 });
      await page.getByText("← Back").click();
      // The trap: the banner must exist so the coach can see/discard the snapshot.
      await page.getByText("SAVED GAME FOUND").waitFor({ timeout: 5000 });
      // Resume must return to the SAVED screen (start5), not jump into a plan-less game.
      await page.getByText("▶ Resume Game").click();
      await page.getByText("Pick Starting 5").first().waitFor({ timeout: 5000 });
      // And discard must actually clear the snapshot (two-tap confirm).
      await page.getByText("← Back").click();
      await page.getByText("🗑 Discard").click();
      await page.getByText("⚠ Tap again to confirm").click();
      await page.waitForTimeout(500);
      const snap = await H.getStorage(page, H.STORAGE_KEY);
      H.expect(!snap || JSON.parse(snap).screen === "setup", "discard did not clear the stranded snapshot");
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
