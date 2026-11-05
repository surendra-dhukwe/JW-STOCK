
const $ = s => document.querySelector(s);

let me = null;
let currentPage = "dashboard";
let chatTimer = null;
let stockItemsCache = [];

const api = async (url, options = {}) => {
  const res = await fetch("/api" + url, {
    credentials: "same-origin",
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
};

const fileForm = async (form, url, method = "POST") => {
  const res = await fetch("/api" + url, {
    method,
    body: new FormData(form),
    credentials: "same-origin"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Upload failed");
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
  setTimeout(() => el.style.display = "none", 3500);
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
  currentPage = page;

  if (chatTimer) {
    clearInterval(chatTimer);
    chatTimer = null;
  }

  document.querySelectorAll(".nav").forEach(b => {
    b.classList.toggle("active", b.dataset.page === page);
  });

  const titles = {
    dashboard: "Dashboard",
    stock: "Stock & Items",
    transactions: "Transactions",
    chat: "Team Chat",
    approvals: "Approvals",
    users: "User Management"
  };

  $("#pageTitle").textContent = titles[page] || "Dashboard";
  $("#pageName").textContent = page.toUpperCase();

  const pages = {
    dashboard,
    stock: stockPage,
    transactions: transactionsPage,
    chat: chatPage,
    approvals: approvalsPage,
    users: usersPage
  };

  (pages[page] || dashboard)().catch(error => {
    console.error(error);
    if (currentPage !== page) return;

    $("#content").innerHTML = `
      <div class="panel">
        <h2>Unable to load page</h2>
        <p>${esc(error.message)}</p>
        <button class="action" onclick="navigate('${page}')">Try Again</button>
      </div>
    `;
    toast(error.message);
  });
}

// Authentication

$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"], button:not([type])');

  try {
    if (button) button.disabled = true;

    const d = await api("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.target)))
    });

    me = d.user;
    e.target.reset();
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.target)))
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
    await api("/auth/logout", { method: "POST" });
    me = null;
    if (chatTimer) clearInterval(chatTimer);
    chatTimer = null;
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

function stat(label, value, sub = "") {
  return `
    <div class="stat">
      <small>${label}</small>
      <strong>${value}</strong>
      <small>${sub}</small>
    </div>
  `;
}

// Dashboard

async function dashboard() {
  const [items, tx] = await Promise.all([
    api("/items"),
    api("/transactions")
  ]);

  const pending = tx.filter(x => x.status === "pending").length;

  const receive = tx
    .filter(x => x.status === "approved" && x.type === "RECEIVE")
    .reduce((a, x) => a + number(x.quantity), 0);

  const dispatch = tx
    .filter(x => x.status === "approved" && x.type === "DISPATCH")
    .reduce((a, x) => a + number(x.quantity), 0);

  const lowStock = items.filter(i =>
    number(i.minimumStock) > 0 &&
    number(i.stock) <= number(i.minimumStock)
  ).length;

  $("#content").innerHTML = `
    <div class="grid">
      ${stat("TOTAL ITEMS", items.length)}
      ${stat("PENDING ENTRIES", pending)}
      ${stat("TOTAL RECEIVED", `<span class="green">+${receive}</span>`)}
      ${stat("TOTAL DISPATCHED", `<span class="red">-${dispatch}</span>`)}
      ${stat("LOW STOCK ITEMS", lowStock)}
    </div>

    <div class="section-head">
      <h2>Recent Transactions</h2>
      <button class="action" onclick="navigate('transactions')">View History →</button>
    </div>

    ${txTable(tx.slice(0, 8))}

    <div class="section-head"><h2>Stock Snapshot</h2></div>
    ${itemsTable(items, false)}
  `;
}

// Transaction table

function txTable(rows, adminActions = false) {
  if (!rows.length) return `<div class="empty">No transactions found.</div>`;

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
            ${adminActions ? "<th>Action</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${rows.map(t => `
            <tr>
              <td>${fmtDate(t.createdAt)}</td>
              <td>${esc(t.invoiceNumber || "—")}</td>
              <td>${esc(t.item?.code || t.code || "—")}</td>
              <td>${esc(t.item?.name || t.name || "—")}</td>
              <td class="${t.type === "RECEIVE" ? "green" : "red"}">${esc(t.type)}</td>
              <td class="${t.type === "RECEIVE" ? "green" : "red"}">
                ${t.type === "RECEIVE" ? "+" : "-"}
                ${number(t.quantity)} ${esc(t.item?.unit || t.unit || "")}
              </td>
              <td>${esc(t.createdBy?.name || "")}</td>
              <td><span class="badge ${esc(t.status)}">${esc(t.status)}</span></td>
              ${adminActions ? `
                <td>
                  ${t.status === "pending" ? `
                    <button class="action good"
                      onclick="reviewTx('${t.batchId || t._id}','${t.batchId ? "batch" : "single"}','approve')">Approve</button>
                    <button class="action bad"
                      onclick="reviewTx('${t.batchId || t._id}','${t.batchId ? "batch" : "single"}','reject')">Reject</button>
                  ` : "—"}
                </td>
              ` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// Stock table

function itemsTable(items, allowEdit = false) {
  if (!items.length) return `<div class="empty">No items found.</div>`;

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
                ${i.image ? `<img class="item-img" src="${esc(i.image)}" alt="Item">` : ""}
                ${esc(i.name)}
              </td>
              <td>${esc(i.code)}</td>
              <td class="green">+${number(i.received)}</td>
              <td class="red">-${number(i.dispatched)}</td>
              <td><b>${number(i.stock)} ${esc(i.unit)}</b></td>
              <td>${esc(i.createdBy?.name || "")}</td>
              ${allowEdit ? `
                <td>
                  <button class="action" onclick="editItem('${i._id}')">Edit</button>
                </td>
              ` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// Excel helpers

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
  if (!response.ok) throw new Error("Image could not be loaded.");

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();

  return canvas.toDataURL("image/png").split(",")[1];
}

function showExcelColumnPicker(items) {
  const old = $("#excelColumnModal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "excelColumnModal";
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:#000b;
    display:flex;align-items:center;justify-content:center;padding:15px;
  `;

  modal.innerHTML = `
    <div class="panel" style="width:100%;max-width:550px;max-height:85vh;overflow:auto">
      <h2>Choose Excel Columns</h2>
      <p class="hint">Select the columns you want to export.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">
        <button type="button" class="action" id="excelSelectAll">Select All</button>
        <button type="button" class="action" id="excelSelectNone">Clear All</button>
      </div>
      <div class="form-grid" id="excelColumnList">
        ${exportColumns.map(c => `
          <label style="display:flex;gap:9px;align-items:center">
            <input type="checkbox" value="${c.key}" checked>${esc(c.label)}
          </label>
        `).join("")}
      </div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button type="button" class="primary" id="excelDownload">Download Excel</button>
        <button type="button" class="action" id="excelCancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  $("#excelSelectAll").onclick = () =>
    modal.querySelectorAll('input[type="checkbox"]').forEach(x => x.checked = true);

  $("#excelSelectNone").onclick = () =>
    modal.querySelectorAll('input[type="checkbox"]').forEach(x => x.checked = false);

  $("#excelCancel").onclick = () => modal.remove();

  $("#excelDownload").onclick = async e => {
    const selected = [...modal.querySelectorAll('input[type="checkbox"]:checked')]
      .map(x => x.value);

    if (!selected.length) return toast("Select at least one column.");

    const button = e.currentTarget;
    button.disabled = true;
    button.textContent = "Preparing Excel...";

    try {
      await exportStockExcel(items, selected);
      toast("Excel downloaded successfully.");
      modal.remove();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      button.textContent = "Download Excel";
    }
  };
}

async function exportStockExcel(items, selectedKeys) {
  if (!window.ExcelJS) throw new Error("Excel library not loaded.");
  if (!items.length) throw new Error("No stock items available.");

  const columns = exportColumns.filter(c => selectedKeys.includes(c.key));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Stock Register");

  sheet.columns = columns.map(c => ({
    header: c.label,
    key: c.key,
    width: c.width
  }));

  sheet.getRow(1).height = 25;
  sheet.getRow(1).font = { bold: true };

  for (const item of items) {
    const values = {
      image: "",
      code: item.code || "",
      name: item.name || "",
      received: number(item.received),
      dispatched: number(item.dispatched),
      stock: number(item.stock),
      unit: item.unit || "",
      category: item.category || "",
      brand: item.brand || "",
      specifications: item.specifications || "",
      location: item.location || "",
      minimumStock: number(item.minimumStock),
      addedBy: item.createdBy?.name || ""
    };

    const row = sheet.addRow(values);
    row.height = selectedKeys.includes("image") ? 65 : 22;

    if (selectedKeys.includes("image") && item.image) {
      try {
        const base64 = await imageToExcelData(item.image);
        const imageId = workbook.addImage({ base64, extension: "png" });
        const imageColumn = columns.findIndex(c => c.key === "image");

        sheet.addImage(imageId, {
          tl: { col: imageColumn, row: row.number - 1, offsetX: 5, offsetY: 5 },
          br: { col: imageColumn + 1, row: row.number, offsetX: -5, offsetY: -5 }
        });
      } catch (error) {
        console.warn("Image export failed:", item.code, error);
      }
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: "A1",
    to: `${excelColumnLetter(columns.length)}1`
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "JW-ST-Stock-Register.xlsx";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Stock page

async function stockPage() {
  const items = await api("/items");
  stockItemsCache = items;

  $("#content").innerHTML = `
    <div class="panel">
      <h2>Create New Item</h2>
      <p class="hint">Approved users can create and edit items.</p>

      <form id="itemForm" class="form-grid">
        <div><label>Item Code</label><input name="code" required placeholder="JW-001"></div>
        <div><label>Item Name</label><input name="name" required></div>
        <div>
          <label>Unit</label>
          <select name="unit" required>
            <option value="PCS">PCS / Pieces</option>
            <option value="KG">KG / Kilograms</option>
          </select>
        </div>
        <div><label>Category</label><input name="category"></div>
        <div><label>Brand</label><input name="brand"></div>
        <div><label>Location</label><input name="location"></div>
        <div><label>Minimum Stock</label><input name="minimumStock" type="number" min="0" value="0"></div>
        <div><label>Description</label><input name="description"></div>
        <div class="wide"><label>Specifications</label><textarea name="specifications" rows="2"></textarea></div>
        <div class="wide"><label>Item Photo</label><input type="file" name="image" accept="image/*"></div>
        <div class="wide"><button class="primary" type="submit">Save Item</button></div>
      </form>
    </div>

    <div class="panel" style="margin-top:18px">
      <div class="section-head">
        <h2>Stock Register</h2>
        <button id="exportStockBtn" class="primary" type="button">Download Excel</button>
      </div>

      <div class="form-grid">
        <div class="wide">
          <label>Search Code or Name</label>
          <input id="stockSearch" placeholder="Search item...">
        </div>
        <div>
          <label>Quantity Condition</label>
          <select id="stockCondition">
            <option value="all">All Quantities</option>
            <option value="gt">Greater than</option>
            <option value="lt">Less than</option>
            <option value="eq">Equal to</option>
            <option value="between">Between</option>
          </select>
        </div>
        <div><label>Quantity Value</label><input id="stockValue" type="number" min="0"></div>
        <div id="stockSecondValueBox" class="hidden">
          <label>Maximum Quantity</label><input id="stockSecondValue" type="number" min="0">
        </div>
        <div class="wide"><button id="clearStockFilter" class="action" type="button">Clear Filters</button></div>
      </div>

      <p id="stockResultCount" class="hint"></p>
      <div id="stockResults"></div>
    </div>

    <div id="itemEditModal"></div>
    <div id="itemHistoryModal"></div>
  `;

  const search = $("#stockSearch");
  const condition = $("#stockCondition");
  const value = $("#stockValue");
  const secondValue = $("#stockSecondValue");
  const secondBox = $("#stockSecondValueBox");

  function getFilteredItems() {
    const query = search.value.trim().toLowerCase();
    const mode = condition.value;
    const first = Number(value.value);
    const second = Number(secondValue.value);

    return items.filter(item => {
      const matchesText =
        String(item.code || "").toLowerCase().includes(query) ||
        String(item.name || "").toLowerCase().includes(query);

      const qty = number(item.stock);
      let matchesQuantity = true;

      if (mode === "gt") matchesQuantity = value.value !== "" && qty > first;
      if (mode === "lt") matchesQuantity = value.value !== "" && qty < first;
      if (mode === "eq") matchesQuantity = value.value !== "" && qty === first;
      if (mode === "between") {
        matchesQuantity = value.value !== "" && secondValue.value !== "" &&
          qty >= Math.min(first, second) && qty <= Math.max(first, second);
      }

      return matchesText && matchesQuantity;
    });
  }

  function renderStockResults() {
    const filtered = getFilteredItems();
    $("#stockResultCount").textContent = `Showing ${filtered.length} of ${items.length} items`;
    $("#stockResults").innerHTML = itemsTable(filtered, true);
  }

  search.addEventListener("input", renderStockResults);
  value.addEventListener("input", renderStockResults);
  secondValue.addEventListener("input", renderStockResults);

  condition.addEventListener("change", () => {
    secondBox.classList.toggle("hidden", condition.value !== "between");
    renderStockResults();
  });

  $("#clearStockFilter").onclick = () => {
    search.value = "";
    condition.value = "all";
    value.value = "";
    secondValue.value = "";
    secondBox.classList.add("hidden");
    renderStockResults();
  };

  $("#exportStockBtn").onclick = () => showExcelColumnPicker(getFilteredItems());

  renderStockResults();

  $("#itemForm").onsubmit = async e => {
    e.preventDefault();
    const button = e.target.querySelector('button[type="submit"]');

    try {
      button.disabled = true;
      button.textContent = "Saving...";
      const d = await fileForm(e.target, "/items");
      toast(d.message || "Item saved successfully.");
      await stockPage();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      button.textContent = "Save Item";
    }
  };
}

// Edit item

window.editItem = id => {
  const item = stockItemsCache.find(x => String(x._id) === String(id));
  if (!item) return toast("Item not found.");

  const modal = $("#itemEditModal");

  modal.innerHTML = `
    <div style="position:fixed;inset:0;z-index:9998;background:#000b;display:flex;align-items:center;justify-content:center;padding:15px">
      <div class="panel" style="width:100%;max-width:700px;max-height:90vh;overflow:auto">
        <div class="section-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div>
            <h2>Edit Item</h2>
            <small class="hint">${esc(item.code)} · ${esc(item.name)}</small>
          </div>
          <button type="button" class="action" onclick="showItemHistory('${item._id}')">History ↗</button>
        </div>

        ${item.image ? `<img src="${esc(item.image)}" style="width:90px;height:90px;object-fit:cover;border-radius:12px">` : ""}

        <form id="editItemForm" class="form-grid">
          <div><label>Item Code</label><input name="code" value="${esc(item.code)}" required></div>
          <div><label>Item Name</label><input name="name" value="${esc(item.name)}" required></div>
          <div>
            <label>Unit</label>
            <select name="unit">
              <option value="PCS" ${item.unit === "PCS" ? "selected" : ""}>PCS</option>
              <option value="KG" ${item.unit === "KG" ? "selected" : ""}>KG</option>
            </select>
          </div>
          <div><label>Category</label><input name="category" value="${esc(item.category || "")}"></div>
          <div><label>Brand</label><input name="brand" value="${esc(item.brand || "")}"></div>
          <div><label>Location</label><input name="location" value="${esc(item.location || "")}"></div>
          <div><label>Minimum Stock</label><input name="minimumStock" type="number" min="0" value="${number(item.minimumStock)}"></div>
          <div><label>Description</label><input name="description" value="${esc(item.description || "")}"></div>
          <div class="wide"><label>Specifications</label><textarea name="specifications" rows="2">${esc(item.specifications || "")}</textarea></div>
          <div class="wide"><label>Change Item Photo</label><input name="image" type="file" accept="image/*"></div>
          <div class="wide" style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="primary" type="submit">Save Changes</button>
            <button class="action" type="button" id="cancelEditItem">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $("#cancelEditItem").onclick = () => modal.innerHTML = "";

  $("#editItemForm").onsubmit = async e => {
    e.preventDefault();
    const button = e.target.querySelector('button[type="submit"]');

    try {
      button.disabled = true;
      button.textContent = "Updating...";
      const d = await fileForm(e.target, `/items/${id}`, "PATCH");
      modal.innerHTML = "";
      toast(d.message || "Item updated successfully.");
      await stockPage();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      button.textContent = "Save Changes";
    }
  };
};

// Item history and history Excel

window.showItemHistory = async id => {
  const item = stockItemsCache.find(x => String(x._id) === String(id));
  if (!item) return toast("Item not found.");

  const holder = $("#itemHistoryModal");
  if (!holder) return;

  holder.innerHTML = `
    <div style="position:fixed;inset:0;z-index:10001;background:#000c;display:flex;align-items:center;justify-content:center;padding:15px">
      <div class="panel" style="width:100%;max-width:950px;max-height:90vh;overflow:auto">
        <div class="section-head">
          <div>
            <h2>Item History</h2>
            <p class="hint">${esc(item.code)} · ${esc(item.name)}</p>
          </div>
          <button class="action" id="closeItemHistory">Close</button>
        </div>
        <div id="itemHistoryContent" class="empty">Loading item history...</div>
      </div>
    </div>
  `;

  $("#closeItemHistory").onclick = () => holder.innerHTML = "";

  try {
    // Backend route will be added in the next step.
    const result = await api(`/items/${id}/history`);
    const rows = Array.isArray(result) ? result : (result.transactions || result.history || []);

    const received = rows
      .filter(t => t.type === "RECEIVE" && t.status === "approved")
      .reduce((sum, t) => sum + number(t.quantity), 0);

    const dispatched = rows
      .filter(t => t.type === "DISPATCH" && t.status === "approved")
      .reduce((sum, t) => sum + number(t.quantity), 0);

    $("#itemHistoryContent").innerHTML = `
      <div class="grid">
        ${stat("TOTAL RECEIVED", `<span class="green">+${received}</span>`)}
        ${stat("TOTAL DISPATCHED", `<span class="red">-${dispatched}</span>`)}
        ${stat("CURRENT STOCK", `${number(item.stock)} ${esc(item.unit)}`)}
      </div>

      <div style="display:flex;justify-content:flex-end;margin:12px 0">
        <button class="primary" id="downloadItemHistory">Download History Excel</button>
      </div>

      ${rows.length ? `
        <div class="panel table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Date</th><th>Invoice</th><th>Type</th><th>Quantity</th><th>User</th><th>Status</th><th>Open</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(t => `
                <tr>
                  <td>${fmtDate(t.createdAt)}</td>
                  <td>${esc(t.invoiceNumber || "—")}</td>
                  <td class="${t.type === "RECEIVE" ? "green" : "red"}">${esc(t.type)}</td>
                  <td>${t.type === "RECEIVE" ? "+" : "-"}${number(t.quantity)} ${esc(item.unit)}</td>
                  <td>${esc(t.createdBy?.name || "")}</td>
                  <td><span class="badge ${esc(t.status)}">${esc(t.status)}</span></td>
                  <td><button class="action" onclick="openTransactionDetails('${t._id}')">View</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty">No transaction history found for this item.</div>`}
    `;

    $("#downloadItemHistory").onclick = () => exportItemHistoryExcel(item, rows);
  } catch (error) {
    $("#itemHistoryContent").innerHTML = `
      <div class="empty">
        Could not load item history.<br>
        ${esc(error.message)}<br><br>
        History API backend update is required.
      </div>
    `;
  }
};

async function exportItemHistoryExcel(item, rows) {
  if (!window.ExcelJS) return toast("Excel library not loaded.");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Item History");

  sheet.columns = [
    { header: "DATE", key: "date", width: 24 },
    { header: "INVOICE", key: "invoice", width: 18 },
    { header: "CODE", key: "code", width: 18 },
    { header: "NAME", key: "name", width: 28 },
    { header: "TYPE", key: "type", width: 16 },
    { header: "QUANTITY", key: "quantity", width: 16 },
    { header: "UNIT", key: "unit", width: 12 },
    { header: "USER", key: "user", width: 22 },
    { header: "STATUS", key: "status", width: 16 },
    { header: "NOTE", key: "note", width: 30 }
  ];

  sheet.addRows(rows.map(t => ({
    date: fmtDate(t.createdAt),
    invoice: t.invoiceNumber || "",
    code: item.code,
    name: item.name,
    type: t.type,
    quantity: number(t.quantity),
    unit: item.unit,
    user: t.createdBy?.name || "",
    status: t.status,
    note: t.note || ""
  })));

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `JW-ST-${item.code}-History.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.openTransactionDetails = async id => {
  try {
    const result = await api(`/transactions/${id}`);
    const t = result.transaction || result;

    alert(
      `Invoice: ${t.invoiceNumber || "—"}\n` +
      `Type: ${t.type}\n` +
      `Quantity: ${t.quantity}\n` +
      `Status: ${t.status}\n` +
      `Note: ${t.note || "—"}`
    );
  } catch (error) {
    toast("Transaction detail API will be added in the backend update.");
  }
};

// Invoice entry: one row per item

function invoiceItemRow(index) {
  return `
    <div class="panel invoice-item-row" data-row="${index}"
      style="margin:10px 0;padding:12px">
      <div style="display:grid;grid-template-columns:1.1fr 1.5fr .8fr .7fr auto;gap:10px;align-items:end">
        <div>
          <label>CODE</label>
          <input class="invoice-code" list="invoiceCodeOptions"
            placeholder="Item code" autocomplete="off" required>
          <input type="hidden" class="invoice-item-id">
        </div>
        <div>
          <label>NAME</label>
          <input class="invoice-name" placeholder="Item name" required>
        </div>
        <div>
          <label>QNT</label>
          <input class="invoice-item-quantity" type="number" min="1" step="1" placeholder="0" required>
        </div>
        <div>
          <label>UNIT</label>
          <select class="invoice-item-unit">
            <option value="PCS">PCS</option>
            <option value="KG">KG</option>
          </select>
        </div>
        <button type="button" class="action remove-invoice-item" title="Remove item">✕</button>
      </div>
      <small class="invoice-item-info hint">Enter an existing code or enter a new code and item name.</small>
    </div>
  `;
}

function addInvoiceItemRow() {
  const holder = $("#invoiceItems");
  const index = holder.querySelectorAll(".invoice-item-row").length;
  holder.insertAdjacentHTML("beforeend", invoiceItemRow(index));

  const row = holder.lastElementChild;
  const code = row.querySelector(".invoice-code");
  const name = row.querySelector(".invoice-name");
  const id = row.querySelector(".invoice-item-id");
  const unit = row.querySelector(".invoice-item-unit");
  const qty = row.querySelector(".invoice-item-quantity");
  const info = row.querySelector(".invoice-item-info");

  function matchExistingItem() {
    const value = code.value.trim().toLowerCase();
    const item = stockItemsCache.find(i =>
      String(i.code || "").trim().toLowerCase() === value
    );

    if (item) {
      id.value = item._id;
      name.value = item.name || "";
      unit.value = item.unit || "PCS";
      info.textContent = `Existing item · Available: ${number(item.stock)} ${item.unit || ""}`;
      name.readOnly = true;
      unit.disabled = true;
    } else {
      id.value = "";
      name.readOnly = false;
      unit.disabled = false;
      info.textContent = value
        ? "New item code. Enter the item name and unit; it will be created when the invoice is submitted."
        : "Enter an existing code or create a new item code.";
    }

    updateInvoiceTotal();
  }

  code.addEventListener("change", matchExistingItem);
  code.addEventListener("blur", matchExistingItem);
  name.addEventListener("input", updateInvoiceTotal);
  qty.addEventListener("input", updateInvoiceTotal);
  unit.addEventListener("change", updateInvoiceTotal);

  row.querySelector(".remove-invoice-item").onclick = () => {
    row.remove();
    updateInvoiceTotal();
  };
}

function updateInvoiceTotal() {
  const rows = [...document.querySelectorAll(".invoice-item-row")];
  const totals = {};

  rows.forEach(row => {
    const qty = number(row.querySelector(".invoice-item-quantity").value);
    const unit = row.querySelector(".invoice-item-unit").value;

    if (qty > 0 && unit) totals[unit] = (totals[unit] || 0) + qty;
  });

  const summary = Object.entries(totals)
    .map(([unit, qty]) => `${qty} ${unit}`)
    .join(" + ");

  const output = $("#invoiceTotal");
  if (output) {
    output.textContent = `${rows.length} item lines · Total: ${summary || "0"}`;
  }
}

// Transactions page

async function transactionsPage() {
  const [items, tx] = await Promise.all([
    api("/items"),
    api("/transactions")
  ]);

  stockItemsCache = items;

  $("#content").innerHTML = `
    <div class="panel">
      <h2>Stock Entry</h2>
      <p class="hint">Enter each item on one line. Existing codes auto-fill item details. New codes can be created from this entry.</p>

      <form id="invoiceForm" class="form-grid">
        <div><label>Invoice Number</label><input name="invoiceNumber" placeholder="Example: 31"></div>
        <div><label>Invoice Date</label><input name="invoiceDate" type="date"></div>
        <div>
          <label>Transaction Type</label>
          <select name="type" required>
            <option value="RECEIVE">RECEIVE</option>
            <option value="DISPATCH">DISPATCH</option>
          </select>
        </div>
        <div><label>Reference / Note</label><input name="note" placeholder="Invoice, challan, reason..."></div>

        <div class="wide">
          <label>Item Entry</label>
          <datalist id="invoiceCodeOptions">
            ${items.map(i => `<option value="${esc(i.code)}"></option>`).join("")}
          </datalist>
          <div id="invoiceItems"></div>
          <button type="button" id="addInvoiceItem" class="action">+ Add Another Item</button>
          <p id="invoiceTotal" class="hint">0 item lines · Total: 0</p>
        </div>

        <div class="wide">
          <label>Attach Invoice / Photo (optional)</label>
          <input type="file" name="image" accept="image/*">
        </div>

        <div class="wide">
          <button type="submit" class="primary">Submit Invoice for Approval</button>
        </div>
      </form>
    </div>

    <div class="section-head"><h2>Full Transaction History</h2></div>
    ${txTable(tx)}
  `;

  $("#addInvoiceItem").onclick = addInvoiceItemRow;
  addInvoiceItemRow();

  $("#invoiceForm").onsubmit = async e => {
    e.preventDefault();

    const button = e.target.querySelector('button[type="submit"]');
    const rows = [...document.querySelectorAll(".invoice-item-row")];

    const selectedItems = rows.map(row => ({
      itemId: row.querySelector(".invoice-item-id").value || null,
      code: row.querySelector(".invoice-code").value.trim(),
      name: row.querySelector(".invoice-name").value.trim(),
      quantity: Number(row.querySelector(".invoice-item-quantity").value),
      unit: row.querySelector(".invoice-item-unit").value
    }));

    if (!selectedItems.length || selectedItems.some(x =>
      !x.code || !x.name || !Number.isInteger(x.quantity) || x.quantity <= 0
    )) {
      toast("Every row needs a code, name and valid quantity.");
      return;
    }

    const seenCodes = new Set();
    for (const item of selectedItems) {
      const key = item.code.toLowerCase();
      if (seenCodes.has(key)) {
        toast(`Duplicate item code in this invoice: ${item.code}`);
        return;
      }
      seenCodes.add(key);
    }

    const type = e.target.elements.type.value;

    if (type === "DISPATCH") {
      for (const item of selectedItems) {
        if (!item.itemId) {
          toast(`New item ${item.code} has no stock yet. Create it with a RECEIVE entry first.`);
          return;
        }

        const existing = stockItemsCache.find(x => String(x._id) === String(item.itemId));
        if (existing && item.quantity > number(existing.stock)) {
          toast(`Insufficient stock for ${item.code}. Available: ${existing.stock} ${existing.unit}`);
          return;
        }
      }
    }

    try {
      button.disabled = true;
      button.textContent = "Submitting...";

      const formData = new FormData(e.target);
      formData.delete("items");
      formData.append("items", JSON.stringify(selectedItems));

      const res = await fetch("/api/transactions", {
        method: "POST",
        body: formData,
        credentials: "same-origin"
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Unable to submit invoice.");

      toast(data.message || "Invoice submitted for approval.");
      await transactionsPage();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      button.textContent = "Submit Invoice for Approval";
    }
  };
}

// Admin approvals

async function approvalsPage() {
  if (me.role !== "admin") throw new Error("Admin access only.");

  const [tx, summary] = await Promise.all([
    api("/transactions"),
    api("/admin/summary")
  ]);

  const pending = tx.filter(x => x.status === "pending");
  const grouped = new Map();

  pending.forEach(t => {
    const key = t.batchId || t._id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(t);
  });

  $("#content").innerHTML = `
    <div class="grid">
      ${stat("PENDING ENTRIES", summary.pendingTransactions)}
      ${stat("PENDING USERS", summary.pendingUsers)}
      ${stat("APPROVED USERS", summary.users)}
      ${stat("ALL TRANSACTIONS", summary.transactions)}
    </div>

    <div class="section-head"><h2>Invoices Awaiting Review</h2></div>

    ${grouped.size ? [...grouped.entries()].map(([key, rows]) => {
      const first = rows[0];
      return `
        <div class="panel" style="margin-bottom:16px">
          <div class="section-head">
            <div>
              <h3>Invoice: ${esc(first.invoiceNumber || "Not provided")}</h3>
              <p class="hint">${rows.length} item line(s) · ${esc(first.createdBy?.name || "")} · ${fmtDate(first.createdAt)}</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="action good" onclick="reviewTx('${key}','${first.batchId ? "batch" : "single"}','approve')">Approve Invoice</button>
              <button class="action bad" onclick="reviewTx('${key}','${first.batchId ? "batch" : "single"}','reject')">Reject Invoice</button>
            </div>
          </div>
          ${txTable(rows)}
        </div>
      `;
    }).join("") : `<div class="empty">No pending transactions.</div>`}
  `;
}

window.reviewTx = async (id, kind, decision) => {
  let reason = "";
  if (decision === "reject") reason = prompt("Reason for rejection (optional):") || "Rejected by admin";

  try {
    const url = kind === "batch"
      ? `/transactions/batch/${id}/review`
      : `/transactions/${id}/review`;

    const d = await api(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason, rejectionReason: reason })
    });

    toast(d.message || "Review completed.");
    await approvalsPage();
  } catch (error) {
    toast(error.message);
  }
};

// User management

async function usersPage() {
  if (me.role !== "admin") throw new Error("Admin access only.");

  const users = await api("/admin/users");

  $("#content").innerHTML = `
    <div class="section-head"><h2>All Registered Users</h2></div>
    <div class="panel table-wrap">
      <table class="table">
        <thead>
          <tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Joined</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${esc(u.name)}</td>
              <td>@${esc(u.username)}</td>
              <td>${esc(u.role)}</td>
              <td><span class="badge ${esc(u.status)}">${esc(u.status)}</span></td>
              <td>${new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                ${u.role === "user" && u.status === "pending" ? `
                  <button class="action good" onclick="userReview('${u._id}','approved')">Approve</button>
                  <button class="action bad" onclick="userReview('${u._id}','rejected')">Reject</button>
                ` : "—"}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

window.userReview = async (id, status) => {
  try {
    const d = await api(`/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    toast(d.message || "User " + status);
    await usersPage();
  } catch (error) {
    toast(error.message);
  }
};

// Team Chat

async function chatPage() {
  $("#content").innerHTML = `
    <div class="panel">
      <h2>JW-ST Team Chat</h2>
      <p class="hint">Share updates, questions and item photos with your team.</p>
      <div id="messages" class="chat-box"></div>
      <form id="chatForm" class="chat-send">
        <input name="text" placeholder="Type a message...">
        <input id="chatImage" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif">
        <div id="chatImagePreview" class="chat-image-preview"></div>
        <button class="primary" type="submit">Send</button>
      </form>
    </div>
  `;

  const form = $("#chatForm");
  const imageInput = $("#chatImage");
  const preview = $("#chatImagePreview");

  imageInput.addEventListener("change", () => {
    preview.innerHTML = "";
    const file = imageInput.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      imageInput.value = "";
      return toast("Please select a valid image.");
    }

    if (file.size > 5 * 1024 * 1024) {
      imageInput.value = "";
      return toast("Image must be smaller than 5 MB.");
    }

    const url = URL.createObjectURL(file);
    preview.innerHTML = `
      <img src="${url}" alt="Selected image preview">
      <button type="button" id="removeChatImage">Remove image</button>
    `;

    $("#removeChatImage").onclick = () => {
      URL.revokeObjectURL(url);
      imageInput.value = "";
      preview.innerHTML = "";
    };
  });

  async function load() {
    if (currentPage !== "chat") return;

    try {
      const msgs = await api("/chat");
      if (currentPage !== "chat") return;

      const box = $("#messages");
      if (!box) return;

      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;

      box.innerHTML = msgs.map(m => `
        <div class="bubble ${String(m.sender?._id) === String(me?.id || me?._id) ? "mine" : ""}">
          <small>${esc(m.sender?.name || "User")} · ${fmtDate(m.createdAt)}</small>
          ${m.text ? `<p>${esc(m.text)}</p>` : ""}
          ${m.image ? `
            <a href="${esc(m.image)}" target="_blank" rel="noopener">
              <img class="chat-message-image" src="${esc(m.image)}" alt="Shared image" loading="lazy">
            </a>
          ` : ""}
        </div>
      `).join("") || `<div class="empty">No messages yet. Start the conversation.</div>`;

      if (nearBottom) box.scrollTop = box.scrollHeight;
    } catch (error) {
      console.error("Chat loading error:", error);
    }
  }

  form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const file = imageInput.files[0];
    const text = form.elements.text.value.trim();

    if (!text && !file) return toast("Write a message or select an image.");

    try {
      button.disabled = true;
      button.textContent = "Sending...";
      const d = await fileForm(form, "/chat");
      toast(d.message || "Message sent successfully.");
      form.reset();
      preview.innerHTML = "";
      await load();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Send";
    }
  };

  await load();
  if (currentPage === "chat") chatTimer = setInterval(load, 3000);
}

// Password show / hide

document.addEventListener("click", e => {
  const button = e.target.closest(".password-toggle");
  if (!button) return;

  const input = document.getElementById(button.dataset.target);
  if (!input) return;

  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  button.textContent = isHidden ? "🙈" : "👁";
  button.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

// Start application

boot();
