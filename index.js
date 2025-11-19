const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const fs = require("fs");
const qrcode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static("uploads"));

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// Variabel untuk menyimpan QR dan status
let currentQR = null;
let clientStatus = 'initializing'; // initializing, qr, ready, disconnected

// Event QR Code
client.on("qr", async (qr) => {
  console.log("\n📱 QR Code baru tersedia");
  clientStatus = 'qr';
  
  // Generate QR code sebagai data URL
  try {
    currentQR = await qrcode.toDataURL(qr);
    console.log("✅ QR Code berhasil di-generate");
  } catch (err) {
    console.error("❌ Error generating QR:", err);
  }
});

// Event Ready
client.on("ready", () => {
  console.log("✅ WhatsApp siap digunakan!");
  clientStatus = 'ready';
  currentQR = null; // Hapus QR setelah terhubung
});

// Event Authenticated
client.on("authenticated", () => {
  console.log("🔐 Autentikasi berhasil");
  clientStatus = 'ready';
});

// Event Disconnected
client.on("disconnected", (reason) => {
  console.log("❌ WhatsApp terputus:", reason);
  clientStatus = 'disconnected';
  currentQR = null;
});

// Initialize client
client.initialize();

// Cache kontak
let contactsCache = [];

client.on("ready", async () => {
  const contacts = await client.getContacts();
  contactsCache = contacts
    .filter(c => c.number)
    .map(c => ({
      id: c.id._serialized,
      name: c.name || c.pushname || "(Tanpa Nama)",
      number: c.number
    }));
  console.log(`📇 ${contactsCache.length} kontak ditemukan`);
});

// ===== API ENDPOINTS =====

// Endpoint untuk mendapatkan QR Code
app.get("/qr-status", (req, res) => {
  res.json({
    status: clientStatus,
    qr: currentQR,
    timestamp: new Date().toISOString()
  });
});

// Endpoint untuk cek status koneksi
app.get("/status", (req, res) => {
  res.json({
    status: clientStatus,
    isReady: clientStatus === 'ready',
    timestamp: new Date().toISOString()
  });
});

// Endpoint untuk logout/disconnect
app.post("/logout", async (req, res) => {
  try {
    await client.logout();
    clientStatus = 'disconnected';
    currentQR = null;
    res.json({ success: true, message: "Berhasil logout" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint untuk restart client
app.post("/restart", async (req, res) => {
  try {
    await client.destroy();
    clientStatus = 'initializing';
    currentQR = null;
    
    setTimeout(() => {
      client.initialize();
    }, 2000);
    
    res.json({ success: true, message: "Client direstart" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get contacts
app.get("/contacts", (req, res) => res.json(contactsCache));

// Send bulk text message
app.post("/send-bulk", async (req, res) => {
  if (clientStatus !== 'ready') {
    return res.status(503).json({ error: "WhatsApp belum terhubung" });
  }

  let numbers;
  try { 
    numbers = JSON.parse(req.body.numbers); 
  } catch { 
    return res.status(400).json({ error: "Format nomor tidak valid" }); 
  }

  const message = req.body.message || "";
  let results = [];

  for (const number of numbers) {
    try {
      await client.sendMessage(number, message);
      results.push({ number, status: "✅ Terkirim (teks)" });
    } catch (err) {
      results.push({ number, status: "❌ Gagal", error: err.message });
    }
  }

  res.json(results);
});

// Send bulk media message
app.post("/send-bulk-media", async (req, res) => {
  if (clientStatus !== 'ready') {
    return res.status(503).json({ error: "WhatsApp belum terhubung" });
  }

  let numbers;
  try { 
    numbers = JSON.parse(req.body.numbers); 
  } catch { 
    return res.status(400).json({ error: "Format nomor tidak valid" }); 
  }

  const message = req.body.message || "";
  const file = req.files?.file;
  if (!file) return res.status(400).json({ error: "File tidak ditemukan" });

  const savePath = "./uploads/" + file.name;
  await file.mv(savePath);

  const media = MessageMedia.fromFilePath(savePath);
  let results = [];

  for (const number of numbers) {
    try {
      await client.sendMessage(number, media, { caption: message });
      results.push({ number, status: "✅ Terkirim (media)" });
    } catch (err) {
      results.push({ number, status: "❌ Gagal", error: err.message });
    }
  }

  fs.unlinkSync(savePath);
  res.json(results);
});

// Start server
app.listen(3000, () => {
  console.log("🚀 Server berjalan di http://localhost:3000");
  console.log("📱 Status: " + clientStatus);
});