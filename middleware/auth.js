const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function auth(req, res, next) {
  try {
    const token = req.cookies.jwst || (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Please login." });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-passwordHash");
    if (!user) return res.status(401).json({ message: "Account not found." });
    if (user.status !== "approved") return res.status(403).json({ message: "Your account is awaiting admin approval." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Session expired. Please login again." });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Admin access only." });
  next();
}
module.exports = { auth, adminOnly };
