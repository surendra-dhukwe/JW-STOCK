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

// Application boot

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
      ${stat("TOTAL ITEMS", items.length)}
      ${stat("PENDING ENTRIES", pending)}
      ${stat("TOTAL RECEIVED", `<span class="green">+${receive}</span>`)}
      ${stat("TOTAL DISPATCHED", `<span class="red">-${dispatch}</span>`)}
      ${stat("LOW STOCK ITEMS", lowStock)}
    </div>

    <div class="section-head">
      <h2>Recent Transactions</h2>
      <button class="action" onclick="navigate('transactions')">
        View History →
      </button>
    </div>

    ${txTable(recent)}

    <div class="section-head">
      <h2>Stock Snapshot</h2>
    </div>

    ${itemsTable(items, false)}
  `;
}


// Transaction table

function txTable(rows, adminActions = false, allowDelete = false) {
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
                ${number(t.quantity)} ${esc(t.item?.unit || t.unit || "")}
              </td>
              <td>${esc(t.createdBy?.name || "")}</td>
              <td>
                <span class="badge ${esc(t.status)}">${esc(t.status)}</span>
              </td>

              ${adminActions || allowDelete ? `
                <td>
                  ${adminActions && t.status === "pending" ? `
                    <button class="action good"
                      onclick="reviewTx('${t.batchId || t._id}','${t.batchId ? "batch" : "single"}','approve')">
                      Approve
                    </button>
                    <button class="action bad"
                      onclick="reviewTx('${t.batchId || t._id}','${t.batchId ? "batch" : "single"}','reject')">
                      Reject
                    </button>
                  ` : ""}

                  ${allowDelete && t.status !== "pending" ? `
                    <button class="action bad"
                      onclick="deleteTransaction('${t._id}','${t.batchId || ""}')">
                      ${t.batchId ? "Delete Invoice" : "Delete Entry"}
                    </button>
                  ` : ""}

                  ${!allowDelete && !(adminActions && t.status === "pending") ? "—" : ""}
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
            <input type="checkbox" value="${c.key}" checked>
            ${esc(c.label)}
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
          tl: {
            col: imageColumn,
            row: row.number - 1,
            offsetX: 5,
            offsetY: 5
          },
          br: {
            col: imageColumn + 1,
            row: row.number,
            offsetX: -5,
            offsetY: -5
          }
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
        <div>
          <label>Item Code</label>
          <input name="code" required placeholder="JW-001">
        </div>

        <div>
          <label>Item Name</label>
          <input name="name" required>
        </div>

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

        <div>
          <label>Minimum Stock</label>
          <input name="minimumStock" type="number" min="0" value="0">
        </div>

        <div><label>Description</label><input name="description"></div>

        <div class="wide">
          <label>Specifications</label>
          <textarea name="specifications" rows="2"></textarea>
        </div>

        <div class="wide">
          <label>Item Photo</label>
          <input type="file" name="image" accept="image/*">
        </div>

        <div class="wide">
          <button class="primary" type="submit">Save Item</button>
        </div>
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

        <div>
          <label>Quantity Value</label>
          <input id="stockValue" type="number" min="0">
        </div>

        <div id="stockSecondValueBox" class="hidden">
          <label>Maximum Quantity</label>
          <input id="stockSecondValue" type="number" min="0">
        </div>

        <div class="wide">
          <button id="clearStockFilter" class="action" type="button">Clear Filters</button>
        </div>
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
        matchesQuantity = value.value !== "" &&
          secondValue.value !== "" &&
          qty >= Math.min(first, second) &&
          qty <= Math.max(first, second);
      }

      return matchesText && matchesQuantity;
    });
  }

  function renderStockResults() {
    const filtered = getFilteredItems();
    $("#stockResultCount").textContent =
      `Showing ${filtered.length} of ${items.length} items`;
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

  $("#exportStockBtn").onclick = () =>
    showExcelColumnPicker(getFilteredItems());

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
          <button type="button" class="action" onclick="showItemHistory('${item._id}')">
            History ↗
          </button>
        </div>

        ${item.image ? `
          <img src="${esc(item.image)}"
            style="width:90px;height:90px;object-fit:cover;border-radius:12px">
        ` : ""}

        <form id="editItemForm" class="form-grid">
          <div>
            <label>Item Code</label>
            <input name="code" value="${esc(item.code)}" required>
          </div>

          <div>
            <label>Item Name</label>
            <input name="name" value="${esc(item.name)}" required>
          </div>

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

          <div>
            <label>Minimum Stock</label>
            <input name="minimumStock" type="number" min="0" value="${number(item.minimumStock)}">
          </div>

          <div>
            <label>Description</label>
            <input name="description" value="${esc(item.description || "")}">
          </div>

          <div class="wide">
            <label>Specifications</label>
            <textarea name="specifications" rows="2">${esc(item.specifications || "")}</textarea>
          </div>

          <div class="wide">
            <label>Change Item Photo</label>
            <input name="image" type="file" accept="image/*">
          </div>

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

// Item history

window.showItemHistory = async id => {
  const item = stockItemsCache.find(x => String(x._id) === String(id));
  if (!item) return toast("Item not found.");

  const holder = $("#itemHistoryModal");
  if (!holder) return;

  holder.innerHTML = `
    <div style="position:fixed;inset:0;z-index:10001;background:#000c;display:flex;align-items:center;justify-content:center;padding:15px">
      <div class="panel" style="width:100%;max-width:1000px;max-height:90vh;overflow:auto">
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
    const result = await api(`/items/${id}/history?page=1&limit=100`);

    const rows = Array.isArray(result.entries) ? result.entries : [];
    const summary = result.summary || {};

    $("#itemHistoryContent").innerHTML = `
      <div class="grid">
        ${stat("TOTAL RECEIVED", `<span class="green">+${number(summary.received)}</span>`)}
        ${stat("TOTAL DISPATCHED", `<span class="red">-${number(summary.dispatched)}</span>`)}
        ${stat("CURRENT STOCK", `${number(summary.currentStock)} ${esc(item.unit)}`)}
      </div>

      <div style="display:flex;justify-content:flex-end;margin:12px 0">
        <button class="primary" id="downloadItemHistory" ${rows.length ? "" : "disabled"}>
          Download History Excel
        </button>
      </div>

      ${rows.length ? `
        <div class="panel table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>User</th>
                <th>Status</th>
                <th>Details</th>
                ${me?.role === "admin" ? "<th>Action</th>" : ""}
              </tr>
            </thead>

            <tbody>
              ${rows.map(t => `
                <tr>
                  <td>${fmtDate(t.createdAt)}</td>
                  <td>${esc(t.invoiceNumber || "—")}</td>
                  <td class="${t.type === "RECEIVE" ? "green" : "red"}">
                    ${esc(t.type)}
                  </td>
                  <td class="${t.type === "RECEIVE" ? "green" : "red"}">
                    ${t.type === "RECEIVE" ? "+" : "-"}
                    ${number(t.quantity)} ${esc(item.unit)}
                  </td>
                  <td>${esc(t.createdBy?.name || "—")}</td>
                  <td>
                    <span class="badge ${esc(t.status)}">${esc(t.status)}</span>
                  </td>
                  <td>
                    <button class="action"
                      onclick="openTransactionDetails('${item._id}','${t._id}')">
                      View
                    </button>
                  </td>

                  ${me?.role === "admin" ? `
                    <td>
                      ${t.status !== "pending" ? `
                        <button class="action bad"
                          onclick="deleteTransaction('${t._id}','${t.batchId || ""}','${item._id}')">
                          ${t.batchId ? "Delete Invoice" : "Delete Entry"}
                        </button>
                      ` : "Pending"}
                    </td>
                  ` : ""}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <p class="hint">
          Showing ${rows.length} of ${number(result.pagination?.total)} entries.
        </p>
      ` : `
        <div class="empty">No transaction history found for this item.</div>
      `}
    `;

    const downloadButton = $("#downloadItemHistory");

    if (rows.length && downloadButton) {
      downloadButton.onclick = async e => {
        const button = e.currentTarget;
        button.disabled = true;
        button.textContent = "Preparing Excel...";

        try {
          let allRows = [];
          let page = 1;

          const totalPages = Math.max(
            1,
            number(result.pagination?.totalPages)
          );

          while (page <= totalPages) {
            const pageData = page === 1
              ? result
              : await api(`/items/${id}/history?page=${page}&limit=100`);

            allRows.push(...(pageData.entries || []));
            page++;
          }

          if (!allRows.length) {
            throw new Error("No history available to export.");
          }

          await exportItemHistoryExcel(item, allRows);
          toast("Item history Excel downloaded.");
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
          button.textContent = "Download History Excel";
        }
      };
    }
  } catch (error) {
    $("#itemHistoryContent").innerHTML = `
      <div class="empty">
        Could not load item history.
        <p>${esc(error.message)}</p>
      </div>
    `;
  }
};

async function exportItemHistoryExcel(item, rows) {
  if (!window.ExcelJS) throw new Error("Excel library not loaded.");
  if (!rows.length) throw new Error("No history available to export.");

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
  sheet.autoFilter = {
    from: "A1",
    to: "J1"
  };

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

// Transaction details

window.openTransactionDetails = async (itemId, transactionId) => {
  try {
    const result = await api(`/items/${itemId}/history/${transactionId}`);
    const t = result.entry || result.transaction || result;

    const old = $("#transactionDetailsModal");
    if (old) old.remove();

    const modal = document.createElement("div");
    modal.id = "transactionDetailsModal";
    modal.style.cssText = `
      position:fixed;inset:0;z-index:10002;background:#000c;
      display:flex;align-items:center;justify-content:center;padding:15px;
    `;

    modal.innerHTML = `
      <div class="panel" style="width:100%;max-width:550px;max-height:85vh;overflow:auto">
        <div class="section-head">
          <h2>Transaction Details</h2>
          <button class="action" id="closeTransactionDetails">Close</button>
        </div>

        <div class="form-grid">
          <div><label>Item Code</label><b>${esc(result.item?.code || "—")}</b></div>
          <div><label>Item Name</label><b>${esc(result.item?.name || "—")}</b></div>
          <div><label>Invoice Number</label><b>${esc(t.invoiceNumber || "—")}</b></div>

          <div>
            <label>Transaction Type</label>
            <b class="${t.type === "RECEIVE" ? "green" : "red"}">${esc(t.type)}</b>
          </div>

          <div>
            <label>Quantity</label>
            <b>${number(t.quantity)} ${esc(result.item?.unit || "")}</b>
          </div>

          <div>
            <label>Status</label>
            <span class="badge ${esc(t.status)}">${esc(t.status)}</span>
          </div>

          <div><label>Created By</label><b>${esc(t.createdBy?.name || "—")}</b></div>
          <div><label>Date</label><b>${fmtDate(t.createdAt)}</b></div>
          <div><label>Reviewed By</label><b>${esc(t.reviewedBy?.name || "—")}</b></div>
          <div><label>Reviewed At</label><b>${fmtDate(t.reviewedAt)}</b></div>

          <div class="wide">
            <label>Note</label>
            <p>${esc(t.note || "—")}</p>
          </div>

          <div class="wide">
            <label>Rejection Reason</label>
            <p>${esc(t.rejectionReason || "—")}</p>
          </div>

          ${t.image ? `
            <div class="wide">
              <label>Attached Image</label>
              <a href="${esc(t.image)}" target="_blank" rel="noopener">
                <img src="${esc(t.image)}" alt="Transaction attachment"
                  style="max-width:100%;max-height:250px;object-fit:contain;border-radius:12px">
              </a>
            </div>
          ` : ""}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    $("#closeTransactionDetails").onclick = () => modal.remove();
  } catch (error) {
    toast(error.message || "Unable to load transaction details.");
  }
};

// Invoice entry rows

// Invoice entry rows

function invoiceItemRow(index) {
  return `
    <div class="panel invoice-item-row" data-row="${index}"
      style="margin:10px 0;padding:12px">

      <div class="invoice-entry-grid">

        <div class="invoice-image-cell">
          <label>IMAGE</label>
          <div class="invoice-image-preview">
            <span class="hint">No photo</span>
          </div>
        </div>

        <div>
          <label>CODE</label>
          <input class="invoice-code"
            list="invoiceCodeOptions"
            placeholder="Select item code"
            autocomplete="off"
            required>
          <input type="hidden" class="invoice-item-id">
        </div>

        <div>
          <label>NAME</label>
          <input class="invoice-name"
            placeholder="Auto-filled item name"
            readonly
            required>
        </div>

        <div>
          <label>QNT</label>
          <input class="invoice-qnt"
            type="number" min="1" step="1"
            placeholder="0" required>
        </div>

        <div>
          <label>BAGS</label>
          <input class="invoice-bags"
            type="number" min="1" step="1"
            value="1" required>
        </div>

        <div>
          <label>BAG PR KG</label>
          <input class="invoice-bag-per-kg"
  type="number" min="0" step="0.001"
  placeholder="0">
        </div>

        <div>
          <label>TOT. K.G.</label>
          <input class="invoice-total-kg"
            type="text" value="0" readonly>
        </div>

        <div>
          <label>TOT. QNT</label>
          <input class="invoice-total-qnt"
            type="text" value="0" readonly>
        </div>

        <button type="button"
          class="action bad remove-invoice-item"
          title="Remove item">✕ Remove</button>
      </div>

      <small class="invoice-item-info hint">
        Select an existing item code from Item Master.
      </small>
    </div>
  `;
}


function addInvoiceItemRow() {
  const holder = $("#invoiceItems");
  if (!holder) return;

  const index = holder.querySelectorAll(".invoice-item-row").length;

  holder.insertAdjacentHTML("beforeend", invoiceItemRow(index));

  const row = holder.lastElementChild;

  const code = row.querySelector(".invoice-code");
  const id = row.querySelector(".invoice-item-id");
  const name = row.querySelector(".invoice-name");
  const imageBox = row.querySelector(".invoice-image-preview");
  const qnt = row.querySelector(".invoice-qnt");
  const bags = row.querySelector(".invoice-bags");
  const bagPerKg = row.querySelector(".invoice-bag-per-kg");
  const info = row.querySelector(".invoice-item-info");

  function matchExistingItem() {
    const value = code.value.trim().toLowerCase();

    const item = stockItemsCache.find(i =>
      String(i.code || "").trim().toLowerCase() === value
    );

    if (!item) {
      id.value = "";
      name.value = "";
      imageBox.innerHTML = `<span class="hint">No photo</span>`;

      info.textContent = value
        ? "Item not found. First create this item in Stock & Items."
        : "Select an existing item code from Item Master.";

      info.classList.add("red");
      updateInvoiceTotal();
      return;
    }

    id.value = item._id;
    name.value = item.name || "";

    if (item.image) {
      imageBox.innerHTML = `
        <img src="${esc(item.image)}"
          alt="${esc(item.name || "Item")}"
          class="invoice-item-image">
      `;
    } else {
      imageBox.innerHTML = `<span class="hint">No photo</span>`;
    }

    info.textContent =
      `Item selected · Available stock: ${number(item.stock)} ${esc(item.unit || "")}`;

    info.classList.remove("red");

    updateInvoiceTotal();
  }

  code.addEventListener("input", matchExistingItem);
  code.addEventListener("change", matchExistingItem);
  code.addEventListener("blur", matchExistingItem);

  [qnt, bags, bagPerKg].forEach(input => {
    input.addEventListener("input", updateInvoiceTotal);
  });

  row.querySelector(".remove-invoice-item").onclick = () => {
    row.remove();
    updateInvoiceTotal();
  };

  updateInvoiceTotal();
}


// Responsive invoice entry layout

(function addInvoiceResponsiveStyle() {
  if (document.getElementById("invoiceResponsiveStyle")) return;

  const style = document.createElement("style");
  style.id = "invoiceResponsiveStyle";

  style.textContent = `
    .invoice-entry-grid {
      display: grid;
      grid-template-columns:
        90px
        1fr
        1.4fr
        .75fr
        .75fr
        .9fr
        .9fr
        .9fr
        auto;
      gap: 10px;
      align-items: end;
    }

    .invoice-entry-grid > div {
      min-width: 0;
    }

    .invoice-entry-grid label {
      display: block;
      margin-bottom: 6px;
      font-size: 11px;
      font-weight: 700;
    }

    .invoice-entry-grid input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }

    .invoice-entry-grid input[readonly] {
      opacity: .85;
      cursor: not-allowed;
    }

    .invoice-image-preview {
      width: 75px;
      height: 55px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border: 1px dashed #777;
      border-radius: 8px;
      font-size: 10px;
    }

    .invoice-item-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .invoice-item-info {
      display: block;
      margin-top: 10px;
    }

    @media (max-width: 1100px) {
      .invoice-entry-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .invoice-image-cell {
        grid-row: span 2;
      }
    }

    @media (max-width: 650px) {
      .invoice-entry-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .invoice-image-cell {
        grid-row: auto;
      }

      .invoice-entry-grid .remove-invoice-item {
        grid-column: 1 / -1;
        width: 100%;
      }
    }
  `;

  document.head.appendChild(style);
})();

function updateInvoiceTotal() {
  const rows = [...document.querySelectorAll(".invoice-item-row")];

  let invoiceTotalQnt = 0;
  let invoiceTotalKg = 0;

  rows.forEach(row => {
    const qnt = Number(row.querySelector(".invoice-qnt")?.value || 0);
    const bags = Number(row.querySelector(".invoice-bags")?.value || 0);
    const bagPerKgInput = row.querySelector(".invoice-bag-per-kg").value.trim();
const bagPerKg = bagPerKgInput === "" ? 0 : Number(bagPerKgInput);
    const totalQnt = qnt * bags;
    const totalKg = bags * bagPerKg;

    row.querySelector(".invoice-total-qnt").value =
      Number.isFinite(totalQnt) ? totalQnt : 0;

    row.querySelector(".invoice-total-kg").value =
      Number.isFinite(totalKg) ? Number(totalKg.toFixed(3)) : 0;

    if (Number.isSafeInteger(totalQnt) && totalQnt > 0) {
      invoiceTotalQnt += totalQnt;
    }

    if (Number.isFinite(totalKg) && totalKg >= 0) {
      invoiceTotalKg += totalKg;
    }
  });

  const output = $("#invoiceTotal");

  if (output) {
    output.textContent =
      `${rows.length} item lines · Total Quantity: ${invoiceTotalQnt} · Total KG: ${invoiceTotalKg.toFixed(3)}`;
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
      <h2>Stock Entry / Invoice</h2>
      <p class="hint">
      First create items in Stock & Items. Select an existing CODE here. IMAGE and NAME will fill automatically when available.
      </p>

      <form id="invoiceForm" class="form-grid">
        <div>
          <label>Invoice Number</label>
          <input name="invoiceNumber" placeholder="Example: 31">
        </div>

        <div>
          <label>Invoice Date</label>
          <input name="invoiceDate" type="date">
        </div>

        <div>
          <label>Transaction Type</label>
          <select name="type" required>
            <option value="RECEIVE">RECEIVE</option>
            <option value="DISPATCH">DISPATCH</option>
          </select>
        </div>

        <div>
          <label>Reference / Note</label>
          <input name="note" placeholder="Invoice, challan, reason...">
        </div>

        <div class="wide">
          <label>Invoice Items</label>

          <datalist id="invoiceCodeOptions">
            ${items.map(i => `
              <option value="${esc(i.code)}"></option>
            `).join("")}
          </datalist>

          <div id="invoiceItems"></div>

          <button type="button" id="addInvoiceItem" class="action">
            + Add Another Item
          </button>

          <p id="invoiceTotal" class="hint">
            0 item lines · Total Quantity: 0 · Total KG: 0.000
          </p>
        </div>

        <div class="wide">
          <label>Attach Invoice / Photo (optional)</label>
          <input type="file" name="image" accept="image/*">
        </div>

        <div class="wide">
          <button type="submit" class="primary">
            Submit Invoice for Approval
          </button>
        </div>
      </form>
    </div>

    <div class="section-head">
      <h2>Full Transaction History</h2>
    </div>

    ${txTable(tx, false, me?.role === "admin")}
  `;

  $("#addInvoiceItem").onclick = () => {
    addInvoiceItemRow();

    const rows = document.querySelectorAll(".invoice-item-row");
    rows[rows.length - 1]?.querySelector(".invoice-code")?.focus();
  };

  // Start with one invoice row
  addInvoiceItemRow();

  // Enter inside an invoice row adds the next row.
  $("#invoiceForm").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;

    if (
      e.target.tagName === "TEXTAREA" ||
      e.target.tagName === "BUTTON"
    ) {
      return;
    }

    e.preventDefault();

    if (e.target.closest(".invoice-item-row")) {
      addInvoiceItemRow();

      const rows = document.querySelectorAll(".invoice-item-row");
      rows[rows.length - 1]?.querySelector(".invoice-code")?.focus();
    }
  });

  $("#invoiceForm").onsubmit = async e => {
    e.preventDefault();

    const form = e.target;
    const button = form.querySelector('button[type="submit"]');
    const rows = [...form.querySelectorAll(".invoice-item-row")];

    if (!rows.length) {
      toast("Add at least one invoice item.");
      return;
    }

    const selectedItems = [];
    const missingKgItems = [];

    for (const row of rows) {
      const itemId = row.querySelector(".invoice-item-id").value;
      const code = row.querySelector(".invoice-code").value.trim();

      const qnt = Number(row.querySelector(".invoice-qnt").value);
      const bags = Number(row.querySelector(".invoice-bags").value);
      const bagPerKgInput =
  row.querySelector(".invoice-bag-per-kg").value.trim();

const bagPerKg =
  bagPerKgInput === "" ? 0 : Number(bagPerKgInput);

      const item = stockItemsCache.find(x =>
        String(x._id) === String(itemId)
      );

      if (!itemId || !item || !code) {
        toast("Select a valid existing item code from Item Master in every row.");
        return;
      }

      if (String(item.code).trim().toLowerCase() !== code.toLowerCase()) {
        toast(`Invalid item code: ${code}. Select the code again.`);
        return;
      }

      if (!Number.isSafeInteger(qnt) || qnt < 1) {
        toast(`Enter a valid whole-number QNT for ${item.code}.`);
        return;
      }

      if (!Number.isSafeInteger(bags) || bags < 1) {
        toast(`Enter a valid whole-number BAGS for ${item.code}.`);
        return;
      }

      if (!Number.isFinite(bagPerKg) || bagPerKg < 0) {
        toast(`Enter a valid BAG PR KG for ${item.code}.`);
        return;
      }

      const totalQuantity = qnt * bags;
      const totalKg = bags * bagPerKg;

      if (!Number.isSafeInteger(totalQuantity) || totalQuantity < 1) {
        toast(`Invalid TOT. QNT for ${item.code}.`);
        return;
      }

      if (!Number.isFinite(totalKg)) {
        toast(`Invalid TOT. K.G. for ${item.code}.`);
        return;
      }

      selectedItems.push({
        itemId: item._id,
        code: item.code,
        qnt,
        bags,
        bagPerKg,
        totalKg,
        totalQuantity,
        quantity: totalQuantity
      });

      if (bagPerKgInput === "") {
  missingKgItems.push(item.code);
}
    }

    // DISPATCH stock validation: combine repeated item codes.
    // const type = form.elements.type.value;

    // if (type === "DISPATCH") {
    //   const requestedByItem = new Map();

    //   for (const entry of selectedItems) {
    //     const key = String(entry.itemId);
    //     requestedByItem.set(
    //       key,
    //       (requestedByItem.get(key) || 0) + entry.totalQuantity
    //     );
    //   }

    //   for (const [itemId, requested] of requestedByItem) {
    //     const existing = stockItemsCache.find(x =>
    //       String(x._id) === itemId
    //     );

    //     const available = number(existing?.stock);

    //     if (requested > available) {
    //       toast(
    //         `Insufficient stock for ${existing?.code || "item"}. Available: ${available}, requested: ${requested}.`
    //       );
    //       return;
    //     }
    //   }
    // }

  const warning = missingKgItems.length
  ? ` Warning: BAG PR KG missing for ${missingKgItems.join(", ")}. Calculated as 0 KG.`
  : "";

try {
  button.disabled = true;
  button.textContent = "Submitting...";

  const formData = new FormData(form);

  formData.delete("items");
  formData.append("items", JSON.stringify(selectedItems));

  const response = await fetch("/api/transactions", {
    method: "POST",
    body: formData,
    credentials: "same-origin"
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Unable to submit invoice.");
  }

  toast((data.message || "Invoice submitted for approval.") + warning);

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
  if (me.role !== "admin") {
    throw new Error("Admin access only.");
  }

  const [pending, summary] = await Promise.all([
    api("/admin/pending-transactions"),
    api("/admin/summary")
  ]);

  const grouped = new Map();

  pending.forEach(t => {
    const key = t.batchId || t._id;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(t);
  });

  $("#content").innerHTML = `
    <div class="grid">
      ${stat("PENDING ENTRIES", summary.pendingTransactions)}
      ${stat("PENDING USERS", summary.pendingUsers)}
      ${stat("APPROVED USERS", summary.users)}
      ${stat("ALL TRANSACTIONS", summary.transactions)}
    </div>

    <div class="section-head">
      <h2>Invoices Awaiting Review</h2>
    </div>

    ${grouped.size ? [...grouped.entries()].map(([key, rows]) => {
      const first = rows[0];

      return `
        <div class="panel" style="margin-bottom:16px">
          <div class="section-head">
            <div>
              <h3>Invoice: ${esc(first.invoiceNumber || "Not provided")}</h3>
              <p class="hint">
                ${rows.length} item line(s) ·
                ${esc(first.createdBy?.name || "")} ·
                ${fmtDate(first.createdAt)}
              </p>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="action good"
                onclick="reviewTx('${key}','${first.batchId ? "batch" : "single"}','approve')">
                Approve Invoice
              </button>

              <button class="action bad"
                onclick="reviewTx('${key}','${first.batchId ? "batch" : "single"}','reject')">
                Reject Invoice
              </button>
            </div>
          </div>

          ${txTable(rows)}
        </div>
      `;
    }).join("") : `
      <div class="empty">No pending transactions.</div>
    `}
  `;
}


window.reviewTx = async (id, kind, decision) => {
  let reason = "";

  if (decision === "reject") {
    reason = prompt("Reason for rejection (optional):") || "Rejected by admin";
  }

  try {
    const url = kind === "batch"
      ? `/transactions/batch/${id}/review`
      : `/transactions/${id}/review`;

    const d = await api(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        reason,
        rejectionReason: reason
      })
    });

    toast(d.message || "Review completed.");
    await approvalsPage();
  } catch (error) {
    toast(error.message);
  }
};

