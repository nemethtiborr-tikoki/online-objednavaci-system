const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./database");
const { verifyPassword, hashSessionToken } = require("./auth");
const { sendOrderEmails, verifyEmailSettings, emailErrorMessage } = require("./email");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const EMAIL_LOG_PATH = path.join(DATA_DIR, "emails.log");
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const loginAttempts = new Map();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(Object.assign(new Error("Poziadavka je prilis velka."), { statusCode: 413 }));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (_) {
        reject(Object.assign(new Error("Neplatny format poziadavky."), { statusCode: 400 }));
      }
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map(value => value.trim().split("=")).filter(parts => parts.length === 2).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE_SECONDS) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

async function currentUser(req) {
  const token = parseCookies(req).sid;
  return token ? db.getUserBySession(hashSessionToken(token)) : null;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role, profile: user.profile || emptyProfile() };
}

async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Nie ste prihlaseny." });
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "Na tuto akciu nema ucet opravnenie." });
    return null;
  }
  return user;
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanBoolean(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function publicEmailSettings(settings) {
  return {
    emailProvider: settings.emailProvider === "brevo" ? "brevo" : "smtp",
    smtpEnabled: cleanBoolean(settings.smtpEnabled),
    smtpHost: settings.smtpHost || "",
    smtpPort: Number(settings.smtpPort) || 587,
    smtpSecure: cleanBoolean(settings.smtpSecure),
    smtpUsername: settings.smtpUsername || "",
    smtpFromName: settings.smtpFromName || "CORNiCO",
    smtpFromEmail: settings.smtpFromEmail || "",
    ownerEmail: settings.ownerEmail || "",
    hasPassword: Boolean(settings.smtpPassword),
    hasBrevoApiKey: Boolean(settings.brevoApiKey)
  };
}

function cleanEmailSettings(body, current) {
  const port = Number(body.smtpPort);
  const settings = {
    emailProvider: body.emailProvider === "brevo" ? "brevo" : "smtp",
    smtpEnabled: cleanBoolean(body.smtpEnabled),
    smtpHost: cleanText(body.smtpHost),
    smtpPort: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 587,
    smtpSecure: cleanBoolean(body.smtpSecure),
    smtpUsername: cleanText(body.smtpUsername),
    smtpFromName: cleanText(body.smtpFromName) || "CORNiCO",
    smtpFromEmail: cleanText(body.smtpFromEmail),
    ownerEmail: cleanText(body.ownerEmail),
    smtpPassword: cleanText(body.smtpPassword).replace(/\s/g, "") || current.smtpPassword || "",
    brevoApiKey: cleanText(body.brevoApiKey) || current.brevoApiKey || ""
  };
  return settings;
}

function cleanQuantity(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function emptyProfile() {
  return { companyName: "", companyId: "", taxId: "", vatId: "", phone: "", orderingPerson: "", operationName: "", address: "" };
}

function cleanProfile(value = {}) {
  return {
    companyName: cleanText(value.companyName), companyId: cleanText(value.companyId),
    taxId: cleanText(value.taxId), vatId: cleanText(value.vatId), phone: cleanText(value.phone),
    orderingPerson: cleanText(value.orderingPerson), operationName: cleanText(value.operationName),
    address: cleanText(value.address)
  };
}

function cleanCustomerPayload(body) {
  return {
    name: cleanText(body.name), email: cleanText(body.email), username: cleanText(body.username),
    password: cleanText(body.password), role: "customer", profile: cleanProfile(body.profile)
  };
}

function cleanOrderStatus(value, fallback = "nova") {
  const status = cleanText(value);
  if (status === "spracovana") return "spracovava_sa";
  return ["nova", "spracovava_sa", "vybavena"].includes(status) ? status : fallback;
}

function cleanAnnouncementPayload(body) {
  const category = cleanText(body.category);
  return {
    category: ["upozornenie", "novinka", "ponuka", "ine"].includes(category) ? category : "ine",
    title: cleanText(body.title),
    content: cleanText(body.content)
  };
}

function cleanProductPayload(body) {
  return {
    cardNumber: cleanText(body.cardNumber), name: cleanText(body.name), unit: cleanText(body.unit),
    weight: cleanNumber(body.weight), price: cleanNumber(body.price), active: body.active !== false
  };
}

function cleanOrderItems(items) {
  if (!Array.isArray(items)) return null;
  return items.map(item => ({
    productId: cleanText(item.productId), cardNumber: cleanText(item.cardNumber), name: cleanText(item.name),
    unit: cleanText(item.unit), weight: cleanNumber(item.weight), price: cleanNumber(item.price),
    quantity: cleanQuantity(item.quantity)
  })).filter(item => item.quantity > 0 && item.name);
}

function orderTotal(order) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function orderWeight(order) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.weight, 0);
}

