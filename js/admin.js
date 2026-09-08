import { auth } from "./firebase.js";
import { ADMIN_EMAIL, API_URL } from "./config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const state = { uploadedImages: [], editingProductId: null, products: [], banners: [] };

const els = {
  notice: $("#globalNotice"), adminEmail: $("#adminEmail"), logout: $("#logout"),
  productForm: $("#productForm"), productFormTitle: $("#productFormTitle"), cancelEdit: $("#cancelEdit"), resetProduct: $("#resetProduct"), saveProduct: $("#saveProduct"),
  colorChoices: $("#colorChoices"), sizeChoices: $("#sizeChoices"), customColors: $("#customColors"), stockEditor: $("#stockEditor"), imageColorSelect: $("#imageColorSelect"), productImages: $("#productImages"), preview: $("#preview"), uploadProductImages: $("#uploadProductImages"), uploadBar: $("#uploadBar"), uploadStatus: $("#uploadStatus"), uploadedImagesList: $("#uploadedImagesList"),
  productsList: $("#productsList"), refreshProducts: $("#refreshProducts"),
  bannerFile: $("#bannerFile"), bannerPreview: $("#bannerPreview"), bannerUpload: $("#bannerUpload"), bannerBar: $("#bannerBar"), bannerStatus: $("#bannerStatus"), bannersList: $("#bannersList"), refreshBanners: $("#refreshBanners"),
  offerForm: $("#offerForm"), ordersList: $("#ordersList"), refreshOrders: $("#refreshOrders"), dashboardRefresh: $("#dashboardRefresh"),
  productsCount: $("#productsCount"), ordersCount: $("#ordersCount"), salesCount: $("#salesCount")
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(n || 0)) + " ج";

function notice(message, type = "info") {
  els.notice.textContent = message;
  els.notice.className = `admin-notice ${type}`;
  clearTimeout(notice._timer);
  notice._timer = setTimeout(() => els.notice.classList.add("hidden"), 4500);
}

function setBusy(button, busy, busyText = "جاري التنفيذ...") {
  if (!button) return;
  if (busy) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = busyText; }
  else { button.disabled = false; button.textContent = button.dataset.originalText || button.textContent; }
}

