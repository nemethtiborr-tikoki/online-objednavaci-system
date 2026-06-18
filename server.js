const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
process.env.NODE_NO_WARNINGS = "1";
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "app.sqlite");
const JSON_DB_PATH = path.join(DATA_DIR, "db.json");
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
  const shouldSeed = !fs.existsSync(DB_PATH);
  const db = openSqlite();
  createSchema(db);
  const existing = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  db.close();

  if (shouldSeed || existing === 0) {
    const sourceDb = fs.existsSync(JSON_DB_PATH)
      ? JSON.parse(fs.readFileSync(JSON_DB_PATH, "utf8"))
      : initialDb;
    writeDb(sourceDb);
  }
}

function readDb() {
  ensureData();
  const db = openSqlite();
  try {
    const settingsRows = db.prepare("SELECT key, value FROM settings").all();
    const settings = Object.fromEntries(settingsRows.map(row => [row.key, row.value]));
    const users = db.prepare(`
      SELECT id, name, email, username, password, role,
        company_name AS companyName,
        company_id AS companyId,
        tax_id AS taxId,
        vat_id AS vatId,
        phone,
        ordering_person AS orderingPerson,
        operation_name AS operationName,
        address
      FROM users
      ORDER BY role, name
    `).all().map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      username: row.username,
      password: row.password,
      role: row.role,
      profile: {
        companyName: row.companyName || "",
        companyId: row.companyId || "",
        taxId: row.taxId || "",
        vatId: row.vatId || "",
        phone: row.phone || "",
        orderingPerson: row.orderingPerson || "",
        operationName: row.operationName || "",
        address: row.address || ""
      }
    }));
    const products = db.prepare(`
      SELECT id, card_number AS cardNumber, name, unit, weight, price, active
      FROM products
      ORDER BY card_number
    `).all().map(row => ({
      ...row,
      active: Boolean(row.active)
    }));
    const orders = db.prepare(`
      SELECT id, number, customer_id AS customerId, customer_name AS customerName,
        customer_email AS customerEmail, customer_profile AS customerProfile,
        note, status, created_at AS createdAt, updated_at AS updatedAt
      FROM orders
      ORDER BY datetime(created_at) DESC, number DESC
    `).all().map(row => ({
      ...row,
      customerProfile: row.customerProfile ? JSON.parse(row.customerProfile) : emptyProfile(),
      items: []
    }));
    const orderItems = db.prepare(`
      SELECT order_id AS orderId, product_id AS productId, card_number AS cardNumber,
        name, unit, weight, price, quantity
      FROM order_items
      ORDER BY rowid
    `).all();
    const orderById = new Map(orders.map(order => [order.id, order]));
    for (const item of orderItems) {
      const order = orderById.get(item.orderId);
      if (!order) continue;
      delete item.orderId;
      order.items.push(item);
    }
    return { settings, users, products, orders };
  } finally {
    db.close();
  }
}

