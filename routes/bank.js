const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  resolveAccountDetails,
  saveBankDetails,
  setDefaultBank,
  getBankDetails,
  getSingleBankDetails,
  getAgentBankDetails,
  getAllBanks,
  updateBankDetails,
  deleteBankDetails,
} = require("../controllers/bank");
const { protect } = require("../middlewares/auth");

// Resolve account name from Paystack before saving
router.post("/resolve", protect, upload.none(), resolveAccountDetails);

// Admin/Listing routes (placed before /:id to prevent path conflicts)
router.get("/all", protect, getAllBanks);
router.get("/user/:userId", protect, getAgentBankDetails);

// Bank CRUD routes
router.post("/", protect, upload.none(), saveBankDetails); // Create
router.put("/:id/default", protect, upload.none(), setDefaultBank);
router.get("/", protect, getBankDetails); // Get own bank details
router.get("/:id", protect, getSingleBankDetails); // Get single bank by ID
router.put("/:id", protect, upload.none(), updateBankDetails); // Update by ID
router.delete("/:id", protect, deleteBankDetails); // Delete by ID

module.exports = router;
