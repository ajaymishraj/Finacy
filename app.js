// Clean, final app.js implementation
// Complete clean app.js

// Session
let KEY = null; // Will be set by auth

// IDB Helpers
const DB_NAME = "FinacyDB";
const STORE_NAME = "store";
let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    // Version 3 to force upgrade and ensure store creation
    const request = indexedDB.open(DB_NAME, 3);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onblocked = (e) => {
      showToast(
        "Database upgrade blocked. Please close other tabs of this app and reload.",
        "error",
      );
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => {
      console.error("IDB Error:", e);
      reject(e.target.error || e);
    };
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, val) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(val, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let storage = { businesses: {} };
let biz = { products: {}, sales: {}, rents: {} };

// Replacement for ss (save storage) - now async
async function ss(s) {
  storage = s;
  await dbSet("FINACY_STORAGE", s);
}

// Initialization
async function initApp() {
  try {
    const localData = localStorage.getItem("FINACY_STORAGE");
    const idbData = await dbGet("FINACY_STORAGE");

    // MIGRATION: If LocalStorage has data but IDB doesn't, migrate.
    if (localData && !idbData) {
      console.log("Migrating from LocalStorage to IndexedDB...");
      const parsed = JSON.parse(localData);
      await dbSet("FINACY_STORAGE", parsed);
      storage = parsed;
      // Optional: Clear LocalStorage after successful migration
      // localStorage.removeItem("FINACY_STORAGE");
    } else if (idbData) {
      storage = idbData;
    } else {
      // New user or empty
      storage = { businesses: {} };
    }

    storage.businesses = storage.businesses || {};
    storage.businesses[KEY] = storage.businesses[KEY] || {
      products: {},
      sales: {},
      rents: {},
    };
    biz = storage.businesses[KEY];
    // Ensure sales and rents objects always exist (legacy data may lack them)
    biz.products = biz.products || {};
    biz.sales = biz.sales || {};
    biz.rents = biz.rents || {};

    // Initial Render
    showPage("products");

    // Core Memory: Record migration
    // (This is internal logic, not tool call)
  } catch (e) {
    console.error("Init failed", e);
    showToast("Failed to load data: " + (e.message || e), "error");
  }
}

// Auth Listener
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  // User is logged in, fetch business ID
  try {
    const doc = await window.db.collection("users").doc(user.uid).get();
    if (doc.exists && doc.data().status === "active") {
      KEY = doc.data().businessId;
      if (!KEY) {
        showToast("Business ID not found for user.", "error");
        auth.signOut();
        return;
      }
      initApp();
    } else {
      // Invalid user or revoked
      auth.signOut();
    }
  } catch (e) {
    console.error("Auth check failed", e);
    showToast("Authentication check failed. Please reload.", "error");
  }
});

// IMAGE HELPERS: read files, save fallback
// Helper: Compress image to JPEG (max 1024x1024, 0.7 quality)
function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const MAX_DIM = 1024; // Balanced for quality/size
        let w = img.width;
        let h = img.height;

        if (w > h) {
          if (w > MAX_DIM) {
            h *= MAX_DIM / w;
            w = MAX_DIM;
          }
        } else {
          if (h > MAX_DIM) {
            w *= MAX_DIM / h;
            h = MAX_DIM;
          }
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = () => resolve(e.target.result); // Fallback
    };
    reader.onerror = () => resolve("");
  });
}

function readFiles(inputOrEventTarget, cb) {
  const files =
    (inputOrEventTarget && inputOrEventTarget.files) ||
    (inputOrEventTarget &&
      inputOrEventTarget.target &&
      inputOrEventTarget.target.files);
  if (!files || !files.length) return cb([]);

  // Check size limit (relaxed to 5MB for compression)
  for (let i = 0; i < files.length; i++) {
    if (files[i].size > 5242880) {
      // 5MB
      showToast(`Image "${files[i].name}" too large! (Max 5MB)`, "error");
      return; // Stop processing
    }
  }

  const promises = Array.from(files).map((f) => compressImage(f));
  Promise.all(promises)
    .then((results) => cb(results))
    .catch(() => cb([]));
}
function readFilesAndAdd() {
  const nameEl = document.getElementById("pn");
  const catEl = document.getElementById("pcat");
  const buyingEl = document.getElementById("pm");
  const sellingEl = document.getElementById("ps");
  const stockEl = document.getElementById("pstock");
  const fileInput = document.getElementById("pimg");
  const name = nameEl ? nameEl.value.trim() : "";
  const category = catEl ? catEl.value.trim() : "";
  const buying = buyingEl ? +buyingEl.value || 0 : 0;
  const selling = sellingEl ? +sellingEl.value || buying : buying;
  const stock = stockEl ? +stockEl.value || 0 : 0;

  if (!fileInput || !fileInput.files || !fileInput.files.length) {
    addProduct({
      name,
      category,
      buyingPrice: buying,
      sellPrice: selling,
      stock,
      images: [],
    });
    if (nameEl) nameEl.value = "";
    if (catEl) catEl.value = "";
    if (buyingEl) buyingEl.value = "";
    if (sellingEl) sellingEl.value = "";
    if (stockEl) stockEl.value = "";
    ss(storage);
    renderProducts();
    return;
  }
  readFiles(fileInput, (images) => {
    addProduct({
      name,
      category,
      buyingPrice: buying,
      sellPrice: selling,
      stock,
      images,
    });
    if (nameEl) nameEl.value = "";
    if (catEl) catEl.value = "";
    if (buyingEl) buyingEl.value = "";
    if (sellingEl) sellingEl.value = "";
    if (stockEl) stockEl.value = "";
    fileInput.value = "";
    ss(storage);
    renderProducts();
  });
}
function addImagesToProduct(pid) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.multiple = true;
  inp.onchange = (e) => {
    readFiles(e, (images) => {
      const p = biz.products && biz.products[pid];
      if (!p) return;
      p.images = p.images || [];
      p.images.push(...images.slice(0, 10));
      if (p.images.length > 10) p.images = p.images.slice(0, 10);
      ss(storage);
      renderProducts();
    });
  };
  inp.click();
}
function removeImage(pid, idx) {
  const p = biz.products && biz.products[pid];
  if (!p || !Array.isArray(p.images)) return;
  p.images.splice(idx, 1);
  ss(storage);
  renderProducts();
}
// Search state for real-time product filtering
let searchQuery = "";
let searchTimer = null;

