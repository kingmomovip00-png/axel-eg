import {db} from "./firebase.js";
import {API_URL} from "./config.js";
import {collection,getDocs,query,where,doc,getDoc} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat("ar-EG",{maximumFractionDigits:0}).format(n||0)+" ج";

async function home(){
 try{fetch(`${API_URL}/visits`,{method:"POST"}).catch(()=>{});}catch(_){}
 const ps=(await getDocs(query(collection(db,"products"),where("active","==",true)))).docs.map(d=>({id:d.id,...d.data()})).sort(()=>Math.random()-.5);
 const card=p=>`<a class="card" href="product.html?id=${p.id}"><img src="${p.images?.[0]?.url||""}"><div class="card-body"><b>${p.name}</b><div class="price">${money(p.salePrice)} <span class="old">${p.oldPrice?money(p.oldPrice):""}</span></div></div></a>`;
 const designs=ps.filter(p=>p.category!=="أنمي"), anime=ps.filter(p=>p.category==="أنمي");
 const dEl=$("#productsDesigns")||$("#products"); if(dEl)dEl.innerHTML=designs.map(card).join("")||"لا توجد منتجات حالياً";
 const aEl=$("#productsAnime"); if(aEl)aEl.innerHTML=anime.map(card).join("")||"لا توجد تصميمات أنمي حالياً";
 const bs=(await getDocs(query(collection(db,"banners"),where("active","==",true)))).docs.map(d=>d.data());
 if($("#hero")){ if(bs.length){const b=bs[Math.floor(Math.random()*bs.length)];$("#hero").innerHTML=`<img src="${b.imageUrl}">`;} else $("#hero").innerHTML=`<div class="hero-placeholder">AXEL</div>`; }
 const os=(await getDocs(query(collection(db,"offers"),where("active","==",true)))).docs.map(d=>d.data());
 if(os.length&&$("#offer")){const o=os[Math.floor(Math.random()*os.length)];$("#offer").classList.remove("hidden");$("#offerTitle").textContent=o.title;count(o.endsAt?.seconds?o.endsAt.seconds*1000:new Date(o.endsAt).getTime())}
}
function count(end){const el=$("#countdown");const timer=setInterval(()=>{let x=Math.max(0,end-Date.now());let h=Math.floor(x/3600000),m=Math.floor(x%3600000/60000),s=Math.floor(x%60000/1000);el.textContent=`${h} : ${m} : ${s}`;if(!x)clearInterval(timer)},1000)}
async function product(){
 const id=new URLSearchParams(location.search).get("id");if(!id)return;
 const s=await getDoc(doc(db,"products",id));if(!s.exists())return;
 const p={id:s.id,...s.data()},images=p.images||[];let color=images[0]?.color,size="M";
 $("#pname").textContent=p.name;$("#pdesc").textContent=p.description||"تيشيرت أوفر سايز بخامة مريحة.";$("#pprice").textContent=money(p.salePrice);
 function render(){let im=images.find(x=>x.color===color)||images[0];$("#pimage").src=im?.url||"";$("#colors").innerHTML=[...new Set(images.map(x=>x.color))].map(c=>`<span class="option ${c===color?"active":""}" data-color="${c}">${c}</span>`).join("");$("#sizes").innerHTML=(p.sizes||["M","L","XL","XXL"]).map(z=>`<span class="option ${z===size?"active":""}" data-size="${z}">${z}</span>`).join("");let q=p.stock?.[color]?.[size]??0;$("#stock").textContent=q?`المتاح: ${q}`:"نفذت الكمية";$("#buy").disabled=!q}
 $("#colors").onclick=e=>{if(e.target.dataset.color){color=e.target.dataset.color;render()}};$("#sizes").onclick=e=>{if(e.target.dataset.size){size=e.target.dataset.size;render()}};$("#buy").onclick=()=>location.href=`checkout.html?id=${id}&color=${encodeURIComponent(color)}&size=${size}`;render()
}
home();product();
