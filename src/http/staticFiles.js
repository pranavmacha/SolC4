/** Secure static file server with path-traversal protection and dotfile blocking. */
const fs = require("node:fs");
const path = require("node:path");
const { HttpError } = require("../errors");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

async function serveStaticFile(req, res, publicDir, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new HttpError(405, "Method not allowed", true);
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (error) {
    throw new HttpError(400, "Malformed URL path", true);
  }

  if (decodedPath.split("/").some(isDotfileSegment)) {
    throw new HttpError(404, "Not found", true);
  }

  const root = path.resolve(publicDir);
  const safePath = decodedPath.replace(/^\/+/, "") || "index.html";
  const requestedPath = path.resolve(root, safePath);
  assertInsideRoot(root, requestedPath);

  const requestedStat = await statFile(requestedPath);
  const filePath = requestedStat.isDirectory()
    ? path.join(requestedPath, "index.html")
    : requestedPath;

  assertInsideRoot(root, path.resolve(filePath));

  const fileStat = await statFile(filePath);
  if (!fileStat.isFile()) {
    throw new HttpError(404, "Not found", true);
  }

  res.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

async function statFile(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch (error) {
    throw new HttpError(404, "Not found", true);
  }
}

function assertInsideRoot(root, filePath) {
  const relativePath = path.relative(root, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new HttpError(403, "Forbidden", true);
  }
}

function isDotfileSegment(segment) {
  return segment.startsWith(".") && segment !== "." && segment !== "..";
}

module.exports = {
  serveStaticFile
};
