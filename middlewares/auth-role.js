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

module.exports = { authorize };
