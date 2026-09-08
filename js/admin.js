import { auth, db } from "./firebase.js";
import { ADMIN_EMAIL, API_URL } from "./config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, addDoc, getDocs, Timestamp, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const $ = s => document.querySelector(s);
let uploadedProductImages = [];

async function authHeaders() {
  const user = auth.currentUser;
  if (!user) throw new Error("يجب تسجيل الدخول أولاً");
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

onAuthStateChanged(auth, async u => {
  if (!u || u.email !== ADMIN_EMAIL) { location.href = "login.html"; return; }
  adminEmail.textContent = u.email;
  loadStats();
});
logout.onclick = () => signOut(auth);

async function uploadFiles(files, folder) {
  const fd = new FormData();
  [...files].forEach(file => fd.append("files", file));
  fd.append("folder", folder);
  const r = await fetch(`${API_URL}/upload`, { method: "POST", headers: await authHeaders(), body: fd });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.error || "فشل الرفع");
  return data.files;
}

productImages.onchange = () => {
  preview.innerHTML = [...productImages.files].map(f => `<img src="${URL.createObjectURL(f)}">`).join("");
};

uploadProductImages.onclick = async () => {
  if (!productImages.files.length) return alert("اختر الصور أولاً");
  try {
    uploadBar.style.width = "20%";
    uploadStatus.textContent = "جاري رفع الصور...";
    const color = colorSelect.value;
    const files = await uploadFiles(productImages.files, "/axel/products");
    uploadedProductImages.push(...files.map(x => ({ color, url: x.url, fileId: x.fileId })));
    uploadBar.style.width = "100%";
    uploadStatus.textContent = `تم رفع ${files.length} صورة بنجاح`;
    productImages.value = "";
    preview.innerHTML = "";
  } catch (e) {
    uploadBar.style.width = "0";
    uploadStatus.textContent = e.message || "فشل رفع الصور";
  }
};

productForm.onsubmit = async e => {
  e.preventDefault();
  if (!uploadedProductImages.length) return alert("ارفع صور المنتج أولاً");
  const f = new FormData(productForm);
  const stock = {};
  ["أبيض", "لبني", "بترولي"].forEach(c => stock[c] = { M: 8, L: c === "أبيض" ? 1 : 0, XL: 8, XXL: 8 });
  await addDoc(collection(db, "products"), {
    name: f.get("name"), category: f.get("category"), salePrice: Number(f.get("salePrice")), oldPrice: Number(f.get("oldPrice")),
    description: f.get("description"), images: uploadedProductImages, sizes: ["M", "L", "XL", "XXL"], stock, active: true, createdAt: Timestamp.now()
  });
  uploadedProductImages = [];
  productForm.reset();
  alert("تم حفظ المنتج");
  loadStats();
};

bannerUpload.onclick = async () => {
  if (!bannerFile.files[0]) return alert("اختر بانر");
  try {
    bannerBar.style.width = "20%";
    const files = await uploadFiles([bannerFile.files[0]], "/axel/banners");
    bannerBar.style.width = "100%";
    await addDoc(collection(db, "banners"), { imageUrl: files[0].url, fileId: files[0].fileId, active: true, createdAt: Timestamp.now() });
    alert("تم رفع البانر");
    bannerFile.value = "";
  } catch (e) { alert(e.message || "فشل رفع البانر"); }
};

offerForm.onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(offerForm);
  await addDoc(collection(db, "offers"), { title: f.get("title"), endsAt: new Date(f.get("endsAt")), active: true, createdAt: Timestamp.now() });
  offerForm.reset();
  alert("تمت إضافة العرض");
};

async function loadStats() {
  try {
    const r = await fetch(`${API_URL}/admin/stats`, { headers: await authHeaders() });
    const data = await r.json();
    if (r.ok && data.ok) {
      productsCount.textContent = data.stats.products;
      ordersCount.textContent = data.stats.orders;
      salesCount.textContent = `${data.stats.sales} ج`;
      ordersList.innerHTML = data.recentOrders.map(o => `<div class="table-item"><span>${o.orderCode || o.id.slice(0, 8)}</span><span>${o.status || "جديد"} - ${o.paymentStatus || "pending"}</span></div>`).join("") || "لا توجد طلبات";
    }
  } catch (_) {}
  const p = await getDocs(collection(db, "products"));
  productsList.innerHTML = p.docs.map(x => `<div class="table-item"><span>${x.data().name}</span><span>${x.data().salePrice} ج</span></div>`).join("");
}
