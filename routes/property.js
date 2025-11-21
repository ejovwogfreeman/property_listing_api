const express = require("express");
const router = express.Router();
// const propertyController = require("../controllers/property");
const {
  createProperty,
  listProperties,
  getProperty,
  updateProperty,
  deleteProperty,
} = require("../controllers/property");
const { protect, authorize } = require("../middlewares/auth");
const { uploadPropertyFiles } = require("../middlewares/upload");

// // ------------------------
// // Create a property
// // Only admin or agent
// // Upload images + video
router.post(
  "/",
  protect,
  authorize("admin", "agent"),
  uploadPropertyFiles,
  createProperty
);

// ------------------------
// Get all properties
// Public
router.get("/", listProperties);

// ------------------------
// Get single property by ID
// Public (or protected if you want)
router.get("/:id", protect, getProperty);

// ------------------------
// Update property by ID
// Only admin or agent
// Upload new images/video if any
router.put("/:id", protect, authorize("admin", "agent"), updateProperty);

// ------------------------
// Delete property by ID
// Only admin or agent
router.delete("/:id", protect, authorize("admin", "agent"), deleteProperty);

module.exports = router;
