const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { auth } = require("../middleware/auth");

const cookieOptions = {
  httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000
};

router.post("/register", async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!name || !username || !password || password.length < 8)
      return res.status(400).json({ message: "Name, username and password (minimum 8 characters) are required." });
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,25}$/.test(cleanUsername))
      return res.status(400).json({ message: "Username must be 3-25 characters: letters, numbers, dot, _ or -." });
    if (await User.findOne({ username: cleanUsername }))
      return res.status(409).json({ message: "Username already exists." });
    await User.create({
      name: name.trim(), username: cleanUsername,
      passwordHash: await bcrypt.hash(password, 12),
      role: "user", status: "pending"
    });
    res.status(201).json({ message: "Registration submitted. Login will work after admin approval." });
  } catch (e) { res.status(500).json({ message: "Registration failed." }); }
});

router.post("/login", async (req, res) => {
  const username = String(req.body.username || "").toLowerCase().trim();
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(req.body.password || "", user.passwordHash)))
    return res.status(401).json({ message: "Invalid username or password." });
  if (user.status !== "approved")
    return res.status(403).json({ message: user.status === "pending" ? "Account pending admin approval." : "Account rejected. Contact admin." });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("jwst", token, cookieOptions);
  res.json({ user: { id: user._id, name: user.name, username: user.username, role: user.role } });
});

router.post("/logout", (req, res) => {
  res.clearCookie("jwst", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  res.json({ message: "Logged out." });
});
router.get("/me", auth, (req, res) => res.json({ user: req.user }));
module.exports = router;
