const path = require("path");
const PDFDocument = require("pdfkit");

const ROOT = __dirname;
const LOGO_PATH = path.join(ROOT, "public", "assets", "cornico-logo.png");
const FONT_REGULAR = path.join(ROOT, "assets", "fonts", "NotoSans-Regular.ttf");
const FONT_BOLD = path.join(ROOT, "assets", "fonts", "NotoSans-Bold.ttf");
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
    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 32, bufferPages: true, info: { Title: `Objednávka ${order.number}`, Author: "CORNiCO" } });
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
      doc.image(LOGO_PATH, left, 25, { fit: [125, 42], align: "left", valign: "center" });
      doc.font("Noto-Bold").fontSize(17).fillColor(COLORS.text).text(`Objednávka ${order.number}`, right - 300, 31, { width: 300, align: "right" });
      doc.font("Noto").fontSize(8).fillColor(COLORS.muted).text("Objednávkový systém CORNiCO", right - 300, 56, { width: 300, align: "right" });
      doc.moveTo(left, 80).lineTo(right, 80).lineWidth(1.5).strokeColor(COLORS.accent).stroke();
      doc.y = 94;
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
    doc.roundedRect(left, panelY, contentWidth, 108, 5).fill(COLORS.soft);
    const blockY = panelY + 12;
    const halfWidth = (contentWidth - 42) / 2;
    doc.font("Noto-Bold").fontSize(8).fillColor(COLORS.accent).text("ZÁKAZNÍK", left + 14, blockY, { width: halfWidth });
    doc.font("Noto").fontSize(8).fillColor(COLORS.text).text(customerLines.join("\n"), left + 14, blockY + 16, { width: halfWidth, lineGap: 2 });
    doc.font("Noto-Bold").fontSize(8).fillColor(COLORS.accent).text("OBJEDNÁVKA", left + halfWidth + 28, blockY, { width: halfWidth });
    doc.font("Noto").fontSize(8).fillColor(COLORS.text).text(contactLines.join("\n"), left + halfWidth + 28, blockY + 16, { width: halfWidth, lineGap: 2 });
    doc.y = panelY + 122;

    const columns = [
      { key: "cardNumber", label: "Karta", width: 55, align: "left" },
      { key: "name", label: "Názov", width: 142, align: "left" },
      { key: "quantity", label: "Množstvo", width: 54, align: "right" },
      { key: "unitWeight", label: "Hmot./ks", width: 67, align: "right" },
      { key: "totalWeight", label: "Hmot. spolu", width: 76, align: "right" },
      { key: "unitPrice", label: "Cena/ks", width: 67, align: "right" },
      { key: "totalPrice", label: "Cena spolu", width: 70, align: "right" }
    ];
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

    const drawTableHeader = y => {
      doc.rect(left, y, tableWidth, 27).fill(COLORS.accent);
      let x = left;
      doc.font("Noto-Bold").fontSize(7).fillColor(COLORS.white);
      for (const column of columns) {
        doc.text(column.label, x + 4, y + 9, { width: column.width - 8, align: column.align, lineBreak: false });
        x += column.width;
      }
      return y + 27;
    };

    let y = drawTableHeader(doc.y);
    order.items.forEach((item, index) => {
      doc.font("Noto").fontSize(7.2);
      const nameHeight = doc.heightOfString(item.name, { width: columns[1].width - 8 });
      const rowHeight = Math.max(25, nameHeight + 10);
      if (y + rowHeight > doc.page.height - 58) {
        doc.addPage({ size: "A4", layout: "portrait", margin: 32 });
        drawHeader();
        y = drawTableHeader(doc.y);
      }
      if (index % 2 === 1) doc.rect(left, y, tableWidth, rowHeight).fill(COLORS.soft);
      const values = {
        cardNumber: item.cardNumber,
        name: item.name,
        quantity: `${item.quantity} ${item.unit}`,
        unitWeight: weight(item.weight),
        totalWeight: weight(item.quantity * item.weight),
        unitPrice: money(item.price),
        totalPrice: money(item.quantity * item.price)
      };
      let x = left;
      doc.font("Noto").fontSize(7.2).fillColor(COLORS.text);
      for (const column of columns) {
        doc.text(values[column.key], x + 4, y + 7, { width: column.width - 8, align: column.align });
        x += column.width;
      }
      doc.moveTo(left, y + rowHeight).lineTo(left + tableWidth, y + rowHeight).lineWidth(0.5).strokeColor(COLORS.line).stroke();
      y += rowHeight;
    });

    if (y + 82 > doc.page.height - 52) {
      doc.addPage({ size: "A4", layout: "portrait", margin: 32 });
      drawHeader();
      y = doc.y;
    }
    y += 14;
    const summaryWidth = 220;
    doc.font("Noto-Bold").fontSize(10).fillColor(COLORS.text).text("Súhrn", right - summaryWidth, y, { width: summaryWidth });
    doc.font("Noto").fontSize(9).text(`Hmotnosť spolu: ${weight(orderWeight(order))}`, right - summaryWidth, y + 21, { width: summaryWidth, align: "right" });
    doc.font("Noto-Bold").fontSize(12).fillColor(COLORS.accent).text(`Cena spolu: ${money(orderTotal(order))}`, right - summaryWidth, y + 41, { width: summaryWidth, align: "right" });
    doc.font("Noto-Bold").fontSize(8).fillColor(COLORS.text).text("Poznámka", left, y, { width: contentWidth - summaryWidth - 24 });
    doc.font("Noto").fontSize(8).fillColor(COLORS.muted).text(order.note || "Bez poznámky", left, y + 19, { width: contentWidth - summaryWidth - 24, height: 48 });

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
