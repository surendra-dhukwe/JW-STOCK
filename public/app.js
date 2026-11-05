const $ = s => document.querySelector(s);

let me = null;
let currentPage = "dashboard";
let chatTimer = null;
let stockItemsCache = [];

let currentDraftId = null;
let draftSaveTimer = null;
let draftSaving = false;
let draftSaveQueued = false;
let draftSavePromise = null;
let isLoadingDraft = false;
let transactionGroupsCache = [];

const api = async (url, options = {}) => {
  const res = await fetch("/api" + url, {
    credentials: "same-origin",
    ...options
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
};

const fileForm = async (form, url, method = "POST") => {
  const res = await fetch("/api" + url, {
    method,
    body: new FormData(form),
    credentials: "same-origin"
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || "Upload failed");
  }

  return data;
};

const toast = msg => {
  const el = $("#toast");

  if (!el) {
    console.log(msg);
    return;
  }

  el.textContent = msg;
  el.style.display = "block";

  setTimeout(() => {
    el.style.display = "none";
  }, 3500);
};

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const fmtDate = value =>
  value ? new Date(value).toLocaleString() : "—";

const number = value => Number(value || 0);

const sortNewest = rows =>
  [...(rows || [])].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

function resetDraftState() {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }

  currentDraftId = null;
  draftSaving = false;
  draftSaveQueued = false;
  draftSavePromise = null;
  isLoadingDraft = false;
}

function setDraftStatus(message, error = false) {
  const el = $("#draftStatus");

  if (!el) return;

  el.textContent = message;
  el.classList.toggle("red", error);
  el.classList.toggle("green", !error);
}

// ---------------- APPLICATION BOOT ----------------

async function boot() {
  try {
    const d = await api("/auth/me");

    me = d.user;
    showApp();

  } catch {
    me = null;
    showAuth();
  }
}

function showAuth(tab = "login") {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");

  $("#loginForm").classList.toggle("hidden", tab !== "login");
  $("#registerForm").classList.toggle("hidden", tab !== "register");

  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
}

function showApp() {
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");

  $("#profile").innerHTML = `
    <b>${esc(me.name)}</b>
    <small>@${esc(me.username)} · ${esc(me.role)}</small>
  `;

  document.querySelectorAll(".admin-only").forEach(x => {
    x.classList.toggle("hidden", me.role !== "admin");
  });

  navigate("dashboard");
}

function navigate(page) {
  if (chatTimer) {
    clearInterval(chatTimer);
    chatTimer = null;
  }

  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }

  currentPage = page;

  document.querySelectorAll(".nav").forEach(b => {
    b.classList.toggle("active", b.dataset.page === page);
  });

  const titles = {
    dashboard: "Dashboard",
    stock: "Stock & Items",
    transactions: "Transactions",
    chat: "Team Chat",
    approvals: "Approvals",
    users: "User Management",
    dashboardDetail: "Transaction Details",
    lowStock: "Low Stock Items"
  };

  $("#pageTitle").textContent = titles[page] || "Dashboard";
  $("#pageName").textContent = page.toUpperCase();

  const pages = {
    dashboard,
    stock: stockPage,
    transactions: transactionsPage,
    chat: chatPage,
    approvals: approvalsPage,
    users: usersPage,
    dashboardDetail: dashboardDetailPage,
    lowStock: lowStockPage
  };

  (pages[page] || dashboard)().catch(error => {
    console.error(error);

    if (currentPage !== page) return;

    $("#content").innerHTML = `
      <div class="panel">
        <h2>Unable to load page</h2>
        <p>${esc(error.message)}</p>

        <button class="action" onclick="navigate('${page}')">
          Try Again
        </button>
      </div>
    `;

    toast(error.message);
  });
}

// ---------------- AUTHENTICATION ----------------

$("#loginForm").onsubmit = async e => {
  e.preventDefault();

  const button = e.target.querySelector(
    'button[type="submit"], button:not([type])'
  );

  try {
    if (button) button.disabled = true;

    const d = await api("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        Object.fromEntries(new FormData(e.target))
      )
    });

    me = d.user;

    e.target.reset();
    resetDraftState();
    showApp();

  } catch (error) {
    toast(error.message);

  } finally {
    if (button) button.disabled = false;
  }
};

$("#registerForm").onsubmit = async e => {
  e.preventDefault();

  try {
    const d = await api("/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        Object.fromEntries(new FormData(e.target))
      )
    });

    toast(d.message);
    e.target.reset();
    showAuth("login");

  } catch (error) {
    toast(error.message);
  }
};

$("#logoutBtn").onclick = async () => {
  try {
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }

    await flushDraftSave();

    await api("/auth/logout", {
      method: "POST"
    });

    me = null;

    if (chatTimer) {
      clearInterval(chatTimer);
    }

    chatTimer = null;
    resetDraftState();
    showAuth();

  } catch (error) {
    toast(error.message);
  }
};

document.querySelectorAll(".tab").forEach(b => {
  b.onclick = () => showAuth(b.dataset.tab);
});

document.querySelectorAll(".nav").forEach(b => {
  b.onclick = () => navigate(b.dataset.page);
});

// ---------------- DASHBOARD CARDS ----------------

function stat(label, value, sub = "", action = "") {
  return `
    <div class="stat ${action ? "stat-clickable" : ""}"
      ${action ? `role="button" tabindex="0" onclick="${action}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${action}}"` : ""}>
      <small>${label}</small>
      <strong>${value}</strong>
      <small>${sub}</small>
    </div>
  `;
}

// ---------------- DASHBOARD ----------------

async function dashboard() {
  const [items, summary, recent] = await Promise.all([
    api("/items"),
    api("/transactions/summary"),
    api("/transactions/recent")
  ]);

  const pending = number(summary.pending);
  const receive = number(summary.receive);
  const dispatch = number(summary.dispatch);

  const lowStock = items.filter(i =>
    number(i.minimumStock) > 0 &&
    number(i.stock) <= number(i.minimumStock)
  ).length;

  $("#content").innerHTML = `
    <div class="grid">
      ${stat("TOTAL ITEMS", items.length, "Open Item Master", "navigate('stock')")}

      ${stat(
        "PENDING ENTRIES",
        pending,
        "Open pending invoices",
        "openDashboardDetails('pending')"
      )}

      ${stat(
        "TOTAL RECEIVED",
        `<span class="green">+${receive}</span>`,
        "View RECEIVE invoices",
        "openDashboardDetails('RECEIVE')"
      )}

      ${stat(
        "TOTAL DISPATCHED",
        `<span class="red">-${dispatch}</span>`,
        "View DISPATCH invoices",
        "openDashboardDetails('DISPATCH')"
      )}

      ${stat(
        "LOW STOCK ITEMS",
        lowStock,
        "View low stock",
        "navigate('lowStock')"
      )}
    </div>

    <div class="section-head">
      <h2>Recent Transactions</h2>

      <button class="action" onclick="navigate('transactions')">
        View History →
      </button>
    </div>

    ${txTable(sortNewest(recent))}

    <div class="section-head">
      <h2>Stock Snapshot</h2>
    </div>

    ${itemsTable(items, false)}
  `;
}

