const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, saltHex, keyHex] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(String(password), Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { hashPassword, verifyPassword, hashSessionToken };
