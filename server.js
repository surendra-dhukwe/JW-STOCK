
require("dotenv").config();

// MongoDB DNS configuration
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const path = require("path");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB connection cache
let dbConnectionPromise = null;
let initializationPromise = null;

// Connect MongoDB and initialize Admin
async function initializeApp() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in environment variables.");
  }

  if (mongoose.connection.readyState !== 1) {
    if (!dbConnectionPromise) {
      dbConnectionPromise = mongoose.connect(process.env.MONGO_URI)
        .then(() => {
          console.log("MongoDB Atlas Connected Successfully!");
        })
        .catch(error => {
          dbConnectionPromise = null;
          throw error;
        });
    }

    await dbConnectionPromise;
  }

  // Create Admin only if not already present
  const username = (
    process.env.ADMIN_USERNAME || "admin"
  ).toLowerCase();

  let admin = await User.findOne({ username });

  if (!admin) {
    const password = process.env.ADMIN_PASSWORD;

    if (!password) {
      throw new Error("ADMIN_PASSWORD is missing in environment variables.");
    }

    admin = await User.create({
      name: process.env.ADMIN_NAME || "JW-ST Admin",
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin",
      status: "approved"
    });

    console.log("Admin account created successfully.");
  }
}

// Initialize only once per running instance
async function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = initializeApp().catch(error => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
}

// Middleware: initialize before handling requests
app.use(async (req, res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (error) {
    console.error("Application initialization error:", error);

    res.status(500).json({
      message: "Server initialization failed. Please try again later."
    });
  }
});

// Body parsers and cookies
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Legacy uploads support
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

// API Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/items", require("./routes/items"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/chat", require("./routes/chat"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "JW-ST",
    database: mongoose.connection.readyState === 1
      ? "connected"
      : "disconnected"
  });
});

// Frontend
app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// Local development only
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`JW-ST running at http://localhost:${PORT}`);
  });
}

// Export Express app for Vercel
module.exports = app;