async function appendEmailLog(order, customer) {
  const settings = await db.getSettings();
  const lines = ["", "============================================================", `Cas: ${new Date().toISOString()}`, `Komu: ${customer.email}, ${settings.ownerEmail || ""}`, `Predmet: Objednavka ${order.number}`, "", `Objednavka: ${order.number}`, `Zakaznik: ${customer.name} <${customer.email}>`, `Poznamka: ${order.note || "-"}`, "", "Polozky:"];
  for (const item of order.items) lines.push(`- ${item.cardNumber} | ${item.name} | ${item.quantity} ${item.unit} | ${item.weight} kg/ks | ${item.price.toFixed(2)} EUR`);
  lines.push("", `Hmotnost spolu: ${orderWeight(order).toFixed(2)} kg`, `Spolu: ${orderTotal(order).toFixed(2)} EUR`, "");
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.appendFile(EMAIL_LOG_PATH, lines.join("\n"), "utf8");
}

function getContentType(filePath) {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": getContentType(filePath), "X-Content-Type-Options": "nosniff" });
    res.end(data);
  });
}

function clientAddress(req) {
  return cleanText(req.headers["x-forwarded-for"]).split(",")[0] || req.socket.remoteAddress || "unknown";
}

function isLoginBlocked(req) {
  const key = clientAddress(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60_000 });
    return false;
  }
  return entry.count >= 10;
}

function recordLoginFailure(req) {
  const key = clientAddress(req);
  const entry = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60_000 };
  entry.count += 1;
  loginAttempts.set(key, entry);
}

