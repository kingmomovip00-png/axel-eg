import { auth } from './firebase.js';
import { ADMIN_EMAIL, API_URL } from './config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = { user:null, products:[], banners:[], images:[], editingId:null };

const el = {
  notice:$('#notice'), adminEmail:$('#adminEmail'), logout:$('#logout'), refreshAll:$('#refreshAll'),
  statProducts:$('#statProducts'), statOrders:$('#statOrders'), statSales:$('#statSales'),
  form:$('#productForm'), productTitle:$('#productTitle'), colorOptions:$('#colorOptions'), sizeOptions:$('#sizeOptions'), extraColors:$('#extraColors'), stockBox:$('#stockBox'),
  imageColor:$('#imageColor'), productFiles:$('#productFiles'), selectedPreview:$('#selectedPreview'), uploadImages:$('#uploadImages'), imageProgress:$('#imageProgress'), imageMessage:$('#imageMessage'), uploadedImages:$('#uploadedImages'),
  saveProduct:$('#saveProduct'), cancelEdit:$('#cancelEdit'), clearProduct:$('#clearProduct'), refreshProducts:$('#refreshProducts'), productsList:$('#productsList'),
  refreshOrders:$('#refreshOrders'), ordersList:$('#ordersList'),
  bannerFile:$('#bannerFile'), bannerPreview:$('#bannerPreview'), uploadBanner:$('#uploadBanner'), bannerProgress:$('#bannerProgress'), bannerMessage:$('#bannerMessage'), refreshBanners:$('#refreshBanners'), bannersList:$('#bannersList')
};

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function money(v){return `${Number(v||0).toLocaleString('ar-EG')} ج`;}
function message(text,type='info',sticky=false){ el.notice.textContent=text; el.notice.className=`ax-notice ${type}`; clearTimeout(message.t); if(!sticky) message.t=setTimeout(()=>el.notice.classList.add('hidden'),6000); }
function inline(target,text,type=''){ target.textContent=text||''; target.className=`ax-inline-message ${type}`; }
function busy(btn,on,text='جاري التنفيذ...'){ if(on){btn.dataset.t=btn.textContent;btn.disabled=true;btn.textContent=text;} else {btn.disabled=false;btn.textContent=btn.dataset.t||btn.textContent;} }

async function token(){ const u=auth.currentUser; if(!u) throw new Error('جلسة الإدارة غير موجودة. سجّل الدخول مرة أخرى.'); return u.getIdToken(true); }
async function api(path,{method='GET',body,form=false}={}){
  const headers={Authorization:`Bearer ${await token()}`};
  let payload=body;
  if(body && !form){headers['Content-Type']='application/json';payload=JSON.stringify(body);}
  let res;
  try{res=await fetch(`${API_URL}${path}`,{method,headers,body:payload});}catch{throw new Error('تعذر الاتصال بالسيرفر. تأكد أن التطبيق يعمل ثم أعد المحاولة.');}
  const data=await res.json().catch(()=>({}));
  if(!res.ok || data.ok===false){
    if(res.status===401) throw new Error('جلسة الدخول انتهت. سجّل الدخول مرة أخرى.');
    if(res.status===403) throw new Error('ليس لديك صلاحية الإدارة لهذا الحساب.');
    throw new Error(data.error||`حدث خطأ من السيرفر (${res.status}).`);
  }
  return data;
}
function colors(){const base=$$('input:checked',el.colorOptions).map(x=>x.value.trim());const extra=el.extraColors.value.split(/[،,]/).map(x=>x.trim()).filter(Boolean);return [...new Set([...base,...extra])];}
function sizes(){return $$('input:checked',el.sizeOptions).map(x=>x.value);}
function renderOptions(){
  const c=colors(), s=sizes(); const old=new Map($$('input[data-stock]',el.stockBox).map(x=>[x.dataset.stock,x.value]));
  el.imageColor.innerHTML=c.length?c.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(''):'<option value="">اختر لونًا أولاً</option>';
  if(!c.length||!s.length){el.stockBox.innerHTML='<p class="ax-help">اختر لونًا ومقاسًا واحدًا على الأقل لتظهر خانات الكمية.</p>';return;}
  el.stockBox.innerHTML=`<h3>الكمية المتاحة لكل لون ومقاس</h3><div class="ax-stock-grid">${c.map(color=>`<div class="ax-stock-row"><b>${esc(color)}</b>${s.map(size=>{const key=`${color}|||${size}`;return `<label>${esc(size)}<input type="number" min="0" inputmode="numeric" data-stock="${esc(key)}" value="${esc(old.get(key)??0)}"></label>`}).join('')}</div>`).join('')}</div>`;
}
function stock(){const out={};$$('input[data-stock]',el.stockBox).forEach(i=>{const [c,s]=i.dataset.stock.split('|||');out[c]??={};out[c][s]=Math.max(0,Number(i.value||0));});return out;}
function preview(files,target){target.innerHTML='';[...files].forEach(file=>{const url=URL.createObjectURL(file);const img=new Image();img.src=url;img.alt=file.name;img.onload=()=>URL.revokeObjectURL(url);target.append(img);});}
function renderImages(){el.uploadedImages.innerHTML=state.images.length?state.images.map((img,i)=>`<article><img src="${esc(img.url)}" alt="صورة"><div><b>${esc(img.color)}</b><button type="button" data-remove-image="${i}" class="ax-mini-danger">حذف الصورة</button></div></article>`).join(''):'<p class="ax-help">لم يتم رفع صور للمنتج حتى الآن.</p>';}

