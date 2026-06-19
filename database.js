const crypto = require("crypto");
const { Pool } = require("pg");
const { hashPassword } = require("./auth");

if (!process.env.DATABASE_URL) {
  throw new Error("Chyba premenna DATABASE_URL s pripojenim k PostgreSQL databaze.");
}

const connectionString = process.env.DATABASE_URL.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");

const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_SIZE) || 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const defaultProducts = [
  { id: "p-1001", cardNumber: "1001", name: "Hladka muka special", unit: "kg", weight: 1, price: 0.89, active: true },
  { id: "p-1002", cardNumber: "1002", name: "Cukor krystal", unit: "kg", weight: 1, price: 1.19, active: true },
  { id: "p-1003", cardNumber: "1003", name: "Rastlinny olej", unit: "ks", weight: 1, price: 2.49, active: true }
];

function emptyProfile() {
  return { companyName: "", companyId: "", taxId: "", vatId: "", phone: "", orderingPerson: "", operationName: "", address: "" };
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    profile: {
      companyName: row.company_name || "",
      companyId: row.company_id || "",
      taxId: row.tax_id || "",
      vatId: row.vat_id || "",
      phone: row.phone || "",
      orderingPerson: row.ordering_person || "",
      operationName: row.operation_name || "",
      address: row.address || ""
    }
  };
}

function mapProduct(row) {
  return {
    id: row.id,
    cardNumber: row.card_number,
    name: row.name,
    unit: row.unit || "",
    weight: Number(row.weight),
    price: Number(row.price),
    active: Boolean(row.active)
  };
}

function mapOrder(row) {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerProfile: row.customer_profile || emptyProfile(),
    note: row.note || "",
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    items: []
  };
}

function mapOrderItem(row) {
  return {
    productId: row.product_id,
    cardNumber: row.card_number,
    name: row.name,
    unit: row.unit || "",
    weight: Number(row.weight),
    price: Number(row.price),
    quantity: Number(row.quantity)
  };
}

function mapAnnouncement(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    authorName: row.author_name || "Administrator",
    published: Boolean(row.published),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function createSchema(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'customer')),
      company_name TEXT NOT NULL DEFAULT '',
      company_id TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      vat_id TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      ordering_person TEXT NOT NULL DEFAULT '',
      operation_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      card_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      weight DOUBLE PRECISION NOT NULL DEFAULT 0,
      price DOUBLE PRECISION NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      customer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT,
      card_number TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      weight DOUBLE PRECISION NOT NULL DEFAULT 0,
      price DOUBLE PRECISION NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS order_counters (
      year INTEGER PRIMARY KEY,
      last_number INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS announcements_created_at_idx ON announcements(created_at DESC);
  `);
}

async function initializeDatabase() {
  await createSchema();
  const { rows: [{ count }] } = await pool.query("SELECT COUNT(*)::integer AS count FROM users");
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (count > 0) {
    if (adminPassword) {
      if (adminPassword.length < 10) throw new Error("ADMIN_PASSWORD musi mat aspon 10 znakov.");
      const result = await pool.query(
        "UPDATE users SET password_hash=$1 WHERE username=$2 AND role='admin'",
        [await hashPassword(adminPassword), process.env.ADMIN_USERNAME || "admin"]
      );
      if (!result.rowCount) throw new Error("Administrator urceny cez ADMIN_USERNAME neexistuje.");
    }
    return;
  }

  if (!adminPassword || adminPassword.length < 10) {
    throw new Error("Pre prvy start nastavte ADMIN_PASSWORD s aspon 10 znakmi.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO settings (key, value) VALUES ($1, $2), ($3, $4) ON CONFLICT DO NOTHING", [
      "ownerEmail", process.env.OWNER_EMAIL || "objednavky@firma.sk",
      "companyName", process.env.COMPANY_NAME || "Moja firma"
    ]);
    await client.query(
      "INSERT INTO users (id, name, email, username, password_hash, role) VALUES ($1, $2, $3, $4, $5, 'admin')",
      ["admin", process.env.ADMIN_NAME || "Administrator", process.env.ADMIN_EMAIL || "admin@firma.sk", process.env.ADMIN_USERNAME || "admin", await hashPassword(adminPassword)]
    );
    for (const product of defaultProducts) await insertProduct(client, product);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getUserByUsername(username) {
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  return mapUser(rows[0]);
}

async function getUserById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return mapUser(rows[0]);
}

async function getUserBySession(tokenHash) {
  const { rows } = await pool.query(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > NOW()
  `, [tokenHash]);
  return mapUser(rows[0]);
}

