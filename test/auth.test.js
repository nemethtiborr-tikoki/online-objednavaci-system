const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword, hashSessionToken } = require("../auth");

test("heslo sa neuklada v citatelnom tvare", async () => {
  const encoded = await hashPassword("silne-testovacie-heslo");
  assert.notEqual(encoded, "silne-testovacie-heslo");
  assert.equal(await verifyPassword("silne-testovacie-heslo", encoded), true);
  assert.equal(await verifyPassword("nespravne-heslo", encoded), false);
});

test("token relacie sa uklada iba ako odtlacok", () => {
  const token = "nahodny-token-relacie";
  const digest = hashSessionToken(token);
  assert.notEqual(digest, token);
  assert.equal(digest.length, 64);
  assert.equal(hashSessionToken(token), digest);
});