async function upload(files,folder){
  const fd=new FormData();[...files].forEach(f=>fd.append('files',f));fd.append('folder',folder);
  return api('/upload',{method:'POST',body:fd,form:true});
}
async function uploadProductImages(){
  const color=el.imageColor.value, files=[...el.productFiles.files];
  if(!colors().length){message('اختر لونًا واحدًا على الأقل أولاً.','error');return;}
  if(!color){message('حدد لون الصور من القائمة.','error');return;}
  if(!files.length){message('اختر صورة واحدة أو أكثر قبل الضغط على رفع الصور.','error');return;}
  if(files.some(f=>!f.type.startsWith('image/'))){message('يوجد ملف ليس صورة. اختر ملفات صور فقط.','error');return;}
  try{
    busy(el.uploadImages,true,'جاري رفع الصور...');el.imageProgress.style.width='25%';inline(el.imageMessage,'جاري إرسال الصور...');
    const data=await upload(files,'/axel/products');el.imageProgress.style.width='85%';
    state.images.push(...(data.files||[]).map(x=>({url:x.url,fileId:x.fileId,color})));
    el.imageProgress.style.width='100%';inline(el.imageMessage,`تم رفع ${data.files.length} صورة بنجاح.`,'success');el.productFiles.value='';el.selectedPreview.innerHTML='';renderImages();message('تم رفع الصور بنجاح. يمكنك الآن حفظ المنتج.','success');
  }catch(e){el.imageProgress.style.width='0';inline(el.imageMessage,e.message,'error');message(`فشل رفع الصور: ${e.message}`,'error',true);}
  finally{busy(el.uploadImages,false);}
}

