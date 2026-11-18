const { neon } = require("@neondatabase/serverless");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada. Configure a variável no painel da Vercel.");
}

const sql = neon(process.env.DATABASE_URL);
module.exports = { sql };
