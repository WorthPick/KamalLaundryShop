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

async function requireAuth(req, res, next) {
  if (!req.session.user)
    return res.status(401).json({ error: "Authentication required" });
  if (req.session.appUserReady) return next();
  try {
    const { error } = await admin.from("users").upsert(
      {
        id: req.session.user.id,
        username: req.session.user.username || req.session.user.id,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw error;
    req.session.appUserReady = true;
    next();
  } catch (error) {
    console.error("Could not prepare authenticated user profile", error);
    res.status(500).json({
      error: "Could not prepare authenticated user profile",
      detail: error.message,
    });
  }
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
    const tables = ["orders", "customers", "services"];
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

function apiError(res, error, message = "Could not complete the request") {
  console.error(message, error);
  res.status(400).json({ error: message, detail: error.message });
}

async function attachPurchaseDetails(rows) {
  if (!rows.length) return [];
  const purchaseIds = rows.map((row) => row.id);
  const supplierIds = [...new Set(rows.map((row) => row.supplier_id))];
  const [itemsResult, suppliersResult] = await Promise.all([
    admin.from("purchase_items").select("*").in("purchase_id", purchaseIds),
    admin.from("suppliers").select("id,name,contact_person,phone,email,address").in("id", supplierIds),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (suppliersResult.error) throw suppliersResult.error;
  const inventoryIds = [...new Set(itemsResult.data.map((item) => item.inventory_id).filter(Boolean))];
  const inventoryResult = inventoryIds.length
    ? await admin.from("inventory").select("id,name").in("id", inventoryIds)
    : { data: [], error: null };
  if (inventoryResult.error) throw inventoryResult.error;
  const supplierById = new Map(suppliersResult.data.map((row) => [row.id, row]));
  const inventoryById = new Map(inventoryResult.data.map((row) => [row.id, row]));
  return rows.map((row) => ({
    ...row,
    supplier: supplierById.get(row.supplier_id) || null,
    items: itemsResult.data
      .filter((item) => item.purchase_id === row.id)
      .map((item) => ({ ...item, inventory: inventoryById.get(item.inventory_id) || null })),
  }));
}

app.get("/api/inventory", requireAuth, async (req, res) => {
  try {
    const { data, error } = await admin
      .from("inventory")
      .select("id,name,stock,unit,min_stock")
      .order("name");
    if (error) throw error;
    res.json(data.map((row) => ({ ...row, minStock: row.min_stock })));
  } catch (error) {
    apiError(res, error, "Could not load inventory");
  }
});

app.post("/api/inventory", requireAuth, async (req, res) => {
  const { name, stock, unit, min_stock: minStock } = req.body || {};
  if (!String(name || "").trim() || !String(unit || "").trim() ||
      !Number.isFinite(Number(stock)) || Number(stock) < 0 ||
      !Number.isFinite(Number(minStock)) || Number(minStock) < 0)
    return res.status(400).json({ error: "Enter a name, unit, and non-negative stock values" });
  try {
    const { data, error } = await admin.rpc("create_inventory_item", {
      p_name: String(name).trim(),
      p_stock: Number(stock),
      p_unit: String(unit).trim(),
      p_min_stock: Number(minStock),
      p_created_by: req.session.user.id,
    });
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    apiError(res, error, "Could not create inventory item");
  }
});

app.delete("/api/inventory/:id", requireAuth, async (req, res) => {
  try {
    const [purchaseItem, transactions, item] = await Promise.all([
      admin.from("purchase_items").select("id").eq("inventory_id", req.params.id).limit(1),
      admin.from("stock_transactions").select("id").eq("inventory_id", req.params.id).limit(1),
      admin.from("inventory").select("id,stock").eq("id", req.params.id).single(),
    ]);
    if (purchaseItem.error) throw purchaseItem.error;
    if (transactions.error) throw transactions.error;
    if (item.error) throw item.error;
    if (purchaseItem.data.length || transactions.data.length || Number(item.data.stock) !== 0)
      return res.status(409).json({ error: "Inventory with stock or history cannot be removed" });
    const { error } = await admin.from("inventory").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    apiError(res, error, "Could not remove inventory item");
  }
});

app.get("/api/suppliers", requireAuth, async (req, res) => {
  try {
    const { data, error } = await admin.from("suppliers").select("*").order("name");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    apiError(res, error, "Could not load suppliers");
  }
});

app.post("/api/suppliers", requireAuth, async (req, res) => {
  const { name, phone, address, notes } = req.body || {};
  if (!String(name || "").trim())
    return res.status(400).json({ error: "Supplier name is required" });
  try {
    const { data, error } = await admin.from("suppliers").insert({
      name: String(name).trim(),
      phone: String(phone || "").trim() || null,
      address: String(address || "").trim() || null,
      notes: String(notes || "").trim() || null,
    }).select("*").single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    apiError(res, error, "Could not create supplier");
  }
});

app.get("/api/suppliers/:id/purchases", requireAuth, async (req, res) => {
  try {
    const { data, error } = await admin.from("purchases").select("*")
      .eq("supplier_id", req.params.id).order("purchase_date", { ascending: false });
    if (error) throw error;
    res.json(await attachPurchaseDetails(data));
  } catch (error) {
    apiError(res, error, "Could not load supplier purchases");
  }
});

app.get("/api/suppliers/:id", requireAuth, async (req, res) => {
  try {
    const { data, error } = await admin.from("suppliers").select("*")
      .eq("id", req.params.id).single();
    if (error) throw error;
    const { data: history, error: historyError } = await admin.from("purchases").select("*")
      .eq("supplier_id", req.params.id).order("purchase_date", { ascending: false });
    if (historyError) throw historyError;
    res.json({ ...data, purchases: await attachPurchaseDetails(history) });
  } catch (error) {
    apiError(res, error, "Could not load supplier");
  }
});

app.put("/api/suppliers/:id", requireAuth, async (req, res) => {
  const { name, phone, address, notes } = req.body || {};
  if (!String(name || "").trim())
    return res.status(400).json({ error: "Supplier name is required" });
  try {
    const { data, error } = await admin.from("suppliers").update({
      name: String(name).trim(),
      phone: String(phone || "").trim() || null,
      address: String(address || "").trim() || null,
      notes: String(notes || "").trim() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    apiError(res, error, "Could not update supplier");
  }
});

app.delete("/api/suppliers/:id", requireAuth, async (req, res) => {
  try {
    const { count, error: countError } = await admin.from("purchases").select("id", { count: "exact", head: true })
      .eq("supplier_id", req.params.id);
    if (countError) throw countError;
    if (count) {
      const { error } = await admin.from("suppliers").update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", req.params.id);
      if (error) throw error;
      return res.json({ deactivated: true });
    }
    const { error } = await admin.from("suppliers").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    apiError(res, error, "Could not delete supplier");
  }
});

app.get("/api/purchases", requireAuth, async (req, res) => {
  try {
    let query = admin.from("purchases").select("*").order("purchase_date", { ascending: false }).order("created_at", { ascending: false });
    if (req.query.supplier_id) query = query.eq("supplier_id", req.query.supplier_id);
    if (req.query.payment_status) query = query.eq("payment_status", req.query.payment_status);
    if (req.query.purchase_status) query = query.eq("purchase_status", req.query.purchase_status);
    if (req.query.from) query = query.gte("purchase_date", req.query.from);
    if (req.query.to) query = query.lte("purchase_date", req.query.to);
    const { data, error } = await query;
    if (error) throw error;
    res.json(await attachPurchaseDetails(data));
  } catch (error) {
    apiError(res, error, "Could not load purchases");
  }
});

app.post("/api/purchases", requireAuth, async (req, res) => {
  const { supplier_id: supplierId, purchase_date: purchaseDate, invoice_number: invoiceNumber,
    amount_paid: amountPaid, purchase_status: purchaseStatus, notes, items } = req.body || {};
  if (!supplierId || !purchaseDate || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: "Select a supplier and enter at least one purchase item" });
  if (!["Draft", "Ordered"].includes(purchaseStatus || "Draft"))
    return res.status(400).json({ error: "New purchases must be Draft or Ordered; receive them after saving" });
  const paid = Math.round(Number(amountPaid) * 100) / 100;
  if (!Number.isFinite(paid) || paid < 0)
    return res.status(400).json({ error: "Amount paid must be non-negative" });
  for (const item of items) {
    const quantity = Math.round(Number(item.quantity) * 1000) / 1000;
    const unitCost = Math.round(Number(item.unit_cost) * 100) / 100;
    if ((!item.inventory_id && !String(item.item_name || "").trim()) ||
        !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(unitCost) || unitCost < 0 ||
        !String(item.unit || "").trim())
      return res.status(400).json({ error: "Each item needs a name, positive quantity, unit, and non-negative cost" });
  }
  try {
    const { data, error } = await admin.rpc("create_purchase", {
      p_supplier_id: supplierId,
      p_purchase_date: purchaseDate,
      p_invoice_number: String(invoiceNumber || "").trim() || null,
      p_amount_paid: paid,
      p_purchase_status: purchaseStatus || "Draft",
      p_notes: String(notes || "").trim() || null,
      p_created_by: req.session.user.id,
      p_items: items.map((item) => ({
        inventory_id: item.inventory_id || null,
        item_name: String(item.item_name || "").trim() || null,
        quantity: Math.round(Number(item.quantity) * 1000) / 1000,
        unit: String(item.unit).trim(),
        unit_cost: Math.round(Number(item.unit_cost) * 100) / 100,
      })),
    });
    if (error) throw error;
    const { data: purchase, error: purchaseError } = await admin.from("purchases").select("*").eq("id", data).single();
    if (purchaseError) throw purchaseError;
    res.status(201).json({ ...purchase, items: [] });
  } catch (error) {
    apiError(res, error, "Could not save purchase");
  }
});

app.get("/api/purchases/:id", requireAuth, async (req, res) => {
  try {
    const { data, error } = await admin.from("purchases").select("*").eq("id", req.params.id).single();
    if (error) throw error;
    res.json((await attachPurchaseDetails([data]))[0]);
  } catch (error) {
    apiError(res, error, "Could not load purchase");
  }
});

async function updatePurchase(req, res) {
  const { amount_paid: amountPaid, purchase_status: purchaseStatus, invoice_number: invoiceNumber,
    purchase_date: purchaseDate, notes } = req.body || {};
  const id = req.params.id || req.body?.id;
  try {
    const { data: existing, error: readError } = await admin.from("purchases").select("*").eq("id", id).single();
    if (readError) throw readError;
    if (existing.purchase_status === "Received" || existing.purchase_status === "Cancelled")
      return res.status(409).json({ error: "Received or cancelled purchases cannot be edited" });
    const amount = amountPaid === undefined ? Number(existing.amount_paid) : Number(amountPaid);
    if (!Number.isFinite(amount) || amount < 0)
      return res.status(400).json({ error: "Amount paid must be between zero and the purchase total" });
    const paid = Math.round(amount * 100) / 100;
    if (paid > Number(existing.total_amount))
      return res.status(400).json({ error: "Amount paid must be between zero and the purchase total" });
    if (purchaseStatus && !["Draft", "Ordered"].includes(purchaseStatus))
      return res.status(400).json({ error: "Use the receive endpoint to receive a purchase" });
    const balance = Number(existing.total_amount) - paid;
    const { data, error } = await admin.from("purchases").update({
      amount_paid: paid,
      balance_amount: balance,
      payment_status: balance === 0 ? "Paid" : paid === 0 ? "Unpaid" : "Partially Paid",
      purchase_status: purchaseStatus || existing.purchase_status,
      invoice_number: invoiceNumber === undefined ? existing.invoice_number : String(invoiceNumber).trim() || null,
      purchase_date: purchaseDate || existing.purchase_date,
      notes: notes === undefined ? existing.notes : String(notes).trim() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", id).select("*").single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    apiError(res, error, "Could not update purchase");
  }
}

app.put("/api/purchases", requireAuth, (req, res) => {
  if (!req.body?.id) return res.status(400).json({ error: "Purchase id is required" });
  return updatePurchase(req, res);
});
app.put("/api/purchases/:id", requireAuth, updatePurchase);

app.patch("/api/purchases/:id/payment", requireAuth, async (req, res) => {
  const amount = Number(req.body?.amount_paid);
  if (!Number.isFinite(amount) || amount < 0)
    return res.status(400).json({ error: "Amount paid must be a non-negative number" });
  try {
    const { data: existing, error: readError } = await admin
      .from("purchases")
      .select("id,total_amount,purchase_status")
      .eq("id", req.params.id)
      .single();
    if (readError) throw readError;
    if (existing.purchase_status === "Cancelled")
      return res.status(409).json({ error: "Cancelled purchases cannot have payment changes" });
    const paid = Math.round(amount * 100) / 100;
    const total = Number(existing.total_amount);
    if (paid > total)
      return res.status(400).json({ error: "Amount paid cannot exceed the purchase total" });
    const balance = Math.round((total - paid) * 100) / 100;
    const paymentStatus = balance <= 0 ? "Paid" : paid <= 0 ? "Unpaid" : "Partially Paid";
    const { data, error } = await admin
      .from("purchases")
      .update({
        amount_paid: paid,
        balance_amount: balance,
        payment_status: paymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    apiError(res, error, "Could not update supplier payment");
  }
});

app.delete("/api/purchases/:id", requireAuth, async (req, res) => {
  try {
    const { data, error } = await admin.from("purchases").update({
      purchase_status: "Cancelled",
      updated_at: new Date().toISOString(),
    }).eq("id", req.params.id).in("purchase_status", ["Draft", "Ordered"]).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "Only Draft or Ordered purchases can be cancelled" });
    res.status(204).end();
  } catch (error) {
    apiError(res, error, "Could not cancel purchase");
  }
});

app.post("/api/purchases/:id/receive", requireAuth, async (req, res) => {
  try {
    const { data, error } = await admin.rpc("receive_purchase", {
      p_purchase_id: req.params.id,
      p_created_by: req.session.user.id,
    });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    apiError(res, error, "Could not receive purchase");
  }
});

app.get("/api/stock-transactions", requireAuth, async (req, res) => {
  try {
    let query = admin.from("stock_transactions").select("*").order("transaction_date", { ascending: false });
    if (req.query.inventory_id) query = query.eq("inventory_id", req.query.inventory_id);
    if (req.query.purchase_id) query = query.eq("purchase_id", req.query.purchase_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    apiError(res, error, "Could not load stock transactions");
  }
});

app.post("/api/stock-transactions", requireAuth, async (req, res) => {
  const { inventory_id: inventoryId, transaction_type: type, quantity_change: change, notes } = req.body || {};
  const quantityChange = Math.round(Number(change) * 1000) / 1000;
  if (!inventoryId || !["STOCK_IN", "STOCK_OUT", "DAMAGE", "EXPIRED", "ADJUSTMENT"].includes(type) ||
      !Number.isFinite(quantityChange) || quantityChange === 0)
    return res.status(400).json({ error: "Select an inventory item, valid transaction type, and non-zero quantity" });
  if (type !== "ADJUSTMENT" && ((["STOCK_IN"].includes(type) && quantityChange < 0) ||
      (["STOCK_OUT", "DAMAGE", "EXPIRED"].includes(type) && quantityChange > 0)))
    return res.status(400).json({ error: "Quantity sign does not match the stock transaction type" });
  try {
    const { data, error } = await admin.rpc("record_stock_transaction", {
      p_inventory_id: inventoryId,
      p_transaction_type: type,
      p_quantity_change: quantityChange,
      p_notes: String(notes || "").trim() || null,
      p_created_by: req.session.user.id,
    });
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    apiError(res, error, "Could not record stock transaction");
  }
});

app.use((req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(port, () =>
  console.log(`Kamal Power Laundry running at http://localhost:${port}`),
);
