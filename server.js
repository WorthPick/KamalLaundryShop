const path = require("node:path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.SUPABASE_ANON_KEY ||
  !process.env.OWNER_EMAIL
)
  throw new Error(
    "Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and OWNER_EMAIL in .env",
  );
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);
app.use(express.static(__dirname));

function requireAuth(req, res, next) {
  if (!req.session.user)
    return res.status(401).json({ error: "Authentication required" });
  next();
}
async function state() {
  const [customers, services, inventory, orders, items] = await Promise.all([
    admin.from("customers").select("id,name,phone").order("name"),
    admin.from("services").select("id,name,price,type").order("name"),
    admin
      .from("inventory")
      .select("id,name,stock,unit,min_stock")
      .order("name"),
    admin
      .from("orders")
      .select(
        "id,token_no,customer_id,date,delivery_date,status,total,discount,paid",
      )
      .order("date", { ascending: false })
      .order("token_no", { ascending: false }),
    admin.from("order_items").select("order_id,service_id,qty,rate,amount"),
  ]);
  const error = [customers, services, inventory, orders, items].find(
    (result) => result.error,
  )?.error;
  if (error) throw error;
  return {
    customers: customers.data,
    services: services.data,
    inventory: inventory.data.map((row) => ({
      ...row,
      minStock: row.min_stock,
    })),
    orders: orders.data.map((order) => ({
      ...order,
      tokenNo: order.token_no,
      customerId: order.customer_id,
      deliveryDate: order.delivery_date,
      items: items.data
        .filter((item) => item.order_id === order.id)
        .map((item) => ({
          serviceId: item.service_id,
          qty: item.qty,
          rate: item.rate,
          amount: item.amount,
        })),
    })),
  };
}

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const email = username.includes("@") ? username : process.env.OWNER_EMAIL;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: String(password || ""),
  });
  if (error || !data.user)
    return res.status(401).json({ error: "Incorrect username or password" });
  req.session.user = { id: data.user.id, username: data.user.email };
  res.json({ username: data.user.email });
});
app.post("/api/logout", (req, res) =>
  req.session.destroy(() => res.status(204).end()),
);
app.get("/api/session", (req, res) =>
  res.json({
    authenticated: Boolean(req.session.user),
    username: req.session.user?.username || null,
  }),
);
app.get("/api/state", requireAuth, async (req, res) => {
  try {
    res.json(await state());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/state", requireAuth, async (req, res) => {
  const incoming = req.body || {};
  if (
    !Array.isArray(incoming.customers) ||
    !Array.isArray(incoming.services) ||
    !Array.isArray(incoming.orders) ||
    !Array.isArray(incoming.inventory)
  )
    return res.status(400).json({ error: "Invalid application data" });
  try {
    const tables = ["orders", "customers", "services", "inventory"];
    const { error: itemDeleteError } = await admin
      .from("order_items")
      .delete()
      .gte("id", 0);
    if (itemDeleteError) throw itemDeleteError;
    for (const table of tables) {
      const { error } = await admin.from(table).delete().neq("id", "");
      if (error) throw error;
    }
    if (incoming.customers.length) {
      const { error } = await admin
        .from("customers")
        .insert(incoming.customers);
      if (error) throw error;
    }
    if (incoming.services.length) {
      const { error } = await admin.from("services").insert(incoming.services);
      if (error) throw error;
    }
    if (incoming.inventory.length) {
      const { error } = await admin
        .from("inventory")
        .insert(
          incoming.inventory.map((row) => ({
            id: row.id,
            name: row.name,
            stock: row.stock,
            unit: row.unit,
            min_stock: row.minStock,
          })),
        );
      if (error) throw error;
    }
    if (incoming.orders.length) {
      const { error } = await admin
        .from("orders")
        .insert(
          incoming.orders.map((row) => ({
            id: row.id,
            token_no: row.tokenNo,
            customer_id: row.customerId,
            date: row.date,
            delivery_date: row.deliveryDate,
            status: row.status,
            total: row.total,
            discount: row.discount,
            paid: row.paid,
          })),
        );
      if (error) throw error;
    }
    const lines = incoming.orders.flatMap((row) =>
      (row.items || []).map((line) => ({
        order_id: row.id,
        service_id: line.serviceId,
        qty: line.qty,
        rate: line.rate,
        amount: line.amount,
      })),
    );
    if (lines.length) {
      const { error } = await admin.from("order_items").insert(lines);
      if (error) throw error;
    }
    res.json(await state());
  } catch (error) {
    res
      .status(400)
      .json({ error: "Could not save data", detail: error.message });
  }
});

app.use((req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(port, () =>
  console.log(`Kamal Power Laundry running at http://localhost:${port}`),
);
