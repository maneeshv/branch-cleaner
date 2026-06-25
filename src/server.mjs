import http from "node:http";
import { randomUUID } from "node:crypto";

import {
  deleteBranches,
  fetchPrune,
  GitPassphraseRequiredError,
  getDefaultBaseBranch,
  getRepoRoot,
  loadBranches,
} from "./git.mjs";
import { renderHtml } from "./html.mjs";

const MAX_JSON_BODY_BYTES = 64 * 1024;

export async function startServer({
  baseBranch,
  fetchAtStartup = false,
  fetchOptions = {},
  host = "127.0.0.1",
  port = 0,
  repoPath,
}) {
  const repoRoot = await getRepoRoot(repoPath);
  const resolvedBase = baseBranch || (await getDefaultBaseBranch(repoRoot));
  const token = randomUUID();

  if (fetchAtStartup) {
    await fetchPrune(repoRoot);
  }

  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest({
        baseBranch: resolvedBase,
        fetchOptions,
        repoPath: repoRoot,
        request,
        response,
        token,
      });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message });
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
    token,
    url: `http://${host}:${address.port}`,
  };
}

async function routeRequest({
  baseBranch,
  fetchOptions,
  repoPath,
  request,
  response,
  token,
}) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, renderHtml({ baseBranch, repoPath, requestToken: token }));
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
    assertValidRequestToken(request, token);
    const body = await readJson(request);
    try {
      await fetchPrune(repoPath, {
        ...fetchOptions,
        interactive: true,
        passphrase: body.passphrase,
      });
    } catch (error) {
      if (error instanceof GitPassphraseRequiredError) {
        sendJson(response, error.statusCode, {
          code: error.code,
          error: error.message,
          prompt: error.prompt,
        });
        return;
      }
      throw error;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/delete") {
    assertValidRequestToken(request, token);
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

function assertValidRequestToken(request, token) {
  if (request.headers["x-branch-cleaner-token"] !== token) {
    throw new HttpError(403, "Invalid request token");
  }
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
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
  let bodyBytes = 0;
  for await (const chunk of request) {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
