const bcrypt = require("bcryptjs");
let sql, createSession, readSession, setSession, clearSession, loadError;
try {
  ({ sql } = require("../lib/db"));
  ({ createSession, readSession, setSession, clearSession } = require("../lib/auth"));
} catch (e) { loadError = e; }

function send(res, status, data) {
  res.status(status).json(data);
}
function body(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}
function cleanPlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}
async function requireUser(req, res) {
  const session = await readSession(req);
  if (!session || !session.uid || !session.office) {
    send(res, 401, { error: "Faça login para continuar." });
    return null;
  }
  // Confere o estado atual da conta no banco em cada requisição:
  // um funcionário desativado perde o acesso mesmo com sessão antiga.
  const rows = await sql`SELECT id, office_id, role, active FROM users
    WHERE id=${session.uid} AND office_id=${session.office} LIMIT 1`;
  if (!rows[0] || !rows[0].active) {
    send(res, 401, { error: "Conta desativada ou sessão inválida. Entre novamente." });
    return null;
  }
  return { ...session, role: rows[0].role };
}
async function adminOnly(user, res) {
  if (user.role !== "admin") {
    send(res, 403, { error: "Apenas o administrador da oficina pode realizar esta ação." });
    return false;
  }
  return true;
}
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET,POST,PUT,DELETE,OPTIONS");
    return res.status(204).end();
  }

  if (loadError) return res.status(500).json({ error: "Configuração do servidor: " + loadError.message });
  const path = (req.url || "").split("?")[0].replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const route = path.join("/");
  const b = body(req);

  try {
    // Primeira conta cria uma oficina e seu administrador.
    if (route === "auth/register" && req.method === "POST") {
      const officeName = String(b.officeName || "").trim();
      const name = String(b.name || "").trim();
      const email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (!officeName || !name || !validEmail(email) || password.length < 8) {
        return send(res, 400, { error: "Informe oficina, nome, e-mail válido e senha com pelo menos 8 caracteres." });
      }
      const exists = await sql`SELECT id FROM users WHERE LOWER(email) = ${email} LIMIT 1`;
      if (exists.length) return send(res, 409, { error: "Este e-mail já está cadastrado." });
      const hash = await bcrypt.hash(password, 12);
      const rows = await sql`
        WITH new_office AS (
          INSERT INTO offices (name) VALUES (${officeName}) RETURNING id
        )
        INSERT INTO users (office_id, name, email, password_hash, role)
        SELECT id, ${name}, ${email}, ${hash}, 'admin' FROM new_office
        RETURNING id, office_id, name, email, role
      `;
      const user = rows[0];
      const token = await createSession(user);
      setSession(res, token);
      return send(res, 201, { user });
    }

    if (route === "auth/login" && req.method === "POST") {
      const email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      const rows = await sql`
        SELECT id, office_id, name, email, role, password_hash, active
        FROM users WHERE LOWER(email) = ${email} LIMIT 1
      `;
      const u = rows[0];
      if (!u || !u.active || !(await bcrypt.compare(password, u.password_hash))) {
        return send(res, 401, { error: "E-mail ou senha incorretos." });
      }
      const user = { id: u.id, office_id: u.office_id, name: u.name, email: u.email, role: u.role };
      const token = await createSession(user);
      setSession(res, token);
      return send(res, 200, { user });
    }

    if (route === "auth/logout" && req.method === "POST") {
      clearSession(res);
      return send(res, 200, { ok: true });
    }

    const user = await requireUser(req, res);
    if (!user) return;

    if (route === "me" && req.method === "GET") {
      const rows = await sql`
        SELECT u.id, u.name, u.email, u.role, o.id AS office_id, o.name AS office_name,
               o.phone, o.address, o.document, o.business_hours, o.receipt_message
        FROM users u JOIN offices o ON o.id = u.office_id
        WHERE u.id = ${user.uid} AND u.office_id = ${user.office} AND u.active = TRUE
      `;
      if (!rows[0]) return send(res, 401, { error: "Sessão inválida." });
      return send(res, 200, { user: rows[0] });
    }

    if (route === "office" && req.method === "PUT") {
      if (!(await adminOnly(user, res))) return;
      const name = String(b.name || "").trim();
      if (!name) return send(res, 400, { error: "Informe o nome da oficina." });
      const rows = await sql`
        UPDATE offices SET name=${name}, phone=${String(b.phone||"")}, address=${String(b.address||"")},
          document=${String(b.document||"")}, business_hours=${String(b.business_hours||"")},
          receipt_message=${String(b.receipt_message||"")}
        WHERE id=${user.office}
        RETURNING id, name, phone, address, document, business_hours, receipt_message
      `;
      return send(res, 200, { office: rows[0] });
    }

    if (route === "users" && req.method === "GET") {
      if (!(await adminOnly(user, res))) return;
      const rows = await sql`SELECT id, name, email, role, active, created_at FROM users WHERE office_id=${user.office} ORDER BY created_at`;
      return send(res, 200, { users: rows });
    }
    if (route === "users" && req.method === "POST") {
      if (!(await adminOnly(user, res))) return;
      const name = String(b.name || "").trim();
      const email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (!name || !validEmail(email) || password.length < 8) return send(res, 400, { error: "Informe nome, e-mail válido e senha com pelo menos 8 caracteres." });
      const hash = await bcrypt.hash(password, 12);
      try {
        const rows = await sql`INSERT INTO users (office_id,name,email,password_hash,role) VALUES (${user.office},${name},${email},${hash},'employee') RETURNING id,name,email,role,active`;
        return send(res, 201, { user: rows[0] });
      } catch (e) {
        if (e.code === "23505") return send(res, 409, { error: "Este e-mail já está cadastrado." });
        throw e;
      }
    }
    if (route.startsWith("users/") && req.method === "PUT") {
      if (!(await adminOnly(user, res))) return;
      const id = path[1];
      if (id === user.uid) return send(res, 400, { error: "Não é possível desativar a própria conta por aqui." });
      const active = Boolean(b.active);
      const rows = await sql`UPDATE users SET active=${active} WHERE id=${id} AND office_id=${user.office} RETURNING id,name,email,role,active`;
      if (!rows[0]) return send(res, 404, { error: "Usuário não encontrado." });
      return send(res, 200, { user: rows[0] });
    }

    if (route === "customers" && req.method === "GET") {
      const q = String(req.query?.q || "").trim();
      const rows = q
        ? await sql`SELECT c.*, COUNT(DISTINCT v.id)::int AS vehicle_count FROM customers c LEFT JOIN vehicles v ON v.customer_id=c.id AND v.office_id=c.office_id WHERE c.office_id=${user.office} AND (c.name ILIKE ${"%" + q + "%"} OR c.phone ILIKE ${"%" + q + "%"}) GROUP BY c.id ORDER BY c.name`
        : await sql`SELECT c.*, COUNT(DISTINCT v.id)::int AS vehicle_count FROM customers c LEFT JOIN vehicles v ON v.customer_id=c.id AND v.office_id=c.office_id WHERE c.office_id=${user.office} GROUP BY c.id ORDER BY c.name`;
      return send(res, 200, { customers: rows });
    }
    if (route === "customers" && req.method === "POST") {
      const name = String(b.name || "").trim();
      if (!name) return send(res, 400, { error: "Informe o nome do cliente." });
      const rows = await sql`INSERT INTO customers (office_id,name,phone,document,address) VALUES (${user.office},${name},${String(b.phone||"")},${String(b.document||"")},${String(b.address||"")}) RETURNING *`;
      return send(res, 201, { customer: rows[0] });
    }
    if (route.startsWith("customers/") && req.method === "PUT") {
      const id = path[1];
      if (!String(b.name||"").trim()) return send(res, 400, { error: "Informe o nome do cliente." });
      const rows = await sql`UPDATE customers SET name=${String(b.name||"").trim()}, phone=${String(b.phone||"")}, document=${String(b.document||"")}, address=${String(b.address||"")}, updated_at=NOW() WHERE id=${id} AND office_id=${user.office} RETURNING *`;
      if (!rows[0]) return send(res, 404, { error: "Cliente não encontrado." });
      return send(res, 200, { customer: rows[0] });
    }

    if (route === "vehicles" && req.method === "GET") {
      const plate = cleanPlate(req.query?.plate || "");
      if (plate) {
        const rows = await sql`SELECT v.*, c.name AS customer_name, c.phone AS customer_phone FROM vehicles v JOIN customers c ON c.id=v.customer_id AND c.office_id=v.office_id WHERE v.office_id=${user.office} AND v.plate=${plate} LIMIT 1`;
        return send(res, 200, { vehicle: rows[0] || null });
      }
      const rows = await sql`SELECT v.*, c.name AS customer_name FROM vehicles v JOIN customers c ON c.id=v.customer_id AND c.office_id=v.office_id WHERE v.office_id=${user.office} ORDER BY v.plate`;
      return send(res, 200, { vehicles: rows });
    }

    if (route === "orders" && req.method === "GET") {
      const q = String(req.query?.q || "").trim();
      const status = String(req.query?.status || "");
      const rows = await sql`
        SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, v.plate, v.model AS vehicle_model,
          COALESCE((SELECT SUM(oi.quantity*oi.unit_price) FROM order_items oi WHERE oi.order_id=o.id),0)-o.discount AS total
        FROM orders o JOIN customers c ON c.id=o.customer_id AND c.office_id=o.office_id
        JOIN vehicles v ON v.id=o.vehicle_id AND v.office_id=o.office_id
        WHERE o.office_id=${user.office}
          AND (${status}='' OR o.status=${status})
          AND (${q}='' OR c.name ILIKE ${"%"+q+"%"} OR v.plate ILIKE ${"%"+cleanPlate(q)+"%"} OR v.model ILIKE ${"%"+q+"%"} OR CAST(o.order_number AS TEXT) ILIKE ${"%"+q+"%"})
        ORDER BY o.entry_date DESC, o.order_number DESC LIMIT 300
      `;
      return send(res, 200, { orders: rows });
    }

    if ((route === "orders" && req.method === "POST") || (path[0] === "orders" && path.length === 2 && req.method === "PUT")) {
      const id = req.method === "PUT" ? path[1] : null;
      const customerName = String(b.customer_name || "").trim();
      const plate = cleanPlate(b.plate);
      const model = String(b.vehicle_model || "").trim();
      if (!customerName || !plate) return send(res, 400, { error: "Informe cliente e placa." });

      let customer;
      if (b.customer_id) {
        const found = await sql`SELECT * FROM customers WHERE id=${b.customer_id} AND office_id=${user.office} LIMIT 1`;
        customer = found[0];
      }
      if (!customer) {
        const found = await sql`SELECT * FROM customers WHERE office_id=${user.office} AND LOWER(name)=LOWER(${customerName}) ORDER BY created_at LIMIT 1`;
        customer = found[0];
      }
      if (!customer) {
        const made = await sql`INSERT INTO customers (office_id,name,phone) VALUES (${user.office},${customerName},${String(b.customer_phone||"")}) RETURNING *`;
        customer = made[0];
      } else {
        const changed = await sql`UPDATE customers SET phone=CASE WHEN ${String(b.customer_phone||"")}='' THEN phone ELSE ${String(b.customer_phone||"")} END, updated_at=NOW() WHERE id=${customer.id} AND office_id=${user.office} RETURNING *`;
        customer = changed[0];
      }

      let vehicle;
      const foundV = await sql`SELECT * FROM vehicles WHERE office_id=${user.office} AND plate=${plate} LIMIT 1`;
      vehicle = foundV[0];
      if (vehicle && vehicle.customer_id !== customer.id) {
        return send(res, 409, { error: "Esta placa já está vinculada a outro cliente desta oficina." });
      }
      if (!vehicle) {
        const madeV = await sql`INSERT INTO vehicles (office_id,customer_id,plate,model,color,year) VALUES (${user.office},${customer.id},${plate},${model},${String(b.color||"")},${String(b.year||"")}) RETURNING *`;
        vehicle = madeV[0];
      } else {
        const changedV = await sql`UPDATE vehicles SET model=${model || vehicle.model}, color=${String(b.color||vehicle.color||"")}, year=${String(b.year||vehicle.year||"")} WHERE id=${vehicle.id} AND office_id=${user.office} RETURNING *`;
        vehicle = changedV[0];
      }

      let order;
      if (id) {
        const existing = await sql`SELECT id FROM orders WHERE id=${id} AND office_id=${user.office} LIMIT 1`;
        if (!existing[0]) return send(res, 404, { error: "Ordem de serviço não encontrada." });
        const updated = await sql`
          UPDATE orders SET customer_id=${customer.id}, vehicle_id=${vehicle.id}, status=${b.status||"aberta"},
          entry_date=${b.entry_date||new Date().toISOString().slice(0,10)}, mileage=${b.mileage===""||b.mileage==null?null:Number(b.mileage)},
          complaint=${String(b.complaint||"")}, payment_method=${String(b.payment_method||"")}, warranty=${String(b.warranty||"")},
          return_date=${b.return_date||null}, discount=${money(b.discount)}, updated_at=NOW()
          WHERE id=${id} AND office_id=${user.office} RETURNING *
        `;
        order = updated[0];
        await sql`DELETE FROM order_items WHERE order_id=${id} AND office_id=${user.office}`;
      } else {
        const seq = await sql`UPDATE offices SET next_order_number=next_order_number+1 WHERE id=${user.office} RETURNING next_order_number-1 AS number`;
        const created = await sql`
          INSERT INTO orders (office_id,order_number,customer_id,vehicle_id,status,entry_date,mileage,complaint,payment_method,warranty,return_date,discount,created_by)
          VALUES (${user.office},${seq[0].number},${customer.id},${vehicle.id},${b.status||"aberta"},${b.entry_date||new Date().toISOString().slice(0,10)},
          ${b.mileage===""||b.mileage==null?null:Number(b.mileage)},${String(b.complaint||"")},${String(b.payment_method||"")},
          ${String(b.warranty||"")},${b.return_date||null},${money(b.discount)},${user.uid}) RETURNING *
        `;
        order = created[0];
      }
      const items = Array.isArray(b.items) ? b.items : [];
      for (const item of items) {
        const description = String(item.description || "").trim();
        if (!description) continue;
        await sql`INSERT INTO order_items (office_id,order_id,kind,description,quantity,unit_price)
          VALUES (${user.office},${order.id},${item.kind==="peca"?"peca":"servico"},${description},${Math.max(0.01,Number(item.quantity)||1)},${money(item.unit_price)})`;
      }
      return send(res, id ? 200 : 201, { order });
    }

    if (route.startsWith("orders/") && path.length === 2 && req.method === "GET") {
      const id = path[1];
      const rows = await sql`
        SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.document AS customer_document,
          c.address AS customer_address, v.plate, v.model AS vehicle_model, v.color,
          of.name AS office_name, of.phone AS office_phone, of.address AS office_address,
          of.document AS office_document, of.business_hours, of.receipt_message
        FROM orders o JOIN customers c ON c.id=o.customer_id AND c.office_id=o.office_id
        JOIN vehicles v ON v.id=o.vehicle_id AND v.office_id=o.office_id
        JOIN offices of ON of.id=o.office_id
        WHERE o.id=${id} AND o.office_id=${user.office} LIMIT 1
      `;
      if (!rows[0]) return send(res, 404, { error: "Ordem não encontrada." });
      const items = await sql`SELECT * FROM order_items WHERE order_id=${id} AND office_id=${user.office} ORDER BY ctid`;
      return send(res, 200, { order: rows[0], items });
    }

    if (route === "history" && req.method === "GET") {
      const plate = cleanPlate(req.query?.plate || "");
      const customerId = String(req.query?.customer_id || "");
      if (!plate && !customerId) return send(res, 400, { error: "Informe uma placa ou cliente." });
      const rows = plate
        ? await sql`
          SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, v.plate, v.model AS vehicle_model,
            COALESCE((SELECT SUM(i.quantity*i.unit_price) FROM order_items i WHERE i.order_id=o.id),0)-o.discount AS total
          FROM orders o JOIN customers c ON c.id=o.customer_id AND c.office_id=o.office_id
          JOIN vehicles v ON v.id=o.vehicle_id AND v.office_id=o.office_id
          WHERE o.office_id=${user.office} AND v.plate=${plate}
          ORDER BY o.entry_date DESC, o.order_number DESC
        `
        : await sql`
          SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, v.plate, v.model AS vehicle_model,
            COALESCE((SELECT SUM(i.quantity*i.unit_price) FROM order_items i WHERE i.order_id=o.id),0)-o.discount AS total
          FROM orders o JOIN customers c ON c.id=o.customer_id AND c.office_id=o.office_id
          JOIN vehicles v ON v.id=o.vehicle_id AND v.office_id=o.office_id
          WHERE o.office_id=${user.office} AND c.id=${customerId}
          ORDER BY o.entry_date DESC, o.order_number DESC
        `;
      const ids = rows.map(r => r.id);
      let itemRows = [];
      if (ids.length) itemRows = await sql`SELECT order_id,kind,description,quantity,unit_price FROM order_items WHERE office_id=${user.office} AND order_id = ANY(${ids}::uuid[]) ORDER BY ctid`;
      const grouped = {};
      itemRows.forEach(i => (grouped[i.order_id] ||= []).push(i));
      rows.forEach(r => r.items = grouped[r.id] || []);
      return send(res, 200, { history: rows });
    }

    return send(res, 404, { error: "Rota não encontrada." });
  } catch (error) {
    console.error("Chagas Car API:", error);
    if (error.code === "23505") return send(res, 409, { error: "Já existe um registro com esses dados." });
    return send(res, 500, { error: "Erro interno: " + (error.message || error) });
  }
};
