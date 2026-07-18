/** JSON request body parsing and response helpers for the raw Node HTTP server. */
const { HttpError } = require("../errors");

function readJson(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
      reject(new HttpError(415, "Content-Type must be application/json", true));
      return;
    }

    let body = "";
    let settled = false;

    req.on("data", chunk => {
      if (settled) return;
      body += chunk;
      if (Buffer.byteLength(body) > maxBodyBytes) {
        settled = true;
        reject(new HttpError(413, "Request body is too large", true));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (settled) return;
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new HttpError(400, "Invalid JSON request body", true));
      }
    });

    req.on("error", error => {
      if (!settled) reject(error);
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

module.exports = {
  readJson,
  sendJson
};
