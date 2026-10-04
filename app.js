const today = () => new Date();
const money = (value) => `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
const dateLabel = (value) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
const dateKey = (value) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const addDays = (value, days) => {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
};
const currentDateKey = () => dateKey(today());
const uid = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const seedData = {
  customers: [],
  services: [
    { id: "s1", name: "Shirt / blouse", price: 80, type: "per piece" },
    { id: "s2", name: "Trouser / jeans", price: 100, type: "per piece" },
    { id: "s3", name: "Bedsheet", price: 250, type: "per piece" },
    { id: "s4", name: "Wash & fold", price: 120, type: "per kg" },
    { id: "s5", name: "Dry clean · suit", price: 450, type: "per piece" },
  ],
  orders: [],
  inventory: [],
};
let data = seedData;
let currentView = "dashboard";
let orderFilter = "All";
let billItems = [];
async function loadServerData() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Could not load shop data");
  data = await response.json();
  if (billItems.length && data.services.length && !data.services.some((service) => service.id === billItems[0]?.serviceId)) {
    billItems = [{ serviceId: data.services[0].id, qty: 1 }];
  }
}
async function save() {
  try {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Save failed");
    data = await response.json();
  } catch (error) {
    showToast("Could not save to the shop database");
  }
}
const customerName = (id) =>
  data.customers.find((c) => c.id === id)?.name || "Walk-in customer";
const serviceName = (id) =>
  data.services.find((s) => s.id === id)?.name || "Service";
const serviceById = (id) => data.services.find((s) => s.id === id);
const statusClass = (status) => status.toLowerCase();
const todayOrders = () => data.orders.filter((o) => o.date === currentDateKey());
const nextToken = () =>
  Math.max(0, ...data.orders.map((o) => Number(o.tokenNo))) + 1;
function showToast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function updateHeaderClock() {
  const now = today();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  document.getElementById("pageKicker").textContent = now
    .toLocaleDateString("en-IN", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    })
    .toUpperCase();
  if (currentView === "dashboard")
    document.getElementById("pageTitle").textContent = `${greeting}, Kamal`;
}
function setView(view) {
  currentView = view;
  document
    .querySelectorAll(".nav-item")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const titles = {
    dashboard: "",
    billing: "Create a new order",
    orders: "Orders queue",
    customers: "Customers",
    services: "Services & prices",
    inventory: "Inventory",
  };
  document.getElementById("pageTitle").textContent = titles[view];
  if (view === "dashboard") updateHeaderClock();
  render();
}
function render() {
  const content = document.getElementById("content");
  if (currentView === "dashboard") content.innerHTML = dashboardView();
  if (currentView === "billing") content.innerHTML = billingView();
  if (currentView === "orders") content.innerHTML = ordersView();
  if (currentView === "customers") content.innerHTML = customersView();
  if (currentView === "services") content.innerHTML = servicesView();
  if (currentView === "inventory") content.innerHTML = inventoryView();
  bindViewEvents();
}
function dashboardView() {
  const orders = todayOrders();
  const income = orders.reduce((sum, o) => sum + o.paid, 0);
  const due = data.orders.reduce((sum, o) => sum + (o.total - o.paid), 0);
  const ready = data.orders.filter((o) => o.status === "Ready").length;
  const now = today();
  const yesterdayKey = dateKey(addDays(now, -1));
  const yesterdayOrders = data.orders.filter((o) => o.date === yesterdayKey).length;
  const orderDelta = orders.length - yesterdayOrders;
  const orderDeltaLabel =
    !yesterdayOrders && orders.length
      ? "New today"
      : !yesterdayOrders && !orders.length
        ? "No orders yet"
        : orderDelta === 0
          ? "Same as yesterday"
          : `${orderDelta > 0 ? "+" : ""}${orderDelta} from yesterday`;
  const chartDates = Array.from({ length: 7 }, (_, index) =>
    addDays(now, index - 6),
  );
  const chartLabels = chartDates.map((date) =>
    date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  );
  const values = chartDates.map((date) => {
    const key = dateKey(date);
    return data.orders
      .filter((o) => o.date === key)
      .reduce((sum, order) => sum + Number(order.paid || 0), 0);
  });
  const max = Math.max(...values, 1);
  return `<div class="section-head"><div><span class="eyebrow">SHOP PULSE</span><h2>Today at a glance</h2></div><span class="muted">${dateLabel(now)}</span></div><div class="stats-grid"><div class="stat-card"><span class="stat-label">Today’s orders</span><strong>${orders.length}</strong><span class="stat-note">${orderDeltaLabel}</span></div><div class="stat-card"><span class="stat-label">Today’s income</span><strong>${money(income)}</strong><span class="stat-note">Cash collected</span></div><div class="stat-card"><span class="stat-label">Pending payments</span><strong>${money(due)}</strong><span class="stat-note">Across all orders</span></div><div class="stat-card"><span class="stat-label">Ready for pickup</span><strong>${ready}</strong><span class="stat-note">${ready ? "Send a reminder" : "All clear"}</span></div></div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h3>Sales rhythm</h3><p>Collected income · last 7 days</p></div><span class="eyebrow">NPR</span></div><div class="chart">${values
    .map((v, i) => `<div class="chart-col"><div class="bar-wrap"><div class="bar ${i === values.length - 1 ? "today" : ""}" style="height:${Math.max(7, (v / max) * 100)}%" title="${money(v)}"></div></div><small>${chartLabels[i]}</small></div>`)
    .join("")}</div></section><section class="panel"><div class="panel-head"><div><h3>Pickup board</h3><p>Orders that need attention</p></div><button class="small-action" data-view="orders">View all →</button></div><div class="mini-list">${
    data.orders
      .filter((o) => o.status !== "Delivered")
      .slice(0, 5)
      .map(
        (o) =>
          `<div class="mini-row"><div><span class="order-dot ${o.status === "Ready" ? "ready" : ""}"></span><div><strong>#${o.tokenNo} · ${customerName(o.customerId)}</strong><span class="subtext">${o.status} · ${dateLabel(o.deliveryDate)}</span></div></div><span class="amount">${money(o.total - o.paid)}</span></div>`,
      )
      .join("") || '<p class="muted">No open orders.</p>'
  }</div></section></div><section class="panel table-panel" style="margin-top:18px"><div class="table-toolbar"><div><h3 style="margin:0;font-size:15px">Latest orders</h3><p class="muted" style="margin:5px 0 0;font-size:11px">A quick look at the front counter</p></div><button class="button secondary" data-view="billing">＋ New order</button></div>${ordersTable(data.orders.slice(0, 4))}</section>`;
}
function ordersTable(orders) {
  return `<table><thead><tr><th>Token</th><th>Customer</th><th>Delivery</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>${orders.map((o) => `<tr><td><strong>#${o.tokenNo}</strong><span class="subtext">${dateLabel(o.date)}</span></td><td>${customerName(o.customerId)}</td><td>${dateLabel(o.deliveryDate)}</td><td><span class="status ${statusClass(o.status)}">${o.status}</span></td><td class="amount">${money(o.total)}<span class="subtext">${o.total - o.paid ? money(o.total - o.paid) + " due" : "Paid"}</span></td><td><div class="row-actions"><button class="small-action" data-print="${o.id}">Print</button><button class="small-action" data-status="${o.id}">Next</button><button class="small-action" data-pay="${o.id}">${o.total - o.paid ? "Clear due" : "Paid"}</button></div></td></tr>`).join("") || '<tr><td colspan="6" class="empty-state">No orders found.</td></tr>'}</tbody></table>`;
}
function billingView() {
  const subTotal = billItems.reduce((sum, item) => {
    const s = serviceById(item.serviceId);
    return sum + (s ? s.price * Number(item.qty || 0) : 0);
  }, 0);
  return `<div class="section-head"><div><span class="eyebrow">FRONT COUNTER</span><h2>New order <span class="eyebrow" style="vertical-align:middle">TOKEN #${nextToken()}</span></h2></div><span class="muted">Delivery dates are auto-filled</span></div><div class="form-layout"><section class="form-panel"><div class="form-grid"><div class="form-field field-full"><label>Customer</label><div class="add-customer-line"><select id="billCustomer"><option value="">Select customer</option>${data.customers.map((c) => `<option value="${c.id}">${c.name} · ${c.phone}</option>`).join("")}</select><button class="button secondary" id="quickCustomer">＋ Add</button></div></div><div class="form-field"><label>Order date</label><input value="${dateLabel(today())}" disabled></div><div class="form-field"><label>Delivery date</label><input id="deliveryDate" type="date" value="${dateKey(addDays(today(), 2))}"></div></div><div style="border-top:1px solid var(--line);padding-top:22px;margin-top:6px"><div class="section-head" style="margin-bottom:13px"><div><h3 style="margin:0;font-size:15px">Laundry items</h3><p style="font-size:11px;margin-top:5px">Choose a service, then add quantity or weight.</p></div><button class="button secondary" id="addItem">＋ Add item</button></div><div class="item-head"><span>Service</span><span>Qty / kg</span><span>Amount</span><span></span></div><div id="billItems">${billItems
    .map((item, index) => {
      const s = serviceById(item.serviceId);
      return `<div class="item-row"><select data-item-service="${index}">${data.services.map((x) => `<option value="${x.id}" ${x.id === item.serviceId ? "selected" : ""}>${x.name} · ${x.type}</option>`).join("")}</select><input type="number" min="0.1" step="0.1" value="${item.qty}" data-item-qty="${index}"><span class="line-total">${money(s ? s.price * item.qty : 0)}</span><button class="remove-item" data-remove-item="${index}">×</button></div>`;
    })
    .join(
      "",
    )}</div>${billItems.length ? "" : '<p class="muted">No services added yet. Choose “Add item” to begin.</p>'}</div></section><aside class="form-panel billing-summary"><div class="panel-head"><div><h3>Payment summary</h3><p>Token #${nextToken()}</p></div><span class="status unpaid payment-status">Unpaid</span></div><div class="summary-line"><span>Subtotal</span><strong>${money(subTotal)}</strong></div><div class="form-field"><label>Discount <small>optional</small></label><input id="billDiscount" type="number" min="0" value="0" placeholder="0"></div><div class="form-field"><label>Advance paid</label><input id="billPaid" type="number" min="0" value="0" placeholder="0"></div><div class="summary-line total"><span>Total</span><strong id="billTotal">${money(subTotal)}</strong></div><div class="summary-line due"><span>Balance due</span><strong id="billDue">${money(subTotal)}</strong></div><button id="saveOrder" class="button primary wide">Save order <span>→</span></button><div class="note-box">The customer’s token and delivery date will appear on their receipt. You can print it right after saving.</div></aside></div>`;
}
function ordersView() {
  return `<div class="section-head"><div><span class="eyebrow">WORK QUEUE</span><h2>Orders</h2></div><div class="row-actions"><button class="button danger" id="resetOrders">Reset orders</button><button class="button primary" data-view="billing">＋ New order</button></div></div><section class="panel table-panel"><div class="table-toolbar"><input class="search-input" id="orderSearch" placeholder="Search token or customer..."><div class="filter-row">${["All", "Received", "Ready", "Delivered"].map((f) => `<button class="filter-button ${orderFilter === f ? "active" : ""}" data-filter="${f}">${f}</button>`).join("")}</div></div><div id="ordersTable">${ordersTable(data.orders.filter((o) => orderFilter === "All" || o.status === orderFilter))}</div></section>`;
}
function customersView() {
  return `<div class="section-head"><div><span class="eyebrow">CUSTOMER BOOK</span><h2>Customers</h2></div><button class="button primary" id="addCustomer">＋ Add customer</button></div><section class="panel table-panel"><div class="table-toolbar"><input class="search-input" id="customerSearch" placeholder="Search by phone number..."><span class="muted">${data.customers.length} customers</span></div><table><thead><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Total spent</th><th></th></tr></thead><tbody id="customersTable">${customerRows(data.customers)}</tbody></table></section>`;
}
function customerRows(customers) {
  return (
    customers
      .map((c) => {
        const orders = data.orders.filter((o) => o.customerId === c.id);
        return `<tr><td><strong>${c.name}</strong></td><td>${c.phone}</td><td>${orders.length}</td><td class="amount">${money(orders.reduce((s, o) => s + o.total, 0))}</td><td><button class="small-action danger" data-delete-customer="${c.id}">Remove</button></td></tr>`;
      })
      .join("") ||
    '<tr><td colspan="5" class="empty-state">No customers match that phone number.</td></tr>'
  );
}
function servicesView() {
  return `<div class="section-head"><div><span class="eyebrow">RATE CARD</span><h2>Services & prices</h2></div><button class="button primary" id="addService">＋ Add service</button></div><section class="panel table-panel"><table><thead><tr><th>Service name</th><th>Price</th><th>Charged by</th><th></th></tr></thead><tbody>${data.services.map((s) => `<tr><td><strong>${s.name}</strong></td><td class="amount">${money(s.price)}</td><td><span class="status delivered">${s.type}</span></td><td><button class="small-action" data-edit-service="${s.id}">Edit</button></td></tr>`).join("")}</tbody></table></section>`;
}
function inventoryView() {
  return `<div class="section-head"><div><span class="eyebrow">SUPPLY CUPBOARD</span><h2>Inventory</h2></div><button class="button primary" id="addInventory">＋ Add item</button></div><div class="inventory-grid">${data.inventory
    .map((i) => {
      const low = i.stock < i.minStock;
      const percent = Math.min((i.stock / i.minStock) * 100, 100);
      return `<div class="inventory-card ${low ? "low" : ""}"><h3>${i.name}</h3><span class="muted">Minimum level: ${i.minStock} ${i.unit}</span><div class="stock-count">${i.stock} <span>${i.unit}</span></div>${low ? '<span class="low-warning">● LOW STOCK · RESTOCK SOON</span>' : '<span class="low-warning" style="color:var(--teal)">● STOCK LEVEL OK</span>'}<div class="progress"><span style="width:${percent}%"></span></div><div class="row-actions"><button class="button ghost" data-stock="${i.id}" data-change="reduce">− Reduce</button><button class="button secondary" data-stock="${i.id}" data-change="add">＋ Add stock</button><button class="button danger" data-delete-inventory="${i.id}">Remove</button></div></div>`;
    })
    .join("")}</div>`;
}
function openModal(title, body, onSave, saveLabel = "Save") {
  const root = document.getElementById("modalRoot");
  const modalClass = saveLabel !== "Save" ? "modal danger" : "modal";
  root.innerHTML = `<div class="modal-backdrop"><form class="${modalClass}" id="activeModal"><h2>${title}</h2>${body}<div class="modal-actions"><button type="button" class="button ghost" id="closeModal">Cancel</button><button class="button ${saveLabel !== "Save" ? "danger" : "primary"}" type="submit">${saveLabel}</button></div></form></div>`;
  root.querySelector("#closeModal").onclick = () => (root.innerHTML = "");
  root.querySelector("#activeModal").onsubmit = (e) => {
    e.preventDefault();
    onSave(new FormData(e.target));
    root.innerHTML = "";
    render();
  };
}
function customerModal() {
  openModal(
    "Add a customer",
    '<div class="form-field"><label>Name</label><input name="name" required placeholder="e.g. Nisha Karki"></div><div class="form-field"><label>Phone number</label><input name="phone" required pattern="[0-9]{7,15}" placeholder="98XXXXXXXX"></div>',
    (form) => {
      data.customers.push({
        id: uid("c"),
        name: form.get("name"),
        phone: form.get("phone"),
      });
      save();
      showToast("Customer added to the book");
    },
  );
}
function serviceModal(id) {
  const existing = id && serviceById(id);
  openModal(
    existing ? "Edit service" : "Add a service",
    `<div class="form-field"><label>Service name</label><input name="name" required value="${existing?.name || ""}" placeholder="e.g. Curtain"></div><div class="form-grid"><div class="form-field"><label>Price (NPR)</label><input name="price" type="number" min="0" required value="${existing?.price || ""}"></div><div class="form-field"><label>Charged by</label><select name="type"><option ${existing?.type === "per piece" ? "selected" : ""}>per piece</option><option ${existing?.type === "per kg" ? "selected" : ""}>per kg</option></select></div></div>`,
    (form) => {
      const record = {
        id: existing?.id || uid("s"),
        name: form.get("name"),
        price: Number(form.get("price")),
        type: form.get("type"),
      };
      if (existing) Object.assign(existing, record);
      else data.services.push(record);
      save();
      showToast(existing ? "Service updated" : "Service added");
    },
  );
}
function inventoryModal() {
  openModal(
    "Add inventory item",
    '<div class="form-field"><label>Item name</label><input name="name" required placeholder="e.g. Packaging bags"></div><div class="form-grid"><div class="form-field"><label>Current stock</label><input name="stock" type="number" min="0" required></div><div class="form-field"><label>Unit</label><input name="unit" required placeholder="pcs / kg"></div><div class="form-field field-full"><label>Minimum stock level</label><input name="minStock" type="number" min="0" required></div></div>',
    (form) => {
      data.inventory.push({
        id: uid("i"),
        name: form.get("name"),
        stock: Number(form.get("stock")),
        unit: form.get("unit"),
        minStock: Number(form.get("minStock")),
      });
      save();
      showToast("Inventory item added");
    },
  );
}
function bindViewEvents() {
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  document
    .querySelectorAll("[data-print]")
    .forEach((b) => (b.onclick = () => printReceipt(b.dataset.print)));
  document
    .querySelectorAll("[data-status]")
    .forEach((b) => (b.onclick = () => cycleStatus(b.dataset.status)));
  document
    .querySelectorAll("[data-pay]")
    .forEach((b) => (b.onclick = () => markOrderPaid(b.dataset.pay)));
  document
    .querySelectorAll("[data-delete-customer]")
    .forEach((b) => (b.onclick = () => removeCustomer(b.dataset.deleteCustomer)));
  document
    .querySelectorAll("[data-delete-inventory]")
    .forEach((b) => (b.onclick = () => removeInventoryItem(b.dataset.deleteInventory)));
  if (document.getElementById("addCustomer"))
    document.getElementById("addCustomer").onclick = customerModal;
  if (document.getElementById("quickCustomer"))
    document.getElementById("quickCustomer").onclick = customerModal;
  if (document.getElementById("addService"))
    document.getElementById("addService").onclick = () => serviceModal();
  document
    .querySelectorAll("[data-edit-service]")
    .forEach((b) => (b.onclick = () => serviceModal(b.dataset.editService)));
  if (document.getElementById("addInventory"))
    document.getElementById("addInventory").onclick = inventoryModal;
  document
    .querySelectorAll("[data-stock]")
    .forEach(
      (b) => (b.onclick = () => changeStock(b.dataset.stock, b.dataset.change)),
    );
  document.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        orderFilter = b.dataset.filter;
        render();
      }),
  );
  if (document.getElementById("resetOrders"))
    document.getElementById("resetOrders").onclick = resetOrders;
  const search = document.getElementById("orderSearch");
  if (search)
    search.oninput = () => {
      const q = search.value.toLowerCase();
      document.getElementById("ordersTable").innerHTML = ordersTable(
        data.orders.filter(
          (o) =>
            (orderFilter === "All" || o.status === orderFilter) &&
            (`#${o.tokenNo}`.includes(q) ||
              customerName(o.customerId).toLowerCase().includes(q)),
        ),
      );
    };
  const customerSearch = document.getElementById("customerSearch");
  if (customerSearch)
    customerSearch.oninput = () => {
      const q = customerSearch.value;
      document.getElementById("customersTable").innerHTML = customerRows(
        data.customers.filter((c) => c.phone.includes(q)),
      );
    };
  bindBillingEvents();
}
function bindBillingEvents() {
  if (!document.getElementById("billItems")) return;
  document.getElementById("addItem").onclick = () => {
    if (!data.services.length) {
      showToast("Add a service and price first");
      return;
    }
    billItems.push({ serviceId: data.services[0].id, qty: 1 });
    render();
  };
  document.querySelectorAll("[data-remove-item]").forEach(
    (b) =>
      (b.onclick = () => {
        billItems.splice(Number(b.dataset.removeItem), 1);
        render();
      }),
  );
  document.querySelectorAll("[data-item-service]").forEach(
    (el) =>
      (el.onchange = () => {
        billItems[Number(el.dataset.itemService)].serviceId = el.value;
        render();
      }),
  );
  document.querySelectorAll("[data-item-qty]").forEach(
    (el) =>
      (el.oninput = () => {
        billItems[Number(el.dataset.itemQty)].qty = Number(el.value);
        updateBillTotals();
      }),
  );
  ["billDiscount", "billPaid"].forEach(
    (id) => (document.getElementById(id).oninput = updateBillTotals),
  );
  document.getElementById("saveOrder").onclick = saveOrder;
}
function billNumbers() {
  const subtotal = billItems.reduce(
    (sum, item) =>
      sum + (serviceById(item.serviceId)?.price || 0) * Number(item.qty || 0),
    0,
  );
  const discount = Number(document.getElementById("billDiscount")?.value || 0);
  const paid = Number(document.getElementById("billPaid")?.value || 0);
  return { subtotal, discount, paid, total: Math.max(0, subtotal - discount) };
}
function updateBillTotals() {
  const n = billNumbers();
  const paymentStatus =
    n.total === 0 || n.paid === 0
      ? "Unpaid"
      : n.paid >= n.total
        ? "Paid"
        : "Partially paid";
  const paymentBadge = document.querySelector(".billing-summary .payment-status");
  if (paymentBadge) {
    paymentBadge.textContent = paymentStatus;
    paymentBadge.className = `status ${paymentStatus.toLowerCase().replace(" ", "-")} payment-status`;
  }
  document.getElementById("billTotal").textContent = money(n.total);
  document.getElementById("billDue").textContent = money(
    Math.max(0, n.total - n.paid),
  );
  document
    .querySelectorAll(".line-total")
    .forEach(
      (el, i) =>
        (el.textContent = money(
          (serviceById(billItems[i].serviceId)?.price || 0) * billItems[i].qty,
        )),
    );
}
function saveOrder() {
  if (!billItems.length) {
    showToast("Add a service to the order first");
    return;
  }
  if (!data.services.length) {
    showToast("Add a service and price first");
    return;
  }
  if (billItems.some((item) => !serviceById(item.serviceId) || Number(item.qty) <= 0)) {
    showToast("Select a valid service and quantity");
    return;
  }
  const customer = document.getElementById("billCustomer").value;
  if (!customer) {
    showToast("Please choose a customer first");
    return;
  }
  const n = billNumbers();
  const order = {
    id: uid("o"),
    tokenNo: nextToken(),
    customerId: customer,
    date: currentDateKey(),
    deliveryDate: document.getElementById("deliveryDate").value,
    status: "Received",
    total: n.total,
    discount: n.discount,
    paid: Math.min(n.paid, n.total),
    items: billItems.map((i) => ({
      serviceId: i.serviceId,
      qty: Number(i.qty),
      rate: serviceById(i.serviceId).price,
      amount: serviceById(i.serviceId).price * Number(i.qty),
    })),
  };
  data.orders.unshift(order);
  save();
  showToast(`Order #${order.tokenNo} saved`);
  printReceipt(order.id);
  billItems = [];
  setView("orders");
}
function markOrderPaid(id) {
  const order = data.orders.find((o) => o.id === id);
  if (!order) return;
  order.paid = order.total;
  save();
  render();
  showToast(`Order #${order.tokenNo} marked fully paid`);
}
function resetOrders() {
  if (!data.orders.length) {
    showToast("There are no orders to reset");
    return;
  }
  openModal(
    "Reset all orders?",
    `<div class="reset-warning"><div class="warning-badge">!</div><div><p>This will clear the current order queue.</p><small>It will also restart the token count from 1.</small></div></div>`,
    () => {
      data.orders = [];
      save();
      render();
      showToast("Orders reset");
    },
    "Reset orders",
  );
}
function removeCustomer(id) {
  const customer = data.customers.find((c) => c.id === id);
  if (!customer) return;
  openModal(
    "Remove customer?",
    `<div class="reset-warning"><div class="warning-badge">!</div><div><p>This will delete ${customer.name} from the customer book.</p><small>Orders tied to this customer will remain, but the customer name will no longer appear.</small></div></div>`,
    () => {
      data.customers = data.customers.filter((c) => c.id !== id);
      data.orders = data.orders.map((order) =>
        order.customerId === id ? { ...order, customerId: "" } : order,
      );
      save();
      render();
      showToast(`${customer.name} removed`);
    },
    "Remove",
  );
}
function removeInventoryItem(id) {
  const item = data.inventory.find((entry) => entry.id === id);
  if (!item) return;
  openModal(
    "Remove inventory item?",
    `<div class="reset-warning"><div class="warning-badge">!</div><div><p>This will remove ${item.name} from inventory.</p><small>This action cannot be undone.</small></div></div>`,
    () => {
      data.inventory = data.inventory.filter((entry) => entry.id !== id);
      save();
      showToast(`${item.name} removed from inventory`);
    },
    "Remove",
  );
}
function cycleStatus(id) {
  const order = data.orders.find((o) => o.id === id);
  const statuses = ["Received", "Ready", "Delivered"];
  order.status = statuses[(statuses.indexOf(order.status) + 1) % 3];
  save();
  render();
  showToast(`Order #${order.tokenNo} marked ${order.status}`);
}
function changeStock(id, change) {
  const item = data.inventory.find((i) => i.id === id);
  openModal(
    `${change === "add" ? "Add" : "Reduce"} ${item.name}`,
    `<div class="form-field"><label>Quantity (${item.unit})</label><input name="quantity" type="number" min="1" required autofocus></div>`,
    (form) => {
      const quantity = Number(form.get("quantity"));
      item.stock = Math.max(
        0,
        item.stock + (change === "add" ? quantity : -quantity),
      );
      save();
      showToast(`${item.name} stock updated`);
    },
  );
}
function printReceipt(id) {
  const o = data.orders.find((x) => x.id === id);
  const w = window.open("", "_blank", "width=500,height=700");
  if (!w) {
    showToast("Please allow pop-ups to print receipts");
    return;
  }
  w.document.write(
    `<html><head><title>Receipt #${o.tokenNo}</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#17251f}h1{font-size:22px;margin:0 0 4px}p{color:#68756e;font-size:12px}.top{border-bottom:2px solid #0f6e63;padding-bottom:20px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:10px 0;font-size:13px}.total{font-weight:bold;font-size:16px}.small{font-size:11px;margin-top:25px}</style></head><body><div class="top"><h1>Kamal Power Laundry</h1><p>CARE · PRESS · RETURN</p><strong>RECEIPT #${o.tokenNo}</strong><p>${dateLabel(o.date)} · Delivery: ${dateLabel(o.deliveryDate)}</p></div><p><b>Customer:</b> ${customerName(o.customerId)}</p>${o.items.map((i) => `<div class="row"><span>${serviceName(i.serviceId)} × ${i.qty}</span><span>${money(i.amount)}</span></div>`).join("")}<div class="row"><span>Subtotal</span><span>${money(o.total + o.discount)}</span></div><div class="row"><span>Discount</span><span>- ${money(o.discount)}</span></div><div class="row total"><span>Total</span><span>${money(o.total)}</span></div><div class="row"><span>Advance paid</span><span>${money(o.paid)}</span></div><div class="row total"><span>Balance due</span><span>${money(o.total - o.paid)}</span></div><p class="small">Please bring this token when collecting your clothes. Thank you.</p><script>window.print();<\/script></body></html>`,
  );
  w.document.close();
}
document.getElementById("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("loginUsername").value,
        password: document.getElementById("loginPassword").value,
      }),
    });
    if (!response.ok) throw new Error("Incorrect username or password");
    await loadServerData();
    updateHeaderClock();
    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("appView").classList.remove("hidden");
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
};
document.getElementById("logoutButton").onclick = async () => {
  await fetch("/api/logout", { method: "POST" });
  document.getElementById("appView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("loginPassword").value = "";
};
document.getElementById("mainNav").onclick = (e) => {
  const button = e.target.closest("[data-view]");
  if (button) setView(button.dataset.view);
};
document.getElementById("globalSearchButton").onclick = () => setView("orders");
document.addEventListener("keydown", (e) => {
  if (
    e.key.toLowerCase() === "n" &&
    !["INPUT", "SELECT"].includes(document.activeElement.tagName)
  )
    setView("billing");
});
let displayedDate = dateKey(today());
setInterval(() => {
  const currentDate = dateKey(today());
  if (currentDate !== displayedDate) {
    displayedDate = currentDate;
    if (currentView === "dashboard") render();
  }
  updateHeaderClock();
}, 60_000);
updateHeaderClock();
