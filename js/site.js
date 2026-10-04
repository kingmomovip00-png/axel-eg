import { API_URL, SHIPPING_PRICE } from "./config.js";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const money = n => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(n || 0)) + " ج";
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const shuffle = arr => { const a = [...arr]; for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const CART_KEY="axelCartV1";
function getCart(){try{return JSON.parse(localStorage.getItem(CART_KEY)||"[]")}catch{return []}}
function setCart(cart){localStorage.setItem(CART_KEY,JSON.stringify(cart));updateCartCount();window.dispatchEvent(new CustomEvent("axel-cart-updated"));}
function updateCartCount(){const n=getCart().reduce((a,x)=>a+Number(x.quantity||0),0);$$('#cartCount,#cartCountHeader').forEach(x=>x.textContent=n)}
function addToCart(item){const button=document.querySelector('#addToCart');if(button){button.classList.remove('cart-added');void button.offsetWidth;button.classList.add('cart-added');button.disabled=true;setTimeout(()=>button.disabled=false,500)}const cart=getCart();const key=`${item.productId}|${item.color||''}|${item.size||''}|${item.bannerId||''}`;const found=cart.find(x=>x.key===key);if(found)found.quantity=Math.min(Number(item.max||99),Number(found.quantity||0)+Number(item.quantity||1));else cart.push({...item,key,quantity:Number(item.quantity||1)});setCart(cart);showToast('تمت إضافة المنتج إلى السلة ✓');}


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
  const mediaUrl = banner?.mediaUrl || banner?.videoUrl || banner?.imageUrl || "";
  if (!mediaUrl) {
    target.innerHTML = `<div class="hero-placeholder"><img src="assets/logo/logo.png" class="hero-logo" alt="AXEL"><p>أحدث فيديوهات AXEL</p></div>`;
    return;
  }
  target.classList.remove("banner-enter"); void target.offsetWidth; target.classList.add("banner-enter");
  const href = banner.productId ? `banner-offer.html?banner=${encodeURIComponent(banner.id)}&product=${encodeURIComponent(banner.productId)}&price=${encodeURIComponent(banner.offerPrice||0)}&color=${encodeURIComponent(banner.offerColor||"")}` : (banner.linkUrl ? banner.linkUrl : "#designs");
  const isVideo = banner.mediaType === "video" || !!banner.videoUrl;
  const media = isVideo
    ? `<video src="${escapeHtml(mediaUrl)}" autoplay muted playsinline preload="metadata"></video>`
    : `<img src="${escapeHtml(mediaUrl)}" alt="AXEL" decoding="async">`;
  target.innerHTML = `<a href="${escapeHtml(href)}" aria-label="عرض المنتج">${media}</a>`;
}

function setupVideoHero(videos) {
  const list = shuffle((videos || []).filter(b => b && (b.mediaType === "video" || b.videoUrl || /\.(mp4|webm|mov)(\?|$)/i.test(b.mediaUrl||""))));
  const target = $("#bannerOne");
  if (!target) return;
  if (!list.length) { renderBanner(target, null, 0); return; }
  let i = Math.floor(Math.random() * list.length);
  const show = () => {
    const b = list[i];
    renderBanner(target, b, i);
    const video = target.querySelector("video");
    if (!video) return;
    video.onended = () => {
      if (list.length === 1) {
        video.currentTime = 0;
        video.play().catch(()=>{});
      } else {
        i = (i + 1) % list.length;
        show();
      }
    };
    video.onerror = () => {
      if (list.length > 1) { i = (i + 1) % list.length; show(); }
    };
    video.play().catch(()=>{});
  };
  show();
}

function setupSecondBanner(banners) {
  const list = shuffle((banners || []).filter(b => b && b.mediaType !== "video" && b.imageUrl));
  const target = $("#bannerTwo");
  if (!target) return;
  if (!list.length) { target.innerHTML = ""; return; }
  let i = Math.floor(Math.random() * list.length);
  renderBanner(target, list[i], i);
  if (list.length > 1) setInterval(() => { i=(i+1)%list.length; renderBanner(target,list[i],i); }, 4000);
}

function setupBanners(banners) {
  setupVideoHero(banners);
  setupSecondBanner(banners);
}