// ---------------- DASHBOARD DETAILS ----------------

let dashboardDetailFilter = "pending";

function openDashboardDetails(filter) {
  dashboardDetailFilter = filter;
  navigate("dashboardDetail");
}

async function dashboardDetailPage() {
  const rows = await api("/transactions");

  let filtered = rows || [];

  if (dashboardDetailFilter === "pending") {
    filtered = filtered.filter(t => t.status === "pending");
  } else {
    filtered = filtered.filter(t => t.type === dashboardDetailFilter);
  }

  $("#content").innerHTML = `
    <div class="section-head">
      <h2>${esc(dashboardDetailFilter)} Transactions</h2>

      <button class="action" onclick="navigate('dashboard')">
        Back to Dashboard
      </button>
    </div>

    ${txTable(
      filtered,
      me?.role === "admin",
      me?.role === "admin"
    )}
  `;
}

// ---------------- TRANSACTION TABLE ----------------

// ---------------- TRANSACTION TABLE ----------------

function txTable(rows, adminActions = false, allowDelete = false) {
  rows = sortNewest(rows || []);

  if (!rows.length) {
    return `<div class="empty">No transactions found.</div>`;
  }

  return `
    <div class="panel table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Invoice</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th>Type</th>
            <th>Quantity</th>
            <th>User</th>
            <th>Status</th>
            ${adminActions || allowDelete ? "<th>Action</th>" : ""}
          </tr>
        </thead>

        <tbody>
          ${rows.map(t => `
            <tr>
              <td>${fmtDate(t.createdAt)}</td>

              <td>${esc(t.invoiceNumber || "—")}</td>

              <td>${esc(t.item?.code || t.code || "—")}</td>

              <td>${esc(t.item?.name || t.name || "—")}</td>

              <td class="${t.type === "RECEIVE" ? "green" : "red"}">
                ${esc(t.type)}
              </td>

              <td class="${t.type === "RECEIVE" ? "green" : "red"}">
                ${t.type === "RECEIVE" ? "+" : "-"}
                ${number(t.totalQuantity ?? t.quantity)}
                ${esc(t.item?.unit || t.unit || "")}
              </td>

              <td>${esc(t.createdBy?.name || "")}</td>

              <td>
                <span class="badge ${esc(t.status)}">
                  ${esc(t.status)}
                </span>
              </td>

              ${adminActions || allowDelete ? `
                <td>
                  ${
                    adminActions && t.status === "pending"
                      ? `
                        <button
                          type="button"
                          class="action good"
                          onclick="reviewTx('${t.batchId || t._id}','approve','${t.batchId ? "batch" : "single"}')">
                          Approve
                        </button>

                        <button
                          type="button"
                          class="action bad"
                          onclick="reviewTx('${t.batchId || t._id}','reject','${t.batchId ? "batch" : "single"}')">
                          Reject
                        </button>
                      `
                      : ""
                  }

                  ${
                    allowDelete && t.status === "rejected"
                      ? `
                        <button
                          type="button"
                          class="action bad"
                          onclick="deleteTransaction('${t._id}')">
                          Delete Entry
                        </button>
                      `
                      : ""
                  }

                  ${
                    !allowDelete &&
                    !(adminActions && t.status === "pending")
                      ? "—"
                      : ""
                  }
                </td>
              ` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------------- STOCK TABLE ----------------

function itemsTable(items, allowEdit = false) {
  if (!items.length) {
    return `<div class="empty">No items found.</div>`;
  }

  return `
    <div class="panel table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Code</th>
            <th>Received</th>
            <th>Dispatched</th>
            <th>Final Stock</th>
            <th>Added By</th>
            ${allowEdit ? "<th>Action</th>" : ""}
          </tr>
        </thead>

        <tbody>
          ${items.map(i => `
            <tr>
              <td>
                ${i.image ? `
                  <img class="item-img"
                    src="${esc(i.image)}"
                    alt="Item">
                ` : ""}

                ${esc(i.name)}
              </td>

              <td>${esc(i.code)}</td>

              <td class="green">+${number(i.received)}</td>

              <td class="red">-${number(i.dispatched)}</td>

              <td>
                <b>${number(i.stock)} ${esc(i.unit)}</b>
              </td>

              <td>${esc(i.createdBy?.name || "")}</td>

              ${allowEdit ? `
                <td>
                  <button class="action"
                    onclick="editItem('${i._id}')">
                    Edit
                  </button>

                  ${me?.role === "admin" ? `
                    <button class="action bad"
                      onclick="deleteItem('${i._id}')">
                      Delete
                    </button>
                  ` : ""}
                </td>
              ` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ---------------- EXCEL HELPERS ----------------

const exportColumns = [
  { key: "image", label: "IMAGE", width: 16 },
  { key: "code", label: "CODE", width: 18 },
  { key: "name", label: "NAME", width: 28 },
  { key: "received", label: "RECEIVED", width: 15 },
  { key: "dispatched", label: "DISPATCHED", width: 15 },
  { key: "stock", label: "FINAL STOCK", width: 16 },
  { key: "unit", label: "UNIT", width: 12 },
  { key: "category", label: "CATEGORY", width: 18 },
  { key: "brand", label: "BRAND", width: 18 },
  { key: "specifications", label: "SPECIFICATIONS", width: 25 },
  { key: "location", label: "LOCATION", width: 20 },
  { key: "minimumStock", label: "MINIMUM STOCK", width: 16 },
  { key: "addedBy", label: "ADDED BY", width: 22 }
];

function excelColumnLetter(number) {
  let result = "";

  while (number > 0) {
    const remainder = (number - 1) % 26;

    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }

  return result;
}

async function imageToExcelData(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Image could not be loaded.");
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement("canvas");

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();

  return canvas.toDataURL("image/png").split(",")[1];
}

// ---------------- STOCK MANAGEMENT ----------------

async function stockPage() {
  const items = await api("/items");

  stockItemsCache = items || [];

  $("#content").innerHTML = `
    <div class="section-head">
      <h2>Item Master</h2>

      <button class="action good" onclick="showItemForm()">
        + Add New Item
      </button>
    </div>

    <div class="toolbar">
      <input id="itemSearch"
        placeholder="Search code / name..."
        oninput="filterStockItems()">

      <button class="action" onclick="showExcelOptions()">
        Export Excel
      </button>
    </div>

    <div id="itemFormArea"></div>

    <div id="stockTableArea">
      ${itemsTable(items, true)}
    </div>
  `;
}

function filterStockItems() {
  const q = ($("#itemSearch")?.value || "").toLowerCase();

  const filtered = stockItemsCache.filter(i =>
    String(i.code || "").toLowerCase().includes(q) ||
    String(i.name || "").toLowerCase().includes(q)
  );

  $("#stockTableArea").innerHTML = itemsTable(filtered, true);
}

function showItemForm(item = null) {
  const editing = Boolean(item);

  $("#itemFormArea").innerHTML = `
    <div class="panel">
      <div class="section-head">
        <h3>${editing ? "Edit Item" : "Create Item"}</h3>

        <button class="action" onclick="$('#itemFormArea').innerHTML=''">
          Close
        </button>
      </div>

      <form id="itemForm" class="form-grid">
        <input name="code"
          placeholder="ITEM CODE"
          value="${esc(item?.code || "")}"
          required>

        <input name="name"
          placeholder="ITEM NAME"
          value="${esc(item?.name || "")}"
          required>

        <input name="unit"
          placeholder="UNIT (KG / PCS / BAG)"
          value="${esc(item?.unit || "KG")}"
          required>

        <input name="category"
          placeholder="CATEGORY"
          value="${esc(item?.category || "")}">

        <input name="brand"
          placeholder="BRAND"
          value="${esc(item?.brand || "")}">

        <input name="location"
          placeholder="LOCATION"
          value="${esc(item?.location || "")}">

        <input name="minimumStock"
          type="number"
          min="0"
          step="any"
          placeholder="MINIMUM STOCK"
          value="${esc(item?.minimumStock ?? 0)}">

        <input name="image"
          type="file"
          accept="image/*">

        <textarea name="specifications"
          placeholder="SPECIFICATIONS">${esc(item?.specifications || "")}</textarea>

        <button class="action good" type="submit">
          ${editing ? "Update Item" : "Save Item"}
        </button>
      </form>
    </div>
  `;

  $("#itemForm").onsubmit = async e => {
    e.preventDefault();

    try {
      if (editing) {
        await fileForm(
          e.target,
          `/items/${item._id}`,
          "PATCH"
        );
      } else {
        await fileForm(e.target, "/items");
      }

      toast(editing ? "Item updated." : "Item created.");

      stockPage();

    } catch (error) {
      toast(error.message);
    }
  };
}

async function editItem(id) {
  try {
    const item = stockItemsCache.find(i =>
      String(i._id) === String(id)
    );

    if (!item) {
      toast("Item not found.");
      return;
    }

    showItemForm(item);

    $("#itemFormArea").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  } catch (error) {
    toast(error.message);
  }
}

async function deleteItem(id) {
  if (!confirm("Are you sure you want to delete this item?")) return;

  try {
    await api(`/items/${id}`, {
      method: "DELETE"
    });

    toast("Item deleted.");
    stockPage();

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- LOW STOCK ----------------

async function lowStockPage() {
  const items = await api("/items");

  const low = items.filter(i =>
    number(i.minimumStock) > 0 &&
    number(i.stock) <= number(i.minimumStock)
  );

  $("#content").innerHTML = `
    <div class="section-head">
      <h2>Low Stock Items</h2>

      <button class="action" onclick="navigate('stock')">
        Open Item Master
      </button>
    </div>

    ${itemsTable(low, true)}
  `;
}

// ---------------- EXCEL EXPORT ----------------

function showExcelOptions() {
  const old = $("#excelOptions");

  if (old) old.remove();

  const panel = document.createElement("div");

  panel.id = "excelOptions";
  panel.className = "panel";

  panel.innerHTML = `
    <h3>Select Excel Columns</h3>

    <div class="form-grid">
      ${exportColumns.map(c => `
        <label>
          <input type="checkbox"
            class="excel-column"
            value="${c.key}"
            checked>
          ${c.label}
        </label>
      `).join("")}
    </div>

    <button class="action good" onclick="exportStockExcel()">
      Download Excel
    </button>
  `;

  $("#content").prepend(panel);
}

async function exportStockExcel() {
  try {
    if (!window.XLSX) {
      throw new Error("Excel library is not loaded in HTML.");
    }

    const selected = [
      ...document.querySelectorAll(".excel-column:checked")
    ].map(x => x.value);

    if (!selected.length) {
      throw new Error("Select at least one column.");
    }

    const items = await api("/items");

    const columns = exportColumns.filter(c =>
      selected.includes(c.key)
    );

    const rows = items.map(item => {
      const row = {};

      columns.forEach(c => {
        if (c.key === "addedBy") {
          row[c.label] = item.createdBy?.name || "";
        } else {
          row[c.label] = item[c.key] ?? "";
        }
      });

      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    ws["!cols"] = columns.map(c => ({
      wch: c.width
    }));

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      ws,
      "Stock Register"
    );

    XLSX.writeFile(
      wb,
      `JW-ST-Stock-${new Date().toISOString().slice(0, 10)}.xlsx`
    );

    toast("Excel downloaded.");

  } catch (error) {
    toast(error.message);
  }
}

async function exportItemHistory(itemId) {
  try {
    if (!window.XLSX) {
      throw new Error("Excel library is not loaded in HTML.");
    }

    const rows = await api(
      `/transactions?itemId=${encodeURIComponent(itemId)}`
    );

    const sorted = sortNewest(rows);

    const data = sorted.map(t => ({
      DATE: fmtDate(t.createdAt),
      INVOICE: t.invoiceNumber || "",
      CODE: t.item?.code || "",
      NAME: t.item?.name || "",
      TYPE: t.type,
      QNT: t.qnt ?? "",
      BAGS: t.bags ?? "",
      "BAG PR KG": t.bagPerKg ?? "",
      "TOTAL KG": t.totalKg ?? "",
      "TOTAL QNT": t.totalQuantity ?? t.quantity ?? "",
      STATUS: t.status,
      USER: t.createdBy?.name || ""
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Item History");

    XLSX.writeFile(wb, `JW-ST-Item-History-${itemId}.xlsx`);

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- INVOICE HELPERS ----------------

function invoiceRows() {
  return [...document.querySelectorAll(".invoice-row")];
}

function invoicePayload() {
  const rows = invoiceRows();

  return {
    type: $("#invoiceType")?.value || "RECEIVE",

    invoiceNumber: $("#invoiceNumber")?.value || "",

    // FIX: Backend expects invoiceDate
    invoiceDate: $("#invoiceDate")?.value || "",

    note: $("#invoiceNote")?.value || "",

    items: rows.map(row => ({
      itemId: row.querySelector(".invoice-item-id")?.value || null,

      code: row.querySelector(".invoice-code")?.value || "",

      name: row.querySelector(".invoice-name")?.value || "",

      qnt: row.querySelector(".invoice-qnt")?.value ?? "",

      bags: row.querySelector(".invoice-bags")?.value ?? "",

      bagPerKg: row.querySelector(".invoice-bag-kg")?.value ?? "",

      totalQuantity:
        row.querySelector(".invoice-total-qnt")?.value ?? "",

      totalKg:
        row.querySelector(".invoice-total-kg")?.value ?? "",

      manualTotalQuantity:
        row.querySelector(".invoice-total-qnt")?.dataset.manual === "true",

      manualTotalKg:
        row.querySelector(".invoice-total-kg")?.dataset.manual === "true"
    }))
  };
}

function calculateInvoiceRow(row) {
  const qnt = number(
    row.querySelector(".invoice-qnt")?.value
  );

  const bags = number(
    row.querySelector(".invoice-bags")?.value
  );

  const bagKg = number(
    row.querySelector(".invoice-bag-kg")?.value
  );

  const totalQnt = row.querySelector(".invoice-total-qnt");
  const totalKg = row.querySelector(".invoice-total-kg");

  if (totalQnt && totalQnt.dataset.manual !== "true") {
    totalQnt.value = qnt && bags ? qnt * bags : "";
  }

  if (totalKg && totalKg.dataset.manual !== "true") {
    totalKg.value = bags ? bags * bagKg : "";
  }

  updateInvoiceGrandTotal();
}

function updateInvoiceTotal() {
  invoiceRows().forEach(calculateInvoiceRow);
}

function updateInvoiceGrandTotal() {
  const rows = invoiceRows();

  const totalQnt = rows.reduce((sum, row) =>
    sum + number(
      row.querySelector(".invoice-total-qnt")?.value
    ), 0
  );

  const totalKg = rows.reduce((sum, row) =>
    sum + number(
      row.querySelector(".invoice-total-kg")?.value
    ), 0
  );

  const qntEl = $("#invoiceGrandQnt");
  const kgEl = $("#invoiceGrandKg");

  if (qntEl) {
    qntEl.textContent = totalQnt.toLocaleString();
  }

  if (kgEl) {
    kgEl.textContent = totalKg.toLocaleString();
  }
}

function resetManualTotal(input) {
  if (!input) return;

  input.dataset.manual = "false";

  const row = input.closest(".invoice-row");

  if (row) {
    calculateInvoiceRow(row);
  }

  scheduleDraftSave();
}

function addInvoiceItemRow(data = {}) {
  const container = document.getElementById("invoiceItems");

  if (!container) {
    console.error("Missing HTML element: #invoiceItems");
    return;
  }

  const row = document.createElement("div");
  row.className = "invoice-row";

  const selectedItem = stockItemsCache.find(i =>
    String(i._id) === String(data.itemId || "") ||
    String(i.code || "").toLowerCase() ===
      String(data.code || "").toLowerCase()
  );

  row.innerHTML = `
    <input type="hidden"
      class="invoice-item-id"
      value="${esc(selectedItem?._id || data.itemId || "")}">

    <div class="invoice-field">
      <label>IMAGE</label>
      <div class="invoice-image-preview">
        ${selectedItem?.image || data.image
          ? `<img src="${esc(selectedItem?.image || data.image)}" alt="Item">`
          : "No Image"}
      </div>
    </div>

    <div class="invoice-field">
      <label>CODE</label>
      <input class="invoice-code"
        list="itemCodeOptions"
        value="${esc(data.code || selectedItem?.code || "")}"
        placeholder="CODE">
    </div>

    <div class="invoice-field">
      <label>NAME</label>
      <input class="invoice-name"
        value="${esc(data.name || selectedItem?.name || "")}"
        placeholder="NAME">
    </div>

    <div class="invoice-field">
      <label>QNT</label>
      <input class="invoice-qnt"
        type="number" min="1" step="1"
        value="${esc(data.qnt ?? "")}"
        placeholder="QNT">
    </div>

    <div class="invoice-field">
      <label>BAGS</label>
      <input class="invoice-bags"
        type="number" min="1" step="1"
        value="${esc(data.bags ?? "")}"
        placeholder="BAGS">
    </div>

    <div class="invoice-field">
      <label>BAG PR KG</label>
      <input class="invoice-bag-kg"
        type="number" min="0" step="any"
        value="${esc(data.bagPerKg ?? "")}"
        placeholder="BAG PR KG">
    </div>

    <div class="invoice-field">
      <label>TOT. K.G.</label>
      <input class="invoice-total-kg"
        type="number" min="0" step="any"
        value="${esc(data.totalKg ?? "")}"
        data-manual="${data.manualTotalKg ? "true" : "false"}"
        placeholder="TOTAL KG">

      <button type="button" class="action"
        onclick="resetManualTotal(this.closest('.invoice-field').querySelector('.invoice-total-kg'))">
        Auto
      </button>
    </div>

    <div class="invoice-field">
      <label>TOT. QNT</label>
      <input class="invoice-total-qnt"
        type="number" min="1" step="1"
        value="${esc(data.totalQuantity ?? data.quantity ?? "")}"
        data-manual="${data.manualTotalQuantity ? "true" : "false"}"
        placeholder="TOTAL QNT">

      <button type="button" class="action"
        onclick="resetManualTotal(this.closest('.invoice-field').querySelector('.invoice-total-qnt'))">
        Auto
      </button>
    </div>

    <button type="button" class="action bad remove-invoice-row">
      Remove
    </button>
  `;

  container.appendChild(row);

  const codeInput = row.querySelector(".invoice-code");
  const itemIdInput = row.querySelector(".invoice-item-id");
  const nameInput = row.querySelector(".invoice-name");
  const preview = row.querySelector(".invoice-image-preview");

  // Confirm all required elements exist before attaching events.
  if (!codeInput || !itemIdInput || !nameInput || !preview) {
    console.error("Invoice row HTML is incomplete:", row.innerHTML);
    row.remove();
    toast("Invoice row could not be created. Check invoice HTML.");
    return;
  }

  // Remove row
  row.querySelector(".remove-invoice-row").addEventListener("click", () => {
    row.remove();
    updateInvoiceGrandTotal();
    scheduleDraftSave();
  });

  // Enter key navigation
  row.querySelectorAll("input:not([type=hidden])").forEach((input, index, inputs) => {
    input.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;

      e.preventDefault();

      if (index < inputs.length - 1) {
        inputs[index + 1].focus();
      } else {
        addInvoiceRow();
        const nextRow = invoiceRows().at(-1);
        nextRow?.querySelector(".invoice-code")?.focus();
      }
    });
  });

  // Item code selection
  codeInput.addEventListener("change", () => {
    const code = codeInput.value.trim().toLowerCase();

    const item = stockItemsCache.find(i =>
      String(i.code || "").toLowerCase() === code
    );

    if (!item) {
      itemIdInput.value = "";
      nameInput.value = "";
      preview.textContent = "No Image";
      scheduleDraftSave();
      return;
    }

    itemIdInput.value = item._id;
    nameInput.value = item.name || "";

    preview.innerHTML = item.image
      ? `<img src="${esc(item.image)}" alt="Item">`
      : "No Image";

    scheduleDraftSave();
  });

  // Calculations and autosave
  row.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", () => {
      if (
        input.classList.contains("invoice-total-qnt") ||
        input.classList.contains("invoice-total-kg")
      ) {
        input.dataset.manual = "true";
        updateInvoiceGrandTotal();
      } else {
        calculateInvoiceRow(row);
      }

      scheduleDraftSave();
    });

    input.addEventListener("change", scheduleDraftSave);
  });

  calculateInvoiceRow(row);
  updateInvoiceGrandTotal();
}


function removeInvoiceRow(button) {
  const row = button.closest(".invoice-row");

  if (row) {
    row.remove();
  }

  updateInvoiceGrandTotal();
  scheduleDraftSave();
}

// ---------------- DRAFT MANAGEMENT ----------------

function scheduleDraftSave() {
  if (isLoadingDraft || currentPage !== "transactions") {
    return;
  }

  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
  }

  setDraftStatus("Unsaved changes...");

  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;

    saveDraft(false).catch(error => {
      console.error("Draft autosave error:", error);
    });

  }, 800);
}

/*
  Reliable save queue:
  - One save request at a time.
  - If changes happen during saving, another save runs.
  - flushDraftSave waits for all queued saves.
*/

async function saveDraft(showMessage = true) {
  if (isLoadingDraft || currentPage !== "transactions") {
    return;
  }

  const form = $("#invoiceForm");

  if (!form) return;

  if (!invoiceRows().length) {
    if (showMessage) {
      toast("Add at least one invoice row.");
    }

    return;
  }

  if (draftSaving) {
    draftSaveQueued = true;

    if (draftSavePromise) {
      await draftSavePromise;
    }

    return;
  }

  draftSaving = true;

  draftSavePromise = (async () => {

    let shouldReloadList = false;

    try {
      do {
        draftSaveQueued = false;

        const payload = invoicePayload();

        setDraftStatus("Saving draft...");

        const wasNewDraft = !currentDraftId;

        const result = currentDraftId
          ? await api(`/drafts/${currentDraftId}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            })
          : await api("/drafts", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            });

        const savedId =
          result.draft?._id ||
          result._id ||
          currentDraftId;

        if (savedId) {
          currentDraftId = savedId;
        }

        if (wasNewDraft) {
          shouldReloadList = true;
        }

        setDraftStatus(
          "Draft saved · " +
          new Date().toLocaleTimeString()
        );

      } while (draftSaveQueued);

      if (showMessage) {
        toast("Draft saved.");
      }

    } catch (error) {
      setDraftStatus("Draft save failed", true);

      if (showMessage) {
        toast(error.message);
      }

      throw error;

    } finally {
      draftSaving = false;
      draftSaveQueued = false;
      draftSavePromise = null;
    }

    // Only reload list when a new draft is created.
    if (
      shouldReloadList &&
      currentPage === "transactions"
    ) {
      await loadDraftList();
    }

  })();

  return draftSavePromise;
}

async function flushDraftSave() {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }

  if (
    !$("#invoiceForm") ||
    currentPage !== "transactions"
  ) {
    return;
  }

  if (draftSaving && draftSavePromise) {
    await draftSavePromise;

    if (draftSaveQueued) {
      await saveDraft(false);
    }

    return;
  }

  await saveDraft(false);
}

// ---------------- LOAD DRAFT LIST ----------------

async function loadDraftList() {
  const area = $("#draftList");

  if (!area) return;

  try {
    const drafts = await api("/drafts");

    // Prevent old response from updating a different page.
    if (!$("#draftList")) return;

    if (!drafts.length) {
      area.innerHTML = `
        <div class="empty">
          No saved drafts.
        </div>
      `;

      return;
    }

    area.innerHTML = `
      <div class="draft-list">

        ${sortNewest(drafts).map(d => `
          <div class="draft-card">

            <div>
              <b>
                ${esc(d.invoiceNumber || "Untitled Draft")}
              </b>

              <small>
                ${esc(d.type)} · ${fmtDate(d.updatedAt)}
              </small>
            </div>

            <button class="action"
              onclick="openDraft('${d._id}')">
              Open
            </button>

            <button class="action bad"
              onclick="deleteDraft('${d._id}')">
              Delete
            </button>

          </div>
        `).join("")}

      </div>
    `;

  } catch (error) {
    area.innerHTML = `
      <div class="empty">
        ${esc(error.message)}
      </div>
    `;
  }
}

// ---------------- OPEN DRAFT ----------------

async function openDraft(id) {
  try {

    // Save the current draft before switching.
    if (
      currentDraftId &&
      String(currentDraftId) !== String(id) &&
      $("#invoiceForm")
    ) {
      await flushDraftSave();
    }

    const result = await api(`/drafts/${id}`);

    const draft = result.draft || result;

    isLoadingDraft = true;

    currentDraftId = draft._id;

    $("#invoiceType").value =
      draft.type || "RECEIVE";

    $("#invoiceNumber").value =
      draft.invoiceNumber || "";

    // FIX: Read invoiceDate, with old date fallback.
    const savedDate = draft.invoiceDate || draft.date;

    $("#invoiceDate").value = savedDate
      ? String(savedDate).slice(0, 10)
      : "";

    $("#invoiceNote").value =
      draft.note || "";

    $("#invoiceItems").innerHTML = "";

    (draft.items || []).forEach(item => {
      addInvoiceItemRow(item);
    });

    if (!draft.items?.length) {
      addInvoiceItemRow();
    }

    updateInvoiceGrandTotal();

    isLoadingDraft = false;

    setDraftStatus("Draft loaded.");

    toast("Draft opened.");

  } catch (error) {

    isLoadingDraft = false;

    toast(error.message);
  }
}

// ---------------- DELETE DRAFT ----------------

async function deleteDraft(id) {
  if (!confirm("Delete this saved draft?")) {
    return;
  }

  try {
    await api(`/drafts/${id}`, {
      method: "DELETE"
    });

    if (
      String(currentDraftId) === String(id)
    ) {
      currentDraftId = null;

      setDraftStatus("New invoice");
    }

    toast("Draft deleted.");

    await loadDraftList();

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- CLEAR INVOICE FORM ----------------

function clearInvoiceForm() {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }

  $("#invoiceForm")?.reset();

  $("#invoiceItems").innerHTML = "";

  currentDraftId = null;

  addInvoiceRow();

  updateInvoiceGrandTotal();

  setDraftStatus("New invoice");
}

// ---------------- INVOICE ROW ALIAS ----------------

function addInvoiceRow(data = {}) {
  addInvoiceItemRow(data);
}

// ---------------- INVOICE PAGE ----------------

async function transactionsPage() {
  const [items, transactions] = await Promise.all([
    api("/items"),
    api("/transactions")
  ]);

  stockItemsCache = items || [];

  const today = new Date().toISOString().slice(0, 10);

  $("#content").innerHTML = `
    <div class="section-head">
      <h2>New Invoice Entry</h2>

      <span id="draftStatus" class="draft-status">
        New invoice
      </span>
    </div>

    <div class="panel">
      <form id="invoiceForm">

        <div class="form-grid">

          <div>
            <label>TRANSACTION TYPE</label>

            <select id="invoiceType" name="type">
              <option value="RECEIVE">RECEIVE</option>
              <option value="DISPATCH">DISPATCH</option>
            </select>
          </div>

          <div>
            <label>INVOICE NUMBER</label>

            <input id="invoiceNumber"
              name="invoiceNumber"
              placeholder="Invoice Number">
          </div>

          <div>
            <label>DATE</label>

            <input id="invoiceDate"
              name="invoiceDate"
              type="date"
              value="${today}">
          </div>

          <div>
            <label>NOTE</label>

            <input id="invoiceNote"
              name="note"
              placeholder="Remarks">
          </div>

          <div>
            <label>INVOICE ATTACHMENT</label>

            <input id="invoiceAttachment"
              name="image"
              type="file"
              accept="image/*">
          </div>

        </div>

        <datalist id="itemCodeOptions">
          ${items.map(i => `
            <option value="${esc(i.code)}">
              ${esc(i.name)}
            </option>
          `).join("")}
        </datalist>

        <div class="section-head">
          <h3>Invoice Items</h3>

          <button type="button"
            class="action"
            onclick="addInvoiceRow()">
            + Add Row
          </button>
        </div>

        <div id="invoiceItems"></div>

        <div class="invoice-grand-total">
          <b>
            Total Quantity:
            <span id="invoiceGrandQnt">0</span>
          </b>

          <b>
            Total KG:
            <span id="invoiceGrandKg">0</span>
          </b>
        </div>

        <div class="toolbar">

          <button type="button"
            class="action"
            onclick="saveDraft(true)">
            Save Draft
          </button>

          <button type="button"
            class="action"
            onclick="clearInvoiceForm()">
            New Invoice
          </button>

          <button type="submit"
            class="action good">
            Submit Invoice
          </button>

        </div>

      </form>
    </div>

    <div class="panel">
      <div class="section-head">
        <h3>Saved Drafts</h3>

        <button class="action"
          onclick="loadDraftList()">
          Refresh
        </button>
      </div>

      <div id="draftList">
        Loading drafts...
      </div>
    </div>

    <div class="section-head">
      <h2>Transaction History</h2>
    </div>

    <div class="toolbar">

      <input id="transactionSearch"
        placeholder="Search invoice / item / code..."
        oninput="filterTransactionHistory()">

      <select id="transactionFilter"
        onchange="filterTransactionHistory()">

        <option value="ALL">
          All Transactions
        </option>

        <option value="RECEIVE">
          RECEIVE
        </option>

        <option value="DISPATCH">
          DISPATCH
        </option>

        <option value="pending">
          Pending
        </option>

        <option value="approved">
          Approved
        </option>

        <option value="rejected">
          Rejected
        </option>

      </select>

    </div>

    <div id="transactionHistory"></div>
  `;

  addInvoiceRow();

  transactionGroupsCache = transactions || [];

  const invoiceForm = $("#invoiceForm");

  invoiceForm.addEventListener(
    "input",
    scheduleDraftSave
  );

  invoiceForm.addEventListener(
    "change",
    scheduleDraftSave
  );

  invoiceForm.onsubmit = submitInvoice;

  // Prevent accidental submission when pressing Enter.
  invoiceForm.addEventListener("keydown", e => {

    if (
      e.key !== "Enter" ||
      e.defaultPrevented
    ) {
      return;
    }

    const target = e.target;

    if (
      target.matches(
        'input:not([type="file"]):not([type="hidden"]), select'
      )
    ) {
      e.preventDefault();

      if (!target.closest(".invoice-row")) {
        $("#invoiceItems .invoice-code")?.focus();
      }
    }
  });

  $("#invoiceType").addEventListener(
    "change",
    scheduleDraftSave
  );

  $("#invoiceNumber").addEventListener(
    "input",
    scheduleDraftSave
  );

  $("#invoiceDate").addEventListener(
    "change",
    scheduleDraftSave
  );

  $("#invoiceNote").addEventListener(
    "input",
    scheduleDraftSave
  );

  renderTransactionHistory(transactionGroupsCache);

  await loadDraftList();
}

// ---------------- INVOICE VALIDATION ----------------

function validateInvoice() {
  const rows = invoiceRows();

  if (!rows.length) {
    throw new Error("Add at least one item.");
  }

  const entries = [];

  rows.forEach((row, index) => {

    const itemId =
      row.querySelector(".invoice-item-id").value;

    const item = stockItemsCache.find(i =>
      String(i._id) === String(itemId)
    );

    if (!item) {
      throw new Error(
        `Row ${index + 1}: Select a valid Item Master item.`
      );
    }

    const qnt = Number(
      row.querySelector(".invoice-qnt").value
    );

    const bags = Number(
      row.querySelector(".invoice-bags").value
    );

    const bagPerKg = Number(
      row.querySelector(".invoice-bag-kg").value || 0
    );

    const totalQuantityInput =
      row.querySelector(".invoice-total-qnt");

    const totalKgInput =
      row.querySelector(".invoice-total-kg");

    const totalQuantity =
      Number(totalQuantityInput.value);

    const totalKg =
      Number(totalKgInput.value);

    if (!Number.isInteger(qnt) || qnt < 1) {
      throw new Error(
        `Row ${index + 1}: QNT must be a positive whole number.`
      );
    }

    if (!Number.isInteger(bags) || bags < 1) {
      throw new Error(
        `Row ${index + 1}: BAGS must be a positive whole number.`
      );
    }

    if (
      !Number.isFinite(bagPerKg) ||
      bagPerKg < 0
    ) {
      throw new Error(
        `Row ${index + 1}: BAG PR KG cannot be negative.`
      );
    }

    if (
      !Number.isInteger(totalQuantity) ||
      totalQuantity < 1
    ) {
      throw new Error(
        `Row ${index + 1}: TOT.QNT must be a positive whole number.`
      );
    }

    if (
      !Number.isFinite(totalKg) ||
      totalKg < 0
    ) {
      throw new Error(
        `Row ${index + 1}: TOT.KG must be zero or greater.`
      );
    }

    entries.push({
      itemId,

      code: item.code,

      name: item.name,

      qnt,

      bags,

      bagPerKg,

      totalQuantity,

      totalKg,

      manualTotalQuantity:
        totalQuantityInput.dataset.manual === "true",

      manualTotalKg:
        totalKgInput.dataset.manual === "true"
    });
  });

  return entries;
}

// ---------------- SUBMIT INVOICE ----------------

let invoiceSubmitting = false;

async function submitInvoice(e) {
  e.preventDefault();

  if (invoiceSubmitting) {
    return;
  }

  const button = e.target.querySelector(
    'button[type="submit"]'
  );

  invoiceSubmitting = true;

  try {

    if (button) {
      button.disabled = true;
      button.textContent = "Submitting...";
    }

    // Finish pending draft saves first.
    await flushDraftSave();

    const entries = validateInvoice();

    const formData = new FormData();

    formData.append(
      "type",
      $("#invoiceType").value
    );

    formData.append(
      "invoiceNumber",
      $("#invoiceNumber").value
    );

    // FIX: Backend expects invoiceDate, not date.
    formData.append(
      "invoiceDate",
      $("#invoiceDate").value
    );

    formData.append(
      "note",
      $("#invoiceNote").value
    );

    formData.append(
      "items",
      JSON.stringify(entries)
    );

    if (currentDraftId) {
      formData.append(
        "draftId",
        currentDraftId
      );
    }

    const attachment =
      $("#invoiceAttachment").files[0];

    if (attachment) {
      formData.append("image", attachment);
    }

    const response = await fetch(
      "/api/transactions",
      {
        method: "POST",
        credentials: "same-origin",
        body: formData
      }
    );

    const data = await response.json().catch(
      () => ({})
    );

    if (!response.ok) {
      throw new Error(
        data.message || "Invoice submission failed."
      );
    }

    resetDraftState();

    toast(
      "Invoice submitted successfully. Awaiting approval."
    );

    await transactionsPage();

  } catch (error) {

    toast(error.message);

  } finally {

    invoiceSubmitting = false;

    if (button) {
      button.disabled = false;
      button.textContent = "Submit Invoice";
    }
  }
}

// ---------------- INVOICE GROUPING ----------------

function groupTransactionsByInvoice(rows) {
  const groups = new Map();

  sortNewest(rows).forEach(tx => {

    const key = tx.batchId
      ? `batch-${tx.batchId}`
      : tx.invoiceNumber
        ? `invoice-${tx.invoiceNumber}-${tx.createdBy?._id || tx.createdBy || ""}-${tx.type}`
        : `single-${tx._id}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,

        batchId: tx.batchId || "",

        invoiceNumber:
          tx.invoiceNumber || "No Invoice Number",

        date: tx.invoiceDate || tx.date || tx.createdAt,

        createdAt: tx.createdAt,

        type: tx.type,

        status: tx.status,

        createdBy: tx.createdBy?.name || "",

        rows: []
      });
    }

    groups.get(key).rows.push(tx);
  });

  return [...groups.values()].sort((a, b) =>
    new Date(b.createdAt || 0) -
    new Date(a.createdAt || 0)
  );
}

// ---------------- RENDER INVOICE GROUPS ----------------

function renderInvoiceGroups(rows) {
  const groups = groupTransactionsByInvoice(rows);

  if (!groups.length) {
    return `
      <div class="empty">
        No invoices found.
      </div>
    `;
  }

  return `
    <div class="invoice-groups">

      ${groups.map((group, index) => `
        <details class="panel invoice-group"
          ${index === 0 ? "open" : ""}>

          <summary>
            <div class="invoice-group-heading">

              <b>
                ${esc(group.invoiceNumber)}
              </b>

              <span class="${
                group.type === "RECEIVE"
                  ? "green"
                  : "red"
              }">
                ${esc(group.type)}
              </span>

              <span class="badge ${esc(group.status)}">
                ${esc(group.status)}
              </span>

              <small>
                ${fmtDate(group.createdAt)}
              </small>

              <small>
                ${group.rows.length} item(s)
              </small>

            </div>
          </summary>

          <div class="invoice-group-body">

            <p>
              User: ${esc(group.createdBy || "—")}
            </p>

            ${txTable(group.rows, false, true)}

          </div>

        </details>
      `).join("")}

    </div>
  `;
}

// ---------------- TRANSACTION HISTORY FILTER ----------------

function filterTransactionHistory() {
  const search = (
    $("#transactionSearch")?.value || ""
  ).toLowerCase();

  const filter =
    $("#transactionFilter")?.value || "ALL";

  let rows = [...transactionGroupsCache];

  if (
    filter === "RECEIVE" ||
    filter === "DISPATCH"
  ) {
    rows = rows.filter(t =>
      t.type === filter
    );

  } else if (filter !== "ALL") {

    rows = rows.filter(t =>
      t.status === filter
    );
  }

  if (search) {

    rows = rows.filter(t => {

      const item = t.item || {};

      return [
        t.invoiceNumber,
        item.code,
        item.name,
        t.type,
        t.status,
        t.createdBy?.name
      ].some(v =>
        String(v || "")
          .toLowerCase()
          .includes(search)
      );
    });
  }

  renderTransactionHistory(rows);
}

function renderTransactionHistory(rows) {
  const area = $("#transactionHistory");

  if (area) {
    area.innerHTML = renderInvoiceGroups(rows);
  }
}

// ---------------- APPROVALS PAGE ----------------

// ---------------- APPROVALS PAGE ----------------

async function approvalsPage() {
  try {
    const rows = await api("/transactions");

    const pending = (rows || []).filter(tx =>
      tx.status === "pending"
    );

    const groups = groupTransactionsByInvoice(pending);

    $("#content").innerHTML = `
      <div class="section-head">
        <h2>Pending Approvals</h2>

        <button
          type="button"
          class="action"
          onclick="approvalsPage()">
          Refresh
        </button>
      </div>

      <div id="approvalList">

        ${
          groups.length
            ? groups.map(group => `
              <div class="panel">

                <div class="section-head">

                  <div>
                    <h3>
                      ${esc(group.invoiceNumber)}
                    </h3>

                    <small>
                      ${fmtDate(group.createdAt)}
                    </small>

                    <small>
                      ${esc(group.type)}
                    </small>

                    <small>
                      User: ${esc(group.createdBy || "—")}
                    </small>
                  </div>

                  <div class="toolbar">

                    <button
                      type="button"
                      class="action good"
                      onclick="reviewTx('${esc(group.batchId || group.rows[0]._id)}','approve','${group.batchId ? "batch" : "single"}')">
                      Approve All
                    </button>

                    <button
                      type="button"
                      class="action bad"
                      onclick="reviewTx('${esc(group.batchId || group.rows[0]._id)}','reject','${group.batchId ? "batch" : "single"}')">
                      Reject All
                    </button>

                  </div>

                </div>

                ${txTable(group.rows, true, false)}

              </div>
            `).join("")

            : `
              <div class="empty">
                No pending approvals.
              </div>
            `
        }

      </div>
    `;

  } catch (error) {
    console.error("Approvals page error:", error);

    $("#content").innerHTML = `
      <div class="panel">
        <h3>Unable to load approvals</h3>
        <p>${esc(error.message)}</p>

        <button
          type="button"
          class="action"
          onclick="approvalsPage()">
          Try Again
        </button>
      </div>
    `;
  }
}

// ---------------- REVIEW TRANSACTION ----------------

async function reviewTx(id, action, mode = "single") {
  if (!["approve", "reject"].includes(action)) {
    return;
  }

  let reason = "";

  if (action === "reject") {
    reason = prompt("Enter rejection reason:");

    if (reason === null) {
      return;
    }

    reason = reason.trim();

    if (!reason) {
      toast("Rejection reason is required.");
      return;
    }
  }

  const actionLabel =
    action === "approve" ? "approve" : "reject";

  if (!confirm(`Are you sure you want to ${actionLabel} this transaction?`)) {
    return;
  }

  try {
    const endpoint = mode === "batch"
      ? `/transactions/batch/${encodeURIComponent(id)}/review`
      : `/transactions/${encodeURIComponent(id)}/review`;

    // FIX: Backend expects decision and reason.
    await api(endpoint, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        decision: action,
        reason
      })
    });

    toast(
      action === "approve"
        ? "Transaction approved successfully."
        : "Transaction rejected successfully."
    );

    if (currentPage === "approvals") {
      await approvalsPage();
    } else if (currentPage === "transactions") {
      await transactionsPage();
    } else {
      await dashboard();
    }

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- DELETE TRANSACTION ----------------

async function deleteTransaction(id) {
  if (!confirm("Delete this transaction?")) {
    return;
  }

  try {
    await api(`/transactions/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    toast("Transaction deleted successfully.");

    if (currentPage === "transactions") {
      await transactionsPage();
    } else if (currentPage === "approvals") {
      await approvalsPage();
    } else {
      await dashboard();
    }

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- USER MANAGEMENT ----------------

async function usersPage() {
  const users = await api("/admin/users");

  $("#content").innerHTML = `
    <div class="section-head">
      <h2>User Management</h2>

      <button class="action"
        onclick="usersPage()">
        Refresh
      </button>
    </div>

    <div class="panel">
      <div class="table-wrap">

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${
              (users || []).map(user => `
                <tr>
                  <td>${esc(user.name)}</td>

                  <td>${esc(user.username)}</td>

                  <td>${esc(user.role)}</td>

                  <td>
                    <span class="badge ${esc(user.status)}">
                      ${esc(user.status)}
                    </span>
                  </td>

                  <td>
                    ${fmtDate(user.createdAt)}
                  </td>

                  <td>
                    ${
                      user.role !== "admin"
                        ? `
                          <div class="toolbar">

                            ${
                              user.status !== "approved"
                                ? `
                                  <button class="action good"
                                    onclick="userReview('${esc(user._id)}','approved')">
                                    Approve
                                  </button>
                                `
                                : ""
                            }

                            ${
                              user.status !== "rejected"
                                ? `
                                  <button class="action danger"
                                    onclick="userReview('${esc(user._id)}','rejected')">
                                    Reject
                                  </button>
                                `
                                : ""
                            }

                          </div>
                        `
                        : "Admin"
                    }
                  </td>
                </tr>
              `).join("")
            }

            ${
              !users?.length
                ? `
                  <tr>
                    <td colspan="6">
                      No users found.
                    </td>
                  </tr>
                `
                : ""
            }
          </tbody>
        </table>

      </div>
    </div>
  `;
}

// ---------------- APPROVE / REJECT USER ----------------

async function userReview(id, status) {
  if (!["approved", "rejected"].includes(status)) {
    return;
  }

  const label =
    status === "approved" ? "approve" : "reject";

  if (!confirm(`Are you sure you want to ${label} this user?`)) {
    return;
  }

  try {
    await api(`/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        status
      })
    });

    toast(
      status === "approved"
        ? "User approved successfully."
        : "User rejected successfully."
    );

    await usersPage();

  } catch (error) {
    toast(error.message);
  }
}

