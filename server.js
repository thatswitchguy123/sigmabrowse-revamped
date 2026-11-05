const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const path = require("path");
const cookie = require("cookie");
const { chromium } = require("playwright-core");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.BROWSER_PASSWORD;
const COOKIE_NAME = "nova_auth";
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString("hex");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (!PASSWORD) {
  console.error("\n[SECURITY] Set BROWSER_PASSWORD in Replit Secrets before starting Nova Browser.\n");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

function sign(value) {
  return crypto.createHmac("sha256", COOKIE_SECRET).update(value).digest("hex");
}
function makeAuthToken() {
  const payload = `${Date.now()}:${crypto.randomBytes(16).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}
function validToken(token) {
  if (!token || typeof token !== "string") return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const supplied = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const issuedAt = Number(payload.split(":")[0]);
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < 7 * 24 * 60 * 60 * 1000;
}
function requestIsAuthed(req) {
  const cookies = cookie.parse(req.headers.cookie || "");
  return validToken(cookies[COOKIE_NAME]);
}
function requireAuth(req, res, next) {
  if (!requestIsAuthed(req)) return res.status(401).json({ error: "Please sign in first." });
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true, app: "Nova Browser" }));

app.post("/api/login", (req, res) => {
  const supplied = String(req.body?.password || "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(PASSWORD);
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!matches) return res.status(401).json({ error: "Incorrect password." });

  const token = makeAuthToken();
  res.setHeader("Set-Cookie", cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION || req.headers["x-forwarded-proto"] === "https",
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  }));
  res.json({ ok: true });
});

app.post("/api/logout", requireAuth, (_req, res) => {
  res.setHeader("Set-Cookie", cookie.serialize(COOKIE_NAME, "", {
    httpOnly: true, secure: IS_PRODUCTION, sameSite: "strict", path: "/", maxAge: 0
  }));
  res.json({ ok: true });
});

app.use("/api", requireAuth);
app.use(express.static(path.join(__dirname, "public"), {
  index: "index.html",
  etag: true,
  maxAge: IS_PRODUCTION ? "1h" : 0
}));

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      return execFileSync("which", [name], { encoding: "utf8" }).trim();
    } catch {}
  }
  return undefined; // Allows a locally installed Playwright browser to be used.
}

function safeWebUrl(input) {
  let url;
  const text = String(input).trim();
  try {
    url = new URL(text);
  } catch {
    // A domain-like value is a website; ordinary words become a Google search.
    if (/^(www\.)?[^\s.]+(\.[^\s.]+)+(\/.*)?$/i.test(text)) {
      url = new URL(`https://${text}`);
    } else {
      const query = encodeURIComponent(text);
      url = new URL(`https://www.google.com/search?q=${query}`);
    }
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// and https:// websites are supported.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("For safety, Nova Browser cannot open local or private network addresses.");
  }
  return url.toString();
}

server.on("upgrade", (req, socket, head) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  if (!validToken(cookies[COOKIE_NAME])) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  if (req.url !== "/browser") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});

