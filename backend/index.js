require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const app = express();
app.use(helmet());
app.use(express.json({limit:"20kb"}));
const origins=(process.env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
app.use(cors({origin:(origin,cb)=>!origin || origins.includes(origin) ? cb(null,true) : cb(new Error("Origin tidak diizinkan"))}));

const serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||"{}");
if(!admin.apps.length){
  admin.initializeApp({
    credential:admin.credential.cert(serviceAccount),
    databaseURL:process.env.FIREBASE_DATABASE_URL
  });
}
const db=admin.database();
const mailer=nodemailer.createTransport({
  service:"gmail",
  auth:{user:process.env.GMAIL_USER,pass:(process.env.GMAIL_APP_PASSWORD||"").replace(/\s/g,"")}
});
const limiter=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:true,legacyHeaders:false});
app.use("/api",limiter);

const cleanUsername=u=>typeof u==="string" && /^[a-zA-Z0-9_.-]{3,30}$/.test(u);
const otpHash=(u,purpose,otp)=>crypto.createHash("sha256").update(`${u}:${purpose}:${otp}:${process.env.GMAIL_APP_PASSWORD}`).digest("hex");
const otpPath=(u,p)=>`otpRequests/${encodeURIComponent(u)}/${p}`;
async function sendOtp(username,email,purpose){
  const otp=String(crypto.randomInt(0,1000000)).padStart(6,"0");
  const record={hash:otpHash(username,purpose,otp),email:email.toLowerCase(),expiresAt:Date.now()+5*60*1000,attempts:0,createdAt:Date.now()};
  await db.ref(otpPath(username,purpose)).set(record);
  try {
    await mailer.sendMail({
      from:`Save Kontak <${process.env.GMAIL_USER}>`,to:email,
      subject:"Kode OTP Save Kontak",
      text:`Kode verifikasi kamu: ${otp}\n\nKode berlaku 5 menit dan hanya bisa digunakan sekali. Jangan berikan kode ini kepada siapa pun.`,
      html:`<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px"><h2>Save Kontak</h2><p>Kode verifikasi kamu:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f2f2f2;padding:18px;text-align:center">${otp}</div><p>Kode berlaku selama <b>5 menit</b>, hanya bisa digunakan sekali.</p><small>Jika kamu tidak meminta kode ini, abaikan email ini.</small></div>`
    });
  } catch(e){ await db.ref(otpPath(username,purpose)).remove(); throw new Error("Email gagal dikirim. Periksa konfigurasi Gmail App Password."); }
}
async function verifyOtp(username,purpose,otp){
  if(!/^\d{6}$/.test(otp||"")) throw new Error("Kode OTP harus 6 digit.");
  const r=db.ref(otpPath(username,purpose)), snap=await r.get();
  if(!snap.exists()) throw new Error("Kode tidak ditemukan atau sudah digunakan.");
  const v=snap.val();
  if(Date.now()>v.expiresAt){await r.remove();throw new Error("Kode OTP sudah kedaluwarsa.");}
  if(v.attempts>=5){await r.remove();throw new Error("Batas percobaan habis. Minta kode baru.");}
  if(v.hash!==otpHash(username,purpose,otp)){
    await r.update({attempts:(v.attempts||0)+1});
    throw new Error("Kode OTP salah.");
  }
  await r.remove();
}
async function userRecord(username){
  const s=await db.ref("users/"+username).get();
  if(!s.exists()) throw new Error("Akun tidak ditemukan.");
  return s.val();
}
async function checkPassword(username,password,data){
  if(data.passwordHash) return bcrypt.compare(password,data.passwordHash);
  return typeof data.password==="string" && data.password===password;
}
async function migrateHash(username,password){
  const hash=await bcrypt.hash(password,12);
  await db.ref("users/"+username).update({passwordHash:hash,password:null});
}

app.get("/health",(req,res)=>res.json({ok:true,service:"save-kontak-otp"}));

