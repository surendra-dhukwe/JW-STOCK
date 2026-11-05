
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");

async function auth(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing.");
      return res.status(500).json({
        message: "Authentication is not configured."
      });
    }

    // Read token from cookie or Authorization header
    let token = req.cookies?.jwst || "";

    if (!token) {
      const authorization = req.headers.authorization || "";

      if (authorization.startsWith("Bearer ")) {
        token = authorization.slice(7).trim();
      }
    }

    if (!token) {
      return res.status(401).json({
        message: "Please login."
      });
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.id || !mongoose.isValidObjectId(decoded.id)) {
      return res.status(401).json({
        message: "Invalid session."
      });
    }

    // Find authenticated user
    const user = await User.findById(decoded.id)
      .select("-passwordHash");

    if (!user) {
      return res.status(401).json({
        message: "Account not found."
      });
    }

    if (user.status !== "approved") {
      return res.status(403).json({
        message: "Your account is awaiting admin approval."
      });
    }

    req.user = user;
    return next();

  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Session expired. Please login again."
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        message: "Invalid session. Please login again."
      });
    }

    console.error("Authentication error:", error);

    return res.status(500).json({
      message: "Authentication failed. Please try again."
    });
  }
}

// Admin permission middleware
function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      message: "Please login."
    });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({
      message: "Admin access only."
    });
  }

  return next();
}

module.exports = {
  auth,
  adminOnly
};
