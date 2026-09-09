import {initializeApp} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {getFirestore} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig={
 apiKey:"AIzaSyDDpfti_wTrWQKUg5Vl-ljayLqp2uiIWOg",
 authDomain:"axel-a709e.firebaseapp.com",
 projectId:"axel-a709e",
 storageBucket:"axel-a709e.firebasestorage.app",
 messagingSenderId:"965515209013",
 appId:"1:965515209013:web:dcb50333796619e8f9847c"
};
const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