// ---------------- TEAM CHAT ----------------

let chatLoading = false;

async function chatPage() {
  clearInterval(chatTimer);
  chatTimer = null;

  $("#content").innerHTML = `
    <div class="section-head">
      <h2>Team Chat</h2>
    </div>

    <div class="panel chat-panel">

      <div id="messages" class="messages">
        Loading messages...
      </div>

      <form id="chatForm" class="chat-form">

        <input
          id="chatMessage"
          name="message"
          placeholder="Type your message..."
          autocomplete="off">

        <input
          id="chatImage"
          name="image"
          type="file"
          accept="image/*">

        <button type="submit"
          class="action good">
          Send
        </button>

      </form>

    </div>
  `;

  $("#chatForm").onsubmit = sendChatMessage;

  await loadChatMessages();

  chatTimer = setInterval(() => {
    if (currentPage === "chat") {
      loadChatMessages();
    }
  }, 5000);
}

// ---------------- LOAD CHAT MESSAGES ----------------

async function loadChatMessages() {
  const area = $("#messages");

  if (!area || chatLoading) {
    return;
  }

  chatLoading = true;

  try {
    const wasNearBottom =
      area.scrollHeight - area.scrollTop - area.clientHeight < 100;

    const messages = await api("/chat");

    if (!$("#messages")) {
      return;
    }

    $("#messages").innerHTML = (messages || []).map(message => {
      const sender = message.sender || message.user || {};

      const senderId =
        sender._id || sender.id || message.senderId || "";

      const ownMessage =
        String(senderId) === String(me?._id || me?.id || "");

      const messageText =
        message.message || message.text || "";

      const imageUrl =
        message.image ||
        message.imageUrl ||
        "";

      return `
        <div class="message ${ownMessage ? "own" : ""}">

          <div class="message-meta">
            <b>${esc(sender.name || message.senderName || "User")}</b>

            <small>
              ${fmtDate(message.createdAt)}
            </small>
          </div>

          ${
            messageText
              ? `<div class="message-text">${esc(messageText)}</div>`
              : ""
          }

          ${
            imageUrl
              ? `
                <a href="${esc(imageUrl)}"
                  target="_blank"
                  rel="noopener noreferrer">
                  <img
                    src="${esc(imageUrl)}"
                    class="chat-image"
                    alt="Shared image"
                    loading="lazy">
                </a>
              `
              : ""
          }

        </div>
      `;
    }).join("") || `
      <div class="empty">
        No messages yet. Start the conversation.
      </div>
    `;

    if (wasNearBottom) {
      area.scrollTop = area.scrollHeight;
    }

  } catch (error) {
    if ($("#messages")) {
      $("#messages").innerHTML = `
        <div class="empty">
          ${esc(error.message)}
        </div>
      `;
    }

  } finally {
    chatLoading = false;
  }
}