function clearLoginFailures(req) {
  loginAttempts.delete(clientAddress(req));
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  try {
    if (method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true });

    if (method === "POST" && url.pathname === "/api/login") {
      if (isLoginBlocked(req)) return sendJson(res, 429, { error: "Prilis vela pokusov. Skuste to neskor." });
      const body = await readBody(req);
      const user = await db.getUserByUsername(cleanText(body.username));
      if (!user || !(await verifyPassword(cleanText(body.password), user.passwordHash))) {
        recordLoginFailure(req);
        return sendJson(res, 401, { error: "Nespravne prihlasovacie udaje." });
      }
      clearLoginFailures(req);
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
      await db.createSession(hashSessionToken(token), user.id, expiresAt);
      res.setHeader("Set-Cookie", sessionCookie(token));
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (method === "POST" && url.pathname === "/api/logout") {
      const token = parseCookies(req).sid;
      if (token) await db.deleteSession(hashSessionToken(token));
      res.setHeader("Set-Cookie", sessionCookie("", 0));
      return sendJson(res, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/me") return sendJson(res, 200, { user: publicUser(await currentUser(req)) });

    if (method === "GET" && url.pathname === "/api/profile") {
      const user = await requireUser(req, res);
      if (user) return sendJson(res, 200, { user: publicUser(user) });
      return;
    }

    if (method === "PUT" && url.pathname === "/api/profile") {
      const user = await requireUser(req, res);
      if (!user) return;
      const body = await readBody(req);
      const updated = await db.updateProfile(user.id, { name: cleanText(body.name) || user.name, email: cleanText(body.email) || user.email, profile: cleanProfile(body.profile) });
      return sendJson(res, 200, { user: publicUser(updated) });
    }

    if (method === "GET" && url.pathname === "/api/customers") {
      if (!(await requireAdmin(req, res))) return;
      return sendJson(res, 200, { customers: (await db.listCustomers()).map(publicUser) });
    }

    if (method === "POST" && url.pathname === "/api/customers") {
      if (!(await requireAdmin(req, res))) return;
      const data = cleanCustomerPayload(await readBody(req));
      if (!data.username || !data.password || data.password.length < 8 || !data.name || !data.email) return sendJson(res, 400, { error: "Meno, e-mail, prihlasovacie meno a heslo s aspon 8 znakmi su povinne." });
      const customer = await db.createCustomer(data);
      return sendJson(res, 201, { customer: publicUser(customer) });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/customers/")) {
      if (!(await requireAdmin(req, res))) return;
      const id = url.pathname.split("/").pop();
      const data = cleanCustomerPayload(await readBody(req));
      if (!data.username || !data.name || !data.email || (data.password && data.password.length < 8)) return sendJson(res, 400, { error: "Skontrolujte povinne udaje; nove heslo musi mat aspon 8 znakov." });
      const customer = await db.updateCustomer(id, data);
      if (!customer) return sendJson(res, 404, { error: "Zakaznik neexistuje." });
      return sendJson(res, 200, { customer: publicUser(customer) });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/customers/")) {
      if (!(await requireAdmin(req, res))) return;
      const customer = await db.deleteCustomer(url.pathname.split("/").pop());
      if (!customer) return sendJson(res, 404, { error: "Zakaznik neexistuje." });
      return sendJson(res, 200, { customer: publicUser(customer) });
    }

    if (method === "GET" && url.pathname === "/api/settings/email") {
      if (!(await requireAdmin(req, res))) return;
      return sendJson(res, 200, { settings: publicEmailSettings(await db.getSettings()) });
    }

    if (method === "PUT" && url.pathname === "/api/settings/email") {
      if (!(await requireAdmin(req, res))) return;
      const current = await db.getSettings();
      const settings = cleanEmailSettings(await readBody(req), current);
      if (settings.smtpEnabled && (!settings.smtpFromEmail || !settings.ownerEmail)) {
        return sendJson(res, 400, { error: "Pri zapnutom odosielani vyplnte e-mail odosielatela a e-mail pre prijem objednavok." });
      }
      if (settings.smtpEnabled && settings.emailProvider === "brevo" && !settings.brevoApiKey) {
        return sendJson(res, 400, { error: "Pri odosielani cez Brevo zadajte API kluc." });
      }
      if (settings.smtpEnabled && settings.emailProvider === "smtp" && !settings.smtpHost) {
        return sendJson(res, 400, { error: "Pri odosielani cez SMTP zadajte adresu servera." });
      }
      const updated = await db.updateSettings(settings);
      return sendJson(res, 200, { settings: publicEmailSettings(updated) });
    }

    if (method === "POST" && url.pathname === "/api/settings/email/test") {
      if (!(await requireAdmin(req, res))) return;
      const settings = await db.getSettings();
      try {
        await verifyEmailSettings(settings);
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        console.error("Overenie e-mailovej sluzby zlyhalo:", error.message);
        return sendJson(res, 400, { error: emailErrorMessage(error, settings) });
      }
    }

    if (method === "GET" && url.pathname === "/api/announcements") {
      const user = await requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, { announcements: await db.listAnnouncements(user.role === "admin") });
    }

    if (method === "POST" && url.pathname === "/api/announcements") {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const announcement = cleanAnnouncementPayload(await readBody(req));
      if (!announcement.title || !announcement.content) return sendJson(res, 400, { error: "Nadpis a text informacie su povinne." });
      if (announcement.title.length > 160 || announcement.content.length > 10_000) return sendJson(res, 400, { error: "Nadpis alebo text informacie je prilis dlhy." });
      return sendJson(res, 201, { announcement: await db.createAnnouncement(announcement, admin) });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/announcements/")) {
      if (!(await requireAdmin(req, res))) return;
      const body = await readBody(req);
      const announcement = await db.setAnnouncementPublished(url.pathname.split("/").pop(), cleanBoolean(body.published));
      if (!announcement) return sendJson(res, 404, { error: "Informacia neexistuje." });
      return sendJson(res, 200, { announcement });
    }

    if (method === "GET" && url.pathname === "/api/products") {
      const user = await requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, { products: await db.listProducts(user.role === "admin") });
    }

    if (method === "POST" && url.pathname === "/api/products") {
      if (!(await requireAdmin(req, res))) return;
      const product = cleanProductPayload(await readBody(req));
      if (!product.cardNumber || !product.name) return sendJson(res, 400, { error: "Cislo karty a nazov su povinne." });
      return sendJson(res, 201, { product: await db.createProduct(product) });
    }

    if (method === "POST" && url.pathname === "/api/products/import") {
      if (!(await requireAdmin(req, res))) return;
      const body = await readBody(req);
      const products = (Array.isArray(body.products) ? body.products : []).map(cleanProductPayload);
      return sendJson(res, 200, await db.importProducts(products, body.overwrite === true));
    }

    if (method === "PUT" && url.pathname.startsWith("/api/products/")) {
      if (!(await requireAdmin(req, res))) return;
      const product = await db.updateProduct(url.pathname.split("/").pop(), cleanProductPayload(await readBody(req)));
      if (!product) return sendJson(res, 404, { error: "Polozka neexistuje." });
      return sendJson(res, 200, { product });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/products/")) {
      if (!(await requireAdmin(req, res))) return;
      const product = await db.deleteProduct(url.pathname.split("/").pop());
      if (!product) return sendJson(res, 404, { error: "Polozka neexistuje." });
      return sendJson(res, 200, { product });
    }

    if (method === "POST" && url.pathname === "/api/orders") {
      const user = await requireUser(req, res);
      if (!user) return;
      const body = await readBody(req);
      const order = await db.createOrder(user, Array.isArray(body.items) ? body.items : [], cleanText(body.note));
      await appendEmailLog(order, user).catch(error => console.error("E-mailovy zaznam sa nepodarilo zapisat:", error.message));
      let email = { configured: false, sent: false };
      try {
        email = await sendOrderEmails(order, await db.getSettings());
      } catch (error) {
        email = { configured: true, sent: false };
        console.error("Objednavku sa nepodarilo odoslat e-mailom:", error.message);
      }
      return sendJson(res, 201, { order, email });
    }

    if (method === "GET" && url.pathname === "/api/orders") {
      const user = await requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, { orders: await db.listOrders(user) });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/orders/")) {
      if (!(await requireAdmin(req, res))) return;
      const id = url.pathname.split("/").pop();
      const body = await readBody(req);
      const existing = await db.getOrderById(id);
      if (!existing) return sendJson(res, 404, { error: "Objednavka neexistuje." });
      const order = await db.updateOrder(id, { status: cleanOrderStatus(body.status, existing.status), note: cleanText(body.note), items: body.items === undefined ? undefined : cleanOrderItems(body.items) });
      return sendJson(res, 200, { order });
    }

    return sendJson(res, 404, { error: "API endpoint neexistuje." });
  } catch (error) {
    console.error(error);
    if (error.code === "23505") return sendJson(res, 400, { error: "Rovnaky prihlasovaci udaj alebo cislo karty uz existuje." });
    return sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Serverova chyba." });
  }
}

async function start() {
  await db.initializeDatabase();
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  });
  server.listen(PORT, () => console.log(`Online objednavaci system bezi na porte ${PORT}`));
}

start().catch(error => {
  console.error("Aplikaciu sa nepodarilo spustit:", error.message);
  process.exit(1);
});
