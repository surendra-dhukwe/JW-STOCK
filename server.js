
require("dotenv").config();

// MongoDB DNS configuration
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const path = require("path");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === "production";

let dbConnectionPromise = null;
let initializationPromise = null;

// ---------------- DATABASE INITIALIZATION ----------------

async function initializeApp() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in environment variables.");
  }

  if (mongoose.connection.readyState !== 1) {
    if (!dbConnectionPromise) {
      dbConnectionPromise = mongoose
        .connect(process.env.MONGO_URI, {
          maxPoolSize: 10,
          minPoolSize: 2,
          serverSelectionTimeoutMS: 10000
        })
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

  const username = String(
    process.env.ADMIN_USERNAME || "admin"
  ).trim().toLowerCase();

  const admin = await User.findOne({ username }).lean();

  if (!admin) {
    const password = process.env.ADMIN_PASSWORD;

    if (!password) {
      throw new Error("ADMIN_PASSWORD is missing.");
    }

    await User.create({
      name: process.env.ADMIN_NAME || "JW-ST Admin",
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin",
      status: "approved"
    });

    console.log("Admin account created successfully.");
  }
}

async function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = initializeApp().catch(error => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
}

// ---------------- MIDDLEWARE ----------------

app.disable("x-powered-by");

// Compress responses
app.use(compression({
  threshold: 1024
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "2mb"
}));

app.use(cookieParser());

// Static files
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: isProduction ? "7d" : 0,
    etag: true,
    lastModified: true
  })
);

// Legacy uploads
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    maxAge: isProduction ? "7d" : 0,
    etag: true
  })
);

// ---------------- HEALTH CHECK ----------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "JW-ST",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected"
  });
});

// ---------------- DATABASE MIDDLEWARE ----------------

app.use("/api", async (req, res, next) => {
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

// ---------------- API ROUTES ----------------

app.use("/api/auth", require("./routes/auth"));
app.use("/api/items", require("./routes/items"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/drafts", require("./routes/drafts"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/chat", require("./routes/chat"));

// API not found
app.use("/api", (req, res) => {
  res.status(404).json({
    message: "API endpoint not found."
  });
});

// ---------------- FRONTEND FALLBACK ----------------

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// ---------------- ERROR HANDLER ----------------

app.use((error, req, res, next) => {
  console.error("Server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(error.status || 500).json({
    message:
      error.status && error.status < 500
        ? error.message
        : "Internal server error."
  });
});

// ---------------- START SERVER ----------------

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`JW-ST running at http://localhost:${PORT}`);
  });
}

module.exports = app;
