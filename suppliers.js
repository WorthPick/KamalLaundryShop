(() => {
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
    );
  const money = (value) => `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dateLabel = (value) =>
    value
      ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "—";
  const units = ["kg", "litre", "piece", "packet", "box", "bottle"];
  let suppliers = [];
  let purchases = [];
  let inventory = [];
  let loaded = false;
  let loading = false;
  let loadError = "";
  let section = "suppliers";
  let supplierId = "";
  let purchaseId = "";
  let filters = { supplier: "", payment: "", status: "", from: "", to: "" };

  const toast = (message) => window.showToast(message);
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(result?.error || "Could not complete the request");
    return result;
  }
  async function refresh() {
    loading = true;
    loadError = "";
    try {
      const [supplierData, purchaseData, inventoryData] = await Promise.all([
        request("/api/suppliers"),
        request("/api/purchases"),
        window.loadInventoryData(),
      ]);
      suppliers = supplierData;
      purchases = purchaseData;
      inventory = inventoryData;
      loaded = true;
    } catch (error) {
      loaded = true;
      loadError = error.message;
      toast(error.message);
    } finally {
      loading = false;
      if (window.currentView === "suppliers") window.render();
    }
  }
  const supplierName = (id) => suppliers.find((row) => row.id === id)?.name || "Supplier";
  const status = (value) => `<span class="status ${esc(String(value || "").toLowerCase().replaceAll(" ", "-"))}">${esc(value)}</span>`;
  const purchaseRows = (rows) =>
    rows
      .map(
        (purchase) =>
          `<tr><td><strong>${esc(purchase.purchase_number)}</strong></td><td>${esc(purchase.supplier?.name || supplierName(purchase.supplier_id))}</td><td>${dateLabel(purchase.purchase_date)}</td><td>${purchase.items?.length || 0}</td><td class="amount">${money(purchase.total_amount)}</td><td class="amount">${money(purchase.balance_amount)}</td><td>${status(purchase.payment_status)}</td><td>${status(purchase.purchase_status)}</td><td><button class="small-action" data-supplier-action="purchase" data-id="${esc(purchase.id)}">View</button></td></tr>`,
      )
      .join("") || '<tr><td colspan="9" class="empty-state">No purchases found.</td></tr>';
  const purchaseTable = (rows) =>
    `<section class="panel table-panel supplier-table"><table><thead><tr><th>Purchase no.</th><th>Supplier</th><th>Date</th><th>Items</th><th>Total</th><th>Balance</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>${purchaseRows(rows)}</tbody></table></section>`;
  const totalOf = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);

  function summaryCards() {
    const unpaid = purchases.filter((row) => row.purchase_status === "Received");
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 7);
    const recentCount = purchases.filter((row) => new Date(`${row.purchase_date}T00:00:00`) >= recentCutoff).length;
    return `<div class="stats-grid"><div class="stat-card"><span class="stat-label">Total suppliers</span><strong>${suppliers.filter((row) => row.is_active !== false).length}</strong><span class="stat-note">Active suppliers</span></div><div class="stat-card"><span class="stat-label">Total spent</span><strong>${money(totalOf(purchases.filter((row) => row.purchase_status === "Received"), "total_amount"))}</strong><span class="stat-note">Received purchases</span></div><div class="stat-card"><span class="stat-label">Pending payments</span><strong>${money(totalOf(unpaid, "balance_amount"))}</strong><span class="stat-note">Supplier balances</span></div><div class="stat-card"><span class="stat-label">Recent purchases</span><strong>${recentCount}</strong><span class="stat-note">Last 7 days</span></div></div>`;
  }
  function supplierList() {
    const rows = suppliers
      .map((supplier) => {
        const history = purchases.filter((row) => row.supplier_id === supplier.id);
        const supplied = [...new Set(history.flatMap((row) => (row.items || []).map((line) => line.item_name || line.inventory?.name).filter(Boolean)))];
        return `<tr><td><strong>${esc(supplier.name)}</strong>${supplier.is_active === false ? '<span class="subtext">Inactive</span>' : ""}</td><td>${esc(supplier.contact_person || "—")}</td><td>${esc(supplier.phone || "—")}</td><td>${esc(supplier.email || "—")}</td><td>${esc(supplier.address || "—")}</td><td>${esc(supplier.registration_number || "—")}</td><td>${esc(supplied.join(", ") || "—")}</td><td>${history.length}</td><td class="amount">${money(totalOf(history.filter((row) => row.purchase_status === "Received"), "total_amount"))}</td><td>${dateLabel(history[0]?.purchase_date)}</td><td><button class="small-action" data-supplier-action="view" data-id="${esc(supplier.id)}">View</button> <button class="small-action" data-supplier-action="edit" data-id="${esc(supplier.id)}">Edit</button> ${supplier.is_active === false ? '<span class="subtext">Inactive</span>' : `<button class="small-action danger" data-supplier-action="delete" data-id="${esc(supplier.id)}">Delete</button>`}</td></tr>`;
      })
      .join("");
    return `<section class="panel table-panel supplier-table"><table><thead><tr><th>Supplier</th><th>Contact person</th><th>Phone</th><th>Email</th><th>Address</th><th>Business registration</th><th>Items supplied</th><th>Purchases</th><th>Total spent</th><th>Last purchase</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="11" class="empty-state">No suppliers yet. Add your first supplier to get started.</td></tr>'}</tbody></table></section>`;
  }
  function supplierPage() {
    const selected = suppliers.find((row) => row.id === supplierId);
    if (!selected) {
      supplierId = "";
      section = "suppliers";
      return supplierList();
    }
    const history = purchases.filter((row) => row.supplier_id === selected.id);
    const lines = [...new Set(history.flatMap((row) => (row.items || []).map((item) => item.item_name || item.inventory?.name).filter(Boolean)))];
    const payable = totalOf(history.filter((row) => row.purchase_status === "Received"), "balance_amount");
    return `<div class="section-head"><div><button class="small-action" data-supplier-action="back">← Suppliers</button><span class="eyebrow">SUPPLIER PROFILE</span><h2>${esc(selected.name)}</h2></div><div class="row-actions"><button class="button ghost" data-supplier-action="edit" data-id="${esc(selected.id)}">Edit supplier</button>${selected.is_active !== false ? `<button class="button primary" data-supplier-action="new-purchase" data-id="${esc(selected.id)}">＋ New purchase</button>` : ""}</div></div><div class="stats-grid"><div class="stat-card"><span class="stat-label">Total purchases</span><strong>${history.length}</strong></div><div class="stat-card"><span class="stat-label">Total spent</span><strong>${money(totalOf(history.filter((row) => row.purchase_status === "Received"), "total_amount"))}</strong></div><div class="stat-card"><span class="stat-label">Pending payable</span><strong>${money(payable)}</strong></div><div class="stat-card"><span class="stat-label">Latest purchase</span><strong class="supplier-date">${dateLabel(history[0]?.purchase_date)}</strong></div></div><section class="panel supplier-profile"><div><span class="eyebrow">CONTACT DETAILS</span><p><strong>Contact person</strong><br>${esc(selected.contact_person || "—")}</p><p><strong>Phone</strong><br>${esc(selected.phone || "—")}</p><p><strong>Email</strong><br>${esc(selected.email || "—")}</p><p><strong>Address</strong><br>${esc(selected.address || "—")}</p><p><strong>Business registration</strong><br>${esc(selected.registration_number || "—")}</p><p><strong>Notes</strong><br>${esc(selected.notes || "—")}</p></div><div><span class="eyebrow">ITEMS SUPPLIED</span><p>${esc(lines.join(", ") || "No items recorded yet.")}</p></div></section><div class="panel-head supplier-history-head"><h3>Purchase history</h3></div>${purchaseTable(history)}`;
  }
  function historyPage() {
    const rows = purchases.filter((row) =>
      (!filters.supplier || row.supplier_id === filters.supplier) &&
      (!filters.payment || row.payment_status === filters.payment) &&
      (!filters.status || row.purchase_status === filters.status) &&
      (!filters.from || row.purchase_date >= filters.from) &&
      (!filters.to || row.purchase_date <= filters.to),
    );
    return `<div class="section-head"><div><span class="eyebrow">PURCHASING</span><h2>Purchase history</h2></div><button class="button primary" data-supplier-action="new-purchase">＋ New purchase</button></div><section class="panel table-panel supplier-filter-panel"><div class="table-toolbar supplier-filters"><select data-filter-supplier><option value="">All suppliers</option>${suppliers.map((row) => `<option value="${esc(row.id)}" ${filters.supplier === row.id ? "selected" : ""}>${esc(row.name)}</option>`).join("")}</select><input type="date" aria-label="From date" data-filter-from value="${esc(filters.from)}"><input type="date" aria-label="To date" data-filter-to value="${esc(filters.to)}"><select data-filter-payment><option value="">All payment statuses</option>${["Paid", "Unpaid", "Partially Paid"].map((value) => `<option ${filters.payment === value ? "selected" : ""}>${value}</option>`).join("")}</select><select data-filter-status><option value="">All purchase statuses</option>${["Draft", "Ordered", "Received", "Cancelled"].map((value) => `<option ${filters.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></div></section>${purchaseTable(rows)}`;
  }
  function reportPage() {
    const frequency = {};
    const bySupplier = {};
    for (const purchase of purchases.filter((row) => row.purchase_status === "Received")) {
      bySupplier[purchase.supplier_id] = (bySupplier[purchase.supplier_id] || 0) + Number(purchase.total_amount);
      for (const item of purchase.items || []) {
        const name = `${item.item_name || item.inventory?.name || "Inventory item"} (${item.unit})`;
        frequency[name] = (frequency[name] || 0) + Number(item.quantity);
      }
    }
    const dateTotals = {};
    purchases.filter((row) => row.purchase_status === "Received").forEach((row) => {
      dateTotals[row.purchase_date] = (dateTotals[row.purchase_date] || 0) + Number(row.total_amount);
    });
    return `<div class="section-head"><div><span class="eyebrow">SUPPLIER INSIGHTS</span><h2>Reports</h2></div><button class="button primary" data-supplier-action="new-purchase">＋ New purchase</button></div>${summaryCards()}<div class="supplier-report-grid"><section class="panel"><h3>Supplier-wise purchases</h3><table><thead><tr><th>Supplier</th><th>Total received</th></tr></thead><tbody>${Object.entries(bySupplier).sort((a, b) => b[1] - a[1]).map(([id, amount]) => `<tr><td>${esc(supplierName(id))}</td><td class="amount">${money(amount)}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No received purchases yet.</td></tr>'}</tbody></table></section><section class="panel"><h3>Most purchased items</h3><table><thead><tr><th>Inventory item</th><th>Quantity purchased</th></tr></thead><tbody>${Object.entries(frequency).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, quantity]) => `<tr><td>${esc(name)}</td><td class="amount">${quantity}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No items recorded yet.</td></tr>'}</tbody></table></section><section class="panel"><h3>Date-wise purchase expenses</h3><table><thead><tr><th>Date</th><th>Total received</th></tr></thead><tbody>${Object.entries(dateTotals).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 15).map(([date, amount]) => `<tr><td>${dateLabel(date)}</td><td class="amount">${money(amount)}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No received purchases yet.</td></tr>'}</tbody></table></section><section class="panel"><h3>Recent purchases</h3>${purchaseRows(purchases.slice(0, 5))}</section></div>`;
  }
  function purchasePage() {
    const purchase = purchases.find((row) => row.id === purchaseId);
    if (!purchase) {
      purchaseId = "";
      section = "purchases";
      return historyPage();
    }
    const canReceive = ["Draft", "Ordered"].includes(purchase.purchase_status);
    return `<div class="section-head"><div><button class="small-action" data-supplier-action="back">← Purchase history</button><span class="eyebrow">PURCHASE DETAILS</span><h2>${esc(purchase.purchase_number)}</h2><p class="muted">${esc(purchase.supplier?.name || supplierName(purchase.supplier_id))} · ${dateLabel(purchase.purchase_date)}</p></div><div class="row-actions">${canReceive ? `<button class="button ghost" data-supplier-action="edit-purchase" data-id="${esc(purchase.id)}">Edit purchase</button><button class="button secondary" data-supplier-action="receive" data-id="${esc(purchase.id)}">Mark received</button>` : ""}${canReceive ? `<button class="button danger" data-supplier-action="cancel-purchase" data-id="${esc(purchase.id)}">Cancel purchase</button>` : ""}</div></div><div class="stats-grid"><div class="stat-card"><span class="stat-label">Total amount</span><strong>${money(purchase.total_amount)}</strong></div><div class="stat-card"><span class="stat-label">Amount paid</span><strong>${money(purchase.amount_paid)}</strong></div><div class="stat-card"><span class="stat-label">Remaining balance</span><strong>${money(purchase.balance_amount)}</strong></div><div class="stat-card"><span class="stat-label">Payment / purchase status</span><strong class="supplier-status">${esc(purchase.payment_status)} / ${esc(purchase.purchase_status)}</strong></div></div><section class="panel supplier-profile"><div><p><strong>Supplier:</strong> ${esc(purchase.supplier?.name || supplierName(purchase.supplier_id))}</p><p><strong>Invoice:</strong> ${esc(purchase.invoice_number || "—")}</p><p><strong>Notes:</strong> ${esc(purchase.notes || "—")}</p></div><div><span class="eyebrow">ITEMS PURCHASED</span></div></section><section class="panel table-panel supplier-table"><table><thead><tr><th>Inventory item</th><th>Quantity</th><th>Unit</th><th>Unit cost</th><th>Line total</th></tr></thead><tbody>${(purchase.items || []).map((item) => `<tr><td><strong>${esc(item.item_name || item.inventory?.name || "Inventory item")}</strong></td><td>${esc(item.quantity)}</td><td>${esc(item.unit)}</td><td>${money(item.unit_cost)}</td><td class="amount">${money(item.total_amount)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty-state">No items on this purchase.</td></tr>'}</tbody></table></section>`;
  }
  function render(inventoryItems = []) {
    inventory = inventoryItems;
    if (!loaded && !loading) void refresh();
    if (loading && !loaded) return '<section class="panel"><p class="muted">Loading suppliers and purchases…</p></section>';
    if (loadError) return `<section class="panel"><p class="muted">Could not load supplier data: ${esc(loadError)}</p><button class="button secondary" data-supplier-action="retry">Try again</button></section>`;
    const tabs = `<div class="supplier-tabs"><button class="${section === "suppliers" ? "active" : ""}" data-supplier-action="section" data-section="suppliers">Suppliers</button><button class="${section === "purchases" ? "active" : ""}" data-supplier-action="section" data-section="purchases">Purchase history</button><button class="${section === "reports" ? "active" : ""}" data-supplier-action="section" data-section="reports">Reports</button></div>`;
    if (supplierId) return supplierPage();
    if (purchaseId) return purchasePage();
    if (section === "suppliers") return `${summaryCards()}<div class="section-head"><div><span class="eyebrow">SUPPLY PARTNERS</span><h2>Suppliers</h2></div><div class="row-actions"><button class="button secondary" data-supplier-action="new-purchase">＋ New purchase</button><button class="button primary" data-supplier-action="add">＋ Add supplier</button></div></div>${tabs}${supplierList()}<section class="panel supplier-recent"><div class="panel-head"><div><h3>Recent purchases</h3><p>Latest supply activity</p></div><button class="small-action" data-supplier-action="section" data-section="purchases">View history →</button></div>${purchaseTable(purchases.slice(0, 5))}</section>`;
    return `${tabs}${section === "purchases" ? historyPage() : reportPage()}`;
  }
  function supplierForm(existing) {
    const field = (key, label, type = "text", required = false) =>
      `<div class="form-field"><label>${label}${required ? " *" : ""}</label><input name="${key}" type="${type}" ${required ? "required" : ""} value="${esc(existing?.[key] || "")}"></div>`;
    window.openModal(existing ? "Edit supplier" : "Add supplier", `<div class="form-grid">${field("name", "Supplier name", "text", true)}${field("contact_person", "Contact person")}${field("phone", "Phone number", "tel")}${field("email", "Email", "email")}<div class="form-field field-full"><label>Address</label><input name="address" value="${esc(existing?.address || "")}"></div>${field("registration_number", "Business registration number")}<div class="form-field field-full"><label>Notes</label><textarea class="form-input" name="notes" rows="3">${esc(existing?.notes || "")}</textarea></div></div>`, async (form) => {
      const body = Object.fromEntries(["name", "contact_person", "phone", "email", "address", "registration_number", "notes"].map((key) => [key, String(form.get(key) || "").trim()]));
      if (!body.name) {
        toast("Supplier name is required");
        return false;
      }
      try {
        await request(existing ? `/api/suppliers/${encodeURIComponent(existing.id)}` : "/api/suppliers", { method: existing ? "PUT" : "POST", body: JSON.stringify(body) });
        await refresh();
        toast(existing ? "Supplier updated" : "Supplier added");
      } catch (error) {
        toast(error.message);
        return false;
      }
    });
  }
  const itemRow = () => `<div class="purchase-line"><div class="form-field"><label>Inventory item</label><select class="purchase-item-select"><option value="">Select an item</option>${inventory.map((item) => `<option value="${esc(item.id)}" data-name="${esc(item.name)}" data-unit="${esc(item.unit)}">${esc(item.name)} · ${esc(item.stock)} ${esc(item.unit)}</option>`).join("")}<option value="__new">＋ Add a new item</option></select><input class="purchase-new-item hidden" placeholder="New inventory item name"></div><div class="purchase-line-fields"><div class="form-field"><label>Quantity</label><input class="purchase-quantity" type="number" min="0.001" step="any" value="1" required></div><div class="form-field"><label>Unit</label><select class="purchase-unit">${units.map((unit) => `<option>${unit}</option>`).join("")}</select></div><div class="form-field"><label>Unit cost</label><input class="purchase-cost" type="number" min="0" step="0.01" value="0" required></div><strong class="purchase-line-total">${money(0)}</strong><button class="remove-item" type="button" data-remove-line aria-label="Remove item">×</button></div></div>`;
  function updatePurchaseSummary() {
    const root = document.getElementById("activeModal");
    if (!root) return;
    let total = 0;
    root.querySelectorAll(".purchase-line").forEach((line) => {
      const quantity = Math.round(Number(line.querySelector(".purchase-quantity").value || 0) * 1000) / 1000;
      const cost = Math.round(Number(line.querySelector(".purchase-cost").value || 0) * 100) / 100;
      const amount = Math.round(quantity * cost * 100) / 100;
      total += amount;
      line.querySelector(".purchase-line-total").textContent = money(amount);
    });
    const paid = Number(root.querySelector('[name="amount_paid"]').value || 0);
    root.querySelector("#purchase-total").textContent = money(total);
    const balance = total - Math.round(paid * 100) / 100;
    root.querySelector("#purchase-balance").textContent = money(balance);
    root.querySelector("#purchase-payment-status").textContent =
      balance <= 0 ? "Paid" : paid <= 0 ? "Unpaid" : "Partially Paid";
  }
  function bindPurchaseForm() {
    const root = document.getElementById("activeModal");
    root.classList.add("wide");
    const list = root.querySelector("#purchase-lines");
    const bindRow = (line) => {
      line.querySelectorAll("input,select").forEach((input) => input.addEventListener("input", updatePurchaseSummary));
      line.querySelector(".purchase-item-select").addEventListener("change", (event) => {
        const select = event.currentTarget;
        const newName = line.querySelector(".purchase-new-item");
        newName.classList.toggle("hidden", select.value !== "__new");
        const choice = select.selectedOptions[0];
        if (choice?.dataset.unit) {
          const unitSelect = line.querySelector(".purchase-unit");
          if (!units.includes(choice.dataset.unit)) {
            const option = document.createElement("option");
            option.value = choice.dataset.unit;
            option.textContent = choice.dataset.unit;
            unitSelect.append(option);
          }
          unitSelect.value = choice.dataset.unit;
        }
        updatePurchaseSummary();
      });
      line.querySelector("[data-remove-line]").onclick = () => {
        if (list.querySelectorAll(".purchase-line").length < 2) return toast("A purchase must include at least one item");
        if (!window.confirm("Remove this item from the unsaved purchase?")) return;
        line.remove();
        updatePurchaseSummary();
      };
    };
    list.querySelectorAll(".purchase-line").forEach(bindRow);
    root.querySelector("#add-purchase-line").onclick = () => {
      list.insertAdjacentHTML("beforeend", itemRow());
      bindRow(list.lastElementChild);
    };
    root.querySelector('[name="amount_paid"]').addEventListener("input", updatePurchaseSummary);
    updatePurchaseSummary();
  }
  function purchaseForm(preselectedSupplier = "") {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const form = `<div class="form-grid"><div class="form-field"><label>Supplier *</label><select name="supplier_id" required><option value="">Select supplier</option>${suppliers.filter((row) => row.is_active !== false).map((row) => `<option value="${esc(row.id)}" ${preselectedSupplier === row.id ? "selected" : ""}>${esc(row.name)}</option>`).join("")}</select></div><div class="form-field"><label>Purchase date</label><input name="purchase_date" type="date" required value="${today}"></div><div class="form-field"><label>Invoice / bill number</label><input name="invoice_number"></div><div class="form-field"><label>Purchase status</label><select name="purchase_status"><option>Draft</option><option>Ordered</option></select></div></div><div class="supplier-purchase-items-head"><h3>Purchase items</h3><button type="button" class="button ghost" id="add-purchase-line">＋ Add item</button></div><div id="purchase-lines">${itemRow()}</div><div class="form-grid"><div class="form-field"><label>Amount paid</label><input name="amount_paid" type="number" min="0" step="0.01" value="0"></div><div class="form-field"><label>Notes</label><input name="notes"></div></div><div class="purchase-summary"><div><span>Total purchase amount</span><strong id="purchase-total">${money(0)}</strong></div><div><span>Payment status</span><strong id="purchase-payment-status">Unpaid</strong></div><div><span>Remaining balance</span><strong id="purchase-balance">${money(0)}</strong></div><p class="muted">Inventory stock changes only when the purchase is marked received.</p></div>`;
    window.openModal("New supply purchase", form, async (formData) => {
      const root = document.getElementById("activeModal");
      const lines = [...root.querySelectorAll(".purchase-line")].map((line) => {
        const select = line.querySelector(".purchase-item-select");
        const option = select.selectedOptions[0];
        const isNew = select.value === "__new";
        return {
          ...(!isNew ? { inventory_id: select.value } : {}),
          quantity: Math.round(Number(line.querySelector(".purchase-quantity").value) * 1000) / 1000,
          unit: line.querySelector(".purchase-unit").value,
          unit_cost: Math.round(Number(line.querySelector(".purchase-cost").value) * 100) / 100,
          item_name: isNew ? line.querySelector(".purchase-new-item").value.trim() : (option?.dataset.name || ""),
        };
      });
      if (lines.some((line) => (!line.inventory_id && !line.item_name) || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unit_cost) || line.unit_cost < 0)) {
        toast("Select or name each item and enter a positive quantity and non-negative cost");
        return false;
      }
      const paid = Number(formData.get("amount_paid"));
      if (!Number.isFinite(paid) || paid < 0) {
        toast("Amount paid cannot be negative");
        return false;
      }
      const total = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unit_cost * 100) / 100, 0);
      if (paid > total) {
        toast("Amount paid cannot exceed the purchase total");
        return false;
      }
      try {
        const created = await request("/api/purchases", {
          method: "POST",
          body: JSON.stringify({
            supplier_id: formData.get("supplier_id"),
            purchase_date: formData.get("purchase_date"),
            invoice_number: formData.get("invoice_number"),
            purchase_status: formData.get("purchase_status"),
            amount_paid: Math.round(paid * 100) / 100,
            notes: formData.get("notes"),
            items: lines,
          }),
        });
        await refresh();
        section = "purchases";
        purchaseId = created.id;
        toast("Purchase saved");
      } catch (error) {
        toast(error.message);
        return false;
      }
    });
    bindPurchaseForm();
  }
  function confirmAction(title, message, label, action) {
    window.openModal(title, `<div class="reset-warning"><div class="warning-badge">!</div><div><p>${esc(message)}</p></div></div>`, async (...args) => {
      try {
        return await action(...args);
      } catch (error) {
        toast(error.message);
        return false;
      }
    }, label);
  }
  async function handleAction(event) {
    const button = event.target.closest("[data-supplier-action]");
    if (!button) return;
    const id = button.dataset.id;
    try {
      switch (button.dataset.supplierAction) {
        case "retry":
          loaded = false;
          loadError = "";
          window.render();
          break;
        case "section":
          section = button.dataset.section;
          supplierId = "";
          purchaseId = "";
          window.render();
          break;
        case "add":
          supplierForm(null);
          break;
        case "edit":
          supplierForm(suppliers.find((row) => row.id === id));
          break;
        case "view":
          supplierId = id;
          purchaseId = "";
          window.render();
          break;
        case "back":
          supplierId = "";
          purchaseId = "";
          window.render();
          break;
        case "delete": {
          const target = suppliers.find((row) => row.id === id);
          if (!target) return;
          const history = purchases.some((row) => row.supplier_id === id);
          confirmAction(history ? "Deactivate supplier?" : "Delete supplier?", history ? `${target.name} has purchase history and will be deactivated, not deleted.` : `Delete ${target.name}?`, history ? "Deactivate" : "Delete", async () => {
            await request(`/api/suppliers/${encodeURIComponent(id)}`, { method: "DELETE" });
            await refresh();
            toast(history ? "Supplier deactivated" : "Supplier deleted");
          });
          break;
        }
        case "new-purchase":
          if (!suppliers.some((row) => row.is_active !== false)) return toast("Add an active supplier before creating a purchase");
          if (id && !suppliers.some((row) => row.id === id && row.is_active !== false)) return toast("This supplier is inactive and cannot be selected");
          purchaseForm(suppliers.some((row) => row.id === id) ? id : "");
          break;
        case "purchase":
          purchaseId = id;
          supplierId = "";
          window.render();
          break;
        case "edit-purchase": {
          const purchase = purchases.find((row) => row.id === id);
          if (!purchase) return;
          window.openModal("Edit purchase", `<div class="form-grid"><div class="form-field"><label>Purchase date</label><input name="purchase_date" type="date" required value="${esc(purchase.purchase_date)}"></div><div class="form-field"><label>Purchase status</label><select name="purchase_status"><option ${purchase.purchase_status === "Draft" ? "selected" : ""}>Draft</option><option ${purchase.purchase_status === "Ordered" ? "selected" : ""}>Ordered</option></select></div><div class="form-field"><label>Invoice / bill number</label><input name="invoice_number" value="${esc(purchase.invoice_number || "")}"></div><div class="form-field"><label>Amount paid</label><input name="amount_paid" type="number" min="0" max="${esc(purchase.total_amount)}" step="0.01" value="${esc(purchase.amount_paid)}"></div><div class="form-field field-full"><label>Notes</label><input name="notes" value="${esc(purchase.notes || "")}"></div></div>`, async (form) => {
            try {
              await request(`/api/purchases/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: JSON.stringify({
                  purchase_date: form.get("purchase_date"),
                  purchase_status: form.get("purchase_status"),
                  invoice_number: form.get("invoice_number"),
                  amount_paid: Number(form.get("amount_paid")),
                  notes: form.get("notes"),
                }),
              });
              await refresh();
              purchaseId = id;
              toast("Purchase updated");
            } catch (error) {
              toast(error.message);
              return false;
            }
          });
          break;
        }
        case "receive":
          confirmAction("Receive this purchase?", "This adds the listed quantities to inventory and records each stock movement.", "Mark received", async () => {
            await request(`/api/purchases/${encodeURIComponent(id)}/receive`, { method: "POST", body: "{}" });
            await refresh();
            purchaseId = id;
            toast("Purchase received and inventory updated");
          });
          break;
        case "cancel-purchase":
          confirmAction("Cancel this purchase?", "The purchase will be marked cancelled. No inventory stock will be changed.", "Cancel purchase", async () => {
            await request(`/api/purchases/${encodeURIComponent(id)}`, { method: "DELETE" });
            await refresh();
            purchaseId = id;
            toast("Purchase cancelled");
          });
          break;
      }
    } catch (error) {
      toast(error.message);
    }
  }
  function bind() {
    const content = document.getElementById("content");
    content.querySelectorAll("[data-supplier-action]").forEach((button) => {
      button.onclick = handleAction;
    });
    const filtersMap = [
      ["[data-filter-supplier]", "supplier"],
      ["[data-filter-payment]", "payment"],
      ["[data-filter-status]", "status"],
      ["[data-filter-from]", "from"],
      ["[data-filter-to]", "to"],
    ];
    filtersMap.forEach(([selector, key]) => {
      const input = content.querySelector(selector);
      if (input) input.onchange = () => {
        filters[key] = input.value;
        window.render();
      };
    });
  }
  window.SupplierModule = { render, bind, refresh };
})();
