const express = require("express");
const router = express.Router();
const propertyController = require("../controllers/property");
const { protect } = require("../middlewares/auth");
const { authorize } = require("../middlewares/auth-role");
const upload = require("../middlewares/upload"); // <-- import your multer-cloudinary middleware

// ------------------------
// Create a property
// Only admin or agent
// Upload images + video
router.post(
  "/",
  protect,
  authorize("admin", "agent"),
  (req, res, next) => {
    uploadImages(req, res, function (err) {
      if (err) return res.status(400).json({ message: err.message });
      uploadSingleVideo(req, res, next); // continue after images uploaded
    });
  },
  propertyController.createProperty
);

// ------------------------
// Get all properties
// Public
router.get("/", propertyController.listProperties);

// ------------------------
// Get single property by ID
// Public (or protected if you want)
router.get("/:id", protect, propertyController.getProperty);

// ------------------------
// Update property by ID
// Only admin or agent
// Upload new images/video if any
router.put(
  "/:id",
  protect,
  authorize("admin", "agent"),
  (req, res, next) => {
    uploadImages(req, res, function (err) {
      if (err) return res.status(400).json({ message: err.message });
      uploadSingleVideo(req, res, next);
    });
  },
  propertyController.updateProperty
);

// ------------------------
// Delete property by ID
// Only admin or agent
router.delete(
  "/:id",
  protect,
  authorize("admin", "agent"),
  propertyController.deleteProperty
);

module.exports = router;
