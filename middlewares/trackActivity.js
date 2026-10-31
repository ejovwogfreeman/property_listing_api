const User = require("../models/user");

const trackActivity = async (req, res, next) => {
  if (req.user && req.user._id) {
    // Non-blocking update so it doesn't slow down responses
    User.findByIdAndUpdate(req.user._id, { lastActive: new Date() })
      .exec()
      .catch(() => {});
  }
  next();
};

module.exports = trackActivity;
