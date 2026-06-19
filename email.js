const nodemailer = require("nodemailer");

function booleanSetting(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function smtpConfig(settings) {
  const port = Number(settings.smtpPort) || 587;
  return {
    host: String(settings.smtpHost || "").trim(),
    port,
    secure: booleanSetting(settings.smtpSecure) || port === 465,
    auth: settings.smtpUsername
      ? { user: String(settings.smtpUsername), pass: String(settings.smtpPassword || "") }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  };
}

function validateSmtpSettings(settings) {
  if (!settings.smtpHost) throw Object.assign(new Error("Zadajte adresu SMTP servera."), { statusCode: 400 });
  const port = Number(settings.smtpPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error("SMTP port nie je platny."), { statusCode: 400 });
  if (String(settings.smtpHost).toLowerCase() === "smtp.gmail.com") {
    const secure = booleanSetting(settings.smtpSecure);
    if ((port === 587 && secure) || (port === 465 && !secure)) {
      throw Object.assign(new Error("Pre Gmail pouzite port 587 so STARTTLS alebo port 465 s TLS."), { statusCode: 400 });
    }
  }
  if (!settings.smtpFromEmail) throw Object.assign(new Error("Zadajte e-mail odosielatela."), { statusCode: 400 });
  if (!settings.ownerEmail) throw Object.assign(new Error("Zadajte e-mail pre prijem objednavok."), { statusCode: 400 });
}

async function verifySmtp(settings) {
  validateSmtpSettings(settings);
  const transporter = nodemailer.createTransport(smtpConfig(settings));
  await transporter.verify();
}

function emailProvider(settings) {
  return settings.emailProvider === "brevo" ? "brevo" : "smtp";
}

function validateBrevoSettings(settings) {
  if (!settings.brevoApiKey) throw Object.assign(new Error("Zadajte Brevo API kluc."), { statusCode: 400 });
  if (!settings.smtpFromEmail) throw Object.assign(new Error("Zadajte a overte e-mail odosielatela v Brevo."), { statusCode: 400 });
  if (!settings.ownerEmail) throw Object.assign(new Error("Zadajte e-mail pre prijem objednavok."), { statusCode: 400 });
}

async function brevoRequest(path, settings, options = {}) {
  validateBrevoSettings(settings);
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      "api-key": settings.brevoApiKey,
      "content-type": "application/json",
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Brevo API vratilo chybu ${response.status}.`);
    error.code = "EBREVO";
    error.responseCode = response.status;
    throw error;
  }
  return data;
}

async function verifyBrevo(settings) {
  await brevoRequest("/account", settings, { method: "GET" });
}

async function verifyEmailSettings(settings) {
  if (emailProvider(settings) === "brevo") return verifyBrevo(settings);
  return verifySmtp(settings);
}

function smtpErrorMessage(error) {
  if (error?.statusCode === 400 && error?.message) return error.message;
  const code = String(error?.code || "").toUpperCase();
  const responseCode = Number(error?.responseCode || 0);
  const command = String(error?.command || "").toUpperCase();

  if (code === "EAUTH" || [534, 535].includes(responseCode) || command.includes("AUTH")) {
    return "Gmail odmietol prihlasenie. Pouzite 16-miestne heslo aplikacie, nie bezne heslo ku Google uctu. Skontrolujte aj celu e-mailovu adresu v poli Prihlasovacie meno.";
  }
  if (code === "EDNS") {
    return "SMTP server sa nenasiel. Skontrolujte adresu servera; pre Gmail pouzite smtp.gmail.com.";
  }
  if (["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNREFUSED", "ENETUNREACH"].includes(code)) {
    return "K SMTP serveru sa nepodarilo pripojit. Skontrolujte port a sifrovanie; hosting moze blokovat odchadzajuce SMTP spojenie.";
  }
  if (code === "ETLS" || /CERT|TLS/i.test(String(error?.message || ""))) {
    return "Nepodarilo sa vytvorit sifrovane spojenie. Pre Gmail nastavte port 587 a STARTTLS.";
  }
  return "Pripojenie k e-mailovemu serveru sa nepodarilo. Skontrolujte adresu, port, sifrovanie a prihlasovacie udaje.";
}

function emailErrorMessage(error, settings = {}) {
  if (emailProvider(settings) !== "brevo") return smtpErrorMessage(error);
  if (error?.statusCode === 400 && error?.message) return error.message;
  const status = Number(error?.responseCode || 0);
  if ([401, 403].includes(status)) return "Brevo odmietlo API kluc. Vytvorte novy kluc v Brevo a vlozte ho do nastaveni aplikacie.";
  if (status === 429) return "Brevo docasne odmietlo odoslanie alebo bol dosiahnuty denny limit.";
  if (status === 400) return "Brevo odmietlo spravu. Skontrolujte, ci je e-mail odosielatela v Brevo overeny.";
  if (["ETIMEDOUT", "ENETUNREACH", "ECONNRESET"].includes(String(error?.code || "").toUpperCase())) return "K Brevo API sa nepodarilo pripojit. Skuste overenie zopakovat.";
  return "Spojenie so sluzbou Brevo sa nepodarilo. Skontrolujte API kluc a overenie odosielatela.";
}

function money(value) {
  return `${Number(value || 0).toFixed(2)} EUR`;
}

function weight(value) {
  return `${Number(value || 0).toFixed(2)} kg`;
}

function orderTotal(order) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function orderWeight(order) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.weight, 0);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function orderText(order) {
  const lines = [
    `Objednavka ${order.number}`,
    `Zakaznik: ${order.customerName} <${order.customerEmail}>`,
    `Datum: ${new Date(order.createdAt).toLocaleString("sk-SK")}`,
    `Poznamka: ${order.note || "-"}`,
    "",
    "Polozky:"
  ];
  for (const item of order.items) lines.push(`${item.cardNumber} | ${item.name} | ${item.quantity} ${item.unit} | ${money(item.quantity * item.price)}`);
  lines.push("", `Hmotnost spolu: ${weight(orderWeight(order))}`, `Spolu: ${money(orderTotal(order))}`);
  return lines.join("\n");
}

function orderHtml(order) {
  const rows = order.items.map(item => `<tr><td>${escapeHtml(item.cardNumber)}</td><td>${escapeHtml(item.name)}</td><td>${item.quantity} ${escapeHtml(item.unit)}</td><td>${money(item.quantity * item.price)}</td></tr>`).join("");
  return `
    <h2>Objednavka ${escapeHtml(order.number)}</h2>
    <p><strong>Zakaznik:</strong> ${escapeHtml(order.customerName)} &lt;${escapeHtml(order.customerEmail)}&gt;<br>
    <strong>Datum:</strong> ${escapeHtml(new Date(order.createdAt).toLocaleString("sk-SK"))}<br>
    <strong>Poznamka:</strong> ${escapeHtml(order.note || "-")}</p>
    <table cellpadding="7" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#ddd">
      <thead><tr><th>Cislo karty</th><th>Nazov</th><th>Mnozstvo</th><th>Spolu</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><strong>Hmotnost:</strong> ${weight(orderWeight(order))}<br><strong>Spolu:</strong> ${money(orderTotal(order))}</p>
  `;
}

async function sendOrderEmails(order, settings) {
  if (!booleanSetting(settings.smtpEnabled)) return { configured: false, sent: false };
  if (emailProvider(settings) === "brevo") {
    validateBrevoSettings(settings);
    const recipients = [...new Set([order.customerEmail, settings.ownerEmail].filter(Boolean))];
    await Promise.all(recipients.map(email => brevoRequest("/smtp/email", settings, {
      method: "POST",
      body: JSON.stringify({
        sender: { name: String(settings.smtpFromName || "CORNiCO").trim(), email: settings.smtpFromEmail },
        to: [{ email }],
        replyTo: { email: email === order.customerEmail ? settings.ownerEmail : order.customerEmail },
        subject: `Objednavka ${order.number}`,
        textContent: orderText(order),
        htmlContent: orderHtml(order)
      })
    })));
    return { configured: true, sent: true };
  }
  validateSmtpSettings(settings);
  const transporter = nodemailer.createTransport(smtpConfig(settings));
  const fromName = String(settings.smtpFromName || "CORNiCO").trim();
  const from = { name: fromName, address: settings.smtpFromEmail };
  const recipients = [...new Set([order.customerEmail, settings.ownerEmail].filter(Boolean))];
  await Promise.all(recipients.map(to => transporter.sendMail({
    from,
    to,
    replyTo: to === order.customerEmail ? settings.ownerEmail : order.customerEmail,
    subject: `Objednavka ${order.number}`,
    text: orderText(order),
    html: orderHtml(order)
  })));
  return { configured: true, sent: true };
}

module.exports = { sendOrderEmails, verifySmtp, verifyBrevo, verifyEmailSettings, smtpErrorMessage, emailErrorMessage };
