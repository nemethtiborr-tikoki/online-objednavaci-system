const test = require("node:test");
const assert = require("node:assert/strict");
const { sendOrderEmails, verifySmtp, verifyBrevo, smtpErrorMessage, emailErrorMessage } = require("../email");

test("vypnute SMTP neodosiela objednavku", async () => {
  const result = await sendOrderEmails({ items: [] }, { smtpEnabled: "false" });
  assert.deepEqual(result, { configured: false, sent: false });
});

test("overenie odmietne neuplne SMTP nastavenie", async () => {
  await assert.rejects(
    verifySmtp({ smtpHost: "", smtpPort: 587 }),
    /adresu SMTP servera/
  );
});

test("Gmail chyba prihlasenia ma zrozumitelnu spravu", () => {
  const message = smtpErrorMessage({ code: "EAUTH", responseCode: 535 });
  assert.match(message, /heslo aplikacie/);
});

test("timeout SMTP upozorni na spojenie alebo hosting", () => {
  const message = smtpErrorMessage({ code: "ETIMEDOUT" });
  assert.match(message, /hosting/);
});

test("Gmail odmietne nespravnu kombinaciu TLS a portu", async () => {
  await assert.rejects(
    verifySmtp({
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpSecure: true,
      smtpFromEmail: "sender@example.com",
      ownerEmail: "orders@example.com"
    }),
    /STARTTLS/
  );
});

test("Brevo overenie pouzije HTTPS API a API kluc", async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ email: "sender@example.com" }) };
  };
  try {
    await verifyBrevo({
      emailProvider: "brevo",
      brevoApiKey: "test-key",
      smtpFromEmail: "sender@example.com",
      ownerEmail: "orders@example.com"
    });
    assert.equal(request.url, "https://api.brevo.com/v3/account");
    assert.equal(request.options.headers["api-key"], "test-key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Brevo chyba kluca ma zrozumitelnu spravu", () => {
  const message = emailErrorMessage({ code: "EBREVO", responseCode: 401 }, { emailProvider: "brevo" });
  assert.match(message, /API kluc/);
});

test("Brevo odosle zakaznicku a firemnu spravu oddelene", async () => {
  const originalFetch = global.fetch;
  const recipients = [];
  global.fetch = async (_url, options) => {
    recipients.push(JSON.parse(options.body).to[0].email);
    return { ok: true, json: async () => ({ messageId: "test" }) };
  };
  try {
    const result = await sendOrderEmails({
      number: "2026-0001",
      customerName: "Zakaznik",
      customerEmail: "customer@example.com",
      createdAt: new Date().toISOString(),
      note: "",
      items: []
    }, {
      emailProvider: "brevo",
      smtpEnabled: true,
      brevoApiKey: "test-key",
      smtpFromEmail: "sender@example.com",
      ownerEmail: "orders@example.com"
    });
    assert.deepEqual(recipients.sort(), ["customer@example.com", "orders@example.com"]);
    assert.equal(result.sent, true);
  } finally {
    global.fetch = originalFetch;
  }
});
