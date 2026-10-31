const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields

const {
  createAd,
  reviewAd, // <--- Imported review controller function (Item 19)
  payForAd,
  getAds,
  getAd,
  updateAd,
  deleteAd,
} = require("../controllers/ads");
const { protect, authorize } = require("../middlewares/auth");
const trackActivity = require("../middlewares/trackActivity");

// Only agents can create ads
router.post(
  "/",
  protect,
  authorize("agent"),
  trackActivity,
  upload.none(),
  createAd,
);

// --- ITEM 19: Admin Ad Review / Approval Route ---
router.patch(
  "/:id/review",
  protect,
  authorize("admin"),
  trackActivity,
  upload.none(),
  reviewAd,
);

// Both admins and agents can view all ads
router.get("/", protect, authorize("admin", "agent"), trackActivity, getAds);

// Only agents can pay for their ads
router.post("/:id/pay", protect, authorize("agent"), trackActivity, payForAd);

// Both admins and agents can view a single ad
router.get("/:id", protect, authorize("admin", "agent"), trackActivity, getAd);

// Both admins and agents can update (agents update details, admin updates status)
router.patch(
  "/:id",
  protect,
  authorize("admin", "agent"),
  trackActivity,
  upload.none(),
  updateAd,
);

// Both admins and agents can delete
router.delete(
  "/:id",
  protect,
  authorize("admin", "agent"),
  trackActivity,
  deleteAd,
);

module.exports = router;
