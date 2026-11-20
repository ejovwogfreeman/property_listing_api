const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields

const {
  createAd,
  getAds,
  getAd,
  updateAd,
  deleteAd,
  getFeaturedAds,
  recordAdClick,
} = require("../controllers/ads");
const { protect, authorize } = require("../middlewares/auth");
const trackActivity = require("../middlewares/trackActivity");

// Public: the home page's featured properties, and clicks on them.
// These come before "/:id" so "featured" isn't read as an ad id.
router.get("/featured", getFeaturedAds);
router.post("/:id/click", recordAdClick);

// Only agents create ads. Creating one pays for it and launches it at once
// (there is no admin approval any more)
router.post(
  "/",
  protect,
  authorize("agent"),
  trackActivity,
  upload.none(),
  createAd,
);

// Admins see all ads, agents see their own
router.get("/", protect, authorize("admin", "agent"), trackActivity, getAds);

router.get("/:id", protect, authorize("admin", "agent"), trackActivity, getAd);

// Agents pause or resume; admins stop
router.patch(
  "/:id",
  protect,
  authorize("admin", "agent"),
  trackActivity,
  upload.none(),
  updateAd,
);

// Agents: unpaid ads only. Admins: any ad that isn't running or paused
router.delete(
  "/:id",
  protect,
  authorize("admin", "agent"),
  trackActivity,
  deleteAd,
);

module.exports = router;
