
const $ = s => document.querySelector(s);

let me = null;
let currentPage = "dashboard";
let chatTimer = null;

// API helper
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

// File upload helper
const fileForm = async (form, url) => {
  const res = await fetch("/api" + url, {
    method: "POST",
    body: new FormData(form),
    credentials: "same-origin"
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || "Upload failed");
  }

  return data;
};

// Toast notification
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

// HTML escape
const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

// Authentication
function showAuth(tab = "login") {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");

  $("#loginForm").classList.toggle("hidden", tab !== "login");
  $("#registerForm").classList.toggle("hidden", tab !== "register");

  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
}

async function boot() {
  try {
    const d = await api("/auth/me");
    me = d.user;
    showApp();
  } catch (e) {
    me = null;
    showAuth();
  }
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

// Navigation
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

  const loader = pages[page] || dashboard;

  loader().catch(e => {
  console.error(e);

  // पुराने page की loading का error नए page पर न दिखे
  if (currentPage !== page) return;

  $("#content").innerHTML = `
    <div class="panel">
      <h2>Unable to load page</h2>
      <p>${esc(e.message)}</p>
      <button class="action" onclick="navigate('${page}')">
        Try Again
      </button>
    </div>
  `;

  toast(e.message);
});
}

// Login
$("#loginForm").onsubmit = async e => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"], button:not([type])');

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
    showApp();

  } catch (x) {
    toast(x.message);
  } finally {
    if (button) button.disabled = false;
  }
};

// Registration
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

  } catch (x) {
    toast(x.message);
  }
};

// Logout
$("#logoutBtn").onclick = async () => {
  try {
    await api("/auth/logout", {
      method: "POST"
    });

    me = null;

    if (chatTimer) {
      clearInterval(chatTimer);
      chatTimer = null;
    }

    showAuth();

  } catch (e) {
    toast(e.message);
  }
};

// Authentication tabs
document.querySelectorAll(".tab").forEach(b => {
  b.onclick = () => showAuth(b.dataset.tab);
});

// Navigation buttons
document.querySelectorAll(".nav").forEach(b => {
  b.onclick = () => navigate(b.dataset.page);
});

// Dashboard stat
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
    .reduce((a, x) => a + x.quantity, 0);

  const dispatch = tx
    .filter(x => x.status === "approved" && x.type === "DISPATCH")
    .reduce((a, x) => a + x.quantity, 0);

  $("#content").innerHTML = `
    <div class="grid">
      ${stat("TOTAL ITEMS", items.length)}
      ${stat("PENDING ENTRIES", pending)}
      ${stat("TOTAL RECEIVED", `<span class="green">+${receive}</span>`)}
      ${stat("TOTAL DISPATCHED", `<span class="red">-${dispatch}</span>`)}
    </div>

    <div class="section-head">
      <h2>Recent Transactions</h2>
      <button class="action" onclick="navigate('transactions')">
        View History →
      </button>
    </div>

    ${txTable(tx.slice(0, 8))}

    <div class="section-head">
      <h2>Stock Snapshot</h2>
    </div>

    ${itemsTable(items)}
  `;
}

