const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields

const {
  createAd,
  payForAd,
  getAds,
  getAd,
  updateAd,
  deleteAd,
} = require("../controllers/ads");
const { protect, authorize } = require("../middlewares/auth");

// Only agents can create ads
router.post("/", protect, authorize("agent"), upload.none(), createAd);

// Both admins and agents can view all ads
router.get("/", protect, authorize("admin", "agent"), getAds);

// Only agents can pay for their ads
router.post("/:id/pay", protect, authorize("agent"), payForAd);

// Both admins and agents can view a single ad
router.get("/:id", protect, authorize("admin", "agent"), getAd);

// Both admins and agents can update (agents update details, admin updates status)
router.patch(
  "/:id",
  protect,
  authorize("admin", "agent"),
  upload.none(),
  updateAd,
);

// Both admins and agents can delete
router.delete("/:id", protect, authorize("admin", "agent"), deleteAd);

module.exports = router;