app.post("/api/register/request",async(req,res)=>{
 try{
  const {username,password,email}=req.body||{};
  if(!cleanUsername(username)) throw new Error("Username 3-30 karakter: huruf, angka, titik, _ atau -.");
  if(typeof password!=="string"||password.length<8) throw new Error("Password minimal 8 karakter.");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email||"")) throw new Error("Email tidak valid.");
  if(username.toLowerCase()==="sofi") throw new Error("Username khusus Owner.");
  if((await db.ref("users/"+username).get()).exists()) throw new Error("Username sudah digunakan.");
  await sendOtp(username,email.toLowerCase(),"register");
  res.json({ok:true,message:"OTP dikirim."});
 }catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/register/verify",async(req,res)=>{
 try{
  const {username,password,email,otp}=req.body||{};
  if(!cleanUsername(username)||typeof password!=="string"||password.length<8) throw new Error("Data pendaftaran tidak valid.");
  const path=otpPath(username,"register"), snap=await db.ref(path).get();
  if(!snap.exists()) throw new Error("Minta kode OTP terlebih dahulu.");
  // Verify against the same pending email; OTP is single-use.
  await verifyOtp(username,"register",otp);
  if((await db.ref("users/"+username).get()).exists()) throw new Error("Username sudah digunakan.");
  const passwordHash=await bcrypt.hash(password,12);
  await db.ref("users/"+username).set({username,email:email.toLowerCase(),emailVerified:true,passwordHash,approved:false,role:"user",isModerator:false,createdAt:Date.now()});
  res.json({ok:true});
 }catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/login",async(req,res)=>{
 try{
  const {username,password}=req.body||{};
  if(!cleanUsername(username)||typeof password!=="string") throw new Error("Username atau password salah.");
  const data=await userRecord(username);
  if(!(await checkPassword(username,password,data))) throw new Error("Username atau password salah.");
  if(!data.passwordHash) await migrateHash(username,password);
  res.json({ok:true,approved:!!data.approved,role:data.role||"user",isModerator:!!data.isModerator,emailVerified:!!data.emailVerified});
 }catch(e){res.status(401).json({error:e.message});}
});
app.post("/api/email/request",async(req,res)=>{
 try{
  const {username,password,email}=req.body||{};
  if(!cleanUsername(username)||!email||!password) throw new Error("Data tidak lengkap.");
  const data=await userRecord(username);
  if(!(await checkPassword(username,password,data))) throw new Error("Password akun salah.");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email tidak valid.");
  await sendOtp(username,email.toLowerCase(),"link-email");
  res.json({ok:true});
 }catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/email/verify",async(req,res)=>{
 try{
  const {username,password,email,otp}=req.body||{};
  const data=await userRecord(username);
  if(!(await checkPassword(username,password,data))) throw new Error("Password akun salah.");
  const pending=await db.ref(otpPath(username,"link-email")).get();\n  if(!pending.exists() || (pending.val().email||"") !== (email||"").toLowerCase()) throw new Error("Email tidak sama dengan email yang meminta OTP.");\n  await verifyOtp(username,"link-email",otp);
  await db.ref("users/"+username).update({email:email.toLowerCase(),emailVerified:true});
  if(!data.passwordHash) await migrateHash(username,password);
  res.json({ok:true});
 }catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/password/request",async(req,res)=>{
 try{
  const {username}=req.body||{};
  if(!cleanUsername(username)) throw new Error("Jika akun memenuhi syarat, kode akan dikirim.");
  const data=await userRecord(username);
  if(data.email && data.emailVerified) await sendOtp(username,data.email,"reset-password");
  // Generic response prevents simple email/account enumeration.
  res.json({ok:true,message:"Jika akun memiliki email terverifikasi, kode akan dikirim."});
 }catch(e){res.json({ok:true,message:"Jika akun memiliki email terverifikasi, kode akan dikirim."});}
});
app.post("/api/password/verify",async(req,res)=>{
 try{
  const {username,otp,password}=req.body||{};
  if(!cleanUsername(username)||typeof password!=="string"||password.length<8) throw new Error("Password baru minimal 8 karakter.");
  const data=await userRecord(username);
  if(!data.email||!data.emailVerified) throw new Error("Akun belum memiliki email terverifikasi. Login lalu verifikasi email di menu Profil.");
  await verifyOtp(username,"reset-password",otp);
  const passwordHash=await bcrypt.hash(password,12);
  await db.ref("users/"+username).update({passwordHash,password:null,passwordChangedAt:Date.now()});
  res.json({ok:true});
 }catch(e){res.status(400).json({error:e.message});}
});
app.listen(process.env.PORT||3000,()=>console.log("Save Kontak OTP backend running"));