async function createSession(tokenHash, userId, expiresAt) {
  await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash, userId, expiresAt]);
}

async function deleteSession(tokenHash) {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

async function updateProfile(id, data) {
  const profile = data.profile || emptyProfile();
  const { rows } = await pool.query(`
    UPDATE users SET name=$2, email=$3, company_name=$4, company_id=$5, tax_id=$6,
      vat_id=$7, phone=$8, ordering_person=$9, operation_name=$10, address=$11
    WHERE id=$1 RETURNING *
  `, [id, data.name, data.email, profile.companyName, profile.companyId, profile.taxId, profile.vatId, profile.phone, profile.orderingPerson, profile.operationName, profile.address]);
  return mapUser(rows[0]);
}

async function listCustomers() {
  const { rows } = await pool.query("SELECT * FROM users WHERE role='customer' ORDER BY name");
  return rows.map(mapUser);
}

async function createCustomer(data) {
  const profile = data.profile || emptyProfile();
  const { rows } = await pool.query(`
    INSERT INTO users (id,name,email,username,password_hash,role,company_name,company_id,tax_id,vat_id,phone,ordering_person,operation_name,address)
    VALUES ($1,$2,$3,$4,$5,'customer',$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
  `, [crypto.randomUUID(), data.name, data.email, data.username, await hashPassword(data.password), profile.companyName, profile.companyId, profile.taxId, profile.vatId, profile.phone, profile.orderingPerson, profile.operationName, profile.address]);
  return mapUser(rows[0]);
}

async function updateCustomer(id, data) {
  const profile = data.profile || emptyProfile();
  const values = [id, data.name, data.email, data.username, profile.companyName, profile.companyId, profile.taxId, profile.vatId, profile.phone, profile.orderingPerson, profile.operationName, profile.address];
  let passwordSql = "";
  if (data.password) {
    values.push(await hashPassword(data.password));
    passwordSql = `, password_hash=$${values.length}`;
  }
  const { rows } = await pool.query(`
    UPDATE users SET name=$2,email=$3,username=$4,company_name=$5,company_id=$6,tax_id=$7,
      vat_id=$8,phone=$9,ordering_person=$10,operation_name=$11,address=$12${passwordSql}
    WHERE id=$1 AND role='customer' RETURNING *
  `, values);
  return mapUser(rows[0]);
}

async function deleteCustomer(id) {
  const { rows } = await pool.query("DELETE FROM users WHERE id=$1 AND role='customer' RETURNING *", [id]);
  return mapUser(rows[0]);
}

async function listProducts(includeInactive) {
  const sql = includeInactive ? "SELECT * FROM products ORDER BY card_number" : "SELECT * FROM products WHERE active=TRUE ORDER BY card_number";
  const { rows } = await pool.query(sql);
  return rows.map(mapProduct);
}

async function insertProduct(client, product) {
  const { rows } = await client.query(`
    INSERT INTO products (id,card_number,name,unit,weight,price,active)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
  `, [product.id || crypto.randomUUID(), product.cardNumber, product.name, product.unit, product.weight, product.price, product.active]);
  return mapProduct(rows[0]);
}

async function createProduct(product) {
  return insertProduct(pool, product);
}

async function updateProduct(id, product) {
  const { rows } = await pool.query(`
    UPDATE products SET card_number=$2,name=$3,unit=$4,weight=$5,price=$6,active=$7
    WHERE id=$1 RETURNING *
  `, [id, product.cardNumber, product.name, product.unit, product.weight, product.price, product.active]);
  return rows[0] ? mapProduct(rows[0]) : null;
}

async function deleteProduct(id) {
  const { rows } = await pool.query("DELETE FROM products WHERE id=$1 RETURNING *", [id]);
  return rows[0] ? mapProduct(rows[0]) : null;
}

async function importProducts(products, overwrite) {
  const result = { imported: 0, updated: 0, skipped: 0, invalid: 0, duplicates: [] };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const product of products) {
      if (!product.cardNumber || !product.name) {
        result.invalid += 1;
        continue;
      }
      const existing = await client.query("SELECT id FROM products WHERE card_number=$1", [product.cardNumber]);
      if (existing.rowCount) {
        result.duplicates.push(product.cardNumber);
        if (!overwrite) {
          result.skipped += 1;
          continue;
        }
        await updateProductWithClient(client, existing.rows[0].id, product);
        result.updated += 1;
      } else {
        await insertProduct(client, product);
        result.imported += 1;
      }
    }
    await client.query("COMMIT");
    return { result, products: await listProducts(true) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateProductWithClient(client, id, product) {
  await client.query("UPDATE products SET card_number=$2,name=$3,unit=$4,weight=$5,price=$6,active=$7 WHERE id=$1", [id, product.cardNumber, product.name, product.unit, product.weight, product.price, product.active]);
}

async function getSettings() {
  const { rows } = await pool.query("SELECT key,value FROM settings");
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}

async function updateSettings(settings) {
  const entries = Object.entries(settings);
  if (!entries.length) return getSettings();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of entries) {
      await client.query(`
        INSERT INTO settings (key,value) VALUES ($1,$2)
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value
      `, [key, String(value ?? "")]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getSettings();
}

async function listAnnouncements(includeHidden = false) {
  const where = includeHidden ? "" : "WHERE published=TRUE";
  const { rows } = await pool.query(`SELECT * FROM announcements ${where} ORDER BY created_at DESC, id DESC`);
  return rows.map(mapAnnouncement);
}

async function createAnnouncement(data, author) {
  const now = new Date();
  const { rows } = await pool.query(`
    INSERT INTO announcements (id,category,title,content,author_id,author_name,published,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$7) RETURNING *
  `, [crypto.randomUUID(), data.category, data.title, data.content, author.id, author.name, now]);
  return mapAnnouncement(rows[0]);
}

async function setAnnouncementPublished(id, published) {
  const { rows } = await pool.query(
    "UPDATE announcements SET published=$2,updated_at=NOW() WHERE id=$1 RETURNING *",
    [id, published]
  );
  return rows[0] ? mapAnnouncement(rows[0]) : null;
}

async function createOrder(user, lines, note) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [...new Set(lines.map(line => line.productId).filter(Boolean))];
    const { rows: productRows } = await client.query("SELECT * FROM products WHERE id=ANY($1::text[]) AND active=TRUE", [ids]);
    const products = new Map(productRows.map(row => [row.id, mapProduct(row)]));
    const items = lines.map(line => {
      const product = products.get(line.productId);
      const quantity = Math.floor(Number(line.quantity));
      return product && quantity > 0 ? { productId: product.id, cardNumber: product.cardNumber, name: product.name, unit: product.unit, weight: product.weight, price: product.price, quantity } : null;
    }).filter(Boolean);
    if (!items.length) {
      const error = new Error("Objednavka musi obsahovat aspon jednu polozku.");
      error.statusCode = 400;
      throw error;
    }

    const year = new Date().getFullYear();
    const { rows: counterRows } = await client.query(`
      INSERT INTO order_counters (year,last_number) VALUES ($1,1)
      ON CONFLICT (year) DO UPDATE SET last_number=order_counters.last_number+1
      RETURNING last_number
    `, [year]);
    const number = `${year}-${String(counterRows[0].last_number).padStart(4, "0")}`;
    const order = {
      id: crypto.randomUUID(), number, customerId: user.id, customerName: user.name,
      customerEmail: user.email, customerProfile: user.profile || emptyProfile(), note,
      status: "nova", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items
    };
    await insertOrder(client, order);
    await client.query("COMMIT");
    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertOrder(client, order) {
  await client.query(`
    INSERT INTO orders (id,number,customer_id,customer_name,customer_email,customer_profile,note,status,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [order.id, order.number, order.customerId || null, order.customerName, order.customerEmail, order.customerProfile || emptyProfile(), order.note || "", order.status || "nova", order.createdAt, order.updatedAt]);
  for (const item of order.items || []) {
    await client.query(`
      INSERT INTO order_items (order_id,product_id,card_number,name,unit,weight,price,quantity)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [order.id, item.productId || null, item.cardNumber, item.name, item.unit || "", item.weight, item.price, item.quantity]);
  }
}

async function listOrders(user) {
  const params = [];
  let where = "";
  if (user.role !== "admin") {
    params.push(user.id);
    where = "WHERE customer_id=$1";
  }
  const { rows } = await pool.query(`SELECT * FROM orders ${where} ORDER BY created_at DESC, number DESC`, params);
  const orders = rows.map(mapOrder);
  if (!orders.length) return orders;
  const { rows: itemRows } = await pool.query("SELECT * FROM order_items WHERE order_id=ANY($1::text[]) ORDER BY id", [orders.map(order => order.id)]);
  const byId = new Map(orders.map(order => [order.id, order]));
  for (const row of itemRows) byId.get(row.order_id)?.items.push(mapOrderItem(row));
  return orders;
}

async function getOrderById(id) {
  const { rows } = await pool.query("SELECT * FROM orders WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const order = mapOrder(rows[0]);
  const { rows: itemRows } = await pool.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id", [id]);
  order.items = itemRows.map(mapOrderItem);
  return order;
}

async function updateOrder(id, data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("UPDATE orders SET status=$2,note=$3,updated_at=NOW() WHERE id=$1 RETURNING *", [id, data.status, data.note]);
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    if (Array.isArray(data.items)) {
      await client.query("DELETE FROM order_items WHERE order_id=$1", [id]);
      for (const item of data.items) {
        await client.query(`INSERT INTO order_items (order_id,product_id,card_number,name,unit,weight,price,quantity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, item.productId || null, item.cardNumber, item.name, item.unit, item.weight, item.price, item.quantity]);
      }
    }
    const order = mapOrder(rows[0]);
    const { rows: itemRows } = await client.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id", [id]);
    order.items = itemRows.map(mapOrderItem);
    await client.query("COMMIT");
    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function replaceAllData(data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE sessions,announcements,order_items,orders,products,users,settings,order_counters RESTART IDENTITY CASCADE");
    for (const [key, value] of Object.entries(data.settings || {})) await client.query("INSERT INTO settings (key,value) VALUES ($1,$2)", [key, String(value)]);
    for (const user of data.users || []) {
      const p = user.profile || emptyProfile();
      await client.query(`INSERT INTO users (id,name,email,username,password_hash,role,company_name,company_id,tax_id,vat_id,phone,ordering_person,operation_name,address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [user.id,user.name,user.email,user.username,await hashPassword(user.password),user.role,p.companyName||"",p.companyId||"",p.taxId||"",p.vatId||"",p.phone||"",p.orderingPerson||"",p.operationName||"",p.address||""]);
    }
    for (const product of data.products || []) await insertProduct(client, product);
    for (const order of data.orders || []) await insertOrder(client, order);
    const years = new Map();
    for (const order of data.orders || []) {
      const match = /^(\d{4})-(\d+)$/.exec(order.number || "");
      if (match) years.set(Number(match[1]), Math.max(years.get(Number(match[1])) || 0, Number(match[2])));
    }
    for (const [year, last] of years) await client.query("INSERT INTO order_counters (year,last_number) VALUES ($1,$2)", [year,last]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = {
  initializeDatabase, createSchema, getUserByUsername, getUserById, getUserBySession,
  createSession, deleteSession, updateProfile, listCustomers, createCustomer, updateCustomer,
  deleteCustomer, listProducts, createProduct, updateProduct, deleteProduct, importProducts,
  getSettings, updateSettings, listAnnouncements, createAnnouncement, setAnnouncementPublished,
  createOrder, listOrders, getOrderById, updateOrder, replaceAllData, close
};