async function getAuthHeaders(json = false) {
  const user = auth.currentUser;
  if (!user) throw new Error("يجب تسجيل الدخول أولاً");
  const token = await user.getIdToken(true);
  const headers = { Authorization: `Bearer ${token}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function api(path, options = {}) {
  const opts = { method: "GET", ...options };
  const isForm = opts.body instanceof FormData;
  opts.headers = { ...(opts.headers || {}), ...(await getAuthHeaders(Boolean(opts.body && !isForm))) };
  if (opts.body && !isForm && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, opts);
  } catch (networkError) {
    throw new Error("تعذر الاتصال بالخادم. تأكد من أن التطبيق يعمل ثم أعد المحاولة.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const statusMessage = response.status === 401 ? "انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى."
      : response.status === 403 ? "ليس لديك صلاحية لتنفيذ هذه العملية."
      : response.status === 413 ? "حجم الصورة كبير جداً."
      : "";
    throw new Error(data.error || statusMessage || `فشل الطلب (${response.status})`);
  }
  return data;
}

function selectedColors() {
  const preset = $$("input:checked", els.colorChoices).map((x) => x.value.trim());
  const custom = (els.customColors.value || "").split(/[،,]/).map((x) => x.trim()).filter(Boolean);
  return [...new Set([...preset, ...custom])];
}
function selectedSizes() { return $$("input:checked", els.sizeChoices).map((x) => x.value); }

function syncProductOptions() {
  const colors = selectedColors();
  const sizes = selectedSizes();
  const oldValues = new Map($$("input[data-stock-key]", els.stockEditor).map((input) => [input.dataset.stockKey, input.value]));
  els.imageColorSelect.innerHTML = colors.length
    ? colors.map((color) => `<option value="${esc(color)}">${esc(color)}</option>`).join("")
    : `<option value="">اختر لوناً أولاً</option>`;
  if (!colors.length || !sizes.length) {
    els.stockEditor.innerHTML = `<p class="muted">اختر لوناً ومقاساً واحداً على الأقل لتحديد الكمية.</p>`;
    return;
  }
  els.stockEditor.innerHTML = `<h3>الكمية المتاحة لكل لون ومقاس</h3><div class="stock-table">${colors.map((color) => {
    const cells = sizes.map((size) => {
      const key = `${color}||${size}`;
      return `<label>${esc(size)}<input type="number" min="0" value="${esc(oldValues.get(key) ?? 0)}" data-stock-key="${esc(key)}"></label>`;
    }).join("");
    return `<div class="stock-row"><b>${esc(color)}</b>${cells}</div>`;
  }).join("")}</div>`;
}

function stockFromEditor() {
  const stock = {};
  $$("input[data-stock-key]", els.stockEditor).forEach((input) => {
    const [color, size] = input.dataset.stockKey.split("||");
    stock[color] ||= {};
    stock[color][size] = Math.max(0, Number(input.value || 0));
  });
  return stock;
}

function previewFiles(input, target) {
  target.innerHTML = "";
  Array.from(input.files || []).forEach((file) => {
    const url = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = url; img.alt = file.name;
    img.onload = () => URL.revokeObjectURL(url);
    target.appendChild(img);
  });
}

async function uploadFiles(files, folder) {
  const fd = new FormData();
  Array.from(files).forEach((file) => fd.append("files", file));
  fd.append("folder", folder);
  let response;
  try {
    response = await fetch(`${API_URL}/upload`, { method: "POST", headers: await getAuthHeaders(), body: fd });
  } catch {
    throw new Error("تعذر الاتصال بخدمة رفع الصور. تأكد من أن الخادم يعمل.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || (response.status === 401 ? "انتهت جلسة الدخول. أعد تسجيل الدخول." : response.status === 403 ? "ليس لديك صلاحية لرفع الصور." : "فشل رفع الصور"));
  }
  if (!Array.isArray(data.files) || !data.files.length) throw new Error("لم يستقبل الخادم أي رابط للصورة بعد الرفع.");
  return data.files;
}

function renderUploadedImages() {
  els.uploadedImagesList.innerHTML = state.uploadedImages.map((image, index) => `
    <article class="uploaded-image">
      <img src="${esc(image.url)}" alt="صورة المنتج">
      <span>${esc(image.color)}</span>
      <button type="button" data-remove-image="${index}" aria-label="حذف الصورة">×</button>
    </article>`).join("") || `<p class="muted">لم يتم رفع صور للمنتج بعد.</p>`;
}

function resetProductForm() {
  state.editingProductId = null;
  state.uploadedImages = [];
  els.productForm.reset();
  $$("input", els.colorChoices).forEach((input) => input.checked = input.value === "أبيض");
  $$("input", els.sizeChoices).forEach((input) => input.checked = ["M", "L", "XL", "XXL"].includes(input.value));
  els.customColors.value = "";
  els.preview.innerHTML = "";
  els.productImages.value = "";
  els.uploadBar.style.width = "0";
  els.uploadStatus.textContent = "";
  els.productFormTitle.textContent = "إضافة منتج";
  els.cancelEdit.classList.add("hidden");
  els.saveProduct.textContent = "حفظ المنتج";
  syncProductOptions();
  renderUploadedImages();
}

async function loadProducts() {
  els.productsList.innerHTML = `<p class="muted">جاري تحميل المنتجات...</p>`;
  try {
    const { products = [] } = await api("/admin/products");
    state.products = products;
    els.productsList.innerHTML = products.map((product) => `
      <article class="manager-card">
        <img src="${esc(product.images?.[0]?.url || "")}" alt="${esc(product.name)}">
        <div><b>${esc(product.name)}</b><p>${money(product.salePrice)} ${product.active === false ? "• مخفي" : "• ظاهر"}</p><small>${esc((product.colors || []).join(" • "))}</small></div>
        <div class="manager-actions">
          <button type="button" class="btn ghost small-btn" data-edit-product="${esc(product.id)}">تعديل / استبدال</button>
          <button type="button" class="btn danger small-btn" data-delete-product="${esc(product.id)}">حذف</button>
        </div>
      </article>`).join("") || `<p class="muted">لا توجد منتجات حتى الآن.</p>`;
  } catch (error) {
    els.productsList.innerHTML = `<p class="admin-error">${esc(error.message)}</p>`;
    notice(error.message, "error");
  }
}

function editProduct(product) {
  if (!product) return;
  state.editingProductId = product.id;
  state.uploadedImages = Array.isArray(product.images) ? product.images.map((image) => ({ ...image })) : [];
  els.productForm.elements.name.value = product.name || "";
  els.productForm.elements.category.value = product.category || "تصميمات";
  els.productForm.elements.salePrice.value = product.salePrice ?? "";
  els.productForm.elements.oldPrice.value = product.oldPrice ?? "";
  els.productForm.elements.description.value = product.description || "";
  const preset = $$("input", els.colorChoices).map((input) => input.value);
  $$("input", els.colorChoices).forEach((input) => input.checked = (product.colors || []).includes(input.value));
  els.customColors.value = (product.colors || []).filter((color) => !preset.includes(color)).join("، ");
  $$("input", els.sizeChoices).forEach((input) => input.checked = (product.sizes || []).includes(input.value));
  syncProductOptions();
  Object.entries(product.stock || {}).forEach(([color, sizes]) => Object.entries(sizes || {}).forEach(([size, quantity]) => {
    const key = `${color}||${size}`;
    const input = $$("input[data-stock-key]", els.stockEditor).find((item) => item.dataset.stockKey === key);
    if (input) input.value = quantity;
  }));
  renderUploadedImages();
  els.productFormTitle.textContent = `تعديل: ${product.name}`;
  els.cancelEdit.classList.remove("hidden");
  els.saveProduct.textContent = "حفظ التعديلات";
  showView("product");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveProduct(event) {
  event.preventDefault();
  const form = new FormData(els.productForm);
  const colors = selectedColors();
  const sizes = selectedSizes();
  const name = String(form.get("name") || "").trim();
  const salePrice = Number(form.get("salePrice") || 0);
  if (!name || salePrice <= 0) return notice("اكتب اسم المنتج وسعر البيع بشكل صحيح.", "error");
  if (!colors.length || !sizes.length) return notice("اختر لوناً ومقاساً واحداً على الأقل.", "error");
  if (!state.uploadedImages.length) return notice("ارفع صورة واحدة على الأقل قبل حفظ المنتج.", "error");
  const payload = {
    name, category: form.get("category"), salePrice,
    oldPrice: Number(form.get("oldPrice") || 0), description: String(form.get("description") || ""),
    colors, sizes, stock: stockFromEditor(), images: state.uploadedImages
  };
  try {
    setBusy(els.saveProduct, true, state.editingProductId ? "جاري حفظ التعديلات..." : "جاري حفظ المنتج...");
    if (state.editingProductId) await api(`/admin/products/${encodeURIComponent(state.editingProductId)}`, { method: "PATCH", body: payload });
    else await api("/admin/products", { method: "POST", body: payload });
    notice(state.editingProductId ? "تم تعديل المنتج بنجاح." : "تم حفظ المنتج وظهوره في المتجر.", "success");
    resetProductForm();
    await Promise.all([loadProducts(), loadStats()]);
  } catch (error) { notice(error.message || "فشل حفظ المنتج.", "error"); }
  finally { setBusy(els.saveProduct, false); }
}

async function loadBanners() {
  els.bannersList.innerHTML = `<p class="muted">جاري تحميل البانرات...</p>`;
  try {
    const { banners = [] } = await api("/admin/banners");
    state.banners = banners;
    els.bannersList.innerHTML = banners.map((banner) => `
      <article class="banner-manager-item">
        <img src="${esc(banner.imageUrl)}" alt="بانر">
        <div><b>${banner.active === false ? "مخفي" : "ظاهر"}</b><div class="manager-actions">
          <button type="button" class="btn ghost small-btn" data-toggle-banner="${esc(banner.id)}" data-active="${banner.active !== false}">${banner.active === false ? "إظهار" : "إخفاء"}</button>
          <button type="button" class="btn danger small-btn" data-delete-banner="${esc(banner.id)}">حذف</button>
        </div></div>
      </article>`).join("") || `<p class="muted">لا توجد بانرات مرفوعة.</p>`;
  } catch (error) { els.bannersList.innerHTML = `<p class="admin-error">${esc(error.message)}</p>`; notice(error.message, "error"); }
}

async function loadOrders() {
  els.ordersList.innerHTML = `<p class="muted">جاري تحميل الطلبات...</p>`;
  try {
    const { orders = [] } = await api("/admin/orders");
    const statuses = ["جديد", "قيد التجهيز", "تم الشحن", "تم التوصيل", "ملغي", "مرتجع"];
    const payments = ["pending", "paid", "failed", "refunded"];
    els.ordersList.innerHTML = orders.map((order) => `
      <article class="order-card">
        <div class="order-main">
          <b>${esc(order.orderCode || order.id)}</b><span>${esc(order.customerName || "")}</span><span>${esc(order.phone || "")}</span>
          <span>${esc(order.productName || "")} • ${esc(order.color || "")} • ${esc(order.size || "")} × ${Number(order.quantity || 1)}</span><strong>${money(order.total)}</strong>
        </div>
        <div class="order-controls">
          <label>حالة الطلب<select data-order-status="${esc(order.id)}">${statuses.map((status) => `<option value="${esc(status)}" ${status === order.status ? "selected" : ""}>${esc(status)}</option>`).join("")}</select></label>
          <label>حالة الدفع<select data-payment-status="${esc(order.id)}">${payments.map((status) => `<option value="${esc(status)}" ${status === order.paymentStatus ? "selected" : ""}>${esc(status)}</option>`).join("")}</select></label>
          <button type="button" class="btn small-btn" data-save-order="${esc(order.id)}">حفظ الحالة</button>
        </div>
      </article>`).join("") || `<p class="muted">لا توجد طلبات حتى الآن.</p>`;
  } catch (error) { els.ordersList.innerHTML = `<p class="admin-error">${esc(error.message)}</p>`; notice(error.message, "error"); }
}

async function loadStats() {
  try {
    const { stats } = await api("/admin/stats");
    els.productsCount.textContent = stats.products ?? 0;
    els.ordersCount.textContent = stats.orders ?? 0;
    els.salesCount.textContent = money(stats.sales ?? 0);
  } catch (error) { console.warn("Stats error", error); }
}

function showView(name) {
  $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === name));
  $$(".admin-nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
}

// Navigation
$$(".admin-nav-btn").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$$("[data-go-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.goView)));

// Product options and uploads
els.colorChoices.addEventListener("change", syncProductOptions);
els.sizeChoices.addEventListener("change", syncProductOptions);
els.customColors.addEventListener("input", syncProductOptions);
els.productImages.addEventListener("change", () => previewFiles(els.productImages, els.preview));
els.uploadProductImages.addEventListener("click", async () => {
  const color = els.imageColorSelect.value;
  const files = Array.from(els.productImages.files || []);
  if (!color) return notice("اختر لون الصور أولاً.", "error");
  if (!files.length) return notice("اختر صورة واحدة أو أكثر أولاً.", "error");
  try {
    setBusy(els.uploadProductImages, true, "جاري رفع الصور...");
    els.uploadBar.style.width = "30%"; els.uploadStatus.textContent = "جاري إرسال الصور...";
    const uploaded = await uploadFiles(files, "/axel/products");
    els.uploadBar.style.width = "100%";
    state.uploadedImages.push(...uploaded.map((file) => ({ color, url: file.url, fileId: file.fileId })));
    els.productImages.value = ""; els.preview.innerHTML = "";
    els.uploadStatus.textContent = `تم رفع ${uploaded.length} صورة للون ${color}.`;
    renderUploadedImages(); notice("تم رفع الصور بنجاح.", "success");
  } catch (error) { els.uploadBar.style.width = "0"; els.uploadStatus.textContent = error.message; notice(error.message, "error"); }
  finally { setBusy(els.uploadProductImages, false); }
});
els.uploadedImagesList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-image]");
  if (!button) return;
  const index = Number(button.dataset.removeImage); const image = state.uploadedImages[index];
  if (!confirm("حذف هذه الصورة من المنتج؟")) return;
  state.uploadedImages.splice(index, 1); renderUploadedImages();
  if (image?.fileId) api(`/upload/${encodeURIComponent(image.fileId)}`, { method: "DELETE" }).catch(() => {});
});
els.productForm.addEventListener("submit", saveProduct);
els.resetProduct.addEventListener("click", resetProductForm);
els.cancelEdit.addEventListener("click", resetProductForm);
els.refreshProducts.addEventListener("click", loadProducts);
els.productsList.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-product]");
  const deleteButton = event.target.closest("[data-delete-product]");
  if (editButton) return editProduct(state.products.find((product) => product.id === editButton.dataset.editProduct));
  if (deleteButton) {
    if (!confirm("متأكد من حذف المنتج نهائياً؟")) return;
    try { setBusy(deleteButton, true, "جاري الحذف..."); await api(`/admin/products/${encodeURIComponent(deleteButton.dataset.deleteProduct)}`, { method: "DELETE" }); notice("تم حذف المنتج.", "success"); await Promise.all([loadProducts(), loadStats()]); }
    catch (error) { notice(error.message, "error"); } finally { setBusy(deleteButton, false); }
  }
});

// Banners
els.bannerFile.addEventListener("change", () => previewFiles(els.bannerFile, els.bannerPreview));
els.bannerUpload.addEventListener("click", async () => {
  const file = els.bannerFile.files?.[0];
  if (!file) return notice("اختر صورة البانر أولاً.", "error");
  try {
    setBusy(els.bannerUpload, true, "جاري رفع البانر...");
    els.bannerBar.style.width = "35%"; els.bannerStatus.textContent = "جاري رفع الصورة...";
    const [uploaded] = await uploadFiles([file], "/axel/banners");
    els.bannerBar.style.width = "75%";
    await api("/admin/banners", { method: "POST", body: { imageUrl: uploaded.url, fileId: uploaded.fileId } });
    els.bannerBar.style.width = "100%"; els.bannerStatus.textContent = "تم رفع البانر بنجاح.";
    els.bannerFile.value = ""; els.bannerPreview.innerHTML = "";
    await loadBanners(); notice("تمت إضافة البانر وسيظهر في الصفحة الرئيسية.", "success");
  } catch (error) { els.bannerBar.style.width = "0"; els.bannerStatus.textContent = error.message; notice(error.message, "error"); }
  finally { setBusy(els.bannerUpload, false); }
});
els.refreshBanners.addEventListener("click", loadBanners);
els.bannersList.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-toggle-banner]"); const remove = event.target.closest("[data-delete-banner]");
  try {
    if (toggle) await api(`/admin/banners/${encodeURIComponent(toggle.dataset.toggleBanner)}`, { method: "PATCH", body: { active: toggle.dataset.active !== "true" } });
    if (remove) { if (!confirm("حذف البانر؟")) return; await api(`/admin/banners/${encodeURIComponent(remove.dataset.deleteBanner)}`, { method: "DELETE" }); }
    await loadBanners(); notice("تم تحديث البانرات.", "success");
  } catch (error) { notice(error.message, "error"); }
});
els.offerForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(els.offerForm);
  try { await api("/admin/offers", { method: "POST", body: { title: form.get("title"), endsAt: form.get("endsAt") } }); els.offerForm.reset(); notice("تمت إضافة العرض.", "success"); }
  catch (error) { notice(error.message, "error"); }
});

// Orders
els.refreshOrders.addEventListener("click", loadOrders);
els.ordersList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-order]"); if (!button) return;
  const id = button.dataset.saveOrder;
  const status = els.ordersList.querySelector(`[data-order-status="${CSS.escape(id)}"]`)?.value;
  const paymentStatus = els.ordersList.querySelector(`[data-payment-status="${CSS.escape(id)}"]`)?.value;
  try { setBusy(button, true, "جاري الحفظ..."); await api(`/admin/orders/${encodeURIComponent(id)}`, { method: "PATCH", body: { status, paymentStatus } }); notice("تم تحديث حالة الطلب.", "success"); await loadStats(); }
  catch (error) { notice(error.message, "error"); } finally { setBusy(button, false); }
});

els.dashboardRefresh.addEventListener("click", async () => { setBusy(els.dashboardRefresh, true, "جاري التحديث..."); await Promise.all([loadStats(), loadProducts(), loadOrders(), loadBanners()]); setBusy(els.dashboardRefresh, false); notice("تم تحديث البيانات.", "success"); });
els.logout.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user || (user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) { location.href = "login.html"; return; }
  els.adminEmail.textContent = user.email;
  syncProductOptions(); renderUploadedImages();
  await Promise.all([loadStats(), loadProducts(), loadOrders(), loadBanners()]);
});
