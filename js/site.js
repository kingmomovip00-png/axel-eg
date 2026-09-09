import { API_URL, SHIPPING_PRICE } from "./config.js";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const money = n => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(n || 0)) + " ج";
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const shuffle = arr => { const a = [...arr]; for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

async function publicApi(path) {
  const r = await fetch(`${API_URL}${path}`, { headers: { Accept: "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || "حدث خطأ أثناء الاتصال بالموقع");
  return d;
}

function randomImage(product) {
  const images = Array.isArray(product.images) ? product.images.filter(x => x?.url) : [];
  return images.length ? images[Math.floor(Math.random() * images.length)].url : "";
}

function card(p, index = 0) {
  const image = randomImage(p);
  return `<a class="card product-card reveal-card" style="--delay:${Math.min(index,8)*55}ms" href="product.html?id=${encodeURIComponent(p.id)}">
    <div class="card-media">${image ? `<img loading="lazy" decoding="async" src="${escapeHtml(image)}" alt="${escapeHtml(p.name || "منتج AXEL")}">` : `<div class="image-empty">AXEL</div>`}</div>
    <div class="card-body"><b>${escapeHtml(p.name || "منتج AXEL")}</b><div class="price">${money(p.salePrice)} ${p.oldPrice ? `<span class="old">${money(p.oldPrice)}</span>` : ""}</div><span class="card-action">عرض المنتج</span></div>
  </a>`;
}

function renderBanner(target, banner, index) {
  if (!target) return;
  if (!banner?.imageUrl) { target.innerHTML = `<div class="hero-placeholder"><img src="assets/logo/logo.png" class="hero-logo" alt="AXEL"><p>أحدث التصميمات من AXEL</p></div>`; return; }
  target.classList.remove("banner-enter"); void target.offsetWidth; target.classList.add("banner-enter");
  target.innerHTML = `<a href="${banner.linkUrl ? escapeHtml(banner.linkUrl) : "#designs"}" aria-label="عرض AXEL"><img src="${escapeHtml(banner.imageUrl)}" alt="AXEL" decoding="async"></a>`;
  const dots = target.parentElement?.querySelector(".banner-dots");
  if (dots) dots.innerHTML = "";
}

function setupBanners(banners) {
  const list = shuffle((banners || []).filter(b => b?.imageUrl));
  const source = list.length ? list : [null];
  let i1 = Math.floor(Math.random()*source.length), i2 = Math.floor(Math.random()*source.length);
  renderBanner($("#bannerOne"), source[i1], i1); renderBanner($("#bannerTwo"), source[i2], i2);
  const tick = () => { i1=(i1+1)%source.length; i2=(i2+1)%source.length; renderBanner($("#bannerOne"),source[i1],i1); renderBanner($("#bannerTwo"),source[i2],i2); };
  if (source.length > 1) setInterval(tick, 4000);
}

function setupRail(id) {
  const el = document.getElementById(id);
  if (!el) return;

  let timer = null;
  let resumeTimer = null;
  let dragging = false;
  let startX = 0;
  let startScroll = 0;

  const step = () => Math.max(220, Math.round(el.clientWidth * 0.72));
  const move = dir => el.scrollBy({ left: dir * step(), behavior: "smooth" });

  $$(`.slider-btn[data-slider="${id}"]`).forEach(btn => {
    btn.addEventListener("click", () => {
      pause();
      move(btn.dataset.dir === "next" ? -1 : 1);
      resumeSoon();
    });
  });

  function pause() {
    clearInterval(timer);
    timer = null;
  }

  function resumeSoon() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(start, 2500);
  }

  function start() {
    pause();
    if (el.scrollWidth <= el.clientWidth + 8) return;
    timer = setInterval(() => {
      if (document.visibilityState !== "visible" || dragging) return;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      const current = Math.abs(el.scrollLeft);
      const atEnd = current >= max - 6;
      move(atEnd ? 1 : -1);
    }, 4500);
  }

  el.addEventListener("pointerdown", e => {
    dragging = true;
    pause();
    startX = e.clientX;
    startScroll = el.scrollLeft;
    el.setPointerCapture?.(e.pointerId);
  });

  el.addEventListener("pointermove", e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    el.scrollLeft = startScroll - dx;
  });

  el.addEventListener("pointerup", e => {
    dragging = false;
    el.releasePointerCapture?.(e.pointerId);
    resumeSoon();
  });
  el.addEventListener("pointercancel", () => { dragging = false; resumeSoon(); });
  el.addEventListener("mouseenter", pause);
  el.addEventListener("mouseleave", () => { if (!dragging) resumeSoon(); });
  el.addEventListener("focusin", pause);
  el.addEventListener("focusout", resumeSoon);

  el.addEventListener("wheel", e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      pause();
      el.scrollLeft += e.deltaY;
      resumeSoon();
    }
  }, { passive:false });

  start();
}
function observeReveals() {
  const io = new IntersectionObserver(entries => entries.forEach(e => { if(e.isIntersecting){e.target.classList.add("is-visible");io.unobserve(e.target);}}), {threshold:.08});
  $$(".reveal-section,.reveal-card").forEach(x => io.observe(x));
}

