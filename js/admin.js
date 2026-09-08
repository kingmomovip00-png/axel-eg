import { auth } from "./firebase.js";
import { ADMIN_EMAIL, API_URL } from "./config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let uploadedProductImages = [];
let editingProductId = null;

const els = {
  adminEmail: $("#adminEmail"), logout: $("#logout"), productForm: $("#productForm"), productFormTitle: $("#productFormTitle"),
  cancelEdit: $("#cancelEdit"), colorChoices: $("#colorChoices"), sizeChoices: $("#sizeChoices"), customColors: $("#customColors"),
  stockEditor: $("#stockEditor"), imageColorSelect: $("#imageColorSelect"), productImages: $("#productImages"), preview: $("#preview"),
  uploadProductImages: $("#uploadProductImages"), uploadBar: $("#uploadBar"), uploadStatus: $("#uploadStatus"), uploadedImagesList: $("#uploadedImagesList"),
  bannerFile: $("#bannerFile"), bannerPreview: $("#bannerPreview"), bannerUpload: $("#bannerUpload"), bannerBar: $("#bannerBar"), bannerStatus: $("#bannerStatus"),
  bannerList: $("#bannersList"), offerForm: $("#offerForm"), productsList: $("#productsList"), ordersList: $("#ordersList"),
  productsCount: $("#productsCount"), ordersCount: $("#ordersCount"), salesCount: $("#salesCount")
};