// Admin-only deletion

window.deleteItem = async id => {
  if (me?.role !== "admin") {
    return toast("Admin access only.");
  }

  const item = stockItemsCache.find(x =>
    String(x._id) === String(id)
  );

  if (!item) return toast("Item not found.");

  const confirmed = confirm(
    `Delete item ${item.code} - ${item.name}?\n\nItems with transaction history cannot be deleted.`
  );

  if (!confirmed) return;

  try {
    const d = await api(`/items/${id}`, {
      method: "DELETE"
    });

    toast(d.message || "Item deleted successfully.");
    await stockPage();
  } catch (error) {
    toast(error.message);
  }
};

window.deleteTransaction = async (id, batchId = "", itemId = "") => {
  if (me?.role !== "admin") {
    return toast("Admin access only.");
  }

  const isBatch = Boolean(batchId);

  const confirmed = confirm(
    isBatch
      ? "Delete this complete invoice and all its item entries?\n\nThis action cannot be undone."
      : "Delete this transaction entry?\n\nThis action cannot be undone."
  );

  if (!confirmed) return;

  try {
    const url = isBatch
      ? `/transactions/batch/${encodeURIComponent(batchId)}`
      : `/transactions/${encodeURIComponent(id)}`;

    const d = await api(url, {
      method: "DELETE"
    });

    toast(d.message || "Transaction deleted successfully.");

    if (itemId) {
      stockItemsCache = await api("/items");
      await showItemHistory(itemId);
    } else if (currentPage === "transactions") {
      await transactionsPage();
    } else if (currentPage === "approvals") {
      await approvalsPage();
    } else {
      await dashboard();
    }
  } catch (error) {
    toast(error.message);
  }
};

