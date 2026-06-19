const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

if (!process.argv.includes("--confirm")) {
  console.error("Migracia nahradi obsah cielovej PostgreSQL databazy.");
  console.error("Po kontrole DATABASE_URL spustite: npm run migrate:neon -- --confirm");
  process.exit(1);
}

const sqlitePath = path.resolve(process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "app.sqlite"));
if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite databaza neexistuje: ${sqlitePath}`);
  process.exit(1);
}

function emptyProfile() {
  return { companyName: "", companyId: "", taxId: "", vatId: "", phone: "", orderingPerson: "", operationName: "", address: "" };
}

function readSqlite() {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const settings = Object.fromEntries(sqlite.prepare("SELECT key,value FROM settings").all().map(row => [row.key, row.value]));
    const users = sqlite.prepare("SELECT * FROM users ORDER BY role,name").all().map(row => ({
      id: row.id, name: row.name, email: row.email, username: row.username, password: row.password, role: row.role,
      profile: { companyName: row.company_name || "", companyId: row.company_id || "", taxId: row.tax_id || "", vatId: row.vat_id || "", phone: row.phone || "", orderingPerson: row.ordering_person || "", operationName: row.operation_name || "", address: row.address || "" }
    }));
    const products = sqlite.prepare("SELECT * FROM products ORDER BY card_number").all().map(row => ({
      id: row.id, cardNumber: row.card_number, name: row.name, unit: row.unit || "", weight: Number(row.weight), price: Number(row.price), active: Boolean(row.active)
    }));
    const orders = sqlite.prepare("SELECT * FROM orders ORDER BY created_at").all().map(row => ({
      id: row.id, number: row.number, customerId: row.customer_id, customerName: row.customer_name,
      customerEmail: row.customer_email, customerProfile: row.customer_profile ? JSON.parse(row.customer_profile) : emptyProfile(),
      note: row.note || "", status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, items: []
    }));
    const byId = new Map(orders.map(order => [order.id, order]));
    for (const row of sqlite.prepare("SELECT * FROM order_items ORDER BY id").all()) {
      byId.get(row.order_id)?.items.push({ productId: row.product_id, cardNumber: row.card_number, name: row.name, unit: row.unit || "", weight: Number(row.weight), price: Number(row.price), quantity: Number(row.quantity) });
    }
    return { settings, users, products, orders };
  } finally {
    sqlite.close();
  }
}

async function migrate() {
  const database = require("../database");
  try {
    const data = readSqlite();
    await database.createSchema();
    await database.replaceAllData(data);
    console.log(`Migracia dokoncena: ${data.users.length} pouzivatelov, ${data.products.length} produktov, ${data.orders.length} objednavok.`);
  } finally {
    await database.close();
  }
}

migrate().catch(error => {
  console.error("Migracia zlyhala:", error.message);
  process.exitCode = 1;
});
