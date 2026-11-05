
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const { auth } = require("../middleware/auth");

const COOKIE_NAME = "jwst";
const TOKEN_EXPIRY = "7d";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/"
};

function getSafeUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    username: user.username,
    role: user.role,
    status: user.status
  };
}

// REGISTER
router.post("/register", async (req, res) => {
  try {
    const name = typeof req.body.name === "string"
      ? req.body.name.trim()
      : "";

    const username = typeof req.body.username === "string"
      ? req.body.username.trim().toLowerCase()
      : "";

    const password = typeof req.body.password === "string"
      ? req.body.password
      : "";

    if (!name || !username || !password) {
      return res.status(400).json({
        message: "Name, username and password are required."
      });
    }

    if (name.length > 70) {
      return res.status(400).json({
        message: "Name cannot exceed 70 characters."
      });
    }

    if (!/^[a-z0-9_.-]{3,25}$/.test(username)) {
      return res.status(400).json({
        message: "Username must be 3-25 characters: letters, numbers, dot, _ or -."
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        message: "Password must be between 8 and 128 characters."
      });
    }

    if (await User.findOne({ username })) {
      return res.status(409).json({
        message: "Username already exists."
      });
    }

    await User.create({
      name,
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: "user",
      status: "pending"
    });

    return res.status(201).json({
      message: "Registration submitted. Login will work after admin approval."
    });

  } catch (error) {
    console.error("Registration error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        message: "Username already exists."
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: "Please check your registration details."
      });
    }

    return res.status(500).json({
      message: "Registration failed. Please try again."
    });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const username = typeof req.body.username === "string"
      ? req.body.username.trim().toLowerCase()
      : "";

    const password = typeof req.body.password === "string"
      ? req.body.password
      : "";

    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required."
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing.");
      return res.status(500).json({
        message: "Server authentication is not configured."
      });
    }

    const user = await User.findOne({ username });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({
        message: "Invalid username or password."
      });
    }

    if (user.status !== "approved") {
      return res.status(403).json({
        message: user.status === "pending"
          ? "Account pending admin approval."
          : "Account rejected. Contact admin."
      });
    }

    const token = jwt.sign(
      { id: String(user._id) },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    res.cookie(COOKIE_NAME, token, cookieOptions);

    return res.json({
      message: "Login successful.",
      user: getSafeUser(user)
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Login failed. Please try again."
    });
  }
});

// LOGOUT
router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });

  return res.json({
    message: "Logged out successfully."
  });
});

// CURRENT USER
router.get("/me", auth, (req, res) => {
  return res.json({
    user: getSafeUser(req.user)
  });
});

module.exports = router;