wss.on("connection", async (ws) => {
  let browser;
  let context;
  let activePage;
  let pages = [];
  let screenshotTimer;
  let busy = false;
  let closed = false;

  const send = (data) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  };

  const pageInfo = () => pages.map((page, index) => ({
    id: String(index),
    title: page.isClosed() ? "Closed tab" : (page.__novaTitle || "New tab"),
    url: page.isClosed() ? "" : page.url(),
    active: page === activePage
  }));

  const publishState = () => send({ type: "state", tabs: pageInfo() });

  async function attachPage(page) {
    page.on("framenavigated", async frame => {
      if (frame === page.mainFrame()) {
        try { page.__novaTitle = await page.title(); } catch {}
        publishState();
      }
    });
    page.on("domcontentloaded", async () => {
      try { page.__novaTitle = await page.title(); } catch {}
      publishState();
    });
    page.on("close", () => {
      pages = pages.filter(p => p !== page);
      if (activePage === page) activePage = pages[0] || null;
      publishState();
    });
    page.on("download", download => {
      send({ type: "notice", message: `Download started: ${download.suggestedFilename()}` });
    });
  }

  async function makePage(url = "https://www.google.com") {
    if (pages.length >= 8) throw new Error("Maximum of 8 tabs per session.");
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await attachPage(page);
    pages.push(page);
    activePage = page;
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
    catch (error) { send({ type: "notice", message: `Page load: ${error.message.slice(0, 180)}` }); }
    try { page.__novaTitle = await page.title(); } catch {}
    publishState();
    return page;
  }

  try {
    const executablePath = findChromium();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--disable-background-networking",
        "--disable-features=Translate,BackForwardCache"
      ]
    });
    context = await browser.newContext({
      viewport: { width: 1365, height: 850 },
      deviceScaleFactor: 1,
      acceptDownloads: true,
      ignoreHTTPSErrors: false
    });
    await makePage();
    send({ type: "ready" });

    screenshotTimer = setInterval(async () => {
      if (closed || busy || !activePage || activePage.isClosed()) return;
      busy = true;
      try {
        const image = await activePage.screenshot({
          type: "jpeg",
          quality: 65,
          animations: "disabled",
          timeout: 5000
        });
        if (ws.readyState === 1) {
          ws.send(image, { binary: true });
        }
      } catch {}
      busy = false;
    }, 350);
  } catch (error) {
    send({ type: "fatal", message: `Could not start Chromium: ${error.message}` });
    ws.close();
    if (browser) await browser.close().catch(() => {});
    return;
  }

  ws.on("message", async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try {
      switch (msg.action) {
        case "navigate": {
          const url = safeWebUrl(msg.url);
          if (!activePage || activePage.isClosed()) await makePage(url);
          else await activePage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
          try { activePage.__novaTitle = await activePage.title(); } catch {}
          publishState();
          break;
        }
        case "newTab":
          await makePage("https://www.google.com");
          break;
        case "switchTab": {
          const page = pages[Number(msg.id)];
          if (page && !page.isClosed()) {
            activePage = page;
            await page.bringToFront();
            publishState();
          }
          break;
        }
        case "closeTab": {
          const page = pages[Number(msg.id)];
          if (page && pages.length > 1) await page.close();
          else if (page) await page.goto("https://www.google.com");
          publishState();
          break;
        }
        case "back":
          if (activePage) await activePage.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
          publishState();
          break;
        case "forward":
          if (activePage) await activePage.goForward({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
          publishState();
          break;
        case "reload":
          if (activePage) await activePage.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          publishState();
          break;
        case "click":
          if (activePage) {
            const box = await activePage.locator("body").boundingBox();
            const x = Math.max(0, Math.min(Number(msg.x), 1365));
            const y = Math.max(0, Math.min(Number(msg.y), 850));
            await activePage.mouse.click(x, y);
          }
          break;
        case "scroll":
          if (activePage) await activePage.mouse.wheel(Number(msg.dx) || 0, Number(msg.dy) || 0);
          break;
        case "key":
          if (activePage && typeof msg.key === "string" && msg.key.length <= 40) {
            await activePage.keyboard.press(msg.key);
          }
          break;
        case "type":
          if (activePage && typeof msg.text === "string") {
            await activePage.keyboard.type(msg.text.slice(0, 2000), { delay: 5 });
          }
          break;
        case "viewport":
          if (activePage) {
            const width = Math.max(800, Math.min(1920, Number(msg.width) || 1365));
            const height = Math.max(500, Math.min(1200, Number(msg.height) || 850));
            await activePage.setViewportSize({ width, height });
          }
          break;
      }
    } catch (error) {
      send({ type: "notice", message: error.message.slice(0, 220) });
    }
  });

  ws.on("close", async () => {
    closed = true;
    clearInterval(screenshotTimer);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Nova Browser running on port ${PORT}`);
});
