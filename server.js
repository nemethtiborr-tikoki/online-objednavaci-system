const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const EMAIL_LOG_PATH = path.join(DATA_DIR, "emails.log");

const sessions = new Map();

const initialDb = {
  settings: {
    ownerEmail: "objednavky@firma.sk",
    companyName: "Moja firma"
  },
  users: [
    {
      id: "admin",
      name: "Administrator",
      email: "admin@firma.sk",
      username: "admin",
      password: "admin123",
      role: "admin"
    },
    {
      id: "customer-1",
      name: "Zakaznik Demo",
      email: "zakaznik@example.com",
      username: "zakaznik",
      password: "zakaznik123",
      role: "customer",
      profile: {
        companyName: "Demo s.r.o.",
        companyId: "",
        taxId: "",
        vatId: "",
        phone: "",
        orderingPerson: "Zakaznik Demo",
        operationName: "Demo prevadzka",
        address: ""
      }
    }
  ],
  products: [
    {
      id: "p-1001",
      cardNumber: "1001",
      name: "Hladka muka special",
      unit: "kg",
      weight: 1,
      price: 0.89,
      active: true
    },
    {
      id: "p-1002",
      cardNumber: "1002",
      name: "Cukor krystal",
      unit: "kg",
      weight: 1,
      price: 1.19,
      active: true
    },
    {
      id: "p-1003",
      cardNumber: "1003",
      name: "Rastlinny olej",
      unit: "ks",
      weight: 1,
      price: 2.49,
      active: true
    }
  ],
  orders: []
};

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(initialDb, null, 2), "utf8");
  }
}

function readDb() {
  ensureData();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
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
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map(cookie => cookie.trim().split("="))
      .filter(parts => parts.length === 2)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid || !sessions.has(sid)) return null;
  const db = readDb();
  const userId = sessions.get(sid);
  return db.users.find(user => user.id === userId) || null;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    profile: user.profile || emptyProfile()
  };
}

function publicCustomer(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    profile: user.profile || emptyProfile()
  };
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Nie ste prihlaseny." });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
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

function cleanQuantity(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function emptyProfile() {
  return {
    companyName: "",
    companyId: "",
    taxId: "",
    vatId: "",
    phone: "",
    orderingPerson: "",
    operationName: "",
    address: ""
  };
}

function cleanProfile(value = {}) {
  return {
    companyName: cleanText(value.companyName),
    companyId: cleanText(value.companyId),
    taxId: cleanText(value.taxId),
    vatId: cleanText(value.vatId),
    phone: cleanText(value.phone),
    orderingPerson: cleanText(value.orderingPerson),
    operationName: cleanText(value.operationName),
    address: cleanText(value.address)
  };
}

function cleanCustomerPayload(body, existing = {}) {
  const username = cleanText(body.username || existing.username);
  const password = cleanText(body.password || existing.password);
  const name = cleanText(body.name || existing.name);
  const email = cleanText(body.email || existing.email);
  return {
    name,
    email,
    username,
    password,
    role: "customer",
    profile: cleanProfile(body.profile || existing.profile)
  };
}

function cleanOrderStatus(value, fallback = "nova") {
  const status = cleanText(value);
  if (status === "spracovana") return "spracovava_sa";
  return ["nova", "spracovava_sa", "vybavena"].includes(status) ? status : fallback;
}

function orderTotal(order) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function orderWeight(order) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.weight, 0);
}

function appendEmailLog(db, order, customer) {
  const ownerEmail = db.settings.ownerEmail;
  const subject = `Objednavka ${order.number}`;
  const lines = [
    "",
    "============================================================",
    `Cas: ${new Date().toISOString()}`,
    `Komu: ${customer.email}, ${ownerEmail}`,
    `Predmet: ${subject}`,
    "",
    `Objednavka: ${order.number}`,
    `Zakaznik: ${customer.name} <${customer.email}>`,
    `Poznamka: ${order.note || "-"}`,
    "",
    "Polozky:"
  ];

  for (const item of order.items) {
    lines.push(
      `- ${item.cardNumber} | ${item.name} | ${item.quantity} ${item.unit} | ${item.weight} kg/ks | ${item.price.toFixed(2)} EUR`
    );
  }

  lines.push("", `Hmotnost spolu: ${orderWeight(order).toFixed(2)} kg`, `Spolu: ${orderTotal(order).toFixed(2)} EUR`, "");
  fs.appendFileSync(EMAIL_LOG_PATH, lines.join("\n"), "utf8");
}