const esc = value => String(value ?? "").replace(/[&<>'\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
const money = n => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(n || 0)) + " ج";

async function authHeaders(json = false) {
  const user = auth.currentUser;
  if (!user) throw new Error("يجب تسجيل الدخول أولاً");
  const headers = { Authorization: `Bearer ${await user.getIdToken()}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function api(path, options = {}) {
  const opts = { ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { ...(opts.headers || {}), ...(await authHeaders(true)) };
    opts.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  } else {
    opts.headers = { ...(opts.headers || {}), ...(await authHeaders(false)) };
  }
  const r = await fetch(`${API_URL}${path}`, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || "حدث خطأ");
  return data;
}

function selectedColors() {
  const checked = $$("#colorChoices input:checked").map(x => x.value.trim());
  const custom = els.customColors.value.split(/[،,]/).map(x => x.trim()).filter(Boolean);
  return [...new Set([...checked, ...custom])];
}
function selectedSizes() { return $$("#sizeChoices input:checked").map(x => x.value); }

function syncProductOptions() {
  const colors = selectedColors(); const sizes = selectedSizes();
  els.imageColorSelect.innerHTML = colors.length ? colors.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("") : `<option value="">اختر لوناً أولاً</option>`;
  const old = new Map($$("#stockEditor input").map(i => [i.name, i.value]));
  if (!colors.length || !sizes.length) { els.stockEditor.innerHTML = `<p class="muted">اختر لوناً واحداً ومقاساً واحداً على الأقل.</p>`; return; }
  els.stockEditor.innerHTML = `<h3>الكمية المتاحة لكل مقاس ولون</h3><div class="stock-table">${colors.map(c => `<div class="stock-row"><b>${esc(c)}</b>${sizes.map(s => { const key = `${c}__${s}`; return `<label>${s}<input type="number" min="0" value="${old.get(key) ?? 0}" name="${esc(key)}"></label>`; }).join("")}</div>`).join("")}</div>`;
}

function stockFromEditor() {
  const stock = {}; const colors = selectedColors(); const sizes = selectedSizes();
  colors.forEach(c => { stock[c] = {}; sizes.forEach(s => { const input = els.stockEditor.querySelector(`[name="${CSS.escape(`${c}__${s}`)}"]`); stock[c][s] = Math.max(0, Number(input?.value || 0)); }); });
  return stock;
}

async function uploadFiles(files, folder) {
  const fd = new FormData(); [...files].forEach(file => fd.append("files", file)); fd.append("folder", folder);
  const r = await fetch(`${API_URL}/upload`, { method: "POST", headers: await authHeaders(), body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.error || "فشل الرفع");
  return data.files;
}

function renderUploadedImages() {
  els.uploadedImagesList.innerHTML = uploadedProductImages.map((img, i) => `<div class="uploaded-image"><img src="${esc(img.url)}"><span>${esc(img.color)}</span><button type="button" data-remove-image="${i}">×</button></div>`).join("");
}

els.colorChoices.addEventListener("change", syncProductOptions);
els.sizeChoices.addEventListener("change", syncProductOptions);
els.customColors.addEventListener("input", syncProductOptions);

els.productImages.onchange = () => {
  els.preview.innerHTML = [...els.productImages.files].map(f => `<img src="${URL.createObjectURL(f)}" alt="preview">`).join("");
};

els.uploadProductImages.onclick = async () => {
  const color = els.imageColorSelect.value;
  if (!color) return alert("اختر لون المنتج أولاً");
  if (!els.productImages.files.length) return alert("اختر صورة واحدة أو أكثر أولاً");
  try {
    els.uploadProductImages.disabled = true; els.uploadBar.style.width = "25%"; els.uploadStatus.textContent = "جاري رفع الصور...";
    const files = await uploadFiles(els.productImages.files, "/axel/products");
    uploadedProductImages.push(...files.map(x => ({ color, url: x.url, fileId: x.fileId })));
    els.uploadBar.style.width = "100%"; els.uploadStatus.textContent = `تم رفع ${files.length} صورة للون ${color}`;
    els.productImages.value = ""; els.preview.innerHTML = ""; renderUploadedImages();
  } catch (e) { els.uploadBar.style.width = "0"; els.uploadStatus.textContent = e.message || "فشل رفع الصور"; }
  finally { els.uploadProductImages.disabled = false; }
};

els.uploadedImagesList.onclick = async e => {
  const btn = e.target.closest("[data-remove-image]"); if (!btn) return;
  const index = Number(btn.dataset.removeImage); const image = uploadedProductImages[index];
  if (!confirm("حذف هذه الصورة من المنتج؟")) return;
  uploadedProductImages.splice(index, 1); renderUploadedImages();
  if (image?.fileId) api(`/upload/${encodeURIComponent(image.fileId)}`, { method: "DELETE" }).catch(() => {});
};

els.productForm.onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(els.productForm); const colors = selectedColors(); const sizes = selectedSizes();
  if (!colors.length || !sizes.length) return alert("اختر الألوان والمقاسات");
  if (!uploadedProductImages.length) return alert("ارفع صورة واحدة على الأقل للمنتج");
  const payload = { name: f.get("name"), category: f.get("category"), salePrice: Number(f.get("salePrice")), oldPrice: Number(f.get("oldPrice")), description: f.get("description"), colors, sizes, stock: stockFromEditor(), images: uploadedProductImages };
  try {
    const button = $("#saveProduct"); button.disabled = true; button.textContent = "جاري الحفظ...";
    if (editingProductId) await api(`/admin/products/${editingProductId}`, { method: "PATCH", body: payload });
    else await api("/admin/products", { method: "POST", body: payload });
    alert(editingProductId ? "تم تعديل المنتج" : "تم حفظ المنتج وظهوره في المتجر");
    resetProductForm(); await loadStats(); await loadProducts();
  } catch (err) { alert(err.message || "فشل حفظ المنتج"); }
  finally { const button = $("#saveProduct"); button.disabled = false; button.textContent = editingProductId ? "حفظ التعديلات" : "حفظ المنتج"; }
};

function resetProductForm() {
  editingProductId = null; uploadedProductImages = []; els.productForm.reset();
  $$("#colorChoices input").forEach(x => x.checked = x.value === "أبيض");
  $$("#sizeChoices input").forEach(x => x.checked = ["M","L","XL","XXL"].includes(x.value));
  els.customColors.value = ""; els.preview.innerHTML = ""; els.uploadedImagesList.innerHTML = ""; els.uploadStatus.textContent = ""; els.uploadBar.style.width = "0";
  els.productFormTitle.textContent = "إضافة منتج"; els.cancelEdit.classList.add("hidden"); $("#saveProduct").textContent = "حفظ المنتج"; syncProductOptions();
}
els.cancelEdit.onclick = resetProductForm;

els.bannerFile.onchange = () => {
  const file = els.bannerFile.files[0]; els.bannerPreview.innerHTML = file ? `<img src="${URL.createObjectURL(file)}" alt="banner preview">` : "";
};
els.bannerUpload.onclick = async () => {
  if (!els.bannerFile.files[0]) return alert("اختر صورة البانر أولاً");
  try {
    els.bannerUpload.disabled = true; els.bannerBar.style.width = "30%"; els.bannerStatus.textContent = "جاري رفع البانر...";
    const [file] = await uploadFiles([els.bannerFile.files[0]], "/axel/banners");
    els.bannerBar.style.width = "75%"; await api("/admin/banners", { method: "POST", body: { imageUrl: file.url, fileId: file.fileId } });
    els.bannerBar.style.width = "100%"; els.bannerStatus.textContent = "تم رفع البانر وسيظهر في الصفحة الرئيسية"; els.bannerFile.value = ""; els.bannerPreview.innerHTML = ""; await loadBanners();
  } catch (e) { els.bannerBar.style.width = "0"; els.bannerStatus.textContent = e.message || "فشل رفع البانر"; }
  finally { els.bannerUpload.disabled = false; }
};

els.offerForm.onsubmit = async e => {
  e.preventDefault(); const f = new FormData(els.offerForm);
  try { await api("/admin/offers", { method: "POST", body: { title: f.get("title"), endsAt: f.get("endsAt") } }); els.offerForm.reset(); alert("تمت إضافة العرض"); }
  catch (err) { alert(err.message); }
};

async function loadProducts() {
  try {
    const { products } = await api("/admin/products");
    els.productsList.innerHTML = products.map(p => `<article class="manager-card"><img src="${esc(p.images?.[0]?.url || "")}" alt=""><div><b>${esc(p.name)}</b><p>${money(p.salePrice)} ${p.active === false ? "• مخفي" : "• ظاهر"}</p><small>${esc((p.colors || []).join(" • "))} | ${esc((p.sizes || []).join(" • "))}</small></div><div class="manager-actions"><button class="btn ghost" data-edit-product="${p.id}">تعديل / استبدال</button><button class="btn danger" data-delete-product="${p.id}">حذف</button></div></article>`).join("") || `<p class="muted">لا توجد منتجات بعد.</p>`;
    els.productsList._data = products;
  } catch (e) { els.productsList.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

els.productsList.onclick = async e => {
  const edit = e.target.closest("[data-edit-product]"); const del = e.target.closest("[data-delete-product]");
  if (edit) {
    const p = (els.productsList._data || []).find(x => x.id === edit.dataset.editProduct); if (!p) return;
    editingProductId = p.id; uploadedProductImages = [...(p.images || [])];
    els.productForm.elements.name.value = p.name || ""; els.productForm.elements.category.value = p.category || "تصميمات"; els.productForm.elements.salePrice.value = p.salePrice || ""; els.productForm.elements.oldPrice.value = p.oldPrice || ""; els.productForm.elements.description.value = p.description || "";
    $$("#colorChoices input").forEach(x => x.checked = (p.colors || []).includes(x.value));
    const knownColors = $$("#colorChoices input").map(x => x.value); els.customColors.value = (p.colors || []).filter(c => !knownColors.includes(c)).join("، ");
    $$("#sizeChoices input").forEach(x => x.checked = (p.sizes || []).includes(x.value)); syncProductOptions();
    Object.entries(p.stock || {}).forEach(([c, sizes]) => Object.entries(sizes || {}).forEach(([s, qty]) => { const input = els.stockEditor.querySelector(`[name="${CSS.escape(`${c}__${s}`)}"]`); if (input) input.value = qty; }));
    renderUploadedImages(); els.productFormTitle.textContent = `تعديل: ${p.name}`; els.cancelEdit.classList.remove("hidden"); $("#saveProduct").textContent = "حفظ التعديلات"; window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (del) {
    if (!confirm("متأكد أنك تريد حذف المنتج نهائياً؟")) return;
    try { await api(`/admin/products/${del.dataset.deleteProduct}`, { method: "DELETE" }); await loadProducts(); await loadStats(); }
    catch (err) { alert(err.message); }
  }
};

async function loadBanners() {
  try {
    const { banners } = await api("/admin/banners");
    els.bannerList.innerHTML = banners.map(b => `<article class="banner-manager-item"><img src="${esc(b.imageUrl)}"><div><b>${b.active === false ? "مخفي" : "ظاهر"}</b><div class="manager-actions"><button class="btn ghost" data-toggle-banner="${b.id}" data-active="${b.active !== false}">${b.active === false ? "إظهار" : "إخفاء"}</button><button class="btn danger" data-delete-banner="${b.id}">حذف</button></div></div></article>`).join("") || `<p class="muted">لا يوجد بانر مرفوع.</p>`;
  } catch (e) { els.bannerList.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
els.bannerList.onclick = async e => {
  const toggle = e.target.closest("[data-toggle-banner]"); const del = e.target.closest("[data-delete-banner]");
  try {
    if (toggle) await api(`/admin/banners/${toggle.dataset.toggleBanner}`, { method: "PATCH", body: { active: toggle.dataset.active !== "true" } });
    if (del && confirm("حذف البانر؟")) await api(`/admin/banners/${del.dataset.deleteBanner}`, { method: "DELETE" });
    await loadBanners();
  } catch (err) { alert(err.message); }
};

const statusOptions = ["جديد", "قيد التجهيز", "تم الشحن", "تم التوصيل", "ملغي", "مرتجع"];
const paymentOptions = ["pending", "paid", "failed", "refunded"];
async function loadOrders() {
  try {
    const { orders } = await api("/admin/orders");
    els.ordersList.innerHTML = orders.map(o => `<article class="order-card"><div class="order-main"><b>${esc(o.orderCode || o.id)}</b><span>${esc(o.customerName || "")}</span><span>${esc(o.phone || "")}</span><span>${esc(o.productName || "")} • ${esc(o.color || "")} • ${esc(o.size || "")} × ${Number(o.quantity || 1)}</span><strong>${money(o.total)}</strong></div><div class="order-controls"><label>حالة الطلب<select data-order-status="${o.id}">${statusOptions.map(s => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>حالة الدفع<select data-payment-status="${o.id}">${paymentOptions.map(s => `<option ${s === o.paymentStatus ? "selected" : ""}>${s}</option>`).join("")}</select></label><button class="btn" data-save-order="${o.id}">حفظ الحالة</button></div></article>`).join("") || `<p class="muted">لا توجد طلبات حتى الآن.</p>`;
  } catch (e) { els.ordersList.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
els.ordersList.onclick = async e => {
  const btn = e.target.closest("[data-save-order]"); if (!btn) return;
  const id = btn.dataset.saveOrder;
  try { btn.disabled = true; await api(`/admin/orders/${id}`, { method: "PATCH", body: { status: els.ordersList.querySelector(`[data-order-status="${id}"]`).value, paymentStatus: els.ordersList.querySelector(`[data-payment-status="${id}"]`).value } }); btn.textContent = "تم الحفظ ✓"; setTimeout(() => btn.textContent = "حفظ الحالة", 1200); }
  catch (err) { alert(err.message); } finally { btn.disabled = false; }
};

async function loadStats() {
  try { const { stats } = await api("/admin/stats"); els.productsCount.textContent = stats.products; els.ordersCount.textContent = stats.orders; els.salesCount.textContent = money(stats.sales); } catch (_) {}
}

$("#refreshProducts").onclick = loadProducts; $("#refreshOrders").onclick = loadOrders;
els.logout.onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (!user || (user.email || "").toLowerCase() !== ADMIN_EMAIL) { location.href = "login.html"; return; }
  els.adminEmail.textContent = user.email; syncProductOptions(); renderUploadedImages();
  await Promise.all([loadStats(), loadProducts(), loadOrders(), loadBanners()]);
});
