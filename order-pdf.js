const path = require("path");
const PDFDocument = require("pdfkit");

const ROOT = __dirname;
const LOGO_PATH = path.join(ROOT, "public", "assets", "cornico-logo.png");
const FONT_REGULAR = path.join(ROOT, "node_modules", "@fontsource", "noto-sans", "files", "noto-sans-latin-ext-400-normal.woff");
const FONT_BOLD = path.join(ROOT, "node_modules", "@fontsource", "noto-sans", "files", "noto-sans-latin-ext-700-normal.woff");
const COLORS = { text: "#202238", muted: "#6c6e7d", line: "#dfe1e8", accent: "#37308a", soft: "#f4f4fa", white: "#ffffff" };

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

function orderPdfFilename(order) {
  const safeNumber = String(order.number || "objednavka").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `objednavka-${safeNumber}.pdf`;
}

function generateOrderPdf(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 42, bufferPages: true, info: { Title: `Objednávka ${order.number}`, Author: "CORNiCO" } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.registerFont("Noto", FONT_REGULAR);
    doc.registerFont("Noto-Bold", FONT_BOLD);
    doc.font("Noto").fillColor(COLORS.text);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentWidth = right - left;

    const drawHeader = () => {
      doc.image(LOGO_PATH, left, 28, { fit: [150, 50], align: "left", valign: "center" });
      doc.font("Noto-Bold").fontSize(20).fillColor(COLORS.text).text(`Objednávka ${order.number}`, right - 310, 34, { width: 310, align: "right" });
      doc.font("Noto").fontSize(9).fillColor(COLORS.muted).text("Objednávkový systém CORNiCO", right - 310, 62, { width: 310, align: "right" });
      doc.moveTo(left, 88).lineTo(right, 88).lineWidth(1.5).strokeColor(COLORS.accent).stroke();
      doc.y = 104;
    };

    drawHeader();

    const profile = order.customerProfile || {};
    const customerLines = [
      profile.companyName || order.customerName,
      profile.operationName ? `Prevádzka: ${profile.operationName}` : "",
      profile.address || "",
      profile.companyId ? `IČO: ${profile.companyId}` : "",
      profile.taxId ? `DIČ: ${profile.taxId}` : "",
      profile.vatId ? `IČ DPH: ${profile.vatId}` : ""
    ].filter(Boolean);
    const contactLines = [
      `Objednávajúci: ${profile.orderingPerson || order.customerName}`,
      profile.phone ? `Telefón: ${profile.phone}` : "",
      `E-mail: ${order.customerEmail}`,
      `Dátum: ${new Date(order.createdAt).toLocaleString("sk-SK", { timeZone: "Europe/Bratislava" })}`,
      `Stav: ${order.status || "nová objednávka"}`
    ].filter(Boolean);

    const panelY = doc.y;
    doc.roundedRect(left, panelY, contentWidth, 92, 5).fill(COLORS.soft);
    const blockY = panelY + 12;
    doc.font("Noto-Bold").fontSize(9).fillColor(COLORS.accent).text("ZÁKAZNÍK", left + 14, blockY, { width: 335 });
    doc.font("Noto").fontSize(9).fillColor(COLORS.text).text(customerLines.join("\n"), left + 14, blockY + 17, { width: 335, lineGap: 2 });
    doc.font("Noto-Bold").fontSize(9).fillColor(COLORS.accent).text("OBJEDNÁVKA", left + 390, blockY, { width: 325 });
    doc.font("Noto").fontSize(9).fillColor(COLORS.text).text(contactLines.join("\n"), left + 390, blockY + 17, { width: 325, lineGap: 2 });
    doc.y = panelY + 108;

    const columns = [
      { key: "cardNumber", label: "Číslo karty", width: 72, align: "left" },
      { key: "name", label: "Názov", width: 205, align: "left" },
      { key: "unit", label: "MJ", width: 42, align: "left" },
      { key: "quantity", label: "Množstvo", width: 58, align: "right" },
      { key: "unitWeight", label: "Hmot./ks", width: 82, align: "right" },
      { key: "totalWeight", label: "Hmot. spolu", width: 88, align: "right" },
      { key: "unitPrice", label: "Cena/ks", width: 87, align: "right" },
      { key: "totalPrice", label: "Cena spolu", width: 100, align: "right" }
    ];
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

    const drawTableHeader = y => {
      doc.rect(left, y, tableWidth, 26).fill(COLORS.accent);
      let x = left;
      doc.font("Noto-Bold").fontSize(8).fillColor(COLORS.white);
      for (const column of columns) {
        doc.text(column.label, x + 6, y + 8, { width: column.width - 12, align: column.align, lineBreak: false });
        x += column.width;
      }
      return y + 26;
    };

    let y = drawTableHeader(doc.y);
    order.items.forEach((item, index) => {
      doc.font("Noto").fontSize(8);
      const nameHeight = doc.heightOfString(item.name, { width: columns[1].width - 12 });
      const rowHeight = Math.max(27, nameHeight + 12);
      if (y + rowHeight > doc.page.height - 58) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 42 });
        drawHeader();
        y = drawTableHeader(doc.y);
      }
      if (index % 2 === 1) doc.rect(left, y, tableWidth, rowHeight).fill(COLORS.soft);
      const values = {
        cardNumber: item.cardNumber,
        name: item.name,
        unit: item.unit,
        quantity: String(item.quantity),
        unitWeight: weight(item.weight),
        totalWeight: weight(item.quantity * item.weight),
        unitPrice: money(item.price),
        totalPrice: money(item.quantity * item.price)
      };
      let x = left;
      doc.font("Noto").fontSize(8).fillColor(COLORS.text);
      for (const column of columns) {
        doc.text(values[column.key], x + 6, y + 8, { width: column.width - 12, align: column.align });
        x += column.width;
      }
      doc.moveTo(left, y + rowHeight).lineTo(left + tableWidth, y + rowHeight).lineWidth(0.5).strokeColor(COLORS.line).stroke();
      y += rowHeight;
    });

    if (y + 82 > doc.page.height - 52) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 42 });
      drawHeader();
      y = doc.y;
    }
    y += 14;
    doc.font("Noto-Bold").fontSize(11).fillColor(COLORS.text).text("Súhrn", left + 470, y, { width: 264 });
    doc.font("Noto").fontSize(10).text(`Hmotnosť spolu: ${weight(orderWeight(order))}`, left + 470, y + 22, { width: 264, align: "right" });
    doc.font("Noto-Bold").fontSize(13).fillColor(COLORS.accent).text(`Cena spolu: ${money(orderTotal(order))}`, left + 470, y + 43, { width: 264, align: "right" });
    doc.font("Noto-Bold").fontSize(9).fillColor(COLORS.text).text("Poznámka", left, y, { width: 430 });
    doc.font("Noto").fontSize(9).fillColor(COLORS.muted).text(order.note || "Bez poznámky", left, y + 20, { width: 430, height: 48 });

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Noto").fontSize(8).fillColor(COLORS.muted).text(`CORNiCO | Strana ${index + 1} z ${range.count}`, left, doc.page.height - 27, { width: contentWidth, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}

module.exports = { generateOrderPdf, orderPdfFilename };