function resetProduct(){state.editingId=null;state.images=[];el.form.reset();$$('input',el.colorOptions).forEach(x=>x.checked=x.value==='أبيض');$$('input',el.sizeOptions).forEach(x=>x.checked=['M','L','XL','XXL'].includes(x.value));el.extraColors.value='';el.productFiles.value='';el.selectedPreview.innerHTML='';el.imageProgress.style.width='0';inline(el.imageMessage,'');el.productTitle.textContent='إضافة منتج جديد';el.saveProduct.textContent='حفظ المنتج';el.cancelEdit.classList.add('hidden');renderOptions();renderImages();}
async function saveProduct(e){
  e.preventDefault(); const fd=new FormData(el.form); const c=colors(),s=sizes(); const name=String(fd.get('name')||'').trim();const price=Number(fd.get('salePrice')||0);
  if(!name) return message('الخطأ: اكتب اسم المنتج.','error');
  if(price<=0) return message('الخطأ: أدخل سعر بيع صحيح أكبر من صفر.','error');
  if(!c.length) return message('الخطأ: اختر لونًا واحدًا على الأقل.','error');
  if(!s.length) return message('الخطأ: اختر مقاسًا واحدًا على الأقل.','error');
  if(!state.images.length) return message('الخطأ: اختر الصور ثم اضغط زر رفع الصور أولاً.','error');
  const payload={name,category:fd.get('category'),salePrice:price,oldPrice:Number(fd.get('oldPrice')||0),description:String(fd.get('description')||''),colors:c,sizes:s,stock:stock(),images:state.images,active:true};
  try{busy(el.saveProduct,true,state.editingId?'جاري حفظ التعديل...':'جاري حفظ المنتج...');if(state.editingId) await api(`/admin/products/${encodeURIComponent(state.editingId)}`,{method:'PATCH',body:payload});else await api('/admin/products',{method:'POST',body:payload});message(state.editingId?'تم تعديل المنتج بنجاح.':'تم حفظ المنتج بنجاح وسيظهر في المتجر.','success');resetProduct();await Promise.all([loadProducts(),loadStats()]);}
  catch(e){message(`فشل حفظ المنتج: ${e.message}`,'error',true);}finally{busy(el.saveProduct,false);}
}
async function loadProducts(){
  el.productsList.innerHTML='<p class="ax-help">جاري تحميل المنتجات...</p>';
  try{const d=await api('/admin/products');state.products=d.products||[];el.productsList.innerHTML=state.products.length?state.products.map(p=>`<article class="ax-manager"><img src="${esc(p.images?.[0]?.url||'')}" alt=""><div class="ax-manager-info"><b>${esc(p.name)}</b><span>${money(p.salePrice)} • ${(p.active===false)?'مخفي':'ظاهر'}</span><small>${esc((p.colors||[]).join(' • '))}</small></div><div class="ax-manager-actions"><button type="button" class="ax-btn ax-btn-light" data-edit="${esc(p.id)}">تعديل / استبدال</button><button type="button" class="ax-btn ax-btn-danger" data-delete="${esc(p.id)}">حذف</button></div></article>`).join(''):'<p class="ax-help">لا توجد منتجات حتى الآن.</p>';}
  catch(e){el.productsList.innerHTML=`<p class="ax-error">${esc(e.message)}</p>`;}
}
function editProduct(p){
  if(!p)return;state.editingId=p.id;state.images=(p.images||[]).map(x=>({...x}));el.form.elements.name.value=p.name||'';el.form.elements.category.value=p.category||'تصميمات';el.form.elements.salePrice.value=p.salePrice??'';el.form.elements.oldPrice.value=p.oldPrice??'';el.form.elements.description.value=p.description||'';
  const preset=$$('input',el.colorOptions).map(x=>x.value);$$('input',el.colorOptions).forEach(x=>x.checked=(p.colors||[]).includes(x.value));el.extraColors.value=(p.colors||[]).filter(x=>!preset.includes(x)).join('، ');$$('input',el.sizeOptions).forEach(x=>x.checked=(p.sizes||[]).includes(x.value));renderOptions();Object.entries(p.stock||{}).forEach(([c,ss])=>Object.entries(ss||{}).forEach(([s,q])=>{const i=$$('input[data-stock]',el.stockBox).find(x=>x.dataset.stock===`${c}|||${s}`);if(i)i.value=q;}));renderImages();el.productTitle.textContent=`تعديل المنتج: ${p.name}`;el.saveProduct.textContent='حفظ التعديل';el.cancelEdit.classList.remove('hidden');show('products');window.scrollTo({top:0,behavior:'smooth'});
}
async function deleteProduct(id){if(!confirm('حذف المنتج نهائيًا؟'))return;try{await api(`/admin/products/${encodeURIComponent(id)}`,{method:'DELETE'});message('تم حذف المنتج.','success');await Promise.all([loadProducts(),loadStats()]);}catch(e){message(`فشل الحذف: ${e.message}`,'error',true);}}