function nextOrderNumber(db) {
  const year = new Date().getFullYear();
  const count = db.orders.filter(order => order.number.startsWith(`${year}-`)).length + 1;
  return `${year}-${String(count).padStart(4, "0")}`;
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    res.end(data);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  try {
    if (method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const db = readDb();
      const user = db.users.find(
        item => item.username === cleanText(body.username) && item.password === cleanText(body.password)
      );
      if (!user) return sendJson(res, 401, { error: "Nespravne prihlasovacie udaje." });
      const sid = crypto.randomBytes(24).toString("hex");
      sessions.set(sid, user.id);
      res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (method === "POST" && url.pathname === "/api/logout") {
      const sid = parseCookies(req).sid;
      if (sid) sessions.delete(sid);
      res.setHeader("Set-Cookie", "sid=; Max-Age=0; Path=/");
      return sendJson(res, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/me") {
      return sendJson(res, 200, { user: publicUser(currentUser(req)) });
    }

    if (method === "GET" && url.pathname === "/api/profile") {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (method === "PUT" && url.pathname === "/api/profile") {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readBody(req);
      const db = readDb();
      const dbUser = db.users.find(item => item.id === user.id);
      if (!dbUser) return sendJson(res, 404, { error: "Zakaznik neexistuje." });
      dbUser.name = cleanText(body.name) || dbUser.name;
      dbUser.email = cleanText(body.email) || dbUser.email;
      dbUser.profile = cleanProfile(body.profile);
      writeDb(db);
      return sendJson(res, 200, { user: publicUser(dbUser) });
    }

    if (method === "GET" && url.pathname === "/api/customers") {
      if (!requireAdmin(req, res)) return;
      const db = readDb();
      const customers = db.users.filter(user => user.role === "customer").map(publicCustomer);
      return sendJson(res, 200, { customers });
    }

    if (method === "POST" && url.pathname === "/api/customers") {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const db = readDb();
      const customerData = cleanCustomerPayload(body);
      if (!customerData.username || !customerData.password || !customerData.name || !customerData.email) {
        return sendJson(res, 400, { error: "Meno, e-mail, prihlasovacie meno a heslo su povinne." });
      }
      if (db.users.some(user => user.username === customerData.username)) {
        return sendJson(res, 400, { error: "Prihlasovacie meno uz existuje." });
      }
      const customer = {
        id: crypto.randomUUID(),
        ...customerData
      };
      db.users.push(customer);
      writeDb(db);
      return sendJson(res, 201, { customer: publicCustomer(customer) });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/customers/")) {
      if (!requireAdmin(req, res)) return;
      const id = url.pathname.split("/").pop();
      const body = await readBody(req);
      const db = readDb();
      const customer = db.users.find(user => user.id === id && user.role === "customer");
      if (!customer) return sendJson(res, 404, { error: "Zakaznik neexistuje." });
      const customerData = cleanCustomerPayload(body, customer);
      if (!customerData.username || !customerData.password || !customerData.name || !customerData.email) {
        return sendJson(res, 400, { error: "Meno, e-mail, prihlasovacie meno a heslo su povinne." });
      }
      if (db.users.some(user => user.id !== id && user.username === customerData.username)) {
        return sendJson(res, 400, { error: "Prihlasovacie meno uz existuje." });
      }
      Object.assign(customer, customerData);
      writeDb(db);
      return sendJson(res, 200, { customer: publicCustomer(customer) });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/customers/")) {
      if (!requireAdmin(req, res)) return;
      const id = url.pathname.split("/").pop();
      const db = readDb();
      const customerIndex = db.users.findIndex(user => user.id === id && user.role === "customer");
      if (customerIndex === -1) return sendJson(res, 404, { error: "Zakaznik neexistuje." });
      const [customer] = db.users.splice(customerIndex, 1);
      for (const [sid, userId] of sessions.entries()) {
        if (userId === id) sessions.delete(sid);
      }
      writeDb(db);
      return sendJson(res, 200, { customer: publicCustomer(customer) });
    }

    if (method === "GET" && url.pathname === "/api/products") {
      const user = requireUser(req, res);
      if (!user) return;
      const db = readDb();
      const products = user.role === "admin" ? db.products : db.products.filter(product => product.active);
      return sendJson(res, 200, { products });
    }

    if (method === "POST" && url.pathname === "/api/products") {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const db = readDb();
      const product = {
        id: crypto.randomUUID(),
        cardNumber: cleanText(body.cardNumber),
        name: cleanText(body.name),
        unit: cleanText(body.unit),
        weight: cleanNumber(body.weight),
        price: cleanNumber(body.price),
        active: body.active !== false
      };
      db.products.push(product);
      writeDb(db);
      return sendJson(res, 201, { product });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/products/")) {
      if (!requireAdmin(req, res)) return;
      const id = url.pathname.split("/").pop();
      const body = await readBody(req);
      const db = readDb();
      const product = db.products.find(item => item.id === id);
      if (!product) return sendJson(res, 404, { error: "Polozka neexistuje." });
      product.cardNumber = cleanText(body.cardNumber);
      product.name = cleanText(body.name);
      product.unit = cleanText(body.unit);
      product.weight = cleanNumber(body.weight);
      product.price = cleanNumber(body.price);
      product.active = body.active !== false;
      writeDb(db);
      return sendJson(res, 200, { product });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/products/")) {
      if (!requireAdmin(req, res)) return;
      const id = url.pathname.split("/").pop();
      const db = readDb();
      const productIndex = db.products.findIndex(item => item.id === id);
      if (productIndex === -1) return sendJson(res, 404, { error: "Polozka neexistuje." });
      const [product] = db.products.splice(productIndex, 1);
      writeDb(db);
      return sendJson(res, 200, { product });
    }

    if (method === "POST" && url.pathname === "/api/orders") {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readBody(req);
      const db = readDb();
      const lines = Array.isArray(body.items) ? body.items : [];
      const items = lines
        .map(line => {
          const product = db.products.find(item => item.id === line.productId && item.active);
          const quantity = cleanQuantity(line.quantity);
          if (!product || quantity <= 0) return null;
          return {
            productId: product.id,
            cardNumber: product.cardNumber,
            name: product.name,
            unit: product.unit,
            weight: product.weight,
            price: product.price,
            quantity
          };
        })
        .filter(Boolean);

      if (!items.length) return sendJson(res, 400, { error: "Objednavka musi obsahovat aspon jednu polozku." });

      const order = {
        id: crypto.randomUUID(),
        number: nextOrderNumber(db),
        customerId: user.id,
        customerName: user.name,
        customerEmail: user.email,
        customerProfile: user.profile || emptyProfile(),
        note: cleanText(body.note),
        status: "nova",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items
      };
      db.orders.unshift(order);
      writeDb(db);
      appendEmailLog(db, order, user);
      return sendJson(res, 201, { order });
    }

    if (method === "GET" && url.pathname === "/api/orders") {
      const user = requireUser(req, res);
      if (!user) return;
      const db = readDb();
      const orders = user.role === "admin" ? db.orders : db.orders.filter(order => order.customerId === user.id);
      return sendJson(res, 200, { orders });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/orders/")) {
      if (!requireAdmin(req, res)) return;
      const id = url.pathname.split("/").pop();
      const body = await readBody(req);
      const db = readDb();
      const order = db.orders.find(item => item.id === id);
      if (!order) return sendJson(res, 404, { error: "Objednavka neexistuje." });
      order.status = cleanOrderStatus(body.status, order.status);
      order.note = cleanText(body.note);
      if (Array.isArray(body.items)) {
        order.items = body.items
          .map(item => ({
            productId: cleanText(item.productId),
            cardNumber: cleanText(item.cardNumber),
            name: cleanText(item.name),
            unit: cleanText(item.unit),
            weight: cleanNumber(item.weight),
            price: cleanNumber(item.price),
            quantity: cleanQuantity(item.quantity)
          }))
          .filter(item => item.quantity > 0 && item.name);
      }
      order.updatedAt = new Date().toISOString();
      writeDb(db);
      return sendJson(res, 200, { order });
    }

    sendJson(res, 404, { error: "API endpoint neexistuje." });
  } catch (error) {
    sendJson(res, 500, { error: "Serverova chyba.", detail: error.message });
  }
}

ensureData();

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`Online objednavaci system bezi na http://localhost:${PORT}`);
  });
