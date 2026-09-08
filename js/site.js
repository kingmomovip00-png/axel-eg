import { API_URL } from "./config.js";
const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(n || 0)) + " ج";

async function publicApi(path) {
  const r = await fetch(`${API_URL}${path}`); const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || "حدث خطأ"); return d;
}

function card(p) {
  return `<a class="card" href="product.html?id=${encodeURIComponent(p.id)}"><img loading="lazy" src="${p.images?.[0]?.url || ""}" alt="${String(p.name || "").replace(/\"/g, "&quot;")}"><div class="card-body"><b>${p.name || "منتج AXEL"}</b><div class="price">${money(p.salePrice)} ${p.oldPrice ? `<span class="old">${money(p.oldPrice)}</span>` : ""}</div></div></a>`;
}

async function home() {
  fetch(`${API_URL}/visits`, { method: "POST" }).catch(() => {});
  try {
    const [{ products }, { banners }, { offers }] = await Promise.all([
      publicApi("/products"), publicApi("/banners"), publicApi("/offers")
    ]);
    const shuffled = [...products].sort(() => Math.random() - .5);
    const designs = shuffled.filter(p => p.category !== "أنمي"); const anime = shuffled.filter(p => p.category === "أنمي");
    const dEl = $("#productsDesigns"); const aEl = $("#productsAnime");
    if (dEl) dEl.innerHTML = designs.map(card).join("") || `<p class="empty-state">لا توجد منتجات حالياً</p>`;
    if (aEl) aEl.innerHTML = anime.map(card).join("") || `<p class="empty-state">لا توجد رسومات أنمي حالياً</p>`;
    const hero = $("#hero");
    if (hero) hero.innerHTML = banners.length ? `<img src="${banners[Math.floor(Math.random() * banners.length)].imageUrl}" alt="AXEL banner">` : `<div class="hero-placeholder"><img src="assets/logo/logo.png" class="hero-logo" alt="AXEL"><p>أحدث التصميمات من AXEL</p></div>`;
    if (offers.length && $("#offer")) { const o = offers[0]; $("#offer").classList.remove("hidden"); $("#offerTitle").textContent = o.title; count(o.endsAt?.seconds ? o.endsAt.seconds * 1000 : new Date(o.endsAt).getTime()); }
  } catch (e) { console.error(e); }
}
function count(end) { const el = $("#countdown"); if (!el) return; const timer = setInterval(() => { const x = Math.max(0, end - Date.now()); const h = Math.floor(x / 3600000), m = Math.floor(x % 3600000 / 60000), s = Math.floor(x % 60000 / 1000); el.textContent = `${String(h).padStart(2,"0")} : ${String(m).padStart(2,"0")} : ${String(s).padStart(2,"0")}`; if (!x) clearInterval(timer); }, 1000); }

async function product() {
  const id = new URLSearchParams(location.search).get("id"); if (!id || !$("#pname")) return;
  try {
    const { product: p } = await publicApi(`/products/${encodeURIComponent(id)}`);
    const images = p.images || []; let color = (p.colors || [images[0]?.color]).find(Boolean) || ""; let size = (p.sizes || [])[0] || "M"; let quantity = 1;
    $("#pname").textContent = p.name; $("#pdesc").textContent = p.description || ""; $("#pprice").textContent = money(p.salePrice);
    const gallery = $("#gallery");
    function render() {
      const colorImages = images.filter(x => x.color === color); const list = colorImages.length ? colorImages : images;
      const main = list[0]; $("#pimage").src = main?.url || "";
      if (gallery) gallery.innerHTML = list.map((im, i) => `<button class="thumb ${i === 0 ? "active" : ""}" data-img="${i}"><img src="${im.url}" alt="${p.name}"></button>`).join("");
      const colors = p.colors?.length ? p.colors : [...new Set(images.map(x => x.color).filter(Boolean))];
      $("#colors").innerHTML = colors.map(c => `<button type="button" class="option ${c === color ? "active" : ""}" data-color="${c}">${c}</button>`).join("");
      $("#sizes").innerHTML = (p.sizes || ["M","L","XL","XXL"]).map(z => { const q = Number(p.stock?.[color]?.[z] || 0); return `<button type="button" class="option ${z === size ? "active" : ""} ${q <= 0 ? "sold-out" : ""}" data-size="${z}" ${q <= 0 ? "disabled" : ""}>${z}</button>`; }).join("");
      const available = Number(p.stock?.[color]?.[size] || 0); if (available <= 0) { const next = (p.sizes || []).find(z => Number(p.stock?.[color]?.[z] || 0) > 0); if (next && next !== size) { size = next; return render(); } }
      $("#stock").textContent = available ? `المتاح: ${available} قطعة` : "نفذت الكمية";
      $("#quantityValue").textContent = quantity; $("#buy").disabled = !available;
    }
    $("#colors").onclick = e => { const b = e.target.closest("[data-color]"); if (b) { color = b.dataset.color; const availableSize = (p.sizes || []).find(z => Number(p.stock?.[color]?.[z] || 0) > 0); if (availableSize) size = availableSize; quantity = 1; render(); } };
    $("#sizes").onclick = e => { const b = e.target.closest("[data-size]"); if (b && !b.disabled) { size = b.dataset.size; quantity = 1; render(); } };
    gallery?.addEventListener("click", e => { const b = e.target.closest("[data-img]"); if (!b) return; const list = images.filter(x => x.color === color); const activeList = list.length ? list : images; $("#pimage").src = activeList[Number(b.dataset.img)]?.url || ""; $$(".thumb").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
    $("#qtyMinus").onclick = () => { quantity = Math.max(1, quantity - 1); render(); };
    $("#qtyPlus").onclick = () => { const max = Number(p.stock?.[color]?.[size] || 0); quantity = Math.min(max || 1, quantity + 1); render(); };
    $("#buy").onclick = () => location.href = `checkout.html?id=${encodeURIComponent(id)}&color=${encodeURIComponent(color)}&size=${encodeURIComponent(size)}&quantity=${quantity}`;
    render();
  } catch (e) { $("#pname").textContent = e.message || "تعذر تحميل المنتج"; }
}
const $$ = s => [...document.querySelectorAll(s)];
home(); product();
