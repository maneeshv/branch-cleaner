export function renderHtml({ baseBranch, repoPath, requestToken }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Branch Purge</title>
  <style>
    :root {
      --bg: #f6f7f7;
      --panel: #ffffff;
      --text: #1f2933;
      --muted: #697386;
      --line: #d7dde5;
      --accent: #0f766e;
      --danger: #a61b1b;
      --warn: #996100;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 1220px;
      margin: 0 auto;
      padding: 28px 20px 44px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-end;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      word-break: break-word;
    }
    .meta, .summary { color: var(--muted); font-size: 13px; }
    .controls, .actions {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      margin: 14px 0;
    }
    .controls {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) 210px 180px;
      gap: 12px;
    }
    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .inline {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text);
      font-size: 13px;
      font-weight: 500;
      text-transform: none;
    }
    input, select, button {
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      font: inherit;
    }
    input, select { width: 100%; padding: 0 10px; }
    input[type="checkbox"] { width: 16px; height: 16px; }
    button {
      padding: 0 12px;
      cursor: pointer;
      font-weight: 650;
    }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    .table-wrap {
      overflow: auto;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    table { width: 100%; min-width: 1080px; border-collapse: collapse; }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #eef2f4;
      color: #4b5563;
      font-size: 12px;
      text-transform: uppercase;
    }
    tbody tr:hover { background: #f5faf9; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid currentColor;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .yes { color: var(--accent); background: #eaf7f4; }
    .no { color: var(--danger); background: #fff1f1; }
    .stale { color: var(--warn); background: #fff7df; }
    .detail { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
    .time { white-space: nowrap; }
    .message { min-height: 22px; color: var(--muted); }
    .message.error { color: var(--danger); }
    .hidden { display: none; }
    @media (max-width: 780px) {
      header { display: block; }
      .controls { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Branch Purge</h1>
        <div class="meta">Repository: <code>${escapeHtml(repoPath)}</code></div>
        <div class="meta">Base branch: <code>${escapeHtml(baseBranch)}</code></div>
      </div>
      <button id="fetchButton">Refresh from remote</button>
    </header>

    <section class="controls" aria-label="Table filters">
      <label>Search local branch<input id="search" type="search" placeholder="Type branch name..." autocomplete="off"></label>
      <label>Remote branch<select id="remoteFilter">
        <option value="all">All</option>
        <option value="present">Has remote</option>
        <option value="none">No remote</option>
        <option value="stale-upstream">Stale upstream</option>
      </select></label>
      <label>Merged to base<select id="mergedFilter">
        <option value="all">All</option>
        <option value="yes">Merged</option>
        <option value="no">Not merged</option>
      </select></label>
    </section>

    <section class="actions">
      <div>
        <button id="selectVisible">Select visible</button>
        <button id="clearSelection">Clear</button>
        <span class="summary"><span id="visibleCount">0</span> shown, <span id="selectedCount">0</span> selected</span>
      </div>
      <div>
        <label class="inline"><input id="forceDelete" type="checkbox"> Force delete unmerged branches</label>
        <button id="deleteButton" class="danger" disabled>Delete selected</button>
      </div>
    </section>

    <p id="message" class="message"></p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th><input id="toggleVisible" type="checkbox" aria-label="Toggle visible rows"></th>
            <th>Local branch</th>
            <th>Last committed</th>
            <th>Remote branch</th>
            <th>Merged</th>
            <th>Protected</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </main>

  <script>
    const requestToken = ${JSON.stringify(requestToken)};
    const state = { rows: [], selected: new Set() };
    const rowsBody = document.getElementById("rows");
    const search = document.getElementById("search");
    const remoteFilter = document.getElementById("remoteFilter");
    const mergedFilter = document.getElementById("mergedFilter");
    const visibleCount = document.getElementById("visibleCount");
    const selectedCount = document.getElementById("selectedCount");
    const deleteButton = document.getElementById("deleteButton");
    const forceDelete = document.getElementById("forceDelete");
    const message = document.getElementById("message");

    function escapeHtml(value) {
      return String(value).replace(/[&<>'"]/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
      }[char]));
    }

    function visibleRows() {
      const term = search.value.trim().toLowerCase();
      return state.rows.filter((row) => {
        const branchMatches = !term || row.name.toLowerCase().includes(term);
        const remoteMatches = remoteFilter.value === "all" || row.remoteStatus === remoteFilter.value;
        const mergedMatches = mergedFilter.value === "all" || (row.mergedToBase ? "yes" : "no") === mergedFilter.value;
        return branchMatches && remoteMatches && mergedMatches;
      });
    }

    function renderRows() {
      const visible = new Set(visibleRows().map((row) => row.name));
      visibleCount.textContent = visible.size;
      selectedCount.textContent = state.selected.size;
      deleteButton.disabled = state.selected.size === 0;
      rowsBody.innerHTML = state.rows.map((row) => {
        const hidden = visible.has(row.name) ? "" : " hidden";
        const remoteClass = row.remoteStatus === "present" ? "yes" : row.remoteStatus === "stale-upstream" ? "stale" : "no";
        const remoteLabel = row.remoteStatus === "present" ? "Yes" : row.remoteStatus === "stale-upstream" ? "Stale upstream" : "No";
        const checked = state.selected.has(row.name) ? "checked" : "";
        const disabled = row.protected ? "disabled" : "";
        const protectedLabel = row.protected ? row.protectedReason : "No";
        const lastCommitted = formatDateTime(row.lastCommittedAt);
        return \`<tr class="\${hidden}" data-branch="\${escapeHtml(row.name)}">
          <td><input class="row-check" type="checkbox" data-branch="\${escapeHtml(row.name)}" \${checked} \${disabled}></td>
          <td><code>\${escapeHtml(row.name)}</code><span class="detail">\${escapeHtml(row.commit)}</span></td>
          <td><span class="time" title="\${escapeHtml(row.lastCommittedAt || "")}">\${escapeHtml(lastCommitted)}</span></td>
          <td><span class="badge \${remoteClass}">\${remoteLabel}</span>\${row.remoteRef ? \`<span class="detail"><code>\${escapeHtml(row.remoteRef)}</code></span>\` : ""}</td>
          <td><span class="badge \${row.mergedToBase ? "yes" : "no"}">\${row.mergedToBase ? "Yes" : "No"}</span></td>
          <td>\${row.protected ? \`<span class="badge stale">\${escapeHtml(protectedLabel)}</span>\` : \`<span class="badge yes">No</span>\`}</td>
        </tr>\`;
      }).join("");
    }

    function formatDateTime(value) {
      if (!value) return "Unknown";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    }

    async function loadRows() {
      setMessage("Loading branches...");
      const response = await fetch("/api/branches");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to load branches");
      state.rows = body.branches;
      state.selected = new Set([...state.selected].filter((name) => state.rows.some((row) => row.name === name)));
      renderRows();
      setMessage("Loaded " + state.rows.length + " branches.");
    }

    function setMessage(text, isError = false) {
      message.textContent = text;
      message.classList.toggle("error", isError);
    }

    search.addEventListener("input", renderRows);
    remoteFilter.addEventListener("change", renderRows);
    mergedFilter.addEventListener("change", renderRows);

    document.getElementById("selectVisible").addEventListener("click", () => {
      for (const row of visibleRows()) {
        if (!row.protected) state.selected.add(row.name);
      }
      renderRows();
    });

    document.getElementById("clearSelection").addEventListener("click", () => {
      state.selected.clear();
      renderRows();
    });

    document.getElementById("toggleVisible").addEventListener("change", (event) => {
      for (const row of visibleRows()) {
        if (!row.protected) {
          if (event.target.checked) state.selected.add(row.name);
          else state.selected.delete(row.name);
        }
      }
      renderRows();
      event.target.checked = false;
    });

    rowsBody.addEventListener("change", (event) => {
      if (!event.target.classList.contains("row-check")) return;
      const branch = event.target.dataset.branch;
      if (event.target.checked) state.selected.add(branch);
      else state.selected.delete(branch);
      renderRows();
    });

    document.getElementById("fetchButton").addEventListener("click", async () => {
      if (!confirm("Run git fetch --prune for this repository?")) return;
      setMessage("Fetching and pruning remote-tracking refs...");
      const response = await fetch("/api/fetch", {
        method: "POST",
        headers: { "X-Branch-Cleaner-Token": requestToken },
      });
      const body = await response.json();
      if (!response.ok) return setMessage(body.error || "Fetch failed", true);
      await loadRows();
    });

    deleteButton.addEventListener("click", async () => {
      const branches = [...state.selected];
      const force = forceDelete.checked;
      const command = branches.map((branch) => "git branch " + (force ? "-D " : "-d ") + branch).join("\\n");
      if (!confirm("Delete these local branches?\\n\\n" + command)) return;
      const response = await fetch("/api/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Branch-Cleaner-Token": requestToken,
        },
        body: JSON.stringify({ branches, force }),
      });
      const body = await response.json();
      if (!response.ok) return setMessage(body.error || "Delete failed", true);
      state.selected.clear();
      await loadRows();
      setMessage("Deleted " + body.deleted.length + " branches.");
    });

    loadRows().catch((error) => setMessage(error.message, true));
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]);
}