// User management

async function usersPage() {
  if (me.role !== "admin") {
    throw new Error("Admin access only.");
  }

  const users = await api("/admin/users");

  $("#content").innerHTML = `
    <div class="section-head">
      <h2>All Registered Users</h2>
    </div>

    <div class="panel table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          ${users.map(u => `
            <tr>
              <td>${esc(u.name)}</td>
              <td>@${esc(u.username)}</td>
              <td>${esc(u.role)}</td>
              <td>
                <span class="badge ${esc(u.status)}">${esc(u.status)}</span>
              </td>
              <td>${new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                ${u.role === "user" && u.status === "pending" ? `
                  <button class="action good"
                    onclick="userReview('${u._id}','approved')">
                    Approve
                  </button>

                  <button class="action bad"
                    onclick="userReview('${u._id}','rejected')">
                    Reject
                  </button>
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
      <p class="hint">
        Share updates, questions and item photos with your team.
      </p>

      <div id="messages" class="chat-box"></div>

      <form id="chatForm" class="chat-send">
        <input name="text" placeholder="Type a message...">

        <input id="chatImage" type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp,image/gif">

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

      const nearBottom =
        box.scrollHeight - box.scrollTop - box.clientHeight < 100;

      box.innerHTML = msgs.map(m => `
        <div class="bubble ${
          String(m.sender?._id) === String(me?.id || me?._id)
            ? "mine"
            : ""
        }">
          <small>
            ${esc(m.sender?.name || "User")} · ${fmtDate(m.createdAt)}
          </small>

          ${m.text ? `<p>${esc(m.text)}</p>` : ""}

          ${m.image ? `
            <a href="${esc(m.image)}" target="_blank" rel="noopener">
              <img class="chat-message-image"
                src="${esc(m.image)}"
                alt="Shared image"
                loading="lazy">
            </a>
          ` : ""}
        </div>
      `).join("") || `
        <div class="empty">
          No messages yet. Start the conversation.
        </div>
      `;

      if (nearBottom) {
        box.scrollTop = box.scrollHeight;
      }
    } catch (error) {
      console.error("Chat loading error:", error);
    }
  }

  form.onsubmit = async e => {
    e.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    const file = imageInput.files[0];
    const text = form.elements.text.value.trim();

    if (!text && !file) {
      return toast("Write a message or select an image.");
    }

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

  if (currentPage === "chat") {
    chatTimer = setInterval(load, 5000);
  }
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

  button.setAttribute(
    "aria-label",
    isHidden ? "Hide password" : "Show password"
  );
});

// Start application

boot();