function setupRail(id){const el=document.getElementById(id);if(!el)return;let timer=null,resume=null,drag=false,startX=0,startScroll=0;const items=()=>[...el.querySelectorAll('.product-card')];const move=(direction)=>{const cards=items();if(!cards.length)return;const current=Math.max(0,Math.min(cards.length-1,Math.round(Math.abs(el.scrollLeft)/(cards[0].getBoundingClientRect().width+16))));const delta=direction==='next'?1:-1;const target=cards[Math.max(0,Math.min(cards.length-1,current+delta))];if(target)el.scrollTo({left:target.offsetLeft-(el.clientWidth-target.offsetWidth)/2,behavior:'smooth'});};$$(`.slider-btn[data-slider="${id}"]`).forEach(btn=>btn.addEventListener('click',()=>{pause();move(btn.dataset.dir);resumeSoon();}));function pause(){clearInterval(timer);timer=null}function resumeSoon(){clearTimeout(resume);resume=setTimeout(start,2500)}function start(){pause();if(el.scrollWidth<=el.clientWidth+8)return;timer=setInterval(()=>{if(document.visibilityState==='visible'&&!drag)move('next')},4500)}el.addEventListener('pointerdown',e=>{drag=true;pause();startX=e.clientX;startScroll=el.scrollLeft;el.setPointerCapture?.(e.pointerId)});el.addEventListener('pointermove',e=>{if(drag)el.scrollLeft=startScroll-(e.clientX-startX)});el.addEventListener('pointerup',e=>{drag=false;el.releasePointerCapture?.(e.pointerId);resumeSoon()});el.addEventListener('pointercancel',()=>{drag=false;resumeSoon()});el.addEventListener('mouseenter',pause);el.addEventListener('mouseleave',()=>{if(!drag)resumeSoon()});el.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();pause();el.scrollBy({left:e.deltaY,behavior:'auto'});resumeSoon()}},{passive:false});start();}
function observeReveals() {
  const io = new IntersectionObserver(entries => entries.forEach(e => { if(e.isIntersecting){e.target.classList.add("is-visible");io.unobserve(e.target);}}), {threshold:.08});
  $$(".reveal-section,.reveal-card").forEach(x => io.observe(x));
}

function setupSeeMore(){
  $$('[data-more-target]').forEach(btn=>{const target=document.getElementById(btn.dataset.moreTarget);if(!target || btn.dataset.moreTarget==='productsDesigns')return;const cards=[...target.children].filter(x=>x.classList.contains('card'));const limit=6; if(cards.length<=limit){btn.classList.add('hidden');return;} cards.forEach((c,i)=>c.classList.toggle('more-hidden',i>=limit));btn.onclick=()=>{const hidden=cards.some(c=>c.classList.contains('more-hidden'));cards.forEach(c=>c.classList.toggle('more-hidden',!hidden));btn.textContent=hidden?'عرض المزيد':'عرض أقل';};});
}

async function loadHomeCoupon(){try{const {coupon}=await publicApi('/coupons/featured');const box=$('#homeCoupon');if(!box||!coupon)return;box.classList.remove('hidden');$('#homeCouponTitle').textContent=coupon.title||'خصم خاص';$('#homeCouponText').textContent=`${coupon.text||'استخدم الكود عند الطلب'}${coupon.type==='fixed'?` — خصم ${money(coupon.value)}`:` — خصم ${Number(coupon.value||0)}%`} ${Number(coupon.minQuantity||1)>1?`عند شراء ${Number(coupon.minQuantity)} قطع أو أكثر`:''}`;$('#homeCouponCode').textContent=coupon.code;$('#copyHomeCoupon').onclick=async()=>{try{await navigator.clipboard.writeText(coupon.code);showToast('تم نسخ الكود ✓')}catch{showToast(`الكود: ${coupon.code}`)}};}catch{}}

async function home() {
  fetch(`${API_URL}/visits`, { method: "POST" }).catch(() => {});
  try {
    const [{ products }, { banners }, { offers }] = await Promise.all([publicApi("/products"), publicApi("/banners"), publicApi("/offers")]);
    const shuffled = shuffle(products || []);
    const designs = shuffled.filter(p => p.category !== "أنمي");
    const anime = shuffled.filter(p => p.category === "أنمي");
    const dEl = $("#productsDesigns"), mEl = $("#productsMixed"), aEl = $("#productsAnime");
    if (dEl) dEl.innerHTML = designs.map(card).join("") || `<p class="empty-state">لا توجد منتجات حالياً</p>`;
    const mixed = shuffle([...(products || [])]).filter(p => Array.isArray(p.images) && p.images.some(x => x?.url));
    if (mEl) { const mixedSource = mixed.length ? mixed : shuffle([...(products || [])]); mEl.innerHTML = mixedSource.map(card).join("") || `<p class="empty-state">لا توجد منتجات حالياً</p>`; }
    if (aEl) aEl.innerHTML = anime.map(card).join("") || `<p class="empty-state">لا توجد تصميمات أنمي حالياً</p>`;
    setupBanners(banners || []);
    if (offers?.length && $("#offer")) { const o=offers[0]; $("#offer").classList.remove("hidden"); $("#offerTitle").textContent=o.title||"عرض محدود"; count(o.endsAt?.seconds ? o.endsAt.seconds*1000 : new Date(o.endsAt).getTime()); }
    setupSeeMore(); setupRail("designs"); loadHomeCoupon(); updateCartCount(); observeReveals();
  } catch(e) { console.error(e); showToast(e.message, true); }
}

