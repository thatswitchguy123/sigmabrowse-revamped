const $ = (id) => document.getElementById(id);
const login = $("login");
const app = $("browser-app");
const screen = $("screen");
const address = $("address");
const tabsEl = $("tabs");
const loading = $("loading");
const statusEl = $("status");
const toastEl = $("toast");
let socket;
let toastTimer;
let ready = false;
let pointerDown = false;

async function loginWithPassword(password) {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Sign-in failed.");
  login.classList.add("hidden");
  app.classList.remove("hidden");
  connectBrowser();
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  try { await loginWithPassword($("password").value); }
  catch (error) { $("login-error").textContent = error.message; }
});

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

function send(action, extra = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ action, ...extra }));
  } else {
    showToast("Browser is not connected yet.");
  }
}

function connectBrowser() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/browser`);
  socket.binaryType = "blob";
  statusEl.textContent = "Connecting to Chromium…";

  socket.addEventListener("open", () => {
    statusEl.textContent = "Connected";
  });
  socket.addEventListener("message", async (event) => {
    if (event.data instanceof Blob) {
      screen.src = URL.createObjectURL(event.data);
      screen.style.display = "block";
      loading.classList.add("hidden");
      return;
    }
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "ready") {
      ready = true;
      statusEl.textContent = "Chromium ready";
      loading.querySelector("span:last-child").textContent = "Waiting for first page…";
    } else if (message.type === "state") {
      renderTabs(message.tabs || []);
      const active = (message.tabs || []).find(tab => tab.active);
      if (active) address.value = active.url || "";
    } else if (message.type === "notice") {
      showToast(message.message);
    } else if (message.type === "fatal") {
      loading.classList.add("hidden");
      $("fatal").textContent = message.message + " Check the Replit console and the setup notes.";
      $("fatal").classList.remove("hidden");
      statusEl.textContent = "Browser failed";
    }
  });
  socket.addEventListener("close", () => {
    statusEl.textContent = "Disconnected — refresh to reconnect";
    ready = false;
  });
  socket.addEventListener("error", () => {
    statusEl.textContent = "Connection error";
  });
}

function renderTabs(tabs) {
  tabsEl.replaceChildren();
  tabs.forEach(tab => {
    const button = document.createElement("button");
    button.className = `tab${tab.active ? " active" : ""}`;
    button.type = "button";
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || "New tab";
    button.append(title);
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.textContent = "×";
    close.title = "Close tab";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      send("closeTab", { id: tab.id });
    });
    button.append(close);
    button.addEventListener("click", () => send("switchTab", { id: tab.id }));
    tabsEl.append(button);
  });
}

function navigate(value) {
  const text = value.trim();
  if (!text) return;
  send("navigate", { url: text });
  address.blur();
}
$("address-form").addEventListener("submit", event => {
  event.preventDefault();
  navigate(address.value);
});
$("back").addEventListener("click", () => send("back"));
$("forward").addEventListener("click", () => send("forward"));
$("reload").addEventListener("click", () => send("reload"));
$("home").addEventListener("click", () => navigate("https://www.google.com"));
$("new-tab").addEventListener("click", () => send("newTab"));
$("new-tab-toolbar").addEventListener("click", () => send("newTab"));

$("logout").addEventListener("click", async () => {
  try { await fetch("/api/logout", { method: "POST" }); } catch {}
  if (socket) socket.close();
  app.classList.add("hidden");
  login.classList.remove("hidden");
  $("password").value = "";
});

function imageCoordinates(event) {
  const rect = screen.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - rect.left) / rect.width * 1365),
    y: Math.round((event.clientY - rect.top) / rect.height * 850)
  };
}
screen.addEventListener("click", event => send("click", imageCoordinates(event)));
screen.addEventListener("wheel", event => {
  event.preventDefault();
  send("scroll", { dx: event.deltaX, dy: event.deltaY });
}, { passive: false });

document.addEventListener("keydown", event => {
  if (event.target === address || event.target === $("password")) {
    if (event.target === address && event.key === "Escape") address.blur();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    address.focus();
    address.select();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t") {
    event.preventDefault();
    send("newTab");
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
    event.preventDefault();
    const active = tabsEl.querySelector(".tab.active");
    if (active) active.querySelector(".tab-close").click();
    return;
  }
  if (event.key === "Backspace" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    send("back");
    return;
  }
  const allowed = [
    "Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown",
    "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space"
  ];
  if (allowed.includes(event.key) || event.key.startsWith("F") || event.key.length === 1) {
    event.preventDefault();
    const keyMap = { " ": "Space" };
    send("key", { key: keyMap[event.key] || event.key });
  }
});
