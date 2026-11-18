// jose v6 é ESM-only. Em CommonJS, carregue-o com import() dinâmico.
const jose = import("jose");

const COOKIE = "chagas_session";
const encoder = new TextEncoder();

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET precisa ter pelo menos 32 caracteres.");
  }
  return encoder.encode(value);
}

function cookieOptions(maxAge) {
  return [
    `${COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${maxAge}`
  ].join("; ");
}

async function createSession(user) {
  const { SignJWT } = await jose;
  const token = await new SignJWT({
    uid: user.id,
    office: user.office_id,
    role: user.role,
    name: user.name,
    email: user.email
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  return token;
}

async function readSession(req) {
  const raw = req.headers.cookie || "";
  const pair = raw.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  if (!pair) return null;
  const token = pair.slice(COOKIE.length + 1);
  try {
    const { jwtVerify } = await jose;
    const { payload } = await jwtVerify(token, secret());
    return payload;
  } catch {
    return null;
  }
}

function setSession(res, token) {
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800`);
}
function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`);
}
module.exports = { createSession, readSession, setSession, clearSession };
