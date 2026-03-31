const express = require("express");
const router = express.Router();
const {
  addToFavorites,
  removeFromFavorites,
  clearFavorites,
  getFavorites,
  getFavoriteById,
} = require("../controllers/favorite");
const { protect } = require("../middleware/auth"); // your protect middleware

// ---------------------------
// Favorites Routes
// ---------------------------

// 1️⃣ Add a property to favorites
// POST /api/favorites
// Body: { propertyId }
router.post("/", protect, addToFavorites);

// 2️⃣ Remove a property from favorites
// DELETE /api/favorites
// Body: { propertyId }
router.delete("/", protect, removeFromFavorites);

// 3️⃣ Clear all favorites
// DELETE /api/favorites/clear
router.delete("/clear", protect, clearFavorites);

// 4️⃣ Get all favorites for the logged-in user
// GET /api/favorites
router.get("/", protect, getFavorites);

// 5️⃣ Get a single favorite by favorite ID
// GET /api/favorites/:id
router.get("/:id", protect, getFavoriteById);

module.exports = router;