function count(end) { const el=$("#countdown"); if(!el||!Number.isFinite(end))return; const timer=setInterval(()=>{const x=Math.max(0,end-Date.now());const h=Math.floor(x/3600000),m=Math.floor(x%3600000/60000),s=Math.floor(x%60000/1000);el.textContent=`${String(h).padStart(2,"0")} : ${String(m).padStart(2,"0")} : ${String(s).padStart(2,"0")}`;if(!x)clearInterval(timer)},1000); }

function showToast(msg, error=false) { const el=$("#siteToast"); if(!el)return; el.textContent=msg; el.classList.toggle("error",!!error); el.classList.remove("hidden"); clearTimeout(showToast.t); showToast.t=setTimeout(()=>el.classList.add("hidden"),4000); }

async function loadReviews(productId){
  const [{reviews:pr=[]},{reviews:all=[]}]=await Promise.all([publicApi(`/products/${encodeURIComponent(productId)}/reviews`),publicApi('/reviews')]);
  const render=(list,target)=>{if(!target)return;target.innerHTML=list.length?list.map(r=>`<article class="review-card"><div class="review-top"><b>${escapeHtml(r.name||'عميل AXEL')}</b><span class="stars">${'★'.repeat(Number(r.rating||0))}${'☆'.repeat(5-Number(r.rating||0))}</span></div><p>${escapeHtml(r.comment||'')}</p><small>تجربة عميل AXEL</small></article>`).join(''):'<p class="empty-state">لا توجد تقييمات حتى الآن</p>';};
  const avg=pr.length?pr.reduce((a,r)=>a+Number(r.rating||0),0)/pr.length:0;
  $('#reviewSummary')?.replaceChildren(Object.assign(document.createElement('div'),{className:'review-score',innerHTML:`<strong>${avg.toFixed(1)}</strong><span class="stars">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5-Math.round(avg))}</span><small>${pr.length} تقييم</small>`}));
  render(pr,$('#productReviews'));render(all,$('#allReviews'));
}

