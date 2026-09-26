const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  createRating,
  getPropertyRatings,
  getAgentRatings,
  updateRating,
  deleteRating,
} = require("../controllers/rating");

// Assuming you have an authentication middleware
const { protect } = require("../middlewares/auth");

// 📌 Create or Update a Review (Requires inspection or purchase)
router.post("/", protect, upload.none(), createRating);

// 📌 Get all reviews for a specific property (Public)
router.get("/property/:propertyId", getPropertyRatings);

// 📌 Get all reviews for an agent (Can be specific agent ID or logged-in agent)
router.get("/agent/:id", getAgentRatings);

// 📌 Update a specific review by ID
router.put("/:ratingId", protect, upload.none(), updateRating);

// 📌 Delete a specific review by ID (Owner or Admin)
router.delete("/:ratingId", protect, deleteRating);

module.exports = router;