// ---------------- SEND CHAT MESSAGE ----------------

async function sendChatMessage(e) {
  e.preventDefault();

  const form = $("#chatForm");

  if (!form) {
    return;
  }

  const messageInput = $("#chatMessage");
  const imageInput = $("#chatImage");

  const message = messageInput.value.trim();
  const image = imageInput.files[0];

  if (!message && !image) {
    toast("Enter a message or select an image.");
    return;
  }

  const button = form.querySelector(
    'button[type="submit"]'
  );

  try {
    button.disabled = true;
    button.textContent = "Sending...";

    const formData = new FormData();

    formData.append("message", message);

    if (image) {
      formData.append("image", image);
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      body: formData
    });

    const data = await response.json().catch(
      () => ({})
    );

    if (!response.ok) {
      throw new Error(
        data.message || "Message could not be sent."
      );
    }

    messageInput.value = "";
    imageInput.value = "";

    await loadChatMessages();

    const area = $("#messages");

    if (area) {
      area.scrollTop = area.scrollHeight;
    }

  } catch (error) {
    toast(error.message);

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Send";
    }
  }
}


// ---------------- PASSWORD VISIBILITY ----------------

document.addEventListener("click", function(e) {
  const button = e.target.closest(
    ".password-toggle, [data-password-toggle], [data-target]"
  );

  if (!button) return;

  let targetId =
    button.dataset.passwordToggle ||
    button.dataset.target ||
    button.getAttribute("aria-controls") ||
    "";

  targetId = targetId.replace(/^#/, "");

  let input = targetId
    ? document.getElementById(targetId)
    : null;

  // Fallback: find password input inside the same wrapper.
  if (!input) {
    const wrapper = button.closest(
      ".password-wrapper, .password-field, .input-group"
    ) || button.parentElement;

    input = wrapper?.querySelector('input[type="password"], input[type="text"]');
  }

  if (!input) {
    console.error("Password input not found for toggle button:", button);
    return;
  }

  const isHidden = input.type === "password";

  input.type = isHidden ? "text" : "password";

  button.setAttribute(
    "aria-label",
    isHidden ? "Hide password" : "Show password"
  );

  button.setAttribute(
    "title",
    isHidden ? "Hide password" : "Show password"
  );

  button.classList.toggle("password-visible", isHidden);
});


// ---------------- APPLICATION START ----------------

boot();