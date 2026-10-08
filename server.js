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
const serviceTypes = new Set(["per piece", "per kg"]);
const orderStatuses = new Set(["Received", "Ready", "Delivered"]);
const purchaseStatuses = new Set(["Draft", "Ordered", "Received", "Cancelled"]);
const paymentStatuses = new Set(["Paid", "Unpaid", "Partially Paid"]);
const purchaseUnits = new Set(["kg", "litre", "piece", "packet", "box", "bottle"]);
const unitPattern = /^[\p{L}\p{N}\s.-]{1,20}$/u;
const supplierNamePattern = /^[\p{L}\p{N}\s&().'-]+$/u;
const supplierNameError = "Invalid format. Supplier name should not contain special characters except letters, numbers, spaces, &, (), ., ', and -.";
const supplierAddressPattern = /^(?=.*[\p{L}\p{N}])[\p{L}\p{N}\s.,#\/'()&-]+$/u;
const supplierSelect = "id,name,phone,address,notes,is_active,created_at,updated_at";
const indianPhonePattern = /^(?:\+91|91|0)?[6-9]\d{9}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const textIdPattern = /^[\w-]{1,100}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validName(value, min, max, pattern) {
  return typeof value === "string" && value.trim().length >= min &&
    value.trim().length <= max && pattern.test(value.trim());
}
function normalizedPhone(value) {
  const compact = text(value).replace(/[\s()-]/g, "");
  if (!indianPhonePattern.test(compact)) return null;
  if (compact.startsWith("+91")) return compact.slice(3);
  if (compact.length === 12 && compact.startsWith("91")) return compact.slice(2);
  if (compact.length === 11 && compact.startsWith("0")) return compact.slice(1);
  return compact;
}
function validId(value, pattern = textIdPattern) {
  return typeof value === "string" && pattern.test(value);
}
function validateApplicationState(incoming) {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
    return "Invalid application data";
  for (const key of ["customers", "services", "orders", "inventory"]) {
    if (!Array.isArray(incoming[key]) || incoming[key].length > 5000)
      return "Application data contains an invalid list";
  }

  const customers = new Map();
  const customerPhones = new Set();
  const customerNames = new Set();
  for (const customer of incoming.customers) {
    if (!customer || !validId(customer.id) ||
        !validName(customer.name, 2, 80, /^[\p{L}\s.'-]+$/u))
      return "Invalid Name";
    const normalizedName = text(customer.name).toLocaleLowerCase("en-IN");
    if (customerNames.has(normalizedName)) return "Customer already exists";
    const phone = normalizedPhone(customer.phone);
    if (!phone) return "Enter a valid Indian mobile number";
    if (customerPhones.has(phone)) return "A customer with this phone number already exists";
    if (customers.has(customer.id)) return "Customer IDs must be unique";
    customerNames.add(normalizedName);
    customerPhones.add(phone);
    customers.set(customer.id, { ...customer, name: text(customer.name), phone });
  }

  const services = new Map();
  const serviceNames = new Set();
  for (const service of incoming.services) {
    const name = text(service?.name);
    const price = Number(service?.price);
    const normalizedName = name.toLocaleLowerCase("en-IN");
    if (!validId(service?.id) ||
        !validName(name, 2, 60, /^[\p{L}\p{N}\s&()-]+$/u))
      return "Enter a valid service name (2–60 characters)";
    if (!Number.isFinite(price) || price <= 0 || price > 1000000 ||
        !/^\d+(?:\.\d{1,2})?$/.test(String(service.price)))
      return "Price must be greater than zero and have at most two decimal places";
    if (!serviceTypes.has(service.type)) return "Select a valid service type";
    if (services.has(service.id) || serviceNames.has(normalizedName))
      return "This service already exists";
    services.set(service.id, { ...service, name, price });
    serviceNames.add(normalizedName);
  }

  const inventoryIds = new Set();
  const inventoryNames = new Set();
  for (const item of incoming.inventory) {
    const name = text(item?.name);
    const stock = Number(item?.stock);
    const minStock = Number(item?.minStock ?? item?.min_stock);
    if (!validId(item?.id) ||
        !validName(name, 2, 80, /^[\p{L}\p{N}\s&().'-]+$/u))
      return "Enter an inventory item name between 2 and 80 characters";
    if (!Number.isFinite(stock) || stock < 0 ||
        !Number.isFinite(minStock) || minStock < 0)
      return "Stock and minimum stock must be non-negative numbers";
    if (!text(item.unit) || text(item.unit).length > 20)
      return "Enter a valid inventory unit";
    const normalizedName = name.toLocaleLowerCase("en-IN");
    if (inventoryIds.has(item.id) || inventoryNames.has(normalizedName))
      return "This inventory item already exists";
    inventoryIds.add(item.id);
    inventoryNames.add(normalizedName);
  }

  const orderIds = new Set();
  const tokenNumbers = new Set();
  const today = new Date().toISOString().slice(0, 10);
  for (const order of incoming.orders) {
    if (!order || !validId(order.id) || !Number.isSafeInteger(Number(order.tokenNo)) ||
        Number(order.tokenNo) <= 0)
      return "Order ID and token number must be valid";
    if (orderIds.has(order.id) || tokenNumbers.has(Number(order.tokenNo)))
      return "Order IDs and token numbers must be unique";
    if (order.customerId && !customers.has(order.customerId))
      return "Select an existing customer for every order";
    if (!validDate(order.date) || order.date > today)
      return "Order date cannot be in the future";
    if (!validDate(order.deliveryDate) || order.deliveryDate < order.date)
      return "Delivery date cannot be before the order date";
    if (!orderStatuses.has(order.status)) return "Select a valid order status";
    if (!Array.isArray(order.items) || order.items.length < 1 || order.items.length > 100)
      return "Please add at least one order item";

    let subtotal = 0;
    for (const line of order.items) {
      const service = services.get(line?.serviceId);
      const quantity = Number(line?.qty);
      if (!service) return "Select a valid service for each order item";
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999)
        return "Quantity must be greater than zero and no more than 999";
      subtotal += Math.round(quantity * Number(service.price) * 100) / 100;
    }
    const discount = Number(order.discount);
    const paid = Number(order.paid);
    if (!Number.isFinite(discount) || discount < 0 || discount > subtotal)
      return "Discount cannot be greater than subtotal";
    const total = Math.round((subtotal - discount) * 100) / 100;
    if (!Number.isFinite(paid) || paid < 0 || paid > total)
      return "Paid amount cannot be greater than the total amount";
    orderIds.add(order.id);
    tokenNumbers.add(Number(order.tokenNo));
  }

  incoming.customers = [...customers.values()];
  incoming.services = [...services.values()];
  incoming.orders = incoming.orders.map((order) => {
    const items = order.items.map((line) => {
      const service = services.get(line.serviceId);
      const quantity = Number(line.qty);
      const rate = Number(service.price);
      return {
        serviceId: line.serviceId,
        qty: quantity,
        rate,
        amount: Math.round(quantity * rate * 100) / 100,
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const discount = Number(order.discount);
    const total = Math.round((subtotal - discount) * 100) / 100;
    return {
      ...order,
      tokenNo: Number(order.tokenNo),
      total,
      discount,
      paid: Number(order.paid),
      items,
    };
  });
  return null;
}

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
  const username = text(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username) return res.status(400).json({ error: "Please enter your email address" });
  if (username.includes("@") && !emailPattern.test(username))
    return res.status(400).json({ error: "Please enter a valid email address" });
  if (!password.trim()) return res.status(400).json({ error: "Please enter your password" });
  const email = username.includes("@") ? username : process.env.OWNER_EMAIL;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user)
    return res.status(401).json({ error: "Invalid email or password" });
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
    apiError(res, error, "Could not load application data");
  }
});

app.put("/api/state", requireAuth, async (req, res) => {
  const incoming = req.body;
  const validationError = validateApplicationState(incoming);
  if (validationError) return res.status(400).json({ error: validationError });
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
            customer_id: row.customerId || null,
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
    apiError(res, error, "Could not save data");
  }
});

function apiError(res, error, message = "Could not complete the request") {
  const statusCode = error?.code === "23505"
    ? 409
    : error?.code === "23503"
      ? 409
      : error?.code === "23514" || error?.code === "22P02" || error?.code === "P0001"
        ? 400
      : error?.code === "PGRST116"
        ? 404
        : 500;
  console.error(message, { code: error?.code || "unexpected" });
  res.status(statusCode).json({
    error: statusCode === 500 ? "An unexpected error occurred. Please try again." : message,
  });
}
function requireUuidParam(req, res, param = "id") {
  if (!uuidPattern.test(String(req.params[param] || ""))) {
    res.status(400).json({ error: "Invalid record ID" });
    return false;
  }
  return true;
}
function validAmount(value, allowZero = true) {
  return typeof value === "number" && Number.isFinite(value) &&
    (allowZero ? value >= 0 : value > 0) && value <= 100000000;
}

async function attachPurchaseDetails(rows) {
  if (!rows.length) return [];
  const purchaseIds = rows.map((row) => row.id);
  const supplierIds = [...new Set(rows.map((row) => row.supplier_id))];
  const [itemsResult, suppliersResult] = await Promise.all([
    admin.from("purchase_items").select("*").in("purchase_id", purchaseIds),
    admin.from("suppliers").select("id,name,phone,address").in("id", supplierIds),
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
  const name = text(req.body?.name);
  const unit = text(req.body?.unit);
  const stock = req.body?.stock;
  const minStock = req.body?.min_stock;
  if (!req.body || Object.keys(req.body).some((key) =>
    !["name", "stock", "unit", "min_stock"].includes(key)))
    return res.status(400).json({ error: "Invalid inventory item details" });
  if (!validName(name, 2, 80, /^[\p{L}\p{N}\s&().'-]+$/u))
    return res.status(400).json({ error: "Enter an inventory item name between 2 and 80 characters" });
  if (!unit || unit.length > 20)
    return res.status(400).json({ error: "Enter a valid inventory unit" });
  if (!validAmount(stock) || !validAmount(minStock))
    return res.status(400).json({ error: "Stock and minimum stock must be non-negative numbers" });
  try {
    const { data: existing, error: lookupError } = await admin.from("inventory").select("name");
    if (lookupError) throw lookupError;
    if (existing.some((item) => text(item.name).toLocaleLowerCase("en-IN") === name.toLocaleLowerCase("en-IN")))
      return res.status(409).json({ error: "This inventory item already exists" });
    const { data, error } = await admin.rpc("create_inventory_item", {
      p_name: name,
      p_stock: stock,
      p_unit: unit,
      p_min_stock: minStock,
      p_created_by: req.session.user.id,
    });
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    apiError(res, error, "Could not create inventory item");
  }
});

app.delete("/api/inventory/:id", requireAuth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid inventory item ID" });
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
    const { data, error } = await admin.from("suppliers").select(supplierSelect).order("name");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    apiError(res, error, "Could not load suppliers");
  }
});

app.post("/api/suppliers", requireAuth, async (req, res) => {
  const name = text(req.body?.name);
  const phoneInput = text(req.body?.phone);
  const phone = phoneInput ? normalizedPhone(phoneInput) : null;
  const address = text(req.body?.address);
  const notes = text(req.body?.notes);
  if (!req.body || Object.keys(req.body).some((key) =>
    !["name", "phone", "address", "notes"].includes(key)))
    return res.status(400).json({ error: "Invalid supplier details" });
  if (!validName(name, 2, 100, supplierNamePattern))
    return res.status(400).json({ error: supplierNameError });
  if (phoneInput && !phone) return res.status(400).json({ error: "Enter a valid Indian mobile number" });
  if (address && !supplierAddressPattern.test(address))
    return res.status(400).json({ error: "Enter a valid address using letters, numbers, spaces, and common address punctuation." });
  if (address.length > 250) return res.status(400).json({ error: "Address must be 250 characters or fewer" });
  if (notes.length > 500) return res.status(400).json({ error: "Notes must be 500 characters or fewer" });
  try {
    const { data: existing, error: lookupError } = await admin.from("suppliers").select("name");
    if (lookupError) throw lookupError;
    if (existing.some((row) =>
      text(row.name).toLocaleLowerCase("en-IN") === name.toLocaleLowerCase("en-IN")))
      return res.status(409).json({ error: "Supplier already exists" });
    const { data, error } = await admin.from("suppliers").insert({
      name,
      phone,
      address: address || null,
      notes: notes || null,
    }).select(supplierSelect).single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    apiError(res, error, "Could not create supplier");
  }
});

app.get("/api/suppliers/:id/purchases", requireAuth, async (req, res) => {
  if (!requireUuidParam(req, res)) return;
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
  if (!requireUuidParam(req, res)) return;
  try {
    const { data, error } = await admin.from("suppliers").select(supplierSelect)
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
  if (!requireUuidParam(req, res)) return;
  if (!req.body || Object.keys(req.body).some((key) =>
    !["name", "phone", "address", "notes"].includes(key)))
    return res.status(400).json({ error: "Invalid supplier details" });
  const name = text(req.body?.name);
  const phoneInput = text(req.body?.phone);
  const phone = phoneInput ? normalizedPhone(phoneInput) : null;
  const address = text(req.body?.address);
  const notes = text(req.body?.notes);
  if (!validName(name, 2, 100, supplierNamePattern))
    return res.status(400).json({ error: supplierNameError });
  if (phoneInput && !phone) return res.status(400).json({ error: "Enter a valid Indian mobile number" });
  if (address && !supplierAddressPattern.test(address))
    return res.status(400).json({ error: "Enter a valid address using letters, numbers, spaces, and common address punctuation." });
  if (address.length > 250) return res.status(400).json({ error: "Address must be 250 characters or fewer" });
  if (notes.length > 500) return res.status(400).json({ error: "Notes must be 500 characters or fewer" });
  try {
    const { data: existing, error: lookupError } = await admin.from("suppliers").select("id,name");
    if (lookupError) throw lookupError;
    if (existing.some((row) => row.id !== req.params.id &&
      text(row.name).toLocaleLowerCase("en-IN") === name.toLocaleLowerCase("en-IN")))
      return res.status(409).json({ error: "Supplier already exists" });
    const { data, error } = await admin.from("suppliers").update({
      name,
      phone,
      address: address || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    }).eq("id", req.params.id).select(supplierSelect).single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    apiError(res, error, "Could not update supplier");
  }
});

app.delete("/api/suppliers/:id", requireAuth, async (req, res) => {
  if (!requireUuidParam(req, res)) return;
  try {
    const [{ data: supplier, error: supplierError }, { count, error: countError }] =
      await Promise.all([
        admin.from("suppliers").select("id,is_active").eq("id", req.params.id).maybeSingle(),
        admin.from("purchases").select("id", { count: "exact", head: true })
          .eq("supplier_id", req.params.id),
      ]);
    if (supplierError) throw supplierError;
    if (countError) throw countError;
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
    if (count && supplier.is_active !== false) {
      const { error } = await admin.from("suppliers").update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", req.params.id);
      if (error) throw error;
      return res.json({ deactivated: true });
    }
    if (count) {
      const { error: purchasesError } = await admin.from("purchases").delete()
        .eq("supplier_id", req.params.id);
      if (purchasesError) throw purchasesError;
    }
    const { error } = await admin.from("suppliers").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    apiError(res, error, "Could not delete supplier");
  }
});

app.get("/api/purchases", requireAuth, async (req, res) => {
  const allowedQuery = new Set(["supplier_id", "payment_status", "purchase_status", "from", "to"]);
  if (Object.keys(req.query).some((key) => !allowedQuery.has(key)))
    return res.status(400).json({ error: "Unsupported purchase filter" });
  if (req.query.supplier_id && !uuidPattern.test(String(req.query.supplier_id)))
    return res.status(400).json({ error: "Invalid supplier ID filter" });
  if (req.query.payment_status && !paymentStatuses.has(String(req.query.payment_status)))
    return res.status(400).json({ error: "Invalid payment status filter" });
  if (req.query.purchase_status && !purchaseStatuses.has(String(req.query.purchase_status)))
    return res.status(400).json({ error: "Invalid purchase status filter" });
  if ((req.query.from && !validDate(String(req.query.from))) ||
      (req.query.to && !validDate(String(req.query.to))) ||
      (req.query.from && req.query.to && String(req.query.from) > String(req.query.to)))
    return res.status(400).json({ error: "Enter a valid purchase date range" });
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
  const body = req.body;
  const { supplier_id: supplierId, purchase_date: purchaseDate, invoice_number: invoiceNumber,
    amount_paid: amountPaid, purchase_status: purchaseStatus, notes, items } = body || {};
  const today = new Date().toISOString().slice(0, 10);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !new Set(["supplier_id", "purchase_date", "invoice_number", "amount_paid", "purchase_status", "notes", "items"]).has(key)))
    return res.status(400).json({ error: "Invalid purchase details" });
  if (!uuidPattern.test(String(supplierId || "")) || !validDate(purchaseDate) || purchaseDate > today ||
      !Array.isArray(items) || !items.length || items.length > 100)
    return res.status(400).json({ error: "Select a supplier and enter at least one purchase item" });
  if (!["Draft", "Ordered"].includes(purchaseStatus || "Draft"))
    return res.status(400).json({ error: "New purchases must be Draft or Ordered; receive them after saving" });
  const paidInput = amountPaid === undefined ? 0 : amountPaid;
  if (!validAmount(paidInput))
    return res.status(400).json({ error: "Amount paid must be non-negative" });
  const paid = Math.round(paidInput * 100) / 100;
  const invoice = text(invoiceNumber);
  const purchaseNotes = text(notes);
  if (invoice.length > 100) return res.status(400).json({ error: "Invoice number must be 100 characters or fewer" });
  if (purchaseNotes.length > 1000) return res.status(400).json({ error: "Notes must be 1000 characters or fewer" });
  let calculatedTotal = 0;
  const inventoryIds = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some((key) => !new Set(["inventory_id", "item_name", "quantity", "unit", "unit_cost"]).has(key)))
      return res.status(400).json({ error: "Invalid purchase item details" });
    const quantity = item.quantity;
    const unitCost = item.unit_cost;
    const unit = text(item.unit);
    const itemName = text(item.item_name);
    if ((!item.inventory_id && !validName(itemName, 2, 80, /^[\p{L}\p{N}\s&().'-]+$/u)) ||
        (item.inventory_id && !validId(item.inventory_id)) ||
        typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 ||
        typeof unitCost !== "number" || !validAmount(unitCost) ||
        !unitPattern.test(unit) || (!item.inventory_id && !purchaseUnits.has(unit)))
      return res.status(400).json({ error: "Each item needs a name, positive quantity, unit, and non-negative cost" });
    if (item.inventory_id) inventoryIds.add(item.inventory_id);
    calculatedTotal += Math.round(quantity * unitCost * 100) / 100;
  }
  if (calculatedTotal > 100000000)
    return res.status(400).json({ error: "Purchase total exceeds the supported amount" });
  if (paid > calculatedTotal) return res.status(400).json({ error: "Amount paid cannot exceed the purchase total" });
  try {
    if (inventoryIds.size) {
      const { data: inventoryRows, error: inventoryError } = await admin.from("inventory")
        .select("id,unit").in("id", [...inventoryIds]);
      if (inventoryError) throw inventoryError;
      const unitsById = new Map(inventoryRows.map((row) => [row.id, row.unit]));
      if ([...inventoryIds].some((id) => !unitsById.has(id)))
        return res.status(400).json({ error: "One or more selected inventory items no longer exist" });
      if (items.some((item) => item.inventory_id && unitsById.get(item.inventory_id) !== text(item.unit)))
        return res.status(400).json({ error: "The purchase unit must match the selected inventory item" });
    }
    if (invoice) {
      const { data: matching, error: invoiceError } = await admin.from("purchases")
        .select("id").eq("supplier_id", supplierId).eq("invoice_number", invoice).limit(1);
      if (invoiceError) throw invoiceError;
      if (matching.length) return res.status(409).json({ error: "This invoice number already exists for the supplier" });
    }
    const { data, error } = await admin.rpc("create_purchase", {
      p_supplier_id: supplierId,
      p_purchase_date: purchaseDate,
      p_invoice_number: invoice || null,
      p_amount_paid: paid,
      p_purchase_status: purchaseStatus || "Draft",
      p_notes: purchaseNotes || null,
      p_created_by: req.session.user.id,
      p_items: items.map((item) => ({
        inventory_id: item.inventory_id || null,
        item_name: text(item.item_name) || null,
        quantity: Math.round(item.quantity * 1000) / 1000,
        unit: text(item.unit),
        unit_cost: Math.round(item.unit_cost * 100) / 100,
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
  if (!requireUuidParam(req, res)) return;
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
  if (!uuidPattern.test(String(id || ""))) return res.status(400).json({ error: "Invalid purchase ID" });
  if (req.body && Object.keys(req.body).some((key) =>
    !new Set(["id", "amount_paid", "purchase_status", "invoice_number", "purchase_date", "notes"]).has(key)))
    return res.status(400).json({ error: "Invalid purchase update" });
  try {
    const { data: existing, error: readError } = await admin.from("purchases").select("*").eq("id", id).single();
    if (readError) throw readError;
    if (existing.purchase_status === "Received" || existing.purchase_status === "Cancelled")
      return res.status(409).json({ error: "Received or cancelled purchases cannot be edited" });
    const amount = amountPaid === undefined ? Number(existing.amount_paid) : amountPaid;
    if (!validAmount(amount))
      return res.status(400).json({ error: "Amount paid must be between zero and the purchase total" });
    const paid = Math.round(amount * 100) / 100;
    if (paid > Number(existing.total_amount))
      return res.status(400).json({ error: "Amount paid must be between zero and the purchase total" });
    if (purchaseStatus !== undefined && !["Draft", "Ordered"].includes(purchaseStatus))
      return res.status(400).json({ error: "Use the receive endpoint to receive a purchase" });
    const today = new Date().toISOString().slice(0, 10);
    if (purchaseDate !== undefined && (!validDate(purchaseDate) || purchaseDate > today))
      return res.status(400).json({ error: "Purchase date cannot be in the future" });
    const invoice = invoiceNumber === undefined ? existing.invoice_number : text(invoiceNumber);
    if (invoice && invoice.length > 100)
      return res.status(400).json({ error: "Invoice number must be 100 characters or fewer" });
    if (invoice && invoice !== existing.invoice_number) {
      const { data: matching, error: invoiceError } = await admin.from("purchases")
        .select("id").eq("supplier_id", existing.supplier_id).eq("invoice_number", invoice).neq("id", id).limit(1);
      if (invoiceError) throw invoiceError;
      if (matching.length) return res.status(409).json({ error: "This invoice number already exists for the supplier" });
    }
    const nextNotes = notes === undefined ? existing.notes : text(notes);
    if (nextNotes && nextNotes.length > 1000)
      return res.status(400).json({ error: "Notes must be 1000 characters or fewer" });
    const balance = Number(existing.total_amount) - paid;
    const { data, error } = await admin.from("purchases").update({
      amount_paid: paid,
      balance_amount: balance,
      payment_status: balance === 0 ? "Paid" : paid === 0 ? "Unpaid" : "Partially Paid",
      purchase_status: purchaseStatus || existing.purchase_status,
      invoice_number: invoice || null,
      purchase_date: purchaseDate || existing.purchase_date,
      notes: nextNotes || null,
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
  if (!requireUuidParam(req, res)) return;
  if (!req.body || Object.keys(req.body).some((key) => key !== "amount_paid"))
    return res.status(400).json({ error: "Invalid payment details" });
  const amount = req.body.amount_paid;
  if (!validAmount(amount))
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
  if (!requireUuidParam(req, res)) return;
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
  if (!requireUuidParam(req, res)) return;
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
  if (Object.keys(req.query).some((key) => !["inventory_id", "purchase_id"].includes(key)))
    return res.status(400).json({ error: "Unsupported stock transaction filter" });
  if (req.query.inventory_id && !validId(String(req.query.inventory_id)))
    return res.status(400).json({ error: "Invalid inventory item filter" });
  if (req.query.purchase_id && !uuidPattern.test(String(req.query.purchase_id)))
    return res.status(400).json({ error: "Invalid purchase filter" });
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
  const quantityChange = typeof change === "number" ? Math.round(change * 1000) / 1000 : NaN;
  if (!req.body || Object.keys(req.body).some((key) => !["inventory_id", "transaction_type", "quantity_change", "notes"].includes(key)) ||
      !validId(inventoryId) || !["STOCK_IN", "STOCK_OUT", "DAMAGE", "EXPIRED"].includes(type) ||
      !Number.isFinite(quantityChange) || quantityChange === 0 || Math.abs(quantityChange) > 1000000)
    return res.status(400).json({ error: "Select an inventory item, valid transaction type, and non-zero quantity" });
  if (notes !== undefined && (typeof notes !== "string" || notes.trim().length > 500))
    return res.status(400).json({ error: "Notes must be 500 characters or fewer" });
  if ((["STOCK_IN"].includes(type) && quantityChange < 0) ||
      (["STOCK_OUT", "DAMAGE", "EXPIRED"].includes(type) && quantityChange > 0))
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
