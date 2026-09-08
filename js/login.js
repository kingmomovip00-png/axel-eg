import {auth} from "./firebase.js";import {ADMIN_EMAIL} from "./config.js";
import {signInWithEmailAndPassword} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
document.querySelector("#loginForm").onsubmit=async e=>{e.preventDefault();let email=emailInput.value,password=passwordInput.value;if(email!==ADMIN_EMAIL){msg.textContent="غير مسموح.";return}try{await signInWithEmailAndPassword(auth,email,password);location.href="admin.html"}catch{x=>{};msg.textContent="بيانات الدخول غير صحيحة."}};
