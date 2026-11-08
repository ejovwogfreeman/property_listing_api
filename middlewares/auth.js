const jwt = require("jsonwebtoken");
const User = require("../models/user");

const optionalAuth = async (req, res, next) => {
  let token;

  // 1. Check if authorization header exists and starts with Bearer
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  // 2. If no token is provided, just proceed as a guest (req.user remains undefined)
  if (!token) {
    return next();
  }

  try {
    // 3. Verify token and try to attach user if valid
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (user) {
      req.user = user; // attach user to request if found
    }
  } catch (err) {
    // If token is invalid/expired, we log it optionally
    // but do NOT send a 401 response — we let them pass as a guest
    console.error("Optional auth token error:", err.message);
  }

  next();
};

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, token missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(401).json({ message: "User not found" });

    req.user = user; // attach user to request
    next();
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: "Token invalid" });
  }
};

// Pass allowed roles like authorize('admin') or authorize('admin', 'agent')
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "You do not have permission to access this route" });
    }

    next();
  };
};

module.exports = { optionalAuth, protect, authorize };