async function loadOrders(){
  el.ordersList.innerHTML='<p class="ax-help">جاري تحميل الطلبات...</p>';
  try{const d=await api('/admin/orders');const statuses=['جديد','قيد التجهيز','تم الشحن','تم التوصيل','ملغي','مرتجع'];const pays=['pending','paid','failed','refunded'];el.ordersList.innerHTML=(d.orders||[]).length?(d.orders||[]).map(o=>`<article class="ax-order"><div class="ax-order-head"><b>${esc(o.orderCode||o.id)}</b><span>${esc(o.customerName||'')} • ${esc(o.phone||'')}</span></div><div class="ax-order-product">${esc(o.productName||'')} — ${esc(o.color||'')} — ${esc(o.size||'')} × ${Number(o.quantity||1)} <strong>${money(o.total)}</strong></div><div class="ax-order-grid"><label>حالة الطلب<select data-order-status="${esc(o.id)}">${statuses.map(v=>`<option ${v===o.status?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>حالة الدفع<select data-pay-status="${esc(o.id)}">${pays.map(v=>`<option ${v===o.paymentStatus?'selected':''}>${esc(v)}</option>`).join('')}</select></label><button class="ax-btn ax-btn-primary" type="button" data-save-order="${esc(o.id)}">حفظ الحالة</button></div></article>`).join(''):'<p class="ax-help">لا توجد طلبات حتى الآن.</p>';}
  catch(e){el.ordersList.innerHTML=`<p class="ax-error">${esc(e.message)}</p>`;}
}
async function saveOrder(id,btn){const status=el.ordersList.querySelector(`[data-order-status="${CSS.escape(id)}"]`)?.value;const paymentStatus=el.ordersList.querySelector(`[data-pay-status="${CSS.escape(id)}"]`)?.value;try{busy(btn,true,'جاري الحفظ...');await api(`/admin/orders/${encodeURIComponent(id)}`,{method:'PATCH',body:{status,paymentStatus}});message('تم تحديث حالة الطلب.','success');await loadStats();}catch(e){message(`فشل التحديث: ${e.message}`,'error',true);}finally{busy(btn,false);}}

async function loadBanners(){el.bannersList.innerHTML='<p class="ax-help">جاري تحميل البانرات...</p>';try{const d=await api('/admin/banners');state.banners=d.banners||[];el.bannersList.innerHTML=state.banners.length?state.banners.map(b=>`<article class="ax-manager"><img src="${esc(b.imageUrl)}" alt="بانر"><div class="ax-manager-info"><b>بانر</b><span>${b.active===false?'مخفي':'ظاهر'}</span></div><div class="ax-manager-actions"><button class="ax-btn ax-btn-light" type="button" data-toggle-banner="${esc(b.id)}" data-active="${b.active===true}">${b.active===false?'إظهار':'إخفاء'}</button><button class="ax-btn ax-btn-danger" type="button" data-delete-banner="${esc(b.id)}">حذف</button></div></article>`).join(''):'<p class="ax-help">لا توجد بانرات حتى الآن.</p>';}catch(e){el.bannersList.innerHTML=`<p class="ax-error">${esc(e.message)}</p>`;}}
async function uploadBanner(){const file=el.bannerFile.files?.[0];if(!file)return message('اختر صورة البانر أولاً.','error');if(!file.type.startsWith('image/'))return message('الملف المختار ليس صورة.','error');try{busy(el.uploadBanner,true,'جاري رفع البانر...');el.bannerProgress.style.width='25%';inline(el.bannerMessage,'جاري رفع الصورة...');const d=await upload([file],'/axel/banners');const image=d.files?.[0];if(!image?.url)throw new Error('تم الرفع لكن لم تصل بيانات الصورة من السيرفر.');el.bannerProgress.style.width='75%';await api('/admin/banners',{method:'POST',body:{imageUrl:image.url,fileId:image.fileId}});el.bannerProgress.style.width='100%';inline(el.bannerMessage,'تم رفع البانر وإضافته للموقع بنجاح.','success');el.bannerFile.value='';el.bannerPreview.innerHTML='';await loadBanners();message('تمت إضافة البانر بنجاح.','success');}catch(e){el.bannerProgress.style.width='0';inline(el.bannerMessage,e.message,'error');message(`فشل رفع البانر: ${e.message}`,'error',true);}finally{busy(el.uploadBanner,false);}}

async function loadStats(){try{const d=await api('/admin/stats');const s=d.stats||{};el.statProducts.textContent=s.products??0;el.statOrders.textContent=s.orders??0;el.statSales.textContent=money(s.sales??0);}catch(e){console.warn(e);}}
function show(name){$$('[data-panel]').forEach(p=>p.classList.toggle('active',p.dataset.panel===name));$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));}

$$('[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));$$('[data-open-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.openView)));
el.colorOptions.addEventListener('change',renderOptions);el.sizeOptions.addEventListener('change',renderOptions);el.extraColors.addEventListener('input',renderOptions);el.productFiles.addEventListener('change',()=>preview(el.productFiles.files,el.selectedPreview));el.uploadImages.addEventListener('click',uploadProductImages);el.uploadedImages.addEventListener('click',async e=>{const b=e.target.closest('[data-remove-image]');if(!b)return;const i=Number(b.dataset.removeImage),img=state.images[i];state.images.splice(i,1);renderImages();if(img?.fileId){api(`/upload/${encodeURIComponent(img.fileId)}`,{method:'DELETE'}).catch(()=>{});}});
el.form.addEventListener('submit',saveProduct);el.clearProduct.addEventListener('click',resetProduct);el.cancelEdit.addEventListener('click',resetProduct);el.refreshProducts.addEventListener('click',loadProducts);el.productsList.addEventListener('click',e=>{const edit=e.target.closest('[data-edit]');const del=e.target.closest('[data-delete]');if(edit)editProduct(state.products.find(p=>p.id===edit.dataset.edit));if(del)deleteProduct(del.dataset.delete);});
el.refreshOrders.addEventListener('click',loadOrders);el.ordersList.addEventListener('click',e=>{const b=e.target.closest('[data-save-order]');if(b)saveOrder(b.dataset.saveOrder,b);});
el.bannerFile.addEventListener('change',()=>preview(el.bannerFile.files,el.bannerPreview));el.uploadBanner.addEventListener('click',uploadBanner);el.refreshBanners.addEventListener('click',loadBanners);el.bannersList.addEventListener('click',async e=>{const t=e.target.closest('[data-toggle-banner]'),d=e.target.closest('[data-delete-banner]');try{if(t)await api(`/admin/banners/${encodeURIComponent(t.dataset.toggleBanner)}`,{method:'PATCH',body:{active:t.dataset.active!=='true'}});if(d){if(!confirm('حذف البانر نهائيًا؟'))return;await api(`/admin/banners/${encodeURIComponent(d.dataset.deleteBanner)}`,{method:'DELETE'});}await loadBanners();message('تم تحديث البانرات.','success');}catch(err){message(err.message,'error',true);}});
el.refreshAll.addEventListener('click',async()=>{busy(el.refreshAll,true,'جاري التحديث...');await Promise.all([loadStats(),loadProducts(),loadOrders(),loadBanners()]);busy(el.refreshAll,false);message('تم تحديث البيانات.','success');});el.logout.addEventListener('click',()=>signOut(auth));

onAuthStateChanged(auth,async user=>{if(!user||(user.email||'').toLowerCase()!==ADMIN_EMAIL.toLowerCase()){location.href='login.html';return;}state.user=user;el.adminEmail.textContent=user.email;renderOptions();renderImages();await Promise.all([loadStats(),loadProducts(),loadOrders(),loadBanners()]);});