// Transaction table
function txTable(rows, adminActions = false) {
  if (!rows.length) {
    return `<div class="empty">No transactions found.</div>`;
  }

  return `
    <div class="panel table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Item</th>
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
              <td>${new Date(t.createdAt).toLocaleString()}</td>

              <td>
                ${esc(t.item?.code)} · ${esc(t.item?.name)}
              </td>

              <td class="${t.type === "RECEIVE" ? "green" : "red"}">
                ${t.type}
              </td>

              <td class="${t.type === "RECEIVE" ? "green" : "red"}">
                ${t.type === "RECEIVE" ? "+" : "-"}
                ${t.quantity} ${esc(t.item?.unit || "")}
              </td>

              <td>${esc(t.createdBy?.name || "")}</td>

              <td>
                <span class="badge ${t.status}">
                  ${t.status}
                </span>
              </td>

              ${adminActions ? `
                <td>
                  ${t.status === "pending" ? `
                    <button class="action good"
                      onclick="reviewTx('${t._id}','approve')">
                      Approve
                    </button>

                    <button class="action bad"
                      onclick="reviewTx('${t._id}','reject')">
                      Reject
                    </button>
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

// Items table
function itemsTable(items) {
  if (!items.length) {
    return `<div class="empty">No items created yet.</div>`;
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
          </tr>
        </thead>

        <tbody>
          ${items.map(i => `
            <tr>
              <td>
                ${i.image
                  ? `<img class="item-img" src="${esc(i.image)}" alt="Item">`
                  : ""}
                ${esc(i.name)}
              </td>

              <td>${esc(i.code)}</td>

              <td class="green">+${i.received}</td>

              <td class="red">-${i.dispatched}</td>

              <td>
                <b>${i.stock} ${esc(i.unit)}</b>
              </td>

              <td>${esc(i.createdBy?.name || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// Stock and Items
// async function stockPage() {
//   const items = await api("/items");

//   $("#content").innerHTML = `
//     <!-- All approved users can create items -->
//     <div class="panel">
//       <h2>Create Item</h2>

//       <p class="hint">
//         All approved users can add items.
//         Each item has one unit: PCS or KG.
//       </p>

//       <form id="itemForm" class="form-grid">

//         <div>
//           <label>Item Code</label>
//           <input name="code" required placeholder="JW-001">
//         </div>

//         <div>
//           <label>Item Name</label>
//           <input name="name" required>
//         </div>

//         <div>
//           <label>Unit</label>
//           <select name="unit" required>
//             <option value="PCS">PCS / Pieces</option>
//             <option value="KG">KG / Kilograms</option>
//           </select>
//         </div>

//         <div>
//           <label>Description</label>
//           <input name="description">
//         </div>

//         <div class="wide">
//           <label>Item Photo</label>
//           <input type="file" name="image" accept="image/*">
//         </div>

//         <div class="wide">
//           <button class="primary" type="submit">
//             Save Item
//           </button>
//         </div>

//       </form>
//     </div>

//     <div class="section-head">
//       <h2>Stock Register</h2>
//     </div>

//     ${itemsTable(items)}

//     <div class="panel" style="margin-top:18px">

//       <h2>Submit Stock Entry</h2>

//       <form id="txForm" class="form-grid">

//         <div>
//           <label>Item</label>
//           <select name="itemId" required>
//             ${items.map(i => `
//               <option value="${i._id}">
//                 ${esc(i.code)} — ${esc(i.name)}
//                 (Available: ${i.stock} ${esc(i.unit)})
//               </option>
//             `).join("")}
//           </select>
//         </div>

//         <div>
//           <label>Transaction Type</label>
//           <select name="type" required>
//             <option value="RECEIVE">RECEIVE</option>
//             <option value="DISPATCH">DISPATCH</option>
//           </select>
//         </div>

//         <div>
//           <label>Quantity</label>
//           <input
//             type="number"
//             name="quantity"
//             min="1"
//             step="1"
//             required
//           >
//         </div>

//         <div>
//           <label>Reference / Note</label>
//           <input
//             name="note"
//             placeholder="Invoice, challan, reason..."
//           >
//         </div>

//         <div class="wide">
//           <label>Attach Photo (optional)</label>
//           <input type="file" name="image" accept="image/*">
//         </div>

//         <div class="wide">
//           <button class="primary" type="submit">
//             Send for Admin Approval
//           </button>
//         </div>

//       </form>
//     </div>
//   `;

//   // Create item
//   $("#itemForm").onsubmit = async e => {
//     e.preventDefault();

//     try {
//       const button = e.target.querySelector("button");
//       button.disabled = true;

//       await fileForm(e.target, "/items");

//       toast("Item saved successfully.");

//       await stockPage();

//     } catch (x) {
//       toast(x.message);
//     } finally {
//       const button = $("#itemForm button");
//       if (button) button.disabled = false;
//     }
//   };

//   // Submit Receive / Dispatch
//   $("#txForm").onsubmit = async e => {
//     e.preventDefault();

//     try {
//       const button = e.target.querySelector("button");
//       button.disabled = true;

//       const d = await fileForm(e.target, "/transactions");

//       toast(d.message);

//       await stockPage();

//     } catch (x) {
//       toast(x.message);
//     } finally {
//       const button = $("#txForm button");
//       if (button) button.disabled = false;
//     }
//   };
// }


// Convert an uploaded image into PNG data for ExcelJS
async function imageToExcelData(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Image could not be loaded: " + url);

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return canvas.toDataURL("image/png").split(",")[1];
}

// Export filtered stock with embedded images
async function exportStockExcel(items) {
  if (!window.ExcelJS) {
    throw new Error("Excel library not loaded. Check your internet connection.");
  }

  if (!items.length) {
    throw new Error("No stock items available to export.");
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Stock Register");

  sheet.columns = [
    { header: "IMAGE", key: "image", width: 16 },
    { header: "CODE", key: "code", width: 18 },
    { header: "NAME", key: "name", width: 28 },
    { header: "RECEIVED", key: "received", width: 15 },
    { header: "DISPATCHED", key: "dispatched", width: 15 },
    { header: "FINAL STOCK", key: "stock", width: 16 },
    { header: "UNIT", key: "unit", width: 12 },
    { header: "ADDED BY", key: "addedBy", width: 22 }
  ];

  sheet.getRow(1).height = 25;
  sheet.getRow(1).font = { bold: true };

  for (const item of items) {
    const row = sheet.addRow({
      image: "",
      code: item.code || "",
      name: item.name || "",
      received: Number(item.received || 0),
      dispatched: Number(item.dispatched || 0),
      stock: Number(item.stock || 0),
      unit: item.unit || "",
      addedBy: item.createdBy?.name || ""
    });

    row.height = 65;

    if (item.image) {
      try {
        const base64 = await imageToExcelData(item.image);
        const imageId = workbook.addImage({
          base64,
          extension: "png"
        });

        sheet.addImage(imageId, {
          tl: { col: 0, row: row.number - 1, offsetX: 5, offsetY: 5 },
          br: { col: 1, row: row.number, offsetX: -5, offsetY: -5 }
        });
      } catch (error) {
        console.warn("Could not export image for", item.code, error);
        row.getCell(1).value = "Image unavailable";
      }
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: "A1",
    to: "H1"
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);

  link.href = objectUrl;
  link.download = "JW-ST-Stock-Register.xlsx";
  link.click();

  URL.revokeObjectURL(objectUrl);
}

// Stock and Items
async function stockPage() {
  const items = await api("/items");

  $("#content").innerHTML = `
    <div class="panel">
      <h2>Create Item</h2>
      <p class="hint">
        All approved users can add items. Each item has one unit: PCS or KG.
      </p>

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

        <div>
          <label>Description</label>
          <input name="description">
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
        <button id="exportStockBtn" class="primary" type="button">
          Download Excel with Images
        </button>
      </div>

      <div class="form-grid">
        <div class="wide">
          <label>Find by Item Code or Name</label>
          <input id="stockSearch"
            placeholder="Search code or item name...">
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
          <input id="stockValue" type="number" min="0"
            placeholder="Example: 20000">
        </div>

        <div id="stockSecondValueBox" class="hidden">
          <label>Maximum Quantity</label>
          <input id="stockSecondValue" type="number" min="0"
            placeholder="Example: 30000">
        </div>

        <div class="wide">
          <button id="clearStockFilter" class="action" type="button">
            Clear Filters
          </button>
        </div>
      </div>

      <p id="stockResultCount" class="hint"></p>
      <div id="stockResults"></div>
    </div>

    <div class="panel" style="margin-top:18px">
      <h2>Submit Stock Entry</h2>

      <form id="txForm" class="form-grid">
        <div>
          <label>Item</label>
          <select name="itemId" required>
            ${items.map(i => `
              <option value="${i._id}">
                ${esc(i.code)} — ${esc(i.name)}
                (Available: ${i.stock} ${esc(i.unit)})
              </option>
            `).join("")}
          </select>
        </div>

        <div>
          <label>Transaction Type</label>
          <select name="type" required>
            <option value="RECEIVE">RECEIVE</option>
            <option value="DISPATCH">DISPATCH</option>
          </select>
        </div>

        <div>
          <label>Quantity</label>
          <input type="number" name="quantity" min="1" step="1" required>
        </div>

        <div>
          <label>Reference / Note</label>
          <input name="note" placeholder="Invoice, challan, reason...">
        </div>

        <div class="wide">
          <label>Attach Photo (optional)</label>
          <input type="file" name="image" accept="image/*">
        </div>

        <div class="wide">
          <button class="primary" type="submit">
            Send for Admin Approval
          </button>
        </div>
      </form>
    </div>
  `;

  const search = $("#stockSearch");
  const condition = $("#stockCondition");
  const value = $("#stockValue");
  const secondValue = $("#stockSecondValue");
  const secondBox = $("#stockSecondValueBox");
  const results = $("#stockResults");

  function getFilteredItems() {
    const query = search.value.trim().toLowerCase();
    const mode = condition.value;
    const first = Number(value.value);
    const second = Number(secondValue.value);

    return items.filter(item => {
      const matchesText =
        String(item.code || "").toLowerCase().includes(query) ||
        String(item.name || "").toLowerCase().includes(query);

      const qty = Number(item.stock || 0);

      let matchesQuantity = true;

      if (mode === "gt") matchesQuantity = value.value !== "" && qty > first;
      if (mode === "lt") matchesQuantity = value.value !== "" && qty < first;
      if (mode === "eq") matchesQuantity = value.value !== "" && qty === first;

      if (mode === "between") {
        matchesQuantity =
          value.value !== "" &&
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

    results.innerHTML = itemsTable(filtered);
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

  $("#exportStockBtn").onclick = async e => {
    const button = e.currentTarget;

    try {
      button.disabled = true;
      button.textContent = "Preparing Excel...";
      await exportStockExcel(getFilteredItems());
      toast("Excel file downloaded successfully.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Download Excel with Images";
    }
  };

  renderStockResults();

  $("#itemForm").onsubmit = async e => {
    e.preventDefault();
    const button = e.target.querySelector("button[type='submit']");

    try {
      button.disabled = true;
      await fileForm(e.target, "/items");
      toast("Item saved successfully.");
      await stockPage();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  };

  $("#txForm").onsubmit = async e => {
    e.preventDefault();
    const button = e.target.querySelector("button[type='submit']");

    try {
      button.disabled = true;
      const d = await fileForm(e.target, "/transactions");
      toast(d.message);
      await stockPage();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  };
}


// Full transaction history
async function transactionsPage() {
  const tx = await api("/transactions");

  $("#content").innerHTML = `
    <div class="section-head">
      <h2>Full Transaction History</h2>
    </div>

    ${txTable(tx)}
  `;
}

// Admin approvals
async function approvalsPage() {
  if (me.role !== "admin") {
    throw new Error("Admin access only.");
  }

  const [tx, summary] = await Promise.all([
    api("/transactions"),
    api("/admin/summary")
  ]);

  const pending = tx.filter(x => x.status === "pending");

  $("#content").innerHTML = `
    <div class="grid">
      ${stat("PENDING ENTRIES", summary.pendingTransactions)}
      ${stat("PENDING USERS", summary.pendingUsers)}
      ${stat("APPROVED USERS", summary.users)}
      ${stat("ALL TRANSACTIONS", summary.transactions)}
    </div>

    <div class="section-head">
      <h2>Entries Awaiting Review</h2>
    </div>

    ${txTable(pending, true)}
  `;
}

// Approve / Reject transaction
window.reviewTx = async (id, decision) => {
  let reason = "";

  if (decision === "reject") {
    reason = prompt("Reason for rejection (optional):")
      || "Rejected by admin";
  }

  try {
    const d = await api(`/transactions/${id}/review`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        decision,
        reason
      })
    });

    toast(d.message);

    await approvalsPage();

  } catch (e) {
    toast(e.message);
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
                <span class="badge ${u.status}">
                  ${esc(u.status)}
                </span>
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

// Approve / Reject user
window.userReview = async (id, status) => {
  try {
    const d = await api(`/admin/users/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });

    toast(d.message || "User " + status);

    await usersPage();

  } catch (e) {
    toast(e.message);
  }
};

// Team Chat
// async function chatPage() {
//   $("#content").innerHTML = `
//     <div class="panel">
//       <h2>JW-ST Team Chat</h2>

//       <p class="hint">
//         Share updates, questions and item photos with your team.
//       </p>

//       <div id="messages" class="chat-box"></div>

//       <form id="chatForm" class="chat-send">
//         <input
//           name="text"
//           placeholder="Type a message..."
//         >

//         <input
//           type="file"
//           name="image"
//           accept="image/*"
//         >

//         <button class="primary" style="margin:0" type="submit">
//           Send
//         </button>
//       </form>
//     </div>
//   `;

//   async function load() {
//     try {
//       const msgs = await api("/chat");
//       const box = $("#messages");

//       if (!box) return;

//       const nearBottom =
//         box.scrollHeight - box.scrollTop - box.clientHeight < 80;

//       box.innerHTML = msgs.map(m => `
//         <div class="bubble ${
//           String(m.sender?._id) === String(me.id || me._id)
//             ? "mine"
//             : ""
//         }">

//           <small>
//             ${esc(m.sender?.name || "User")} ·
//             ${new Date(m.createdAt).toLocaleTimeString()}
//           </small>

//           ${esc(m.text)}

//           ${m.image
//             ? `<img src="${esc(m.image)}" alt="Shared image">`
//             : ""}
//         </div>
//       `).join("") || `
//         <div class="empty">
//           No messages yet. Start the conversation.
//         </div>
//       `;

//       if (nearBottom) {
//         box.scrollTop = box.scrollHeight;
//       }

//     } catch (e) {
//       console.error("Chat loading error:", e);
//     }
//   }

//   await load();

//   chatTimer = setInterval(load, 3000);

//   $("#chatForm").onsubmit = async e => {
//     e.preventDefault();

//     try {
//       const d = await fileForm(e.target, "/chat");

//       toast(d.message || "Message sent.");

//       e.target.reset();

//       await load();

//     } catch (x) {
//       toast(x.message);
//     }
//   };
// };


// Team Chat

// Team Chat
async function chatPage() {
  $("#content").innerHTML = `
    <div class="panel">
      <h2>JW-ST Team Chat</h2>
      <p class="hint">Share updates, questions and item photos with your team.</p>

      <div id="messages" class="chat-box"></div>

      <form id="chatForm" class="chat-send">
        <input name="text" placeholder="Type a message...">

        <input
          id="chatImage"
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp,image/gif"
        >

        <div id="chatImagePreview" class="chat-image-preview"></div>

        <button class="primary" type="submit">Send</button>
      </form>
    </div>
  `;

  const form = $("#chatForm");
  const imageInput = $("#chatImage");
  const preview = $("#chatImagePreview");

  if (!form || !imageInput || !preview) {
    throw new Error("Chat form could not be initialized.");
  }

  // Image preview
  imageInput.addEventListener("change", () => {
    preview.innerHTML = "";

    const file = imageInput.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      imageInput.value = "";
      toast("Please select a valid image.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      imageInput.value = "";
      toast("Image must be smaller than 5 MB.");
      return;
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

  // Load messages
  async function load() {
    if (currentPage !== "chat") return;

    try {
      const msgs = await api("/chat");

      // User may have navigated away while API was loading
      if (currentPage !== "chat") return;

      const box = $("#messages");
      if (!box) return;

      const nearBottom =
        box.scrollHeight - box.scrollTop - box.clientHeight < 100;

      box.innerHTML = msgs.map(m => `
        <div class="bubble ${
          String(m.sender?._id) === String(me?.id || me?._id) ? "mine" : ""
        }">
          <small>
            ${esc(m.sender?.name || "User")} ·
            ${new Date(m.createdAt).toLocaleString()}
          </small>

          ${m.text ? `<p>${esc(m.text)}</p>` : ""}

          ${m.image ? `
            <a href="${esc(m.image)}" target="_blank" rel="noopener">
              <img
                class="chat-message-image"
                src="${esc(m.image)}"
                alt="Shared image"
                loading="lazy"
              >
            </a>
          ` : ""}
        </div>
      `).join("") || `
        <div class="empty">No messages yet. Start the conversation.</div>
      `;

      if (nearBottom) {
        box.scrollTop = box.scrollHeight;
      }

    } catch (error) {
      console.error("Chat loading error:", error);
    }
  }

  // IMPORTANT: Bind submit BEFORE awaiting the messages API
  form.onsubmit = async e => {
    e.preventDefault();

    const button = form.querySelector("button[type='submit']");
    if (!button) return;

    try {
      const file = imageInput.files[0];
      const text = form.elements.text.value.trim();

      if (!text && !file) {
        toast("Write a message or select an image.");
        return;
      }

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

  // Load first time
  await load();

  // Start polling only if Chat is still open
  if (currentPage === "chat" && $("#chatForm")) {
    chatTimer = setInterval(load, 3000);
  }
}



document.addEventListener("click", function (e) {
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