function writeDb(db) {
  ensureDataDirectoryOnly();
  const sqlite = openSqlite();
  createSchema(sqlite);
  try {
    sqlite.exec("BEGIN IMMEDIATE");
    sqlite.exec("DELETE FROM order_items");
    sqlite.exec("DELETE FROM orders");
    sqlite.exec("DELETE FROM products");
    sqlite.exec("DELETE FROM users");
    sqlite.exec("DELETE FROM settings");

    const insertSetting = sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(db.settings || {})) {
      insertSetting.run(key, String(value ?? ""));
    }

    const insertUser = sqlite.prepare(`
      INSERT INTO users (
        id, name, email, username, password, role,
        company_name, company_id, tax_id, vat_id, phone, ordering_person, operation_name, address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const user of db.users || []) {
      const profile = user.profile || emptyProfile();
      insertUser.run(
        user.id,
        user.name,
        user.email,
        user.username,
        user.password,
        user.role,
        profile.companyName || "",
        profile.companyId || "",
        profile.taxId || "",
        profile.vatId || "",
        profile.phone || "",
        profile.orderingPerson || "",
        profile.operationName || "",
        profile.address || ""
      );
    }

    const insertProduct = sqlite.prepare(`
      INSERT INTO products (id, card_number, name, unit, weight, price, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const product of db.products || []) {
      insertProduct.run(
        product.id,
        product.cardNumber,
        product.name,
        product.unit,
        cleanNumber(product.weight),
        cleanNumber(product.price),
        product.active === false ? 0 : 1
      );
    }

    const insertOrder = sqlite.prepare(`
      INSERT INTO orders (
        id, number, customer_id, customer_name, customer_email, customer_profile,
        note, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrderItem = sqlite.prepare(`
      INSERT INTO order_items (
        order_id, product_id, card_number, name, unit, weight, price, quantity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const order of db.orders || []) {
      insertOrder.run(
        order.id,
        order.number,
        order.customerId,
        order.customerName,
        order.customerEmail,
        JSON.stringify(order.customerProfile || emptyProfile()),
        order.note || "",
        order.status || "nova",
        order.createdAt,
        order.updatedAt
      );
      for (const item of order.items || []) {
        insertOrderItem.run(
          order.id,
          item.productId,
          item.cardNumber,
          item.name,
          item.unit,
          cleanNumber(item.weight),
          cleanNumber(item.price),
          cleanQuantity(item.quantity)
        );
      }
    }

    sqlite.exec("COMMIT");
  } catch (error) {
    try {
      sqlite.exec("ROLLBACK");
    } catch (_) {
      // Transaction may already be closed.
    }
    throw error;
  } finally {
    sqlite.close();
  }
}

function ensureDataDirectoryOnly() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function openSqlite() {
  ensureDataDirectoryOnly();
  return new DatabaseSync(DB_PATH);
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      company_name TEXT DEFAULT '',
      company_id TEXT DEFAULT '',
      tax_id TEXT DEFAULT '',
      vat_id TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      ordering_person TEXT DEFAULT '',
      operation_name TEXT DEFAULT '',
      address TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      card_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      weight REAL DEFAULT 0,
      price REAL DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      customer_id TEXT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_profile TEXT DEFAULT '{}',
      note TEXT DEFAULT '',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id TEXT,
      card_number TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT DEFAULT '',
      weight REAL DEFAULT 0,
      price REAL DEFAULT 0,
      quantity INTEGER DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);
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

function cleanProductPayload(body) {
  return {
    cardNumber: cleanText(body.cardNumber),
    name: cleanText(body.name),
    unit: cleanText(body.unit),
    weight: cleanNumber(body.weight),
    price: cleanNumber(body.price),
    active: body.active !== false
  };
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
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
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
        ...cleanProductPayload(body)
      };
      if (!product.cardNumber || !product.name) {
        return sendJson(res, 400, { error: "Cislo karty a nazov su povinne." });
      }
      db.products.push(product);
      writeDb(db);
      return sendJson(res, 201, { product });
    }

    if (method === "POST" && url.pathname === "/api/products/import") {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const overwrite = body.overwrite === true;
      const incomingProducts = Array.isArray(body.products) ? body.products : [];
      const db = readDb();
      const result = {
        imported: 0,
        updated: 0,
        skipped: 0,
        invalid: 0,
        duplicates: []
      };

      for (const rawProduct of incomingProducts) {
        const productData = cleanProductPayload(rawProduct);
        if (!productData.cardNumber || !productData.name) {
          result.invalid += 1;
          continue;
        }

        const existing = db.products.find(product => product.cardNumber === productData.cardNumber);
        if (existing) {
          result.duplicates.push(productData.cardNumber);
          if (!overwrite) {
            result.skipped += 1;
            continue;
          }
          Object.assign(existing, productData);
          result.updated += 1;
          continue;
        }

        db.products.push({
          id: crypto.randomUUID(),
          ...productData
        });
        result.imported += 1;
      }

      writeDb(db);
      return sendJson(res, 200, { result, products: db.products });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/products/")) {
      if (!requireAdmin(req, res)) return;
      const id = url.pathname.split("/").pop();
      const body = await readBody(req);
      const db = readDb();
      const product = db.products.find(item => item.id === id);
      if (!product) return sendJson(res, 404, { error: "Polozka neexistuje." });
      Object.assign(product, cleanProductPayload(body));
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