// Core actions
function addProduct(o) {
  o = o || {};
  o.name = (o.name || "").toString().trim();
  if (!o.name) return showToast("⚠️ Product name required", "error");
  // store buying price (allow legacy 'mrp' param) and default sellPrice to buyingPrice
  o.buyingPrice = Number.isFinite(+o.buyingPrice || +o.mrp)
    ? +(o.buyingPrice || o.mrp || 0)
    : 0;
  o.sellPrice = Number.isFinite(+o.sellPrice) ? +o.sellPrice : o.buyingPrice;
  o.stock = Number.isFinite(+o.stock) ? Math.max(0, +o.stock) : 0;
  o.images = Array.isArray(o.images) ? o.images.slice(0, 10) : [];
  const id =
    crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  biz.products[id] = { id, ...o };
  biz.sales[id] = biz.sales[id] || [];
  biz.rents[id] = biz.rents[id] || [];
  ss(storage);
}

// UNDO SYSTEM (Simple Snapshot for Sell/Delete)
let undoStack = null;

function saveForUndo(type, data) {
  undoStack = { type, data, timestamp: Date.now() };
  showUndoToast(type);
}

function showUndoToast(actionType) {
  let toast = document.getElementById("undoToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "undoToast";
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <span>${actionType} Completed</span>
    <button onclick="performUndo()">UNDO</button>
  `;

  toast.className = "show";

  // Auto-hide after 5 seconds
  if (window.undoTimer) clearTimeout(window.undoTimer);
  window.undoTimer = setTimeout(() => {
    toast.className = "";
    undoStack = null; // Expire undo
  }, 5000);
}

async function performUndo() {
  if (!undoStack) return;

  const { type, data } = undoStack;

  if (type === "DELETE_PRODUCT") {
    // Restore product
    biz.products[data.product.id] = data.product;
    // Fix #3: only restore sales/rents from snapshot if they were actually deleted
    // Since Bug E fix keeps sales/rents alive, we only restore if they're missing
    if (data.sales && !biz.sales[data.product.id]) biz.sales[data.product.id] = data.sales;
    if (data.rents && !biz.rents[data.product.id]) biz.rents[data.product.id] = data.rents;
    showToast(`✅ Undid delete for "${data.product.name}"`, "success");
  } else if (type === "SELL_PRODUCT") {
    const p = biz.products[data.pid];
    if (p) {
      // Restore stock
      p.stock = (p.stock || 0) + data.sale.qty;
      // Remove the specific sale by saleId (Bug G fix: reference comparison fails after serialization)
      const sales = biz.sales[data.pid];
      if (sales) {
        const idx = sales.findIndex(s => s.saleId === data.sale.saleId);
        if (idx > -1) sales.splice(idx, 1);
      }
      showToast("✅ Undid sale", "success");
    }
  }

  await ss(storage);
  renderProducts();

  // Hide toast
  const toast = document.getElementById("undoToast");
  if (toast) toast.className = "";
  undoStack = null;
}

// Edit product details (name, buyingPrice, sellPrice)
async function editProduct(pid) {
  const p = biz.products[pid];
  if (!p) return showToast("Product not found", "error");
  const name = prompt("Product name", p.name);
  if (name === null) return;
  const category = prompt(
    "Category (Electronics, Furniture, Clothing, Tools)",
    p.category || "",
  );
  if (category === null) return;
  const buying = prompt("Buying price", p.buyingPrice || 0);
  if (buying === null) return;
  const selling = prompt("Selling price", p.sellPrice || buying);
  if (selling === null) return;
  const stock = prompt("Stock Quantity", p.stock || 0);
  if (stock === null) return;

  p.name = name.toString().trim();
  if (!p.name) return showToast("⚠️ Product name cannot be empty", "error");
  p.category = category.toString().trim();

  // Bug A fix: before changing buying price, stamp the OLD price onto existing sales
  // that don't already have buyingPrice stored, so historical profit is preserved
  const newBuyingPrice = Number(buying) || 0;
  if (newBuyingPrice !== p.buyingPrice && biz.sales[pid]) {
    const oldBuyingPrice = p.buyingPrice || 0;
    biz.sales[pid].forEach(s => {
      if (s.buyingPrice == null) s.buyingPrice = oldBuyingPrice;
    });
  }

  p.buyingPrice = newBuyingPrice;
  p.sellPrice = Number(selling) || p.buyingPrice;
  p.stock = Math.max(0, Number(stock) || 0);
  await ss(storage);
  try {
    renderProducts();
  } catch (e) {}
}

async function sellProduct(pid, qty = 1) {
  const p = biz.products[pid];
  if (!p) return;
  qty = Number(qty) || 1;
  if (qty <= 0) return showToast("Quantity must be at least 1!", "error");
  if ((p.stock || 0) < qty) return showToast(`Not enough stock! Available: ${p.stock || 0}`, "error");

  // Bug A fix: store buyingPrice at time of sale for accurate historical profit
  // Bug G fix: add unique saleId for reliable undo matching after serialization
  const saleId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10);
  const sale = { saleId: saleId, qty: qty, amount: qty * p.sellPrice, buyingPrice: p.buyingPrice, time: Date.now() };

  // Bug H fix: save undo state BEFORE pushing the sale and modifying stock
  saveForUndo("SELL_PRODUCT", { pid: pid, sale: JSON.parse(JSON.stringify(sale)) });

  biz.sales[pid] = biz.sales[pid] || [];
  biz.sales[pid].push(sale);

  p.stock = (p.stock || 0) - qty;
  await ss(storage);
}

async function rentProduct(pid, person, qty) {
  person = (person || "").toString().trim();
  qty = Number(qty) || 0;
  if (!person || qty <= 0) return;
  const p = biz.products[pid];
  if (!p) return;

  if ((p.stock || 0) < qty)
    return showToast(`Not enough stock! Available: ${p.stock || 0}`, "error");

  biz.rents[pid] = biz.rents[pid] || [];
  let r = biz.rents[pid].find(
    (x) =>
      x.status === "ACTIVE" && x.person.toLowerCase() === person.toLowerCase(),
  );
  if (r) {
    r.qty = (r.qty || 0) + qty;
    r.totalAmount = (r.totalAmount || 0) + qty * p.sellPrice;
  } else {
    r = {
      rentId:
        crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2, 10),
      person,
      qty,
      totalAmount: qty * p.sellPrice,
      status: "ACTIVE",
      createdAt: Date.now(),
      productName: p.name, // Bug D fix: store product name at rent creation time
    };
    biz.rents[pid].push(r);
  }
  p.stock = (p.stock || 0) - qty;
  await ss(storage);
}

function closeRent(pid, rid) {
  if (!biz.rents[pid]) return;
  const r = biz.rents[pid].find((x) => x.rentId === rid);
  if (!r) return;
  if (
    !confirm(
      `Close rent for ${r.person}? The items will be permanently removed from inventory.`,
    )
  )
    return;

  // GLOBAL SNAPSHOT for rollback
  const previousRentsSnapshot = JSON.parse(JSON.stringify(biz.rents));

  try {
    // 1. Mark as CLOSED
    r.status = "CLOSED";
    r.closedAt = Date.now();

    // 2. Enforce Global Limit of 15
    const HISTORY_LIMIT = 15;

    // Collect all closed rents across all products to identify the cutoff
    let allClosed = [];
    Object.keys(biz.rents).forEach((pKey) => {
      (biz.rents[pKey] || []).forEach((rentItem) => {
        if (rentItem.status === "CLOSED") {
          allClosed.push({
            pid: pKey,
            rentId: rentItem.rentId,
            closedAt: rentItem.closedAt || 0,
          });
        }
      });
    });

    // If we have more than limit, we need to delete the oldest ones
    if (allClosed.length > HISTORY_LIMIT) {
      // Sort by Date Descending (Newest First)
      allClosed.sort((a, b) => b.closedAt - a.closedAt);

      // The ones to KEEP are the first 15
      const keepMap = new Set(); // rentId -> true
      for (let i = 0; i < HISTORY_LIMIT; i++) {
        keepMap.add(allClosed[i].rentId);
      }

      // Now filter every product's rent list
      Object.keys(biz.rents).forEach((pKey) => {
        biz.rents[pKey] = biz.rents[pKey].filter((rentItem) => {
          // Always keep ACTIVE
          if (rentItem.status === "ACTIVE") return true;
          // Keep CLOSED only if in the keepMap
          return keepMap.has(rentItem.rentId);
        });
      });
    }

    // Stock is NOT returned (permanently removed)
    // Requirement Update: We MUST add to biz.sales to track revenue/inventory correctly.
    const closedProduct = biz.products[pid] || {};
    biz.sales[pid] = biz.sales[pid] || [];
    biz.sales[pid].push({
      saleId: (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10),
      qty: r.qty || 0,
      amount: r.totalAmount || 0,
      buyingPrice: closedProduct.buyingPrice || 0, // Bug A fix: store buyingPrice for closed rent sales
      time: Date.now(),
    });

    ss(storage);
  } catch (e) {
    console.error("Error closing rent:", e);
    showToast("Error updating rent. Rolled back.", "error");
    // ROLLBACK
    biz.rents = previousRentsSnapshot;
    ss(storage);
  }
}

async function deleteProduct(pid) {
  const p = biz.products[pid];
  if (!p) return;
  if (
    !confirm(
      `Delete "${p.name}"? You have 5 seconds to undo.`,
    )
  )
    return;

  // UNDO: Capture product snapshot (sales/rents are kept alive, so only product needs snapshot)
  saveForUndo("DELETE_PRODUCT", {
    product: JSON.parse(JSON.stringify(p)),
  });

  // Bug E fix: store product name in sales/rents before deleting product, so reports can still display them
  if (biz.sales[pid]) {
    biz.sales[pid].forEach(s => { if (!s.productName) s.productName = p.name; });
  }
  if (biz.rents[pid]) {
    biz.rents[pid].forEach(r => { if (!r.productName) r.productName = p.name; });
  }

  delete biz.products[pid];
  // Bug E fix: keep sales and rents data for historical integrity — do NOT delete them

  await ss(storage);
  renderProducts();
}

// Helpers
function formatDate(ts) {
  if (!ts) return "";

  // Handle numeric strings or numbers
  const timestamp = Number(ts);
  const date = new Date(isNaN(timestamp) ? ts : timestamp);

  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const diffTime = today - target;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (diffDays === 0) {
    return `Today, ${timeStr}`;
  } else if (diffDays === 1) {
    return `Yesterday, ${timeStr}`;
  } else {
    return date.toLocaleString();
  }
}
function startOfDay(ts) {
  const d = ts ? new Date(ts) : new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonth(ts) {
  const d = ts ? new Date(ts) : new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function summary(pid) {
  return {
    soldQty: (biz.sales[pid] || []).reduce((s, e) => s + (e.qty || 0), 0),
    soldAmt: (biz.sales[pid] || []).reduce((s, e) => s + (e.amount || 0), 0),
    activeRentQty: (biz.rents[pid] || [])
      .filter((r) => r.status === "ACTIVE")
      .reduce((s, r) => s + (r.qty || 0), 0),
  };
}

// UI
function logout() {
  if (confirm("Are you sure you want to logout?")) {
    auth.signOut();
  }
}

function toggleSettingsFab() {
  const fab = document.getElementById("settingsFab");
  if (fab) {
    fab.classList.toggle("active");
  }
}

// Close FAB when clicking outside
document.addEventListener("click", (e) => {
  const fab = document.getElementById("settingsFab");
  if (fab && !fab.contains(e.target) && fab.classList.contains("active")) {
    fab.classList.remove("active");
  }
});

async function exportTextData() {
  const clone = JSON.parse(JSON.stringify(storage));
  const bizData = clone.businesses[KEY];

  // Strip images from clone to keep it text-only
  Object.values(bizData.products || {}).forEach((p) => {
    p.images = [];
  });

  const exportObj = {
    businessId: KEY,
    type: "text_only",
    timestamp: Date.now(),
    data: btoa(JSON.stringify(clone)),
  };

  const blob = new Blob([JSON.stringify(exportObj)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finacy-text-${KEY}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportImagesData() {
  if (typeof JSZip === "undefined") {
    return showToast("JSZip library missing. Check internet.", "error");
  }

  const zip = new JSZip();
  const folder = zip.folder("images");

  let count = 0;
  const products = biz.products || {};

  Object.values(products).forEach((p) => {
    if (p.images && p.images.length) {
      const pFolder = folder.folder(p.id);
      p.images.forEach((imgData, idx) => {
        // imgData is data:image/jpeg;base64,....
        const matches = imgData.match(/^data:image\/(.+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
          const data = matches[2];
          pFolder.file(`${idx}.${ext}`, data, { base64: true });
          count++;
        }
      });
    }
  });

  if (count === 0) return showToast("⚠️ No images to export", "error");

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finacy-images-${KEY}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json,.zip";
  inp.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.name.endsWith(".json")) {
      // Handle JSON Import
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const json = JSON.parse(reader.result);

          if (!json.businessId || !json.data) throw new Error("Invalid format");
          if (json.businessId !== KEY) throw new Error("Business ID mismatch");

          const decoded = JSON.parse(atob(json.data));
          const newBiz = decoded.businesses[KEY];

          // Restore images from current storage if new storage has none (text_only import)
          if (json.type === "text_only") {
            Object.keys(newBiz.products || {}).forEach((pid) => {
              const oldP = biz.products[pid];
              if (oldP && oldP.images && oldP.images.length) {
                if (
                  !newBiz.products[pid].images ||
                  !newBiz.products[pid].images.length
                ) {
                  newBiz.products[pid].images = oldP.images;
                }
              }
            });
          }

          storage.businesses[KEY] = newBiz;
          await ss(storage);
          showToast("✅ Text data imported! Reloading...", "success");
          location.reload();
        } catch (err) {
          console.error(err);
          showToast("Import failed: " + err.message, "error");
        }
      };
      reader.readAsText(file);
    } else if (file.name.endsWith(".zip")) {
      // Handle ZIP Import
      if (typeof JSZip === "undefined")
        return showToast("JSZip library missing.", "error");

      try {
        const zip = new JSZip();
        const contents = await zip.loadAsync(file);
        const imagesFolder = contents.folder("images");

        let updatedCount = 0;
        const promises = [];

        if (imagesFolder) {
          imagesFolder.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir) return;
            const parts = relativePath.split("/");
            if (parts.length < 2) return;

            const pid = parts[0];
            const filename = parts[1];

            if (biz.products[pid]) {
              promises.push(
                zipEntry.async("base64").then((data) => {
                  const ext = filename.split(".").pop();
                  const prefix = `data:image/${ext === "jpg" ? "jpeg" : ext};base64,`;
                  const fullData = prefix + data;

                  const p = biz.products[pid];
                  p.images = p.images || [];
                  // Avoid duplicates
                  if (!p.images.includes(fullData)) {
                    p.images.push(fullData);
                    updatedCount++;
                  }
                }),
              );
            }
          });
        }

        await Promise.all(promises);

        if (updatedCount > 0) {
          await ss(storage);
          showToast(`✅ Imported ${updatedCount} images!`, "success");
          renderProducts();
        } else {
          showToast("No matching products found.", "error");
        }
      } catch (err) {
        console.error(err);
        showToast("Failed to import ZIP: " + err.message, "error");
      }
    }
  };
  inp.click();
}

function showPage(p) {
  const productsPage = document.getElementById("productsPage");
  const reportsPage = document.getElementById("reportsPage");
  if (!productsPage || !reportsPage) return;
  productsPage.classList.toggle("hidden", p !== "products");
  reportsPage.classList.toggle("hidden", p !== "reports");
  if (p === "products") renderProducts();
  if (p === "reports") renderReports();

  // Highlight active tab
  document.querySelectorAll("button[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === p);
  });

  try {
    const sb = document.querySelector(".sidebar");
    const ov = document.getElementById("overlay");
    if (window.innerWidth <= 600) {
      if (sb) {
        sb.classList.remove("open");
        sb.classList.add("collapsed");
      }
      if (ov) ov.classList.remove("open");
    } else {
      if (sb) {
        sb.classList.remove("collapsed");
        sb.classList.remove("open");
      }
      if (ov) ov.classList.remove("open");
    }
  } catch (e) {}
}

function toggleSidebar() {
  try {
    const sb = document.querySelector(".sidebar");
    const ov = document.getElementById("overlay");
    if (!sb) return;
    if (sb.classList.contains("open")) {
      sb.classList.remove("open");
      sb.classList.add("collapsed");
      if (ov) ov.classList.remove("open");
    } else {
      sb.classList.add("open");
      sb.classList.remove("collapsed");
      if (ov) ov.classList.add("open");
    }
  } catch (e) {}
}

try {
  if (window.innerWidth <= 600)
    document.querySelector(".sidebar").classList.add("collapsed");
  const ov = document.getElementById("overlay");
  if (ov) ov.classList.remove("open");
} catch (e) {}

function renderReports() {
 try {
  const now = Date.now();
  const dayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  let totalSales = 0,
    todaySales = 0,
    monthSales = 0,
    salesCount = 0;
  Object.values(biz.sales || {}).forEach((list) => {
    list.forEach((s) => {
      totalSales += Number(s.amount || 0);
      salesCount++;
      if (s.time >= dayStart) todaySales += Number(s.amount || 0);
      if (s.time >= monthStart) monthSales += Number(s.amount || 0);
    });
  });

  let activeRentsAmt = 0,
    activeRentsCount = 0,
    closedRentsAmt = 0,
    closedRentsCount = 0;
  // Bug J fix: iterate biz.rents keys (not biz.products) so deleted product rents are counted
  Object.keys(biz.rents || {}).forEach((pid) => {
    (biz.rents[pid] || []).forEach((r) => {
      if (r.status === "ACTIVE") {
        activeRentsCount += r.qty || 0;
        activeRentsAmt += Number(r.totalAmount || 0);
      }
      if (r.status === "CLOSED") {
        closedRentsCount++;
        closedRentsAmt += Number(r.totalAmount || 0);
      }
    });
  });

  const totalProducts = Object.keys(biz.products || {}).length;
  // Bug K fix: count items sold from biz.sales (not biz.products) so deleted product sales are counted
  const totalItemsSold = Object.values(biz.sales || {}).reduce(
    (acc, salesList) => acc + salesList.reduce((sum, s) => sum + (s.qty || 0), 0),
    0,
  );
  const avgSaleValue = salesCount ? (totalSales / salesCount).toFixed(2) : 0;

  // profit calculations
  // Bug I fix: iterate biz.sales keys (not biz.products) so deleted product sales are counted
  // Bug A fix: use sale.buyingPrice if available, fallback to product's current buyingPrice for legacy records
  let totalProfit = 0,
    todayProfit = 0,
    monthProfit = 0;
  Object.keys(biz.sales || {}).forEach((pid) => {
    const p = biz.products[pid] || {};
    (biz.sales[pid] || []).forEach((sale) => {
      const buy = Number(sale.buyingPrice != null ? sale.buyingPrice : (p.buyingPrice || 0));
      const profit = Number(sale.amount || 0) - Number(sale.qty || 0) * buy;
      totalProfit += profit;
      if (sale.time >= dayStart) todayProfit += profit;
      if (sale.time >= monthStart) monthProfit += profit;
    });
  });
  const avgProfitPerSale = salesCount
    ? (totalProfit / salesCount).toFixed(2)
    : 0;
  const profitMargin = totalSales
    ? ((totalProfit / totalSales) * 100).toFixed(2)
    : 0;

  let bestProduct = { name: "-", qty: 0 };

  // --- ADVANCED ANALYTICS PREPARATION ---
  const productStats = Object.values(biz.products || {}).map((p) => {
    const s = summary(p.id);
    const stock = Number(p.stock || 0);
    const salesList = biz.sales[p.id] || [];

    let pProfit = 0;
    let firstSaleTime = now;

    // Bug A fix: use sale.buyingPrice if available, fallback to product's current buyingPrice
    salesList.forEach((sale) => {
      const buy = Number(sale.buyingPrice != null ? sale.buyingPrice : (p.buyingPrice || 0));
      pProfit += Number(sale.amount || 0) - Number(sale.qty || 0) * buy;
      if (sale.time < firstSaleTime) firstSaleTime = sale.time;
    });

    // Sales Velocity (Units / Day)
    // If first sale was today, count as 1 day.
    const daysSinceFirstSale = Math.max(
      1,
      (now - firstSaleTime) / (1000 * 60 * 60 * 24),
    );
    const velocity =
      s.soldQty > 0 ? (s.soldQty / daysSinceFirstSale).toFixed(2) : 0;

    const pMargin =
      s.soldAmt > 0 ? ((pProfit / s.soldAmt) * 100).toFixed(1) : 0;

    if (s.soldQty > bestProduct.qty)
      bestProduct = { name: p.name, qty: s.soldQty };

    return {
      id: p.id,
      name: p.name,
      stock: stock,
      buyingPrice: Number(p.buyingPrice || 0),
      sellPrice: p.sellPrice,
      soldQty: s.soldQty,
      soldAmt: s.soldAmt,
      totalProfit: pProfit,
      profitMargin: Number(pMargin),
      velocity: Number(velocity),
      activeRentQty: s.activeRentQty,
    };
  });

  const reportsPage = document.getElementById("reportsPage");
  if (!reportsPage) return;
  reportsPage.classList.add("reports-page");
  reportsPage.innerHTML = `
    <div class="reports-layout" id="reportsLayout">
      <div class="reports-grid">
        <div class="report-card">
          <div class="report-label">Total Sales</div>
          <div class="report-value">₹${totalSales}</div>
          <div class="report-meta">${salesCount} sales</div>
          <div class="report-sub">Today: ₹${todaySales}</div>
          <div class="report-sub">This Month: ₹${monthSales}</div>
        </div>
        <div class="report-card">
          <div class="report-label">Profit</div>
          <div class="report-value">₹${totalProfit.toFixed(2)}</div>
          <div class="report-meta">Margin: ${profitMargin}%</div>
          <div class="report-sub">Today: ₹${todayProfit.toFixed(2)}</div>
          <div class="report-sub">This Month: ₹${monthProfit.toFixed(2)}</div>
        </div>
        <div class="report-card">
          <div class="report-label">Rents</div>
          <div class="report-value">₹${activeRentsAmt}</div>
          <div class="report-meta">Active Qty: ${activeRentsCount}</div>
          <div class="report-sub">Closed: ${closedRentsCount}</div>
          <div class="report-sub">Closed Amount: ₹${closedRentsAmt}</div>
        </div>
        <div class="report-card">
          <div class="report-label">Inventory</div>
          <div class="report-value">${totalProducts}</div>
          <div class="report-meta">Products</div>
          <div class="report-sub">Items Sold: ${totalItemsSold}</div>
          <div class="report-sub">Avg Sale: ₹${avgSaleValue}</div>
          <div class="report-sub">Top: ${bestProduct.name} (${bestProduct.qty})</div>
        </div>
      </div>
    </div>
  `;
  const reportsLayout = document.getElementById("reportsLayout");
  if (!reportsLayout) return;

  // 1. PROFITABILITY ANALYSIS
  const sortedByProfit = [...productStats].sort(
    (a, b) => b.totalProfit - a.totalProfit,
  );
  const maxProfit = sortedByProfit[0]?.totalProfit || 1;
  const top3Profit = sortedByProfit.slice(0, 3);
  const bottom3Profit = [...sortedByProfit]
    .sort((a, b) => a.totalProfit - b.totalProfit)
    .slice(0, 3);

  let profitHtml = `<div class="card report-section"><b>Profitability Analysis</b>`;
  profitHtml += `<div style="margin-top:12px; margin-bottom:8px; font-weight:600;">Profit Ranking (Top Performers)</div>`;

  sortedByProfit.forEach((p) => {
    const pct = Math.max(0, (p.totalProfit / maxProfit) * 100);
    const color = p.totalProfit >= 0 ? "#10b981" : "#ef4444"; // Green if positive, Red if negative
    profitHtml += `
      <div style="display:flex; align-items:center; margin-bottom:6px; font-size:13px;">
        <div style="width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</div>
        <div style="flex:1; background:#f1f5f9; height:8px; border-radius:4px; margin:0 8px; overflow:hidden;">
           <div style="width:${pct}%; background:${color}; height:100%; border-radius:4px;"></div>
        </div>
        <div style="width:80px; text-align:right;">₹${p.totalProfit.toFixed(0)} <span style="font-size:11px; color:#64748b;">(${p.profitMargin}%)</span></div>
      </div>`;
  });

  profitHtml += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:16px;">
    <div>
        <div style="font-size:12px; font-weight:600; color:#10b981; margin-bottom:4px;">TOP 3 PROFITABLE</div>
        ${top3Profit.map((p) => `<div style="font-size:13px;">${p.name}: ₹${p.totalProfit.toFixed(0)} (${p.profitMargin}%)</div>`).join("")}
    </div>
    <div>
        <div style="font-size:12px; font-weight:600; color:#ef4444; margin-bottom:4px;">LEAST PROFITABLE</div>
        ${bottom3Profit.map((p) => `<div style="font-size:13px;">${p.name}: ₹${p.totalProfit.toFixed(0)} (${p.profitMargin}%)</div>`).join("")}
    </div>
  </div>`;
  profitHtml += `</div>`;
  reportsLayout.innerHTML += profitHtml;

  // 2. INVENTORY STATUS
  const sortedByStock = [...productStats].sort((a, b) => b.stock - a.stock);
  let inventoryHtml = `<div class="card report-section"><b>Inventory Status</b>`;
  inventoryHtml += `<table class="report-table">
    <thead>
        <tr>
            <th>Product</th>
            <th>Stock</th>
            <th>Status</th>
        </tr>
    </thead>
    <tbody>`;

  sortedByStock.forEach((p) => {
    let status = `<span style="color:#10b981;">OK</span>`;
    let rowStyle = "";
    if (p.stock < 5) {
      status = `<span style="color:#ef4444; font-weight:600;">LOW</span>`;
      rowStyle = "background:#fef2f2;";
    } else if (p.stock > 50) {
      status = `<span style="color:#f59e0b; font-weight:600;">EXCESS</span>`;
    }
    inventoryHtml += `<tr style="${rowStyle}">
        <td>${p.name}</td>
        <td>${p.stock}</td>
        <td>${status}</td>
      </tr>`;
  });
  inventoryHtml += `</tbody></table></div>`;
  reportsLayout.innerHTML += inventoryHtml;

  // 3. SALES PERFORMANCE
  const sortedBySales = [...productStats].sort((a, b) => b.soldAmt - a.soldAmt);
  const top5Sales = sortedBySales.slice(0, 5);
  const zeroSales = productStats.filter((p) => p.soldQty === 0);

  let salesHtml = `<div class="card report-section"><b>Sales Performance</b>`;
  salesHtml += `<div style="display:flex; flex-wrap:wrap; gap:16px; margin-top:12px;">
    <div style="flex:1; min-width:200px;">
        <div style="font-size:13px; font-weight:600; margin-bottom:8px;">Top Selling (Revenue)</div>
        ${top5Sales
          .map(
            (p, i) => `
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; padding-bottom:4px; border-bottom:1px solid #f8fafc;">
                <span>${i + 1}. ${p.name}</span>
                <span>₹${p.soldAmt}</span>
            </div>
        `,
          )
          .join("")}
    </div>
    <div style="flex:1; min-width:200px;">
        <div style="font-size:13px; font-weight:600; margin-bottom:8px;">Fastest Moving (Velocity)</div>
        ${[...productStats]
          .sort((a, b) => b.velocity - a.velocity)
          .slice(0, 5)
          .map(
            (p) => `
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; padding-bottom:4px; border-bottom:1px solid #f8fafc;">
                <span>${p.name}</span>
                <span>${p.velocity}/day</span>
            </div>
        `,
          )
          .join("")}
    </div>
  </div>`;

  if (zeroSales.length > 0) {
    salesHtml += `<div style="margin-top:16px; padding:8px; background:#fff1f2; border-radius:8px; border:1px solid #fecdd3;">
        <div style="font-size:12px; font-weight:600; color:#e11d48; margin-bottom:4px;">ZERO SALES ALERT</div>
        <div style="font-size:13px; color:#be123c;">${zeroSales.map((p) => p.name).join(", ")}</div>
      </div>`;
  }
  salesHtml += `</div>`;
  reportsLayout.innerHTML += salesHtml;

  // 4. COMPARATIVE ANALYSIS
  const avgMargin =
    productStats.reduce((acc, p) => acc + p.profitMargin, 0) /
    (productStats.length || 1);
  const highSalesLowProfit = productStats.filter(
    (p) =>
      p.soldAmt > totalSales / (productStats.length || 1) &&
      p.profitMargin < avgMargin,
  );
  const highProfitLowSales = productStats.filter(
    (p) =>
      p.profitMargin > avgMargin &&
      p.soldAmt < totalSales / (productStats.length || 1),
  );

  let compHtml = `<div class="card report-section"><b>Comparative Analysis</b>`;
  compHtml += `<div style="font-size:13px; margin-top:8px;">Average Profit Margin: <b>${avgMargin.toFixed(1)}%</b></div>`;
  compHtml += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px;">
    <div style="background:#fff7ed; padding:10px; border-radius:8px; border:1px solid #ffedd5;">
        <div style="font-size:12px; font-weight:600; color:#c2410c; margin-bottom:4px;">High Volume / Low Margin</div>
        <div style="font-size:12px; color:#431407;">${highSalesLowProfit.length ? highSalesLowProfit.map((p) => p.name).join(", ") : "None"}</div>
        <div style="font-size:11px; color:#7c2d12; margin-top:4px;">Consider raising prices?</div>
    </div>
    <div style="background:#f0fdf4; padding:10px; border-radius:8px; border:1px solid #dcfce7;">
        <div style="font-size:12px; font-weight:600; color:#15803d; margin-bottom:4px;">High Margin / Low Volume</div>
        <div style="font-size:12px; color:#064e3b;">${highProfitLowSales.length ? highProfitLowSales.map((p) => p.name).join(", ") : "None"}</div>
        <div style="font-size:11px; color:#14532d; margin-top:4px;">Consider marketing boost?</div>
    </div>
  </div></div>`;
  reportsLayout.innerHTML += compHtml;

  // 5. CONSOLIDATED RENTS
  // Active Rents
  // Bug J fix: iterate biz.rents keys so rents from deleted products still show
  const allActiveRents = [];
  Object.keys(biz.rents || {}).forEach((pid) => {
    const p = biz.products[pid];
    (biz.rents[pid] || [])
      .filter((r) => r.status === "ACTIVE")
      .forEach((r) => {
        // Bug D: prefer stored productName, fallback to current product name, then "(Deleted)"
        allActiveRents.push({ ...r, productName: r.productName || (p && p.name) || "(Deleted Product)", pid: pid });
      });
  });
  allActiveRents.sort((a, b) => b.createdAt - a.createdAt);

  let activeRentHtml = `<div class="card report-section"><b>Active Rents:</b>`;
  if (allActiveRents.length === 0) {
    activeRentHtml += `<div style="color:#64748b; font-size:13px; margin-top:8px;">No active rents.</div>`;
  } else {
    activeRentHtml += `<div class="rent-section active-rents" style="margin-top:12px;">`;
    allActiveRents.forEach((r) => {
      activeRentHtml += `<div class="rent-item" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
                <span style="font-weight:600;">${r.productName}</span> — ${r.person} <br>
                Qty: ${r.qty} — ₹${r.totalAmount} — <span style="color:#64748b;">${formatDate(r.createdAt)}</span>
            </div>
            <button class="secondary close-rent-btn" style="width:auto; margin-top:0;" onclick="closeRent('${r.pid}', '${r.rentId}'); renderReports();">Close</button>
          </div>`;
    });
    activeRentHtml += `</div>`;
  }
  activeRentHtml += `</div>`;
  reportsLayout.innerHTML += activeRentHtml;

  // Closed Rents History
  // Bug J fix: iterate biz.rents keys so rents from deleted products still show
  const allClosedRents = [];
  Object.keys(biz.rents || {}).forEach((pid) => {
    const p = biz.products[pid];
    (biz.rents[pid] || [])
      .filter((r) => r.status === "CLOSED")
      .forEach((r) => {
        // Bug D: prefer stored productName, fallback to current product name, then "(Deleted)"
        allClosedRents.push({ ...r, productName: r.productName || (p && p.name) || "(Deleted Product)" });
      });
  });
  allClosedRents.sort((a, b) => b.closedAt - a.closedAt);

  let closedRentHtml = `<div class="card report-section"><b>Cleared Rent History:</b>`;
  if (allClosedRents.length === 0) {
    closedRentHtml += `<div style="color:#64748b; font-size:13px; margin-top:8px;">No history.</div>`;
  } else {
    closedRentHtml += `<div class="rent-section cleared-rents" style="margin-top:12px;">`;
    allClosedRents.forEach((r) => {
      closedRentHtml += `<div class="rent-item">
            <span style="font-weight:600;">${r.productName}</span> — ${r.person} — Qty: ${r.qty} — ₹${r.totalAmount} <br>
            <span style="color:#64748b; font-size:10px;">Returned: ${formatDate(r.closedAt)}</span>
          </div>`;
    });
    closedRentHtml += `</div>`;
  }
  closedRentHtml += `</div>`;
  reportsLayout.innerHTML += closedRentHtml;
 } catch (e) {
   console.error('renderReports error:', e);
   const rp = document.getElementById('reportsPage');
   if (rp) rp.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;"><b>Error loading reports:</b><br>${e.message}</div>`;
 }
}

