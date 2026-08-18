import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.mjs";

const ARCHIPELAGO_ZIP = "https://github.com/ArchipelagoMW/Archipelago/archive/refs/heads/main.zip";
const RUNS = 100;

const yamlInput = document.getElementById("yamlFile");
const apworldInput = document.getElementById("apworldFile");
const runButton = document.getElementById("runButton");
const stopButton = document.getElementById("stopButton");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const progressEl = document.getElementById("progress");
const passedEl = document.getElementById("passed");
const failedEl = document.getElementById("failed");
const completedEl = document.getElementById("completed");

let pyodide = null;
let running = false;
let stopRequested = false;

function setStatus(text) { statusEl.textContent = text; }
function ready() { return yamlInput.files.length === 1 && apworldInput.files.length === 1 && pyodide; }
function updateRunButton() { runButton.disabled = !ready() || running; }

function addResult(index, ok, seed, error) {
  const div = document.createElement("div");
  div.className = "result";
  const heading = document.createElement("div");
  heading.innerHTML = `<strong class="${ok ? "pass" : "fail"}">${ok ? "PASS" : "FAIL"}</strong> — Generation ${index}` +
    (seed ? ` — <span class="seed">Seed ${seed}</span>` : "");
  div.appendChild(heading);
  if (error) {
    const pre = document.createElement("div");
    pre.className = "error";
    pre.textContent = error;
    div.appendChild(pre);
  }
  resultsEl.prepend(div);
}

async function loadArchipelago() {
  setStatus("Loading Pyodide…");
  pyodide = await loadPyodide({ stdout: () => {}, stderr: () => {} });
  await pyodide.loadPackage(["micropip"]);
  const micropip = pyodide.pyimport("micropip");

  // These are common Archipelago runtime dependencies. Optional/platform-specific
  // packages are deliberately not installed because the browser cannot use Kivy.
  for (const pkg of [
    "PyYAML==6.0.3", "jinja2==3.1.6", "schema==0.7.8", "platformdirs==4.10.1",
    "typing_extensions==4.15.0", "colorama==0.4.6", "pathspec==1.0.4", "certifi==2026.2.25",
    "websockets==13.1"
  ]) {
    try { await micropip.install(pkg); } catch (e) { console.warn("Could not install", pkg, e); }
  }

  setStatus("Downloading Archipelago source…");
  const response = await fetch(ARCHIPELAGO_ZIP);
  if (!response.ok) throw new Error(`Could not download Archipelago (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  pyodide.FS.writeFile("/archipelago.zip", bytes);

  pyodide.runPython(`
import os, zipfile, shutil
root = "/ap"
if os.path.exists(root):
    shutil.rmtree(root)
os.makedirs(root, exist_ok=True)
with zipfile.ZipFile("/archipelago.zip") as zf:
    zf.extractall(root)
entries = [x for x in os.listdir(root) if x.startswith("Archipelago-")]
source = os.path.join(root, entries[0])
os.chdir(source)
print(source)
`);

  setStatus("Preparing browser-compatible Archipelago runtime…");
  pyodide.runPython(`
import os, textwrap
source = os.getcwd()
# Prevent Archipelago's normal pip/bootstrap step from running in the browser.
with open(os.path.join(source, "ModuleUpdate.py"), "w", encoding="utf-8") as f:
    f.write("def update(*args, **kwargs):\\n    return None\\n")
# Do not build the full desktop/client stack. Keep core world-loading support plus generic.
worlds_dir = os.path.join(source, "worlds")
for name in list(os.listdir(worlds_dir)):
    if name.startswith((".", "_", "generic")):
        continue
    path = os.path.join(worlds_dir, name)
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)
`);

  setStatus("Archipelago is ready. Select your YAML and APWorld.");
  runButton.textContent = `Run ${RUNS} generations`;
  updateRunButton();
}

async function installAndPrepare(yamlText, apworldBytes) {
  pyodide.FS.writeFile("/input.yaml", yamlText);
  pyodide.FS.writeFile("/input.apworld", apworldBytes);

  await pyodide.runPythonAsync(`
import os, shutil
source = os.getcwd()
worlds_dir = os.path.join(source, "worlds")

for name in os.listdir(worlds_dir):
    if name.endswith(".apworld"):
        os.remove(os.path.join(worlds_dir, name))

with open("/input.apworld", "rb") as src, open(os.path.join(worlds_dir, "uploaded.apworld"), "wb") as dst:
    dst.write(src.read())

players = os.path.join(source, "Players")
os.makedirs(players, exist_ok=True)
for name in os.listdir(players):
    path = os.path.join(players, name)
    if os.path.isfile(path):
        os.remove(path)
shutil.copyfile("/input.yaml", os.path.join(players, "test.yaml"))

import Generate, Main
_browser_generate = (Generate, Main, players)
`);
}

async function runOne(index) {
  const result = await pyodide.runPythonAsync(`
import random, traceback, json
Generate, Main, players = _browser_generate
try:
    args = Generate.mystery_argparse([
        "--player_files_path", players,
        "--multi", "1",
        "--skip_output",
        "--spoiler", "0",
        "--seed", str(random.randrange(0, 2_147_483_647)),
    ])
    generated_args, seed = Generate.main(args)
    Main.main(generated_args, seed)
    json.dumps({"index": ${index}, "ok": True, "seed": seed, "error": ""})
except Exception:
    json.dumps({"index": ${index}, "ok": False, "seed": None, "error": traceback.format_exc()})
`);
  return JSON.parse(result);
}

async function run() {
  if (!ready()) return;
  running = true;
  stopRequested = false;
  stopButton.disabled = false;
  runButton.disabled = true;
  resultsEl.innerHTML = "";
  progressEl.value = 0;
  passedEl.textContent = "0";
  failedEl.textContent = "0";
  completedEl.textContent = "0";

  try {
    const yamlText = await yamlInput.files[0].text();
    const apworldBytes = new Uint8Array(await apworldInput.files[0].arrayBuffer());
    setStatus("Running generations…");
    await installAndPrepare(yamlText, apworldBytes);

    let passed = 0, failed = 0;
    for (let i = 1; i <= RUNS; i++) {
      if (stopRequested) break;
      setStatus(`Running generation ${i} of ${RUNS}…`);
      const r = await runOne(i);
      addResult(r.index, r.ok, r.seed, r.error);
      if (r.ok) passed++; else failed++;
      passedEl.textContent = passed;
      failedEl.textContent = failed;
      completedEl.textContent = passed + failed;
      progressEl.value = passed + failed;
      // Let the browser repaint between generations.
      await new Promise(requestAnimationFrame);
    }
    setStatus(stopRequested ? `Stopped after ${passed + failed} completed generations.` : `Finished: ${passed} passed, ${failed} failed.`);
  } catch (error) {
    setStatus(`Fatal error:\n${error?.stack || error}`);
  } finally {
    running = false;
    stopButton.disabled = true;
    updateRunButton();
  }
}

runButton.addEventListener("click", run);
stopButton.addEventListener("click", () => { stopRequested = true; setStatus("Stopping after the current generation…"); });
yamlInput.addEventListener("change", updateRunButton);
apworldInput.addEventListener("change", updateRunButton);

loadArchipelago().catch(error => {
  setStatus(`Could not initialize Archipelago:\n${error?.stack || error}`);
});
