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
    find: "persistTemplates([...existing, entry]);",
    replace: "persistTemplates(existing);",
    mustFail: "S-006",
  },
  {
    id: "SAB-004", plants: "one player vanishes from the setup roster",
    find: "{PLAYERS_DB.map(p => {",
    replace: "{PLAYERS_DB.slice(0, 8).map(p => {",
    mustFail: "S-002",
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
