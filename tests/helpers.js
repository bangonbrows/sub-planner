// Sentinel harness helpers — CoachK Sub Planner
// Serves the REAL index.html (+ vendor/) over local http and drives it in headless Chromium.
// No test framework — plain node + playwright, matching the app's no-build-step ethos.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".txt": "text/plain" };

function startServer(appDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let file = path.join(appDir, urlPath === "/" ? "index.html" : urlPath);
      if (!file.startsWith(appDir)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function launch(appDir) {
  const { server, url } = await startServer(appDir);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 400, height: 850 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const close = async () => { await browser.close(); server.close(); };
  return { page, url, pageErrors, close };
}

// Wait for the Babel-transpiled app to mount (W2: the LANDING screen header —
// the boot screen, always). Generous timeout: full-suite runs launch many
// Chromium instances back-to-back and in-browser Babel transpilation slows
// under that load (S-125 flake, W1-R5).
async function waitForMount(page) {
  await page.getByText("Coach K Sub Planner").first().waitFor({ timeout: 45000 });
}

const STORAGE_KEY = "coachk-subplanner-v9";
const TEMPLATES_KEY = "coachk_rotation_templates";

const getStorage = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const setStorage = (page, key, val) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, val]);

// W2: from the landing screen, start a new game (implicit selection with the
// single seed team) and wait for the setup screen to become editable.
async function newGame(page) {
  await waitForMount(page);
  await page.getByText("🏀 New Game").click();
  await page.getByText("AVAILABLE PLAYERS").waitFor({ timeout: 15000 });
}
// W2: from the landing screen, continue the saved game into its persisted screen.
async function continueGame(page) {
  await waitForMount(page);
  await page.getByText("▶ Continue Game").click();
}

// Drive the real UI from the landing screen to the live game screen.
// Uses the first 5 roster names as starters. Returns the starter names used.
async function driveToPlanScreen(page) {
  await newGame(page);
  await page.getByText("Next: Pick Starting 5 →").click();
  await page.getByText("Pick Starting 5").first().waitFor();
  const starters = ["Lola", "Aanya", "Katyayani", "Rosalie", "Alannah"];
  for (const name of starters) await page.getByText(name, { exact: true }).first().click();
  await page.getByText("Generate Rotation Plan →").click();
  await page.getByText("💾 Save Template").waitFor({ timeout: 15000 });
  return starters;
}

async function driveToGameScreen(page) {
  const starters = await driveToPlanScreen(page);
  await page.getByText("Start Game", { exact: false }).last().click();
  await page.getByText(/ON COURT \(/).waitFor({ timeout: 30000 });
  return starters;
}

// Minimal assert with sentinel-friendly messages.
function expect(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }

module.exports = { launch, waitForMount, newGame, continueGame, driveToPlanScreen, driveToGameScreen, expect, getStorage, setStorage, STORAGE_KEY, TEMPLATES_KEY };
