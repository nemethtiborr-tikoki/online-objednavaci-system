const test = require("node:test");
const assert = require("node:assert/strict");
const { sendOrderEmails, verifySmtp, smtpErrorMessage } = require("../email");

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
