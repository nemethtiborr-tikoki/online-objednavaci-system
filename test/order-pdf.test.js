const test = require("node:test");
const assert = require("node:assert/strict");
const { generateOrderPdf, orderPdfFilename } = require("../order-pdf");

test("objednavka sa vygeneruje ako platny PDF subor", async () => {
  const order = {
    number: "2026-0042",
    customerName: "Ján Žitňanský",
    customerEmail: "zakaznik@example.com",
    customerProfile: { companyName: "Skúšobná spoločnosť", operationName: "Prevádzka Žilina" },
    createdAt: new Date().toISOString(),
    status: "nová objednávka",
    note: "Prosím dodať do skladu.",
    items: [{ cardNumber: "1001", name: "Kukuričný popcorn", unit: "ks", quantity: 3, weight: 0.5, price: 2.4 }]
  };
  const pdf = await generateOrderPdf(order);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 10_000);
  assert.equal(orderPdfFilename(order), "objednavka-2026-0042.pdf");
});