async function setupProductSimilar(current){const el=$('#similarRail');if(!el)return;try{const {products=[]}=await publicApi('/products');const valid=(products||[]).filter(x=>x&&x.id!==current.id&&Array.isArray(x.images)&&x.images.some(im=>im?.url));let pool=shuffle(valid.filter(x=>x.category&&current.category&&x.category===current.category));if(pool.length<6)pool=shuffle([...pool,...valid.filter(x=>!pool.some(y=>y.id===x.id))]);pool=pool.slice(0,10);el.innerHTML=pool.length?pool.map((x,i)=>card(x,i)).join(''):'<p class="empty-state">لا توجد منتجات مشابهة حاليًا</p>';setupGenericRail(el)}catch(e){console.error('similar products',e);el.innerHTML='<p class="empty-state">تعذر تحميل المنتجات المشابهة</p>';}}
function setupGenericRail(el){let down=false,sx=0,ss=0;el.addEventListener('pointerdown',e=>{down=true;sx=e.clientX;ss=el.scrollLeft;el.setPointerCapture?.(e.pointerId)});el.addEventListener('pointermove',e=>{if(down)el.scrollLeft=ss-(e.clientX-sx)});el.addEventListener('pointerup',()=>down=false);el.addEventListener('pointercancel',()=>down=false)}
async function product(){
  const id=new URLSearchParams(location.search).get('id'); if(!id||!$('#pname'))return;
  try{ const {product:p}=await publicApi(`/products/${encodeURIComponent(id)}`); const images=p.images||[]; let color=(p.colors||[images[0]?.color]).find(Boolean)||''; let size=(p.sizes||[])[0]||'M'; let quantity=1; let coupon='';
    $('#pname').textContent=p.name||'منتج AXEL';$('#pdesc').textContent=p.description||'تيشيرت AXEL';$('#pprice').textContent=money(p.salePrice);
    const gallery=$('#gallery');
    function render(){const colorImages=images.filter(x=>x.color===color);const list=colorImages.length?shuffle(colorImages):shuffle(images);const main=list[0];$('#pimage').src=main?.url||'';if(gallery)gallery.innerHTML=list.map((im,i)=>`<button class="thumb ${i===0?'active':''}" data-img-url="${escapeHtml(im.url)}" type="button"><img loading="lazy" src="${escapeHtml(im.url)}" alt="${escapeHtml(p.name)}"></button>`).join('');const colors=p.colors?.length?p.colors:[...new Set(images.map(x=>x.color).filter(Boolean))];$('#colors').innerHTML=colors.map(c=>`<button type="button" class="option ${c===color?'active':''}" data-color="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');$('#sizes').innerHTML=(p.sizes||['M','L','XL','XXL']).map(z=>{const q=Number(p.stock?.[color]?.[z]||0);return `<button type="button" class="option ${z===size?'active':''} ${q<=0?'sold-out':''}" data-size="${escapeHtml(z)}" ${q<=0?'disabled':''}>${escapeHtml(z)}</button>`}).join('');const available=Number(p.stock?.[color]?.[size]||0);$('#stock').textContent=available?`المتاح: ${available} قطعة`:'نفذت الكمية';$('#quantityValue').textContent=quantity;$('#buy').disabled=!available;}
    $('#colors').onclick=e=>{const b=e.target.closest('[data-color]');if(b){color=b.dataset.color;size=(p.sizes||[]).find(z=>Number(p.stock?.[color]?.[z]||0)>0)||size;quantity=1;render();}};$('#sizes').onclick=e=>{const b=e.target.closest('[data-size]');if(b&&!b.disabled){size=b.dataset.size;quantity=1;render();}};gallery?.addEventListener('click',e=>{const b=e.target.closest('[data-img-url]');if(!b)return;$('#pimage').src=b.dataset.imgUrl;$$('.thumb',gallery).forEach(x=>x.classList.remove('active'));b.classList.add('active')});$('#qtyMinus').onclick=()=>{quantity=Math.max(1,quantity-1);render()};$('#qtyPlus').onclick=()=>{const max=Number(p.stock?.[color]?.[size]||0);quantity=Math.min(max||1,quantity+1);render()};
    async function applyCoupon(){const code=$('#productCoupon').value.trim();if(!code){coupon='';$('#productCouponMsg').textContent='';return true}const sub=Number(p.salePrice||0)*quantity;const r=await fetch(`${API_URL}/coupons/validate?code=${encodeURIComponent(code)}&subtotal=${sub}&quantity=${quantity}&productId=${encodeURIComponent(id)}`),d=await r.json();if(!r.ok||!d.ok){coupon='';$('#productCouponMsg').textContent=d.error||'الكود غير صالح';return false}coupon=code.toUpperCase();$('#productCouponMsg').textContent=`تم تطبيق خصم ${money(d.coupon.discount)}`;return true}
    $('#applyProductCoupon').onclick=()=>applyCoupon().catch(()=>{$('#productCouponMsg').textContent='تعذر التحقق من الكود'});$('#addToCart')?.addEventListener('click',async()=>{if(!(await applyCoupon()))return;const max=Number(p.stock?.[color]?.[size]||0);addToCart({productId:id,productName:p.name||'منتج AXEL',imageUrl:images.find(x=>x.color===color)?.url||images[0]?.url||'',color,size,quantity,max,unitPrice:Number(p.salePrice||0)});});$('#buy').onclick=async()=>{if(!(await applyCoupon()))return;location.href=`checkout.html?id=${encodeURIComponent(id)}&color=${encodeURIComponent(color)}&size=${encodeURIComponent(size)}&quantity=${quantity}&coupon=${encodeURIComponent(coupon)}`};
    $('#toggleReviewForm')?.addEventListener('click',()=>{const f=$('#reviewForm');f?.classList.toggle('hidden');if($('#toggleReviewForm'))$('#toggleReviewForm').textContent=f?.classList.contains('hidden')?'إضافة مراجعة':'إغلاق المراجعة'});$('#reviewForm')?.addEventListener('submit',async e=>{e.preventDefault();const msg=$('#reviewMsg');try{const r=await fetch(`${API_URL}/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:id,name:$('#reviewName').value.trim(),rating:Number($('#reviewRating').value),comment:$('#reviewComment').value.trim()})});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'تعذر إرسال التقييم');msg.textContent='تم إضافة رأيك بنجاح';$('#reviewForm').reset();await loadReviews(id)}catch(e){msg.textContent=e.message}});
    render();await loadReviews(id);setupProductSimilar(p);
  }catch(e){$('#pname').textContent=e.message||'تعذر تحميل المنتج'}
}

async function homeReviews(){try{const {reviews=[]}=await publicApi('/reviews');const el=$('#homeReviews');if(el)el.innerHTML=reviews.length?reviews.slice(0,8).map(r=>`<article class="review-card"><div class="review-top"><b>${escapeHtml(r.name||'عميل AXEL')}</b><span class="stars">${'★'.repeat(Number(r.rating||0))}${'☆'.repeat(5-Number(r.rating||0))}</span></div><p>${escapeHtml(r.comment||'')}</p><small>${escapeHtml(r.productName||'منتج AXEL')}</small></article>`).join(''):'<p class="empty-state">لا توجد تقييمات حتى الآن</p>';}catch{}}

updateCartCount(); if (location.pathname.endsWith("product.html")) product(); else { home(); homeReviews(); }
