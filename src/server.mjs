import http from "node:http";

import {
  deleteBranches,
  fetchPrune,
  getDefaultBaseBranch,
  getRepoRoot,
  loadBranches,
} from "./git.mjs";
import { renderHtml } from "./html.mjs";

export async function startServer({
  baseBranch,
  fetchAtStartup = false,
  host = "127.0.0.1",
  port = 0,
  repoPath,
}) {
  const repoRoot = await getRepoRoot(repoPath);
  const resolvedBase = baseBranch || (await getDefaultBaseBranch(repoRoot));

  if (fetchAtStartup) {
    await fetchPrune(repoRoot);
  }

  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest({
        baseBranch: resolvedBase,
        repoPath: repoRoot,
        request,
        response,
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();

  return {
    baseBranch: resolvedBase,
    close: () => new Promise((resolve) => server.close(resolve)),
    repoPath: repoRoot,
    url: `http://${host}:${address.port}`,
  };
}

async function routeRequest({ baseBranch, repoPath, request, response }) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, renderHtml({ baseBranch, repoPath }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/branches") {
    sendJson(response, 200, {
      baseBranch,
      branches: await loadBranches({ baseBranch, repoPath }),
      repoPath,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/fetch") {
    await fetchPrune(repoPath);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/delete") {
    const body = await readJson(request);
    const branches = Array.isArray(body.branches) ? body.branches : [];
    const rows = await loadBranches({ baseBranch, repoPath });
    const deleted = await deleteBranches({
      branches,
      force: body.force === true,
      repoPath,
      rows,
    });
    sendJson(response, 200, { deleted });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(html);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}
