const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
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
let clientStatus = 'initializing';
let connectedAt = null;
let phoneNumber = null;

// Event QR Code
client.on("qr", async (qr) => {
  console.log("\n📱 QR Code baru tersedia");
  clientStatus = 'qr';
  currentQR = await qrcode.toDataURL(qr);
  console.log("✅ QR Code berhasil di-generate");
});

// Event Ready
client.on("ready", () => {
  console.log("✅ WhatsApp siap digunakan!");
  clientStatus = 'ready';
  currentQR = null;
  connectedAt = new Date();
  
  // Get phone number
  client.info.then(info => {
    phoneNumber = info.wid.user;
    console.log("📱 Nomor:", phoneNumber);
  });
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
  connectedAt = null;
  phoneNumber = null;
});

// Event Loading Screen
client.on("loading_screen", (percent) => {
  console.log("⏳ Loading:", percent + "%");
});

// Event Auth Failure
client.on("auth_failure", (msg) => {
  console.error("❌ Autentikasi gagal:", msg);
  clientStatus = 'auth_failure';
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
    timestamp: new Date().toISOString(),
    connectedAt: connectedAt,
    phoneNumber: phoneNumber
  });
});

// Endpoint untuk mendapatkan info session
app.get("/session-info", (req, res) => {
  res.json({
    status: clientStatus,
    number: phoneNumber,
    connectedAt: connectedAt,
    uptime: connectedAt ? Date.now() - connectedAt.getTime() : 0
  });
});

// Endpoint untuk logout/disconnect
app.post("/logout", async (req, res) => {
  try {
    console.log("🚪 Memproses logout...");
    
    if (clientStatus !== 'ready') {
      return res.json({ 
        success: false, 
        error: "Client tidak terhubung" 
      });
    }
    
    await client.logout();
    clientStatus = 'disconnected';
    currentQR = null;
    connectedAt = null;
    phoneNumber = null;
    
    console.log("✅ Logout berhasil");
    res.json({ 
      success: true, 
      message: "Berhasil logout dari WhatsApp" 
    });
    
  } catch (error) {
    console.error("❌ Error logout:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint untuk hapus session files
app.post("/delete-session", async (req, res) => {
  try {
    console.log("🗑️  Menghapus session files...");
    
    // Destroy client terlebih dahulu
    await client.destroy();
    
    // Path ke folder session
    const sessionPath = path.join(__dirname, '.wwebjs_auth');
    
    // Hapus folder session jika ada
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log("✅ Folder session dihapus");
    }
    
    // Reset status
    clientStatus = 'initializing';
    currentQR = null;
    connectedAt = null;
    phoneNumber = null;
    contactsCache = [];
    
    // Initialize ulang
    setTimeout(() => {
      client.initialize();
      console.log("🔄 Client diinisialisasi ulang");
    }, 2000);
    
    res.json({ 
      success: true, 
      message: "Session berhasil dihapus. Silakan scan QR code ulang." 
    });
    
  } catch (error) {
    console.error("❌ Error hapus session:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint untuk restart client
app.post("/restart", async (req, res) => {
  try {
    console.log("🔄 Restarting client...");
    
    await client.destroy();
    
    clientStatus = 'initializing';
    currentQR = null;
    
    setTimeout(() => {
      client.initialize();
      console.log("✅ Client direstart");
    }, 2000);
    
    res.json({ 
      success: true, 
      message: "Client direstart. Tunggu beberapa detik..." 
    });
    
  } catch (error) {
    console.error("❌ Error restart:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint untuk force reconnect
app.post("/reconnect", async (req, res) => {
  try {
    console.log("🔌 Reconnecting...");
    
    // Coba initialize ulang jika disconnected
    if (clientStatus === 'disconnected' || clientStatus === 'auth_failure') {
      client.initialize();
    }
    
    res.json({ 
      success: true, 
      message: "Reconnecting..." 
    });
    
  } catch (error) {
    console.error("❌ Error reconnect:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get contacts
app.get("/contacts", (req, res) => {
  res.json(contactsCache);
});

// Send bulk text message
app.post("/send-bulk", async (req, res) => {
  if (clientStatus !== 'ready') {
    return res.status(503).json({ 
      error: "WhatsApp belum terhubung. Silakan scan QR code terlebih dahulu." 
    });
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
      console.log(`✅ Pesan terkirim ke ${number}`);
    } catch (err) {
      results.push({ number, status: "❌ Gagal", error: err.message });
      console.error(`❌ Gagal kirim ke ${number}:`, err.message);
    }
  }

  res.json(results);
});

// Send bulk media message
app.post("/send-bulk-media", async (req, res) => {
  if (clientStatus !== 'ready') {
    return res.status(503).json({ 
      error: "WhatsApp belum terhubung. Silakan scan QR code terlebih dahulu." 
    });
  }

  let numbers;
  try { 
    numbers = JSON.parse(req.body.numbers); 
  } catch { 
    return res.status(400).json({ error: "Format nomor tidak valid" }); 
  }

  const message = req.body.message || "";
  const file = req.files?.file;
  
  if (!file) {
    return res.status(400).json({ error: "File tidak ditemukan" });
  }

  const savePath = "./uploads/" + file.name;
  
  // Pastikan folder uploads ada
  if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
  }
  
  await file.mv(savePath);

  const media = MessageMedia.fromFilePath(savePath);
  let results = [];

  for (const number of numbers) {
    try {
      await client.sendMessage(number, media, { caption: message });
      results.push({ number, status: "✅ Terkirim (media)" });
      console.log(`✅ Media terkirim ke ${number}`);
    } catch (err) {
      results.push({ number, status: "❌ Gagal", error: err.message });
      console.error(`❌ Gagal kirim media ke ${number}:`, err.message);
    }
  }

  // Hapus file setelah kirim
  try {
    fs.unlinkSync(savePath);
  } catch (err) {
    console.error("Error hapus file:", err);
  }
  
  res.json(results);
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    whatsappStatus: clientStatus
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("==========================================");
  console.log("🚀 Server berjalan di http://localhost:" + PORT);
  console.log("📱 Status WhatsApp:", clientStatus);
  console.log("==========================================");
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await client.destroy();
  process.exit(0);
});