async function home() {
  fetch(`${API_URL}/visits`, { method: "POST" }).catch(() => {});
  try {
    const [{ products }, { banners }, { offers }] = await Promise.all([
      publicApi("/products"), publicApi("/banners"), publicApi("/offers")
    ]);

    const shuffled = shuffle(products || []);
    const designs = shuffled.filter(p => p.category !== "أنمي");
    const anime = shuffled.filter(p => p.category === "أنمي");

    const dEl = $("#productsDesigns"), aEl = $("#productsAnime");
    if (dEl) dEl.innerHTML = designs.map(card).join("") || `<p class="empty-state">لا توجد منتجات حالياً</p>`;

    // The second section must always have a real grid. If no anime products
    // exist yet, show a separate shuffled selection of the normal collection.
    const secondGrid = anime.length ? anime : shuffle(designs).slice(0, 8);
    if (aEl) {
      aEl.innerHTML = secondGrid.map(card).join("") || `<p class="empty-state">لا توجد منتجات حالياً</p>`;
      const title = $("#animeTitle");
      if (title) title.textContent = anime.length ? "رسومات الأنمي" : "اختيارات AXEL";
    }

    setupBanners(banners || []);
    if (offers?.length && $("#offer")) {
      const o=offers[0]; $("#offer").classList.remove("hidden");
      $("#offerTitle").textContent=o.title||"عرض محدود";
      count(o.endsAt?.seconds ? o.endsAt.seconds*1000 : new Date(o.endsAt).getTime());
    }
    setupRail("designs");
    // The second section is a grid, not a horizontal slider.
    observeReveals();
  } catch(e) { console.error(e); showToast(e.message, true); }
}

function count(end) { const el=$("#countdown"); if(!el||!Number.isFinite(end))return; const timer=setInterval(()=>{const x=Math.max(0,end-Date.now());const h=Math.floor(x/3600000),m=Math.floor(x%3600000/60000),s=Math.floor(x%60000/1000);el.textContent=`${String(h).padStart(2,"0")} : ${String(m).padStart(2,"0")} : ${String(s).padStart(2,"0")}`;if(!x)clearInterval(timer)},1000); }

function showToast(msg, error=false) { const el=$("#siteToast"); if(!el)return; el.textContent=msg; el.classList.toggle("error",!!error); el.classList.remove("hidden"); clearTimeout(showToast.t); showToast.t=setTimeout(()=>el.classList.add("hidden"),4000); }

async function product() {
  const id=new URLSearchParams(location.search).get("id"); if(!id||!$("#pname"))return;
  try {
    const {product:p}=await publicApi(`/products/${encodeURIComponent(id)}`);
    const images=p.images||[]; let color=(p.colors||[images[0]?.color]).find(Boolean)||""; let size=(p.sizes||[])[0]||"M"; let quantity=1;
    $("#pname").textContent=p.name||"منتج AXEL"; $("#pdesc").textContent=p.description||"Oversize T-shirt"; $("#pprice").textContent=money(p.salePrice);
    const gallery=$("#gallery");
    function render(){const colorImages=images.filter(x=>x.color===color);const list=colorImages.length?shuffle(colorImages):shuffle(images);const main=list[0];$("#pimage").src=main?.url||"";if(gallery)gallery.innerHTML=list.map((im,i)=>`<button class="thumb ${i===0?"active":""}" data-img-url="${escapeHtml(im.url)}" type="button"><img loading="lazy" src="${escapeHtml(im.url)}" alt="${escapeHtml(p.name)}"></button>`).join("");const colors=p.colors?.length?p.colors:[...new Set(images.map(x=>x.color).filter(Boolean))];$("#colors").innerHTML=colors.map(c=>`<button type="button" class="option ${c===color?"active":""}" data-color="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");$("#sizes").innerHTML=(p.sizes||["M","L","XL","XXL"]).map(z=>{const q=Number(p.stock?.[color]?.[z]||0);return `<button type="button" class="option ${z===size?"active":""} ${q<=0?"sold-out":""}" data-size="${escapeHtml(z)}" ${q<=0?"disabled":""}>${escapeHtml(z)}</button>`}).join("");const available=Number(p.stock?.[color]?.[size]||0);if(available<=0){const next=(p.sizes||[]).find(z=>Number(p.stock?.[color]?.[z]||0)>0);if(next&&next!==size){size=next;return render();}}$("#stock").textContent=available?`المتاح: ${available} قطعة`:"نفذت الكمية";$("#quantityValue").textContent=quantity;$("#buy").disabled=!available;}
    $("#colors").onclick=e=>{const b=e.target.closest("[data-color]");if(b){color=b.dataset.color;const n=(p.sizes||[]).find(z=>Number(p.stock?.[color]?.[z]||0)>0);if(n)size=n;quantity=1;render();}};
    $("#sizes").onclick=e=>{const b=e.target.closest("[data-size]");if(b&&!b.disabled){size=b.dataset.size;quantity=1;render();}};
    gallery?.addEventListener("click",e=>{const b=e.target.closest("[data-img-url]");if(!b)return;$("#pimage").src=b.dataset.imgUrl;$$('.thumb',gallery).forEach(x=>x.classList.remove("active"));b.classList.add("active");});
    $("#qtyMinus").onclick=()=>{quantity=Math.max(1,quantity-1);render()};$("#qtyPlus").onclick=()=>{const max=Number(p.stock?.[color]?.[size]||0);quantity=Math.min(max||1,quantity+1);render()};$("#buy").onclick=()=>location.href=`checkout.html?id=${encodeURIComponent(id)}&color=${encodeURIComponent(color)}&size=${encodeURIComponent(size)}&quantity=${quantity}`;
    render();
  } catch(e) { $("#pname").textContent=e.message||"تعذر تحميل المنتج"; }
}

if (location.pathname.endsWith("product.html")) product(); else home();