// initial showPage("products") is called from initApp() after auth

function editProductImage(pid) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = (e) => {
    readFiles(e, (images) => {
      const p = biz.products && biz.products[pid];
      if (!p || !images || !images.length) return;
      p.images = p.images || [];
      // Replace primary image (index 0) with the first selected image
      p.images[0] = images[0];
      // keep existing additional images after index 0
      ss(storage);
      renderProducts();
    });
  };
  inp.click();
}

// Helper to get unique categories from existing products
function getUniqueCategories() {
  const cats = new Set();
  Object.values(biz.products || {}).forEach(p => {
    if (p.category && p.category.trim()) cats.add(p.category.trim());
  });
  return Array.from(cats).sort();
}

// Render products as a product-grid with image on top
function renderProducts() {
  const productsPage = document.getElementById("productsPage");
  if (!productsPage) return;

  // 1. Header & Search Section
  productsPage.innerHTML = `
    <div style="margin-bottom: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:end; margin-bottom:16px;">
        <div>
          <h1 style="font-size: 24px; font-weight: 800; color: var(--text-color); margin-bottom: 4px; letter-spacing: -0.5px;">Product Inventory</h1>
          <h2 style="font-size: 14px; font-weight: 500; color: #64748b;">Manage and track your business stocks efficiently</h2>
        </div>
        <button class="primary" onclick="document.getElementById('addProductForm').classList.toggle('hidden')" style="height:40px;">+ Add Product</button>
      </div>

      <div id="addProductForm" class="card hidden" style="border: 2px solid var(--primary-color); background:#f0fdf4;">
        <b style="color:var(--primary-color); display:block; margin-bottom:12px;">Add New Product</b>
        <div class="add-form">
          <div class="form-group">
            <label>Product Name</label>
            <input id="pn" placeholder="Name">
          </div>
          <div class="form-group">
            <label>Category</label>
            <input type="text" id="pcat" list="categories" placeholder="Category">
            <datalist id="categories">
              ${getUniqueCategories().map(cat => `<option value="${cat}"></option>`).join('')}
            </datalist>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Buy ₹</label>
              <input id="pm" type="number" inputmode="numeric" placeholder="0">
            </div>
            <div class="form-group">
              <label>Sell ₹</label>
              <input id="ps" type="number" inputmode="numeric" placeholder="0">
            </div>
            <div class="form-group">
              <label>Qty</label>
              <input id="pstock" type="number" inputmode="numeric" placeholder="0">
            </div>
          </div>
          <div class="form-group">
            <label>Image</label>
            <input id="pimg" type="file" accept="image/*" style="padding: 6px; font-size: 14px;">
          </div>
          <button class="primary full-width" onclick="readFilesAndAdd()">Add Product</button>
        </div>
      </div>

      <input id="searchInput" placeholder="Search products..." aria-label="Search products" 
             style="width: 100%; padding: 12px 16px; font-size: 15px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: all 0.2s ease;">
    </div>`;

  const si = document.getElementById("searchInput");
  if (si) {
    si.value = searchQuery;
    si.oninput = () => {
      const v = si.value || "";
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = v.toLowerCase();
        renderProducts();
        // Restore focus to search input after rendering
        const searchInput = document.getElementById("searchInput");
        if (searchInput) {
          searchInput.focus();
          // Place cursor at end of text
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
      }, 300);
    };
    si.onfocus = () => {
      si.style.borderColor = "var(--primary-color)";
      si.style.boxShadow = "0 0 0 3px rgba(16, 185, 129, 0.1)";
    };
    si.onblur = () => {
      si.style.borderColor = "#e2e8f0";
      si.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
    };
  }

  // 2. List Container
  const container = document.createElement("div");
  container.className = "product-list-container";
  productsPage.appendChild(container);

  // 3. List Header
  const header = document.createElement("div");
  header.className = "product-list-header";
  // Matches CSS grid: 60px 2fr 1fr 1fr 1fr 100px
  header.innerHTML = `
    <div>Img</div>
    <div>Product Info</div>
    <div>Pricing</div>
    <div>Stats</div>
    <div>Rent</div>
    <div style="text-align:right;">Actions</div>
  `;
  container.appendChild(header);

  // 4. Filter List
  const list = Object.values(biz.products || {}).filter((p) => {
    if (!searchQuery) return true;
    return (p.name || "").toLowerCase().includes(searchQuery) ||
           (p.category || "").toLowerCase().includes(searchQuery);
  });

  if (!list.length) {
    container.innerHTML += `<div style="padding: 40px; text-align: center; color: #64748b; background:white; border-radius:12px; border:1px solid #e2e8f0;">No products match your search.</div>`;
    return;
  }

  // 5. Render Items
  list.forEach((p) => {
    const s = summary(p.id);
    const stock = p.stock || 0;
    const isLowStock = stock < 5;
    const imgUrl = p.images && p.images.length ? p.images[0] : "";

    const item = document.createElement("div");
    item.className = "product-list-item";

    // Col 1: Thumbnail
    const thumbCol = document.createElement("div");
    thumbCol.className = "product-thumbnail-container";
    thumbCol.tabIndex = 0;
    thumbCol.setAttribute(
      "aria-label",
      imgUrl ? "Hover to zoom image" : "No image",
    );
    thumbCol.innerHTML = imgUrl
      ? `<img src="${imgUrl}" class="product-thumbnail" loading="lazy" alt="">
         <div class="hover-popup"><img src="${imgUrl}" alt=""></div>`
      : `<div class="thumb-placeholder no-image">No Img</div>`;

    // Col 2: Info
    const infoCol = document.createElement("div");
    infoCol.innerHTML = `
        <div class="product-name">${p.name}</div>
        <div style="font-size:12px; color:#64748b; margin-top:2px;">${p.category || "General"}</div>
        <span class="stock-badge" style="font-size:11px; padding:2px 6px; background:${isLowStock ? "#fef2f2" : "#f0fdf4"}; color:${isLowStock ? "#ef4444" : "#16a34a"}; border-radius:4px; display:inline-block; margin-top:4px;">Stock: ${stock}</span>
    `;

    // Col 3: Pricing
    const priceCol = document.createElement("div");
    priceCol.innerHTML = `
        <div style="font-weight:600; color:var(--primary-color);">₹${p.sellPrice}</div>
        <div style="font-size:11px; color:#94a3b8;">Buy: ₹${p.buyingPrice || 0}</div>
    `;

    // Col 4: Stats
    const statsCol = document.createElement("div");
    statsCol.style.fontSize = "12px";
    statsCol.style.color = "var(--text-muted)";
    statsCol.innerHTML = `
        <div>Sold: <b style="color:var(--text-color);">${s.soldQty}</b></div>
        <div>Rev: ₹${s.soldAmt}</div>
        ${s.activeRentQty ? `<div style="color:#d97706; font-weight:500;">On Rent: ${s.activeRentQty}</div>` : ""}
    `;

    // Col 5: Rent Inputs
    const rentCol = document.createElement("div");
    rentCol.style.display = "flex";
    rentCol.style.flexDirection = "column";
    rentCol.style.gap = "6px";
    rentCol.innerHTML = `
        <label class="input-label" style="font-size:11px; font-weight:600; color:#64748b; display:block; margin-bottom:2px;">Rent</label>
        <input id="r${p.id}" placeholder="Renter Name" style="padding:6px 10px; font-size:12px; height:32px; width:100%; border-radius:8px;">
        <div style="display:flex; gap:0; align-items:flex-start; position:relative;">
            <div style="position:relative; flex:0 0 67px;">
                <input id="q${p.id}" type="number" value="1" min="1" max="${stock}" style="width:60px; padding:6px 8px; font-size:12px; height:32px; border-radius:8px; text-align:center;">
                <span style="position:absolute; bottom:2px; left:2px; font-size:7px; font-weight:700; color:#c7d2e0; pointer-events:none; text-transform:uppercase; letter-spacing:0.4px;">Qty</span>
            </div>
            <button class="secondary rent-btn" style="padding:0 10px; font-size:11px; height:32px; flex:1; margin-left:6px;${stock < 1 ? ' opacity:0.5; pointer-events:none;' : ''}" onclick="rentProduct('${p.id}',document.getElementById('r${p.id}').value,+document.getElementById('q${p.id}').value);renderProducts()" ${stock < 1 ? 'disabled' : ''}>Rent</button>
        </div>
    `;

    // Col 6: Actions
    const actionCol = document.createElement("div");
    actionCol.className = "list-actions";
    actionCol.style.flexDirection = "column";
    actionCol.style.alignItems = "stretch";
    actionCol.innerHTML = `
        <div class="sell-section">
            <label style="font-size:11px; font-weight:600; color:#64748b; display:block; margin-bottom:4px;">Sell</label>
            <div style="display:flex; gap:0; align-items:flex-start;">
                <div style="position:relative; flex:0 0 67px;">
                    <input id="sq${p.id}" type="number" value="1" min="1" max="${stock}" style="padding:6px 8px; font-size:12px; height:32px; width:60px; border-radius:8px 0 0 8px; text-align:center;">
                    <span style="position:absolute; bottom:2px; left:2px; font-size:7px; font-weight:700; color:#c7d2e0; pointer-events:none; text-transform:uppercase; letter-spacing:0.4px;">Qty</span>
                </div>
                <button class="primary" style="padding:6px 12px; font-size:12px; height:32px; flex:1; border-radius:0 8px 8px 0;${stock < 1 ? ' opacity:0.5; pointer-events:none;' : ''}" onclick="sellProduct('${p.id}',document.getElementById('sq${p.id}').value);renderProducts()" ${stock < 1 ? 'disabled' : ''}>Sell</button>
            </div>
        </div>
        <div class="action-buttons">
             <button class="icon-btn" onclick="editProduct('${p.id}');renderProducts()" title="Edit">✏️</button>
             <button class="icon-btn danger" onclick="deleteProduct('${p.id}')" title="Delete">🗑️</button>
        </div>
        <button class="icon-btn" style="width:100%; margin-top:4px; height:28px; font-size:14px;" onclick="editProductImage('${p.id}')" title="Change Image">🖼️</button>
    `;

    item.append(thumbCol, infoCol, priceCol, statsCol, rentCol, actionCol);

    // Active Rents Expansion
    const active = (biz.rents[p.id] || []).filter((r) => r.status === "ACTIVE");
    if (active.length) {
      const rentsDiv = document.createElement("div");
      rentsDiv.className = "product-rents-panel";
      rentsDiv.innerHTML = `
        <div class="product-rents-title">
          <span>?????? Active Rents</span>
        </div>
      `;

      active.forEach((r) => {
        const row = document.createElement("div");
        row.className = "product-rent-row";

        // Create container for text to avoid XSS if person name has HTML (basic protection)
        const infoSpan = document.createElement("span");
        infoSpan.className = "product-rent-info";
        infoSpan.textContent = `${r.person} (Qty: ${r.qty}) ??? ???${r.totalAmount}`;

        const btn = document.createElement("button");
        btn.className = "product-rent-btn";
        btn.type = "button";
        btn.textContent = "Return";
        btn.onclick = () => {
          closeRent(p.id, r.rentId);
          renderProducts();
        };

        row.appendChild(infoSpan);
        row.appendChild(btn);
        rentsDiv.appendChild(row);
      });
      item.appendChild(rentsDiv);
    }

    // Recent Sales (Optional - small line at bottom?)
    // keeping it clean as requested, skipping recent sales in list view unless critical.
    // User said "preserve... recent sales functionality". The grid had it.
    // I should probably add it back in a collapsed way or small footer.
    const sales = (biz.sales[p.id] || []).slice(-1); // Just the last one
    if (sales.length) {
      const s = sales[0];
      const salesDiv = document.createElement("div");
      salesDiv.style.gridColumn = "1 / -1";
      salesDiv.style.fontSize = "11px";
      salesDiv.style.color = "#64748b";
      salesDiv.style.marginTop = "2px";
      salesDiv.style.textAlign = "right";
      salesDiv.innerHTML = `Last sale: ₹${s.amount} (${formatDate(s.time)})`;
      item.appendChild(salesDiv);
    }

    container.appendChild(item);
  });
}

// Initialize view
// showPage("products") moved to initApp

function showToast(message, type = "success") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast";

  // ⚠️ and ✅
  const icon = type === "error" ? "\u26A0\uFE0F" : "\u2705";
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

  container.appendChild(toast);

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.add("fade-out");
    toast.addEventListener("transitionend", () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
  }, 3000);
}
