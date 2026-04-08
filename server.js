const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || 4782;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const COUNTS_FILE = path.join(DATA_DIR, "listen-counts.json");

const MIME_TYPES = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac"
};

async function ensureDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(COUNTS_FILE);
  } catch {
    await fsp.writeFile(COUNTS_FILE, "{}\n", "utf8");
  }

  const raw = await fsp.readFile(COUNTS_FILE, "utf8");
  const parsed = JSON.parse(raw || "{}");
  const normalized = {};

  for (const [key, value] of Object.entries(parsed)) {
    const normalizedKey = getCountKey(key);
    normalized[normalizedKey] = Number(normalized[normalizedKey] || 0) + Number(value || 0);
  }

  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    await fsp.writeFile(COUNTS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

async function readCounts() {
  await ensureDataFile();
  const raw = await fsp.readFile(COUNTS_FILE, "utf8");
  return JSON.parse(raw || "{}");
}

async function writeCounts(counts) {
  await ensureDataFile();
  await fsp.writeFile(COUNTS_FILE, `${JSON.stringify(counts, null, 2)}\n`, "utf8");
}

function getCountKey(filePath) {
  return path.basename(filePath);
}

function getProvidedCountKey(value) {
  if (!value || typeof value !== "string") {
    throw new Error("countKey is required");
  }

  const normalized = path.basename(value.trim());
  if (!normalized) {
    throw new Error("countKey is required");
  }

  return normalized;
}

async function readCountsByFileName() {
  const rawCounts = await readCounts();
  const normalizedCounts = {};

  for (const [key, value] of Object.entries(rawCounts)) {
    const normalizedKey = getCountKey(key);
    normalizedCounts[normalizedKey] = Number(normalizedCounts[normalizedKey] || 0) + Number(value || 0);
  }

  return normalizedCounts;
}

function resolveLocalPath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("path is required");
  }

  const expandedPath = inputPath.startsWith("~/")
    ? path.join(os.homedir(), inputPath.slice(2))
    : inputPath;
  const absolutePath = path.isAbsolute(expandedPath)
    ? expandedPath
    : path.resolve(process.cwd(), expandedPath);

  return fs.realpathSync.native(absolutePath);
}

async function getTrackInfoByName(name) {
  const countKey = getProvidedCountKey(name);
  const counts = await readCountsByFileName();
  return {
    path: "",
    name: countKey,
    countKey,
    size: 0,
    mimeType: "",
    count: Number(counts[countKey] || 0)
  };
}

async function parseRequestBody(req) {
  let rawBody = "";
  for await (const chunk of req) {
    rawBody += chunk;
  }

  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".css"
      ? "text/css; charset=utf-8"
      : ext === ".js"
        ? "text/javascript; charset=utf-8"
        : "text/html; charset=utf-8";

  fs.createReadStream(filePath)
    .on("error", () => sendText(res, 500, "Failed to read file"))
    .pipe(res.writeHead(200, { "Content-Type": mimeType, "Cache-Control": "no-store" }));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      serveFile(res, path.join(PUBLIC_DIR, "index.html"));
      return;
    }

    if (req.method === "GET" && url.pathname === "/styles.css") {
      serveFile(res, path.join(PUBLIC_DIR, "styles.css"));
      return;
    }

    if (req.method === "GET" && url.pathname === "/app.js") {
      serveFile(res, path.join(PUBLIC_DIR, "app.js"));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/track-info") {
      const info = await getTrackInfoByName(url.searchParams.get("name"));
      sendJson(res, 200, info);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/listens") {
      const body = await parseRequestBody(req);
      const info = await getTrackInfoByName(body.countKey);
      const counts = await readCountsByFileName();
      counts[info.countKey] = Number(counts[info.countKey] || 0) + 1;
      await writeCounts(counts);
      sendJson(res, 200, { path: info.path, countKey: info.countKey, count: counts[info.countKey] });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/clear-count") {
      const body = await parseRequestBody(req);
      const info = await getTrackInfoByName(body.countKey);
      const counts = await readCountsByFileName();
      counts[info.countKey] = 0;
      await writeCounts(counts);
      sendJson(res, 200, { path: info.path, countKey: info.countKey, count: 0 });
      return;
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    const statusCode = /countKey is required/.test(String(error.message))
      ? 400
      : 500;
    sendJson(res, statusCode, { error: error.message || "Unexpected error" });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use on ${HOST}. Stop the existing process or start with a different port, for example: PORT=4783 npm start`
    );
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

ensureDataFile()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Listening on http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
