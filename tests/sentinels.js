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
