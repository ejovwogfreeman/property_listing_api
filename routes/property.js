const express = require("express");
const router = express.Router();
// const propertyController = require("../controllers/property");
const {
  createProperty,
  getAllProperties,
  getAgentProperties,
  getProperty,
  updateProperty,
  deleteProperty,
  changePropertyStatus,
  flagProperty,
  addAdminNote,
  updateAdminNote,
  deleteAdminNote,
} = require("../controllers/property");
const { optionalAuth, protect, authorize } = require("../middlewares/auth");
const { uploadPropertyFiles, uploadNone } = require("../middlewares/upload");

// // ------------------------
// // Create a property
// // Only admin or agent
// // Upload images + video
router.post(
  "/",
  protect,
  authorize("admin", "agent"),
  uploadPropertyFiles,
  createProperty,
);

// ------------------------
// Get all properties
// Public
router.get("/", getAllProperties);

// ------------------------
// Get all agent properties
// Public
// router.get("/agent/:id", protect, getAgentProperties);
router.get("/agent/:id", getAgentProperties);

// ------------------------
// Get single property by ID
// Public (or protected if you want)
router.get("/:id", optionalAuth, getProperty);

// ------------------------
// Update property by ID
// Only admin or agent
// Upload new images/video if any
router.put(
  "/:id",
  protect,
  authorize("admin", "agent"),
  uploadNone,
  updateProperty,
);

// ------------------------
// Delete property by ID
// Only admin or agent
router.delete("/:id", protect, authorize("admin", "agent"), deleteProperty);

// ------------------------
// Update property by ID
// Only admin
// Upload new images/video if any
router.put(
  "/status/:id",
  protect,
  authorize("admin"),
  uploadNone,
  changePropertyStatus,
);

// PATCH: Flag or unflag a property listing (Admin only)
router.patch("/:id/flag", protect, authorize("admin"), flagProperty);

// Add a note
router.post("/:propertyId/notes", protect, addAdminNote);

// Update a note
router.patch("/:propertyId/notes/:noteId", protect, updateAdminNote);

// Delete a note
router.delete("/:propertyId/notes/:noteId", protect, deleteAdminNote);

module.exports = router;
