
require("dotenv").config();

// MongoDB DNS fix
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const app = express();
const PORT = process.env.PORT || 5000;

fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// API Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/items", require("./routes/items"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/chat", require("./routes/chat"));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "JW-ST" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  // Connect MongoDB Atlas
  await mongoose.connect(process.env.MONGO_URI);

  console.log("MongoDB Atlas Connected Successfully!");

  // Create Admin if not exists
  const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();

  let admin = await User.findOne({ username });

  if (!admin) {
    const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";

    admin = await User.create({
      name: process.env.ADMIN_NAME || "JW-ST Admin",
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin",
      status: "approved"
    });

    console.log("Admin account created successfully.");
    console.log(`Admin Username: ${username}`);
    console.log("Keep your admin password secret.");
  }

  // Start Server
  app.listen(PORT, () => {
    console.log(`JW-ST running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error("JW-ST Startup Error:", err);
  process.exit(1);
});
